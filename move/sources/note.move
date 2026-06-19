/// Audit core: `NoteBase<phantom S>` definition, lifecycle, witness-gated strategy
/// params, and soulbound destroy. See spec §4 (Data Structures) and §3 (note module).
///
/// MVP: `key` ONLY (no `store`) = soulbound / non-transferable (review F3).
/// Move cannot read an owned object's current holder on-chain, so `claim` (in
/// note_factory) must trust `ctx.sender()` — which equals the holder ONLY while the
/// note cannot be transferred. Adding `store` would allow `public_transfer`, breaking
/// both the owner-gated payout and the fixed `PredictManager.owner` binding (T6).
///
/// This module is the data core: it holds NO orchestration logic. Composing legs,
/// settling via Predict, fee/perf accounting and event emission live in `note_factory`
/// and `strategy_*`. Mutators are `public(package)` so only this package drives the
/// lifecycle; the witness `S` plus the `_w: S` proof gate param writes per-strategy.
module structured_note_factory::note;

use sui::dynamic_field as df;
use predict::market_key::MarketKey;
use predict::range_key::RangeKey;

// === Status ===
const STATUS_ACTIVE: u8 = 0;
const STATUS_SETTLED: u8 = 1;
const STATUS_DEFAULTED: u8 = 2;

// === Errors (1xx) ===
#[error]
const EInvalidStatusTransition: vector<u8> = b"note: status can only move from Active to Settled/Defaulted";
#[error]
const ENoParams: vector<u8> = b"note: strategy params absent";

/// Singleton dynamic-field key for the per-note strategy params. Type safety comes
/// from `NoteBase<S>` (one params blob per note); the witness `S` is what scopes who
/// may write. A field-value key keeps the `NoteBase` binary layout stable across
/// upgrades (params evolve independently — spec §4 "why dynamic field").
public struct ParamsKey() has copy, drop, store;

/// Canonical note type. `phantom S` is the per-strategy witness type: `NoteBase<RangeAccrual>`
/// is a distinct type from `NoteBase<PrincipalProtected>` at compile time, so one template
/// can never be settled with another's logic. All instances share `key` only (soulbound).
public struct NoteBase<phantom S> has key {
    id: UID,
    issuer: address,
    owner_at_mint: address,
    manager_id: ID,                 // dedicated shared PredictManager, referenced by ID
    underlying: vector<u8>,         // e.g. b"BTC"
    legs: vector<MarketKey>,        // copy+store → storable
    range_legs: vector<RangeKey>,
    oracle_ids: vector<ID>,         // one OracleSVI per expiry
    notional: u64,
    mint_ts_ms: u64,
    expiry_ts_ms: u64,
    walrus_blob_id: vector<u8>,     // bound at mint, immutable
    fee_bps: u16,
    is_public: bool,
    status: u8,                     // 0 Active · 1 Settled · 2 Defaulted
}

// === Construction (package-internal; called by note_factory) ===

/// Build a fresh Active note. Returns it by value so the factory transfers it soulbound
/// to the holder. Strategy params are attached separately via `add_params` (witness-gated).
public(package) fun new<S>(
    issuer: address,
    owner_at_mint: address,
    manager_id: ID,
    underlying: vector<u8>,
    legs: vector<MarketKey>,
    range_legs: vector<RangeKey>,
    oracle_ids: vector<ID>,
    notional: u64,
    mint_ts_ms: u64,
    expiry_ts_ms: u64,
    walrus_blob_id: vector<u8>,
    fee_bps: u16,
    is_public: bool,
    ctx: &mut TxContext,
): NoteBase<S> {
    NoteBase<S> {
        id: object::new(ctx),
        issuer,
        owner_at_mint,
        manager_id,
        underlying,
        legs,
        range_legs,
        oracle_ids,
        notional,
        mint_ts_ms,
        expiry_ts_ms,
        walrus_blob_id,
        fee_bps,
        is_public,
        status: STATUS_ACTIVE,
    }
}

// === Strategy params (witness-gated dynamic field) ===

