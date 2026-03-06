# Markets (Profit Opportunities) Feature — Handoff Summary

## What Was Built

A new **Markets** tab in the EVE Corp Manager app that tracks **player structure** and **NPC region** market sell orders, infers sales from order snapshots, and shows velocity, restock lists, and optional target-stock % from CSV import.

---

## Database (server/db.js)

- **market_structures** — Which markets to track: `structure_id` (PK), `nickname`, `enabled`, `created_at`, `updated_at`.  
  - **Negative `structure_id`** = NPC region (e.g. `-10000002` = The Forge/Jita).  
  - **Positive** = player structure ID.
- **market_orders** — Current order snapshot: `order_id`, `structure_id`, `type_id`, `is_buy_order`, `price`, `volume_total`, `volume_remain`, `issued`, `duration`, `first_seen`, `last_seen`. Index on `(structure_id, type_id)`.
- **market_history** — Daily aggregates per structure/type: `structure_id`, `type_id`, `day`, `units_sold`, `total_isk`, `min_price`, `max_price`, `sell_order_sum`, `sell_order_samples`. Used for velocity and charts.
- **market_targets** — Target quantities for restock list: `structure_id`, `type_id`, `target_qty` (PK `(structure_id, type_id)`).

**Seed data:** Five NPC trade hubs are inserted with `INSERT OR IGNORE` at startup: Jita (The Forge), Amarr (Domain), Hek (Metropolis), Rens (Heimatar), Dodixie (Sinq Laison), with negative IDs and enabled by default.

---

## Backend

### Auth (server/auth.js)

- **Required scope added:** `esi-markets.structure_markets.v1` (for player structure market orders).  
- Re-auth required after adding scope.

### Scheduler (server/scheduler.js)

- **syncStructureMarkets(characterId)** — Runs in full sync and on hourly cron (at :15).
- For each row in `market_structures` with `enabled = 1`:
  - **If `structure_id < 0` (region):** calls `GET /markets/{region_id}/orders/` with `order_type: 'sell'` (no auth). Normalizes `min_price` → `price`, then same diff/upsert logic.
  - **If `structure_id > 0` (structure):** calls `GET /markets/structures/{structure_id}/` with auth. On 403, logs a friendly warning (scope or no character access).
- Logic: load current orders, diff with previous snapshot in `market_orders`, infer sold (disappeared orders + volume drops), write into `market_history` for today, replace `market_orders`. Only **sell** orders are stored.
- **Known limitation:** ESI checks **character** access. Alliance/coalition structures where only **corp** standing grants access often return 403; feature works for corp-owned structures and NPC regions.

### Routes (server/routes/markets.js)

- **GET /api/markets/structures** — List: corp structures + tracked externals + tracked regions (NPC hubs). Each item has `structureId`, `name`, `systemName`, `tracked`, `nickname`, `isCorp`, `isRegion`. Sorted with NPC hubs first.
- **POST /api/markets/structures** — Body: `structureId`, optional `nickname`. Adds or updates tracking (supports alliance structures added by ID).
- **DELETE /api/markets/structures/:id** — Stop tracking (sets `enabled = 0`).
- **GET /api/markets/summary** — Query: `structureId`, `search`, `days`. Returns items with `typeId`, `typeName`, `avgSellPrice`, `velocity7d`, `currentStock`, `sellOrderCount`, `avgSellOrders`, `targetQty`, `targetPct`.
- **GET /api/markets/history** — Query: `structureId`, `typeId`. Returns daily history for chart.
- **GET /api/markets/targets** — Query: `structureId`. Returns target list with current stock and `pct`.
- **POST /api/markets/targets/csv** — Body: `structureId`, `csvText`. CSV format: `ItemName,TargetQty` per line. Resolves names via `name_cache` and `market_prices`.

All summary/targets handlers wrapped in try/catch with `console.error('[Markets] ...')` for debugging.

### Server index (server/index.js)

- Mounted: `app.use('/api/markets', require('./routes/markets'))`.

### Settings sync status (server/routes/settings.js)

- Key `markets` added to sync-status list; label "Structure Markets" in Settings tab.

---

## Frontend

### HTML (public/index.html)

- New nav tab: **Markets** (`data-tab="markets"`).
- New panel **tab-markets**:
  - Structure dropdown + “Track this market”.
  - Short note on ESI limitation (character vs corp standing).
  - **Add structure by ID:** inputs for Structure ID and Nickname, “Add & track” (for alliance/external structures).
  - Table: Item, Avg sell, Velocity, Stock, Orders, Target %.
  - Search by item name, 7/14/30d selector.
  - Item history chart (click row).
  - Target stock section: Import CSV, list of items with current vs target and %.
- Login page: scope `esi-markets.structure_markets.v1` listed.
- Script: `markets.js` loaded.

### JS (public/js/markets.js, public/js/app.js)

- **loadMarkets()** — Fetches structures, builds dropdown (option `value` is **string** for negative IDs), restores last selection from localStorage, calls **bindMarketsOnce()**, then **refreshMarketsSummary()** and **loadMarketsTargets()** if a structure is selected.
- **bindMarketsOnce()** — One-time bind of change, track, add-by-ID, search, days, CSV. Change handler and async paths guarded with try/catch and `[Markets]` logging.
- **onMarketsStructureChange()** — Reads `sel.value` (string), parses to int, allows null/NaN, then refresh summary + targets. Try/catch + log.
- **refreshMarketsSummary()** / **loadMarketsTargets()** — Null-safe DOM, validate `data.rows` as array, defensive `esc()`. Errors caught and logged; show user-friendly message in table/targets area.
- **addMarketsStructureById()** — POST structureId + nickname, then reload list and select new structure.
- **selectMarketsItem(typeId)** — Fetches history, draws Chart.js line chart (units sold + avg price).
- **Debounce** on search input.
- **app.js** — `loadTabContent('markets')` and `refreshTab('markets')` call `loadMarkets()`.

Crash fixes: dropdown values as strings so selection matches for negative IDs; try/catch and logging in all Markets handlers; defensive checks for missing elements and malformed API responses.

---

## Docs

- **README.md** — Markets tab in features table; Structure markets in “What syncs automatically”; scope `esi-markets.structure_markets.v1` with “add then re-auth”; note that alliance (corp-standing-only) often 403.
- **Login / Markets tab copy** — Limitation explained (character access; corp-standing-only structures often 403).

---

## Decisions / Limitations

1. **Alliance structures** — Access is character-based in ESI. Where only corp standing grants in-game access, ESI often returns 403. No app-side fix; works for corp structures and NPC regions.
2. **NPC hubs** — Implemented as **regions** (negative `structure_id` = `-region_id`). Jita = The Forge, Amarr = Domain, Hek = Metropolis, Rens = Heimatar, Dodixie = Sinq Laison. Region orders are public (no auth). First sync for Jita can be heavy (many pages).
3. **Only sell orders** — Stored and summarized; buy orders not used for velocity/history.
4. **Targets CSV** — Resolves names via `name_cache` and `market_prices`; unknown names are skipped and reported in `errors`.

---

## Possible Follow-Ups

- Throttle or limit region sync (e.g. max pages per run) if Jita causes timeouts or rate limits.
- Optional: show “(NPC hub)” vs “(external)” more prominently in UI.
- If CCP adds corp-standing-based market access or a different scope, switch structure market calls to that.
- Any further crash logs will appear as `[Markets] ... error:` in DevTools console (renderer) or server stdout (API).

---

*Summary generated for handoff to a follow-up agent. Markets feature is fully integrated; main known limit is 403 on alliance structures where only corp standing applies.*
