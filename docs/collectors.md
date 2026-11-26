# Local history collectors

tokount reads each agent's history itself. The CLI depends on no aggregator at runtime and spawns no process, which is what broke on Windows (`spawn npx ENOENT`, 2026-11-23).

## Contract

Each reader (`package/lib/collectors/<agent>.mjs`):

1. finds its known roots on macOS, Linux and Windows (`historyRoots`);
2. reads only known record shapes, named by a schema version (`claude-assistant-usage-v2`, `codex-rollout-usage-v2`, `gemini-chat-message-v2`);
3. emits usage events: agent, session id, timestamp, model, token counts. Never prompt text, responses, code, paths or project names.

Its report (shown by `tokount doctor`, sent by telemetry) holds counts only: files, lines, accepted records, duplicates, invalid lines, unreadable files, milliseconds.

## The rules, and why

- **Claude Code** writes an assistant message several times while it streams (same `message.id` and `requestId`, growing usage), and resumed or forked sessions repeat earlier messages in a new file. One message counts once: the copy with the most output, at its earliest timestamp. One-hour cache writes (`cache_creation.ephemeral_1h_input_tokens`) are priced at their own rate.
- **Codex** reports `input_tokens` including the cached part, so fresh input is `input - cached`. Usage comes in two formats: v1 `token_count` events and v2 `token_usage_record`s with a `response_id`. A session that lived through a Codex upgrade has both; v1 counts until the file's first v2 record. A forked thread copies its parent's records into its own file with new timestamps (one fork on 2026-08-14 replayed 134M tokens within a second), so each record is keyed (v2: the response id; v1: the cumulative thread total it reports) and a key counts once, at its earliest timestamp, from whichever file.
- **Gemini CLI** also includes cached tokens in `input`; `thoughts` are billed as output and kept apart from it.

## Speed

Most history lines are tool output and file contents with no usage. Lines are split on raw bytes and a line is decoded and parsed only when it holds the reader's markers (`"usage"` and `"assistant"` for Claude). Claude's files are read across up to 4 worker threads when the history is over 256 MB.

## Checked against ccusage (Niko's Mac, 2026-11-26)

`npx ccusage@20.0.51 daily --json --by-agent -z Asia/Jerusalem`, compared on every day before 2026-11-26 (the day both ran). History: 13 GB, 3,668 Claude files, 180 Codex files (169 `.zst`), 85 Gemini chats.

| Agent | Input | Output | Cache read | Cache write | Total tokens | Cost |
|---|---:|---:|---:|---:|---:|---:|
| Claude | 0.00% | 0.00% | 0.00% | 0.00% | 0.00% | −0.00% |
| Codex | 0.00% | 0.01% | 0.00% | 0.00% | 0.00% | −0.06% |
| Gemini | 0.00% | 0.00% | 0.00% | 0.00% | 0.00% | +0.16% |

Run time: 22–55 s on that history (was about 5 minutes with ccusage). The only unpriced model was `codex-auto-review`, counted at $0.

## When a format changes

A new shape lands as a fixture first (`package/test/fixtures.mjs`), then the reader, then a test. A file a reader doesn't recognise is skipped and counted, never guessed into the summary.
