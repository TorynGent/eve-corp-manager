# EVE Corp Manager

A private, local-only corporation management dashboard for EVE Online. All data stays on your machine — nothing is sent anywhere except to ESI (esi.evetech.net) and your SMTP server if you configure email alerts.

---

## For End Users — Installing the App

1. Download the latest `EVE-Corp-Manager-Setup-x.x.x.exe` from the [Releases](../../releases) page
2. Run the installer, choose your install path, let it finish
3. Launch **EVE Corp Manager** from your desktop or Start Menu
4. Log in with your Director or CEO character via EVE SSO
5. Data syncs automatically — no terminal, no browser, no setup

> **First launch:** The app creates its config and database automatically in `%AppData%\eve-corp-manager\`. Nothing is written to the install folder.

---

## Features

| Tab | What it shows |
|-----|---------------|
| **Overview** | KPI summary — wallet, fuel status, recent kills, top taxpayers |
| **Structures** | Fuel days remaining, gas stock, alerts for low fuel/gas |
| **Metenox** | Moon drill profitability vs live Jita prices, manual material entry |
| **Wallet & Tax** | Corp wallet journal, taxpayer leaderboard (alt-aggregated) |
| **Mining** | Mining ledger by member/main, monthly totals |
| **Corp Kills** | Kill rankings (rolling 30-day + monthly), ISK destroyed |
| **Settings** | Sync status, email notifications, alt→main mappings |

---

## What syncs automatically

| Data | Frequency |
|------|-----------|
| Structures & fuel | Every hour |
| Corp wallet | Every hour |
| Corp assets (gas/fuel stock) | Every hour |
| Member tracking | Every hour |
| Mining ledger | Every hour |
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

When registering your application at https://developers.eveonline.com/applications, add these scopes:

- `esi-wallet.read_corporation_wallets.v1`
- `esi-corporations.read_structures.v1`
- `esi-corporations.read_corporation_membership.v1`
- `esi-corporations.track_members.v1`
- `esi-industry.read_corporation_mining.v1`
- `esi-assets.read_corporation_assets.v1`

Callback URL: `http://localhost:3000/auth/callback`

---

## Email Notifications (optional)

Configure in **Settings → Email Notifications**:
- Enter SMTP server, port, username, password
- For Gmail: use an [App Password](https://support.google.com/accounts/answer/185833), not your regular password
- Set fuel and gas alert thresholds
- Click **Send Test Email** to verify

> **Security:** Your SMTP password is encrypted at rest using Windows DPAPI (tied to your Windows user account). It is never stored in plaintext.

---

## Alt → Main Mapping

Aggregate kills, mining, and tax by main character:
- **Settings tab → Import CSV** — one `AltName,MainName` pair per line
- Or run `python scripts\import_alts.py` to import from Corp Management.xlsx

---

## Data Location

All data is stored in `%AppData%\eve-corp-manager\corp.db` (SQLite). Uninstalling the app does **not** delete this folder — your data is preserved across updates.

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
EVE_CLIENT_SECRET=your_secret
EVE_CALLBACK_URL=http://localhost:3000/auth/callback
SESSION_SECRET=any_long_random_string
```

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

> **Note:** After `npm run dist`, `better-sqlite3` is compiled for Electron's Node.js. Use `npm run electron` for dev — do not use `npm start` (system Node.js version mismatch).
