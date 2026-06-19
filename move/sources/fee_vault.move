/// Money-flow authority: 30bps issuance fee / 10% perf share; `FeeAdminCap`-gated.
/// Isolated so fee/authority changes don't touch the note audit core. See spec §3.
/// Multi-currency: per-type `Balance<T>` stored as dynamic field (keyed by TypeName).
module structured_note_factory::fee_vault;

use sui::balance::{Self, Balance};
use sui::coin::{Self, Coin};
use sui::dynamic_field as df;
use std::type_name::{Self, TypeName};

public struct FeeVault has key { id: UID }
public struct FeeAdminCap has key, store { id: UID }

/// dynamic-field key: one Balance<T> per quote-asset type.
public struct BalKey has copy, drop, store { t: TypeName }

fun init(ctx: &mut TxContext) {
    transfer::share_object(FeeVault { id: object::new(ctx) });
    transfer::transfer(FeeAdminCap { id: object::new(ctx) }, ctx.sender());
}

/// Deposit a fee coin into the per-type balance. Event emission is the caller's
/// job (note_id is only known after the note is built — see note_factory).
public(package) fun collect<T>(vault: &mut FeeVault, c: Coin<T>) {
    let k = BalKey { t: type_name::with_defining_ids<T>() };
    if (df::exists_with_type<BalKey, Balance<T>>(&vault.id, k)) {
        let b: &mut Balance<T> = df::borrow_mut(&mut vault.id, k);
        balance::join(b, coin::into_balance(c));
    } else {
        df::add(&mut vault.id, k, coin::into_balance(c));
    };
}

/// Cap-gated withdrawal. Possession of `FeeAdminCap` is the authority.
public fun withdraw<T>(vault: &mut FeeVault, _cap: &FeeAdminCap, amount: u64, ctx: &mut TxContext): Coin<T> {
    let k = BalKey { t: type_name::with_defining_ids<T>() };
    let b: &mut Balance<T> = df::borrow_mut(&mut vault.id, k);
    coin::take(b, amount, ctx)
}

#[test_only]
public fun init_for_testing(ctx: &mut TxContext) { init(ctx) }
