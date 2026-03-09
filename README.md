# EVE Corp Manager

Hi! Mostly Vibe Coded this App with Claude Code and Cursor. Was intended for the management of my own corp but I thought might as well build it in a way that others could benefit too. So here it is.

A private, local-only corporation management dashboard for EVE Online. All data stays on your machine — nothing is sent anywhere except to ESI (esi.evetech.net), your SMTP server if you configure email alerts, and optionally a Discord webhook for structure alerts.

---

## For End Users — Installing the App

1. Download the latest `EVE-Corp-Manager-Setup-x.x.x.exe` from the [Releases](../../releases) page
2. Run the installer, choose your install path, let it finish
3. Launch **EVE Corp Manager** from your desktop or Start Menu
4. Log in with your Director or CEO character via EVE SSO
5. Data syncs automatically — no terminal, no browser, no setup

> **First launch:** The app creates its config and database automatically in `%AppData%\eve-corp-manager\`. Nothing is written to the install folder. Consider alt,main mapping in settings as your first step to get properly aggregated data (on main chars, not on every alt)

> **Antivirus / Windows Defender may flag the installer or EXE** — Some antivirus software will report the installer or the app as a potential threat (e.g. "Unknown publisher", "Heuristic" or "Generic" detection). **The program is safe.** It is open-source and does not contain malware. Common reasons for false positives: (1) the app is **not code-signed** (no paid certificate from a CA), so Windows and AV vendors treat it as "unknown"; (2) **Electron** apps bundle Node.js and native code, which can trigger heuristic scans; (3) new or rarely-downloaded executables often lack a "reputation" score. You can add an exclusion for the install folder or the downloaded installer, or choose "Run anyway" / "More info → Run anyway" when Windows warns. Builds are produced locally via `npm run dist`; the source is on GitHub for review.

---

## Features

| Tab | What it shows |
|-----|---------------|
| **Overview** | KPI summary — wallet, fuel status, recent kills, top taxpayers; dashboard load errors show a retry banner |
| **Structures** | Fuel days remaining, gas stock, alerts for low fuel/gas; fuel overrides and manual gas data (Metenox); manual location names for stock stations. Automatic fuel/mo is from online service modules; if it shows ~2× in-game, set **Display → Fuel “month” hours** to 360 (15-day period). |
| **Metenox** | Moon drill profitability vs live Jita prices, manual material entry. Materials dropdown is grouped by R tier (R4→R64) and sorted alphabetically within each tier. Gas modal: enter **quantity in Metenox after refilling** (total in structure), not the amount added. |
| **Wallet & Tax** | Monthly corp flow chart (income / expenses / net per month, last 12 months, CSV export of all history); corp wallet journal (search + Enter), taxpayer leaderboard (alt-aggregated), CSV export |
| **Corp Kills** | Kill rankings (rolling 30-day + monthly), ISK destroyed, period presets |
| **Member Health** | Tax, kills, activity, login weights for activity tracking; Fleet Points addable; responsive KPI grid |
| **Settings** | Sync status, backup & restore, email & Discord notifications, **Display** (color-blind mode, **date format** dd.mm.yyyy / mm.dd.yyyy, **fuel “month” hours** for Structures), corp rates, fuel hangar selector, alt→main mappings (at bottom) |

**UX & accessibility**
- **Color-blind friendly mode** — Settings → Display. Uses blue/orange/magenta palette for charts and indicators; applies to all built-in charts (kills, Metenox, dashboard).
- **Date format** — Settings → Display: choose **dd.mm.yyyy (EU)** or **mm.dd.yyyy (US)**; applies to all date displays (wallet, kills, structures, etc.).
- **Keyboard** — Arrow Left/Right switch tabs (when not in an input); Escape closes modals (gas, Metenox manual materials).
- **Toasts** — Success/error feedback via non-blocking toasts (bottom-right) instead of `alert()`; destructive actions still use confirm dialogs.
- **API errors** — Server error messages are shown in the UI (not just "API 403"); dashboard and exports show retry or clear messages.
- **Wallet journal** — Search button and “or press Enter” hint; journal loads on Enter.
- **Responsive** — Member Health KPIs reflow to 2 columns (≤680px) and 1 column (≤480px).

**Notifications**
- **Email** — Optional SMTP config for fuel/gas structure alerts (daily digest at 08:00 UTC).
- **Discord webhook** — Optional webhook URL; when set, the same fuel/gas alerts are posted to your Discord channel (or use Discord only without email). Test with **Send Test to Discord** in Settings.

---

## What syncs automatically

| Data | Frequency |
|------|-----------|
| Structures & fuel | Every hour |
| Corp wallet | Every hour |
| Corp assets (gas/fuel stock) | Every hour |
| Member tracking | Every hour |
| Corp kills | Every hour |
| Jita market prices | Every 5 minutes |
| Email alert check | Daily 08:00 UTC |
| Monthly snapshot | 1st of each month |

**Sync Now** is also available from the Settings tab or the tray icon right-click menu.

---

## Closing the App

- **Log Off Only** — closes the window, keeps the server running in the background (syncs continue). Re-open via the tray icon.
- **Shut Down** — stops everything completely. Access via the Logout button in the top-right.
- **X button** — shuts down completely (same as Shut Down).

---

## EVE SSO Scopes Required

When registering your application at https://developers.eveonline.com/applications, choose **Native Application** (no client secret). Add these scopes:

- `esi-wallet.read_corporation_wallets.v1`
- `esi-corporations.read_structures.v1`
- `esi-corporations.read_corporation_membership.v1`
- `esi-corporations.track_members.v1`
- `esi-industry.read_corporation_mining.v1`
- `esi-assets.read_corporation_assets.v1`
- `esi-universe.read_structures.v1`

Callback URL: `http://localhost:3000/auth/callback`

