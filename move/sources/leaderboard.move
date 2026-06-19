/// Public-note registry — A1: NO on-chain vector / shared object (avoids consensus
/// hotspot + unbounded growth). `register` only emits an event; ranking lives in the
/// off-chain indexer (spec §8). See spec §3 (leaderboard) and D4.
module structured_note_factory::leaderboard;

use structured_note_factory::events;

public(package) fun register(note_id: ID, issuer: address, template: vector<u8>) {
    events::emit_public_note_registered(note_id, issuer, template);
}
