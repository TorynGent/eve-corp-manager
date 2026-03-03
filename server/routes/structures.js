'use strict';
const express = require('express');
const router  = express.Router();
const { requireAuth } = require('../auth');
const { db }          = require('../db');

const METENOX_TYPE_ID  = 81826;

// Corp hangar that holds fuel blocks + magmatic gas stock.
// ESI uses CorpSAG1–CorpSAG7 for the 7 corp divisions; hangar names are set in-game
// but NOT exposed via ESI. Change this if your fuel hangar is a different division.
const FUEL_GAS_HANGAR  = 'CorpSAG3'; // 3rd hangar — "Ressources - Rohstoffe"

// GET /api/structures — return all synced structures with fuel/gas calculations
router.get('/', requireAuth, (req, res) => {
  const structures = db.prepare('SELECT * FROM structures ORDER BY name').all();

  const result = structures.map(s => {
    // Fuel block days remaining
    const fuelExpires   = s.fuel_expires ? new Date(s.fuel_expires) : null;
    const fuelDaysLeft  = fuelExpires
      ? Math.max(0, (fuelExpires - Date.now()) / 86400000)
      : null;

    // Magmatic gas (manual data)
    const isMetenox = s.type_id === METENOX_TYPE_ID;
    let gas = null;
    if (isMetenox) {
      const g = db.prepare('SELECT * FROM structure_gas WHERE structure_id = ?').get(s.structure_id);
      if (g && g.last_refill_date && g.quantity_refilled > 0) {
        const refillMs    = new Date(g.last_refill_date).getTime();
        const msElapsed   = Date.now() - refillMs;
        const daysElapsed = msElapsed / 86400000;
        const remaining   = g.quantity_refilled - (daysElapsed * g.daily_consumption);
        const gasDaysLeft = remaining > 0 ? remaining / g.daily_consumption : 0;
        const gasExpires  = new Date(refillMs + (g.quantity_refilled / g.daily_consumption) * 86400000);

        gas = {
          lastRefillDate:  g.last_refill_date,
          quantityRefilled: g.quantity_refilled,
          dailyConsumption: g.daily_consumption,
          estimatedRemaining: Math.max(0, Math.round(remaining)),
          daysLeft:        parseFloat(gasDaysLeft.toFixed(1)),
          estimatedExpires: gasExpires.toISOString(),
          notes:           g.notes,
        };
      } else {
        gas = { lastRefillDate: null, quantityRefilled: 0, dailyConsumption: g?.daily_consumption || 4800,
                estimatedRemaining: null, daysLeft: null, estimatedExpires: null, notes: g?.notes || null };
      }
    }

    return {
      structureId:  s.structure_id,
      name:         s.name,
      typeId:       s.type_id,
      typeName:     s.type_name,
      systemName:   s.system_name,
      state:        s.state,
      services:     tryParse(s.services),
      fuelExpires:  s.fuel_expires,
      fuelDaysLeft: fuelDaysLeft !== null ? parseFloat(fuelDaysLeft.toFixed(1)) : null,
      isMetenox,
      gas,
      syncedAt:     s.synced_at,
    };
  });

  res.json(result);
});

// PUT /api/structures/:id/gas — update manual gas data
router.put('/:id/gas', requireAuth, (req, res) => {
  const structureId = parseInt(req.params.id, 10);
  const { lastRefillDate, quantityRefilled, dailyConsumption, notes } = req.body;

  db.prepare(`
    INSERT INTO structure_gas (structure_id, last_refill_date, quantity_refilled, daily_consumption, notes)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(structure_id) DO UPDATE SET
      last_refill_date  = excluded.last_refill_date,
      quantity_refilled = excluded.quantity_refilled,
      daily_consumption = excluded.daily_consumption,
      notes             = excluded.notes
  `).run(structureId, lastRefillDate, quantityRefilled || 0, dailyConsumption || 4800, notes || null);

  res.json({ ok: true });
});

