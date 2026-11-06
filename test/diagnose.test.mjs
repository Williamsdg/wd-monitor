import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDiagnosisPrompt, DIAGNOSIS_SCHEMA } from '../lib/diagnose.mjs';

test('buildDiagnosisPrompt: puts every piece of evidence in front of the model', () => {
  const p = buildDiagnosisPrompt({
    site: { name: 'Vardar Transportation', url: 'https://vardartransportation.com/', slug: 'vardar' },
    sample: { s: 'down', code: 503, ms: 812, ssl: 40, note: 'HTTP 503', dns: 'ok', renderChars: 0 },
    attempts: [{ code: 503, ms: 812 }, { code: 503, ms: 790 }],
    recent: [[1793500000, 300, 'up'], [1793500900, 812, 'down']],
    paths: [{ path: '/weddings', status: 503 }],
  });
  for (const needle of ['Vardar Transportation', 'https://vardartransportation.com/', '503', '/weddings', 'up']) assert.match(p, new RegExp(needle));
});

test('DIAGNOSIS_SCHEMA: strict object with summary, likelyCause, nextSteps', () => {
  assert.equal(DIAGNOSIS_SCHEMA.type, 'object');
  assert.deepEqual(DIAGNOSIS_SCHEMA.required, ['summary', 'likelyCause', 'nextSteps']);
  assert.equal(DIAGNOSIS_SCHEMA.additionalProperties, false);
});
