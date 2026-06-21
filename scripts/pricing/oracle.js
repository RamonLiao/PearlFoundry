// Forward source: resolve the live ephemeral OracleSVI by (asset, expiry), read its
// forward, and provide an order-of-magnitude sanity band from recent PositionMinted.
export const PREDICT_PKG = '0xf5ea2b3749c65d6e56507cc35388719aadb28f9cab873696a2f8687f5c785138';

// Enumerate registry::OracleCreated, match (asset, expiry). The event carries oracle_id,
// expiry, underlying_asset, min_strike, tick_size — IDs are ephemeral (~15-min rolling),
// so we always resolve live and never hardcode. Returns the matched event's fields.
export async function resolveOracle(client, asset, expiry) {
  const want = BigInt(expiry);
  const seen = [];
  let cursor = null;
  for (let page = 0; page < 10; page++) {
    const r = await client.queryEvents({
      query: { MoveEventModule: { package: PREDICT_PKG, module: 'registry' } },
      limit: 50, order: 'descending', cursor,
    });
    for (const e of r.data) {
      const j = e.parsedJson;
      if (j.underlying_asset !== asset) continue;
      if (BigInt(j.expiry) === want) {
        return { oracleId: j.oracle_id, tickSize: BigInt(j.tick_size), minStrike: BigInt(j.min_strike) };
      }
      seen.push(j.expiry);
    }
    if (!r.hasNextPage) break;
    cursor = r.nextCursor;
  }
  throw new Error(`no oracle for asset=${asset} expiry=${expiry}; recent expiries=${[...new Set(seen)].slice(0, 8).join(',')}`);
}

// tick_size/min_strike are NOT on the oracle object content — pass them via meta from
// resolveOracle. Throws if the oracle already settled (settlement_price != null).
export async function fetchOracle(client, oracleId, meta = {}) {
  const r = await client.getObject({ id: oracleId, options: { showContent: true } });
  const f = r.data?.content?.fields;
  if (!f) throw new Error(`oracle ${oracleId} has no content`);
  if (f.settlement_price != null) throw new Error(`oracle ${oracleId} already settled (price=${f.settlement_price})`);
  const prices = f.prices.fields;
  const forward = BigInt(prices.forward);
  // Freshly-created oracles roll in with forward=0 until first priced — minting against
  // them would derive a nonsensical ladder, so reject loudly rather than silently degrade.
  if (forward === 0n) throw new Error(`oracle ${oracleId} not yet priced (forward=0)`);
  return {
    forward,
    spot: BigInt(prices.spot),
    tickSize: meta.tickSize ?? 1_000_000_000n,
    minStrike: meta.minStrike ?? 50_000_000_000_000n,
    expiry: BigInt(f.expiry),
    timestamp: BigInt(f.timestamp),
    settled: false,
  };
}

// Enumerate registry::OracleCreated, collect future BTC expiries in ascending order,
// return the smallest one past (nowMs + minBufferMs) whose oracle is currently priced.
export async function pickLiveExpiry(client, asset, { nowMs, minBufferMs = 20 * 60 * 1000 } = {}) {
  const now = nowMs ?? Date.now();
  const cutoff = BigInt(now + minBufferMs);

  // Collect candidate expiries (deduplicated) from descending event stream
  const byExpiry = new Map(); // expiry(string) -> { oracleId, tickSize, minStrike }
  let cursor = null;
  for (let page = 0; page < 10; page++) {
    const r = await client.queryEvents({
      query: { MoveEventModule: { package: PREDICT_PKG, module: 'registry' } },
      limit: 50, order: 'descending', cursor,
    });
    for (const e of r.data) {
      const j = e.parsedJson;
      if (j.underlying_asset !== asset) continue;
      if (BigInt(j.expiry) <= cutoff) continue;
      if (!byExpiry.has(j.expiry)) {
        byExpiry.set(j.expiry, { oracleId: j.oracle_id, tickSize: BigInt(j.tick_size), minStrike: BigInt(j.min_strike) });
      }
    }
    if (!r.hasNextPage) break;
    cursor = r.nextCursor;
  }

  // Sort ascending (nearest first)
  const candidates = [...byExpiry.entries()].sort((a, b) => (BigInt(a[0]) < BigInt(b[0]) ? -1 : 1));
  for (const [expiry, { oracleId, tickSize, minStrike }] of candidates) {
    try {
      await fetchOracle(client, oracleId, { tickSize, minStrike });
      return expiry;
    } catch {
      // unpriced or settled — try next
    }
  }
  throw new Error(`no live priced ${asset} expiry found (checked ${candidates.length} candidates)`);
}

// Order-of-magnitude sanity only — PositionMinted is Predict-global (other strategies'
// strikes, including far-OTM). Never authoritative; dry-run probing is.
export async function sanityBand(client, asset) {
  const r = await client.queryEvents({
    query: { MoveEventModule: { package: PREDICT_PKG, module: 'predict' } },
    limit: 50, order: 'descending',
  }).catch(() => ({ data: [] }));
  const strikes = r.data
    .filter(e => e.type.endsWith('::PositionMinted') && e.parsedJson?.strike)
    .map(e => BigInt(e.parsedJson.strike));
  if (!strikes.length) return null;
  return {
    minSeen: strikes.reduce((a, b) => (a < b ? a : b)),
    maxSeen: strikes.reduce((a, b) => (a > b ? a : b)),
  };
}
