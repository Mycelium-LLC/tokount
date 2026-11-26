import { Resvg } from '@resvg/resvg-js';
import { fileURLToPath } from 'node:url';

/**
 * Share images, 1200×630 PNG, drawn from an SVG in the story card's language: violet ground,
 * a lime sun, a magma moon, the ghost of the big number behind the type. Fonts are bundled
 * (OFL) so the server never depends on system fonts.
 */
const font = name => fileURLToPath(new URL(`../fonts/${name}`, import.meta.url));
const FONTS = ['BricolageGrotesque-ExtraBold.ttf', 'JetBrainsMono-Regular.ttf', 'JetBrainsMono-Bold.ttf'].map(font);
const W = 1200, H = 630;
const C = { ink: '#0b0b0f', cream: '#f6f1e7', lime: '#d4ff3a', violet: '#5b2bff', magma: '#ff3d2e' };
const D = 'Bricolage Grotesque', M = 'JetBrains Mono';

const esc = value => String(value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
export const short = n => {
  for (const [size, unit] of [[1e12, 'T'], [1e9, 'B'], [1e6, 'M'], [1e3, 'K']]) {
    if (n >= size) return `${(n / size).toFixed(n / size >= 100 ? 0 : 1).replace(/\.0$/, '')}${unit}`;
  }
  return String(Math.round(n));
};
const usd = n => (n >= 1000 ? `$${short(n)}` : `$${Math.round(n)}`);
/** The largest size, up to `size`, at which `text` fits `max` pixels (an average glyph is ~`ratio` em). */
const fit = (text, max, size, ratio = 0.56) => Math.min(size, Math.floor(max / Math.max(1, String(text).length * ratio)));

function frame(inner, ghost) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" fill="${C.violet}"/>
  <circle cx="1130" cy="40" r="250" fill="${C.lime}"/>
  <circle cx="-30" cy="640" r="150" fill="${C.magma}"/>
  <text x="640" y="520" text-anchor="middle" font-family="${D}" font-weight="800" font-size="${fit(ghost, 1300, 400, 0.62)}" fill="#ffffff" fill-opacity="0.07" transform="rotate(-6 640 400)">${esc(ghost)}</text>
  ${inner}
</svg>`;
}

const stat = (x, y, value, label, color = C.cream) => `
  <text x="${x}" y="${y}" font-family="${D}" font-weight="800" font-size="${fit(value, 250, 54)}" fill="${color}">${esc(value)}</text>
  <text x="${x}" y="${y + 34}" font-family="${M}" font-size="18" letter-spacing="2" fill="${C.cream}" fill-opacity="0.65">${esc(label.toUpperCase())}</text>`;

/** The image for one person's story. */
export function storySvg(handle, summary) {
  const title = `${handle}’s`;
  const tokens = short(summary.totals?.totalTokens || 0);
  return frame(`
  <text x="72" y="96" font-family="${M}" font-weight="700" font-size="26" fill="${C.cream}">@${esc(handle)}</text>
  <text x="72" y="132" font-family="${M}" font-size="20" fill="${C.cream}" fill-opacity="0.75">${esc(`${summary.first} → ${summary.last}`)}</text>
  <text x="64" y="270" font-family="${D}" font-weight="800" font-size="${fit(title, 1000, 124, 0.55)}" fill="${C.cream}">${esc(title)}</text>
  <text x="64" y="384" font-family="${D}" font-weight="800" font-size="124" fill="${C.lime}">tokount.</text>
  <rect x="48" y="430" width="1104" height="160" rx="36" fill="${C.ink}"/>
  ${stat(96, 512, tokens, 'tokens', C.lime)}
  ${stat(370, 512, usd(summary.totals?.totalCost || 0), 'at list price')}
  ${stat(620, 512, summary.models?.[0]?.name || '—', 'top model')}
  ${stat(930, 512, `${summary.streak?.days || 0} days`, 'longest streak')}`, tokens);
}

/** The image for the landing page. */
export function landingSvg() {
  return frame(`
  <text x="72" y="110" font-family="${M}" font-weight="700" font-size="24" letter-spacing="3" fill="${C.cream}">YOUR AI CODING YEAR, COUNTED</text>
  <text x="60" y="300" font-family="${D}" font-weight="800" font-size="196" fill="${C.cream}">tokount<tspan fill="${C.lime}">.</tspan></text>
  <text x="72" y="372" font-family="${D}" font-weight="800" font-size="40" fill="${C.cream}">Claude Code, Codex and Gemini history, as a story.</text>
  <rect x="48" y="440" width="1104" height="130" rx="65" fill="${C.ink}"/>
  <text x="104" y="522" font-family="${M}" font-weight="700" font-size="42" fill="${C.lime}">$</text>
  <text x="150" y="522" font-family="${M}" font-weight="700" font-size="42" fill="${C.cream}">npx tokount --handle yourname</text>`, '');
}

export function png(svg) {
  return new Resvg(svg, { fitTo: { mode: 'width', value: W }, font: { fontFiles: FONTS, loadSystemFonts: false, defaultFontFamily: D } }).render().asPng();
}
