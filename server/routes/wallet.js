'use strict';
const express = require('express');
const router  = express.Router();
const { requireAuth } = require('../auth');
const { db }          = require('../db');

// Ref types we count as "tax-generating" income from members.
// Deliberately excludes: transaction_tax (corp's own broker fees — expense),
// market_transaction (corp's own market activity), contract_price_payment_corp
// (corp-level income, not member tax), bounty_prize (singular — player bounty
// claims, not NPC ratting tax).
const TAX_REF_TYPES = [
  'bounty_prizes',        // NPC bounty tax + ESS regular payouts
  'ess_escrow_transfer',  // ESS reserve bank payouts
  'agent_mission_reward', // mission runner tax
  'industry_job_tax',     // manufacturing / research job tax
];

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Resolve a character ID to { charName, mainName } using the DB cache */
function resolveChar(charId) {
  const nameRow = db.prepare('SELECT name FROM name_cache WHERE id = ?').get(charId);
  const mapping = db.prepare('SELECT main_name FROM alt_mappings WHERE character_id = ?').get(charId);
  const charName = nameRow?.name || `ID:${charId}`;
  return { charName, mainName: mapping?.main_name || charName };
}

/**
 * Compute rolling 30-day taxpayer list directly from wallet_journal (division 1 only).
 * Groups alts into their main character and returns sorted array.
 */
function computeRollingTaxpayers() {
  const cutoff = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);

  const rawRows = db.prepare(`
    SELECT second_party_id, SUM(amount) AS total
    FROM wallet_journal
    WHERE date >= ?
      AND division = 1
      AND second_party_id IS NOT NULL
      AND ref_type IN (${TAX_REF_TYPES.map(() => '?').join(',')})
      AND amount > 0
    GROUP BY second_party_id
  `).all(cutoff, ...TAX_REF_TYPES);

  // Aggregate individual alts into their main character
  const byMain = {};
  for (const r of rawRows) {
    const { charName, mainName } = resolveChar(r.second_party_id);
    if (!byMain[mainName]) {
      byMain[mainName] = { character_name: charName, main_name: mainName, total_amount: 0 };
    }
    byMain[mainName].total_amount += r.total;
  }

  return Object.values(byMain).sort((a, b) => b.total_amount - a.total_amount);
}

// ── Routes ────────────────────────────────────────────────────────────────────

/**
 * GET /api/wallet/taxpayers?limit=5&period=2026-03
 * Default (no period or period=rolling): rolling 30-day window from wallet_journal (live).
 * With period=YYYY-MM: historical month from pre-computed tax_summary.
 */
router.get('/taxpayers', requireAuth, (req, res) => {
  const period = req.query.period;
  const limit  = parseInt(req.query.limit || '5', 10);

  if (period && period !== 'rolling') {
    // Historical month from pre-computed tax_summary
    const summary = db.prepare(`
      SELECT main_name AS character_name, main_name, SUM(total_amount) AS total_amount
      FROM tax_summary WHERE period = ?
      GROUP BY main_name
      ORDER BY total_amount DESC LIMIT ?
    `).all(period, limit);
    return res.json({ period, data: summary });
  }

  // Rolling 30 days (default) — computed live, aggregated by main
  const data = computeRollingTaxpayers().slice(0, limit);
  res.json({ period: 'rolling', data });
});

/**
 * GET /api/wallet/journal?page=1&type=all&period=2026-03
 * Always returns Master Wallet (division 1) entries only.
 */
router.get('/journal', requireAuth, (req, res) => {
  const page   = Math.max(1, parseInt(req.query.page || '1', 10));
  const limit  = 50;
  const offset = (page - 1) * limit;
  const period = req.query.period || null;
  const type   = req.query.type   || 'all';

  // Always division 1 (Master Wallet) — other divisions are inter-division transfers etc.
  let where = 'division = 1';
  const args = [];

  if (period) { where += ' AND date LIKE ?'; args.push(period + '%'); }
  if (type !== 'all') { where += ' AND ref_type = ?'; args.push(type); }

  const total = db.prepare(`SELECT COUNT(*) AS c FROM wallet_journal WHERE ${where}`).get(...args).c;
  const rows  = db.prepare(`
    SELECT * FROM wallet_journal WHERE ${where}
    ORDER BY date DESC LIMIT ? OFFSET ?
  `).all(...args, limit, offset);

  res.json({ total, page, pages: Math.ceil(total / limit), rows });
});

/**
 * GET /api/wallet/history?days=30
 * Returns the end-of-day running balance for division 1 (Master Wallet) per day.
 * Uses the most recent journal entry per day (MAX journal_id per day, div=1).
 */
router.get('/history', requireAuth, (req, res) => {
  const days   = parseInt(req.query.days || '30', 10);
  const cutoff = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);

  // Inner join to get only the LAST entry per day for division 1
  const rows = db.prepare(`
    SELECT date(w.date) AS day, w.balance
    FROM wallet_journal w
    INNER JOIN (
      SELECT date(date) AS d, MAX(journal_id) AS max_id
      FROM wallet_journal
      WHERE division = 1 AND date >= ? AND balance IS NOT NULL
      GROUP BY d
    ) latest ON date(w.date) = latest.d AND w.journal_id = latest.max_id
    ORDER BY day ASC
  `).all(cutoff);

  res.json(rows);
});

/**
 * GET /api/wallet/groups?period=
 * Tax totals grouped by main character for the donut chart.
 * Default: rolling 30 days. With period=YYYY-MM: historical from tax_summary.
 */
router.get('/groups', requireAuth, (req, res) => {
  const period = req.query.period;

  if (period && period !== 'rolling') {
    const rows = db.prepare(`
      SELECT main_name, SUM(total_amount) AS total
      FROM tax_summary WHERE period = ?
      GROUP BY main_name ORDER BY total DESC
    `).all(period);
    return res.json({ period, data: rows });
  }

  // Rolling 30 days
  const all  = computeRollingTaxpayers();
  const data = all.map(r => ({ main_name: r.main_name, total: r.total_amount }));
  res.json({ period: 'rolling', data });
});

/** GET /api/wallet/periods — available historical months in tax_summary */
router.get('/periods', requireAuth, (req, res) => {
  const rows = db.prepare('SELECT DISTINCT period FROM tax_summary ORDER BY period DESC').all();
  res.json(rows.map(r => r.period));
});

module.exports = router;
