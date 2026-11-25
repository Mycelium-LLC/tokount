import { diagnostic, event, jsonLines, listFiles, toSessions, validTimestamp } from './shared.mjs';

/**
 * Claude Code writes one JSONL file per session under <config>/projects/<project>/.
 * An assistant message is written several times while it streams: same message.id and
 * requestId, growing usage. We keep the copy with the most output, once across all files
 * (resumed and forked sessions repeat earlier messages).
 */
export const CLAUDE_SCHEMA = 'claude-assistant-usage-v2';

export async function collectClaude(roots) {
  const started = Date.now();
  const report = diagnostic('claude', CLAUDE_SCHEMA);
  report.roots = roots.length;
  const files = await listFiles(roots, name => name.endsWith('.jsonl'));
  report.files = files.length;
  report.found = files.length > 0;
  const best = new Map();

  for (const path of files) {
    for await (const record of jsonLines(path, report, line => line.includes('"usage"') && line.includes('"assistant"'))) {
      const usage = record?.message?.usage;
      if (record?.type !== 'assistant' || !usage || !validTimestamp(record.timestamp) || typeof record.message?.model !== 'string' || record.message.model === '<synthetic>') { report.skipped++; continue; }
      const key = record.message.id ? `${record.message.id}:${record.requestId || ''}` : `${record.uuid || ''}`;
      if (!key || key === ':') { report.skipped++; continue; }
      const item = event({
        agent: 'claude', sessionId: String(record.sessionId || 'unknown'), timestamp: record.timestamp, model: record.message.model,
        input: usage.input_tokens, output: usage.output_tokens,
        cacheRead: usage.cache_read_input_tokens, cacheWrite: usage.cache_creation_input_tokens
      });
      if (!item.totalTokens) { report.skipped++; continue; }
      const previous = best.get(key);
      if (previous) {
        report.duplicates++;
        if (item.outputTokens > previous.outputTokens || (item.outputTokens === previous.outputTokens && item.totalTokens > previous.totalTokens)) best.set(key, { ...item, timestamp: previous.timestamp });
        continue;
      }
      best.set(key, item);
    }
  }
  const events = [...best.values()];
  report.accepted = events.length;
  report.ms = Date.now() - started;
  return { events, sessions: toSessions(events), report };
}
