/// Stub — mirrors predict::predict ABI. Bodies abort; never deployed.
///
/// `Predict` is the global shared protocol object. mint/mint_range/redeem are
/// owner-gated against the PredictManager owner; redeem_permissionless has no
/// owner check (only requires the oracle to be settled). The type parameter T
/// is the quote asset (e.g. DUSDC); it is used internally and unconstrained.
#[allow(unused_type_parameter)]
module predict::predict;

use sui::clock::Clock;
use predict::predict_manager::PredictManager;
use predict::oracle::OracleSVI;
use predict::market_key::MarketKey;
use predict::range_key::RangeKey;

public struct Predict has key { id: UID }

public fun create_manager(_ctx: &mut TxContext): ID { abort 0 }

public fun mint<T>(
    _p: &mut Predict,
    _mgr: &mut PredictManager,
    _oracle: &OracleSVI,
    _key: MarketKey,
    _amount: u64,
    _clock: &Clock,
    _ctx: &mut TxContext,
) { abort 0 }

public fun mint_range<T>(
    _p: &mut Predict,
    _mgr: &mut PredictManager,
    _oracle: &OracleSVI,
    _key: RangeKey,
    _amount: u64,
    _clock: &Clock,
    _ctx: &mut TxContext,
) { abort 0 }

public fun redeem<T>(
    _p: &mut Predict,
    _mgr: &mut PredictManager,
    _oracle: &OracleSVI,
    _key: MarketKey,
    _amount: u64,
    _clock: &Clock,
    _ctx: &mut TxContext,
) { abort 0 }

public fun redeem_permissionless<T>(
    _p: &mut Predict,
    _mgr: &mut PredictManager,
    _oracle: &OracleSVI,
    _key: MarketKey,
    _amount: u64,
    _clock: &Clock,
    _ctx: &mut TxContext,
) { abort 0 }

public fun redeem_range<T>(
    _p: &mut Predict,
    _mgr: &mut PredictManager,
    _oracle: &OracleSVI,
    _key: RangeKey,
    _amount: u64,
    _clock: &Clock,
    _ctx: &mut TxContext,
) { abort 0 }
