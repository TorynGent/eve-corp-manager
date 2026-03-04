'use strict';
const express = require('express');
const router  = express.Router();
const { requireAuth }  = require('../auth');
const { db, getSetting, setSetting, getSyncStatus } = require('../db');
const { encryptValue, decryptValue } = require('../secure-storage');

// ── Alt → Main Mappings ────────────────────────────────────────────────────────

// GET /api/settings/mappings
router.get('/mappings', requireAuth, (req, res) => {
  const rows = db.prepare('SELECT * FROM alt_mappings ORDER BY main_name, character_name').all();
  res.json(rows);
});

// POST /api/settings/mappings
router.post('/mappings', requireAuth, (req, res) => {
  const { characterId, characterName, mainName } = req.body;
  if (!characterName || !mainName) return res.status(400).json({ error: 'characterName and mainName required' });

  // If no characterId given, try to resolve from cache
  let charId = characterId;
  if (!charId) {
    const cached = db.prepare('SELECT id FROM name_cache WHERE LOWER(name) = LOWER(?)').get(characterName);
    charId = cached?.id || Math.floor(Math.random() * -1e9); // temp negative ID if unknown
  }

  db.prepare(`
    INSERT INTO alt_mappings (character_id, character_name, main_name)
    VALUES (?, ?, ?)
    ON CONFLICT(character_id) DO UPDATE SET character_name = excluded.character_name, main_name = excluded.main_name
  `).run(charId, characterName, mainName);

  res.json({ ok: true });
});

// DELETE /api/settings/mappings/:id
router.delete('/mappings/:id', requireAuth, (req, res) => {
  db.prepare('DELETE FROM alt_mappings WHERE character_id = ?').run(parseInt(req.params.id, 10));
  res.json({ ok: true });
});

// ── Notification Settings ──────────────────────────────────────────────────────

// GET /api/settings/notifications
router.get('/notifications', requireAuth, (req, res) => {
  res.json({
    smtpHost:         getSetting('smtp_host', ''),
    smtpPort:         getSetting('smtp_port', '587'),
    smtpUser:         getSetting('smtp_user', ''),
    smtpPassSet:      !!getSetting('smtp_pass', ''),  // never send password to browser
    smtpFrom:         getSetting('smtp_from', ''),
    smtpTls:          getSetting('smtp_tls', 'true'),
    recipients:       getSetting('recipients', ''),
    fuelThresholdDays: getSetting('fuel_threshold_days', '14'),
    gasThresholdDays:  getSetting('gas_threshold_days', '7'),
    enabled:           getSetting('notifications_enabled', 'true'),
  });
});

// PUT /api/settings/notifications
router.put('/notifications', requireAuth, (req, res) => {
  const fields = {
    'smtp_host':            req.body.smtpHost,
    'smtp_port':            req.body.smtpPort,
    'smtp_user':            req.body.smtpUser,
    'smtp_from':            req.body.smtpFrom,
    'smtp_tls':             req.body.smtpTls,
    'recipients':           req.body.recipients,
    'fuel_threshold_days':  req.body.fuelThresholdDays,
    'gas_threshold_days':   req.body.gasThresholdDays,
    'notifications_enabled': req.body.enabled,
  };
  if (req.body.smtpPass) fields['smtp_pass'] = encryptValue(req.body.smtpPass);

  for (const [k, v] of Object.entries(fields)) {
    if (v !== undefined && v !== null) setSetting(k, v);
  }
  res.json({ ok: true });
});

// POST /api/settings/notifications/test — send a test email
router.post('/notifications/test', requireAuth, async (req, res) => {
  try {
    const { sendTestEmail } = require('../notifications');
    await sendTestEmail();
    res.json({ ok: true, message: 'Test email sent successfully.' });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// GET /api/settings/notifications/log — last 10 sent notifications
router.get('/notifications/log', requireAuth, (req, res) => {
  const rows = db.prepare(`
    SELECT nl.*, s.name AS structure_name
    FROM notification_log nl
    LEFT JOIN structures s ON s.structure_id = nl.structure_id
    ORDER BY nl.sent_at DESC LIMIT 10
  `).all();
  res.json(rows);
});

// ── Sync Status ───────────────────────────────────────────────────────────────

// GET /api/settings/sync-status
router.get('/sync-status', requireAuth, (req, res) => {
  const keys = ['structures', 'wallet', 'assets', 'mining', 'observers', 'market_prices', 'members', 'kills'];
  const status = {};
  for (const k of keys) {
    const row = getSyncStatus(k);
    status[k] = row
      ? { lastSync: row.last_sync, lastError: row.last_error }
      : { lastSync: null, lastError: null };
  }
  res.json(status);
});

// POST /api/settings/sync-now — trigger a manual full sync
router.post('/sync-now', requireAuth, async (req, res) => {
  try {
    const { runFullSync } = require('../scheduler');
    const characterId = req.session.characterId;
    res.json({ ok: true, message: 'Sync started in background' });
    runFullSync(characterId).catch(e => console.error('Manual sync error:', e));
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── CEO Scratchpad ─────────────────────────────────────────────────────────────

// GET /api/settings/scratchpad
router.get('/scratchpad', requireAuth, (req, res) => {
  res.json({ text: getSetting('scratchpad_text', '') });
});

// PUT /api/settings/scratchpad
router.put('/scratchpad', requireAuth, (req, res) => {
  setSetting('scratchpad_text', String(req.body.text ?? ''));
  res.json({ ok: true });
});

// ── CSV Alt→Main Import ────────────────────────────────────────────────────────

// POST /api/settings/mappings/csv — import alt→main from CSV text
// Body: { csvText: "AltName,MainName\n..." }
router.post('/mappings/csv', requireAuth, (req, res) => {
  const { csvText } = req.body;
  if (!csvText) return res.status(400).json({ error: 'csvText required' });

  const lines = csvText.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'));
  let imported = 0;
  const errors = [];

  for (const line of lines) {
    const commaIdx = line.indexOf(',');
    if (commaIdx < 1) { errors.push(`Bad format: "${line}"`); continue; }
    const altName  = line.slice(0, commaIdx).trim();
    const mainName = line.slice(commaIdx + 1).trim();
    if (!altName || !mainName) { errors.push(`Empty field: "${line}"`); continue; }

    // Look up character ID from name_cache; fall back to deterministic negative ID
    const cached = db.prepare('SELECT id FROM name_cache WHERE LOWER(name) = LOWER(?)').get(altName);
    const charId = cached?.id || -(Math.abs(hashStr(altName)) % 999_999_998 + 1);

    db.prepare(`
      INSERT INTO alt_mappings (character_id, character_name, main_name)
      VALUES (?, ?, ?)
      ON CONFLICT(character_id) DO UPDATE SET
        character_name = excluded.character_name,
        main_name      = excluded.main_name
    `).run(charId, altName, mainName);
    imported++;
  }

  res.json({ ok: true, imported, errors: errors.slice(0, 20) });
});

function hashStr(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = Math.imul(31, h) + s.charCodeAt(i) | 0;
  return Math.abs(h);
}

module.exports = router;
