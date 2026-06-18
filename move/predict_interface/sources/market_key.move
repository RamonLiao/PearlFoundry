/// Stub — mirrors predict::market_key ABI. Bodies abort; never deployed.
module predict::market_key;

public struct MarketKey has copy, drop, store {}

public fun new(_oracle_id: ID, _expiry: u64, _strike: u64, _is_up: bool): MarketKey { abort 0 }
public fun up(_oracle_id: ID, _expiry: u64, _strike: u64): MarketKey { abort 0 }
public fun down(_oracle_id: ID, _expiry: u64, _strike: u64): MarketKey { abort 0 }
public fun oracle_id(_k: &MarketKey): ID { abort 0 }
public fun expiry(_k: &MarketKey): u64 { abort 0 }
public fun strike(_k: &MarketKey): u64 { abort 0 }
public fun is_up(_k: &MarketKey): bool { abort 0 }
public fun is_down(_k: &MarketKey): bool { abort 0 }
