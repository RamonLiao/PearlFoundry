/// External API surface: orchestrates strategy -> manager -> note -> leaderboard -> fee.
/// mint is 2-PTB (Predict's create_manager shares the manager + returns only ID, so it
/// cannot be a same-PTB input — design doc 2026-06-18 §0). PTB2 + claim use no-ability
/// hot-potato builders because Move entry cannot take `vector<&OracleSVI>` (C2: all
/// builder fns are `public fun`, never `entry`). See spec §3 and design doc.
module structured_note_factory::note_factory;

use sui::coin::{Self, Coin};
use sui::clock::Clock;
use predict::predict::{Self, Predict};
use predict::predict_manager::{Self, PredictManager};
use predict::oracle::{Self, OracleSVI};
use predict::market_key::{Self, MarketKey};
use structured_note_factory::note::{Self, NoteBase};
use structured_note_factory::strategy_range_accrual::{Self as ra, RangeAccrual, RangeParams};
use structured_note_factory::fee_vault::{Self, FeeVault};
use structured_note_factory::leaderboard;
use structured_note_factory::events;

const PERF_FEE_BPS: u64 = 1000;   // 10%
const FEE_KIND_ISSUANCE: u8 = 0;
const FEE_KIND_PERF: u8 = 1;
const TEMPLATE: vector<u8> = b"range_accrual";

// === Errors (5xx) ===
#[error]
const EPaused: vector<u8> = b"note_factory: minting paused";
#[error]
const EManagerMismatch: vector<u8> = b"note_factory: manager id does not match note/ticket";
#[error]
const EExpiryCountMismatch: vector<u8> = b"note_factory: added expiries != expected";
#[error]
const EZeroExpiry: vector<u8> = b"note_factory: expiry_total must be > 0";
#[error]
const EDustNotional: vector<u8> = b"note_factory: notional below min_notional";
#[error]
const EHurdleBelowPrincipal: vector<u8> = b"note_factory: hurdle_bps must be >= 10000 (perf fee only above principal)";
#[error]
const ENotExpired: vector<u8> = b"note_factory: clock < note expiry";
#[error]
const EOracleNotSettled: vector<u8> = b"note_factory: oracle not settled";
#[error]
const ELegsNotSettled: vector<u8> = b"note_factory: not all legs settled";
#[error]
const ENoteNotActive: vector<u8> = b"note_factory: note not active";

public struct FactoryConfig has key {
    id: UID,
    fee_bps: u16,
    hurdle_bps: u16,
    /// Minimum notional accepted by `mint_begin`. Defaults to 1 dUSDC (1_000_000 @ 6dp):
    /// an anti-spam / non-zero-issuance-fee floor for the self-claim model (holder pays
    /// settlement gas). If the project runs a settlement keeper (it pays per-note settle
    /// gas), raise this via `set_min_notional` so issuance fee covers that cost
    /// (~50–100 dUSDC, calibrate against measured testnet round-trip gas — review F3).
    min_notional: u64,
    paused: bool,
}

public struct FactoryAdminCap has key, store { id: UID }

/// Hot potato: no abilities → MUST be consumed by `mint_finalize`. Guarantees no
/// half-built note state can persist (legs minted but note never created).
public struct MintTicket {
    issuer: address,
    manager_id: ID,
    underlying: vector<u8>,
    legs: vector<MarketKey>,
    oracle_ids: vector<ID>,
    notional: u64,
    net_principal: u64,
    issuance_fee: u64,
    lower: u64,
    upper: u64,
    strike_step: u64,
    qty_per_leg: u64,
    legs_per_expiry: u16,
    expected_expiries: u8,
    expiries_added: u8,
    expiry_ts_ms: u64,         // max expiry across oracles (note expiry)
    walrus_blob_id: vector<u8>,
    fee_bps: u16,
    hurdle_bps: u16,
    is_public: bool,
}

/// Hot potato: holds the whole note until every leg is settled, then destroys it in
/// `claim_finalize`. No abilities → cannot be dropped/stored mid-settle (review F2:
/// settle-then-withdraw is atomic; a partially-settled note can never be claimed).
public struct ClaimTicket {
    note: NoteBase<RangeAccrual>,
    pending_legs: vector<MarketKey>,
    expiry_ts_ms: u64,
}

fun init(ctx: &mut TxContext) {
    transfer::share_object(FactoryConfig {
        id: object::new(ctx), fee_bps: 30, hurdle_bps: 10000, min_notional: 1_000_000, paused: false,
    });
    transfer::transfer(FactoryAdminCap { id: object::new(ctx) }, ctx.sender());
}

