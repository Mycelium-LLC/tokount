import { VERSION } from './version.mjs';

/**
 * Optional run telemetry, sent once per run through the tokount service, which logs it for
 * HQ Ops. It holds the version, OS family, Node major, the command, its duration, a stable
 * error code, and each adapter's counts and schema. Never a path, handle, model, prompt,
 * response or token count. Off with TOKOUNT_TELEMETRY=0 (or DO_NOT_TRACK=1).
 */
export function telemetryEnabled(env = process.env) {
  return env.TOKOUNT_TELEMETRY !== '0' && env.TOKOUNT_TELEMETRY !== 'false' && env.DO_NOT_TRACK !== '1';
}

const ADAPTER_FIELDS = ['agent', 'schema', 'found', 'files', 'records', 'accepted', 'skipped', 'duplicates', 'invalidJson', 'unreadable', 'ms'];

export function telemetryPayload({ command, durationMs, error = null, reports = [] }) {
  return {
    version: VERSION,
    os: process.platform,
    arch: process.arch,
    node: Number(process.versions.node.split('.')[0]),
    command,
    durationMs: Math.round(durationMs),
    error,
    adapters: reports.map(report => Object.fromEntries(ADAPTER_FIELDS.map(field => [field, report[field]])))
  };
}

/** Fire and forget: a short timeout, no retry, and a failure never reaches the user. */
export async function sendTelemetry(api, payload, env = process.env) {
  if (!telemetryEnabled(env)) return false;
  try {
    const response = await fetch(`${api}/telemetry`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(2500)
    });
    return response.ok;
  } catch {
    return false;
  }
}
