# Local history collectors

tokount owns its history ingestion. The public CLI must not depend on ccusage or another aggregator at runtime.

## Contract

Each agent adapter has three jobs:

1. Discover candidate history roots on macOS and Windows.
2. Detect a known record format before reading content.
3. Emit normalized usage events containing only timestamps, model identifiers, token counts, and agent identity.

Prompt text, responses, code, file paths, project names, repository names, and session titles are never emitted.

## Adapters

- `claude` — Claude Code history.
- `codex` — Codex history.
- `gemini` — Gemini CLI history.

Each adapter owns versioned fixtures for every observed format. Unsupported formats produce a diagnostic with the agent, candidate path, structural fingerprint, and tokount version—never raw record content.

## Maintenance loop

`tokount doctor` reports which adapters were found, which schema version matched, how many records were accepted or skipped, and how to submit a redacted structural fingerprint. New formats land as fixtures first, then parser support and regression tests.

Discovery must be conservative: known roots and known schemas only. A new-looking file is never guessed into the public summary.