// === Admin (FactoryAdminCap-gated) ===

/// Set the minimum mintable notional. The per-settlement-mode knob (F3): keep low for
/// self-claim, raise for keeper-settled so issuance fee covers per-note gas.
public fun set_min_notional(cfg: &mut FactoryConfig, _cap: &FactoryAdminCap, v: u64) {
    cfg.min_notional = v;
}

/// Emergency stop for new mints. `paused` is checked in `mint_begin`; this is the only
/// switch that sets it (without it the field would be dead — review hardening).
public fun set_paused(cfg: &mut FactoryConfig, _cap: &FactoryAdminCap, p: bool) {
    cfg.paused = p;
}

// === Pure fee helpers (unit-tested) ===

public fun compute_issuance_fee(notional: u64, fee_bps: u16): u64 {
    (((notional as u128) * (fee_bps as u128) / 10000) as u64)
}

public fun compute_perf_fee(payout: u64, net_principal: u64, hurdle_bps: u16): u64 {
    let threshold = (((net_principal as u128) * (hurdle_bps as u128) / 10000) as u64);
    if (payout > threshold) {
        ((((payout - threshold) as u128) * (PERF_FEE_BPS as u128) / 10000) as u64)
    } else { 0 }
}

// === Mint (PTB2 builder; PTB1 = raw predict::create_manager off-chain) ===

public fun mint_begin<T>(
    cfg: &FactoryConfig,
    vault: &mut FeeVault,
    mgr: &mut PredictManager,
    mut payment: Coin<T>,
    underlying: vector<u8>,
    lower: u64,
    upper: u64,
    strike_step: u64,
    expiry_total: u8,
    walrus_blob_id: vector<u8>,
    is_public: bool,
    ctx: &mut TxContext,
): MintTicket {
    assert!(!cfg.paused, EPaused);
    assert!(expiry_total > 0, EZeroExpiry);                 // else qty_per_leg divides by 0 (F1)
    assert!(cfg.hurdle_bps >= 10000, EHurdleBelowPrincipal); // perf fee only above principal (F4)
    let notional = coin::value(&payment);
    assert!(notional >= cfg.min_notional, EDustNotional);    // anti-spam / fee floor (F3)
    let fee = compute_issuance_fee(notional, cfg.fee_bps);
    let fee_coin = coin::split(&mut payment, fee, ctx);
    fee_vault::collect(vault, fee_coin);
    let net = notional - fee;
    // remaining `payment` is the net principal → deposit into the manager
    predict_manager::deposit<T>(mgr, payment, ctx);

    let lpe = ra::legs_per_expiry(lower, upper, strike_step);
    let qpl = ra::qty_per_leg(net, lpe, expiry_total);

    MintTicket {
        issuer: ctx.sender(),
        manager_id: object::id(mgr),
        underlying,
        legs: vector[],
        oracle_ids: vector[],
        notional,
        net_principal: net,
        issuance_fee: fee,
        lower, upper, strike_step,
        qty_per_leg: qpl,
        legs_per_expiry: lpe,
        expected_expiries: expiry_total,
        expiries_added: 0,
        expiry_ts_ms: 0,
        walrus_blob_id,
        fee_bps: cfg.fee_bps,
        hurdle_bps: cfg.hurdle_bps,
        is_public,
    }
}

public fun mint_add_expiry<T>(
    t: &mut MintTicket,
    predict: &mut Predict,
    mgr: &mut PredictManager,
    o: &OracleSVI,
    clk: &Clock,
    ctx: &mut TxContext,
) {
    assert!(object::id(mgr) == t.manager_id, EManagerMismatch);
    let legs = ra::mint_expiry_legs<T>(predict, mgr, o, t.lower, t.upper, t.strike_step, t.qty_per_leg, clk, ctx);
    t.legs.append(legs);
    t.oracle_ids.push_back(oracle::id(o));
    let exp = oracle::expiry(o);
    if (exp > t.expiry_ts_ms) { t.expiry_ts_ms = exp; };
    t.expiries_added = t.expiries_added + 1;
}

