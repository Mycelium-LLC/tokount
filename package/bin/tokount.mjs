#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { collectHistory } from '../lib/collectors/index.mjs';
import { zstdSupported } from '../lib/collectors/shared.mjs';
import { pricesGenerated } from '../lib/prices.mjs';
import { collectSummary } from '../lib/summary.mjs';
import { sendTelemetry, telemetryEnabled, telemetryPayload } from '../lib/telemetry.mjs';
import { COMMIT, VERSION } from '../lib/version.mjs';

const API = process.env.TOKOUNT_API || 'https://mycx.dev/api/tokount';
const SITE = process.env.TOKOUNT_SITE || 'https://mycx.dev/tokount';
const HANDLE = /^[a-z0-9](?:[a-z0-9._-]{0,37}[a-z0-9])?$/;
const configDir = join(homedir(), '.config', 'tokount');
const configFile = join(configDir, 'credentials.json');
const started = Date.now();
const fmt = new Intl.NumberFormat('en-US');
const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });
const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

const HELP = `
  tokount ${VERSION}: your Claude Code, Codex and Gemini history as a story page.

  npx tokount --handle <name>       read your history here, publish the story for 30 days
  npx tokount --dry-run             read and print the summary, publish nothing
  npx tokount doctor                what each history reader found (counts only)
  npx tokount --version

  Only a derived summary leaves your computer: totals, dates, model names and patterns.
  Prompts, responses, code, file paths and project names never do.
  Your handle is yours: a token saved in ~/.config/tokount protects it.

  Anonymous run counts (version, OS, how many records each reader accepted, errors)
  help keep the readers working. Turn them off with TOKOUNT_TELEMETRY=0.
`;

/** A failure the user can act on, with a stable code for telemetry. */
class TokountError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

let command = 'publish';
let reports = [];

async function finish(error) {
  await sendTelemetry(API, telemetryPayload({ command, durationMs: Date.now() - started, error: error?.code || (error ? 'E_UNEXPECTED' : null), reports }));
  if (error) {
    console.error(`\n  tokount: ${error instanceof TokountError ? error.message : `something went wrong (${error.message || error}).`}`);
    if (error.code !== 'E_USAGE') console.error(`  code ${error.code || 'E_UNEXPECTED'} · tokount ${VERSION} · run \`npx tokount doctor\` for details\n`);
    process.exitCode = 1;
  }
}

function parse(argv) {
  try {
    return parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        handle: { type: 'string', short: 'h' },
        'dry-run': { type: 'boolean' },
        json: { type: 'boolean' },
        version: { type: 'boolean', short: 'v' },
        help: { type: 'boolean' }
      },
      strict: true
    });
  } catch (error) {
    throw new TokountError('E_USAGE', `${error.message}\n${HELP}`);
  }
}

function printSummary(summary, history) {
  console.log(`\n  ${summary.first} → ${summary.last} · ${fmt.format(summary.activeDays)} active days · ${summary.tz}`);
  console.log(`  ${compact.format(summary.totals.totalTokens)} tokens · ${usd.format(summary.totals.totalCost)} at list prices\n`);
  for (const agent of summary.agents) console.log(`  ${agent.name.padEnd(8)} ${compact.format(agent.tokens).padStart(8)} tokens  ${usd.format(agent.cost).padStart(9)}  ${fmt.format(agent.days)} days`);
  console.log(`\n  Top models: ${summary.models.slice(0, 3).map(model => model.name).join(', ')}`);
  console.log(`  Longest streak: ${summary.streak.days} days · peak hour ${String(summary.peakHour).padStart(2, '0')}:00`);
  if (summary.pricing.unpricedModels.length) console.log(`  No list price for ${summary.pricing.unpricedModels.join(', ')}: counted at $0.`);
  const skipped = history.reports.filter(report => report.unreadable);
  if (skipped.length) console.log(`  ${skipped.map(report => `${report.agent}: ${report.unreadable} file(s) unreadable`).join(' · ')}`);
}

