#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { collectSummary } from '../lib/summary.mjs';

const API = process.env.TOKOUNT_API || 'https://mycx.dev/api/tokount';
const SITE = process.env.TOKOUNT_SITE || 'https://mycx.dev/tokount';
const configDir = join(homedir(), '.config', 'tokount');
const configFile = join(configDir, 'credentials.json');

function fail(message) {
  console.error(`\n  tokount: ${message}\n`);
  process.exit(1);
}

const { values } = parseArgs({
  options: {
    handle: { type: 'string', short: 'h' },
    help: { type: 'boolean' }
  },
  strict: true
});

if (values.help) {
  console.log(`\n  npx tokount --handle <handle>\n\n  Builds your usage story locally and publishes the derived summary for 30 days.\n  Raw ccusage exports never leave your machine.\n`);
  process.exit(0);
}

const handle = String(values.handle || '').toLowerCase();
if (!/^[a-z0-9](?:[a-z0-9._-]{0,37}[a-z0-9])?$/.test(handle)) {
  fail('pass a 2–39 character handle with --handle (letters, numbers, dots, dashes or underscores).');
}

console.log('\n  tokount by Mycelium');
console.log('  Reading ccusage locally…');

let summary;
try {
  summary = await collectSummary({ handle });
} catch (error) {
  fail(error.message || String(error));
}

let credentials = {};
try { credentials = JSON.parse(await readFile(configFile, 'utf8')); } catch {}

console.log(`  Publishing ${summary.activeDays.toLocaleString()} active days; raw exports stay here.`);
const response = await fetch(API, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ handle, summary, claimToken: credentials[handle] || null })
}).catch(error => fail(`could not reach mycx.dev (${error.message}).`));

const result = await response.json().catch(() => ({}));
if (!response.ok) fail(result.error || `publish failed (${response.status}).`);

if (result.claimToken) {
  credentials[handle] = result.claimToken;
  await mkdir(configDir, { recursive: true, mode: 0o700 });
  await writeFile(configFile, JSON.stringify(credentials, null, 2) + '\n', { mode: 0o600 });
}

console.log('\n  Published. Your link is live for 30 days:');
console.log(`  ${result.url || `${SITE}/${handle}`}\n`);
