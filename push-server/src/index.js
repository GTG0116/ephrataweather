// Cloudflare Worker — Ephrata Weather Push Notifications
// Uses only the Web Crypto API built into the Workers runtime.
// No npm dependencies required.

export default {
    // ── HTTP handler ─────────────────────────────────────────────────────────
    async fetch(request, env) {
        const url = new URL(request.url);

        if (request.method === 'OPTIONS') {
            return cors(new Response(null, { status: 204 }));
        }

        // POST /subscribe — browser registers its push subscription here
        if (request.method === 'POST' && url.pathname === '/subscribe') {
            try {
                const sub = await request.json();
                await env.SUBS.put(sub.endpoint.slice(-40), JSON.stringify(sub), {
                    expirationTtl: 60 * 60 * 24 * 60  // auto-expire after 60 days
                });
                return cors(new Response('Subscribed', { status: 201 }));
            } catch {
                return cors(new Response('Bad request', { status: 400 }));
            }
        }

        // DELETE /unsubscribe — browser removes its subscription
        if (request.method === 'DELETE' && url.pathname === '/unsubscribe') {
            try {
                const { endpoint } = await request.json();
                await env.SUBS.delete(endpoint.slice(-40));
                return cors(new Response('Unsubscribed', { status: 200 }));
            } catch {
                return cors(new Response('Bad request', { status: 400 }));
            }
        }

        // GET / — health check
        if (request.method === 'GET' && url.pathname === '/') {
            return new Response('ephrata-push is running', { status: 200 });
        }

        return new Response('Not found', { status: 404 });
    },

    // ── Cron handler ─────────────────────────────────────────────────────────
    // Cloudflare triggers this on the schedule in wrangler.toml (every 15 min).
    async scheduled(event, env, ctx) {
        ctx.waitUntil(checkAndPush(env));
    }
};

// ── Core alert-check loop ─────────────────────────────────────────────────────
async function checkAndPush(env) {
    // 1. Fetch active NWS alerts for the configured zone
    let features;
    try {
        const res = await fetch(
            `https://api.weather.gov/alerts/active?zone=${env.NWS_ZONE}`,
            { headers: { 'User-Agent': 'EphrataWeather/1.0 (weather@ephrataweather.com)' } }
        );
        ({ features } = await res.json());
    } catch (e) {
        console.error('NWS fetch failed:', e);
        return;
    }

    if (!features?.length) return;

    // 2. Filter out alerts we already sent (stored in KV to survive restarts)
    const sentRaw = await env.SUBS.get('__sent_alerts__');
    const sent = new Set(sentRaw ? JSON.parse(sentRaw) : []);
    const newAlerts = features.filter(f => !sent.has(f.id));
    if (!newAlerts.length) return;

    // 3. Persist updated sent-ID list (keep last 200 to avoid unbounded growth)
    const updatedSent = [...sent, ...newAlerts.map(f => f.id)].slice(-200);
    await env.SUBS.put('__sent_alerts__', JSON.stringify(updatedSent));

    // 4. Load every stored device subscription from KV
    const { keys } = await env.SUBS.list();
    const subKeys = keys.filter(k => k.name !== '__sent_alerts__');
    if (!subKeys.length) return;

    // 5. Push each new alert to every subscribed device
    for (const alert of newAlerts) {
        const props = alert.properties;
        const payload = JSON.stringify({
            title: props.event ?? 'Weather Alert',
            body: props.headline ?? props.description?.slice(0, 140) ?? '',
            icon: '/IMG_0912.png',
            badge: '/IMG_0912.png',
            tag: alert.id,
            requireInteraction: true,
            data: { url: '/' }
        });

        await Promise.allSettled(
            subKeys.map(async ({ name }) => {
                const raw = await env.SUBS.get(name);
                if (!raw) return;
                try {
                    const res = await sendWebPush(
                        JSON.parse(raw),
                        payload,
                        env.VAPID_SUBJECT,
                        env.VAPID_PUBLIC_KEY,
                        env.VAPID_PRIVATE_KEY
                    );
                    if (res.status === 410 || res.status === 404) {
                        // Subscription is expired or revoked — remove it
                        await env.SUBS.delete(name);
                        console.log('Removed expired subscription:', name);
                    } else if (!res.ok) {
                        const body = await res.text();
                        console.error(`Push failed (${res.status}) for ${name}:`, body);
                    }
                } catch (e) {
                    console.error('Push error for', name, e.message);
                }
            })
        );
    }
}

// ── Web Push (RFC 8291) — native Web Crypto, no npm packages ─────────────────

