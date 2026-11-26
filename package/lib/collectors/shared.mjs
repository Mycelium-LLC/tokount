import { createReadStream } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import * as zlib from 'node:zlib';

export const number = value => Number.isFinite(value) && value >= 0 ? value : 0;

/** Node gained zstd in 22.15 / 23.8. Without it, .zst history is reported, never guessed. */
export const zstdSupported = typeof zlib.createZstdDecompress === 'function';

export function validTimestamp(value) {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value));
}

/** Every file under each root that `accept(name, path)` keeps. Missing roots are fine.
 * With `sizes`, each file comes back as { path, size }. */
export async function listFiles(roots, accept, { sizes = false } = {}) {
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
  files.sort();
  if (!sizes) return files;
  return Promise.all(files.map(async path => ({ path, size: await stat(path).then(info => info.size, () => 0) })));
}

/**
 * The JSON records of a .jsonl or .jsonl.zst file. A line is decoded and parsed only when it
 * contains every `all` marker and, if given, at least one `any` marker: most history lines
 * carry no usage, and decoding and parsing them (tool output, file contents) is the slow part.
 * Lines are split on raw bytes, so a skipped line never becomes a string.
 */
export async function readRecords(path, report, { all = [], any = [] } = {}) {
  const needles = all.map(marker => Buffer.from(marker));
  const options = any.map(marker => Buffer.from(marker));
  const records = [];
  const take = line => {
    if (!line.length) return;
    report.records++;
    for (const needle of needles) if (line.indexOf(needle) === -1) { report.skipped++; return; }
    if (options.length && !options.some(option => line.indexOf(option) !== -1)) { report.skipped++; return; }
    try { records.push(JSON.parse(line.toString('utf8'))); } catch { report.invalidJson++; }
  };
  let input = createReadStream(path, { highWaterMark: 1 << 20 });
  if (path.endsWith('.zst')) {
    if (!zstdSupported) { report.unreadable++; return records; }
    input = input.pipe(zlib.createZstdDecompress());
  }
  let carry = null;
  try {
    for await (const chunk of input) {
      let start = 0, end;
      if (carry) {
        const first = chunk.indexOf(10);
        if (first === -1) { carry.push(chunk); continue; }
        carry.push(chunk.subarray(0, first));
        take(Buffer.concat(carry));
        carry = null;
        start = first + 1;
      }
      while ((end = chunk.indexOf(10, start)) !== -1) { take(chunk.subarray(start, end)); start = end + 1; }
      if (start < chunk.length) carry = [chunk.subarray(start)];
    }
    if (carry) take(Buffer.concat(carry));
  } catch { report.unreadable++; }
  return records;
}

/** Run `work` over `items`, `limit` at a time. Reading several files at once keeps the disk busy. */
export async function eachLimit(items, limit, work) {
  let next = 0;
  const lane = async () => { while (next < items.length) await work(items[next++]); };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, lane));
}

export async function readJson(path, report) {
  try { return JSON.parse(await readFile(path, 'utf8')); }
  catch { report.invalidJson++; return null; }
}

/** What doctor prints and telemetry may send: counts and versions only, never paths or content. */
export function diagnostic(agent, schema) {
  return { agent, schema, found: false, roots: 0, files: 0, records: 0, accepted: 0, skipped: 0, duplicates: 0, invalidJson: 0, unreadable: 0, ms: 0 };
}

/**
 * One model response's usage. `reasoning` is thinking billed as output but reported apart
 * (Gemini's thoughts); `cacheWrite1h` is the part of cacheWrite written with a one-hour
 * lifetime (Claude Code), which is billed higher.
 */
export function event({ agent, sessionId, timestamp, model, input, output, cacheRead, cacheWrite, cacheWrite1h, reasoning }) {
  const inputTokens = number(input);
  const outputTokens = number(output);
  const cacheReadTokens = number(cacheRead);
  const cacheCreationTokens = number(cacheWrite);
  const reasoningTokens = number(reasoning);
  return {
    agent,
    sessionId,
    timestamp,
    model: String(model || `${agent}-unknown`),
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheCreationTokens,
    cacheWrite1hTokens: Math.min(number(cacheWrite1h), cacheCreationTokens),
    reasoningTokens,
    totalTokens: inputTokens + outputTokens + cacheReadTokens + cacheCreationTokens + reasoningTokens
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
