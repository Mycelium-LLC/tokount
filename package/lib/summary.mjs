import { collectHistory } from './collectors/index.mjs';
import { estimateCost } from './prices.mjs';

const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
const dayFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
const hourFormatter = new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: '2-digit', hourCycle: 'h23' });
const weekdayFormatter = new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'short' });
const weekdayIndex = new Map([['Mon', 0], ['Tue', 1], ['Wed', 2], ['Thu', 3], ['Fri', 4], ['Sat', 5], ['Sun', 6]]);

const localDay = value => dayFormatter.format(new Date(value));
const monthKey = value => String(value).slice(0, 7);
const prettyModel = id => id.replace(/^claude-/, '').replace(/^gemini-/, 'Gemini ').replace(/^gpt-/, 'GPT-').split('-').map((part, index) => index ? part : part[0]?.toUpperCase() + part.slice(1)).join(' ');
const emptyTokens = () => ({ inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, totalTokens: 0, totalCost: 0 });
const addTokens = (target, item, cost = estimateCost(item)) => {
  target.inputTokens += item.inputTokens;
  target.outputTokens += item.outputTokens;
  target.cacheReadTokens += item.cacheReadTokens;
  target.cacheCreationTokens += item.cacheCreationTokens;
  target.totalTokens += item.totalTokens;
  target.totalCost += cost;
};

