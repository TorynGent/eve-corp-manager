'use strict';
const Database = require('better-sqlite3');
const path     = require('path');
const fs       = require('fs');

// DB_PATH can be overridden by Electron (or any launcher) via environment variable
// so the database lives in the user's data folder, not the install directory.
const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'corp.db');

// Ensure the directory exists (important for first run and Electron userData paths)
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ── Schema ────────────────────────────────────────────────────────────────────
db.exec(`
CREATE TABLE IF NOT EXISTS tokens (
  character_id    INTEGER PRIMARY KEY,
  character_name  TEXT NOT NULL,
  corporation_id  INTEGER,
  corporation_name TEXT,
  access_token    TEXT,
  refresh_token   TEXT,
  expires_at      INTEGER,
  scopes          TEXT
);

CREATE TABLE IF NOT EXISTS structures (
  structure_id  INTEGER PRIMARY KEY,
  name          TEXT,
  type_id       INTEGER,
  type_name     TEXT,
  system_id     INTEGER,
  system_name   TEXT,
  fuel_expires  TEXT,
  services      TEXT,
  state         TEXT,
  synced_at     INTEGER
);

CREATE TABLE IF NOT EXISTS structure_gas (
  structure_id       INTEGER PRIMARY KEY,
  last_refill_date   TEXT,
  quantity_refilled  INTEGER DEFAULT 0,
  daily_consumption  INTEGER DEFAULT 4800,
  notes              TEXT
);

CREATE TABLE IF NOT EXISTS wallet_journal (
  journal_id       INTEGER PRIMARY KEY,
  division         INTEGER,
  date             TEXT,
  ref_type         TEXT,
  first_party_id   INTEGER,
  second_party_id  INTEGER,
  amount           REAL,
  balance          REAL,
  description      TEXT,
  synced_at        INTEGER
);

CREATE INDEX IF NOT EXISTS idx_wj_date        ON wallet_journal(date);
CREATE INDEX IF NOT EXISTS idx_wj_second_party ON wallet_journal(second_party_id);
CREATE INDEX IF NOT EXISTS idx_wj_ref_type     ON wallet_journal(ref_type);

CREATE TABLE IF NOT EXISTS alt_mappings (
  character_id    INTEGER PRIMARY KEY,
  character_name  TEXT NOT NULL,
  main_name       TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tax_summary (
  period          TEXT,
  character_id    INTEGER,
  character_name  TEXT,
  main_name       TEXT,
  total_amount    REAL,
  PRIMARY KEY (period, character_id)
);

CREATE TABLE IF NOT EXISTS market_prices (
  type_id        INTEGER PRIMARY KEY,
  type_name      TEXT,
  adjusted_price REAL,
  average_price  REAL,
  jita_sell_min  REAL,
  updated_at     INTEGER
);

CREATE TABLE IF NOT EXISTS assets (
  item_id        INTEGER PRIMARY KEY,
  type_id        INTEGER,
  type_name      TEXT,
  quantity       INTEGER,
  location_id    INTEGER,
  location_name  TEXT,
  location_type  TEXT,
  category       TEXT,
  group_name     TEXT,
  est_value      REAL DEFAULT 0,
  synced_at      INTEGER
);

CREATE TABLE IF NOT EXISTS notification_settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS notification_log (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  structure_id  INTEGER,
  alert_type    TEXT,
  days_remaining REAL,
  sent_at       INTEGER
);

CREATE TABLE IF NOT EXISTS monthly_snapshots (
  id                     INTEGER PRIMARY KEY AUTOINCREMENT,
  month                  TEXT UNIQUE,
  wallet_balance         REAL,
  corp_equity            REAL,
  active_members         INTEGER,
  metenox_monthly_profit REAL,
  total_mining_isk       REAL,
  top_taxpayer           TEXT,
  snapshot_json          TEXT,
  created_at             INTEGER
);

CREATE TABLE IF NOT EXISTS sync_status (
  key        TEXT PRIMARY KEY,
  last_sync  INTEGER,
  last_error TEXT
);

CREATE TABLE IF NOT EXISTS name_cache (
  id    INTEGER PRIMARY KEY,
  name  TEXT,
  type  TEXT
);

CREATE TABLE IF NOT EXISTS member_tracking (
  character_id   INTEGER PRIMARY KEY,
  character_name TEXT,
  logon_date     TEXT,
  logoff_date    TEXT,
  ship_type_id   INTEGER,
  location_id    INTEGER,
  synced_at      INTEGER
);

CREATE TABLE IF NOT EXISTS mining_ledger (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  character_id   INTEGER,
  character_name TEXT,
  main_name      TEXT,
  type_id        INTEGER,
  type_name      TEXT,
  quantity       INTEGER,
  date           TEXT,
  synced_at      INTEGER,
  UNIQUE(character_id, type_id, date)
);

CREATE INDEX IF NOT EXISTS idx_ml_date ON mining_ledger(date);
CREATE INDEX IF NOT EXISTS idx_ml_char ON mining_ledger(character_id);

CREATE TABLE IF NOT EXISTS mining_observers (
  observer_id    INTEGER,
  character_id   INTEGER,
  type_id        INTEGER,
  type_name      TEXT,
  quantity       INTEGER,
  last_updated   TEXT,
  synced_at      INTEGER,
  PRIMARY KEY (observer_id, character_id, type_id, last_updated)
);

CREATE TABLE IF NOT EXISTS corp_kills (
  kill_id           INTEGER PRIMARY KEY,
  kill_time         TEXT,
  victim_corp_id    INTEGER,
  victim_ship_id    INTEGER,
  victim_ship_name  TEXT,
  solar_system_id   INTEGER,
  solar_system_name TEXT,
  total_value       REAL,
  attackers_json    TEXT,
  synced_at         INTEGER
);

CREATE INDEX IF NOT EXISTS idx_ck_time ON corp_kills(kill_time);

CREATE TABLE IF NOT EXISTS metenox_manual_materials (
  structure_id  INTEGER,
  type_id       INTEGER,
  type_name     TEXT,
  qty_per_hour  REAL,
  PRIMARY KEY (structure_id, type_id)
);
`);

