// Changes the dashboard passphrase:  node set-passphrase.mjs "new phrase"   (then commit + push index.html)
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const phrase = process.argv.slice(2).join(' ').trim().toLowerCase();
if (!phrase) { console.error('usage: node set-passphrase.mjs "new phrase"'); process.exit(1); }
const hash = createHash('sha256').update(phrase).digest('hex');
const file = new URL('index.html', import.meta.url);
const html = await readFile(file, 'utf8');
const out = html.replace(/const GATE_HASH = '[0-9a-f]*';/, `const GATE_HASH = '${hash}';`);
if (out === html) { console.error('GATE_HASH line not found in index.html'); process.exit(1); }
await writeFile(file, out);
console.log('passphrase updated; everyone will be asked for it again on their next visit');
