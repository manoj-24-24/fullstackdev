# Hosting FullstackDev on Render — step by step

The app deploys as **ONE Render web service**: Express serves both the built React app and the `/api` backend, so no CORS, no proxy, no second service. The only thing Render does **not** provide is MySQL — you create that at a separate provider (free option below) and paste its credentials into Render.

---

## Step 0 — Prerequisites

- A [GitHub](https://github.com) account (free) — Render deploys from Git.
- A [Render](https://render.com) account (free) — sign in with GitHub.

## Step 1 — Push the project to GitHub

This folder is not a Git repository yet, so create one and push it:

```bash
cd project
git init
git add -A
git commit -m "FullstackDev — ready for Render deploy"
```

Then create an empty repository on GitHub (e.g. `fullstackdev`), and:

```bash
git branch -M main
git remote add origin https://github.com/<your-username>/fullstackdev.git
git push -u origin main
```

> `.env`, `node_modules/`, `dist/`, and `server/uploads/` are git-ignored — your local secrets and files never leave your machine. Everything sensitive is configured on Render instead.

## Step 2 — Create a free MySQL database (Aiven)

Render has no MySQL, so use **Aiven** (free plan, no credit card):

1. Go to [aiven.io](https://aiven.io) → sign up → **Create service** → **MySQL** → pick the **Free-MySQL-1** plan and any region → **Create service**.
2. Wait ~5 minutes until the service shows **RUNNING**.
3. Open the service's **Overview** and copy these values (you'll paste them into Render in Step 3):
   - **Host** (e.g. `mysql-xxxx.aivencloud.com`)
   - **Port** (e.g. `12345`)
   - **User** (usually `avnadmin`)
   - **Password**
4. In Aiven open **Databases & Tables** (or use the web console) and create a database named `fullstackdev` — Aiven does not allow the app to create databases itself on the free plan, so this matters. (`DB_CREATE=false` below matches this.)

> Alternatives that work the same way: Railway MySQL, Clever Cloud MySQL. Any MySQL 8 host with TLS works — just set `DB_SSL=true`.

## Step 3 — Create the Render web service

1. Render dashboard → **New +** → **Web Service**.
2. **Connect** the GitHub repo you pushed in Step 1 (if you don't see it, click *Configure account* and grant access).
3. Fill the form:
   - **Name:** `fullstackdev` (this becomes `https://fullstackdev.onrender.com`)
   - **Language / Runtime:** `Node`
   - **Branch:** `main`
   - **Build Command:** `npm ci && npm run build`
   - **Start Command:** `npm start`
   - **Instance Type:** Free
4. Under **Advanced → Add Environment Variable**, add each of these:

   | Key | Value |
   |---|---|
   | `NODE_ENV` | `production` |
   | `DB_HOST` | your Aiven host, e.g. `mysql-xxxx.aivencloud.com` |
   | `DB_PORT` | your Aiven port, e.g. `12345` |
   | `DB_USER` | `avnadmin` |
   | `DB_PASSWORD` | your Aiven password |
   | `DB_NAME` | `fullstackdev` |
   | `DB_SSL` | `true` |
   | `DB_CREATE` | `false` |
   | `JWT_SECRET` | any long random string (or leave it to the blueprint) |

5. Click **Create Web Service** and watch the deploy log (~3–5 minutes).

> If you prefer click-free setup: **New + → Blueprint** renders `render.yaml` from this repo and just asks you to fill the `sync: false` values (the DB credentials).

## Step 4 — First boot & sign in

On first boot the server:

- connects to MySQL over TLS, creates any missing **tables** automatically (`schema.sql`), and seeds the admin account, the three subjects, and nothing else;
- then serves the app + API on one URL.

Open your service URL (`https://fullstackdev.onrender.com`) and sign in as the admin:

- **Email:** `moogle.2416@gmail.com`
- **Password:** `Man$vi@code*924`

> In production the server seeds the admin password **once** and never resets it on restart — change it right away via the app, and it will stay changed. (Locally in dev it still auto-resets so you can't get locked out.)

## Step 5 — (Recommended) Offload uploads to cloud storage — free, no card

Your MySQL plan has 1 GB total, and uploads stored in the database eat into it. Three options are built in — configure **one** of them; if none is set, uploads simply live in MySQL like before.

### Option A — Backblaze B2 (10 GB free, no card) ← recommended

10 GB of true storage (no monthly credit juggling) plus 1 GB/day of free downloads.

1. Go to [backblaze.com](https://www.backblaze.com/cloud-storage) → **Sign up** (email only, no credit card)
2. Console → **B2 Cloud Storage** → **Create a Bucket** → name it e.g. `fullstackdev-files` → keep it **Private** → create
3. On the bucket's page → **Upload/Download** is where files will appear later. Now create the key: left sidebar **Application Keys** → **Add a New Application Key**:
   - Name: `fullstackdev` · Type: **Read and Write** · File name prefix: *(leave blank)*
4. Copy the values it shows (the **applicationKey secret is displayed only once!**):
   - **keyID** → `B2_ACCESS_KEY_ID`
   - **applicationKey** → `B2_SECRET_ACCESS_KEY`
   - **Endpoint** (shown with the key and in bucket details, e.g. `https://s3.us-east-005.backblazeb2.com`) → `B2_ENDPOINT`
   - **Region** (the `us-east-005` part of that endpoint) → `B2_REGION`
   - Bucket name → `B2_BUCKET`
5. In Render: your service → **Environment** → add those five variables → **Save** (this triggers a redeploy)
6. Done — uploads go to B2 as private objects served through short-lived presigned URLs; MySQL keeps only text data + tiny metadata rows.

### Option B — Cloudinary (~25 GB-months free, no card) ← easiest

Note: Cloudinary's free plan is **25 credits/month**, where 1 credit ≈ 1 GB stored per month OR 1 GB delivered. For a small class platform this is comfortable (typically 3–6 credits used), but B2's flat 10 GB is simpler to reason about.

1. Go to [cloudinary.com](https://cloudinary.com) → **Sign up for free** (email + password only, no credit card)
2. After signup, the **Dashboard → Getting started** page (or **Settings → API Keys**) shows three values:
   - **Cloud name** → `CLOUDINARY_CLOUD_NAME`
   - **API Key** → `CLOUDINARY_API_KEY`
   - **API Secret** → `CLOUDINARY_API_SECRET`
3. In Render: your service → **Environment** → add those three variables → **Save** (this triggers a redeploy)

### Option C — Cloudflare R2 (10 GB free, requires a card on file but charges $0)

1. Go to [dash.cloudflare.com](https://dash.cloudflare.com) → sign up / sign in (free)
2. Left sidebar → **R2 Object Storage** → **Create bucket** → name it e.g. `fullstackdev-files` → create (defaults are fine)
3. On the R2 page: **Manage R2 API Tokens** → **Create API Token** → permissions **Object Read & Write** → scope to your bucket → create
4. Copy the four values shown:
   - **Access Key ID** → `R2_ACCESS_KEY_ID`
   - **Secret Access Key** → `R2_SECRET_ACCESS_KEY`
   - **Account ID** (shown on the R2 overview page, right side) → `R2_ACCOUNT_ID`
   - Bucket name → `R2_BUCKET`
5. In Render: your service → **Environment** → add those four variables → **Save** (this triggers a redeploy)

### Either way: move the files already sitting in MySQL (one command)

Files uploaded *before* the env vars were set still live in the database. After the env vars exist locally or on Render, run once:

```bash
node server/migrate-to-cloud.js
```

It copies each file's bytes to the cloud (B2/R2/Cloudinary, whichever is configured) and shrinks the database row to a tiny pointer — the DB drops back to near-zero storage. Safe to re-run; any file that fails stays safely in MySQL.

If cloud storage is ever misconfigured, the app automatically falls back to storing files in MySQL, so nothing breaks.

## Step 6 — Things to know about the free tier

- **Spin-down:** after ~15 minutes without traffic the service sleeps; the next visit takes ~30–50 s to wake. Keep the tab open or ping `/api/health` periodically if that bothers you.
- **Uploads are durable** when stored in MySQL or cloud storage (Cloudinary/R2). Files uploaded before cloud storage was configured lived on the service's local disk, which Render clears on every redeploy — those were migrated into the database. New uploads never touch the disk only.
- **Every `git push` auto-deploys.** To update the live site, just push to `main`.

## Local development (unchanged)

```bash
npm run dev:all   # API on :3001 + Vite on :5173, local MySQL via project/.env
```

The production shape (`npm ci && npm run build && npm start` with `NODE_ENV=production`) also works locally — the Express server then serves the built app on one port, exactly like Render does.
