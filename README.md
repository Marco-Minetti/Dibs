# dibs ✶ — the dorm-to-dorm campus marketplace

Buy and sell with verified students on your own campus — everything within a
10-minute walk. This is the complete project: the phone app, the backend API,
the database, and the mobile-store wrapper.

```
dibs/
├── README.md                     ← you are here (how to run)
├── frontend/
│   ├── index.html                ← the phone app (open this to see it)
│   └── dibs-api.js               ← client that talks to the backend
├── backend/                      ← Node + Express + PostgreSQL API
│   ├── migrations/001_init.sql   ← the database schema
│   ├── scripts/                  ← migrate + seed
│   ├── src/                      ← routes · middleware · services
│   ├── .env.example              ← copy to .env and fill in
│   └── Dockerfile
└── mobile/
    └── capacitor.config.ts       ← wraps the web app into iOS / Android
```

There are two ways to run this. **Option A** shows you the app in 30 seconds with
no setup. **Option B** runs the real backend + database underneath it.

---

## Option A — just see the app (no setup, 30 seconds)

The phone app is fully self-contained and runs in **demo mode** with sample
listings and chats.

- **Easiest:** double-click `frontend/index.html` to open it in your browser.
- Or serve it (nicer on mobile, and the approach you'll want for the backend):

  ```bash
  cd frontend
  npx serve            # → http://localhost:3000  (needs Node)
  # or:  python3 -m http.server 3000
  ```

Then use it: tap **get started**, pick any school, type any `.edu` email (e.g.
`you@nyu.edu`), and when it asks for the verification code, enter **1234**. Post
a listing, call dibs on something, send a chat — it all works locally.

> Demo mode keeps data in the browser only and resets on refresh. For real,
> persistent, multi-user data you need the backend → Option B.

---

## Option B — run the full stack (real backend + database)

### Prerequisites

1. **Node.js 18+** — check with `node -v`. Install from https://nodejs.org or via `nvm`.
2. **PostgreSQL 14+** — the database. The easiest cross-platform way is Docker:

   ```bash
   docker run --name dibs-pg -e POSTGRES_PASSWORD=dibs -e POSTGRES_DB=dibs \
     -p 5432:5432 -d postgres:16
   ```

   No Docker? Install Postgres natively (`brew install postgresql@16` on macOS,
   `sudo apt install postgresql` on Ubuntu) and then run `createdb dibs`.

### Steps

```bash
cd backend                 # 1. go into the backend
cp .env.example .env       # 2. create your .env from the template
```

Open `.env` and set three things:

- `DATABASE_URL` — if you used the Docker command above, use
  `postgres://postgres:dibs@localhost:5432/dibs`
- `JWT_SECRET` and `CODE_PEPPER` — two *different* random strings. Generate each:

  ```bash
  node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"
  ```

  Run it twice and paste one value into each.

```bash
npm install                # 3. install dependencies
npm run migrate            # 4. create all the database tables
npm run seed               # 5. load ~60 schools + demo listings (recommended)
npm run dev                # 6. start the API → http://localhost:4000
```

You should see `dibs api ✶ listening on :4000`. Confirm it:
`curl http://localhost:4000/health` → `{"ok":true,...}`.

### Logging in against the real backend

In development there's no email provider configured, so the verification code is
**printed to the backend terminal**. Trigger a login and copy the 6-digit code
from the server logs:

```bash
curl -X POST http://localhost:4000/api/auth/request-code \
  -H 'Content-Type: application/json' \
  -d '{"email":"alex@nyu.edu"}'
# → look at the backend terminal:  ✶ [dibs] login code for alex@nyu.edu: 482913
```

---

## Connecting the app to the backend (integration status)

Right now the two halves run independently: `index.html` works in demo mode, and
the backend + `dibs-api.js` are the real data layer. **The remaining step is
pointing the app at the API** — uncomment these two lines near the top of
`index.html`:

```html
<script>window.DIBS_API_BASE = 'http://localhost:4000';</script>
<script src="dibs-api.js"></script>
```

…then replace the app's in-memory `listings` / `chats` arrays with `window.dibs`
calls. The data shapes line up closely:

| In the app…              | Replace with                                    |
|--------------------------|-------------------------------------------------|
| school picker list       | `await dibs.schools(query)`                     |
| "send my code"           | `await dibs.requestCode(email, schoolId, name)` |
| enter the code           | `await dibs.verifyCode(email, code)`            |
| render the board         | `await dibs.feed({ category, q })`              |
| open a listing           | `await dibs.listing(id)`                        |
| heart / unheart          | `dibs.favorite(id)` / `dibs.unfavorite(id)`     |
| pick photos              | `await dibs.uploadPhoto(file)` → photoId        |
| post it                  | `await dibs.createListing({ …, photoIds })`     |
| call dibs                | `await dibs.callDibs(id)`                        |
| chat list / thread       | `dibs.conversations()` / `dibs.messages(id)`    |
| send a message           | `dibs.sendMessage(convId, text)`                |
| live incoming messages   | `dibs.connectRealtime(msg => …)`                |

This rewire is mechanical but touches a lot of the app's render code. If you'd
like, I can hand back a single `index.html` already fully wired to the backend.

---

## Security model (already built in)

- **Passwordless `.edu` auth.** A 6-digit code is emailed, stored only as a
  peppered HMAC (never the code itself), expires in 10 minutes, locks after 5
  wrong attempts, and is rate-limited per IP *and* per email.
- **Sessions.** Short-lived JWT access tokens + opaque refresh tokens hashed in
  the DB and rotated on every use.
- **School matching.** Email must be `.edu` and match the chosen school's
  domains, so students can't register on the wrong campus.
- **Campus isolation.** Every feed, listing, and dibs is scoped to your school.
- **Validation + safety.** zod on every request, parameterized SQL (no
  injection), Helmet headers, CORS allowlist, reporting, blocking, and a
  `banned_at` kill-switch. Photos upload straight to S3 via presigned URLs.
- **Concurrency-safe dibs.** Claiming an item locks its row in a transaction so
  two people can't grab the same thing.

---

## Deploying to production

- **Database:** Neon or Supabase (managed Postgres). Set `PG_SSL=true`.
- **API:** Render, Railway, or Fly.io (a `Dockerfile` is included). Run
  `npm run migrate` once on deploy.
- **Email:** Resend — set `RESEND_API_KEY` + a verified sending domain.
- **Images:** Cloudflare R2 or AWS S3 — set the `S3_*` vars and a `CDN_BASE_URL`.
- Add error tracking (Sentry), uptime monitoring, and daily DB backups.

---

## Shipping to the App Store / Google Play

Wrap the web app with **Capacitor** (keeps this UI, produces real native apps):

```bash
npm install @capacitor/core @capacitor/cli @capacitor/ios @capacitor/android \
            @capacitor/camera @capacitor/preferences
# put the built web app in mobile/www, then:
npx cap add ios
npx cap add android
npx cap sync
npx cap open ios        # build & submit in Xcode
npx cap open android    # build & submit in Android Studio
```

On device, switch `dibs-api.js`'s token storage from `localStorage` to
`@capacitor/preferences` (Keychain/Keystore) and use `@capacitor/camera` for the
photo picker.

**The non-code gates** (plan early, none are blockers): Apple ($99/yr) + Google
($25) developer accounts; a privacy policy URL + data-collection disclosure;
content moderation for user photos/messages (Apple requires report + block —
both built — plus acting on reports within 24h, so add image scanning and a
small admin review queue over the `reports` table); published prohibited-items
rules; an 18+ terms restriction; and keep payments cash/in-person at pickup for
launch to avoid money-transmitter regulation.

---

## Troubleshooting

- **`ECONNREFUSED ...:5432`** — Postgres isn't running. Start the Docker
  container or your local Postgres service.
- **`Missing required env var`** — you skipped `JWT_SECRET` or `CODE_PEPPER` in `.env`.
- **Port 4000 already in use** — set `PORT=4001` in `.env`.
- **Can't find the login code** — in dev it's in the *backend* terminal, not the
  browser. Configure `RESEND_API_KEY` to send real emails instead.
- **CORS error in the browser** — add your frontend's origin to `CORS_ORIGINS`
  in `.env` (e.g. `http://localhost:3000`).
