'use strict';
const axios          = require('axios');
const { getValidToken, } = require('./auth');
const { cacheName, getCachedName } = require('./db');

const ESI_BASE = 'https://esi.evetech.net/latest';
const UA       = 'EVE-Corp-Dashboard/1.0 (contact your-email@example.com)';

// Simple in-memory ETag cache  { url → { etag, data } }
const etagCache = new Map();

/** Core ESI GET — handles auth, ETags, 304, 429 retry */
async function esiGet(path, { characterId = null, params = {}, retries = 3 } = {}) {
  const url = `${ESI_BASE}${path}`;
  const headers = { 'User-Agent': UA };

  if (characterId) {
    const token = await getValidToken(characterId);
    headers['Authorization'] = `Bearer ${token}`;
  }

  const cached = etagCache.get(url + JSON.stringify(params));
  if (cached?.etag) headers['If-None-Match'] = cached.etag;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await axios.get(url, { params, headers, validateStatus: s => s < 600 });

      if (res.status === 304 && cached) return cached.data;

      // ESI-specific: 420 = error limit reached (you've made too many 4xx errors recently)
      if (res.status === 420) {
        const wait = parseInt(res.headers['retry-after'] || '60', 10) * 1000;
        console.error(`[ESI] 🚫 ERROR LIMIT REACHED on ${path} — banned for ${wait/1000}s. Wait before retrying.`);
        await sleep(wait);
        continue;
      }

      // Standard rate-limit retry
      if (res.status === 429) {
        const wait = parseInt(res.headers['retry-after'] || '10', 10) * 1000;
        console.warn(`[ESI] ⏳ Rate-limited on ${path} — retrying after ${wait/1000}s`);
        await sleep(wait);
        continue;
      }

      // Warn when ESI error budget is running low (ESI bans at 0)
      const errRemain = parseInt(res.headers['x-esi-error-limit-remain'] || '100', 10);
      if (errRemain <= 20) {
        console.warn(`[ESI] ⚠️  Error budget LOW: ${errRemain} remaining (reset in ${res.headers['x-esi-error-limit-reset'] || '?'}s) — triggered by ${path}`);
      }

      if (res.status === 200) {
        if (res.headers.etag) {
          etagCache.set(url + JSON.stringify(params), { etag: res.headers.etag, data: res.data });
        }
        return res.data;
      }

      // Log 4xx errors so we can see exactly what's failing
      if (res.status >= 400 && res.status < 500) {
        console.warn(`[ESI] ${res.status} on ${path} (error budget: ${errRemain})`);
      }

      // 401/403 are auth failures — permanent, not transient. Never retry them.
      // Retrying would burn 4× error budget for no reason (we'd still get 401 each time).
      const err = Object.assign(new Error(`ESI ${res.status} on ${path}`), { status: res.status, body: res.data });
      if (res.status === 401 || res.status === 403) throw err; // bypass retry loop

      throw err;
    } catch (err) {
      if (attempt === retries || err.status === 401 || err.status === 403) throw err;
      await sleep(2000 * (attempt + 1));
    }
  }
}

/** Paginate an ESI endpoint — collects all pages */
async function esiGetAll(path, options = {}) {
  let page = 1, results = [];
  while (true) {
    const url    = `${ESI_BASE}${path}`;
    const params = { ...(options.params || {}), page };
    const headers = { 'User-Agent': UA };
    if (options.characterId) {
      const token = await getValidToken(options.characterId);
      headers['Authorization'] = `Bearer ${token}`;
    }

    const res = await axios.get(url, { params, headers, validateStatus: s => s < 500 });
    if (res.status === 200) {
      results = results.concat(res.data);
      const totalPages = parseInt(res.headers['x-pages'] || '1', 10);
      if (page >= totalPages) break;
      page++;
    } else if (res.status === 304) {
      break;
    } else {
      break;
    }
  }
  return results;
}

/** Resolve a list of character IDs to names (batch, cached) */
async function resolveNames(ids) {
  const unknown = [];
  const map = {};

  for (const id of ids) {
    const cached = getCachedName(id);
    if (cached) map[id] = cached.name;
    else unknown.push(id);
  }

  if (unknown.length === 0) return map;

  // ESI bulk name endpoint
  const chunks = chunkArray(unknown, 1000);
  for (const chunk of chunks) {
    try {
      const res = await axios.post(`${ESI_BASE}/universe/names/`, chunk,
        { headers: { 'User-Agent': UA, 'Content-Type': 'application/json' } });
      for (const { id, name } of res.data) {
        map[id] = name;
        cacheName(id, name);
      }
    } catch { /* best effort */ }
  }

  return map;
}

/** Resolve a single structure name (requires auth) */
async function resolveStructureName(structureId, characterId) {
  const cached = getCachedName(structureId);
  if (cached) return cached.name;
  try {
    const data = await esiGet(`/universe/structures/${structureId}/`, { characterId });
    if (data?.name) { cacheName(structureId, data.name, 'structure'); return data.name; }
  } catch { /* station or inaccessible */ }
  return `Structure ${structureId}`;
}

/** Resolve a solar system name */
async function resolveSystemName(systemId) {
  const cached = getCachedName(systemId);
  if (cached) return cached.name;
  try {
    const data = await esiGet(`/universe/systems/${systemId}/`);
    if (data?.name) { cacheName(systemId, data.name, 'system'); return data.name; }
  } catch { /* */ }
  return `System ${systemId}`;
}

/** Resolve a type name */
async function resolveTypeName(typeId) {
  const cached = getCachedName(typeId);
  if (cached) return cached.name;
  try {
    const data = await esiGet(`/universe/types/${typeId}/`);
    if (data?.name) { cacheName(typeId, data.name, 'type'); return data.name; }
  } catch { /* */ }
  return `Type ${typeId}`;
}

function chunkArray(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

module.exports = { esiGet, esiGetAll, resolveNames, resolveStructureName, resolveSystemName, resolveTypeName };