async function doctor() {
  const history = await collectHistory();
  reports = history.reports;
  console.log(`\n  tokount ${VERSION} (${COMMIT.slice(0, 7)}) · Node ${process.versions.node} · ${process.platform}/${process.arch}`);
  console.log(`  zstd: ${zstdSupported ? 'yes' : 'no (Node 22.15+ reads compressed Codex history)'} · prices from ${pricesGenerated} · telemetry ${telemetryEnabled() ? 'on' : 'off'}\n`);
  for (const report of history.reports) {
    const state = report.found ? 'found' : 'not found';
    console.log(`  ${report.agent.padEnd(7)} ${state.padEnd(10)} schema ${report.schema}`);
    if (!report.found) continue;
    console.log(`          ${fmt.format(report.files)} files · ${fmt.format(report.records)} lines · ${fmt.format(report.accepted)} usage records · ${fmt.format(report.duplicates)} duplicates · ${(report.ms / 1000).toFixed(1)} s`);
    if (report.invalidJson || report.unreadable) console.log(`          ${fmt.format(report.invalidJson)} invalid lines · ${fmt.format(report.unreadable)} unreadable files`);
  }
  console.log(history.events.length ? `\n  Ready: ${fmt.format(history.events.length)} usage records.\n` : '\n  No usage history found. tokount reads ~/.claude, ~/.codex and ~/.gemini (or CLAUDE_CONFIG_DIR, CODEX_HOME, GEMINI_CLI_HOME).\n');
}

async function run() {
  const { values, positionals } = parse(process.argv.slice(2));
  if (values.version) { console.log(`tokount ${VERSION} (${COMMIT})`); command = 'version'; return; }
  if (values.help) { console.log(HELP); command = 'help'; return; }
  if (positionals[0] === 'doctor') { command = 'doctor'; return doctor(); }
  if (positionals.length) throw new TokountError('E_USAGE', `unknown command "${positionals[0]}".\n${HELP}`);

  const dryRun = Boolean(values['dry-run']);
  command = dryRun ? 'dry-run' : 'publish';
  const handle = String(values.handle || (dryRun ? 'preview' : '')).toLowerCase();
  if (!HANDLE.test(handle)) throw new TokountError('E_HANDLE', 'pass a handle with --handle: 2–39 letters, numbers, dots, dashes or underscores.');

  console.log(`\n  tokount ${VERSION} by Mycelium`);
  console.log('  Reading your Claude Code, Codex and Gemini history here…');
  const history = await collectHistory();
  reports = history.reports;
  if (!history.events.length) throw new TokountError('E_NO_HISTORY', 'no Claude Code, Codex or Gemini usage history was found on this computer.');
  const summary = await collectSummary({ handle, history });

  if (values.json) { console.log(JSON.stringify(summary, null, 2)); return; }
  printSummary(summary, history);
  if (dryRun) { console.log('\n  Dry run: nothing was published.\n'); return; }

  let credentials = {};
  try { credentials = JSON.parse(await readFile(configFile, 'utf8')); } catch {}
  console.log(`\n  Publishing @${handle}…`);
  let response;
  try {
    response = await fetch(API, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'user-agent': `tokount/${VERSION}` },
      body: JSON.stringify({ handle, summary, claimToken: credentials[handle] || null }),
      signal: AbortSignal.timeout(30_000)
    });
  } catch (error) {
    throw new TokountError('E_NETWORK', `could not reach mycx.dev (${error.cause?.code || error.name}). Check your connection and run it again.`);
  }
  const result = await response.json().catch(() => ({}));
  if (response.status === 409) throw new TokountError('E_TAKEN', `@${handle} belongs to someone else. Choose another handle.`);
  if (response.status >= 400 && response.status < 500) throw new TokountError('E_REJECTED', result.error || `mycx.dev refused the summary (${response.status}).`);
  if (!response.ok) throw new TokountError('E_SERVER', `mycx.dev could not publish it (${response.status}${result.requestId ? `, request ${result.requestId}` : ''}). Try again in a minute.`);

  if (result.claimToken) {
    credentials[handle] = result.claimToken;
    await mkdir(configDir, { recursive: true, mode: 0o700 });
    await writeFile(configFile, JSON.stringify(credentials, null, 2) + '\n', { mode: 0o600 });
    console.log(`  @${handle} is yours. Its token is saved in ${process.platform === 'win32' ? '%USERPROFILE%\\.config\\tokount' : '~/.config/tokount'}; keep it to update the page.`);
  }
  console.log(`\n  Live for 30 days:\n  ${result.url || `${SITE}/${handle}`}\n`);
}

try { await run(); await finish(null); }
catch (error) { await finish(error); }
