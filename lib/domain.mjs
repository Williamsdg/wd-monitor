// Domain registration expiry via RDAP.

const PLATFORM = ['vercel.app', 'github.io', 'netlify.app', 'pages.dev', 'herokuapp.com', 'web.app', 'firebaseapp.com', 'webflow.io', 'squarespace.com', 'myshopify.com', 'wixsite.com', 'onrender.com', 'fly.dev'];
const TWO_LEVEL = ['co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'com.au', 'net.au', 'org.au', 'co.nz', 'co.jp', 'com.br', 'com.mx', 'co.za', 'co.in'];

export function apexDomain(host) {
  const parts = String(host).toLowerCase().replace(/\.$/, '').split('.');
  if (parts.length < 2) return null;
  const last2 = parts.slice(-2).join('.');
  if (PLATFORM.includes(last2)) return null;
  if (TWO_LEVEL.includes(last2)) return parts.length >= 3 ? parts.slice(-3).join('.') : null;
  return last2;
}

// rdap.org bootstraps most TLDs; .io is not in its map but Identity Digital runs it.
export function rdapUrl(apex) {
  return apex.endsWith('.io')
    ? `https://rdap.identitydigital.services/rdap/domain/${apex}`
    : `https://rdap.org/domain/${apex}`;
}

export function parseRdapExpiry(json, nowMs = Date.now()) {
  const ev = Array.isArray(json?.events) ? json.events.find(e => e.eventAction === 'expiration') : null;
  if (!ev?.eventDate) return null;
  const end = Date.parse(ev.eventDate);
  if (Number.isNaN(end)) return null;
  return Math.floor((end - nowMs) / 86_400_000);
}
