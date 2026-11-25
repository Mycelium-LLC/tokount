const MILLION = 1_000_000;

// USD per million tokens. Prefix matching keeps newly dated aliases on the
// closest known family while unknown models remain honest at $0.
const PRICES = [
  [/claude-opus-5|claude-opus-4/, { input: 5, output: 25, cacheRead: .5, cacheWrite: 6.25 }],
  [/claude-sonnet-4|claude-3-7-sonnet|claude-3-5-sonnet/, { input: 3, output: 15, cacheRead: .3, cacheWrite: 3.75 }],
  [/claude-haiku-4/, { input: 1, output: 5, cacheRead: .1, cacheWrite: 1.25 }],
  [/claude-3-5-haiku/, { input: .8, output: 4, cacheRead: .08, cacheWrite: 1 }],
  [/gemini-2\.5-pro/, { input: 1.25, output: 10, cacheRead: .31, cacheWrite: 1.25 }],
  [/gemini-2\.5-flash/, { input: .3, output: 2.5, cacheRead: .075, cacheWrite: .3 }],
  [/gemini-2\.0-flash/, { input: .1, output: .4, cacheRead: .025, cacheWrite: .1 }],
  [/gpt-5|codex/, { input: 1.25, output: 10, cacheRead: .125, cacheWrite: 1.25 }]
];

export function estimateCost(item) {
  const price = PRICES.find(([pattern]) => pattern.test(item.model))?.[1];
  if (!price) return 0;
  return (item.inputTokens * price.input + item.outputTokens * price.output + item.cacheReadTokens * price.cacheRead + item.cacheCreationTokens * price.cacheWrite) / MILLION;
}
