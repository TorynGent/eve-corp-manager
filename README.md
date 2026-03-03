# EVE Corp Dashboard — Setup Guide

## Step 1: Install Node.js

Download and install from https://nodejs.org (choose the **LTS** version).

After installing, open a new Command Prompt and verify:
```
node --version    # should print v20.x or similar
npm --version     # should print 10.x or similar
```

---

## Step 2: Register your EVE SSO Application

1. Go to https://developers.eveonline.com/applications
2. Click **Create New Application**
3. Fill in:
   - **Name**: EVE Corp Dashboard (or anything you like)
   - **Description**: Personal corp management dashboard
   - **Connection Type**: Authentication & API Access
   - **Callback URL**: `http://localhost:3000/auth/callback`
   - **Scopes**: Add all of these:
     - `esi-wallet.read_corporation_wallets.v1`
     - `esi-corporations.read_structures.v1`
     - `esi-corporations.read_members.v1`
     - `esi-corporations.read_membertracking.v1`
     - `esi-corporations.read_mining.v1`
     - `esi-assets.read_corporation_assets.v1`
     - `esi-universe.read_structures.v1`
4. Click **Create Application**
5. Copy the **Client ID** and **Secret Key**

---

## Step 3: Configure the app

Copy `.env.example` to `.env`:
```
copy .env.example .env
```

Open `.env` in Notepad and fill in:
```
EVE_CLIENT_ID=your_client_id_from_step_2
EVE_CLIENT_SECRET=your_secret_from_step_2
EVE_CALLBACK_URL=http://localhost:3000/auth/callback
SESSION_SECRET=pick_any_long_random_string_here
PORT=3000
```

---

## Step 4: Install dependencies & start

Open Command Prompt, navigate to this folder, then run:
```
cd G:\Thumbnails\EVE\eve-app
npm install
npm start
```

Open your browser and go to: **http://localhost:3000**

Click **Login with EVE Online**, log in with your Director/CEO character — the app will start pulling data immediately.

---

## Running in the future

Every time you want to use the dashboard:
```
cd G:\Thumbnails\EVE\eve-app
npm start
```
Then open http://localhost:3000. The app remembers your login and syncs automatically.

For development with auto-restart on file changes:
```
npm run dev
```

---

## What gets synced automatically

| Data | Frequency |
|------|-----------|
| Structure fuel | Every hour |
| Corp wallet | Every hour |
| Market prices (Jita) | Every 5 minutes |
| Corp assets | Every hour |
| Email alert check | Daily 08:00 UTC |
| Monthly snapshot | 1st of each month |

You can also trigger **Sync Now** from the header button or the Settings tab.

---

## Email Notifications (optional)

Configure in the **Settings** tab under "Email Notifications":
- Enter your SMTP server details (Gmail, Outlook, etc.)
- For Gmail: use an **App Password** (not your regular password) — see https://support.google.com/accounts/answer/185833
- Set your alert thresholds for fuel and magmatic gas
- Click **Send Test Email** to verify it works

---

## Magmatic Gas Tracking

ESI does not expose magmatic gas levels. In the **Structures** tab, click **💨 Gas** next to any Metenox to enter:
- **Last refill date** — when you last added gas
- **Quantity added** — how many units you put in
- **Daily consumption** — defaults to 4,800/day (standard Metenox rate)

The app calculates estimated days remaining and will alert you when it drops below your threshold.

---

## Data Location

All data is stored locally in `data/corp.db` (SQLite). No data is sent anywhere except to ESI (esi.evetech.net) and your SMTP server (if configured).
