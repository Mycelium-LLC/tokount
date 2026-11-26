import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as zlib from 'node:zlib';

/**
 * Synthetic history homes. Every record is made up; shapes follow what each agent writes.
 * Expected totals are next to each fixture, so a test reads as: this history → these counts.
 */
const lines = records => records.map(record => JSON.stringify(record)).join('\n') + '\n';
const put = async (home, path, content) => { const full = join(home, path); await mkdir(join(full, '..'), { recursive: true }); await writeFile(full, content); };

const claudeAssistant = (id, requestId, timestamp, sessionId, usage, model = 'claude-opus-4-5-20251101') => ({
  type: 'assistant', timestamp, sessionId, requestId, uuid: `${id}-${timestamp}`,
  message: { id, model, role: 'assistant', content: [{ type: 'text', text: 'a reply that says "usage" on purpose' }], usage }
});

/** Claude: m1 streams three times (output 10 → 50 → 120) and is repeated by a resumed session. */
export const CLAUDE_EXPECTED = { events: 2, input: 105, output: 127, cacheRead: 1000, cacheWrite: 200, cacheWrite1h: 200 };
export async function claudeHome(home) {
  const m1 = output => ({ input_tokens: 100, output_tokens: output, cache_read_input_tokens: 1000, cache_creation_input_tokens: 200, cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 200 } });
  await put(home, '.claude/projects/-work-alpha/session-a.jsonl', lines([
    { type: 'user', timestamp: '2026-03-01T09:59:00.000Z', sessionId: 'a', message: { role: 'user', content: 'what is my "usage" from the assistant?' } },
    claudeAssistant('msg_1', 'req_1', '2026-03-01T10:00:00.000Z', 'a', m1(10)),
    claudeAssistant('msg_1', 'req_1', '2026-03-01T10:00:01.000Z', 'a', m1(50)),
    claudeAssistant('msg_1', 'req_1', '2026-03-01T10:00:02.000Z', 'a', m1(120)),
    claudeAssistant('msg_2', 'req_2', '2026-03-01T11:00:00.000Z', 'a', { input_tokens: 5, output_tokens: 7, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }),
    claudeAssistant('msg_s', 'req_s', '2026-03-01T11:01:00.000Z', 'a', { input_tokens: 9, output_tokens: 9 }, '<synthetic>'),
    '{ not json "usage" "assistant"'
  ]).replace('"{ not json \\"usage\\" \\"assistant\\""', '{ not json "usage" "assistant"'));
  await put(home, '.claude/projects/-work-alpha/session-b.jsonl', lines([
    claudeAssistant('msg_1', 'req_1', '2026-03-02T08:00:00.000Z', 'b', m1(120))
  ]));
}

/**
 * Codex: a session that switched from v1 to v2 midway, a .zst rollout, and a fork in
 * archived_sessions that replays its parent's records with new timestamps.
 */
export const CODEX_EXPECTED = { events: 4, input: 60 + 30 + 200 + 9, output: 20 + 10 + 30 + 3, cacheRead: 40 + 20 + 800 + 1 };
const v1 = (timestamp, last, total) => ({ timestamp, type: 'event_msg', payload: { type: 'token_count', info: { last_token_usage: last, total_token_usage: total } } });
const usage = (input, cached, output) => ({ input_tokens: input, cached_input_tokens: cached, output_tokens: output, total_tokens: input + output });
export async function codexHome(home, { zstd = true } = {}) {
  const parent = [
    { timestamp: '2026-04-01T10:00:00.000Z', type: 'session_meta', payload: { id: 'parent-1' } },
    { timestamp: '2026-04-01T10:00:00.000Z', type: 'turn_context', payload: { turn_id: 't1', model: 'gpt-5-codex' } },
    v1('2026-04-01T10:01:00.000Z', usage(100, 40, 20), usage(100, 40, 20)),
    v1('2026-04-01T10:01:01.000Z', usage(100, 40, 20), usage(100, 40, 20)),
    v1('2026-04-01T10:02:00.000Z', usage(50, 20, 10), usage(150, 60, 30)),
    { timestamp: '2026-04-01T10:03:00.000Z', type: 'token_usage_record', payload: { response_id: 'resp_1', turn_id: 't1', usage: usage(1000, 800, 30) } },
    v1('2026-04-01T10:03:00.000Z', usage(1000, 800, 30), usage(1150, 860, 60))
  ];
  await put(home, '.codex/sessions/2026/04/01/rollout-2026-04-01T10-00-00-parent-1.jsonl', lines(parent));
  await put(home, '.codex/archived_sessions/rollout-2026-04-09T10-00-00-fork-1.jsonl', lines([
    { timestamp: '2026-04-09T10:00:00.000Z', type: 'session_meta', payload: { id: 'fork-1', forked_from_id: 'parent-1' } },
    ...parent.slice(1).map(record => ({ ...record, timestamp: '2026-04-09T10:00:01.000Z' }))
  ]));
  const compressed = lines([
    { timestamp: '2026-05-01T10:00:00.000Z', type: 'session_meta', payload: { id: 'zst-1' } },
    { timestamp: '2026-05-01T10:00:00.000Z', type: 'turn_context', payload: { turn_id: 't9', model: 'gpt-5.1-codex' } },
    { timestamp: '2026-05-01T10:01:00.000Z', type: 'token_usage_record', payload: { response_id: 'resp_9', turn_id: 't9', usage: usage(10, 1, 3) } }
  ]);
  if (zstd) await put(home, '.codex/sessions/2026/05/01/rollout-2026-05-01T10-00-00-zst-1.jsonl.zst', zlib.zstdCompressSync(Buffer.from(compressed)));
  else await put(home, '.codex/sessions/2026/05/01/rollout-2026-05-01T10-00-00-zst-1.jsonl', compressed);
}

/** Gemini: input includes cached; thoughts are billed as output and counted apart. */
export const GEMINI_EXPECTED = { events: 1, input: 60, output: 20, cacheRead: 40, reasoning: 5 };
export async function geminiHome(home) {
  await put(home, '.gemini/tmp/0f3a/chats/session-2026-06-01.json', JSON.stringify({
    sessionId: 'g-1',
    messages: [
      { type: 'user', timestamp: '2026-06-01T09:00:00.000Z', content: 'hello' },
      { type: 'gemini', timestamp: '2026-06-01T09:00:05.000Z', model: 'gemini-2.5-pro', tokens: { input: 100, output: 20, cached: 40, thoughts: 5, tool: 0, total: 125 } }
    ]
  }));
}

export async function makeHome({ claude = true, codex = true, gemini = true, zstd = true } = {}) {
  const home = await mkdtemp(join(tmpdir(), 'tokount-home-'));
  if (claude) await claudeHome(home);
  if (codex) await codexHome(home, { zstd });
  if (gemini) await geminiHome(home);
  return home;
}
