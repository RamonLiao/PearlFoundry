// Pure normalizers — single source of truth for the SuiEvent → DB row mapping.
// u64/u128 stay strings (parsedJson returns them as strings; JS number overflows).
// vector<u8> stored as hex (raw); decode deferred to serve layer.

export function bytesToHex(arr) {
  return arr.map((b) => b.toString(16).padStart(2, '0')).join('');
}

const SUFFIX_TABLE = {
  NoteMinted: 'notes',
  NoteSettled: 'settlements',
  FeeCollected: 'fees',
  PublicNoteRegistered: 'public_notes',
};

export function classify(type) {
  const name = type.split('::').pop();
  if (type.split('::')[1] !== 'events') return null;
  return SUFFIX_TABLE[name] ?? null;
}

export function normalize(ev) {
  const table = classify(ev.type);
  if (!table) return null;
  const j = ev.parsedJson;
  const base = { tx_digest: ev.id.txDigest, event_seq: ev.id.eventSeq, note_id: j.note_id };
  const ts = ev.timestampMs ?? null;
  switch (table) {
    case 'notes':
      return { table, row: { ...base,
        strategy: bytesToHex(j.strategy), issuer: j.issuer, manager_id: j.manager_id,
        notional: j.notional, expiry_ts_ms: j.expiry_ts_ms,
        walrus_blob_id: bytesToHex(j.walrus_blob_id), is_public: j.is_public ? 1 : 0,
        minted_at_ms: ts } };
    case 'settlements':
      return { table, row: { ...base,
        payout: j.payout, perf_fee: j.perf_fee, settled_by: j.settled_by, settled_at_ms: ts } };
    case 'fees':
      return { table, row: { ...base, kind: j.kind, amount: j.amount } };
    case 'public_notes':
      return { table, row: { ...base, issuer: j.issuer, template: bytesToHex(j.template) } };
  }
}
