// "200 but blank" detection: how much text a rendered page actually shows.

const ENT = { amp: '&', nbsp: ' ', lt: '<', gt: '>', quot: '"', apos: "'", '#39': "'" };

export function visibleText(html) {
  return String(html)
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|template|svg|head)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(#?\w+);/g, (m, e) => {
      if (ENT[e] !== undefined) return ENT[e];
      if (e[0] === '#') { const cp = parseInt(e.slice(1), 10); return Number.isFinite(cp) ? String.fromCodePoint(cp) : ' '; }
      return ' ';
    })
    .replace(/\s+/g, ' ')
    .trim();
}

export function renderCheck(html, { minChars = 200 } = {}) {
  const chars = visibleText(html).length;
  return { ok: chars >= minChars, chars };
}
