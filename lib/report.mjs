// Monthly client report: figures from the daily roll-ups, rendered in the Williams Digital email template
// (tables + bgcolor attributes, because Gmail strips div backgrounds).

const TZ = 'America/Chicago';
const ym = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit' });

export function previousMonth(nowMs = Date.now()) {
  const [y, m] = ym.format(new Date(nowMs)).split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 2, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function monthLabel(month) {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

export function monthlyStats(daily, month) {
  const days = Object.entries(daily || {}).filter(([k]) => k.startsWith(month + '-')).sort();
  if (!days.length) return null;
  let n = 0, up = 0, down = 0, msSum = 0, maxMs = 0, daysWithDowntime = 0;
  for (const [, d] of days) {
    n += d.n; up += d.up; down += d.down; msSum += d.msSum;
    maxMs = Math.max(maxMs, d.msMax || 0);
    if (d.down > 0) daysWithDowntime++;
  }
  if (!n) return null;
  return {
    checks: n,
    uptime: Math.round((up / n) * 1000) / 10,
    avgMs: Math.round(msSum / n),
    maxMs,
    downChecks: down,
    downtimeMin: down * 15,
    daysWithDowntime,
    daysCovered: days.length,
  };
}

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmtDate = t => new Date(t * 1000).toLocaleString('en-US', { timeZone: TZ, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const fmtDur = (a, b) => { const m = Math.max(1, Math.round((b - a) / 60)); return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`; };

function figure(label, value) {
  return `<td width="25%" valign="top" style="padding:0 8px 0 0"><div style="font-size:11px;font-weight:bold;letter-spacing:1.5px;color:#6366f1">${esc(label)}</div><div style="font-size:26px;font-weight:bold;color:#070710;line-height:1.2;margin-top:4px">${esc(value)}</div></td>`;
}

export function renderReportHtml({ site, month, stats, incidents = [], sslDays, domainDays, vitals, narrative }) {
  const label = monthLabel(month);
  const host = site.url.replace(/^https?:\/\//, '').replace(/\/$/, '');
  const certLine = typeof sslDays === 'number' ? (sslDays < 10 ? `renews in ${sslDays} days` : `valid, ${sslDays} days remaining`) : 'not checked';
  const domainLine = typeof domainDays === 'number' ? `registered for another ${domainDays} days` : 'not checked';
  const perfLine = vitals?.score != null ? `${vitals.score}/100 Lighthouse performance (mobile), largest content paint ${(vitals.lcp / 1000).toFixed(1)} s` : 'not measured this month';
  const incidentRows = incidents.length
    ? incidents.map(i => `<tr><td style="padding:6px 0;border-bottom:1px solid #e5e7eb;font-size:14px">${esc(fmtDate(i.startedAt))}</td><td style="padding:6px 0;border-bottom:1px solid #e5e7eb;font-size:14px">${i.endedAt ? esc(fmtDur(i.startedAt, i.endedAt)) : 'ongoing'}</td><td style="padding:6px 0;border-bottom:1px solid #e5e7eb;font-size:14px;color:#6b7280">${esc(i.note || '')}</td></tr>`).join('')
    : `<tr><td colspan="3" style="padding:6px 0;font-size:14px;color:#6b7280">No outages recorded.</td></tr>`;
  const s = stats || { uptime: null, avgMs: null, checks: 0, downtimeMin: 0 };
  const uptime = s.uptime == null ? 'n/a' : `${s.uptime}%`;
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(site.name)} — ${esc(label)} site report</title></head>
<body style="margin:0;padding:0">
<table width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#f4f4f7" style="background-color:#f4f4f7">
<tr><td bgcolor="#f4f4f7" align="center" style="background-color:#f4f4f7;padding:24px 16px">
<table width="640" cellpadding="0" cellspacing="0" border="0" style="max-width:640px;width:100%;font-family:Helvetica,Arial,sans-serif">
<tr><td bgcolor="#070710" style="background-color:#070710;border-radius:10px 10px 0 0;padding:26px 32px">
  <table cellpadding="0" cellspacing="0" border="0"><tr>
    <td bgcolor="#6366f1" width="4" height="26" style="background-color:#6366f1;border-radius:2px;font-size:0;line-height:0">&nbsp;</td>
    <td style="padding-left:12px;color:#ffffff;font-size:20px;font-weight:bold;letter-spacing:2px">WILLIAMS DIGITAL</td>
  </tr></table>
  <div style="color:#9ca3af;font-size:11px;letter-spacing:1.5px;margin-top:8px">WEB DESIGN &amp; DEVELOPMENT · BIRMINGHAM, AL</div>
</td></tr>
<tr><td bgcolor="#ffffff" style="background-color:#ffffff;border-radius:0 0 10px 10px;padding:32px;color:#333d47;font-size:15px;line-height:1.65">
  <div style="font-size:22px;font-weight:bold;color:#070710;line-height:1.3">${esc(site.name)}: ${esc(label)} site report</div>
  <div style="color:#6b7280;font-size:14px;margin-top:4px">${esc(host)}</div>
  <table width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#f7f7fb" style="background-color:#f7f7fb;border:1px solid #e5e7eb;border-left:4px solid #6366f1;border-radius:8px;margin-top:22px">
    <tr><td style="padding:22px 24px"><table width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
      ${figure('UPTIME', uptime)}${figure('AVG RESPONSE', s.avgMs == null ? 'n/a' : `${s.avgMs} ms`)}${figure('CHECKS RUN', String(s.checks).replace(/\B(?=(\d{3})+(?!\d))/g, ','))}${figure('DOWNTIME', s.downtimeMin ? `${s.downtimeMin} min` : 'none')}
    </tr></table></td></tr>
  </table>
  <p style="margin:22px 0 0">${esc(narrative || `${site.name} was checked every fifteen minutes through ${label}. Uptime was ${uptime} with an average response of ${s.avgMs ?? 'n/a'} ms.`)}</p>
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:22px;font-size:14px">
    <tr><td style="padding:6px 0;border-bottom:1px solid #e5e7eb;color:#6b7280;width:38%">SSL certificate</td><td style="padding:6px 0;border-bottom:1px solid #e5e7eb">${esc(certLine)}</td></tr>
    <tr><td style="padding:6px 0;border-bottom:1px solid #e5e7eb;color:#6b7280">Domain</td><td style="padding:6px 0;border-bottom:1px solid #e5e7eb">${esc(domainLine)}</td></tr>
    <tr><td style="padding:6px 0;border-bottom:1px solid #e5e7eb;color:#6b7280">Performance</td><td style="padding:6px 0;border-bottom:1px solid #e5e7eb">${esc(perfLine)}</td></tr>
  </table>
  <div style="font-size:11px;font-weight:bold;letter-spacing:1.5px;color:#6366f1;margin-top:26px">OUTAGES THIS MONTH</div>
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:6px">${incidentRows}</table>
  <p style="margin:28px 0 0"><b>Dylan Williams</b><br><span style="color:#6b7280;font-size:13.5px">Williams Digital · williamsdigital.io · Dylan@williamsdigital.io</span></p>
</td></tr>
<tr><td align="center" style="padding:16px 8px;color:#9ca3af;font-size:11.5px">Automated checks run every 15 minutes from Williams Digital's monitoring. Figures cover ${esc(label)}.</td></tr>
</table>
</td></tr></table>
</body></html>`;
}
