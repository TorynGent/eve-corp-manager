# IT Security & Data Protection Audit — EVE Corp Manager

**Date:** March 2026  
**Scope:** Backend (Node/Express), frontend (public JS), Electron main process, database, auth, and secrets handling.

---

## Executive summary

The app uses **EVE SSO with PKCE** (no client secret), **session-based auth**, and **SQLite** with **better-sqlite3** (parameterized queries throughout). **SMTP password** is optionally encrypted at rest via Electron `safeStorage` when available. **OAuth state + PKCE** protect the login flow; **requireAuth** guards all API routes. Main gaps: **session cookie** not hardened for production, **backup** contains **plaintext OAuth tokens**, **auth error message** can leak into URL, **XSS** in login error display, **no rate limiting** or security headers, and **two high-severity npm** advisories (nodemailer, tar). Below: findings by category and recommended actions.

---

## 1. Authentication & session

| Finding | Severity | Details |
|--------|----------|---------|
| **Session secret fallback** | Medium | `server/index.js`: `process.env.SESSION_SECRET \|\| 'change-me-in-production'`. If `.env` is missing (e.g. standalone `node server`), a default secret is used and is weak/predictable. |
| **Session cookie not hardened** | Medium | No explicit `cookie: { httpOnly, secure, sameSite }`. express-session defaults to `httpOnly: true` in recent versions, but `secure` and `sameSite` are not set. For localhost this is often acceptable; for any HTTPS deployment they should be set (`secure: true`, `sameSite: 'lax'`). |
| **OAuth state + PKCE** | Good | Auth uses cryptographically random state and PKCE code_verifier/code_challenge; state checked on callback. |
| **Auth error in URL** | Medium | `server/routes/auth.js`: on failure, redirect includes `message=${encodeURIComponent(err.message)}`. Server/ESI error text can appear in the URL and in browser history; could leak hints (e.g. "invalid_grant"). Prefer generic "Authentication failed" in URL and log details server-side only. |

**Recommendations:**  
- Require `SESSION_SECRET` when not in Electron (or refuse to start with default).  
- Set session cookie options: `httpOnly: true`, `secure: process.env.NODE_ENV === 'production'`, `sameSite: 'lax'`.  
- Redirect to `/?auth_error=failed` only; log `err.message` (and `err.response?.data`) server-side; optionally show a generic message on the login page.

---

## 2. Data protection & secrets

| Finding | Severity | Details |
|--------|----------|---------|
| **OAuth tokens in DB plaintext** | High | `tokens` table stores `access_token` and `refresh_token` in **plaintext**. Anyone with DB file access (backup, disk access, restore) can steal tokens and act as the character. |
| **Backup contains full DB** | High | `GET /api/settings/backup` streams the **entire SQLite file**, including plaintext tokens and (when not using Electron) possibly plaintext `smtp_pass`. Backup should be treated as highly sensitive; consider redacting tokens or offering an “export without secrets” option and documenting risk. |
| **SMTP password** | Good | Stored via `secure-storage` (Electron safeStorage) when available; never sent to the client; only `smtpPassSet` boolean exposed. |
| **Discord webhook URL** | Medium | Stored in `notification_settings` in **plaintext**. Anyone with the URL can post to the channel. Consider encrypting with the same mechanism as SMTP password if desired. |
| **.env in Electron build** | Low | `package.json` → `extraResources`: `.env` is copied into the app bundle. It typically holds only `EVE_CLIENT_ID` and `EVE_CALLBACK_URL` (no secret for native app). First-run copies to userData and adds a generated `SESSION_SECRET`. Risk: if users put secrets in `.env`, they end up in the bundle. Document that only non-secret config should be in the bundled `.env`. |
| **Secrets in logs** | Good | No logging of tokens or SMTP password. `err.message` in sync/API errors is generic enough; auth callback logs only `err.message` (could still leak in redirect — see above). |

**Recommendations:**  
- Consider encrypting `access_token`/`refresh_token` at rest (e.g. using the same safeStorage approach as SMTP, or a key derived from SESSION_SECRET) and document key management.  
- Add an in-UI warning when downloading backup: “This file contains sensitive data (login tokens, settings). Store securely and restrict access.”  
- Optionally encrypt Discord webhook URL at rest.  
- Keep `.env` out of version control (already in `.gitignore`); document that the bundled `.env` should not contain secrets.

---

## 3. API & input security

