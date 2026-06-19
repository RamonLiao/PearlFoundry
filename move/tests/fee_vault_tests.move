#[test_only]
module structured_note_factory::fee_vault_tests;

use sui::test_scenario as ts;
use sui::coin;
use sui::sui::SUI;
use structured_note_factory::fee_vault::{Self, FeeVault, FeeAdminCap};

#[test]
fun collect_accumulates_and_withdraw_takes() {
    let admin = @0xA;
    let mut sc = ts::begin(admin);
    fee_vault::init_for_testing(sc.ctx());

    sc.next_tx(admin);
    let mut vault = sc.take_shared<FeeVault>();
    let cap = sc.take_from_sender<FeeAdminCap>();

    // 兩次 collect 同幣別 → 累加
    fee_vault::collect(&mut vault, coin::mint_for_testing<SUI>(1000, sc.ctx()));
    fee_vault::collect(&mut vault, coin::mint_for_testing<SUI>(500, sc.ctx()));

    let out = fee_vault::withdraw<SUI>(&mut vault, &cap, 1200, sc.ctx());
    assert!(coin::value(&out) == 1200, 0);
    coin::burn_for_testing(out);

    ts::return_shared(vault);
    sc.return_to_sender(cap);
    sc.end();
}
