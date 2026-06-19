/// Range Accrual template: leg composition + payoff/sizing math.
/// Provides one-time witness `RangeAccrual` and versioned `RangeParams` (review F4).
/// MVP payoff (D1): equal-weight ladder of `up` binaries from lower..upper (step).
/// See spec §3, §4 and design doc 2026-06-18 §3.
module structured_note_factory::strategy_range_accrual;

use predict::predict::{Self, Predict};
use predict::predict_manager::PredictManager;
use predict::oracle::{Self, OracleSVI};
use predict::market_key::{Self, MarketKey};
use sui::clock::Clock;

const VERSION: u8 = 1;

/// Hard cap on ladder strikes per expiry. Bounds the `mint_expiry_legs` loop (one
/// `predict::mint` per leg) so a wide range / tiny step can't blow the PTB gas budget
/// (review F2: DoS surface). 128 binaries per expiry is far beyond any real ladder.
const MAX_LEGS: u64 = 128;

// === Errors (2xx) ===
#[error]
const EInvalidRange: vector<u8> = b"range_accrual: lower must be < upper";
#[error]
const EZeroStep: vector<u8> = b"range_accrual: strike_step must be > 0";
#[error]
const EZeroQtyPerLeg: vector<u8> = b"range_accrual: notional too small for leg count";
#[error]
const EOracleNotActive: vector<u8> = b"range_accrual: oracle not active, cannot open legs";
#[error]
const ETooManyLegs: vector<u8> = b"range_accrual: ladder leg count exceeds MAX_LEGS";

/// One-time witness; gates param writes on NoteBase<RangeAccrual> (review F4).
public struct RangeAccrual has drop {}

/// Versioned params. Existing versions are FROZEN; evolution = new version, never
/// edit in place (dynamic_field protects the parent layout, not this value struct).
public struct RangeParams has store, copy, drop {
    version: u8,
    lower: u64,
    upper: u64,
    strike_step: u64,
    expiry_count: u8,
    legs_per_expiry: u16,
    qty_per_leg: u64,
    hurdle_bps: u16,
}

public fun witness(): RangeAccrual { RangeAccrual {} }

public fun version(): u8 { VERSION }

/// Number of ladder strikes per expiry = (upper-lower)/step + 1. Pure.
/// Asserts the count against MAX_LEGS with a domain error *before* the u16 cast, so an
/// oversized ladder fails loud (`ETooManyLegs`) instead of an uncontrolled cast abort.
public fun legs_per_expiry(lower: u64, upper: u64, step: u64): u16 {
    assert!(lower < upper, EInvalidRange);
    assert!(step > 0, EZeroStep);
    let raw = ((upper - lower) / step) + 1;
    assert!(raw <= MAX_LEGS, ETooManyLegs);
    (raw as u16)
}

/// Equal-weight allocation (D2): net principal split across all legs. Pure.
public fun qty_per_leg(net: u64, legs_per_expiry: u16, expiry_count: u8): u64 {
    let total = (legs_per_expiry as u64) * (expiry_count as u64);
    let q = net / total;
    assert!(q > 0, EZeroQtyPerLeg);
    q
}

public fun new_params(
    version: u8, lower: u64, upper: u64, strike_step: u64,
    expiry_count: u8, legs_per_expiry: u16, qty_per_leg: u64, hurdle_bps: u16,
): RangeParams {
    RangeParams { version, lower, upper, strike_step, expiry_count, legs_per_expiry, qty_per_leg, hurdle_bps }
}

public fun params_hurdle_bps(p: &RangeParams): u16 { p.hurdle_bps }

/// Mint one expiry's full ladder of `up` binaries into the manager. Returns the keys
/// minted (recorded on the note). Predict-touching → integration-tested only.
public(package) fun mint_expiry_legs<T>(
    predict: &mut Predict,
    mgr: &mut PredictManager,
    o: &OracleSVI,
    lower: u64,
    upper: u64,
    step: u64,
    qty_per_leg: u64,
    clk: &Clock,
    ctx: &mut TxContext,
): vector<MarketKey> {
    assert!(oracle::is_active(o), EOracleNotActive);
    let oid = oracle::id(o);
    let exp = oracle::expiry(o);
    let mut legs = vector[];
    let mut s = lower;
    while (s <= upper) {
        let k = market_key::up(oid, exp, s);
        predict::mint<T>(predict, mgr, o, k, qty_per_leg, clk, ctx);
        legs.push_back(k);
        s = s + step;
    };
    legs
}
