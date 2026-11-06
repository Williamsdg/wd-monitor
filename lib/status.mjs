// Pure status rules. A sample is { status, ms, sslDays, expectOk, error, domainDays, renderChars, pathsOk }.

export const DEFAULTS = { slowMs: 3000, sslWarnDays: 10, domainWarnDays: 30, minRenderChars: 200 };

const num = v => typeof v === 'number' && !Number.isNaN(v);

export function classify(sample, opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  if (sample.error) return 'down';
  if (!sample.status || sample.status >= 400) return 'down';
  if (sample.expectOk === false) return 'down';
  if (num(sample.sslDays) && sample.sslDays < 0) return 'down';
  if (num(sample.domainDays) && sample.domainDays < 0) return 'down';
  if (num(sample.renderChars) && sample.renderChars < o.minRenderChars) return 'down';
  if (sample.ms > o.slowMs) return 'degraded';
  if (num(sample.sslDays) && sample.sslDays < o.sslWarnDays) return 'degraded';
  if (num(sample.domainDays) && sample.domainDays < o.domainWarnDays) return 'degraded';
  if (sample.pathsOk === false) return 'degraded';
  return 'up';
}

// Several attempts at one site: a single good reading means the site is up; only an unbroken run of failures counts as down.
export function pickSample(samples) {
  return samples.find(s => s.s !== 'down') ?? samples[samples.length - 1];
}

// validTo is the string Node's TLS layer gives for cert.valid_to, e.g. "Dec  5 12:00:00 2026 GMT".
export function daysUntil(validTo, nowMs = Date.now()) {
  const end = Date.parse(validTo);
  if (Number.isNaN(end)) return null;
  return Math.floor((end - nowMs) / 86_400_000);
}
