import { test } from 'node:test';
import assert from 'node:assert/strict';
import { visibleText, renderCheck } from '../lib/render.mjs';

test('visibleText: drops scripts, styles, tags and collapses whitespace', () => {
  const html = `<html><head><style>.a{color:red}</style><script>var x = "hidden words here";</script></head>
  <body><nav>Home   <a href="/x">Shop</a></nav><noscript>Enable JS</noscript><main><h1>Sword &amp; Crown</h1>
  <p>Luxury&nbsp;wigs</p></main><template><p>not shown</p></template></body></html>`;
  assert.equal(visibleText(html), 'Home Shop Sword & Crown Luxury wigs');
});

test('renderCheck: a blank app shell fails, real content passes', () => {
  const shell = '<html><body><div id="root"></div><script src="/app.js"></script></body></html>';
  assert.deepEqual(renderCheck(shell), { ok: false, chars: 0 });
  const page = `<html><body><main>${'Lorem ipsum dolor sit amet. '.repeat(20)}</main></body></html>`;
  const r = renderCheck(page);
  assert.equal(r.ok, true);
  assert.ok(r.chars > 400);
  assert.equal(renderCheck(page, { minChars: 10_000 }).ok, false);
});
