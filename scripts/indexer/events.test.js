import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bytesToHex, classify, normalize } from './events.js';

const PKG = '0xa69904d3bafe89a197da763f3c5c7ca39522aa3d81974b3910ad5c261bdcb21a';

test('bytesToHex encodes number[] as hex', () => {
  assert.equal(bytesToHex([115, 116]), '7374');
  assert.equal(bytesToHex([]), '');
  assert.equal(bytesToHex([0, 255]), '00ff');
});

test('classify maps event type suffix to table', () => {
  assert.equal(classify(`${PKG}::events::NoteMinted`), 'notes');
  assert.equal(classify(`${PKG}::events::NoteSettled`), 'settlements');
  assert.equal(classify(`${PKG}::events::FeeCollected`), 'fees');
  assert.equal(classify(`${PKG}::events::PublicNoteRegistered`), 'public_notes');
  assert.equal(classify(`${PKG}::other::Thing`), null);
});

test('normalize NoteMinted keeps u64 as string, bytes as hex', () => {
  const ev = {
    id: { txDigest: 'ABC', eventSeq: '0' },
    type: `${PKG}::events::NoteMinted`,
    timestampMs: '1700000000000',
    parsedJson: {
      note_id: '0xnote', strategy: [114, 97], issuer: '0xiss', manager_id: '0xmgr',
      notional: '9223372036854775808', // > MAX_SAFE_INTEGER
      expiry_ts_ms: '1800000000000',
      walrus_blob_id: [1, 2, 3], is_public: true,
    },
  };
  const { table, row } = normalize(ev);
  assert.equal(table, 'notes');
  assert.equal(row.tx_digest, 'ABC');
  assert.equal(row.event_seq, '0');
  assert.equal(row.notional, '9223372036854775808'); // still a string, no precision loss
  assert.equal(typeof row.notional, 'string');
  assert.equal(row.strategy, '7261');
  assert.equal(row.walrus_blob_id, '010203');
  assert.equal(row.is_public, 1);
  assert.equal(row.minted_at_ms, '1700000000000');
});

test('normalize returns null for unknown event type', () => {
  assert.equal(normalize({ id: { txDigest: 'X', eventSeq: '0' }, type: `${PKG}::x::Y`, parsedJson: {} }), null);
});
