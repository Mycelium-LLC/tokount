import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.mjs';

function memoryStore() {
  const values = new Map();
  return { values, async get(k) { return values.get(k) || null; }, async set(k, v) { values.set(k, v); } };
}
const summary = handle => ({ schemaVersion: 1, handle, totals: { totalTokens: 1 }, models: [] });

test('claim, protect, update and expire a handle', async () => {
  const store = memoryStore(); let clock = Date.parse('2026-11-22T12:00:00Z');
  const app = await createApp({ store, now: () => clock });
  const server = app.listen(0); const base = `http://127.0.0.1:${server.address().port}`;
  const claim = await fetch(`${base}/api/tokount`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ handle: 'niko', summary: summary('niko') }) });
  assert.equal(claim.status, 200); const first = await claim.json(); assert.ok(first.claimToken);
  const overwrite = await fetch(`${base}/api/tokount`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ handle: 'niko', summary: summary('niko') }) });
  assert.equal(overwrite.status, 409);
  const update = await fetch(`${base}/api/tokount`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ handle: 'niko', summary: summary('niko'), claimToken: first.claimToken }) });
  assert.equal(update.status, 200);
  clock += 31 * 86_400_000;
  assert.equal((await fetch(`${base}/tokount/niko`)).status, 410);
  const reclaim = await fetch(`${base}/api/tokount`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ handle: 'niko', summary: summary('niko') }) });
  assert.equal(reclaim.status, 409);
  server.close();
});
