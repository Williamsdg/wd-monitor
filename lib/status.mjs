// Pure status rules. A sample is { status, ms, sslDays, expectOk, error }.

export const DEFAULTS = { slowMs: 3000, sslWarnDays: 14 };

export function classify(sample, opts = {}) {
  const { slowMs, sslWarnDays } = { ...DEFAULTS, ...opts };
  if (sample.error) return 'down';
  if (!sample.status || sample.status >= 400) return 'down';
  if (sample.expectOk === false) return 'down';
  if (typeof sample.sslDays === 'number' && sample.sslDays < 0) return 'down';
  if (sample.ms > slowMs) return 'degraded';
  if (typeof sample.sslDays === 'number' && sample.sslDays < sslWarnDays) return 'degraded';
  return 'up';
}

// validTo is the string Node's TLS layer gives for cert.valid_to, e.g. "Dec  5 12:00:00 2026 GMT".
export function daysUntil(validTo, nowMs = Date.now()) {
  const end = Date.parse(validTo);
  if (Number.isNaN(end)) return null;
  return Math.floor((end - nowMs) / 86_400_000);
}
