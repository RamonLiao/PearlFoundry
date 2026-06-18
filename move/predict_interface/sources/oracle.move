/// Stub — mirrors predict::oracle ABI (read surface only). Bodies abort.
/// One OracleSVI shared object exists per (underlying, expiry) on chain.
module predict::oracle;

use sui::clock::Clock;

public struct OracleSVI has key { id: UID }

public fun id(_o: &OracleSVI): ID { abort 0 }
public fun expiry(_o: &OracleSVI): u64 { abort 0 }
public fun is_active(_o: &OracleSVI): bool { abort 0 }
public fun is_settled(_o: &OracleSVI): bool { abort 0 }
public fun status(_o: &OracleSVI, _clock: &Clock): u8 { abort 0 }
public fun status_settled(): u8 { abort 0 }
public fun status_active(): u8 { abort 0 }
public fun status_pending_settlement(): u8 { abort 0 }
public fun status_inactive(): u8 { abort 0 }
public fun settlement_price(_o: &OracleSVI): Option<u64> { abort 0 }
public fun forward_price(_o: &OracleSVI): u64 { abort 0 }
public fun spot_price(_o: &OracleSVI): u64 { abort 0 }
