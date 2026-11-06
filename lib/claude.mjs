// Claude integration: outage diagnosis and the monthly report narrative. Returns null when no key is configured or anything fails;
// the monitor never depends on it.
import Anthropic from '@anthropic-ai/sdk';
import { DIAGNOSIS_SCHEMA, DIAGNOSIS_SYSTEM, buildDiagnosisPrompt } from './diagnose.mjs';

export const MODEL = 'claude-opus-5-5';

export function claudeAvailable() {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

function describeError(e) {
  if (e instanceof Anthropic.AuthenticationError) return 'API key rejected';
  if (e instanceof Anthropic.RateLimitError) return 'rate limited';
  if (e instanceof Anthropic.APIError) return `API error ${e.status}: ${e.message}`;
  return e?.message || String(e);
}

function textOf(res) {
  return res.content.filter(b => b.type === 'text').map(b => b.text).join('');
}

export async function diagnoseIncident(evidence) {
  if (!claudeAvailable()) { console.log('claude: no ANTHROPIC_API_KEY set, outage recorded without a diagnosis'); return null; }
  const client = new Anthropic({ maxRetries: 2, timeout: 180_000 });
  try {
    const res = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'high', format: { type: 'json_schema', schema: DIAGNOSIS_SCHEMA } },
      system: DIAGNOSIS_SYSTEM,
      messages: [{ role: 'user', content: buildDiagnosisPrompt(evidence) }],
    });
    if (res.stop_reason === 'refusal') { console.log('claude: declined to diagnose'); return null; }
    const parsed = JSON.parse(textOf(res));
    return {
      summary: String(parsed.summary),
      likelyCause: String(parsed.likelyCause),
      nextSteps: Array.isArray(parsed.nextSteps) ? parsed.nextSteps.map(String).slice(0, 4) : [],
      model: res.model,
      at: Math.floor(Date.now() / 1000),
    };
  } catch (e) {
    console.log(`claude: diagnosis failed (${describeError(e)})`);
    return null;
  }
}

const NARRATIVE_SYSTEM = `You write the short narrative paragraph in Williams Digital's monthly website report to a client. Williams Digital is a web studio in Birmingham, Alabama run by Dylan Williams; the client owns a small business and is not technical. Write two or three plain sentences, warm but factual, in the first person plural ("we"). State what the numbers mean for them, mention any outage honestly with its length, and note the certificate or domain only if it needs attention. No jargon, no bullet points, no promises about future work, no greetings or sign-off, and nothing that is not supported by the figures.`;

export async function writeNarrative({ site, monthLabel, stats, incidents = [], sslDays, domainDays, vitals }) {
  if (!claudeAvailable()) return null;
  const client = new Anthropic({ maxRetries: 2, timeout: 180_000 });
  const facts = { site: site.name, month: monthLabel, ...stats, outages: incidents.map(i => ({ startedAt: i.startedAt, endedAt: i.endedAt, note: i.note })), sslDaysRemaining: sslDays, domainDaysRemaining: domainDays, lighthouse: vitals ?? null };
  try {
    const res = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'medium' },
      system: NARRATIVE_SYSTEM,
      messages: [{ role: 'user', content: `Figures for the report:\n${JSON.stringify(facts, null, 1)}\n\nWrite the paragraph.` }],
    });
    if (res.stop_reason === 'refusal') return null;
    const text = textOf(res).trim();
    return text.length > 40 && text.length < 1200 ? text : null;
  } catch (e) {
    console.log(`claude: narrative failed (${describeError(e)})`);
    return null;
  }
}