| Finding | Severity | Details |
|--------|----------|---------|
| **SQL injection** | Good | All DB access uses parameterized queries (`?` placeholders or `@foo` with `.run(data)`). No string-concatenated SQL. |
| **Structure/ID validation** | Low | Routes like `PUT /api/structures/:id/fuel-override`, `PUT /api/structures/:id/gas`, and Metenox manual endpoints take `structureId` from the URL. They do not verify that the structure belongs to the corp; in this single-tenant app the impact is limited to creating settings/rows for arbitrary IDs. For tighter consistency, validate that `structureId` exists in `structures` (or that the ID was previously returned by the sync). |
| **Restore upload** | Medium | `POST /api/settings/restore` accepts a file and overwrites `DB_PATH.restore`; on next start the app replaces the DB. There is **no check** that the file is a valid SQLite DB (e.g. magic bytes). A malicious file could crash the app or cause unexpected behavior on next startup. Recommend validating file header (e.g. `SQLite format 3`) before accepting. |
| **Request body validation** | Low | Most endpoints validate required fields and types (e.g. fuel hangar allowlist, gas consumption positive number). Some optional fields (e.g. scratchpad text, location name) are stored as-is; consider length limits to avoid DoS or bloat. |
| **CORS** | Low | No explicit CORS middleware. When run as a web server (not Electron), any origin can call the API; credentials (session cookie) are only sent same-origin by default. If the app is ever served from a different origin or with credentials from another domain, CORS should be explicitly restricted. |

**Recommendations:**  
- Validate restore file: read first 16 bytes and check for `SQLite format 3\0`.  
- Optionally validate structure IDs against `structures` for override/gas/manual endpoints.  
- Add explicit CORS policy if the app is exposed beyond localhost.

---

## 4. Frontend & XSS

| Finding | Severity | Details |
|--------|----------|---------|
| **XSS in login error** | Medium | `public/js/app.js`: when `auth_error=missing_scopes`, `missing` (from query string) is split and inserted into `innerHTML` with `<code>` tags. A crafted URL (e.g. `?auth_error=missing_scopes&missing=</code><script>...`) could execute script. `message` is correctly set with `textContent`. |
| **API error messages** | Good | `api.js` uses `handleResponse` and throws `Error(msg)`; toasts use `el.textContent = message`, so API error text is not interpreted as HTML. |
| **esc() helper** | Good | `api.js` defines `esc()` for safe HTML; it should be used wherever user/URL data is inserted into `innerHTML`. |

**Recommendations:**  
- For the missing-scopes display, either: (a) use `textContent` and build the list in the DOM (e.g. create `<code>` nodes and append), or (b) use `esc(missing.join(', '))` and avoid building HTML from query params. Prefer (a) or a dedicated escaped template.

---

## 5. Headers, HTTPS, and rate limiting

| Finding | Severity | Details |
|--------|----------|---------|
| **Security headers** | Low | No `X-Content-Type-Options`, `X-Frame-Options`, or `Content-Security-Policy`. For a localhost/Electron app risk is lower; for any public or HTTPS deployment they are recommended. |
| **Rate limiting** | Low | No rate limiting on login or API. Brute-force is mitigated by EVE SSO (no local passwords); abuse could still stress the server or ESI. Optional: add rate limiting for `/auth/login` and/or global API. |
| **HTTPS** | N/A | App is designed for localhost (and Electron). If ever deployed over the network, TLS should be used and session cookie `secure: true`. |

**Recommendations:**  
- For production web deployment: add Helmet (or equivalent) and set `sameSite`/`secure` on the session cookie.  
- Optional: add `express-rate-limit` for `/auth/*` and/or API routes.

---

## 6. Dependency vulnerabilities

| Package | Severity | Advisory |
|---------|----------|----------|
| **nodemailer** ≤7.0.10 | High | GHSA-mm7p-fcc7-pg87 (email to unintended domain); GHSA-rcmh-qjqh-p98v (DoS via addressparser). Fix: upgrade to 8.x (may have breaking changes — test). |
| **tar** ≤7.5.9 | High | GHSA-qffp-2rhf-9h96 (path traversal via drive-relative linkpath). Fix: `npm audit fix` (likely transitive from electron-builder). |

**Recommendations:**  
- Run `npm audit` and `npm audit fix`; for nodemailer, run tests after `npm audit fix --force` (or upgrade to 8.x and adapt API if needed).  
- Re-run audit after dependency updates and before releases.

---

## 7. Operational & deployment