---

## CSV exports

You can export data as CSV for use in spreadsheets or external reporting:

- **Wallet & Tax tab** — **Export tax CSV**: tax summary by period (uses the same period as the “Tax Contributions by Group” selector). **Export CSV** next to Wallet Journal: journal entries (division 1) for the selected period and optional ref-type filter, up to 10,000 rows. **Export CSV** next to the Monthly Corp Flow chart: all available monthly income/expenses/net history (not just the 12 months shown in the chart).

Files download with sensible names (e.g. `wallet-journal-2026-03.csv`, `tax-summary-2026-03.csv`, `corp-monthly-flow.csv`).

---

## Email & Discord Notifications (optional)

Structure alerts (low fuel blocks or low magmatic gas) can be sent by **email** and/or **Discord**. Configure in **Settings → Email & Discord Notifications**:
- Enter SMTP server, port, username, password
- For Gmail: use an [App Password](https://support.google.com/accounts/answer/185833), not your regular password
- Set **Fuel Block Alert Threshold** (days) and **Magmatic Gas Alert Threshold** (days)
- Enter **Recipients** (comma- or semicolon-separated email addresses)
- Optionally set **From Address** (e.g. `EVE Corp Dashboard <no-reply@example.com>`)
- **Discord Webhook URL** (optional): create a webhook in Discord (Channel → Edit → Integrations → Webhooks). When set, fuel/gas alerts are also sent to that channel (or you can use Discord only and leave email blank).
- Click **Send Test Email** or **Send Test to Discord** to verify

**How it works**
- The app runs an **alert check once per day at 08:00 UTC** (see “What syncs automatically”).
- For each corp structure it compares **fuel days remaining** to your fuel threshold and **magmatic gas days** (Metenox only) to your gas threshold. If either is at or below the threshold, that structure is added to the day’s alert list.
- All qualifying structures are sent in **one digest** (by email and/or Discord) with structure name, system, type (Fuel Blocks or Magmatic Gas), days left, and expiry date.
- The same structure and alert type (fuel or gas) is **not re-sent within 24 hours** — so you get at most one alert per structure per issue per day.
- You can **turn notifications off** without clearing SMTP or Discord settings.
- Recent sent alerts appear under **Recent Alerts Sent** in the same panel.

---

## Security & data protection

- **OAuth tokens** — Access and refresh tokens are encrypted at rest. In the packaged app, Electron safeStorage (e.g. Windows DPAPI) is used; when running from source with a proper `SESSION_SECRET`, tokens use AES-256-GCM with a key derived from the secret. A one-time migration on startup encrypts any existing plaintext tokens. Backups still contain the encrypted values — treat backup files as sensitive and store them securely.
- **SMTP password** — Encrypted at rest (same mechanism as above); only a “password set” flag is sent to the UI.
- **Session** — Session cookie uses `httpOnly`, `sameSite: 'lax'`, and `secure` in production. Login uses EVE SSO with PKCE (no client secret) and OAuth state for CSRF protection.
- **Backup & restore** — Downloading a backup shows a warning that the file contains sensitive data (tokens, settings). Restore only accepts files that are valid SQLite databases (magic-bytes check).
- **API** — All data-changing and data-reading routes require an authenticated session; SQL uses parameterized queries throughout.

---

## Alt → Main Mapping

Aggregate kills and tax by main character:
- **Settings tab → Import CSV** — one `AltName,MainName` pair per line
- Or run `python scripts\import_alts.py` to import from Corp Management.xlsx

---

## Data Location

All data is stored in `%AppData%\eve-corp-manager\corp.db` (SQLite). OAuth tokens and SMTP password are stored encrypted in the database. Uninstalling the app does **not** delete this folder — your data is preserved across updates.

---

## For Developers — Running from Source

### Prerequisites
- Node.js v22+ — https://nodejs.org
- Git

### Setup
```bash
git clone <repo-url>
cd eve-app
npm install
```

Create a `.env` file:
```
EVE_CLIENT_ID=your_client_id
EVE_CALLBACK_URL=http://localhost:3000/auth/callback
SESSION_SECRET=any_long_random_string
```

> Use **Native Application** in the EVE dev portal — no client secret. Keep `SESSION_SECRET` long and random (or let the packaged app generate it on first launch).

### Run in Electron (dev mode)
```bash
npm run electron
```
This opens the full app window. Right-click → Inspect for DevTools.

### Build Windows installer
```bash
npm run dist
```
Output: `dist/EVE-Corp-Manager-Setup-x.x.x.exe`

**Changing the app icon before building**

- **EXE and installer icon (Windows)**  
  Put your icon file in the `build/` folder and name it **`app.ico`** (not `icon.ico`). The build reads `build/app.ico` (see `package.json` → `build.win.icon`). So: copy your .ico into `build/`, rename it to **app.ico**, then run `npm run dist`. Nothing in the project uses or overwrites `app.ico`.  
  To get a placeholder first, run `npm run make-icon` — that creates `build/icon-placeholder.ico`; the installer still uses `app.ico` when present. Use a multi-size .ico (e.g. 16×16, 32×32, 48×48, 256×256) for best results.

- **Tray icon (system tray)**  
  The tray uses the image from `electron/icon.js`, which currently generates a solid teal square. To use your own image: add a PNG (e.g. `electron/icon.png`) and change `electron/icon.js` to load it, e.g.  
  `module.exports = require('electron').nativeImage.createFromPath(require('path').join(__dirname, 'icon.png'));`

Then run `npm run dist` as usual.

### Security check (dependencies)
```bash
npm run security-check
```
Runs `npm audit`. Use `npm audit fix` (or `npm audit fix --force` after checking breaking changes) before releases.

> **Note:** After `npm run dist`, `better-sqlite3` is compiled for Electron's Node.js. Use `npm run electron` for dev — do not use `npm start` (system Node.js version mismatch).

---

## Quick reference — maintainers

| I want to… | Do this |
|------------|--------|
| **Run the app (dev)** | `npm run electron` |
| **Run server only (no window)** | `npm start` |
| **Build installer** | `npm run dist` |
| **Check dependencies for vulnerabilities** | `npm run security-check` or `npm audit`; then `npm audit fix` (or `npm audit fix --force` if you accept breaking changes) |
| **Remember security & data protection** | Open **`.claude/SECURITY-DATA-PROTECTION-AUDIT.md`** — checklist, regular cadence (Section 9), and what was implemented |
| **Remember session/feature context** | Open **`.claude/SESSION-HANDOFF.md`** — what was built last session, design notes, key files |
| **Backup data** | Settings → Backup & Restore → Download. File contains sensitive data (tokens, settings); store securely. |
| **Restore data** | Settings → Backup & Restore → choose file → Upload. Restart the app to apply. |

**Security habit:** Before each release, run `npm audit` and fix any reported issues. Every few months, skim the audit doc (Section 9).
