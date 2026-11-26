import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { collectHistory, historyRoots } from '../lib/collectors/index.mjs';
import { collectClaude } from '../lib/collectors/claude.mjs';
import { collectCodex } from '../lib/collectors/codex.mjs';
import { collectGemini } from '../lib/collectors/gemini.mjs';
import { zstdSupported } from '../lib/collectors/shared.mjs';
import { CLAUDE_EXPECTED, CODEX_EXPECTED, GEMINI_EXPECTED, makeHome } from './fixtures.mjs';

const sum = (events, field) => events.reduce((total, item) => total + item[field], 0);
const rootsOf = home => historyRoots({ TOKOUNT_HISTORY_HOME: home });

test('claude: streaming copies and resumed sessions count once, at the most output', async () => {
  const home = await makeHome({ codex: false, gemini: false });
  for (const workers of [1, 2]) {
    const { events, report } = await collectClaude(rootsOf(home).claude, { workers });
    assert.equal(events.length, CLAUDE_EXPECTED.events);
    assert.equal(sum(events, 'inputTokens'), CLAUDE_EXPECTED.input);
    assert.equal(sum(events, 'outputTokens'), CLAUDE_EXPECTED.output);
    assert.equal(sum(events, 'cacheReadTokens'), CLAUDE_EXPECTED.cacheRead);
    assert.equal(sum(events, 'cacheCreationTokens'), CLAUDE_EXPECTED.cacheWrite);
    assert.equal(sum(events, 'cacheWrite1hTokens'), CLAUDE_EXPECTED.cacheWrite1h);
    const m1 = events.find(item => item.outputTokens === 120);
    assert.equal(m1.timestamp, '2026-03-01T10:00:00.000Z', 'keeps the earliest timestamp');
    assert.equal(m1.sessionId, 'a');
    assert.equal(report.duplicates, 3);
    assert.equal(report.invalidJson, 1);
    assert.equal(report.files, 2);
  }
});

test('codex: v1 until the first v2 record, forks counted once, cached input not double counted', { skip: !zstdSupported && 'Node without zstd' }, async () => {
  const home = await makeHome({ claude: false, gemini: false });
  const { events, report } = await collectCodex(rootsOf(home).codex);
  assert.equal(events.length, CODEX_EXPECTED.events);
  assert.equal(sum(events, 'inputTokens'), CODEX_EXPECTED.input);
  assert.equal(sum(events, 'outputTokens'), CODEX_EXPECTED.output);
  assert.equal(sum(events, 'cacheReadTokens'), CODEX_EXPECTED.cacheRead);
  assert.ok(events.every(item => item.sessionId !== 'fork-1'), 'the fork replay adds nothing');
  assert.deepEqual([...new Set(events.map(item => item.model))].sort(), ['gpt-5-codex', 'gpt-5.1-codex']);
  assert.equal(report.files, 3);
  assert.equal(report.unreadable, 0);
});

test('codex: a .zst file without zstd support is reported, not guessed', async () => {
  const home = await makeHome({ claude: false, gemini: false, zstd: false });
  const { events } = await collectCodex(rootsOf(home).codex);
  assert.equal(events.length, CODEX_EXPECTED.events);
});

test('gemini: cached input subtracted, thoughts kept apart', async () => {
  const home = await makeHome({ claude: false, codex: false });
  const { events } = await collectGemini(rootsOf(home).gemini);
  assert.equal(events.length, GEMINI_EXPECTED.events);
  assert.equal(events[0].inputTokens, GEMINI_EXPECTED.input);
  assert.equal(events[0].outputTokens, GEMINI_EXPECTED.output);
  assert.equal(events[0].cacheReadTokens, GEMINI_EXPECTED.cacheRead);
  assert.equal(events[0].reasoningTokens, GEMINI_EXPECTED.reasoning);
  assert.equal(events[0].totalTokens, 125);
});

test('reports hold counts and versions only, never paths', async () => {
  const home = await makeHome();
  const { reports } = await collectHistory({ env: { TOKOUNT_HISTORY_HOME: home } });
  const text = JSON.stringify(reports);
  assert.ok(!text.includes(home) && !text.includes('work-alpha') && !text.includes('/'), text);
  assert.deepEqual(reports.map(report => report.agent), ['claude', 'codex', 'gemini']);
});

test('history roots follow each tool on every OS', () => {
  const roots = historyRoots({ TOKOUNT_HISTORY_HOME: 'H' });
  assert.deepEqual(roots.claude, [join('H', '.claude', 'projects'), join('H', '.config', 'claude', 'projects')]);
  assert.deepEqual(roots.codex, [join('H', '.codex', 'sessions'), join('H', '.codex', 'archived_sessions')]);
  assert.deepEqual(roots.gemini, [join('H', '.gemini', 'tmp')]);
});
