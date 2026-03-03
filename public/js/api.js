// Lightweight fetch wrapper
const api = {
  async get(path, params = {}) {
    const qs = Object.keys(params).length
      ? '?' + new URLSearchParams(params) : '';
    const res = await fetch(path + qs);
    if (!res.ok) throw new Error(`API ${res.status}: ${path}`);
    return res.json();
  },
  async post(path, body = {}) {
    const res = await fetch(path, { method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body) });
    if (!res.ok) throw new Error(`API ${res.status}: ${path}`);
    return res.json();
  },
  async put(path, body = {}) {
    const res = await fetch(path, { method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body) });
    if (!res.ok) throw new Error(`API ${res.status}: ${path}`);
    return res.json();
  },
  async del(path) {
    const res = await fetch(path, { method: 'DELETE' });
    if (!res.ok) throw new Error(`API ${res.status}: ${path}`);
    return res.json();
  },
};

// ISK formatter
function fmtISK(n, decimals = 1) {
  if (n == null) return '—';
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (abs >= 1e12) return sign + (abs / 1e12).toFixed(decimals) + 'T';
  if (abs >= 1e9)  return sign + (abs / 1e9).toFixed(decimals)  + 'B';
  if (abs >= 1e6)  return sign + (abs / 1e6).toFixed(decimals)  + 'M';
  if (abs >= 1e3)  return sign + (abs / 1e3).toFixed(decimals)  + 'K';
  return sign + abs.toFixed(0);
}

function fmtDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function fmtDateShort(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
}

function fuelClass(days) {
  if (days == null) return 'dim';
  if (days < 14) return 'red';
  if (days < 30) return 'gold';
  return 'green';
}

function fuelBarClass(days) {
  if (days == null) return 'bar-grey';
  if (days < 14) return 'bar-red';
  if (days < 30) return 'bar-orange';
  return 'bar-green';
}

function barPct(days, max = 90) {
  if (days == null) return 0;
  return Math.min(100, (days / max) * 100).toFixed(1);
}

function fmtNum(n) {
  if (n == null) return '—';
  return Math.round(n).toLocaleString('en-US');
}
