#!/usr/bin/env node
/**
 * Regenerates package/lib/prices.json from LiteLLM's public price list. Run by a maintainer,
 * never by the CLI: the published package carries the table and calls nothing at runtime.
 *
 *   node scripts/update-prices.mjs            fetch LiteLLM's list and rewrite prices.json
 *   node scripts/update-prices.mjs <file>     use a local copy of the list instead
 *
 * Kept: claude-*, gpt-*, gemini-* (bare ids only, no provider/ prefixes), in USD per million
 * tokens. A tier above 200K prompt tokens, and the one-hour cache write rate, are kept where
 * LiteLLM lists them.
 */
import { readFile, writeFile } from 'node:fs/promises';

const SOURCE = 'https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json';
const OUT = new URL('../package/lib/prices.json', import.meta.url);
const MILLION = 1_000_000;
const perMillion = value => (Number.isFinite(value) ? Math.round(value * MILLION * 1e6) / 1e6 : undefined);

const raw = process.argv[2]
  ? JSON.parse(await readFile(process.argv[2], 'utf8'))
  : await fetch(SOURCE).then(response => { if (!response.ok) throw new Error(`LiteLLM list: HTTP ${response.status}`); return response.json(); });

const models = {};
for (const [id, entry] of Object.entries(raw).sort(([a], [b]) => a.localeCompare(b))) {
  if (!/^(claude|gpt|gemini)-[a-z0-9.\-]+$/.test(id)) continue;
  if (!Number.isFinite(entry?.input_cost_per_token) || !Number.isFinite(entry?.output_cost_per_token)) continue;
  const price = {
    input: perMillion(entry.input_cost_per_token),
    output: perMillion(entry.output_cost_per_token),
    cacheRead: perMillion(entry.cache_read_input_token_cost) ?? perMillion(entry.input_cost_per_token),
    cacheWrite: perMillion(entry.cache_creation_input_token_cost) ?? perMillion(entry.input_cost_per_token)
  };
  // Claude Code writes its prompt cache with a one-hour lifetime, which Anthropic bills higher.
  if (Number.isFinite(entry.cache_creation_input_token_cost_above_1hr)) price.cacheWrite1h = perMillion(entry.cache_creation_input_token_cost_above_1hr);
  if (Number.isFinite(entry.input_cost_per_token_above_200k_tokens)) {
    price.above200k = {
      input: perMillion(entry.input_cost_per_token_above_200k_tokens),
      output: perMillion(entry.output_cost_per_token_above_200k_tokens) ?? price.output,
      cacheRead: perMillion(entry.cache_read_input_token_cost_above_200k_tokens) ?? price.cacheRead,
      cacheWrite: perMillion(entry.cache_creation_input_token_cost_above_200k_tokens) ?? price.cacheWrite
    };
  }
  models[id] = price;
}

const table = { source: SOURCE, generated: new Date().toISOString().slice(0, 10), unit: 'USD per million tokens', models };
await writeFile(OUT, JSON.stringify(table, null, 1) + '\n');
console.log(`prices.json: ${Object.keys(models).length} models`);
