'use strict';
const express = require('express');
const router  = express.Router();
const { requireAuth } = require('../auth');
const { db, getToken, getSetting, setSetting } = require('../db');

const TAX_REF_TYPES = [
  'bounty_prizes', 'ess_escrow_transfer', 'agent_mission_reward',
  'industry_job_tax', 'daily_goal_payouts',
];

// ── Settings ──────────────────────────────────────────────────────────────────

router.get('/weights', requireAuth, (req, res) => {
  res.json({
    weightTax:      parseInt(getSetting('health_weight_tax',      '30'), 10),
    weightMining:   parseInt(getSetting('health_weight_mining',   '30'), 10),
    weightKills:    parseInt(getSetting('health_weight_kills',    '20'), 10),
    weightActivity: parseInt(getSetting('health_weight_activity', '20'), 10),
    inactiveDays:   parseInt(getSetting('health_inactive_days',   '60'), 10),
  });
});

router.put('/weights', requireAuth, (req, res) => {
  const { weightTax, weightMining, weightKills, weightActivity, inactiveDays } = req.body;
  if (weightTax      !== undefined) setSetting('health_weight_tax',      String(parseInt(weightTax,      10)));
  if (weightMining   !== undefined) setSetting('health_weight_mining',   String(parseInt(weightMining,   10)));
  if (weightKills    !== undefined) setSetting('health_weight_kills',    String(parseInt(weightKills,    10)));
  if (weightActivity !== undefined) setSetting('health_weight_activity', String(parseInt(weightActivity, 10)));
  if (inactiveDays   !== undefined) setSetting('health_inactive_days',   String(parseInt(inactiveDays,   10)));
  res.json({ ok: true });
});

// ── Member Health ─────────────────────────────────────────────────────────────