// Encode an ArrayBuffer or Uint8Array as base64url
function b64url(buf) {
    return btoa(String.fromCharCode(...new Uint8Array(buf)))
        .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

// Decode a base64url string to Uint8Array
function fromB64url(s) {
    const pad = '='.repeat((4 - s.length % 4) % 4);
    return Uint8Array.from(
        atob((s + pad).replace(/-/g, '+').replace(/_/g, '/')),
        c => c.charCodeAt(0)
    );
}

// Concatenate multiple Uint8Arrays into one
function join(...arrays) {
    const out = new Uint8Array(arrays.reduce((n, a) => n + a.length, 0));
    let i = 0;
    for (const a of arrays) { out.set(a, i); i += a.length; }
    return out;
}

// HKDF using the Web Crypto API (RFC 5869, SHA-256)
async function hkdf(secret, salt, info, bits) {
    const key = await crypto.subtle.importKey('raw', secret, 'HKDF', false, ['deriveBits']);
    return new Uint8Array(
        await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, bits)
    );
}

// Build and sign a VAPID JWT for the given push endpoint
async function makeVapidJWT(endpoint, subject, pubKeyB64, privKeyB64) {
    const enc = new TextEncoder();
    const { origin } = new URL(endpoint);

    // Import the VAPID private key from its raw base64url scalar + public key coordinates
    const pubBytes = fromB64url(pubKeyB64);
    const privKey = await crypto.subtle.importKey(
        'jwk',
        {
            kty: 'EC', crv: 'P-256',
            d: privKeyB64,
            x: b64url(pubBytes.slice(1, 33)),
            y: b64url(pubBytes.slice(33, 65))
        },
        { name: 'ECDSA', namedCurve: 'P-256' },
        false, ['sign']
    );

    const header  = b64url(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
    const payload = b64url(enc.encode(JSON.stringify({
        aud: origin,
        exp: Math.floor(Date.now() / 1000) + 43200,  // valid for 12 hours
        sub: subject
    })));

    const sig = await crypto.subtle.sign(
        { name: 'ECDSA', hash: 'SHA-256' },
        privKey,
        enc.encode(`${header}.${payload}`)
    );

    return `${header}.${payload}.${b64url(sig)}`;
}

// Encrypt and deliver one push message to one subscription
async function sendWebPush(subscription, payload, subject, pubKey, privKey) {
    const enc = new TextEncoder();
    const p256dh = fromB64url(subscription.keys.p256dh);
    const auth   = fromB64url(subscription.keys.auth);
    const body   = enc.encode(typeof payload === 'string' ? payload : JSON.stringify(payload));

    // Random 16-byte salt for this message
    const salt = crypto.getRandomValues(new Uint8Array(16));

    // Ephemeral ECDH server key pair
    const serverKP     = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
    const serverPubRaw = new Uint8Array(await crypto.subtle.exportKey('raw', serverKP.publicKey));

    // ECDH shared secret with the subscriber's public key
    const subKey = await crypto.subtle.importKey(
        'raw', p256dh, { name: 'ECDH', namedCurve: 'P-256' }, false, []
    );
    const sharedSecret = new Uint8Array(
        await crypto.subtle.deriveBits({ name: 'ECDH', public: subKey }, serverKP.privateKey, 256)
    );

    // Derive IKM from the shared secret and auth secret (RFC 8291 §3.3)
    const keyInfo = join(enc.encode('WebPush: info\x00'), p256dh, serverPubRaw);
    const ikm = await hkdf(sharedSecret, auth, keyInfo, 256);

    // Derive the content-encryption key (16 bytes) and nonce (12 bytes)
    const cek   = await hkdf(ikm, salt, enc.encode('Content-Encoding: aes128gcm\x00'), 128);
    const nonce = await hkdf(ikm, salt, enc.encode('Content-Encoding: nonce\x00'), 96);

    // AES-128-GCM encrypt; 0x02 marks the end of the final (and only) record
    const cekKey    = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
    const plaintext = join(body, new Uint8Array([2]));
    const ciphertext = new Uint8Array(
        await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, cekKey, plaintext)
    );

    // Assemble the aes128gcm content-coding header (RFC 8188 §2)
    const rsBytes = new Uint8Array(4);
    new DataView(rsBytes.buffer).setUint32(0, plaintext.length, false);
    const encrypted = join(salt, rsBytes, new Uint8Array([serverPubRaw.length]), serverPubRaw, ciphertext);

    // VAPID authorization header
    const jwt = await makeVapidJWT(subscription.endpoint, subject, pubKey, privKey);

    return fetch(subscription.endpoint, {
        method: 'POST',
        headers: {
            'Authorization':      `vapid t=${jwt},k=${pubKey}`,
            'Content-Encoding':   'aes128gcm',
            'Content-Type':       'application/octet-stream',
            'TTL':                '86400',
            'Urgency':            'normal'
        },
        body: encrypted
    });
}

// ── CORS helper ───────────────────────────────────────────────────────────────
function cors(response) {
    const h = new Headers(response.headers);
    h.set('Access-Control-Allow-Origin', '*');
    h.set('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    h.set('Access-Control-Allow-Headers', 'Content-Type');
    return new Response(response.body, { status: response.status, headers: h });
}
