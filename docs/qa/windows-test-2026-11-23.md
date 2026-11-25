# tokount on Windows: first test (2026-11-23)

Run by the Windows session on Niko's PC (handle `nikotsypc`), at Niko's request, against `main` at afecb9d (a fresh clone). Nothing was published.

Setup: Windows 11 Pro, Node v22.17.1.

## Results

1. **Tests pass.** `npm test` at the root passes the service suite (1/1, "claim, protect, update and expire a handle"). `npm pack --dry-run` is OK: 3 files, 3.9 kB.
2. **The CLI fails on Windows** with `spawn npx ENOENT`.
   - The cause is `package/lib/summary.mjs:7`, which calls `execFile('npx', ...)`. On Windows that must be `npx.cmd`.
   - Since Node's CVE-2024-27980 fix, a `.cmd` file also needs `shell: true`.
3. **A one-line patch makes it work:**

   ```js
   exec(process.platform === 'win32' ? 'npx.cmd' : 'npx', [...], { shell: process.platform === 'win32', ... })
   ```

   With it, `collectSummary` ran in 5.4 s, through ccusage@20.0.51:

   | Measure | Value |
   |---|---|
   | Date range | 2025-12-17 → 2026-11-23 |
   | Active days | 21 |
   | Total tokens | 1,242,417,399 |
   | Total cost | $699.90 |
   | Agents | claude 1.2305B tokens, $695.50; gemini 11.9M tokens, $4.40; no codex |
   | Longest streak | 3 days |
   | Peak hour | 14:00 |

   **Privacy check passed:** the summary holds no Windows paths and no project or folder names (`projects: []`).
4. **There's no dry-run flag.** `tokount --handle X` always POSTs to mycx.dev, so the tester called `collectSummary` directly to avoid publishing.

## For the tokount session

- **The npx.cmd and shell fix**, or drop the npx dependency once the own collectors (`package/lib/collectors/`, still uncommitted on the Mac) replace the ccusage path.
- **Add `--dry-run`**, to print the summary without publishing.
- **Once the collectors are pushed,** the Windows session can rerun against that branch.
