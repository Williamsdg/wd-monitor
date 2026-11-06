// Status transitions between two runs, and the alert text they produce.

export function detectTransitions(prevSites, nextSites) {
  const prev = new Map((prevSites || []).map(s => [s.slug, s]));
  const out = [];
  for (const n of nextSites || []) {
    const p = prev.get(n.slug);
    if (!p?.status || p.status === 'unknown' || !n.status || n.status === 'unknown') continue;
    if (p.status === n.status) continue;
    const t = { slug: n.slug, name: n.name, url: n.url, from: p.status, to: n.status };
    if (n.note) t.note = n.note;
    out.push(t);
  }
  return out;
}

export const alertable = t => t.to === 'down' || t.from === 'down';

export function formatDuration(sec) {
  const m = Math.round(sec / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return m % 60 ? `${h} h ${m % 60} min` : `${h} h`;
  const d = Math.floor(h / 24);
  return h % 24 ? `${d} d ${h % 24} h` : `${d} d`;
}

export function formatAlert(transitions, { headline } = {}) {
  const downs = transitions.filter(t => t.to === 'down');
  const ups = transitions.filter(t => t.from === 'down' && t.to !== 'down');
  let title;
  if (downs.length === 1 && !ups.length) title = `${downs[0].name} is down`;
  else if (!downs.length && ups.length === 1) title = `${ups[0].name} is back up`;
  else {
    const parts = [];
    if (downs.length) parts.push(`${downs.length} site${downs.length > 1 ? 's' : ''} down`);
    if (ups.length) parts.push(`${ups.length} recovered`);
    title = parts.join(', ');
  }
  const lines = [];
  for (const d of downs) lines.push(`${d.name}: ${d.note || 'not responding'}`);
  for (const u of ups) lines.push(`${u.name} is back up${u.downForSec ? ` after ${formatDuration(u.downForSec)}` : ''}`);
  if (headline) lines.push(headline);
  return {
    title,
    body: lines.join('\n'),
    priority: downs.length ? 5 : 3,
    tags: [downs.length ? 'rotating_light' : 'white_check_mark'],
  };
}