| Finding | Severity | Details |
|--------|----------|---------|
| **Tray “Sync Now”** | Low | In Electron, tray menu triggers `POST /api/settings/sync-now` via raw `http.request` from the main process **without** sending the browser session cookie. The request will typically get **401 Unauthorized**. Functional bug; from a security perspective the API correctly requires auth. |
| **Single tenant** | Good | One DB per instance; no multi-corp data mixing. Session identifies a single character/corp. |
| **Data retention** | Low | No automatic purge of old wallet_journal, kills, or logs. Consider retention policy and documented backup/restore procedure. |

**Recommendations:**  
- Fix tray sync by having the renderer (or a preload) call the API with credentials, and have the tray trigger that via IPC, or use a separate “tray auth” token stored in a safe place.  
- Document backup sensitivity and retention expectations.

---

## 8. Checklist summary

| Priority | Action |
|----------|--------|
| High | Treat backup as sensitive; add warning when downloading; consider token encryption at rest. |
| High | Fix auth redirect: do not put `err.message` in URL; log server-side only. |
| High | Fix XSS in login page (missing_scopes innerHTML). |
| High | Run `npm audit fix`; plan nodemailer upgrade and test. |
| Medium | Harden session cookie: `secure`, `sameSite: 'lax'` (when applicable). |
| Medium | Validate restore file (SQLite magic bytes) before accepting. |
| Medium | Consider encrypting Discord webhook URL. |
| Low | Optional: security headers, rate limiting, structure ID validation. |
| Low | Fix tray “Sync Now” so it sends session (or equivalent). |

---

## 9. Regular security checks (recommended cadence)

Yes — running security checks on a regular basis is the right approach. Dependencies get new advisories, and code changes can introduce new risks. Suggested routine:

| When | What to do |
|------|------------|
| **Every few weeks / before releases** | Run `npm audit`. Fix any high/critical with `npm audit fix` (or `npm audit fix --force` after checking breaking changes). Re-run tests. |
| **Quarterly or after major features** | Skim this audit doc and the checklist. Re-run `npm audit`. Consider a quick pass over new routes and any new secrets or PII handling. |
| **After adding or upgrading a dependency** | Run `npm audit` and tests. If the package handles auth, crypto, or user input, skim its changelog and security notes. |

**Commands to run regularly:**

```bash
npm audit
npm audit fix          # non-breaking fixes only
npm audit fix --force  # only if you're ready to handle breaking changes (e.g. major version bumps)
```

**Optional:** Add a `"security-check"` script in `package.json` (e.g. `"security-check": "npm audit"`) and run it in CI or before release. For a small app, running `npm audit` manually before each release is usually enough.

---

*Audit performed by static review of server, public, and electron code paths. No dynamic testing or penetration testing was performed.*

---

## Implemented after audit (same session)

- **Session cookie:** `httpOnly: true`, `secure` when `NODE_ENV === 'production'`, `sameSite: 'lax'` (`server/index.js`).
- **Auth error redirect:** Redirect to `/?auth_error=failed` only; log `err.message` and `err.response?.data` server-side (`server/routes/auth.js`).
- **XSS (missing_scopes):** Scope list from query string is escaped with an inline `esc()` before insertion into `innerHTML` (`public/js/app.js`).
- **Backup warning:** Feedback text and optional toast after download: "Backup contains sensitive data (tokens, settings). Store securely." (`public/js/settings.js`).
- **Restore validation:** Uploaded file is checked for SQLite magic bytes (`SQLite format 3\0`) before accepting (`server/routes/settings.js`).

**Dependency fixes (follow-up):**
- **npm audit:** Ran `npm audit fix` (fixed `tar`); upgraded **nodemailer** to 8.x — `npm audit` now reports 0 vulnerabilities.
- **Token encryption at rest:**  
  - **secure-storage.js:** Fallback when not in Electron: if `SESSION_SECRET` is set and not the default, values are encrypted with AES-256-GCM (key derived via scrypt from `SESSION_SECRET`), stored with prefix `enc2:`. Electron continues to use safeStorage (`enc:`).  
  - **db.js:** `saveToken` and `updateAccessToken` encrypt `access_token` and `refresh_token` before writing; `getToken` decrypts on read. Existing plaintext tokens in the DB remain readable until the next write (e.g. refresh or re-login), then they are stored encrypted.
- **One-time token migration:** On startup, `db.js` runs `runTokenEncryptionMigration()`: if any token row has plaintext `access_token`, it re-encrypts and updates that row, then sets `migration_tokens_encrypted_v1` in settings so it never runs again. Backups taken after this will not contain plaintext tokens once the migration has run.
