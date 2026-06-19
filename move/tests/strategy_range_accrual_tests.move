#[test_only]
module structured_note_factory::strategy_range_accrual_tests;

use structured_note_factory::strategy_range_accrual as ra;

#[test]
fun ladder_strike_count() {
    // strikes 100,102,104,106,108,110 → 6
    assert!(ra::legs_per_expiry(100, 110, 2) == 6, 0);
    // single strike when range == step
    assert!(ra::legs_per_expiry(100, 102, 2) == 2, 1);
}

#[test]
fun equal_weight_split() {
    // net=6000, 6 strikes, 1 expiry → 1000/leg
    assert!(ra::qty_per_leg(6000, 6, 1) == 1000, 0);
    // 2 expiries → 500/leg
    assert!(ra::qty_per_leg(6000, 6, 2) == 500, 1);
}

#[test]
#[expected_failure(abort_code = ra::EInvalidRange)]
fun rejects_inverted_range() { ra::legs_per_expiry(110, 100, 2); }

#[test]
#[expected_failure(abort_code = ra::EZeroStep)]
fun rejects_zero_step() { ra::legs_per_expiry(100, 110, 0); }

#[test]
#[expected_failure(abort_code = ra::EZeroQtyPerLeg)]
fun rejects_dust_notional() { ra::qty_per_leg(5, 6, 1); }

#[test]
fun accepts_exactly_max_legs() {
    // 0,1,..,127 → 128 legs == MAX_LEGS, boundary accepted.
    assert!(ra::legs_per_expiry(0, 127, 1) == 128, 0);
}

#[test]
#[expected_failure(abort_code = ra::ETooManyLegs)]
fun rejects_one_over_max_legs() { ra::legs_per_expiry(0, 128, 1); } // 129 legs > MAX_LEGS