/// Attach strategy params. Requires the witness value `_w: S`, which only the module
/// that defines `S` can construct → per-strategy write authority. One blob per note.
public(package) fun add_params<S: drop, P: store>(note: &mut NoteBase<S>, _w: S, params: P) {
    df::add(&mut note.id, ParamsKey(), params);
}

public(package) fun borrow_params<S, P: store>(note: &NoteBase<S>): &P {
    assert!(df::exists_with_type<ParamsKey, P>(&note.id, ParamsKey()), ENoParams);
    df::borrow(&note.id, ParamsKey())
}

public(package) fun borrow_params_mut<S, P: store>(note: &mut NoteBase<S>): &mut P {
    assert!(df::exists_with_type<ParamsKey, P>(&note.id, ParamsKey()), ENoParams);
    df::borrow_mut(&mut note.id, ParamsKey())
}

/// Detach and return the params. Must be called before `destroy` so no dynamic field
/// is orphaned under the deleted UID.
public(package) fun remove_params<S, P: store>(note: &mut NoteBase<S>): P {
    assert!(df::exists_with_type<ParamsKey, P>(&note.id, ParamsKey()), ENoParams);
    df::remove(&mut note.id, ParamsKey())
}

// === Lifecycle ===

/// Move from Active to a terminal state. Terminal states are immutable (no re-settle).
public(package) fun set_status<S>(note: &mut NoteBase<S>, new_status: u8) {
    assert!(note.status == STATUS_ACTIVE, EInvalidStatusTransition);
    assert!(new_status == STATUS_SETTLED || new_status == STATUS_DEFAULTED, EInvalidStatusTransition);
    note.status = new_status;
}

/// Consume a soulbound note, deleting its UID. Caller must have removed strategy params
/// first (`remove_params`). Returns `owner_at_mint` (== holder, by soulbound invariant)
/// so the factory can route the payout.
public(package) fun destroy<S>(note: NoteBase<S>): address {
    let NoteBase { id, owner_at_mint, .. } = note;
    id.delete();
    owner_at_mint
}

/// Soulbound transfer helper. `NoteBase` is key-only, so `transfer::transfer<T: key>`
/// can ONLY be called by this defining module — `note_factory` cannot transfer the note
/// itself (C1). This is the single sanctioned move-out of a note; there is deliberately
/// no `store`-based `public_transfer` path (keeps the soulbound invariant, review F3/T6).
public(package) fun soulbound_transfer<S>(note: NoteBase<S>, to: address) {
    transfer::transfer(note, to);
}

// === Status constant accessors (for sibling modules / off-chain) ===
public fun status_active(): u8 { STATUS_ACTIVE }
public fun status_settled(): u8 { STATUS_SETTLED }
public fun status_defaulted(): u8 { STATUS_DEFAULTED }

// === Getters ===
public fun id<S>(note: &NoteBase<S>): &UID { &note.id }
public fun note_id<S>(note: &NoteBase<S>): ID { object::id(note) }
public fun issuer<S>(note: &NoteBase<S>): address { note.issuer }
public fun owner_at_mint<S>(note: &NoteBase<S>): address { note.owner_at_mint }
public fun manager_id<S>(note: &NoteBase<S>): ID { note.manager_id }
public fun underlying<S>(note: &NoteBase<S>): &vector<u8> { &note.underlying }
public fun legs<S>(note: &NoteBase<S>): &vector<MarketKey> { &note.legs }
public fun range_legs<S>(note: &NoteBase<S>): &vector<RangeKey> { &note.range_legs }
public fun oracle_ids<S>(note: &NoteBase<S>): &vector<ID> { &note.oracle_ids }
public fun notional<S>(note: &NoteBase<S>): u64 { note.notional }
public fun mint_ts_ms<S>(note: &NoteBase<S>): u64 { note.mint_ts_ms }
public fun expiry_ts_ms<S>(note: &NoteBase<S>): u64 { note.expiry_ts_ms }
public fun walrus_blob_id<S>(note: &NoteBase<S>): &vector<u8> { &note.walrus_blob_id }
public fun fee_bps<S>(note: &NoteBase<S>): u16 { note.fee_bps }
public fun is_public<S>(note: &NoteBase<S>): bool { note.is_public }
public fun status<S>(note: &NoteBase<S>): u8 { note.status }
