import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { estimateCost, priceOf } from '../lib/prices.mjs';
import { collectSummary, prettyModel } from '../lib/summary.mjs';
import { telemetryPayload } from '../lib/telemetry.mjs';
import { collectHistory } from '../lib/collectors/index.mjs';
import { makeHome } from './fixtures.mjs';

const run = promisify(execFile);
const bin = fileURLToPath(new URL('../bin/tokount.mjs', import.meta.url));

/** A stand-in for mycx.dev that records what reaches it. */
async function fakeApi() {
  const hits = [];
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      hits.push({ path: req.url, body: body ? JSON.parse(body) : null });
      res.setHeader('content-type', 'application/json');
      if (req.url.endsWith('/telemetry')) return res.end('{"ok":true}');
      if (body && JSON.parse(body).handle === 'taken') { res.statusCode = 409; return res.end('{"error":"taken"}'); }
      res.end(JSON.stringify({ url: 'https://mycx.dev/tokount/x', claimToken: 'secret-token' }));
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { hits, url: `http://127.0.0.1:${server.address().port}/api/tokount`, close: () => server.close() };
}

async function cli(args, env) {
  try { const out = await run(process.execPath, [bin, ...args], { env: { ...process.env, TOKOUNT_API: '', TOKOUNT_TELEMETRY: '', DO_NOT_TRACK: '', ...env } }); return { code: 0, ...out }; }
  catch (error) { return { code: error.code, stdout: error.stdout, stderr: error.stderr }; }
}

test('prices: exact id, then without its date; unknown models cost $0', () => {
  assert.ok(priceOf('claude-opus-4-5'));
  assert.deepEqual(priceOf('claude-opus-4-5-20251101'), priceOf('claude-opus-4-5'));
  assert.equal(priceOf('codex-auto-review'), null);
  const item = { model: 'nope', inputTokens: 1e6, outputTokens: 1e6, cacheReadTokens: 0, cacheCreationTokens: 0 };
  assert.equal(estimateCost(item), 0);
  const opus = { model: 'claude-opus-4-5', inputTokens: 1e6, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 1e6, cacheWrite1hTokens: 1e6 };
  const price = priceOf('claude-opus-4-5');
  assert.equal(estimateCost(opus), price.input + (price.cacheWrite1h ?? price.cacheWrite));
});

test('model names read like the vendor writes them', () => {
  assert.equal(prettyModel('claude-opus-4-5-20251101'), 'Opus 4.5');
  assert.equal(prettyModel('gpt-5.1-codex'), 'GPT-5.1 Codex');
  assert.equal(prettyModel('gemini-2.5-pro'), 'Gemini 2.5 Pro');
  assert.equal(prettyModel('claude-3-5-sonnet-20241022'), 'Claude 3.5 Sonnet');
});

test('summary carries no paths and no project names', async () => {
  const home = await makeHome();
  const history = await collectHistory({ env: { TOKOUNT_HISTORY_HOME: home } });
  const summary = await collectSummary({ handle: 'tester', history });
  const text = JSON.stringify(summary);
  assert.equal(summary.schemaVersion, 1);
  assert.ok(!text.includes(home) && !text.includes('work-alpha') && !text.includes('0f3a'));
  assert.deepEqual(summary.projects, []);
  assert.equal(summary.totals.totalTokens, summary.agents.reduce((total, agent) => total + agent.tokens, 0));
});

test('telemetry payload is counts only', async () => {
  const home = await makeHome();
  const { reports } = await collectHistory({ env: { TOKOUNT_HISTORY_HOME: home } });
  const payload = telemetryPayload({ command: 'publish', durationMs: 12.4, error: null, reports });
  assert.deepEqual(Object.keys(payload).sort(), ['adapters', 'arch', 'command', 'durationMs', 'error', 'node', 'os', 'version']);
  assert.ok(!JSON.stringify(payload).includes(home));
});

test('--dry-run prints the summary and publishes nothing', async () => {
  const api = await fakeApi();
  const home = await makeHome();
  const { code, stdout } = await cli(['--dry-run'], { TOKOUNT_HISTORY_HOME: home, TOKOUNT_API: api.url, TOKOUNT_TELEMETRY: '0' });
  api.close();
  assert.equal(code, 0);
  assert.match(stdout, /Dry run: nothing was published/);
  assert.equal(api.hits.length, 0);
});

test('publish saves the claim token; telemetry is one counts-only call', async () => {
  const api = await fakeApi();
  const home = await makeHome();
  const config = await mkdtemp(join(tmpdir(), 'tokount-config-'));
  const { code, stdout } = await cli(['--handle', 'tester'], { TOKOUNT_HISTORY_HOME: home, TOKOUNT_API: api.url, HOME: config, USERPROFILE: config });
  api.close();
  assert.equal(code, 0, stdout);
  assert.deepEqual(api.hits.map(hit => hit.path), ['/api/tokount', '/api/tokount/telemetry']);
  assert.equal(api.hits[0].body.handle, 'tester');
  assert.equal(api.hits[1].body.command, 'publish');
  assert.equal(api.hits[1].body.error, null);
  assert.ok(!JSON.stringify(api.hits[1].body).includes(home));
});

test('a taken handle fails clearly with a stable code', async () => {
  const api = await fakeApi();
  const home = await makeHome();
  const config = await mkdtemp(join(tmpdir(), 'tokount-config-'));
  const { code, stderr } = await cli(['--handle', 'taken'], { TOKOUNT_HISTORY_HOME: home, TOKOUNT_API: api.url, HOME: config, USERPROFILE: config });
  api.close();
  assert.equal(code, 1);
  assert.match(stderr, /belongs to someone else/);
  assert.match(stderr, /E_TAKEN/);
  assert.equal(api.hits.at(-1).body.error, 'E_TAKEN');
});

test('no history: a clear error, not a stack trace', async () => {
  const empty = await mkdtemp(join(tmpdir(), 'tokount-empty-'));
  const { code, stderr } = await cli(['--dry-run'], { TOKOUNT_HISTORY_HOME: empty, TOKOUNT_TELEMETRY: '0' });
  assert.equal(code, 1);
  assert.match(stderr, /no Claude Code, Codex or Gemini usage history/);
  assert.doesNotMatch(stderr, /at .*\.mjs/);
});

test('doctor prints counts, never paths', async () => {
  const home = await makeHome();
  const { code, stdout } = await cli(['doctor'], { TOKOUNT_HISTORY_HOME: home, TOKOUNT_TELEMETRY: '0' });
  assert.equal(code, 0);
  assert.match(stdout, /claude\s+found/);
  assert.match(stdout, /zstd: /);
  assert.ok(!stdout.includes(home));
});
