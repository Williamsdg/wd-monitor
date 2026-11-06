// Lighthouse performance results, rolled up one entry per site per day.

const ms = v => (typeof v === 'number' ? Math.round(v) : null);

export function parseLighthouse(lhr) {
  const a = lhr?.audits || {};
  const score = lhr?.categories?.performance?.score;
  const cls = a['cumulative-layout-shift']?.numericValue;
  return {
    score: typeof score === 'number' ? Math.round(score * 100) : null,
    lcp: ms(a['largest-contentful-paint']?.numericValue),
    cls: typeof cls === 'number' ? Math.round(cls * 1000) / 1000 : null,
    tbt: ms(a['total-blocking-time']?.numericValue),
    fcp: ms(a['first-contentful-paint']?.numericValue),
    si: ms(a['speed-index']?.numericValue),
  };
}

export function rollVitals(vitals, slug, day, entry, { keepDays = 90 } = {}) {
  const site = vitals[slug] || { latest: null, history: [] };
  const history = site.history.filter(h => h.day !== day);
  history.push({ day, ...entry });
  history.sort((x, y) => (x.day < y.day ? -1 : x.day > y.day ? 1 : 0));
  const trimmed = history.slice(-keepDays);
  return { ...vitals, [slug]: { latest: trimmed[trimmed.length - 1], history: trimmed } };
}
