import Database from 'better-sqlite3';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS notes (
  tx_digest TEXT NOT NULL, event_seq TEXT NOT NULL,
  note_id TEXT NOT NULL UNIQUE, strategy TEXT, issuer TEXT, manager_id TEXT,
  notional TEXT, expiry_ts_ms TEXT, walrus_blob_id TEXT, is_public INTEGER, minted_at_ms TEXT,
  PRIMARY KEY (tx_digest, event_seq));
CREATE INDEX IF NOT EXISTS idx_notes_expiry ON notes(expiry_ts_ms);
CREATE TABLE IF NOT EXISTS settlements (
  tx_digest TEXT NOT NULL, event_seq TEXT NOT NULL,
  note_id TEXT NOT NULL UNIQUE, payout TEXT, perf_fee TEXT, settled_by TEXT, settled_at_ms TEXT,
  PRIMARY KEY (tx_digest, event_seq));
CREATE TABLE IF NOT EXISTS fees (
  tx_digest TEXT NOT NULL, event_seq TEXT NOT NULL,
  note_id TEXT NOT NULL, kind INTEGER, amount TEXT,
  PRIMARY KEY (tx_digest, event_seq));
CREATE INDEX IF NOT EXISTS idx_fees_note ON fees(note_id);
CREATE TABLE IF NOT EXISTS public_notes (
  tx_digest TEXT NOT NULL, event_seq TEXT NOT NULL,
  note_id TEXT NOT NULL UNIQUE, issuer TEXT, template TEXT,
  PRIMARY KEY (tx_digest, event_seq));
CREATE TABLE IF NOT EXISTS cursor (
  id INTEGER PRIMARY KEY CHECK (id = 0), tx_digest TEXT, event_seq TEXT, updated_at TEXT);
`;

const COLS = {
  notes: ['tx_digest','event_seq','note_id','strategy','issuer','manager_id','notional','expiry_ts_ms','walrus_blob_id','is_public','minted_at_ms'],
  settlements: ['tx_digest','event_seq','note_id','payout','perf_fee','settled_by','settled_at_ms'],
  fees: ['tx_digest','event_seq','note_id','kind','amount'],
  public_notes: ['tx_digest','event_seq','note_id','issuer','template'],
};

export function openDb(path = ':memory:') {
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.exec(SCHEMA);
  return db;
}

export function getCursor(db) {
  const r = db.prepare('SELECT tx_digest, event_seq FROM cursor WHERE id=0').get();
  return r ?? null;
}

function insertStmt(db, table) {
  const cols = COLS[table];
  const ph = cols.map((c) => `@${c}`).join(', ');
  return db.prepare(`INSERT OR IGNORE INTO ${table} (${cols.join(', ')}) VALUES (${ph})`);
}

export function ingestPage(db, normalized, nextCursor) {
  const txn = db.transaction(() => {
    let inserted = 0;
    for (const { table, row } of normalized) {
      const info = insertStmt(db, table).run(row);
      inserted += info.changes;
    }
    if (nextCursor != null) {
      db.prepare(`INSERT INTO cursor (id, tx_digest, event_seq, updated_at) VALUES (0, @t, @s, @u)
        ON CONFLICT(id) DO UPDATE SET tx_digest=@t, event_seq=@s, updated_at=@u`)
        .run({ t: nextCursor.txDigest, s: nextCursor.eventSeq, u: String(Date.now()) });
    }
    return inserted;
  });
  return txn();
}
