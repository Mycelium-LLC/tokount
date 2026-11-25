import { createReadStream } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import * as zlib from 'node:zlib';

export const number = value => Number.isFinite(value) && value >= 0 ? value : 0;

/** Node gained zstd in 22.15 / 23.8. Without it, .zst history is reported, never guessed. */
export const zstdSupported = typeof zlib.createZstdDecompress === 'function';

export function validTimestamp(value) {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value));
}

/** Every file under each root that `accept(name, path)` keeps. Missing roots are fine. */
export async function listFiles(roots, accept) {
  const files = [];
  const pending = [...new Set([roots].flat().filter(Boolean))];
  while (pending.length) {
    const directory = pending.pop();
    let entries;
    try { entries = await readdir(directory, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) pending.push(path);
      else if (entry.isFile() && accept(entry.name, path)) files.push(path);
    }
  }
  return files.sort();
}

/**
 * JSON records of a .jsonl or .jsonl.zst file. `keep(line)` is a cheap string test run
 * before JSON.parse: most history lines carry no usage, and parsing them is the slow part.
 */
export async function* jsonLines(path, report, keep = () => true) {
  let input = createReadStream(path);
  if (path.endsWith('.zst')) {
    if (!zstdSupported) { report.unreadable++; return; }
    input = input.pipe(zlib.createZstdDecompress());
  }
  const lines = createInterface({ input, crlfDelay: Infinity });
  try {
    for await (const line of lines) {
      if (!line) continue;
      report.records++;
      if (!keep(line)) { report.skipped++; continue; }
      try { yield JSON.parse(line); } catch { report.invalidJson++; }
    }
  } catch { report.unreadable++; }
}

export async function readJson(path, report) {
  try { return JSON.parse(await readFile(path, 'utf8')); }
  catch { report.invalidJson++; return null; }
}

/** What doctor prints and telemetry may send: counts and versions only, never paths or content. */
export function diagnostic(agent, schema) {
  return { agent, schema, found: false, roots: 0, files: 0, records: 0, accepted: 0, skipped: 0, duplicates: 0, invalidJson: 0, unreadable: 0, ms: 0 };
}

export function event({ agent, sessionId, timestamp, model, input, output, cacheRead, cacheWrite }) {
  const inputTokens = number(input);
  const outputTokens = number(output);
  const cacheReadTokens = number(cacheRead);
  const cacheCreationTokens = number(cacheWrite);
  return {
    agent,
    sessionId,
    timestamp,
    model: String(model || `${agent}-unknown`),
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheCreationTokens,
    totalTokens: inputTokens + outputTokens + cacheReadTokens + cacheCreationTokens
  };
}

export function toSessions(events) {
  const sessions = new Map();
  for (const item of events) {
    const key = `${item.agent}:${item.sessionId}`;
    const current = sessions.get(key);
    if (!current) { sessions.set(key, { agent: item.agent, id: item.sessionId, first: item.timestamp, last: item.timestamp, outputTokens: item.outputTokens, totalTokens: item.totalTokens }); continue; }
    if (item.timestamp < current.first) current.first = item.timestamp;
    if (item.timestamp > current.last) current.last = item.timestamp;
    current.outputTokens += item.outputTokens;
    current.totalTokens += item.totalTokens;
  }
  return [...sessions.values()];
}
