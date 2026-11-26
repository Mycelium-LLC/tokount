# Analytics and observability

tokount measures its own health without collecting history content. It follows HQ Ops §51: it emits, Ops interprets. It has no monitoring, alerting or error store of its own.

## Where each signal goes

| Signal | Path | Read by |
|---|---|---|
| Structured request logs (below) | stdout → Cloud Logging, service `tokount` in `mycelium-hq` | the estate's log bucket and its log-based alerts (policy `gcp-log-sink`), HQ traces |
| Cloud Run 5xx and instance counts | Cloud Monitoring | policy `gcp-run-errors-baseline` → Ops |
| A failed request | `POST <ops>/v1/events`, type `tokount.request_failed`, with the service's own ID token (`tokount-web@mycelium-hq`) | HQ Ops tenant `tokount` |
| Liveness | Ops route probes of `mycx.dev/tokount/` and `mycx.dev/api/tokount/health` | HQ Ops tenant `tokount` |

## Service log events

Every line is JSON with `severity`, `event`, `release` (the version), `revision` and `eventId`.

- `landing.view`
- `story.view`, `story.missing`, `story.expired`
- `publish.create`, `publish.update`, `publish.conflict`, `publish.reject`
- `cli.run` (CLI telemetry, below)
- `service.error`

A handle appears only as a one-way, domain-separated 12-character hash (`handleKey`). Logs never hold a raw handle, an IP address added by the app, prompts, responses, paths, projects or history records.

## CLI telemetry

One `POST /api/tokount/telemetry` per publish or `doctor` run (a dry run, `--json`, `--version` and `--help` make no network call at all), 2.5 s timeout, no retry, never shown to the user when it fails. The service keeps only these fields and logs them as `cli.run`:

`cliVersion`, `os`, `arch`, `node` (major), `command` (`publish` or `doctor`), `durationMs`, `error` (a stable code: `E_HANDLE`, `E_NO_HISTORY`, `E_NETWORK`, `E_TAKEN`, `E_REJECTED`, `E_SERVER`, `E_USAGE`, `E_UNEXPECTED`), and per reader `agent`, `schema`, `found`, `files`, `records`, `accepted`, `skipped`, `duplicates`, `invalidJson`, `unreadable`, `ms`.

`TOKOUNT_TELEMETRY=0` or `DO_NOT_TRACK=1` turns it off. Publishing still writes the server events above, which the public link needs to work.

## Questions these answer

- Does a reader still work on each OS? `cli.run` by `os`, `adapters[].accepted`, `adapters[].unreadable`.
- Did a release break publishing? `publish.*` and `cli.run.error` by `release`.
- Is anyone using it? `landing.view` → `publish.create`, and `story.view`.
