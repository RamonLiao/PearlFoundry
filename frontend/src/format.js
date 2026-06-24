/**
 * shortId — truncate a Sui object id / address to `head…tail`, e.g. "0x1a2b…cd34".
 *
 * Why head…tail (not slice(0,N)): ids normalize to 0x + 64 hex and numerically small
 * ids are left-zero-padded, so a leading slice renders "0x0000000000…" — all zeros, no
 * signal. The tail end is always the meaningful bytes.
 *
 * @param {unknown} id
 * @param {number} [head=6] leading chars to keep (includes the "0x")
 * @param {number} [tail=4] trailing chars to keep
 * @returns {string} truncated id, or '' for null/empty/non-string input
 */
export function shortId(id, head = 6, tail = 4) {
  if (typeof id !== 'string' || id.length === 0) return '';
  if (id.length <= head + tail) return id;
  return `${id.slice(0, head)}…${id.slice(-tail)}`;
}
