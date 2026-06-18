/// Stub — mirrors predict::predict_manager ABI. Bodies abort; never deployed.
///
/// PredictManager is a SHARED object (created via predict::create_manager,
/// shared in predict_manager::new). `owner` is fixed to the creating sender.
/// deposit/withdraw/balance are generic over the quote asset T (e.g. DUSDC);
/// withdraw is owner-gated (assert sender == owner).
#[allow(unused_type_parameter)]
module predict::predict_manager;

use sui::coin::Coin;
use predict::market_key::MarketKey;
use predict::range_key::RangeKey;

public struct PredictManager has key { id: UID }

public fun deposit<T>(_mgr: &mut PredictManager, _coin: Coin<T>, _ctx: &TxContext) { abort 0 }
public fun withdraw<T>(_mgr: &mut PredictManager, _amount: u64, _ctx: &mut TxContext): Coin<T> { abort 0 }
public fun balance<T>(_mgr: &PredictManager): u64 { abort 0 }
public fun position(_mgr: &PredictManager, _key: MarketKey): u64 { abort 0 }
public fun range_position(_mgr: &PredictManager, _key: RangeKey): u64 { abort 0 }
public fun owner(_mgr: &PredictManager): address { abort 0 }
