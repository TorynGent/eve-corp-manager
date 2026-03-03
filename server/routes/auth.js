'use strict';
const express = require('express');
const router  = express.Router();
const crypto  = require('crypto');
const { buildAuthUrl, exchangeCode, verifyAndSave } = require('../auth');
const { getToken } = require('../db');

// GET /auth/login — redirect to EVE SSO
router.get('/login', (req, res) => {
  const state = crypto.randomBytes(16).toString('hex');
  req.session.oauthState = state;
  res.redirect(buildAuthUrl(state));
});

// GET /auth/callback — EVE SSO redirects here after user approves
router.get('/callback', async (req, res) => {
  const { code, state } = req.query;

  if (state !== req.session.oauthState) {
    return res.status(400).send('Invalid OAuth state. Please try logging in again.');
  }
  delete req.session.oauthState;

  try {
    const tokenData = await exchangeCode(code);
    const { charId, charName, corpId, corpName } = await verifyAndSave(tokenData);

    req.session.characterId   = charId;
    req.session.characterName = charName;
    req.session.corporationId = corpId;

    // Kick off the scheduler + immediate sync for the new user
    const { updateSchedulerCharacter, runFullSync } = require('../scheduler');
    updateSchedulerCharacter(charId);
    runFullSync(charId).catch(e => console.error('Initial sync error:', e));

    res.redirect('/');
  } catch (err) {
    console.error('Auth callback error:', err.message);
    res.status(500).send(`Authentication failed: ${err.message}`);
  }
});

// GET /auth/logout
router.get('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/'));
});

// GET /auth/me — returns current session info (used by frontend to check login state)
router.get('/me', (req, res) => {
  if (!req.session?.characterId) return res.json({ loggedIn: false });

  const token = getToken(req.session.characterId);
  res.json({
    loggedIn:        true,
    characterId:     req.session.characterId,
    characterName:   req.session.characterName,
    corporationId:   req.session.corporationId,
    corporationName: token?.corporation_name || null,
  });
});

module.exports = router;
