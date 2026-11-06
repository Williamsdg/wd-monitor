// What we hand Claude when a site goes down, and the shape we want back.

export const DIAGNOSIS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'likelyCause', 'nextSteps'],
  properties: {
    summary: { type: 'string', description: 'One plain-English sentence saying what is wrong with the site right now.' },
    likelyCause: { type: 'string', description: 'The most probable root cause given only this evidence, naming the layer: DNS, TLS, origin/host, application, CDN, deploy, expired domain, or unclear.' },
    nextSteps: { type: 'array', items: { type: 'string' }, description: 'Two to four concrete checks or fixes, most useful first, each one short imperative sentence.' },
  },
};

export const DIAGNOSIS_SYSTEM = `You are the incident analyst behind Williams Digital's uptime monitor. Williams Digital is a small web studio; its sites are static or lightly dynamic (Next.js on Vercel, GitHub Pages, Netlify, Shopify storefronts, a few Node apps on AWS). You receive the raw evidence from automated checks and reply with a diagnosis that a solo developer can act on from a phone. Reason only from the evidence given: when it does not pin the cause down, say that it is unclear and list the checks that would settle it. Never invent log lines, error messages, or facts that are not in the evidence.`;

export function buildDiagnosisPrompt({ site, sample, attempts = [], recent = [], paths = [] }) {
  const lines = [
    `Site: ${site.name} (${site.url}), slug ${site.slug}.`,
    '',
    'Latest check:',
    JSON.stringify(sample, null, 1),
  ];
  if (attempts.length) {
    lines.push('', `All ${attempts.length} attempts this run (the site is only marked down when every attempt fails):`);
    for (const [i, a] of attempts.entries()) lines.push(`  ${i + 1}. ${JSON.stringify(a)}`);
  }
  if (paths.length) {
    lines.push('', 'Critical path checks:');
    for (const p of paths) lines.push(`  ${p.path}: ${p.error ? p.error : `HTTP ${p.status}`}`);
  }
  if (recent.length) {
    lines.push('', 'Recent samples, oldest first, as [epoch seconds, response ms, status]:');
    lines.push(JSON.stringify(recent.slice(-24)));
  }
  lines.push('', 'Diagnose the outage.');
  return lines.join('\n');
}
