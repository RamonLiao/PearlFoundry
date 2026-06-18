/// Money-flow authority: 30bps issuance fee / 10% perf share; `FeeAdminCap`-gated.
/// Isolated so fee/authority changes don't touch the note audit core. See spec §3.
module structured_note_factory::fee_vault;
