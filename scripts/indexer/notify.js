// Notify a holder that an owned soulbound note has matured. Log is the durable record
// (emitted first); the webhook is a best-effort side-channel that can never throw or block.
export async function notifyMatured({ note, webhookUrl, fetch = globalThis.fetch, log = console.log }) {
  const payload = {
    noteId: note.note_id,
    owner: note.issuer, // schema has no `owner`; soulbound mint-to-self → owner == issuer
    expiry_ts_ms: note.expiry_ts_ms,
    strategy: note.strategy,
    notional: note.notional,
  };
  log(`[keeper] matured note=${payload.noteId} owner=${payload.owner} expiry=${payload.expiry_ts_ms} notional=${payload.notional}`);
  if (!webhookUrl) return;
  try {
    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload), // chain-derived, untrusted by downstream; body only, never the URL
      signal: AbortSignal.timeout(3000), // webhook-local, distinct from the loop signal
    });
  } catch (e) {
    log(`[keeper] webhook POST failed for note=${payload.noteId}: ${e.message}`);
  }
}
