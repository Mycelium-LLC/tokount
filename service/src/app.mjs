import crypto from 'node:crypto';
import express from 'express';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { emitOps } from './ops.mjs';
import { landingSvg, png, short, storySvg } from './og.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const DAY = 86_400_000;
const SITE = 'https://mycx.dev/tokount';
const HANDLE = /^[a-z0-9](?:[a-z0-9._-]{0,37}[a-z0-9])?$/;
const hash = token => crypto.createHash('sha256').update(token).digest('hex');
const safeJson = value => JSON.stringify(value).replaceAll('<', '\\u003c').replaceAll('>', '\\u003e');
const attr = value => String(value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
export const VERSION = pkg.version;
export const COMMIT = process.env.COMMIT_SHA || 'dev';
const revision = process.env.K_REVISION || 'local';
const logEvent = (event, fields = {}, severity = 'INFO') => console.log(JSON.stringify({ severity, event, release: VERSION, revision, ...fields }));
const handleKey = handle => hash(`tokount:${handle}`).slice(0, 12);

function validateSummary(summary, handle) {
  if (!summary || summary.schemaVersion !== 1 || summary.handle !== handle) return 'summary does not match this handle';
  if (!summary.totals || !Number.isFinite(summary.totals.totalTokens) || !Array.isArray(summary.models)) return 'summary is incomplete';
  if (Buffer.byteLength(JSON.stringify(summary)) > 100_000) return 'summary is too large';
  return null;
}

/** CLI run telemetry: counts only. Anything else in the body is dropped, never logged. */
const TELEMETRY_COMMANDS = new Set(['publish', 'dry-run', 'doctor', 'help', 'version']);
const ADAPTER_COUNTS = ['files', 'records', 'accepted', 'skipped', 'duplicates', 'invalidJson', 'unreadable', 'ms'];
function cleanTelemetry(body) {
  const word = (value, max = 40) => (typeof value === 'string' && /^[A-Za-z0-9._-]{1,40}$/.test(value) ? value.slice(0, max) : null);
  const count = value => (Number.isFinite(value) && value >= 0 ? Math.min(Math.round(value), 1e12) : null);
  if (!body || !TELEMETRY_COMMANDS.has(body.command) || !word(body.version)) return null;
  return {
    cliVersion: word(body.version), os: word(body.os), arch: word(body.arch), node: count(body.node),
    command: body.command, durationMs: count(body.durationMs), error: body.error === null ? null : word(body.error),
    adapters: (Array.isArray(body.adapters) ? body.adapters.slice(0, 8) : []).map(adapter => ({
      agent: word(adapter?.agent), schema: word(adapter?.schema, 60), found: adapter?.found === true,
      ...Object.fromEntries(ADAPTER_COUNTS.map(field => [field, count(adapter?.[field])]))
    }))
  };
}

function storyHead(handle, summary) {
  const title = `@${handle}’s tokount: ${short(summary.totals.totalTokens)} tokens`;
  const days = summary.activeDays ? ` over ${summary.activeDays} active days` : '';
  const description = `${short(summary.totals.totalTokens)} tokens of Claude Code, Codex and Gemini${days}. Make your own with npx tokount.`;
  const url = `${SITE}/${handle}`;
  const image = `${url}/og.png?v=${encodeURIComponent(summary.generated || '')}`;
  return `<title>${attr(title)}</title>
<meta name="description" content="${attr(description)}">
<meta name="robots" content="noindex, follow">
<link rel="canonical" href="${url}">
<meta property="og:type" content="profile">
<meta property="og:site_name" content="tokount">
<meta property="og:title" content="${attr(title)}">
<meta property="og:description" content="${attr(description)}">
<meta property="og:url" content="${url}">
<meta property="og:image" content="${attr(image)}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="${attr(`${handle}’s tokount story card`)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${attr(title)}">
<meta name="twitter:description" content="${attr(description)}">
<meta name="twitter:image" content="${attr(image)}">`;
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
  let landingImage = null;
  const storyImages = new Map();
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', true);
  app.use(express.json({ limit: '128kb' }));
  app.use((req, res, next) => { req.eventId = crypto.randomUUID(); res.set('x-request-id', req.eventId); next(); });

  const health = (_req, res) => res.json({ ok: true, app: 'tokount', version: VERSION, commit: COMMIT });
  app.get(['/api/health', '/api/tokount/health'], health);
  app.get('/tokount/version.json', (_req, res) => res.json({ app: 'tokount', version: VERSION, commit: COMMIT, builtAt: process.env.BUILT_AT || null }));
  app.get('/tokount/brand.svg', (_req, res) => res.type('svg').set('cache-control', 'public, max-age=86400').send(white));
  app.get(['/tokount', '/tokount/'], (req, res) => { logEvent('landing.view', { eventId: req.eventId }); res.type('html').set('cache-control', 'public, max-age=300').send(landing); });
  app.get('/tokount/og.png', (_req, res) => {
    landingImage ||= png(landingSvg());
    res.type('png').set('cache-control', 'public, max-age=86400').send(landingImage);
  });

  app.post('/api/tokount/telemetry', (req, res) => {
    const run = cleanTelemetry(req.body);
    if (!run) return res.status(400).json({ error: 'telemetry is not in the expected shape' });
    logEvent('cli.run', { eventId: req.eventId, ...run }, run.error ? 'WARNING' : 'INFO');
    res.status(204).end();
  });

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
    storyImages.delete(handle);
    logEvent(current ? 'publish.update' : 'publish.create', { eventId: req.eventId, handleKey: handleKey(handle), activeDays: req.body.summary.activeDays || 0, modelCount: req.body.summary.modelCount || 0 });
    res.json({ url: `${SITE}/${handle}`, expiresAt, ...(claimToken ? { claimToken } : {}) });
  });

  /** A live story, or null after sending the 404/410 page. */
  async function liveStory(req, res) {
    const handle = String(req.params.handle || '').toLowerCase();
    if (!HANDLE.test(handle)) { res.status(404).type('html').send('Not found'); return null; }
    const doc = await store.get(handle);
    if (!doc) {
      logEvent('story.missing', { eventId: req.eventId, handleKey: handleKey(handle) });
      res.status(404).type('html').send(landing.replace('<meta name="robots" content="index, follow">', '<meta name="robots" content="noindex">').replace('</body>', `<script>document.body.dataset.missing=${safeJson(handle)}</script></body>`));
      return null;
    }
    if (Date.parse(doc.expiresAt) <= now()) {
      logEvent('story.expired', { eventId: req.eventId, handleKey: handleKey(handle) });
      res.status(410).type('html').send(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta name="robots" content="noindex"><title>@${handle} · tokount expired</title><style>body{margin:0;background:#0b0b0f;color:#f6f1e7;font:700 clamp(24px,6vw,72px) system-ui;display:grid;min-height:100vh;place-items:center;padding:8vw}a{color:#d4ff3a}</style><main>@${handle}’s tokount expired.<br><a href="/tokount/">Make your own →</a></main></html>`);
      return null;
    }
    return { handle, doc };
  }

  app.get('/tokount/:handle/og.png', async (req, res) => {
    const story = await liveStory(req, res);
    if (!story) return;
    const key = `${story.handle}:${story.doc.updatedAt}`;
    let image = storyImages.get(story.handle);
    if (image?.key !== key) {
      image = { key, png: png(storySvg(story.handle, story.doc.summary)) };
      storyImages.set(story.handle, image);
      if (storyImages.size > 200) storyImages.delete(storyImages.keys().next().value);
    }
    res.type('png').set('cache-control', 'public, max-age=3600').send(image.png);
  });

  app.get('/tokount/:handle', async (req, res) => {
    const story = await liveStory(req, res);
    if (!story) return;
    const html = template
      .replace('<title>tokount</title>', storyHead(story.handle, story.doc.summary))
      .replace('/*__DATA__*/null', safeJson(story.doc.summary))
      .replaceAll('__LOCKUP_WHITE__', lockups.white)
      .replaceAll('__LOCKUP_BLACK__', lockups.black);
    logEvent('story.view', { eventId: req.eventId, handleKey: handleKey(story.handle) });
    res.type('html').set('cache-control', 'public, max-age=300').send(html);
  });

  app.use((error, req, res, _next) => {
    logEvent('service.error', { eventId: req.eventId, error: error?.name || 'Error', route: req.route?.path || null }, 'ERROR');
    emitOps({ type: 'tokount.request_failed', severity: 'error', eventId: req.eventId, correlationId: req.eventId, payload: { error: error?.name || 'Error', message: String(error?.message || '').slice(0, 300), route: req.route?.path || null } });
    res.status(500).json({ error: 'tokount could not complete this request.', requestId: req.eventId });
  });
  return app;
}
