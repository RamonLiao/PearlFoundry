#[test_only]
/// Red-team: executable attacks against pure money-flow logic (fee math, leg sizing).
/// Predict-dependent flows abort in the stub, so those vectors are static-reasoned in
/// the report; here we execute everything the stub does NOT block.
module structured_note_factory::red_team_money_flow;

use structured_note_factory::note_factory as nf;
use structured_note_factory::strategy_range_accrual as ra;

// === Round 2: Integer abuse — perf fee rounding / fee evasion via dust ===

#[test]
/// Attack: payout just above hurdle by 1..9 units rounds perf fee to 0 (fee evasion).
fun red_team_round_2_perf_fee_rounds_to_zero() {
    // net=1000, hurdle=10000bps(100%) → threshold=1000.
    // profit of 9 → 9*1000/10000 = 0.0009 → truncates to 0. Fee escaped.
    let f = nf::compute_perf_fee(1009, 1000, 10000);
    assert!(f == 0, 0); // EXPLOIT confirmed: profit captured, zero perf fee
}

#[test]
/// Attack: issuance fee rounds to 0 for small notional (dust mint fee evasion).
fun red_team_round_2b_issuance_fee_rounds_to_zero() {
    // notional=300, fee_bps=30 → 300*30/10000 = 0.9 → 0. Free mint.
    let f = nf::compute_issuance_fee(300, 30);
    assert!(f == 0, 0); // EXPLOIT: zero issuance fee on sub-3334 notional
}

#[test]
/// Attack: MAX_U64 notional — does u128 intermediate prevent overflow abort?
fun red_team_round_2c_max_notional_no_overflow() {
    let max = 18446744073709551615u64;
    // 30bps of MAX: fits in u128 intermediate, result fits u64. Should NOT abort.
    let f = nf::compute_issuance_fee(max, 30);
    assert!(f == 55340232221128654, 0);
}

#[test]
/// Attack: perf fee with hurdle_bps below 10000 (sub-principal hurdle) — does code
/// allow charging perf fee on principal that wasn't actually profit?
fun red_team_round_4_low_hurdle_taxes_principal() {
    // net=1000, hurdle=5000bps(50%) → threshold=500.
    // payout=1000 (just principal back, ZERO real profit) → "profit"=500, fee=50.
    let f = nf::compute_perf_fee(1000, 1000, 5000);
    // Charges 50 perf fee on a note that only returned principal. Misconfig => theft.
    assert!(f == 50, 0); // SUSPICIOUS: hurdle<100% taxes principal as profit
}

// === Round 8: DoS — unbounded ladder leg count ===

#[test]
/// MITIGATED (was DoS/uncontrolled-cast-abort): a huge range / tiny step now fails loud
/// with the domain error `ETooManyLegs` from the MAX_LEGS guard, *before* the u16 cast.
#[expected_failure(abort_code = ra::ETooManyLegs)]
fun red_team_round_8_leg_count_overflow_aborts() {
    let _lpe = ra::legs_per_expiry(0, 65535, 1); // 65536 legs > MAX_LEGS → ETooManyLegs
}

#[test]
/// MITIGATED: previously a 65534-leg ladder built silently (DoS-sized predict::mint loop).
/// The MAX_LEGS guard now rejects any ladder beyond the cap with `ETooManyLegs`.
#[expected_failure(abort_code = ra::ETooManyLegs)]
fun red_team_round_8d_max_legs_guard_enforced() {
    let _lpe = ra::legs_per_expiry(0, 65534, 1); // > MAX_LEGS → ETooManyLegs
}

#[test]
/// Attack: qty_per_leg with truncated/zero leg count → div-by-zero or zero qty.
#[expected_failure(abort_code = ra::EZeroQtyPerLeg)]
fun red_team_round_8b_qty_zero_legs_guarded() {
    // If legs_per_expiry truncated to 0, total=0 → q = net/0 aborts (arith), OR guard.
    // Here force the guard: net too small for legs → q==0 → EZeroQtyPerLeg.
    let _q = ra::qty_per_leg(10, 100, 1); // 10/100 = 0 → abort
}

#[test]
/// Attack: legs_per_expiry with upper just past a step boundary — off-by-one leg count
/// (each extra recorded leg = extra qty_per_leg principal allocated / risk).
fun red_team_round_8c_offbyone_inclusive_upper() {
    // lower=0 upper=10 step=10 → (10/10)+1 = 2 legs (strikes 0 and 10). Inclusive upper.
    let lpe = ra::legs_per_expiry(0, 10, 10);
    assert!(lpe == 2, 0);
}

// === Round 2d: qty_per_leg total multiplication overflow ===
#[test]
/// Attack: legs_per_expiry(u16::MAX) * expiry_count(u8::MAX) as u64 — no overflow since
/// 65535*255 < u64, but verify net/total floor truncation strands principal in manager.
fun red_team_round_4b_principal_dust_stranded() {
    // net=1_000_001, total legs = 5000*200=1_000_000 → q=1, used=1_000_000, stranded=1.
    // Across many notes this dust accrues in PredictManager, unclaimable by holder.
    let q = ra::qty_per_leg(1_000_001, 5000, 200);
    assert!(q == 1, 0); // SUSPICIOUS: floor division strands principal dust in manager
}
