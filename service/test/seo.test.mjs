import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.mjs';

const memory = () => { const values = new Map(); return { async get(k) { return values.get(k) || null; }, async set(k, v) { values.set(k, v); } }; };
const summary = handle => ({ schemaVersion: 1, handle, generated: '2026-11-26T10:00:00.000Z', first: '2026-01-01', last: '2026-11-26', activeDays: 40, totals: { totalTokens: 1.5e9, totalCost: 812 }, models: [{ name: 'Opus 4.5' }], streak: { days: 9 } });

async function serve() {
  const app = await createApp({ store: memory(), now: () => Date.parse('2026-11-26T12:00:00Z') });
  const server = app.listen(0);
  return { base: `http://127.0.0.1:${server.address().port}`, close: () => server.close() };
}

test('landing: canonical, Open Graph, Twitter, JSON-LD and an indexable robots tag', async () => {
  const { base, close } = await serve();
  const html = await (await fetch(`${base}/tokount/`)).text();
  assert.match(html, /<link rel="canonical" href="https:\/\/mycx\.dev\/tokount\/">/);
  assert.match(html, /property="og:image" content="https:\/\/mycx\.dev\/tokount\/og\.png"/);
  assert.match(html, /name="twitter:card" content="summary_large_image"/);
  assert.match(html, /"@type":"SoftwareApplication"/);
  JSON.parse(html.match(/<script type="application\/ld\+json">(.*?)<\/script>/)[1]);
  assert.match(html, /content="index, follow"/);
  const image = await fetch(`${base}/tokount/og.png`);
  assert.equal(image.headers.get('content-type'), 'image/png');
  const bytes = Buffer.from(await image.arrayBuffer());
  assert.equal(bytes.readUInt32BE(16), 1200);
  assert.equal(bytes.readUInt32BE(20), 630);
  close();
});

test('a story page is noindex with its own share image; a missing one is noindex too', async () => {
  const { base, close } = await serve();
  const claim = await fetch(`${base}/api/tokount`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ handle: 'ada', summary: summary('ada') }) });
  assert.equal(claim.status, 200);
  const html = await (await fetch(`${base}/tokount/ada`)).text();
  assert.match(html, /<meta name="robots" content="noindex, follow">/);
  assert.match(html, /property="og:image" content="https:\/\/mycx\.dev\/tokount\/ada\/og\.png/);
  assert.match(html, /<title>@ada’s tokount: 1\.5B tokens<\/title>/);
  const image = await fetch(`${base}/tokount/ada/og.png`);
  assert.equal(image.status, 200);
  assert.equal(image.headers.get('content-type'), 'image/png');
  const missing = await fetch(`${base}/tokount/nobody`);
  assert.equal(missing.status, 404);
  assert.match(await missing.text(), /content="noindex"/);
  assert.equal((await fetch(`${base}/tokount/nobody/og.png`)).status, 404);
  close();
});

test('health, version and telemetry', async () => {
  const { base, close } = await serve();
  for (const path of ['/api/health', '/api/tokount/health']) {
    const body = await (await fetch(base + path)).json();
    assert.equal(body.app, 'tokount');
    assert.match(body.version, /^\d+\.\d+\.\d+$/);
  }
  const version = await fetch(`${base}/tokount/version.json`);
  assert.match(version.headers.get('content-type'), /json/);
  const ok = await fetch(`${base}/api/tokount/telemetry`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ version: '0.1.0', os: 'win32', arch: 'x64', node: 22, command: 'publish', durationMs: 900, error: null, adapters: [{ agent: 'claude', schema: 'claude-assistant-usage-v2', found: true, files: 3, records: 10, accepted: 4, path: '/Users/x' }] }) });
  assert.equal(ok.status, 204);
  const bad = await fetch(`${base}/api/tokount/telemetry`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ command: 'rm -rf', version: '0.1.0' }) });
  assert.equal(bad.status, 400);
  close();
});
