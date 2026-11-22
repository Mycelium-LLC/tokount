import crypto from 'node:crypto';
import express from 'express';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const DAY = 86_400_000;
const HANDLE = /^[a-z0-9](?:[a-z0-9._-]{0,37}[a-z0-9])?$/;
const hash = token => crypto.createHash('sha256').update(token).digest('hex');
const safeJson = value => JSON.stringify(value).replaceAll('<', '\\u003c').replaceAll('>', '\\u003e');
const release = process.env.K_REVISION || process.env.TOKOUNT_VERSION || 'dev';
const logEvent = (event, fields = {}, severity = 'INFO') => console.log(JSON.stringify({ severity, event, release, ...fields }));
const handleKey = handle => hash(`tokount:${handle}`).slice(0, 12);

function validateSummary(summary, handle) {
  if (!summary || summary.schemaVersion !== 1 || summary.handle !== handle) return 'summary does not match this handle';
  if (!summary.totals || !Number.isFinite(summary.totals.totalTokens) || !Array.isArray(summary.models)) return 'summary is incomplete';
  if (Buffer.byteLength(JSON.stringify(summary)) > 100_000) return 'summary is too large';
  return null;
}

export async function createApp({ store, now = () => Date.now() }) {
  const [landing, template, white, black] = await Promise.all([
    readFile(join(root, 'public', 'index.html'), 'utf8'),
    readFile(join(root, 'views', 'story.html'), 'utf8'),
    readFile(join(root, 'brand', 'mycelium-lockup-white.svg')),
    readFile(join(root, 'brand', 'mycelium-lockup-black.svg'))
  ]);
  const lockups = {
    white: `data:image/svg+xml;base64,${white.toString('base64')}`,
    black: `data:image/svg+xml;base64,${black.toString('base64')}`
  };
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '128kb' }));
  app.use((req, res, next) => { req.eventId = crypto.randomUUID(); res.set('x-request-id', req.eventId); next(); });

  app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'tokount', version: '0.1.0' }));
  app.get('/tokount/brand.svg', (_req, res) => res.type('svg').send(white));
  app.get(['/tokount', '/tokount/'], (req, res) => { logEvent('landing.view', { eventId: req.eventId }); res.type('html').send(landing); });

  app.post('/api/tokount', async (req, res) => {
    const handle = String(req.body?.handle || '').toLowerCase();
    if (!HANDLE.test(handle)) { logEvent('publish.reject', { eventId: req.eventId, reason: 'invalid_handle' }, 'WARNING'); return res.status(400).json({ error: 'Invalid handle.' }); }
    const problem = validateSummary(req.body?.summary, handle);
    if (problem) { logEvent('publish.reject', { eventId: req.eventId, handleKey: handleKey(handle), reason: 'invalid_summary' }, 'WARNING'); return res.status(400).json({ error: problem }); }
    const supplied = String(req.body?.claimToken || '');
    const current = await store.get(handle);
    let claimToken = null;
    if (current) {
      if (!supplied || !crypto.timingSafeEqual(Buffer.from(hash(supplied)), Buffer.from(current.claimHash))) {
        logEvent('publish.conflict', { eventId: req.eventId, handleKey: handleKey(handle) }, 'WARNING');
        return res.status(409).json({ error: `@${handle} is already taken. Choose another handle.` });
      }
    } else {
      claimToken = crypto.randomBytes(32).toString('base64url');
    }
    const expiresAt = new Date(now() + 30 * DAY).toISOString();
    await store.set(handle, {
      summary: req.body.summary,
      claimHash: current?.claimHash || hash(claimToken),
      createdAt: current?.createdAt || new Date(now()).toISOString(),
      updatedAt: new Date(now()).toISOString(),
      expiresAt
    });
    logEvent(current ? 'publish.update' : 'publish.create', { eventId: req.eventId, handleKey: handleKey(handle), activeDays: req.body.summary.activeDays || 0, modelCount: req.body.summary.modelCount || 0 });
    res.json({ url: `https://mycx.dev/tokount/${handle}`, expiresAt, ...(claimToken ? { claimToken } : {}) });
  });

  app.get('/tokount/:handle', async (req, res) => {
    const handle = String(req.params.handle || '').toLowerCase();
    if (!HANDLE.test(handle)) return res.status(404).type('html').send('Not found');
    const doc = await store.get(handle);
    if (!doc) { logEvent('story.missing', { eventId: req.eventId, handleKey: handleKey(handle) }); return res.status(404).type('html').send(landing.replace('</body>', `<script>document.body.dataset.missing=${safeJson(handle)}</script></body>`)); }
    if (Date.parse(doc.expiresAt) <= now()) {
      logEvent('story.expired', { eventId: req.eventId, handleKey: handleKey(handle) });
      return res.status(410).type('html').send(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>@${handle} · tokount expired</title><style>body{margin:0;background:#0b0b0f;color:#f6f1e7;font:700 clamp(24px,6vw,72px) system-ui;display:grid;min-height:100vh;place-items:center;padding:8vw}a{color:#d4ff3a}</style><main>@${handle}’s tokount expired.<br><a href="/tokount/">Make your own →</a></main></html>`);
    }
    const html = template
      .replace('/*__DATA__*/null', safeJson(doc.summary))
      .replaceAll('__LOCKUP_WHITE__', lockups.white)
      .replaceAll('__LOCKUP_BLACK__', lockups.black);
    logEvent('story.view', { eventId: req.eventId, handleKey: handleKey(handle) });
    res.type('html').set('cache-control', 'public, max-age=300').send(html);
  });
  app.use((error, req, res, _next) => { logEvent('service.error', { eventId: req.eventId, error: error?.name || 'Error' }, 'ERROR'); res.status(500).json({ error: 'tokount could not complete this request.', requestId: req.eventId }); });
  return app;
}
