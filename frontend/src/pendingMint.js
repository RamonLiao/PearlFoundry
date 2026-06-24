// Persist the in-flight mint's manager across page refreshes. PTB1 creates the manager on-chain;
// if the page reloads before PTB2 (mint), the React-only manager id is lost and the empty manager
// is orphaned (no funds lost — notional is only spent in PTB2). We stash {mgr, ts} per address so
// a refresh can offer to resume (re-/quote + re-sign PTB2) instead of re-creating a manager.

const KEY = 'pearlfoundry:pendingMint:v1';

// Keyed by sender so a wallet switch doesn't resurrect another account's pending manager.
export function readPending(address) {
  if (!address) return null;
  try {
    const all = JSON.parse(localStorage.getItem(KEY) || '{}');
    const p = all[address.toLowerCase()];
    return p && p.mgr ? p : null;
  } catch { return null; }
}

export function savePending(address, mgr, expiry) {
  if (!address || !mgr) return;
  try {
    const all = JSON.parse(localStorage.getItem(KEY) || '{}');
    all[address.toLowerCase()] = { mgr, expiry: expiry ?? null, ts: Date.now() };
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch { /* storage unavailable (private mode / quota) — resume just won't be offered */ }
}

export function clearPending(address) {
  if (!address) return;
  try {
    const all = JSON.parse(localStorage.getItem(KEY) || '{}');
    delete all[address.toLowerCase()];
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch { /* ignore */ }
}
