import webpush from 'web-push';

export default {
    // ── HTTP handler ────────────────────────────────────────────────────────
    // Handles subscription registration from the web app.
    async fetch(request, env) {
        const url = new URL(request.url);

        // CORS preflight
        if (request.method === 'OPTIONS') {
            return corsResponse(new Response(null, { status: 204 }));
        }

        // POST /subscribe — browser sends its PushSubscription object here
        if (request.method === 'POST' && url.pathname === '/subscribe') {
            try {
                const sub = await request.json();
                // Use the last 40 chars of the endpoint as a stable KV key
                const key = sub.endpoint.slice(-40);
                await env.SUBS.put(key, JSON.stringify(sub), {
                    expirationTtl: 60 * 60 * 24 * 60  // auto-expire after 60 days
                });
                return corsResponse(new Response('Subscribed', { status: 201 }));
            } catch (e) {
                return corsResponse(new Response('Bad request', { status: 400 }));
            }
        }

        // DELETE /unsubscribe — called when user turns off notifications
        if (request.method === 'DELETE' && url.pathname === '/unsubscribe') {
            try {
                const { endpoint } = await request.json();
                await env.SUBS.delete(endpoint.slice(-40));
                return corsResponse(new Response('Unsubscribed', { status: 200 }));
            } catch (e) {
                return corsResponse(new Response('Bad request', { status: 400 }));
            }
        }

        // GET / — health check
        if (request.method === 'GET' && url.pathname === '/') {
            return new Response('ephrata-push is running', { status: 200 });
        }

        return new Response('Not found', { status: 404 });
    },

    // ── Cron handler ─────────────────────────────────────────────────────────
    // Cloudflare calls this on the schedule defined in wrangler.toml (every 15 min).
    async scheduled(event, env, ctx) {
        ctx.waitUntil(checkAndPush(env));
    }
};

// ── Core alert-check logic ───────────────────────────────────────────────────
async function checkAndPush(env) {
    webpush.setVapidDetails(
        env.VAPID_SUBJECT,
        env.VAPID_PUBLIC_KEY,
        env.VAPID_PRIVATE_KEY   // stored as a Cloudflare secret, not in wrangler.toml
    );

    // 1. Fetch active NWS alerts for your zone
    let features;
    try {
        const res = await fetch(
            `https://api.weather.gov/alerts/active?zone=${env.NWS_ZONE}`,
            { headers: { 'User-Agent': 'EphrataWeather/1.0 (contact@ephrataweather.com)' } }
        );
        ({ features } = await res.json());
    } catch (e) {
        console.error('NWS fetch failed:', e);
        return;
    }

    if (!features?.length) return;

    // 2. Load the list of alert IDs we already pushed so we don't notify twice
    const sentRaw = await env.SUBS.get('__sent_alerts__');
    const sent = new Set(sentRaw ? JSON.parse(sentRaw) : []);

    const newAlerts = features.filter(f => !sent.has(f.id));
    if (!newAlerts.length) return;

    // 3. Persist updated sent-ID list (keep last 200 to avoid unbounded growth)
    const updatedSent = [...sent, ...newAlerts.map(f => f.id)].slice(-200);
    await env.SUBS.put('__sent_alerts__', JSON.stringify(updatedSent));

    // 4. Load all stored device subscriptions
    const { keys } = await env.SUBS.list();
    const subKeys = keys.filter(k => k.name !== '__sent_alerts__');
    if (!subKeys.length) return;

    // 5. Send a push notification for each new alert to every subscribed device
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
                    await webpush.sendNotification(JSON.parse(raw), payload);
                } catch (err) {
                    // 410/404 means the subscription is no longer valid — clean it up
                    if (err.statusCode === 410 || err.statusCode === 404) {
                        await env.SUBS.delete(name);
                    } else {
                        console.error('Push failed for', name, '— status:', err.statusCode);
                    }
                }
            })
        );
    }
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function corsResponse(response) {
    const headers = new Headers(response.headers);
    headers.set('Access-Control-Allow-Origin', '*');
    headers.set('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    headers.set('Access-Control-Allow-Headers', 'Content-Type');
    return new Response(response.body, { status: response.status, headers });
}
