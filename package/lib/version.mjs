import { readFileSync } from 'node:fs';

const read = name => { try { return JSON.parse(readFileSync(new URL(name, import.meta.url), 'utf8')); } catch { return {}; } };

/** The package version, and the commit the publish workflow stamps into build.json. */
export const VERSION = read('../package.json').version || '0.0.0';
export const COMMIT = read('./build.json').commit || 'dev';
