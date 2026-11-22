# tokount

One command turns local ccusage history into a public, shareable story:

```bash
npx tokount --handle yourname
```

The result lives at `https://mycx.dev/tokount/yourname` for 30 days. Running the command again updates the same page and renews the 30-day clock.

## Privacy and ownership

- Raw ccusage exports, prompts, code, transcripts, and paths stay local.
- The CLI uploads only a derived summary. Project and folder names are never collected.
- The first publish creates a private claim token in `~/.config/tokount/credentials.json`.
- An existing handle can only be changed with its claim token. Expiry takes the page offline but does not release the handle.

## Repository layout

- `package/` — the public `tokount` npm CLI.
- `service/` — the `/tokount`, `/tokount/:handle`, and `/api/tokount` Cloud Run service.
- `template.html` — the story template used by the service.
- `build.py` — the original local prototype builder.
- `PLAN.md` — product and architecture decisions.

## Verify

```bash
cd service && npm ci && npm test
cd ../package && npm pack --dry-run
```
