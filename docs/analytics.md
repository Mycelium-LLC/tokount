# Analytics and observability

tokount measures product health without collecting history content.

## Service events

Every structured Cloud Logging event includes `event`, `release`, and `eventId`.

- `landing.view`
- `story.view`, `story.missing`, `story.expired`
- `publish.create`, `publish.update`, `publish.conflict`, `publish.reject`
- `service.error`

Handles are represented only by a one-way, domain-separated 12-character hash. Logs never contain raw handles, IP addresses added by application code, prompts, responses, paths, projects, or history records.

## CLI events

The maintained collectors may report version, OS family, adapter/schema versions, duration, accepted/skipped record counts, and stable error codes. `TOKOUNT_TELEMETRY=0` disables optional CLI telemetry. Publishing still creates the minimum server events needed to operate the public link.

## Release metrics

Create log-based metrics grouped by `release` for:

- publish success and conflict rates;
- service error rate;
- unknown collector schema rate;
- adapter success rate by OS family;
- landing → first publish conversion;
- active and expired story views.

Alerts should fire on service errors, publish failure regressions, and a new unknown-schema fingerprint. Structural fingerprints must be redacted and opt-in before they leave the machine.
