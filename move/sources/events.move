/// Unified event structs — single source of truth for the off-chain indexer.
/// See spec §3 (events module: single indexer source).
module structured_note_factory::events;

use sui::event;

public struct NoteMinted has copy, drop {
    note_id: ID,
    strategy: vector<u8>,
    issuer: address,
    manager_id: ID,
    notional: u64,
    expiry_ts_ms: u64,
    walrus_blob_id: vector<u8>,
    is_public: bool,
}

public struct NoteSettled has copy, drop {
    note_id: ID,
    payout: u64,
    perf_fee: u64,
    settled_by: address,
}

public struct PublicNoteRegistered has copy, drop {
    note_id: ID,
    issuer: address,
    template: vector<u8>,
}

public struct FeeCollected has copy, drop {
    note_id: ID,
    kind: u8,        // 0 issuance · 1 perf
    amount: u64,
}

public(package) fun emit_note_minted(
    note_id: ID, strategy: vector<u8>, issuer: address, manager_id: ID,
    notional: u64, expiry_ts_ms: u64, walrus_blob_id: vector<u8>, is_public: bool,
) {
    event::emit(NoteMinted { note_id, strategy, issuer, manager_id, notional, expiry_ts_ms, walrus_blob_id, is_public });
}

public(package) fun emit_note_settled(note_id: ID, payout: u64, perf_fee: u64, settled_by: address) {
    event::emit(NoteSettled { note_id, payout, perf_fee, settled_by });
}

public(package) fun emit_public_note_registered(note_id: ID, issuer: address, template: vector<u8>) {
    event::emit(PublicNoteRegistered { note_id, issuer, template });
}

public(package) fun emit_fee_collected(note_id: ID, kind: u8, amount: u64) {
    event::emit(FeeCollected { note_id, kind, amount });
}
