# Deployment Guide — PEPE/XNT Pool Analytics (X1) 🐸

This project is **full-stack**:
- **Backend (Node/Express)**: serves `/api/pool` + `/api/trades-stream` (SSE)
- **Frontend (lp-dashboard.html)**: served by the backend at `/`

Because you use **SSE + Node**, **GitHub Pages alone will NOT work** (static hosting can’t run `server.js`).

This guide covers:
1) Local run (sanity check)
2) Push to GitHub
3) Deploy full-stack on **Render** (recommended)
4) Deploy full-stack on **Railway**
5) Deploy full-stack on **Fly.io**
6) Optional: Split deploy (frontend static + backend hosted)

---

## 0) Prereqs

- Node.js 18+ recommended
- A GitHub repo with your code
- Project files:
  - `server.js`
  - `lp-dashboard.html`
  - `package.json` (recommended)

If you don’t have `package.json`, create one (example near the bottom).

---

## 1) Local run (confirm everything works before deploying)

From your project folder:

```bash
npm install
node server.js


Open:

Dashboard: http://localhost:3000

Health: http://localhost:3000/api

Pool: http://localhost:3000/api/pool

Stream: http://localhost:3000/api/trades-stream

✅ Confirm:

Trades populate live

Candles build from trades

Refresh loads history

3) Deploy on Render (Recommended ✅)

Render is great for “always-on” Node services and works well with SSE.

A) Create the Web Service

Go to Render → New → Web Service

Connect your GitHub repo

Choose the correct branch (usually main)

B) Service settings

Runtime: Node

Build Command:

npm install


Start Command:

node server.js


Instance Type: Starter is fine to begin

C) Environment variables (optional)

In Render → Environment:

PORT → leave blank (Render sets it automatically) OR set 3000

HISTORY_LIMIT → 1000 (or smaller if RPC rate-limits)

D) Deploy

Click Create Web Service.

E) Verify the deployment

Once deployed, open:

https://YOUR-RENDER-URL.onrender.com/

https://YOUR-RENDER-URL.onrender.com/api

https://YOUR-RENDER-URL.onrender.com/api/pool

https://YOUR-RENDER-URL.onrender.com/api/trades-stream

✅ If the dashboard loads but trades don’t:

Make sure the backend endpoint /api/trades-stream is reachable in the browser.

Check Render logs for RPC errors or crashes.

Render notes (SSE)

SSE needs the connection kept open. Your server should be sending periodic keepalives (you already do).

If Render suspends on free tier, you may see delays after inactivity.

4) Deploy on Railway (Alternative ✅)
A) Create project

Railway → New Project → Deploy from GitHub Repo

Pick your repo

B) Set start command

Railway usually detects Node automatically.
If you need to set it manually:

Start Command:

node server.js

C) Environment variables

Railway → Variables:

HISTORY_LIMIT=1000

Railway sets PORT automatically.

D) Verify

Open your Railway domain:

/ dashboard

/api health

/api/trades-stream stream

5) Deploy on Fly.io (Alternative ✅)

Fly is solid for long-lived connections like SSE.

A) Install Fly CLI

Follow Fly instructions to install flyctl.

B) Login
fly auth login

C) Initialize app

From your project folder:

fly launch


Choose:

App name

Region

Don’t add Postgres

D) Configure start command

Fly uses fly.toml. Ensure it runs:

[processes]
app = "node server.js"

E) Deploy
fly deploy

F) Verify

https://YOURAPP.fly.dev/

https://YOURAPP.fly.dev/api

https://YOURAPP.fly.dev/api/trades-stream

6) Optional: Split Deployment (Frontend static + backend hosted)

This is useful if you want the frontend on GitHub Pages/Vercel and backend on Render.

A) Deploy backend on Render (Section 3)

You’ll get a backend URL like:
https://pepe-xnt.onrender.com

B) Update frontend to use hosted backend

In lp-dashboard.html, update your API base logic:

const BACKEND_URL = "https://pepe-xnt.onrender.com";

const POOL_API_URL = `${BACKEND_URL}/api/pool`;
const streamUrl = `${BACKEND_URL}/api/trades-stream`;


Then deploy your static frontend (GitHub Pages / Vercel / Netlify).

C) CORS

If you split domains, ensure your backend enables CORS for your frontend domain.
(Your server.js already uses CORS; if needed, restrict it to your domain.)

7) Common Deployment Issues (and fixes)
Issue: Dashboard loads, but stream doesn’t connect

Check:

/api/trades-stream reachable from browser

Logs for RPC failures or server crashes

Issue: 429 Too Many Requests from RPC

Fix:

Lower HISTORY_LIMIT (example 300–600)

Add backoff/retry (you already have)

Consider a paid RPC or rotating endpoints

Issue: Time / X-axis looks “off”

Fix:

Ensure trade timestamps are epoch milliseconds

Frontend must do Math.floor(ms / 1000) only for chart time

Issue: GitHub Pages shows no live data

Expected. GitHub Pages can’t run Node/SSE.
Use full-stack deployment (Render/Railway/Fly) or split deployment.

8) Recommended package.json (if you need one)

Create package.json in your project root:

{
  "name": "pepe-xnt-dashboard",
  "version": "1.0.0",
  "main": "server.js",
  "type": "commonjs",
  "scripts": {
    "start": "node server.js"
  },
  "dependencies": {
    "@solana/web3.js": "^1.98.0",
    "cors": "^2.8.5",
    "express": "^4.19.2",
    "node-fetch": "^3.3.2"
  }
}


Then:

npm install
npm start

9) Deployment Checklist ✅

Before deploying:

 node server.js works locally

 Dashboard loads at /

 /api/pool returns JSON

 /api/trades-stream sends history and trade events

 git push latest changes

After deploying:

 Open deployed / and confirm UI loads

 Confirm live trades appear within 30–60 seconds

 Refresh page → history loads + “Last Trade” is newest

 Confirm chart candles update with new trades
