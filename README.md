# tokount

**TL;DR:** One command reads a developer's Claude Code, Codex and Gemini CLI history on their own computer and publishes a story page at `mycx.dev/tokount/<handle>` for 30 days. This repo holds the `tokount` npm CLI and the Cloud Run service behind the page; it's a Mycelium product (Vault entity E-307).

```bash
npx tokount --handle yourname     # read, then publish the story
npx tokount --dry-run             # read and print the summary; publish nothing
npx tokount --json                # the exact summary that would be sent
npx tokount doctor                # what each history reader found (counts only)
```

Running the command again updates the same page and restarts its 30 days.

## What it reads

| Agent | Where | Notes |
|---|---|---|
| Claude Code | `~/.claude/projects`, `~/.config/claude/projects` (or `CLAUDE_CONFIG_DIR`) | each streamed message counted once, at its largest output |
| Codex | `~/.codex/sessions`, `~/.codex/archived_sessions` (or `CODEX_HOME`) | `.jsonl` and `.jsonl.zst` (Node 22.15+); a forked thread's replay of its parent counts once |
| Gemini CLI | `~/.gemini/tmp/*/chats` (or `GEMINI_CLI_HOME`) | thoughts billed as output |

The same paths hold on macOS, Linux and Windows. How each reader works, and how it was checked against ccusage, is in [docs/collectors.md](docs/collectors.md).

Cost is at list prices from [`package/lib/prices.json`](package/lib/prices.json), generated from LiteLLM's public price list by `node scripts/update-prices.mjs`. The CLI calls nothing to price a model; a model with no price counts as $0 and is named in the summary.

## Privacy and ownership

- Only a derived summary leaves the computer: totals, dates, model names and patterns (no time zone). Prompts, responses, code, file paths and project names never do.
- The first publish creates a claim token in `~/.config/tokount/credentials.json`. A handle can only be changed with its token, and expiry doesn't release it.
- A publish and `doctor` send optional run telemetry: the version, OS, Node major, command, duration, an error code and each reader's counts. `TOKOUNT_TELEMETRY=0` (or `DO_NOT_TRACK=1`) turns it off. A dry run sends nothing. See [docs/analytics.md](docs/analytics.md).

## Layout

- `package/`: the `tokount` npm CLI (`bin/`, `lib/`, `test/`). No runtime dependencies.
- `service/`: the Cloud Run service `tokount` (project `mycelium-hq`, us-central1, Firestore `tokount_profiles`): the landing, story pages, share images and `/api/tokount`.
- `scripts/update-prices.mjs`: regenerates the price table.
- `deploy/deploy.sh`: deploys the service. The `mycx.dev` route, `robots.txt` and `sitemap.xml` belong to [mycx-hosting](https://github.com/Mycelium-LLC/mycx-hosting).
- `.github/workflows/publish.yml`: publishes the npm package on a version tag (Trusted Publishing, with provenance).

## Verify

```bash
npm test            # service tests, CLI tests and an npm pack dry run
```

## Releases

`release/x.y.z` from main, `docs/qa/x.y.z.md`, a merge commit, the `x.y.z` tag (which publishes to npm), a GitHub release, then `deploy/deploy.sh` from the tag. `tokount --version` and `https://mycx.dev/tokount/version.json` state the version and commit.