// GET /api/structures/inventory — gas + fuel block stocks across all corp hangars
router.get('/inventory', requireAuth, (req, res) => {
  const FUEL_IDS        = [4051, 4246, 4247, 4312]; // Caldari/Gallente/Amarr/Minmatar Fuel Blocks
  const GAS_TYPE_ID     = 81143; // Magmatic Gas
  const metenoxCount    = db.prepare('SELECT COUNT(*) AS c FROM structures WHERE type_id = ?').get(METENOX_TYPE_ID).c;
  const structureCount  = db.prepare('SELECT COUNT(*) AS c FROM structures').get().c;

  // Build a JS-side lookup map for structure names.
  // We avoid a SQL JOIN here because location_id in the assets table was added via ALTER TABLE
  // (INTEGER affinity migration), which can cause type-mismatch silences in SQLite JOINs.
  // String-keyed JS map is reliable regardless of integer storage nuances.
  const structureMap = {};
  db.prepare('SELECT structure_id, name, system_name FROM structures').all()
    .forEach(s => {
      structureMap[String(s.structure_id)] = {
        name:        s.name        || `Loc ${s.structure_id}`,
        system_name: s.system_name || '',
      };
    });

  function locLabel(locationId) {
    const key = String(locationId);

    // 0. Manual name override (user-defined via the ✏️ button) — always wins
    const override = db.prepare('SELECT value FROM notification_settings WHERE key = ?')
      .get(`loc_name_${locationId}`);
    if (override?.value) return { structure_name: override.value, system_name: '' };

    // 1. Corp-owned structure (best: has system name too)
    if (structureMap[key]) {
      return {
        structure_name: structureMap[key].name,
        system_name:    structureMap[key].system_name,
      };
    }

    // 2. Alliance / other-corp structure — check name_cache (populated by resolveStructureName)
    const cached = db.prepare('SELECT name FROM name_cache WHERE id = ?').get(locationId);
    if (cached?.name) {
      return { structure_name: cached.name, system_name: '' };
    }

    // 3. Completely unknown
    return { structure_name: `Loc ${locationId}`, system_name: '' };
  }

  // Gas in the designated fuel/gas hangar only (CorpSAG3 by default)
  const gasRaw = db.prepare(`
    SELECT location_id, SUM(quantity) AS qty
    FROM assets
    WHERE type_id = ?
      AND location_flag = ?
    GROUP BY location_id
  `).all(GAS_TYPE_ID, FUEL_GAS_HANGAR);

  const gasRows = gasRaw
    .map(r => ({ location_id: r.location_id, qty: r.qty, ...locLabel(r.location_id) }))
    .sort((a, b) => a.system_name.localeCompare(b.system_name) || a.structure_name.localeCompare(b.structure_name));

  const totalGas         = gasRows.reduce((s, r) => s + r.qty, 0);
  const gasConsumPerHour = 200 * metenoxCount;
  const gasHoursLeft     = gasConsumPerHour > 0 && totalGas > 0 ? totalGas / gasConsumPerHour : null;

  // Fuel blocks in the designated fuel/gas hangar only (CorpSAG3 by default)
  const ph      = FUEL_IDS.map(() => '?').join(',');
  const fuelRaw = db.prepare(`
    SELECT type_id, type_name, location_id, SUM(quantity) AS qty
    FROM assets
    WHERE type_id IN (${ph})
      AND location_flag = ?
    GROUP BY type_id, location_id
  `).all(...FUEL_IDS, FUEL_GAS_HANGAR);

  const fuelRows = fuelRaw
    .map(r => ({
      type_id:   r.type_id,
      type_name: r.type_name || `Type ${r.type_id}`,
      qty:       r.qty,
      location_id: r.location_id,
      ...locLabel(r.location_id),
    }))
    .sort((a, b) => a.system_name.localeCompare(b.system_name) || a.structure_name.localeCompare(b.structure_name) || a.type_name.localeCompare(b.type_name));

  const totalFuel         = fuelRows.reduce((s, r) => s + r.qty, 0);
  const fuelConsumPerHour = 5 * structureCount;
  const fuelHoursLeft     = fuelConsumPerHour > 0 && totalFuel > 0 ? totalFuel / fuelConsumPerHour : null;

  res.json({
    gas: {
      rows:              gasRows,
      total:             totalGas,
      metenoxCount,
      consumptionPerHour: gasConsumPerHour,
      hoursLeft:         gasHoursLeft ? Math.round(gasHoursLeft) : null,
      daysLeft:          gasHoursLeft ? parseFloat((gasHoursLeft / 24).toFixed(1)) : null,
    },
    fuel: {
      rows:              fuelRows,
      total:             totalFuel,
      structureCount,
      consumptionPerHour: fuelConsumPerHour,
      hoursLeft:         fuelHoursLeft ? Math.round(fuelHoursLeft) : null,
      daysLeft:          fuelHoursLeft ? parseFloat((fuelHoursLeft / 24).toFixed(1)) : null,
    },
  });
});

// PUT /api/structures/location-name — save (or clear) a manual name override for a location ID
router.put('/location-name', requireAuth, (req, res) => {
  const { locationId, name } = req.body;
  if (!locationId) return res.status(400).json({ error: 'locationId required' });

  const key = `loc_name_${locationId}`;
  if (name && name.trim()) {
    db.prepare('INSERT OR REPLACE INTO notification_settings (key, value) VALUES (?, ?)')
      .run(key, name.trim());
  } else {
    // Empty/null name = clear the override (fall back to auto-resolved name)
    db.prepare('DELETE FROM notification_settings WHERE key = ?').run(key);
  }
  res.json({ ok: true });
});

function tryParse(s) { try { return JSON.parse(s); } catch { return []; } }

module.exports = router;
