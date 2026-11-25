import { diagnostic, event, listFiles, readJson, toSessions, validTimestamp } from './shared.mjs';

/**
 * Gemini CLI saves each chat as JSON under <home>/.gemini/tmp/<project-hash>/chats/.
 * A `gemini` message carries tokens { input, output, cached, thoughts, tool, total };
 * input includes the cached part, so fresh input is input - cached.
 */
export const GEMINI_SCHEMA = 'gemini-chat-message-v2';

export async function collectGemini(roots) {
  const started = Date.now();
  const report = diagnostic('gemini', GEMINI_SCHEMA);
  report.roots = roots.length;
  const files = await listFiles(roots, (name, path) => name.endsWith('.json') && /[\\/]chats[\\/]/.test(path));
  report.files = files.length;
  const events = [];

  for (const path of files) {
    const document = await readJson(path, report);
    if (!document || !Array.isArray(document.messages) || !document.sessionId) { report.skipped++; continue; }
    report.found = true;
    for (const message of document.messages) {
      report.records++;
      if (message?.type !== 'gemini' || !message.tokens || !validTimestamp(message.timestamp) || typeof message.model !== 'string') { report.skipped++; continue; }
      const cached = message.tokens.cached || 0;
      const item = event({
        agent: 'gemini', sessionId: String(document.sessionId), timestamp: message.timestamp, model: message.model,
        input: Math.max(0, (message.tokens.input || 0) - cached), output: message.tokens.output,
        cacheRead: cached, cacheWrite: 0
      });
      if (!item.totalTokens) { report.skipped++; continue; }
      events.push(item);
      report.accepted++;
    }
  }
  report.ms = Date.now() - started;
  return { events, sessions: toSessions(events), report };
}
