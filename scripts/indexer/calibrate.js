// One-shot: verify MoveModule filter returns our real events + inspect parsedJson shapes.
// Run: node calibrate.js   (read-only, no DB writes)
import { SuiClient } from '@mysten/sui/client';
import { PKG, RPC } from '../integration/config.js';
import { classify, normalize } from './events.js';

const client = new SuiClient({ url: RPC });
const page = await client.queryEvents({
  query: { MoveEventModule: { package: PKG, module: 'events' } },
  order: 'ascending', limit: 50,
});
console.log(`fetched ${page.data.length} events, hasNextPage=${page.hasNextPage}`);
for (const ev of page.data) {
  console.log('TYPE', ev.type, '->', classify(ev.type));
  console.log('  parsedJson', JSON.stringify(ev.parsedJson));
  console.log('  normalized', JSON.stringify(normalize(ev)));
}