router.get('/members', requireAuth, (req, res) => {
  const wTax      = parseInt(getSetting('health_weight_tax',      '30'), 10);
  const wMining   = parseInt(getSetting('health_weight_mining',   '30'), 10);
  const wKills    = parseInt(getSetting('health_weight_kills',    '20'), 10);
  const wActivity = parseInt(getSetting('health_weight_activity', '20'), 10);
  const inactiveD = parseInt(getSetting('health_inactive_days',   '60'), 10);

  const token  = getToken(req.session.characterId);
  const corpId = token?.corporation_id;

  // 30-day cutoff
  const cutoff = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);

  // ── 1. Build main→alts map from member_tracking ─────────────────────────
  const members = db.prepare(
    'SELECT character_id, character_name, logon_date FROM member_tracking'
  ).all();

  const altMaps = db.prepare('SELECT character_id, main_name FROM alt_mappings').all();
  const altToMain = new Map(altMaps.map(a => [a.character_id, a.main_name]));

  // Map: mainName → { mainName, charIds: Set, maxLogon }
  const mains = new Map();
  for (const m of members) {
    const mainName = altToMain.get(m.character_id) || m.character_name;
    if (!mains.has(mainName)) {
      mains.set(mainName, { mainName, charIds: new Set(), maxLogon: null, altCount: 0 });
    }
    const entry = mains.get(mainName);
    entry.charIds.add(m.character_id);
    if (m.character_name !== mainName) entry.altCount++;
    if (!entry.maxLogon || m.logon_date > entry.maxLogon) {
      entry.maxLogon = m.logon_date;
    }
  }

  if (mains.size === 0) {
    return res.json({
      members: [], weights: { tax: wTax, mining: wMining, kills: wKills, activity: wActivity },
      inactiveDays: inactiveD, summary: { active: 0, atRisk: 0, inactive: 0, total: 0 },
    });
  }

  // ── 2. Tax — aggregate by charId, then roll up to main ──────────────────
  const taxRows = db.prepare(`
    SELECT second_party_id AS cid, SUM(amount) AS total
    FROM wallet_journal
    WHERE date >= ? AND division = 1
      AND ref_type IN (${TAX_REF_TYPES.map(() => '?').join(',')})
      AND amount > 0 AND second_party_id IS NOT NULL
    GROUP BY second_party_id
  `).all(cutoff, ...TAX_REF_TYPES);
  const taxByChar = new Map(taxRows.map(r => [r.cid, r.total]));

  // ── 3. Mining — join with market prices, group by charId ────────────────
  const miningRows = db.prepare(`
    SELECT ml.character_id AS cid, SUM(ml.quantity * COALESCE(mp.jita_buy_max, 0)) AS value
    FROM mining_ledger ml
    LEFT JOIN market_prices mp ON mp.type_id = ml.type_id
    WHERE ml.date >= ?
    GROUP BY ml.character_id
  `).all(cutoff);
  const miningByChar = new Map(miningRows.map(r => [r.cid, r.value]));

  // ── 4. Kills — parse attackers_json, tally per charId ───────────────────
  const killRows = db.prepare(
    'SELECT attackers_json FROM corp_kills WHERE kill_time >= ?'
  ).all(cutoff);

  const killsByChar = new Map();
  for (const k of killRows) {
    let attackers;
    try { attackers = JSON.parse(k.attackers_json || '[]'); } catch { attackers = []; }
    const seenThisKill = new Set();
    for (const a of attackers) {
      if (!a.character_id) continue;
      if (corpId && a.corporation_id !== corpId) continue;
      seenThisKill.add(a.character_id);
    }
    for (const cid of seenThisKill) {
      killsByChar.set(cid, (killsByChar.get(cid) || 0) + 1);
    }
  }

  // ── 5. Roll up per-char scores to per-main ──────────────────────────────
  const now = Date.now();
  const results = [];

  for (const [, entry] of mains) {
    const ids = [...entry.charIds];

    const taxAmount   = ids.reduce((s, id) => s + (taxByChar.get(id)    || 0), 0);
    const miningValue = ids.reduce((s, id) => s + (miningByChar.get(id) || 0), 0);
    const killCount   = ids.reduce((s, id) => s + (killsByChar.get(id)  || 0), 0);
    const daysSinceLogin = entry.maxLogon
      ? (now - new Date(entry.maxLogon).getTime()) / 86400000
      : inactiveD; // treat never-logged-in as at the inactive threshold

    results.push({
      mainName:  entry.mainName,
      altCount:  entry.altCount,
      taxAmount,
      miningValue,
      killCount,
      daysSinceLogin: parseFloat(daysSinceLogin.toFixed(1)),
      // raw scores filled below after normalization
      taxScore: 0, miningScore: 0, killScore: 0, activityScore: 0,
      healthScore: 0, status: 'inactive',
    });
  }

  // ── 6. Normalize each metric to 0-100 ───────────────────────────────────
  const maxTax    = Math.max(...results.map(r => r.taxAmount),    1);
  const maxMining = Math.max(...results.map(r => r.miningValue),  1);
  const maxKills  = Math.max(...results.map(r => r.killCount),    1);

  for (const r of results) {
    r.taxScore     = parseFloat(((r.taxAmount    / maxTax)    * 100).toFixed(1));
    r.miningScore  = parseFloat(((r.miningValue  / maxMining) * 100).toFixed(1));
    r.killScore    = parseFloat(((r.killCount    / maxKills)  * 100).toFixed(1));
    r.activityScore = parseFloat(
      Math.max(0, 100 - r.daysSinceLogin * (100 / inactiveD)).toFixed(1)
    );

    const composite = (
      r.taxScore     * wTax      +
      r.miningScore  * wMining   +
      r.killScore    * wKills    +
      r.activityScore * wActivity
    ) / 100;

    r.healthScore = parseFloat(composite.toFixed(1));
    r.status = r.daysSinceLogin > inactiveD ? 'inactive'
             : r.healthScore >= 70          ? 'active'
             : r.healthScore >= 30          ? 'atrisk'
             :                                'inactive';
  }

  results.sort((a, b) => b.healthScore - a.healthScore);

  const summary = {
    active:   results.filter(r => r.status === 'active').length,
    atRisk:   results.filter(r => r.status === 'atrisk').length,
    inactive: results.filter(r => r.status === 'inactive').length,
    total:    results.length,
  };

  res.json({
    members: results,
    weights: { tax: wTax, mining: wMining, kills: wKills, activity: wActivity },
    inactiveDays: inactiveD,
    summary,
  });
});

module.exports = router;
