import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const exec = promisify(execFile);
const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

async function ccusage(args) {
  const { stdout } = await exec('npx', ['--yes', 'ccusage@20.0.51', ...args], {
    maxBuffer: 64 * 1024 * 1024,
    timeout: 8 * 60 * 1000
  });
  return JSON.parse(stdout);
}
const isoDay = value => String(value).slice(0, 10);
const monthKey = value => isoDay(value).slice(0, 7);
const prettyModel = id => id.replace(/^claude-/, '').replace(/^gemini-/, 'Gemini ').replace(/^gpt-/, 'GPT-').split('-').map((p, i) => i ? p : p[0]?.toUpperCase() + p.slice(1)).join(' ');
export async function collectSummary({ handle }) {
  const [daily, sessions, blocks] = await Promise.all([
    ccusage(['daily', '--json', '--by-agent', '-z', TZ]),
    ccusage(['session', '--json', '-z', TZ]),
    ccusage(['blocks', '--json'])
  ]);
  const rows = daily.daily || [];
  if (!rows.length) throw new Error('ccusage did not find any usage history.');
  const totals = daily.totals;
  const days = rows.map(r => r.period).sort();
  const daySet = new Set(days);
  let best = 0, run = 0, bestEnd = days[0];
  for (let d = new Date(`${days[0]}T12:00:00Z`), end = new Date(`${days.at(-1)}T12:00:00Z`); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    const key = d.toISOString().slice(0, 10);
    if (daySet.has(key)) { run++; if (run > best) { best = run; bestEnd = key; } } else run = 0;
  }
  const bestStartDate = new Date(`${bestEnd}T12:00:00Z`);
  bestStartDate.setUTCDate(bestStartDate.getUTCDate() - best + 1);
  const agentMap = new Map(), modelMap = new Map(), eraMonths = new Map(), months = new Map(), monthOut = new Map(), weekday = Array(7).fill(0);
  for (const row of rows) {
    const date = new Date(`${row.period}T12:00:00Z`);
    weekday[(date.getUTCDay() + 6) % 7] += row.totalTokens || 0;
    const mk = monthKey(row.period), mo = monthOut.get(mk) || { month: mk, out: 0, cost: 0, days: 0 };
    mo.out += row.outputTokens || 0; mo.cost += row.totalCost || 0; mo.days++; monthOut.set(mk, mo);
    for (const a of row.agents || []) {
      const ag = agentMap.get(a.agent) || { name: a.agent, cost: 0, tokens: 0, days: 0 };
      ag.cost += a.totalCost || 0; ag.tokens += a.totalTokens || 0; ag.days++; agentMap.set(a.agent, ag);
      const mm = months.get(mk) || { month: mk }; mm[a.agent] = (mm[a.agent] || 0) + (a.totalCost || 0); months.set(mk, mm);
      for (const mb of a.modelBreakdowns || []) {
        const modelTokens = (mb.inputTokens || 0) + (mb.outputTokens || 0) + (mb.cacheReadTokens || 0) + (mb.cacheCreationTokens || 0);
        const m = modelMap.get(mb.modelName) || { id: mb.modelName, name: prettyModel(mb.modelName), cost: 0, tokens: 0, out: 0, first: row.period, last: row.period, days: 0, agent: a.agent };
        m.cost += mb.cost || 0; m.tokens += modelTokens; m.out += mb.outputTokens || 0; m.days++; m.first = m.first < row.period ? m.first : row.period; m.last = m.last > row.period ? m.last : row.period; modelMap.set(mb.modelName, m);
        const em = eraMonths.get(mk) || new Map(); em.set(mb.modelName, (em.get(mb.modelName) || 0) + modelTokens); eraMonths.set(mk, em);
      }
    }
  }
  const models = [...modelMap.values()].sort((a, b) => b.tokens - a.tokens);
  const eras = [];
  for (const [month, breakdown] of [...eraMonths.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const id = [...breakdown.entries()].sort((a, b) => b[1] - a[1])[0][0];
    if (eras.at(-1)?.id === id) eras.at(-1).to = month; else eras.push({ id, name: prettyModel(id), from: month, to: month });
  }
  const sessionRows = sessions.sessions || sessions.session || [];
  const sessionsByAgent = {}, sessMonths = new Map();
  const claudeSessions = [];
  for (const s of sessionRows) {
    const agent = s.agent || 'claude'; sessionsByAgent[agent] = (sessionsByAgent[agent] || 0) + 1;
    const mk = monthKey(s.firstActivity || s.lastActivity || days.at(-1)); const sm = sessMonths.get(mk) || { month: mk, n: 0, out: 0 }; sm.n++; sm.out += s.outputTokens || 0; sessMonths.set(mk, sm);
    if (agent === 'claude') {
      claudeSessions.push(s);
    }
  }
  const blockRows = blocks.blocks || [], heat = Array.from({ length: 7 }, () => Array(24).fill(0));
  for (const b of blockRows) {
    if (b.isGap) continue;
    const start = new Date(b.startTime), end = new Date(b.actualEndTime || b.endTime), hours = Math.max(1, Math.floor((end - start) / 3600000) + 1), share = (b.totalTokens || 0) / hours;
    for (let i = 0; i < hours; i++) { const t = new Date(start.getTime() + i * 3600000); heat[(t.getDay() + 6) % 7][t.getHours()] += share; }
  }
  const byHour = Array.from({ length: 24 }, (_, h) => heat.reduce((sum, row) => sum + row[h], 0));
  const totalHour = byHour.reduce((a, b) => a + b, 0) || 1;
  const bigDay = [...rows].sort((a, b) => b.totalTokens - a.totalTokens)[0];
  const firstDate = new Date(`${days[0]}T12:00:00Z`), lastDate = new Date(`${days.at(-1)}T12:00:00Z`);
  const durationHours = s => Math.max(0, (new Date(s.lastActivity) - new Date(s.firstActivity)) / 3_600_000);
  const topSession = [...claudeSessions].sort((a, b) => (b.totalCost || 0) - (a.totalCost || 0))[0] || {};
  const longestSession = [...claudeSessions].sort((a, b) => durationHours(b) - durationHours(a))[0] || {};
  return {
    schemaVersion: 1, handle, generated: new Date().toISOString(), tz: TZ, first: days[0], last: days.at(-1), span: Math.round((lastDate - firstDate) / 86400000) + 1, activeDays: days.length,
    totals, cacheShare: (totals.cacheReadTokens || 0) / Math.max(1, totals.totalTokens || 1), streak: { days: best, from: bestStartDate.toISOString().slice(0, 10), to: bestEnd },
    bigDay: { date: bigDay.period, cost: bigDay.totalCost, tokens: bigDay.totalTokens, models: (bigDay.modelsUsed || []).map(prettyModel) }, bigTokDay: { date: bigDay.period, tokens: bigDay.totalTokens },
    agents: [...agentMap.values()].sort((a, b) => b.cost - a.cost), models: models.slice(0, 8), modelCount: models.length, eras,
    months: [...months.values()].sort((a, b) => a.month.localeCompare(b.month)), monthOut: [...monthOut.values()].sort((a, b) => a.month.localeCompare(b.month)), sessMonths: [...sessMonths.values()].sort((a, b) => a.month.localeCompare(b.month)), sessionsByAgent, sessionsAll: sessionRows.length,
    today: new Date().toISOString().slice(0, 10), weekday, heat, byHour, peakHour: byHour.indexOf(Math.max(...byHour)), night: [...byHour.slice(22), ...byHour.slice(0, 5)].reduce((a, b) => a + b, 0) / totalHour, morning: byHour.slice(5, 10).reduce((a, b) => a + b, 0) / totalHour,
    sessions: { count: sessionsByAgent.claude || 0, top: { cost: topSession.totalCost || 0, tokens: topSession.totalTokens || 0, first: topSession.firstActivity || days[0], last: topSession.lastActivity || days.at(-1) }, longestHours: durationHours(longestSession) },
    projects: [], words: (totals.outputTokens || 0) * 0.75
  };
}
