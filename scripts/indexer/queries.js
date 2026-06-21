// Pure read queries. CAST(TEXT AS INTEGER) for aggregation — safe for dUSDC-scale (< 2^63).

export function leaderboard(db) {
  return db.prepare(`
    SELECT n.issuer AS issuer,
           SUM(CAST(s.payout AS INTEGER) - CAST(n.notional AS INTEGER)) AS realized_pnl,
           SUM(CASE WHEN CAST(s.payout AS INTEGER) > CAST(n.notional AS INTEGER) THEN 1 ELSE 0 END) * 1.0
             / COUNT(s.note_id) AS win_rate,
           SUM(CAST(s.perf_fee AS INTEGER)) AS total_perf_fee,
           COUNT(s.note_id) AS note_count
    FROM notes n JOIN settlements s USING(note_id)
    GROUP BY n.issuer
    ORDER BY realized_pnl DESC`).all();
}

export function listNotes(db, { issuer, isPublic } = {}) {
  const where = [];
  const params = {};
  if (issuer != null) { where.push('n.issuer = @issuer'); params.issuer = issuer; }
  if (isPublic != null) { where.push('n.is_public = @isPublic'); params.isPublic = isPublic ? 1 : 0; }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  return db.prepare(`
    SELECT n.*, (s.note_id IS NOT NULL) AS settled
    FROM notes n LEFT JOIN settlements s USING(note_id) ${clause}`).all(params);
}

export function pendingSettle(db, nowMs) {
  return db.prepare(`
    SELECT n.* FROM notes n LEFT JOIN settlements s USING(note_id)
    WHERE s.note_id IS NULL AND CAST(n.expiry_ts_ms AS INTEGER) < @now`).all({ now: Number(nowMs) });
}

export function feeStats(db) {
  const rows = db.prepare('SELECT kind, SUM(CAST(amount AS INTEGER)) AS total FROM fees GROUP BY kind').all();
  const out = { issuance: 0, perf: 0 };
  for (const r of rows) { if (r.kind === 0) out.issuance = r.total; if (r.kind === 1) out.perf = r.total; }
  return out;
}

export function pendingUnnotified(db, nowMs) {
  return db.prepare(`
    SELECT n.* FROM notes n
    LEFT JOIN settlements s USING(note_id)
    LEFT JOIN notified x USING(note_id)
    WHERE s.note_id IS NULL AND x.note_id IS NULL
      AND CAST(n.expiry_ts_ms AS INTEGER) < @now`).all({ now: Number(nowMs) });
}
