#[test_only]
module structured_note_factory::note_factory_fee_tests;

use structured_note_factory::note_factory as nf;

#[test]
fun issuance_fee_30bps() {
    // 1_000_000 * 30 / 10000 = 3000
    assert!(nf::compute_issuance_fee(1_000_000, 30) == 3000, 0);
}

#[test]
fun perf_fee_above_hurdle() {
    // payout=1200, net=1000, hurdle=10000(100%) → threshold=1000, profit=200, 10%=20
    assert!(nf::compute_perf_fee(1200, 1000, 10000) == 20, 0);
}

#[test]
fun perf_fee_at_or_below_hurdle_is_zero() {
    assert!(nf::compute_perf_fee(1000, 1000, 10000) == 0, 0);
    assert!(nf::compute_perf_fee(900, 1000, 10000) == 0, 1);
}
