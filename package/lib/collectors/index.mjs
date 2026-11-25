import { homedir } from 'node:os';
import { join } from 'node:path';
import { collectClaude } from './claude.mjs';
import { collectCodex } from './codex.mjs';
import { collectGemini } from './gemini.mjs';

const list = value => String(value || '').split(/[,;]/).map(part => part.trim()).filter(Boolean);

/**
 * Where each agent keeps history. The same layout holds on macOS, Linux and Windows
 * (homedir() is %USERPROFILE% there); each tool's own override variable wins.
 * TOKOUNT_HISTORY_HOME points every agent at another home (tests, fixtures).
 */
export function historyRoots(env = process.env) {
  const home = env.TOKOUNT_HISTORY_HOME || homedir();
  const claudeDirs = env.TOKOUNT_HISTORY_HOME ? [] : list(env.CLAUDE_CONFIG_DIR);
  const codexHome = (!env.TOKOUNT_HISTORY_HOME && env.CODEX_HOME) || join(home, '.codex');
  const geminiHome = (!env.TOKOUNT_HISTORY_HOME && env.GEMINI_CLI_HOME) || join(home, '.gemini');
  return {
    claude: (claudeDirs.length ? claudeDirs : [join(home, '.claude'), join(home, '.config', 'claude')]).map(dir => join(dir, 'projects')),
    codex: [join(codexHome, 'sessions'), join(codexHome, 'archived_sessions')],
    gemini: [join(geminiHome, 'tmp')]
  };
}

export async function collectHistory({ env = process.env } = {}) {
  const roots = historyRoots(env);
  const results = await Promise.all([
    collectClaude(roots.claude),
    collectCodex(roots.codex),
    collectGemini(roots.gemini)
  ]);
  return {
    events: results.flatMap(result => result.events).sort((a, b) => a.timestamp.localeCompare(b.timestamp)),
    sessions: results.flatMap(result => result.sessions),
    reports: results.map(result => result.report)
  };
}
