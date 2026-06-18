/// External API surface: 3 entry fns orchestrating strategy -> manager -> note ->
/// leaderboard -> fee. Holds the `UpgradeCap` flow (note core kept layout-stable).
/// See spec §3 (note_factory) and §12 (deployment).
module structured_note_factory::note_factory;
