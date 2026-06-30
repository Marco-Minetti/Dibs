# dibs ✶ — the dorm-to-dorm campus marketplace

Buy and sell with verified students on your own campus — everything within a
10-minute walk. This is the complete project: the phone app, the backend API,
the database, and the mobile-store wrapper.

```
dibs/
├── README.md                     ← you are here
├── DEPLOY.md                     ← put the backend online (HTTPS)
├── BUILD_ANDROID.md              ← build the .aab + ship to Google Play
├── render.yaml                   ← one-click backend + Postgres deploy
├── frontend/
│   ├── index.html                ← the phone app (wired to the backend; demo fallback)
│   └── dibs-api.js               ← client that talks to the backend
├── backend/                      ← Node + Express + PostgreSQL API
│   ├── migrations/               ← 001 schema · 002 payments
│   ├── scripts/                  ← migrate + seed
│   ├── src/                      ← routes · middleware · services (auth, listings,
│   │                                favorites, chats+WebSocket, uploads, payments)
│   ├── .env.example              ← copy to .env and fill in
│   └── Dockerfile
└── mobile/                       ← Capacitor wrapper → native Android (+ iOS)
    ├── capacitor.config.ts
    ├── scripts/build-web.mjs     ← bundles the frontend + bakes in the API url
    └── android/                  ← generated native project (run `npm run android:add`)
```

There are two ways to run this. **Option A** shows the app in 30 seconds with no
setup. **Option B** runs the real backend + database underneath it.

---

## Option A — demo mode (no backend)
Open `frontend/index.html` in a browser. It runs on sample data; the login code
is `1234`. (To force this even with a backend present, set `window.DIBS_API_BASE = ''`
near the top of `index.html`.)

## Option B — run the real stack locally
```bash
# 1) database
createdb dibs

# 2) backend
cd backend
cp .env.example .env          # set DATABASE_URL, JWT_SECRET, CODE_PEPPER
npm install
npm run migrate
npm run seed                  # demo schools + listings; logs a test login email
npm start                     # http://localhost:4000  (login codes print to this log in dev)

# 3) frontend  (DIBS_API_BASE already defaults to http://localhost:4000)
cd ../frontend && python3 -m http.server 5173   # open http://localhost:5173
```
Log in with a seeded `.edu` email (e.g. `alex@nyu.edu`); the 6-digit code appears
in the backend log. Now login, the board, favorites, posting (needs S3 — see
DEPLOY.md), chat (live WebSocket), call-dibs, and payments (needs Stripe keys)
all run against the real API.

## Ship it
1. **Backend online with HTTPS** → `DEPLOY.md` (Render blueprint + R2 + Resend + Stripe).
2. **Android app** → `BUILD_ANDROID.md` (`mobile/` → signed `.aab` → Play Console
   internal → closed → production).

## Payments
Stripe powers in-app payment. A buyer who has called dibs sees **pay securely 🔒**
in the chat; on success the listing is marked sold via a Stripe webhook. Physical
peer-to-peer goods may use Stripe on Google Play (no Play Billing required). Seller
payouts use Stripe Connect (`POST /api/payments/connect`).