public fun mint_finalize(t: MintTicket, clk: &Clock, ctx: &mut TxContext) {
    let MintTicket {
        issuer, manager_id, underlying, legs, oracle_ids, notional,
        net_principal: _, issuance_fee, lower, upper, strike_step, qty_per_leg,
        legs_per_expiry, expected_expiries, expiries_added, expiry_ts_ms,
        walrus_blob_id, fee_bps, hurdle_bps, is_public,
    } = t;
    assert!(expiries_added == expected_expiries, EExpiryCountMismatch);

    let mint_ts = clk.timestamp_ms();
    let params = ra::new_params(ra::version(), lower, upper, strike_step, expiries_added, legs_per_expiry, qty_per_leg, hurdle_bps);
    let mut note = note::new<RangeAccrual>(
        issuer, issuer, manager_id, underlying, legs, vector[], oracle_ids,
        notional, mint_ts, expiry_ts_ms, walrus_blob_id, fee_bps, is_public, ctx,
    );
    note::add_params(&mut note, ra::witness(), params);

    let nid = note::note_id(&note);
    events::emit_fee_collected(nid, FEE_KIND_ISSUANCE, issuance_fee);
    if (is_public) { leaderboard::register(nid, issuer, TEMPLATE); };
    events::emit_note_minted(nid, TEMPLATE, issuer, manager_id, notional, expiry_ts_ms, walrus_blob_id, is_public);

    note::soulbound_transfer(note, issuer);
}

// === Claim (atomic settle+withdraw builder) ===

public fun claim_begin(
    note: NoteBase<RangeAccrual>,
    mgr: &PredictManager,
    clk: &Clock,
    _ctx: &TxContext,
): ClaimTicket {
    assert!(note::status(&note) == note::status_active(), ENoteNotActive);
    let expiry = note::expiry_ts_ms(&note);
    assert!(clk.timestamp_ms() >= expiry, ENotExpired);
    assert!(note::manager_id(&note) == object::id(mgr), EManagerMismatch);
    let pending = *note::legs(&note);   // copy vector<MarketKey>
    ClaimTicket { note, pending_legs: pending, expiry_ts_ms: expiry }
}

/// Settle every pending leg belonging to `o`'s oracle, atomically: redeem (permissionless)
/// then assert the manager position is 0 (review F2 post-check). Settled legs leave the
/// pending set.
public fun claim_settle_expiry<T>(
    ct: &mut ClaimTicket,
    predict: &mut Predict,
    mgr: &mut PredictManager,
    o: &OracleSVI,
    clk: &Clock,
    ctx: &mut TxContext,
) {
    assert!(oracle::is_settled(o), EOracleNotSettled);
    let oid = oracle::id(o);
    let mut remaining = vector[];
    let n = ct.pending_legs.length();
    let mut i = 0;
    while (i < n) {
        let k = ct.pending_legs[i];
        if (market_key::oracle_id(&k) == oid) {
            let pos = predict_manager::position(mgr, k);
            if (pos > 0) {
                predict::redeem_permissionless<T>(predict, mgr, o, k, pos, clk, ctx);
            };
            assert!(predict_manager::position(mgr, k) == 0, ELegsNotSettled);
            // settled → not carried into `remaining`
        } else {
            remaining.push_back(k);
        };
        i = i + 1;
    };
    ct.pending_legs = remaining;
}

public fun claim_finalize<T>(
    ct: ClaimTicket,
    mgr: &mut PredictManager,
    vault: &mut FeeVault,
    ctx: &mut TxContext,
) {
    let ClaimTicket { mut note, pending_legs, expiry_ts_ms: _ } = ct;
    assert!(pending_legs.is_empty(), ELegsNotSettled);

    let bal = predict_manager::balance<T>(mgr);
    let mut payout = predict_manager::withdraw<T>(mgr, bal, ctx);
    let payout_amt = coin::value(&payout);

    // perf fee on profit above net-principal hurdle
    let hurdle = ra::params_hurdle_bps(note::borrow_params<RangeAccrual, RangeParams>(&note));
    let notional = note::notional(&note);
    let fee_bps = note::fee_bps(&note);
    let net_principal = notional - compute_issuance_fee(notional, fee_bps);
    let perf_fee = compute_perf_fee(payout_amt, net_principal, hurdle);
    if (perf_fee > 0) {
        let fee_coin = coin::split(&mut payout, perf_fee, ctx);
        fee_vault::collect(vault, fee_coin);
    };

    // consume note: remove params (required before destroy), then delete
    let _p: RangeParams = note::remove_params<RangeAccrual, RangeParams>(&mut note);
    note::set_status(&mut note, note::status_settled());
    let nid = note::note_id(&note);
    let holder = note::destroy(note);

    transfer::public_transfer(payout, holder);
    events::emit_fee_collected(nid, FEE_KIND_PERF, perf_fee);
    events::emit_note_settled(nid, payout_amt, perf_fee, ctx.sender());
}

#[test_only]
public fun init_for_testing(ctx: &mut TxContext) { init(ctx) }