export async function collectSummary({ handle, history } = {}) {
  const source = history || await collectHistory();
  const events = source.events;
  if (!events.length) throw new Error('No supported Claude Code, Codex, or Gemini usage history was found. Run `tokount doctor` for details.');

  const totals = emptyTokens();
  const dayMap = new Map();
  const agentMap = new Map();
  const modelMap = new Map();
  const eraMonths = new Map();
  const months = new Map();
  const monthOut = new Map();
  const weekday = Array(7).fill(0);
  const heat = Array.from({ length: 7 }, () => Array(24).fill(0));
  const sessionCosts = new Map();

  for (const item of events) {
    const cost = estimateCost(item);
    const day = localDay(item.timestamp);
    const month = monthKey(day);
    const weekdayNumber = weekdayIndex.get(weekdayFormatter.format(new Date(item.timestamp)));
    const hour = Number(hourFormatter.format(new Date(item.timestamp)));
    addTokens(totals, item, cost);
    weekday[weekdayNumber] += item.totalTokens;
    heat[weekdayNumber][hour] += item.totalTokens;

    const dayRow = dayMap.get(day) || { period: day, ...emptyTokens(), models: new Set() };
    addTokens(dayRow, item, cost); dayRow.models.add(item.model); dayMap.set(day, dayRow);
    const agent = agentMap.get(item.agent) || { name: item.agent, cost: 0, tokens: 0, daySet: new Set() };
    agent.cost += cost; agent.tokens += item.totalTokens; agent.daySet.add(day); agentMap.set(item.agent, agent);
    const model = modelMap.get(item.model) || { id: item.model, name: prettyModel(item.model), cost: 0, tokens: 0, out: 0, first: day, last: day, daySet: new Set(), agent: item.agent };
    model.cost += cost; model.tokens += item.totalTokens; model.out += item.outputTokens; model.first = model.first < day ? model.first : day; model.last = model.last > day ? model.last : day; model.daySet.add(day); modelMap.set(item.model, model);
    const era = eraMonths.get(month) || new Map(); era.set(item.model, (era.get(item.model) || 0) + item.totalTokens); eraMonths.set(month, era);
    const agentMonth = months.get(month) || { month }; agentMonth[item.agent] = (agentMonth[item.agent] || 0) + cost; months.set(month, agentMonth);
    const outputMonth = monthOut.get(month) || { month, out: 0, cost: 0, daySet: new Set() };
    outputMonth.out += item.outputTokens; outputMonth.cost += cost; outputMonth.daySet.add(day); monthOut.set(month, outputMonth);
    const sessionKey = `${item.agent}:${item.sessionId}`; sessionCosts.set(sessionKey, (sessionCosts.get(sessionKey) || 0) + cost);
  }

  const rows = [...dayMap.values()].sort((a, b) => a.period.localeCompare(b.period));
  const days = rows.map(row => row.period);
  const streak = longestStreak(days);
  const models = [...modelMap.values()].map(model => ({ ...model, days: model.daySet.size, daySet: undefined })).sort((a, b) => b.tokens - a.tokens);
  const eras = dominantEras(eraMonths);
  const agents = [...agentMap.values()].map(agent => ({ name: agent.name, cost: agent.cost, tokens: agent.tokens, days: agent.daySet.size })).sort((a, b) => b.tokens - a.tokens);
  const sessions = source.sessions || [];
  const sessionsByAgent = {};
  const sessMonths = new Map();
  for (const session of sessions) {
    sessionsByAgent[session.agent] = (sessionsByAgent[session.agent] || 0) + 1;
    const month = monthKey(localDay(session.first));
    const row = sessMonths.get(month) || { month, n: 0, out: 0 };
    row.n++; row.out += session.outputTokens || 0; sessMonths.set(month, row);
  }
  const claudeSessions = sessions.filter(session => session.agent === 'claude');
  const durationHours = session => Math.max(0, (new Date(session.last) - new Date(session.first)) / 3_600_000);
  const topSession = [...claudeSessions].sort((a, b) => (sessionCosts.get(`claude:${b.id}`) || 0) - (sessionCosts.get(`claude:${a.id}`) || 0))[0];
  const longestSession = [...claudeSessions].sort((a, b) => durationHours(b) - durationHours(a))[0];
  const bigDay = [...rows].sort((a, b) => b.totalTokens - a.totalTokens)[0];
  const byHour = Array.from({ length: 24 }, (_, hour) => heat.reduce((sum, row) => sum + row[hour], 0));
  const totalHour = byHour.reduce((sum, value) => sum + value, 0) || 1;
  const firstDate = new Date(`${days[0]}T12:00:00Z`);
  const lastDate = new Date(`${days.at(-1)}T12:00:00Z`);

  return {
    schemaVersion: 1, handle, generated: new Date().toISOString(), tz: TZ, first: days[0], last: days.at(-1), span: Math.round((lastDate - firstDate) / 86_400_000) + 1, activeDays: days.length,
    totals, cacheShare: totals.cacheReadTokens / Math.max(1, totals.totalTokens), streak,
    bigDay: { date: bigDay.period, cost: bigDay.totalCost, tokens: bigDay.totalTokens, models: [...bigDay.models].map(prettyModel) }, bigTokDay: { date: bigDay.period, tokens: bigDay.totalTokens },
    agents, models: models.slice(0, 8), modelCount: models.length, eras,
    months: [...months.values()].sort((a, b) => a.month.localeCompare(b.month)),
    monthOut: [...monthOut.values()].map(row => ({ month: row.month, out: row.out, cost: row.cost, days: row.daySet.size })).sort((a, b) => a.month.localeCompare(b.month)),
    sessMonths: [...sessMonths.values()].sort((a, b) => a.month.localeCompare(b.month)), sessionsByAgent, sessionsAll: sessions.length,
    today: localDay(new Date()), weekday, heat, byHour, peakHour: byHour.indexOf(Math.max(...byHour)), night: [...byHour.slice(22), ...byHour.slice(0, 5)].reduce((sum, value) => sum + value, 0) / totalHour, morning: byHour.slice(5, 10).reduce((sum, value) => sum + value, 0) / totalHour,
    sessions: { count: sessionsByAgent.claude || 0, top: { cost: topSession ? sessionCosts.get(`claude:${topSession.id}`) || 0 : 0, tokens: topSession?.totalTokens || 0, first: topSession?.first || days[0], last: topSession?.last || days.at(-1) }, longestHours: longestSession ? durationHours(longestSession) : 0 },
    projects: [], words: totals.outputTokens * 0.75
  };
}

function longestStreak(days) {
  const set = new Set(days);
  let best = 0, run = 0, bestEnd = days[0];
  for (let date = new Date(`${days[0]}T12:00:00Z`), end = new Date(`${days.at(-1)}T12:00:00Z`); date <= end; date.setUTCDate(date.getUTCDate() + 1)) {
    const key = date.toISOString().slice(0, 10);
    if (set.has(key)) { run++; if (run > best) { best = run; bestEnd = key; } } else run = 0;
  }
  const start = new Date(`${bestEnd}T12:00:00Z`); start.setUTCDate(start.getUTCDate() - best + 1);
  return { days: best, from: start.toISOString().slice(0, 10), to: bestEnd };
}

function dominantEras(source) {
  const eras = [];
  for (const [month, breakdown] of [...source.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const id = [...breakdown.entries()].sort((a, b) => b[1] - a[1])[0][0];
    if (eras.at(-1)?.id === id) eras.at(-1).to = month;
    else eras.push({ id, name: prettyModel(id), from: month, to: month });
  }
  return eras;
}
