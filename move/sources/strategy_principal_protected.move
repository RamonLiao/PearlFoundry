/// Principal Protected template: leg composition + payoff/settlement math.
/// Provides witness `PrincipalProtected`; uses `predict::supply` / PLP for floor yield.
/// Conservative floor-yield premium budget at mint (review F5). See spec §3, §4, §5.
module structured_note_factory::strategy_principal_protected;
