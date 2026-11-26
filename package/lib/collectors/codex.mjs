import { diagnostic, event, readRecords, listFiles, toSessions, validTimestamp } from './shared.mjs';

/**
 * Codex writes rollouts to <CODEX_HOME>/sessions/YYYY/MM/DD/rollout-*.jsonl, compresses older
 * ones to .jsonl.zst, and moves some to <CODEX_HOME>/archived_sessions.
 *
 * Two formats carry usage:
 *  - v2: `token_usage_record` with a response_id, one per model response. Preferred.
 *  - v1: `event_msg` / `token_count` with last_token_usage. Used until a file's first v2
 *        record; a repeat (same cumulative total) is a re-emit, not new usage.
 * OpenAI's input_tokens includes the cached tokens, so fresh input is input - cached.
 * A forked thread copies its parent's records into its own file with new timestamps (a fork
 * made on 14 Aug replays months of usage within a second). So every usage record gets a key,
 * the response id (v2) or the cumulative thread total it reports (v1), and a key counts once,
 * at its earliest timestamp, whatever file it was read from.
 */
export const CODEX_SCHEMA = 'codex-rollout-usage-v2';

const usageLine = { any: ['token_usage_record', 'token_count', 'turn_context', 'session_meta'] };

export async function collectCodex(roots) {
  const started = Date.now();
  const report = diagnostic('codex', CODEX_SCHEMA);
  report.roots = roots.length;
  const files = await listFiles(roots, name => name.startsWith('rollout-') && (name.endsWith('.jsonl') || name.endsWith('.jsonl.zst')));
  report.files = files.length;
  report.found = files.length > 0;
  const earliest = new Map();

  for (const path of files) {
    const records = await readRecords(path, report, usageLine);
    let sessionId = path.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/)?.[1] || 'unknown';
    const turnModels = new Map();
    for (const record of records) {
      if (record?.type === 'session_meta') sessionId = String(record.payload?.id || record.payload?.session_id || sessionId);
      if (record?.type === 'turn_context' && record.payload?.turn_id && record.payload?.model) turnModels.set(record.payload.turn_id, record.payload.model);
    }
    // A session that outlived a Codex upgrade switches from v1 to v2 midway: v1 counts until
    // the first v2 record, and from there v2 alone (both are written for the same responses).
    const firstV2 = records.find(record => record?.type === 'token_usage_record')?.timestamp ?? null;
    let model = 'codex-unknown';
    let lastTotal = null;

    for (const record of records) {
      if (record?.type === 'turn_context') { if (record.payload?.model) model = record.payload.model; continue; }
      if (record?.type === 'session_meta') continue;
      let usage, key, turnModel = model;
      if (record?.type === 'token_usage_record') {
        usage = record.payload?.usage;
        key = record.payload?.response_id ? `v2:${record.payload.response_id}` : null;
        turnModel = turnModels.get(record.payload?.turn_id) || model;
      } else if (record?.type === 'event_msg' && record.payload?.type === 'token_count') {
        if (firstV2 && String(record.timestamp) >= firstV2) { report.duplicates++; continue; }
        const info = record.payload?.info;
        usage = info?.last_token_usage;
        const total = info?.total_token_usage?.total_tokens;
        if (total != null && total === lastTotal) { report.duplicates++; continue; }
        lastTotal = total ?? lastTotal;
        key = info?.total_token_usage ? `v1:${JSON.stringify(info.total_token_usage)}` : null;
      } else { report.skipped++; continue; }

      if (!usage || !validTimestamp(record.timestamp)) { report.skipped++; continue; }
      const cached = usage.cached_input_tokens || 0;
      const item = event({
        agent: 'codex', sessionId, timestamp: record.timestamp, model: turnModel,
        input: Math.max(0, (usage.input_tokens || 0) - cached), output: usage.output_tokens,
        cacheRead: cached, cacheWrite: usage.cache_write_input_tokens
      });
      if (!item.totalTokens) { report.skipped++; continue; }
      if (!key) { earliest.set(Symbol('unkeyed'), item); continue; }
      const previous = earliest.get(key);
      if (previous) { report.duplicates++; if (item.timestamp < previous.timestamp) earliest.set(key, item); continue; }
      earliest.set(key, item);
    }
  }
  const events = [...earliest.values()];
  report.accepted = events.length;
  report.ms = Date.now() - started;
  return { events, sessions: toSessions(events), report };
}
