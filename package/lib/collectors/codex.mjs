import { diagnostic, event, jsonLines, listFiles, toSessions, validTimestamp } from './shared.mjs';

/**
 * Codex writes rollouts to <CODEX_HOME>/sessions/YYYY/MM/DD/rollout-*.jsonl, compresses older
 * ones to .jsonl.zst, and moves some to <CODEX_HOME>/archived_sessions.
 *
 * Two formats carry usage:
 *  - v2: `token_usage_record` with a response_id, one per model response. Preferred.
 *  - v1: `event_msg` / `token_count` with last_token_usage. Used only in files without v2;
 *        a repeat (same cumulative total) is a re-emit, not new usage.
 * OpenAI's input_tokens includes the cached tokens, so fresh input is input - cached.
 * Forked threads copy their parent's records, so response ids are deduplicated across files.
 */
export const CODEX_SCHEMA = 'codex-rollout-usage-v2';

const usageLine = line => line.includes('token_usage_record') || line.includes('token_count') || line.includes('turn_context') || line.includes('session_meta');

export async function collectCodex(roots) {
  const started = Date.now();
  const report = diagnostic('codex', CODEX_SCHEMA);
  report.roots = roots.length;
  const files = await listFiles(roots, name => name.startsWith('rollout-') && (name.endsWith('.jsonl') || name.endsWith('.jsonl.zst')));
  report.files = files.length;
  report.found = files.length > 0;
  const events = [];
  const seenResponses = new Set();

  for (const path of files) {
    const records = [];
    for await (const record of jsonLines(path, report, usageLine)) records.push(record);
    let sessionId = path.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/)?.[1] || 'unknown';
    const turnModels = new Map();
    for (const record of records) {
      if (record?.type === 'session_meta') sessionId = String(record.payload?.id || record.payload?.session_id || sessionId);
      if (record?.type === 'turn_context' && record.payload?.turn_id && record.payload?.model) turnModels.set(record.payload.turn_id, record.payload.model);
    }
    const hasV2 = records.some(record => record?.type === 'token_usage_record');
    let model = 'codex-unknown';
    let lastTotal = null;

    for (const record of records) {
      if (record?.type === 'turn_context') { if (record.payload?.model) model = record.payload.model; continue; }
      if (record?.type === 'session_meta') continue;
      let usage, turnModel = model;
      if (record?.type === 'token_usage_record') {
        const id = record.payload?.response_id;
        usage = record.payload?.usage;
        if (id) { if (seenResponses.has(id)) { report.duplicates++; continue; } seenResponses.add(id); }
        turnModel = turnModels.get(record.payload?.turn_id) || model;
      } else if (record?.type === 'event_msg' && record.payload?.type === 'token_count') {
        if (hasV2) { report.duplicates++; continue; }
        const info = record.payload?.info;
        usage = info?.last_token_usage;
        const total = info?.total_token_usage?.total_tokens;
        if (total != null && total === lastTotal) { report.duplicates++; continue; }
        lastTotal = total ?? lastTotal;
      } else { report.skipped++; continue; }

      if (!usage || !validTimestamp(record.timestamp)) { report.skipped++; continue; }
      const cached = usage.cached_input_tokens || 0;
      const item = event({
        agent: 'codex', sessionId, timestamp: record.timestamp, model: turnModel,
        input: Math.max(0, (usage.input_tokens || 0) - cached), output: usage.output_tokens,
        cacheRead: cached, cacheWrite: usage.cache_write_input_tokens
      });
      if (!item.totalTokens) { report.skipped++; continue; }
      events.push(item);
      report.accepted++;
    }
  }
  report.ms = Date.now() - started;
  return { events, sessions: toSessions(events), report };
}
