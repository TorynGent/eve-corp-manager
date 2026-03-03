'use strict';
const express = require('express');
const router  = express.Router();
const { requireAuth } = require('../auth');
const { db, getToken } = require('../db');

function currentPeriod() { return new Date().toISOString().slice(0, 7); }

function nextMonthStart(period) {
  const [y, m] = period.split('-').map(Number);
  const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
  return next + '-01T00:00:00Z';
}

// GET /api/kills — top killers + recent kills for a period
// Default (no period or period=rolling30) → rolling last 30 days, consistent
// with the wallet/taxpayer tab. Pass a YYYY-MM period for a specific month.
router.get('/', requireAuth, (req, res) => {
  const reqPeriod = req.query.period;
  const isRolling = !reqPeriod || reqPeriod === 'rolling30';

  let startDate, endDate, periodLabel;
  if (isRolling) {
    const now  = new Date();
    const past = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    startDate   = past.toISOString();
    endDate     = now.toISOString();
    periodLabel = 'Last 30 days';
  } else {
    startDate   = reqPeriod + '-01T00:00:00Z';
    endDate     = nextMonthStart(reqPeriod);
    periodLabel = reqPeriod;
  }

  // Get our corp ID so we only count OUR members, not allied pilots on the kill
  const token  = getToken(req.session.characterId);
  const corpId = token?.corporation_id;

  const kills = db.prepare(`
    SELECT * FROM corp_kills
    WHERE kill_time >= ? AND kill_time < ?
    ORDER BY kill_time DESC
  `).all(startDate, endDate);

  // Tally kills per main character — count each kill only ONCE per main
  // Only count attackers who belong to our corporation
  const byMain = {};
  for (const k of kills) {
    let attackers;
    try { attackers = JSON.parse(k.attackers_json || '[]'); } catch { attackers = []; }

    // Collect unique mains from OUR corp only on this kill
    const mainsThisKill = new Set();
    for (const a of attackers) {
      if (!a.character_id) continue;
      // Skip pilots not in our corp (allied fleetmates, etc.)
      if (corpId && a.corporation_id !== corpId) continue;

      const mapping  = db.prepare('SELECT main_name FROM alt_mappings WHERE character_id = ?').get(a.character_id);
      const cached   = db.prepare('SELECT name FROM name_cache WHERE id = ?').get(a.character_id);
      const mainName = mapping?.main_name || cached?.name || `ID:${a.character_id}`;
      mainsThisKill.add(mainName);
    }

    // Credit each unique main once for this kill
    for (const mainName of mainsThisKill) {
      if (!byMain[mainName]) byMain[mainName] = { mainName, kills: 0, totalValue: 0 };
      byMain[mainName].kills++;
      byMain[mainName].totalValue += k.total_value || 0;
    }
  }

  const top10 = Object.values(byMain).sort((a, b) => b.kills - a.kills).slice(0, 10);

  const recent = kills.slice(0, 50).map(k => ({
    killId:     k.kill_id,
    killTime:   k.kill_time,
    victimShip: k.victim_ship_name,
    systemName: k.solar_system_name,
    totalValue: k.total_value,
  }));

  const periods = [
    'rolling30',
    ...db.prepare(
      `SELECT DISTINCT substr(kill_time, 1, 7) AS p FROM corp_kills ORDER BY p DESC LIMIT 12`
    ).all().map(r => r.p),
  ];

  res.json({ top10, recentKills: recent, totalKills: kills.length, period: reqPeriod || 'rolling30', periodLabel, periods });
});

// POST /api/kills/sync — manually trigger zKillboard sync
router.post('/sync', requireAuth, async (req, res) => {
  const token = getToken(req.session.characterId);
  if (!token) return res.status(401).json({ error: 'Not authenticated' });
  try {
    const { syncKills } = require('../scheduler');
    syncKills(token.corporation_id).catch(e => console.error('[Kills] Manual sync error:', e.message));
    res.json({ ok: true, message: 'Kill sync started in background' });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

module.exports = router;
