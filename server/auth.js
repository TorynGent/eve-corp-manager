'use strict';
const axios                       = require('axios');
const { saveToken, getToken, updateAccessToken } = require('./db');

const SSO_BASE    = 'https://login.eveonline.com';
const TOKEN_URL   = `${SSO_BASE}/v2/oauth/token`;
const AUTH_URL    = `${SSO_BASE}/v2/oauth/authorize`;
const VERIFY_URL  = 'https://esi.evetech.net/verify/';

const SCOPES = [
  'esi-wallet.read_corporation_wallets.v1',
  'esi-corporations.read_structures.v1',
  'esi-corporations.read_corporation_membership.v1',
  'esi-corporations.track_members.v1',
  'esi-industry.read_corporation_mining.v1',
  'esi-assets.read_corporation_assets.v1',
].join(' ');

function basicAuth() {
  const creds = `${process.env.EVE_CLIENT_ID}:${process.env.EVE_CLIENT_SECRET}`;
  return 'Basic ' + Buffer.from(creds).toString('base64');
}

/** Build the EVE SSO authorization URL */
function buildAuthUrl(state) {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id:     process.env.EVE_CLIENT_ID,
    redirect_uri:  process.env.EVE_CALLBACK_URL,
    scope:         SCOPES,
    state,
  });
  return `${AUTH_URL}?${params}`;
}

/** Exchange auth code for tokens */
async function exchangeCode(code) {
  const res = await axios.post(TOKEN_URL,
    new URLSearchParams({ grant_type: 'authorization_code', code,
                          redirect_uri: process.env.EVE_CALLBACK_URL }),
    { headers: { Authorization: basicAuth(),
                 'Content-Type': 'application/x-www-form-urlencoded' } }
  );
  return res.data;
}

/** Refresh an expired access token */
async function refreshToken(characterId) {
  const row = getToken(characterId);
  if (!row) throw new Error(`No token found for character ${characterId}`);

  const res = await axios.post(TOKEN_URL,
    new URLSearchParams({ grant_type: 'refresh_token', refresh_token: row.refresh_token }),
    { headers: { Authorization: basicAuth(),
                 'Content-Type': 'application/x-www-form-urlencoded' } }
  );

  const expiresAt = Math.floor(Date.now() / 1000) + res.data.expires_in - 60;
  updateAccessToken(characterId, res.data.access_token, expiresAt);
  return res.data.access_token;
}

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

/** Verify token and extract character + corporation info */
async function verifyAndSave(tokenData) {
  const jwt     = decodeJwt(tokenData.access_token);
  // sub format: "CHARACTER:EVE:{character_id}"
  const charId  = parseInt(jwt.sub.split(':')[2], 10);
  const charName = jwt.name;
  const expiresAt = Math.floor(Date.now() / 1000) + tokenData.expires_in - 60;

  // Fetch corp info from ESI
  let corpId = null, corpName = null;
  try {
    const res = await axios.get(`https://esi.evetech.net/latest/characters/${charId}/`,
      { headers: { 'Authorization': `Bearer ${tokenData.access_token}` } });
    corpId   = res.data.corporation_id;

    const corpRes = await axios.get(`https://esi.evetech.net/latest/corporations/${corpId}/`);
    corpName = corpRes.data.name;
  } catch { /* non-critical */ }

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

  return { charId, charName, corpId, corpName };
}

/** Express middleware: require authenticated session */
function requireAuth(req, res, next) {
  if (req.session && req.session.characterId) return next();
  res.status(401).json({ error: 'Not authenticated' });
}

module.exports = { buildAuthUrl, exchangeCode, verifyAndSave, getValidToken, requireAuth };
