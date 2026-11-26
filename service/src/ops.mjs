/**
 * Semantic events to HQ Ops (mycelium-ops docs/EVENTS.md): rare facts a human may need,
 * never per-request logs. The service proves who it is with a Google ID token from the Cloud
 * Run metadata server; there is no key. Fire and forget, short timeout, no retry: a
 * tokount request never waits on, or fails because of, Ops.
 */
const OPS_URL = process.env.OPS_URL || '';
const METADATA = 'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/identity';

export function opsEnabled() { return Boolean(OPS_URL && process.env.K_SERVICE); }

export async function emitOps(event) {
  if (!opsEnabled()) return false;
  try {
    const token = await fetch(`${METADATA}?audience=${encodeURIComponent(OPS_URL)}`, { headers: { 'Metadata-Flavor': 'Google' }, signal: AbortSignal.timeout(1500) }).then(response => response.text());
    const response = await fetch(`${OPS_URL}/v1/events`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ environment: 'production', resource: 'tokount', timestamp: new Date().toISOString(), ...event }),
      signal: AbortSignal.timeout(2500)
    });
    return response.status === 202;
  } catch {
    return false;
  }
}
