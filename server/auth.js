'use strict';
const axios  = require('axios');
const crypto = require('crypto');
const { db, saveToken, getToken, updateAccessToken } = require('./db');

const SSO_BASE  = 'https://login.eveonline.com';
const TOKEN_URL = `${SSO_BASE}/v2/oauth/token`;
const AUTH_URL  = `${SSO_BASE}/v2/oauth/authorize`;

const REQUIRED_SCOPES = [
  'esi-wallet.read_corporation_wallets.v1',
  'esi-corporations.read_structures.v1',
  'esi-corporations.read_corporation_membership.v1',
  'esi-corporations.track_members.v1',
  'esi-industry.read_corporation_mining.v1',
  'esi-assets.read_corporation_assets.v1',
  'esi-universe.read_structures.v1',  // resolve alliance/other-corp structure names
];

const SCOPES = REQUIRED_SCOPES.join(' ');

// ─── PKCE helpers ────────────────────────────────────────────────────────────

/** Generate a cryptographically random PKCE code_verifier (43 URL-safe chars) */
function generateCodeVerifier() {
  return crypto.randomBytes(32).toString('base64url');
}

/** Derive code_challenge from verifier using S256 method */
function generateCodeChallenge(verifier) {
  return crypto.createHash('sha256').update(verifier).digest('base64url');
}

// ─── Auth URL ─────────────────────────────────────────────────────────────────

/**
 * Build the EVE SSO authorization URL.
 * Returns { url, codeVerifier } — store codeVerifier in the session,
 * it is required when exchanging the auth code for tokens.
 */
function buildAuthUrl(state) {
  const codeVerifier  = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(codeVerifier);

  const params = new URLSearchParams({
    response_type:         'code',
    client_id:             process.env.EVE_CLIENT_ID,
    redirect_uri:          process.env.EVE_CALLBACK_URL,
    scope:                 SCOPES,
    state,
    code_challenge:        codeChallenge,
    code_challenge_method: 'S256',
  });

  return { url: `${AUTH_URL}?${params}`, codeVerifier };
}

// ─── Token exchange ───────────────────────────────────────────────────────────

/**
 * Exchange auth code for tokens using PKCE.
 * No client_secret needed — the code_verifier proves ownership of the request.
 */
async function exchangeCode(code, codeVerifier) {
  const res = await axios.post(TOKEN_URL,
    new URLSearchParams({
      grant_type:    'authorization_code',
      client_id:     process.env.EVE_CLIENT_ID,
      code,
      code_verifier: codeVerifier,
      redirect_uri:  process.env.EVE_CALLBACK_URL,
    }),
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
  );
  return res.data;
}

// ─── Token refresh ────────────────────────────────────────────────────────────

/** In-flight refresh promise per character (avoid concurrent refresh for same character) */
const refreshLocks = new Map();

/**
 * Refresh an expired access token.
 * PKCE refresh tokens only need client_id — no client_secret.
 * EVE may return a new refresh_token (rotating); we persist it when present.
 */
async function refreshToken(characterId) {
  let lock = refreshLocks.get(characterId);
  if (lock) {
    await lock;
    const row = getToken(characterId);
    return row ? row.access_token : refreshToken(characterId);
  }

  const promise = (async () => {
    const row = getToken(characterId);
    if (!row) throw new Error(`No token found for character ${characterId}`);

    try {
      const res = await axios.post(TOKEN_URL,
        new URLSearchParams({
          grant_type:    'refresh_token',
          refresh_token: row.refresh_token,
          client_id:     process.env.EVE_CLIENT_ID,
        }),
        { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
      );

      const data = res.data;
      const expiresAt = Math.floor(Date.now() / 1000) + data.expires_in - 60;
      const newRefresh = data.refresh_token || row.refresh_token;
      updateAccessToken(characterId, data.access_token, expiresAt, newRefresh);
      console.log(`[Auth] Token refreshed for character ${characterId}`);
      return data.access_token;
    } catch (err) {
      const msg = err.response?.data?.error_description || err.message;
      console.error(`[Auth] Token refresh failed for character ${characterId}:`, msg);
      throw err;
    } finally {
      refreshLocks.delete(characterId);
    }
  })();

  refreshLocks.set(characterId, promise);
  return promise;
}

/** Force a token refresh regardless of expires_at (e.g. after ESI 401). */
async function forceRefreshToken(characterId) {
  refreshLocks.delete(characterId);
  return refreshToken(characterId);
}

// ─── Token helpers ────────────────────────────────────────────────────────────

/** Get a valid (non-expired) access token, refreshing if needed */
async function getValidToken(characterId) {
  const row = getToken(characterId);
  if (!row) throw new Error('Not authenticated');
  if (Math.floor(Date.now() / 1000) < row.expires_at) return row.access_token;
  return refreshToken(characterId);
}

/** Decode EVE SSO JWT payload without external library */
function decodeJwt(token) {
  const payload = token.split('.')[1];
  return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
}

/** Verify token and extract character + corporation info, then persist to DB */
async function verifyAndSave(tokenData) {
  const jwt      = decodeJwt(tokenData.access_token);
  // sub format: "CHARACTER:EVE:{character_id}"
  const charId   = parseInt(jwt.sub.split(':')[2], 10);
  const charName = jwt.name;
  const expiresAt = Math.floor(Date.now() / 1000) + tokenData.expires_in - 60;

  let corpId = null, corpName = null;
  try {
    const res = await axios.get(
      `https://esi.evetech.net/latest/characters/${charId}/`,
      { headers: { Authorization: `Bearer ${tokenData.access_token}` } }
    );
    corpId = res.data.corporation_id;

    const corpRes = await axios.get(
      `https://esi.evetech.net/latest/corporations/${corpId}/`
    );
    corpName = corpRes.data.name;
  } catch { /* non-critical — corp info will be null until next sync */ }

  saveToken({
    character_id:    charId,
    character_name:  charName,
    corporation_id:  corpId,
    corporation_name: corpName,
    access_token:    tokenData.access_token,
    refresh_token:   tokenData.refresh_token,
    expires_at:      expiresAt,
    scopes:          jwt.scp ? (Array.isArray(jwt.scp) ? jwt.scp.join(' ') : jwt.scp) : '',
  });

  // Clear any previously-cached failed structure resolutions so they get retried
  // with the potentially-updated scope set (e.g. after adding esi-universe.read_structures.v1).
  db.prepare("DELETE FROM name_cache WHERE type = 'failed'").run();

  const grantedScopes = jwt.scp ? (Array.isArray(jwt.scp) ? jwt.scp : [jwt.scp]) : [];
  return { charId, charName, corpId, corpName, grantedScopes };
}

// ─── Middleware ───────────────────────────────────────────────────────────────

/** Express middleware: require authenticated session */
function requireAuth(req, res, next) {
  if (req.session && req.session.characterId) return next();
  res.status(401).json({ error: 'Not authenticated' });
}

module.exports = { buildAuthUrl, exchangeCode, verifyAndSave, getValidToken, forceRefreshToken, requireAuth, REQUIRED_SCOPES };
