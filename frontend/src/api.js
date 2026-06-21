import { API } from './config.js';

export async function postTx(path, body) {
  const r = await fetch(`${API}${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  const j = await r.json();
  if (!r.ok) { const e = new Error(j.error || 'request failed'); e.code = j.code; e.detail = j.detail; throw e; }
  return j;
}

export async function getNotes(issuer) {
  const r = await fetch(`${API}/notes?issuer=${issuer}`);
  if (!r.ok) throw new Error('failed to load notes');
  return r.json();
}
