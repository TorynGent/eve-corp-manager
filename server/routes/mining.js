'use strict';
const express = require('express');
const router  = express.Router();
const { requireAuth } = require('../auth');
const { db } = require('../db');

function currentPeriod() { return new Date().toISOString().slice(0, 7); }

// GET /api/mining — corp mining ledger for a period, grouped by main character
router.get('/', requireAuth, (req, res) => {
  const period = req.query.period || currentPeriod();

  const rows = db.prepare(`
    SELECT
      COALESCE(am.main_name, ml.character_name, 'ID:'||ml.character_id) AS main_name,
      ml.type_id,
      COALESCE(nc.name, ml.type_name, 'Type '||ml.type_id) AS type_name,
      SUM(ml.quantity) AS quantity
    FROM mining_ledger ml
    LEFT JOIN alt_mappings am ON am.character_id = ml.character_id
    LEFT JOIN name_cache nc ON nc.id = ml.type_id
    WHERE ml.date LIKE ? || '%'
    GROUP BY COALESCE(am.main_name, ml.character_name, 'ID:'||ml.character_id), ml.type_id
    ORDER BY COALESCE(am.main_name, ml.character_name, 'ID:'||ml.character_id), quantity DESC
  `).all(period);

  // Group by main
  const byMain = {};
  for (const r of rows) {
    if (!byMain[r.main_name]) {
      byMain[r.main_name] = { mainName: r.main_name, materials: [], totalQty: 0, totalValue: 0 };
    }
    const price     = db.prepare('SELECT jita_buy_max, average_price FROM market_prices WHERE type_id = ?').get(r.type_id);
    const unitPrice = price?.jita_buy_max || price?.average_price || 0;
    const value     = Math.round(r.quantity * unitPrice);
    byMain[r.main_name].materials.push({ typeName: r.type_name, quantity: r.quantity, unitPrice, value });
    byMain[r.main_name].totalQty   += r.quantity;
    byMain[r.main_name].totalValue += value;
  }

  const miners  = Object.values(byMain).sort((a, b) => b.totalValue - a.totalValue);
  const periods = db.prepare(
    `SELECT DISTINCT substr(date, 1, 7) AS p FROM mining_ledger ORDER BY p DESC LIMIT 12`
  ).all().map(r => r.p);

  res.json({ miners, period, periods, totalMiners: miners.length });
});

// GET /api/mining/top — top 10 miners this period by total quantity (for overview)
router.get('/top', requireAuth, (req, res) => {
  const period = req.query.period || currentPeriod();
  const rows = db.prepare(`
    SELECT
      COALESCE(am.main_name, ml.character_name, 'ID:'||ml.character_id) AS main_name,
      SUM(ml.quantity) AS total_quantity
    FROM mining_ledger ml
    LEFT JOIN alt_mappings am ON am.character_id = ml.character_id
    WHERE ml.date LIKE ? || '%'
    GROUP BY COALESCE(am.main_name, ml.character_name, 'ID:'||ml.character_id)
    ORDER BY total_quantity DESC
    LIMIT 10
  `).all(period);
  res.json(rows);
});

module.exports = router;
