import { readFileSync } from 'node:fs';

/** USD per million tokens, generated from LiteLLM's list by scripts/update-prices.mjs. */
const TABLE = JSON.parse(readFileSync(new URL('./prices.json', import.meta.url), 'utf8'));
const MILLION = 1_000_000;
const TIER = 200_000;
const cache = new Map();

/** The price of a model id: exact, then without a date suffix (-20250929, -2025-09-29, @20250929). */
export function priceOf(model) {
  if (cache.has(model)) return cache.get(model);
  const id = String(model || '');
  const bare = id.replace(/(?:[-@]\d{8}|-\d{4}-\d{2}-\d{2})$/, '');
  const price = TABLE.models[id] || TABLE.models[bare] || null;
  cache.set(model, price);
  return price;
}

/** Cost of one usage event. A model with no price costs $0 and is reported, never guessed. */
export function estimateCost(item) {
  const price = priceOf(item.model);
  if (!price) return 0;
  const prompt = item.inputTokens + item.cacheReadTokens + item.cacheCreationTokens;
  const rate = price.above200k && prompt > TIER ? price.above200k : price;
  const longWrites = Math.min(item.cacheWrite1hTokens || 0, item.cacheCreationTokens);
  const longRate = price.cacheWrite1h ?? rate.cacheWrite;
  return (
    item.inputTokens * rate.input
    + (item.outputTokens + (item.reasoningTokens || 0)) * rate.output
    + item.cacheReadTokens * rate.cacheRead
    + (item.cacheCreationTokens - longWrites) * rate.cacheWrite
    + longWrites * longRate
  ) / MILLION;
}

export const pricesGenerated = TABLE.generated;
