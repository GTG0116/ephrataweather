// ============================================
// EPHRATA WEATHER - SERVICE WORKER
// Handles background weather alert notifications
// even when the app is not open.
// ============================================

const SW_VERSION = 1;
const DB_NAME = 'ephrata-weather';
const DB_VERSION = 1;

self.addEventListener('install', () => {
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(clients.claim());
});

// ---- Periodic Background Sync ----
// Fires on a schedule (minimum ~30 min) when the app is closed.
// Requires the PWA to be installed and the browser to support periodicSync.
self.addEventListener('periodicsync', (event) => {
    if (event.tag === 'weather-alerts') {
        event.waitUntil(checkAndNotifyAlerts());
    }
});

// ---- Push Event (future-proof for a push server) ----
self.addEventListener('push', (event) => {
    event.waitUntil(checkAndNotifyAlerts());
});

// ---- Notification click → open / focus the app ----
self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
            for (const client of windowClients) {
                if ('focus' in client) return client.focus();
            }
            return clients.openWindow('/');
        })
    );
});

// ---- Core alert-check routine ----
async function checkAndNotifyAlerts() {
    const locations = await idbGet('locations');
    if (!locations || locations.length === 0) return;

    const notifiedArr = await idbGet('notifiedAlerts') || [];
    const notified = new Set(notifiedArr);

    for (const loc of locations) {
        try {
            const url = `https://api.weather.gov/alerts/active?point=${Number(loc.lat).toFixed(4)},${Number(loc.lng).toFixed(4)}`;
            const res = await fetch(url, {
                headers: { 'User-Agent': 'EphrataWeather/1.0 (github.com/ephrataweather)' }
            });
            if (!res.ok) continue;

            const data = await res.json();
            const features = data.features || [];

            for (const feature of features) {
                const props = feature.properties || {};
                const id = feature.id || `${loc.name}-${props.event}-${props.expires || ''}`;
                const noteKey = `${loc.name}:${id}`;
                if (notified.has(noteKey)) continue;

                const expiresText = _formatTime(props.expires);
                const eventName = props.event || 'Alert';
                const severity = (props.severity || '').toLowerCase();
                const params = props.parameters || {};

                // Determine alert subtype for enhanced notification body
                const subtypeLabel = _swAlertSubtype(eventName, props.headline || '', props.description || '', params);
                const tstmDetails = _swTstmDetails(eventName, props.description || '', params);

                const bodyParts = [eventName];
                if (subtypeLabel) bodyParts.push(`\u26A0\uFE0F ${subtypeLabel}`);
                if (tstmDetails) bodyParts.push(tstmDetails);
                bodyParts.push(`Expires: ${expiresText}`);

                await self.registration.showNotification(`Weather Alert \u2022 ${loc.name}`, {
                    body: bodyParts.join('\n'),
                    icon: '/IMG_0912.png',
                    badge: '/IMG_0912.png',
                    tag: noteKey,
                    requireInteraction: severity === 'extreme' || severity === 'severe' || !!subtypeLabel,
                    data: { url: '/' }
                });

                notified.add(noteKey);
            }
        } catch (err) {
            // Fail silently per location — don't block other locations
            console.warn('[SW] Alert check failed for', loc.name, err);
        }
    }

    // Persist updated deduplication set (keep last 200)
    await idbPut('notifiedAlerts', Array.from(notified).slice(-200));
}

function _formatTime(ts) {
    if (!ts) return 'N/A';
    const d = new Date(ts);
    if (isNaN(d)) return 'N/A';
    return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
}

// Returns a short subtype label string or null
function _swAlertSubtype(event, headline, desc, params) {
    const ev = event.toLowerCase();
    const hl = headline.toUpperCase();
    const d = desc.toUpperCase();

    if (ev.includes('tornado warning')) {
        if (d.includes('TORNADO EMERGENCY') || hl.includes('TORNADO EMERGENCY')) return 'TORNADO EMERGENCY';
        const detection = (params.tornadoDetection?.[0] || '').toUpperCase();
        if (detection.includes('PARTICULARLY DANGEROUS') || d.includes('PARTICULARLY DANGEROUS SITUATION')) return 'PARTICULARLY DANGEROUS SITUATION';
        if (detection === 'OBSERVED') return 'TORNADO OBSERVED';
    }
    if (ev.includes('flash flood warning')) {
        if (d.includes('FLASH FLOOD EMERGENCY') || hl.includes('FLASH FLOOD EMERGENCY')) return 'FLASH FLOOD EMERGENCY';
        if ((params.flashFloodDetection?.[0] || '').toUpperCase() === 'OBSERVED') return 'FLASH FLOOD OBSERVED';
    }
    if (ev.includes('severe thunderstorm warning')) {
        const threat = (params.thunderstormDamageThreat?.[0] || '').toUpperCase();
        if (threat === 'EXTREME') return 'EXTREMELY DANGEROUS SITUATION';
        if (threat === 'DESTRUCTIVE') return 'DESTRUCTIVE';
        if (threat === 'CONSIDERABLE') return 'CONSIDERABLE';
    }
    return null;
}

// Returns wind/hail detail string or null for severe thunderstorm warnings
function _swTstmDetails(event, desc, params) {
    if (!event.toLowerCase().includes('severe thunderstorm warning')) return null;
    const parts = [];
    let wind = null;
    let hail = null;
    if (params.maxWindGust?.[0]) {
        wind = params.maxWindGust[0].toString().replace(/mph/i, '').trim() + ' mph';
    } else {
        const m = desc.match(/WIND[S]?\.{2,3}(\d+)\s*MPH/i) || desc.match(/WINDS?\s+UP\s+TO\s+(\d+)\s*MPH/i);
        if (m) wind = m[1] + ' mph';
    }
    if (params.maxHailSize?.[0]) {
        hail = params.maxHailSize[0].toString().replace(/in(ch(es)?)?/i, '').trim() + '"';
    } else {
        const m = desc.match(/HAIL\.{2,3}(\d+\.?\d*)\s*IN/i) || desc.match(/HAIL\s+UP\s+TO\s+(\d+\.?\d*)\s*IN/i);
        if (m) hail = m[1] + '"';
    }
    if (wind) parts.push(`Wind: ${wind}`);
    if (hail) parts.push(`Hail: ${hail}`);
    return parts.length ? parts.join(' • ') : null;
}

// ---- IndexedDB helpers ----
function _openDB() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains('store')) {
                db.createObjectStore('store');
            }
        };
        req.onsuccess = (e) => resolve(e.target.result);
        req.onerror = () => reject(req.error);
    });
}

async function idbGet(key) {
    const db = await _openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction('store', 'readonly');
        const req = tx.objectStore('store').get(key);
        req.onsuccess = () => { db.close(); resolve(req.result); };
        req.onerror = () => { db.close(); reject(req.error); };
    });
}

async function idbPut(key, value) {
    const db = await _openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction('store', 'readwrite');
        tx.objectStore('store').put(value, key);
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => { db.close(); reject(tx.error); };
    });
}