// Schema migrations (add columns added after initial deploy)
try { db.exec('ALTER TABLE market_prices ADD COLUMN jita_buy_max REAL'); } catch {}
try { db.exec('ALTER TABLE assets ADD COLUMN location_flag TEXT'); } catch {}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Upsert a token row */
function saveToken(data) {
  db.prepare(`
    INSERT INTO tokens (character_id, character_name, corporation_id, corporation_name,
                        access_token, refresh_token, expires_at, scopes)
    VALUES (@character_id, @character_name, @corporation_id, @corporation_name,
            @access_token, @refresh_token, @expires_at, @scopes)
    ON CONFLICT(character_id) DO UPDATE SET
      character_name   = excluded.character_name,
      corporation_id   = excluded.corporation_id,
      corporation_name = excluded.corporation_name,
      access_token     = excluded.access_token,
      refresh_token    = excluded.refresh_token,
      expires_at       = excluded.expires_at,
      scopes           = excluded.scopes
  `).run(data);
}

function getToken(characterId) {
  return db.prepare('SELECT * FROM tokens WHERE character_id = ?').get(characterId);
}

function updateAccessToken(characterId, accessToken, expiresAt) {
  db.prepare('UPDATE tokens SET access_token = ?, expires_at = ? WHERE character_id = ?')
    .run(accessToken, expiresAt, characterId);
}

function getSetting(key, defaultValue = null) {
  const row = db.prepare('SELECT value FROM notification_settings WHERE key = ?').get(key);
  return row ? row.value : defaultValue;
}

function setSetting(key, value) {
  db.prepare('INSERT OR REPLACE INTO notification_settings (key, value) VALUES (?, ?)')
    .run(key, String(value));
}

function getSyncStatus(key) {
  return db.prepare('SELECT * FROM sync_status WHERE key = ?').get(key);
}

function setSyncStatus(key, error = null) {
  db.prepare('INSERT OR REPLACE INTO sync_status (key, last_sync, last_error) VALUES (?, ?, ?)')
    .run(key, Math.floor(Date.now() / 1000), error);
}

function cacheName(id, name, type = 'character') {
  db.prepare('INSERT OR REPLACE INTO name_cache (id, name, type) VALUES (?, ?, ?)')
    .run(id, name, type);
}

function getCachedName(id) {
  return db.prepare('SELECT name FROM name_cache WHERE id = ?').get(id);
}

module.exports = {
  db,
  saveToken, getToken, updateAccessToken,
  getSetting, setSetting,
  getSyncStatus, setSyncStatus,
  cacheName, getCachedName,
};
