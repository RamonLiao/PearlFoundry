/// Stub — mirrors predict::range_key ABI. Bodies abort; never deployed.
module predict::range_key;

public struct RangeKey has copy, drop, store {}

public fun new(_oracle_id: ID, _expiry: u64, _lower_strike: u64, _higher_strike: u64): RangeKey { abort 0 }
public fun oracle_id(_k: &RangeKey): ID { abort 0 }
public fun expiry(_k: &RangeKey): u64 { abort 0 }
public fun lower_strike(_k: &RangeKey): u64 { abort 0 }
public fun higher_strike(_k: &RangeKey): u64 { abort 0 }
