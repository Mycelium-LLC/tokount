import { availableParallelism } from 'node:os';
import { Worker } from 'node:worker_threads';
import { diagnostic, eachLimit, event, listFiles, readRecords, toSessions, validTimestamp } from './shared.mjs';

/**
 * Claude Code writes one JSONL file per session under <config>/projects/<project>/.
 * An assistant message is written several times while it streams: same message.id and
 * requestId, growing usage. We keep the copy with the most output, once across all files
 * (resumed and forked sessions repeat earlier messages).
 */
export const CLAUDE_SCHEMA = 'claude-assistant-usage-v2';
const COUNTERS = ['records', 'skipped', 'duplicates', 'invalidJson', 'unreadable'];

/** Files are read in any order, so a merge must not depend on it: the copy with the most
 * output wins, and it keeps the earliest timestamp and that copy's session. */
function keep(best, key, item, report) {
  const previous = best.get(key);
  if (!previous) { best.set(key, item); return; }
  report.duplicates++;
  const winner = item.outputTokens > previous.outputTokens || (item.outputTokens === previous.outputTokens && item.totalTokens > previous.totalTokens) ? item : previous;
  const earliest = item.timestamp < previous.timestamp ? item : previous;
  best.set(key, { ...winner, timestamp: earliest.timestamp, sessionId: earliest.sessionId });
}

/** One share of the files: the best copy of each message, keyed, plus the counters. */
export async function scanClaudeFiles(files) {
  const report = diagnostic('claude', CLAUDE_SCHEMA);
  const best = new Map();
  await eachLimit(files, 4, async path => {
    for (const record of await readRecords(path, report, { all: ['"usage"', '"assistant"'] })) {
      const usage = record?.message?.usage;
      if (record?.type !== 'assistant' || !usage || !validTimestamp(record.timestamp) || typeof record.message?.model !== 'string' || record.message.model === '<synthetic>') { report.skipped++; continue; }
      const key = record.message.id ? `${record.message.id}:${record.requestId || ''}` : `${record.uuid || ''}`;
      if (!key || key === ':') { report.skipped++; continue; }
      const item = event({
        agent: 'claude', sessionId: String(record.sessionId || 'unknown'), timestamp: record.timestamp, model: record.message.model,
        input: usage.input_tokens, output: usage.output_tokens,
        cacheRead: usage.cache_read_input_tokens, cacheWrite: usage.cache_creation_input_tokens,
        cacheWrite1h: usage.cache_creation?.ephemeral_1h_input_tokens
      });
      if (!item.totalTokens) { report.skipped++; continue; }
      keep(best, key, item, report);
    }
  });
  return { entries: [...best], report };
}

/** Deal files to `count` shares of about equal size, biggest first. */
function shares(files, sizes, count) {
  const out = Array.from({ length: count }, () => ({ files: [], bytes: 0 }));
  for (const index of files.map((_, i) => i).sort((a, b) => sizes[b] - sizes[a])) {
    const lightest = out.reduce((a, b) => (b.bytes < a.bytes ? b : a));
    lightest.files.push(files[index]); lightest.bytes += sizes[index];
  }
  return out.filter(share => share.files.length).map(share => share.files);
}

function inWorker(files) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./claude-worker.mjs', import.meta.url), { workerData: files });
    worker.once('message', resolve);
    worker.once('error', reject);
    worker.once('exit', code => code && reject(new Error(`claude worker exited ${code}`)));
  });
}

export async function collectClaude(roots, { workers } = {}) {
  const started = Date.now();
  const report = diagnostic('claude', CLAUDE_SCHEMA);
  report.roots = roots.length;
  const found = await listFiles(roots, name => name.endsWith('.jsonl'), { sizes: true });
  const files = found.map(file => file.path);
  report.files = files.length;
  report.found = files.length > 0;

  // Big histories (Niko's is 13 GB) are bound by JSON parsing, so the files are split across
  // worker threads. Small ones stay on this thread; a worker that fails falls back to it.
  const bytes = found.reduce((sum, file) => sum + file.size, 0);
  const count = workers ?? (bytes > 256 * 2 ** 20 ? Math.max(1, Math.min(4, availableParallelism() - 1)) : 1);
  let parts;
  if (count > 1) {
    try { parts = await Promise.all(shares(files, found.map(file => file.size), count).map(inWorker)); }
    catch { parts = null; }
  }
  if (!parts) parts = [await scanClaudeFiles(files)];

  const best = new Map();
  for (const part of parts) {
    for (const counter of COUNTERS) report[counter] += part.report[counter];
    for (const [key, item] of part.entries) keep(best, key, item, report);
  }
  const events = [...best.values()];
  report.accepted = events.length;
  report.ms = Date.now() - started;
  return { events, sessions: toSessions(events), report };
}
