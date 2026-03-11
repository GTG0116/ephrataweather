# ephrata-push — Cloudflare Worker

Polls the NWS alerts API every 15 minutes and sends web-push notifications to subscribed devices.

## Setup (one time)

### 1. Install tools
```
npm install -g wrangler
wrangler login
```

### 2. Install dependencies
```
cd push-server
npm install
```

### 3. Generate VAPID keys
```
npx web-push generate-vapid-keys
```
Save the output — you need both keys.

### 4. Create the KV namespace
```
wrangler kv namespace create SUBS
```
Copy the `id` value from the output and paste it into `wrangler.toml`.

### 5. Fill in wrangler.toml
Open `wrangler.toml` and replace every `PASTE_YOUR_*` placeholder.

### 6. Store the private key as a secret (never put it in wrangler.toml)
```
wrangler secret put VAPID_PRIVATE_KEY
```
Paste your private VAPID key when prompted.

### 7. Deploy
```
wrangler deploy
```

### 8. Update the web app
In `js/current.js`, set:
- `PUSH_SERVER` to your Worker URL (printed after deploy)
- `VAPID_PUBLIC_KEY` to your public VAPID key
