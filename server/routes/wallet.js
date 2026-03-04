'use strict';
const express = require('express');
const router  = express.Router();
const { requireAuth } = require('../auth');
const { db, getSetting } = require('../db');

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
  'daily_goal_payouts',   // AIR Daily Goals (500k ISK reward × corp tax rate)
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

/**
 * GET /api/wallet/pnl?period=YYYY-MM
 * Income vs expense breakdown for a given month (default: current month).
 * Income = positive amounts grouped by ref_type.
 * Expenses = negative amounts grouped by ref_type (returned as absolute values).
 */
router.get('/pnl', requireAuth, (req, res) => {
  const period = req.query.period || new Date().toISOString().slice(0, 7);

  const income = db.prepare(`
    SELECT ref_type, SUM(amount) AS total, COUNT(*) AS cnt
    FROM wallet_journal
    WHERE division = 1
      AND date LIKE ?
      AND amount > 0
    GROUP BY ref_type
    ORDER BY total DESC
  `).all(period + '%');

  const expenses = db.prepare(`
    SELECT ref_type, SUM(ABS(amount)) AS total, COUNT(*) AS cnt
    FROM wallet_journal
    WHERE division = 1
      AND date LIKE ?
      AND amount < 0
    GROUP BY ref_type
    ORDER BY total DESC
  `).all(period + '%');

  const totalIncome   = income.reduce((s, r) => s + r.total, 0);
  const totalExpenses = expenses.reduce((s, r) => s + r.total, 0);

  res.json({
    period,
    totalIncome,
    totalExpenses,
    netFlow: totalIncome - totalExpenses,
    income:   income.map(r => ({ refType: r.ref_type, total: r.total, count: r.cnt })),
    expenses: expenses.map(r => ({ refType: r.ref_type, total: r.total, count: r.cnt })),
  });
});

/**
 * GET /api/wallet/multi-pnl?period=YYYY-MM
 * T-account style P&L for wallet divisions 1, 2, 3.
 *
 * "corporation_account_withdrawal" is EVE's ref_type for BOTH sides of an
 * inter-division transfer (debit in source, credit in destination).
 * It is NOT a real external expense. We keep it visible in each division card
 * but exclude it from the consolidated "real P&L" totals.
 *
 * Real income   = external credits (excl. inter-div types)
 * Real expenses = external debits  (excl. inter-div types)
 */
const INTER_DIV_TYPES = new Set(['corporation_account_withdrawal']);

router.get('/multi-pnl', requireAuth, (req, res) => {
  const period = req.query.period || new Date().toISOString().slice(0, 7);

  const DIVISION_NAMES = {
    1: 'Division 1 — Master',
    2: 'Division 2 — Equity',
    3: 'Division 3 — Profit',
  };

  const divisions = {};
  let realIncomeTotal  = 0;
  let realExpenseTotal = 0;

  for (const div of [1, 2, 3]) {
    const rows = db.prepare(`
      SELECT ref_type,
             SUM(CASE WHEN amount > 0 THEN amount      ELSE 0 END) AS credits,
             SUM(CASE WHEN amount < 0 THEN ABS(amount) ELSE 0 END) AS debits,
             COUNT(*) AS cnt
      FROM wallet_journal
      WHERE division = ? AND date LIKE ?
      GROUP BY ref_type
      HAVING credits > 0 OR debits > 0
      ORDER BY (credits + debits) DESC
    `).all(div, period + '%');

    const external = rows.filter(r => !INTER_DIV_TYPES.has(r.ref_type));
    const internal = rows.filter(r =>  INTER_DIV_TYPES.has(r.ref_type));

    const extIn  = external.reduce((s, r) => s + r.credits, 0);
    const extOut = external.reduce((s, r) => s + r.debits,  0);
    const intIn  = internal.reduce((s, r) => s + r.credits, 0);
    const intOut = internal.reduce((s, r) => s + r.debits,  0);

    realIncomeTotal  += extIn;
    realExpenseTotal += extOut;

    // Current live balance from last wallet sync (stored by scheduler)
    const balanceSetting = getSetting(`wallet_balance_${div}`);
    const currentBalance = balanceSetting !== null ? parseFloat(balanceSetting) : null;

    divisions[div] = {
      name:            DIVISION_NAMES[div] || `Division ${div}`,
      currentBalance,
      externalCredits: external.filter(r => r.credits > 0).map(r => ({ refType: r.ref_type, total: r.credits, count: r.cnt })),
      externalDebits:  external.filter(r => r.debits  > 0).map(r => ({ refType: r.ref_type, total: r.debits,  count: r.cnt })),
      internalCredits: internal.filter(r => r.credits > 0).map(r => ({ refType: r.ref_type, total: r.credits, count: r.cnt })),
      internalDebits:  internal.filter(r => r.debits  > 0).map(r => ({ refType: r.ref_type, total: r.debits,  count: r.cnt })),
      extIn,
      extOut,
      intIn,
      intOut,
      net: extIn - extOut + intIn - intOut,
    };
  }

  res.json({
    period,
    divisions,
    consolidated: {
      realIncome:   realIncomeTotal,
      realExpenses: realExpenseTotal,
      realNet:      realIncomeTotal - realExpenseTotal,
    },
  });
});

module.exports = router;
