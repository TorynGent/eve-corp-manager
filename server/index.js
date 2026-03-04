'use strict';
require('dotenv').config();
const express        = require('express');
const session        = require('express-session');
const path           = require('path');
const { startScheduler, updateSchedulerCharacter, runFullSync } = require('./scheduler');
const { db }         = require('./db');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret:            process.env.SESSION_SECRET || 'change-me-in-production',
  resave:            false,
  saveUninitialized: false,
  cookie:            { maxAge: 7 * 24 * 60 * 60 * 1000 }, // 7 days
}));

// Static files
app.use(express.static(path.join(__dirname, '..', 'public')));

// ── Routes ────────────────────────────────────────────────────────────────────
app.use('/auth',           require('./routes/auth'));
app.use('/api/structures', require('./routes/structures'));
app.use('/api/wallet',     require('./routes/wallet'));
app.use('/api/metenox',    require('./routes/metenox'));
app.use('/api/inventory',  require('./routes/inventory'));
app.use('/api/settings',   require('./routes/settings'));
app.use('/api/mining',     require('./routes/mining'));
app.use('/api/kills',      require('./routes/kills'));
app.use('/api/health',     require('./routes/health'));
app.use('/api',            require('./routes/dashboard'));  // /api/summary, /api/snapshots

// SPA fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// ── Start ─────────────────────────────────────────────────────────────────────

// Resolves when the HTTP server is listening — Electron waits for this
// before opening the BrowserWindow so the page is always ready on load.
let _resolveReady;
const ready = new Promise(resolve => { _resolveReady = resolve; });

app.listen(PORT, () => {
  _resolveReady(); // signal Electron (or any caller) that we are up

  console.log(`\n  ┌─────────────────────────────────────────────┐`);
  console.log(`  │  EVE Corp Dashboard running on port ${PORT}     │`);
  console.log(`  │  Open: http://localhost:${PORT}                │`);
  console.log(`  └─────────────────────────────────────────────┘\n`);

  // Resume scheduler for the last logged-in user (if any)
  const lastToken = db.prepare('SELECT character_id, corporation_id FROM tokens LIMIT 1').get();
  if (lastToken) {
    console.log(`[Auth] Resuming session for character ${lastToken.character_id}`);
    startScheduler(lastToken.character_id);
    runFullSync(lastToken.character_id).catch(() => {});
  } else {
    console.log('[Auth] No session found — please login at http://localhost:' + PORT);
    startScheduler(null);
  }
});

// Export so routes can call updateSchedulerCharacter after new login,
// and so Electron can await `ready` before opening the window.
module.exports = { updateSchedulerCharacter, ready };
