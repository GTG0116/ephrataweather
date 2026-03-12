# ephrata-push — Cloudflare Worker

Polls the NWS alerts API every 15 minutes and sends web-push notifications to subscribed devices.

Uses **only the Web Crypto API** built into Cloudflare Workers — no npm dependencies required.

## Setup (one time)

### 1. Install Wrangler
```
npm install -g wrangler
wrangler login
```

### 2. Generate VAPID keys
Run this once and save the output — you need both keys.
```
npx web-push generate-vapid-keys
```

### 3. Create the KV namespace
```
wrangler kv namespace create SUBS
```
Copy the `id` value from the output and paste it into `wrangler.toml`.

### 4. Fill in wrangler.toml
Open `wrangler.toml` and replace every `PASTE_YOUR_*` placeholder:
- `PASTE_YOUR_KV_NAMESPACE_ID_HERE` → the id from step 3
- `PASTE_YOUR_EMAIL_ADDRESS_HERE` → your email address
- `PASTE_YOUR_VAPID_PUBLIC_KEY_HERE` → your public VAPID key

### 5. Store the private key as a secret (never put it in wrangler.toml)
```
wrangler secret put VAPID_PRIVATE_KEY
```
Paste your **private** VAPID key when prompted.

### 6. Deploy
```
cd push-server
wrangler deploy
```
The Worker URL is printed after deploy (e.g. `https://ephrata-push.yourname.workers.dev`).

### 7. Update the web app
In `js/current.js` at the top of the file, fill in:
- `PASTE_YOUR_CLOUDFLARE_WORKER_URL_HERE` → your Worker URL from step 6
- `PASTE_YOUR_VAPID_PUBLIC_KEY_HERE` → your public VAPID key

## No npm install needed

There are no npm dependencies. You do NOT need to run `npm install` before deploying.
