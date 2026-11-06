// Pure history / roll-up / summary functions. Samples are { t, s, ms, code, ssl } with t in epoch seconds.

const TZ = 'America/Chicago';
const dayFmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });

export function dayKey(tSec) {
  return dayFmt.format(new Date(tSec * 1000));
}

export function appendSample(history, sample, { now, maxAgeSec = 30 * 86400 }) {
  const floor = now - maxAgeSec;
  return [...history.filter(h => h.t >= floor), sample];
}

export function rollDaily(daily, slug, sample) {
  const key = dayKey(sample.t);
  const site = { ...(daily[slug] || {}) };
  const d = site[key] || { n: 0, up: 0, down: 0, msSum: 0, msMax: 0, msMin: Infinity };
  const ms = sample.ms ?? 0;
  site[key] = {
    n: d.n + 1,
    up: d.up + (sample.s === 'down' ? 0 : 1),
    down: d.down + (sample.s === 'down' ? 1 : 0),
    msSum: d.msSum + ms,
    msMax: Math.max(d.msMax, ms),
    msMin: Math.min(d.msMin, ms),
  };
  return { ...daily, [slug]: site };
}

export function uptime(history, { now, windowSec }) {
  const inWindow = history.filter(h => h.t >= now - windowSec);
  if (!inWindow.length) return null;
  const good = inWindow.filter(h => h.s !== 'down').length;
  return Math.round((good / inWindow.length) * 1000) / 10;
}

export function lastChange(history) {
  if (!history.length) return null;
  const current = history[history.length - 1].s;
  let i = history.length - 1;
  while (i > 0 && history[i - 1].s === current) i--;
  return history[i].t;
}

function list(names) {
  if (names.length <= 1) return names.join('');
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(', ')}, and ${names[names.length - 1]}`;
}

export function headline({ total, down, degraded, downNames, degradedNames }) {
  if (!down && !degraded) return `All ${total} sites are up.`;
  const parts = [];
  if (down) parts.push(`${down} of ${total} sites ${down === 1 ? 'is' : 'are'} down: ${list(downNames)}.`);
  if (degraded) parts.push(`${degraded} ${degraded === 1 ? 'is' : 'are'} degraded: ${list(degradedNames)}.`);
  if (!down) parts.unshift(`${total - degraded} of ${total} sites are up.`);
  return parts.join(' ');
}

export function buildLatest(sites, histories, { now }) {
  const rows = sites.map(site => {
    const h = histories[site.slug] || [];
    const last = h[h.length - 1];
    return {
      slug: site.slug,
      name: site.name,
      url: site.url,
      owner: site.owner,
      status: last ? last.s : 'unknown',
      ms: last ? last.ms : null,
      httpStatus: last ? last.code : null,
      sslDays: last ? last.ssl : null,
      checkedAt: last ? last.t : null,
      since: lastChange(h),
      uptime24h: uptime(h, { now, windowSec: 24 * 3600 }),
      uptime30d: uptime(h, { now, windowSec: 30 * 86400 }),
      note: last?.note,
    };
  });
  const by = s => rows.filter(r => r.status === s);
  const summary = { total: rows.length, up: by('up').length, degraded: by('degraded').length, down: by('down').length };
  return {
    generatedAt: new Date(now * 1000).toISOString(),
    summary,
    headline: headline({ ...summary, downNames: by('down').map(r => r.name), degradedNames: by('degraded').map(r => r.name) }),
    sites: rows,
  };
}
