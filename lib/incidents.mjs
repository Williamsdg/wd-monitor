// Incident log: one entry per outage, opened on a down transition and closed on recovery.

const MAX = 200;

export function openIncident(incidents, slug) {
  return incidents.find(i => i.slug === slug && i.endedAt === null);
}

export function updateIncidents(incidents, transitions, { now }) {
  let out = incidents.map(i => ({ ...i }));
  for (const t of transitions) {
    if (t.to === 'down') {
      if (openIncident(out, t.slug)) continue;
      out.push({ id: `${t.slug}-${now}`, slug: t.slug, name: t.name, startedAt: now, endedAt: null, note: t.note ?? null, diagnosis: null });
    } else if (t.from === 'down') {
      const open = openIncident(out, t.slug);
      if (open) open.endedAt = now;
    }
  }
  if (out.length > MAX) out = out.slice(out.length - MAX);
  return out;
}

export function attachDiagnosis(incidents, id, diagnosis) {
  return incidents.map(i => (i.id === id ? { ...i, diagnosis } : i));
}
