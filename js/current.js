// ============================================
// CURRENT CONDITIONS PAGE LOGIC
// ============================================

// initCurrentView can be called by the SPA router or by a standalone page.
// Pass lat/lng directly, or omit to use LocationManager.getCurrent().
async function initCurrentView(lat, lng) {
    if (lat == null || lng == null) {
        const loc = LocationManager.getCurrent();
        lat = loc.lat;
        lng = loc.lng;
    }

    // Request notification permission early, then sync locations to IDB so the
    // service worker can check alerts in the background when the app is closed.
    if ('Notification' in window && Notification.permission === 'default') {
        Notification.requestPermission().then(async (permission) => {
            if (permission === 'granted') {
                await _syncLocationsToSW();
                // Attempt to register periodic background sync now that permission is granted.
                if ('serviceWorker' in navigator) {
                    const reg = await navigator.serviceWorker.ready.catch(() => null);
                    if (reg && 'periodicSync' in reg) {
                        try {
                            const perm = await navigator.permissions.query({ name: 'periodic-background-sync' });
                            if (perm.state === 'granted') {
                                await reg.periodicSync.register('weather-alerts', { minInterval: 30 * 60 * 1000 });
                            }
                        } catch (_) { /* not supported */ }
                    }
                }
            }
        });
    } else {
        // Permission already granted — keep locations in sync for the SW.
        _syncLocationsToSW().catch(() => {});
    }

    // Determine data source (google/open-meteo or nws)
    const dataSource = WeatherAPI.getDataSource();
    const isNWS = dataSource === 'nws';

    // Fetch weather data in parallel
    const [currentResult, hourlyResult, dailyResult, aqiResult, pollenResult] = await Promise.allSettled([
        isNWS ? WeatherAPI.getNWSCurrentConditions(lat, lng) : WeatherAPI.getCurrentConditions(lat, lng),
        isNWS ? WeatherAPI.getNWSHourlyForecast(lat, lng, 24) : WeatherAPI.getHourlyForecast(lat, lng, 24),
        // Pull a few days so hourly day/night selection can use
        // each hour's date-specific sunrise/sunset window.
        isNWS ? WeatherAPI.getNWSDailyForecast(lat, lng, 3) : WeatherAPI.getDailyForecast(lat, lng, 3),
        WeatherAPI.getAirQuality(lat, lng),
        WeatherAPI.getPollen(lat, lng)
    ]);

    // --- Weather Alerts (NWS for current + starred locations) ---
    try {
        await loadAndRenderAlerts(lat, lng);
    } catch (err) {
        console.warn('Alerts error:', err);
    }

    // --- Current Conditions ---
    if (currentResult.status === 'fulfilled') {
        renderCurrentConditions(currentResult.value, dailyResult.status === 'fulfilled' ? dailyResult.value : null);
    } else {
        document.getElementById('current-condition').textContent = 'Unable to load current conditions';
        console.error('Current conditions error:', currentResult.reason);
    }

    // --- Hourly Forecast ---
    if (hourlyResult.status === 'fulfilled') {
        const forecastDays = dailyResult.status === 'fulfilled' ? dailyResult.value?.forecastDays : [];
        renderHourlyForecast(hourlyResult.value, forecastDays);
    } else {
        document.getElementById('hourly-strip').innerHTML =
            '<div class="error-message">Unable to load hourly forecast<div class="error-hint">Check your API key</div></div>';
        console.error('Hourly forecast error:', hourlyResult.reason);
    }

    // --- Air Quality ---
    if (aqiResult.status === 'fulfilled') {
        renderAirQuality(aqiResult.value);
    } else {
        document.getElementById('aqi-value').textContent = 'N/A';
        document.getElementById('aqi-badge').textContent = 'Unavailable';
        console.error('AQI error:', aqiResult.reason);
    }

    // --- Pollen ---
    if (pollenResult.status === 'fulfilled') {
        renderPollen(pollenResult.value);
    } else {
        console.error('Pollen error:', pollenResult.reason);
    }

    // Update timestamp
    const tsEl = document.getElementById('last-updated');
    if (tsEl) tsEl.textContent =
        'Updated ' + new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

// Auto-run on standalone page (not loaded inside the SPA)
if (typeof _SPA_MODE === 'undefined') {
    (async function () {
        const loc = await LocationManager.init();
        const nameEl = document.getElementById('location-name');
        if (nameEl) nameEl.textContent = loc.name;
        await initCurrentView(loc.lat, loc.lng);
    })();
}

// ---- Alerts ----
let _renderedAlerts = [];
let _alertMap = null;

function _escapeHtml(str) {
    return String(str || '').replace(/[&<>"']/g, (ch) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[ch] || ch));
}

function _formatAlertTime(ts) {
    if (!ts) return 'N/A';
    const d = new Date(ts);
    if (isNaN(d)) return 'N/A';
    return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function _alertClass(alert) {
    const severity = (alert.severity || '').toLowerCase();
    const event = (alert.event || '').toLowerCase();
    if (severity === 'extreme' || severity === 'severe') return 'alert-extreme';
    if (event.includes('warning')) return 'alert-warning';
    if (event.includes('watch')) return 'alert-watch';
    return 'alert-advisory';
}

function _dedupeLocations(locations) {
    const seen = new Set();
    const out = [];
    locations.forEach((loc) => {
        if (loc?.lat == null || loc?.lng == null) return;
        const key = `${Number(loc.lat).toFixed(3)},${Number(loc.lng).toFixed(3)}`;
        if (seen.has(key)) return;
        seen.add(key);
        out.push(loc);
    });
    return out;
}

async function loadAndRenderAlerts(lat, lng) {
    const currentLoc = LocationManager.getCurrent();
    const favorites = LocationManager.getFavorites() || [];
    const locations = _dedupeLocations([
        { lat, lng, name: currentLoc?.name || 'Current Location', isCurrent: true },
        ...favorites.map((f) => ({ lat: f.lat, lng: f.lng, name: f.name, isCurrent: false }))
    ]);

    const results = await Promise.allSettled(locations.map((loc) => WeatherAPI.getAlerts(loc.lat, loc.lng)));

    const byLocation = [];
    results.forEach((result, i) => {
        if (result.status === 'fulfilled') {
            byLocation.push({ location: locations[i], alerts: result.value.alerts || [] });
        }
    });

    const currentAlerts = byLocation.find((x) => x.location.isCurrent)?.alerts || [];
    renderAlerts(currentAlerts);
    sendAlertNotifications(byLocation);
}

function renderAlerts(alerts) {
    const container = document.getElementById('alerts-container');
    if (!container) return;

    _renderedAlerts = alerts || [];
    if (_renderedAlerts.length === 0) {
        container.style.display = 'none';
        container.innerHTML = '';
        return;
    }

    container.style.display = 'block';
    container.innerHTML = _renderedAlerts.map((alert, i) => {
        const headline = _escapeHtml(alert.headline || alert.event || 'Weather Alert');
        const area = _escapeHtml(alert.areaDesc || 'Your county');
        const excerpt = _escapeHtml((alert.description || '').slice(0, 180));
        const hasMore = (alert.description || '').length > 180;
        const iconSvg = `<svg class="alert-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
            <line x1="12" y1="9" x2="12" y2="13"/>
            <line x1="12" y1="17" x2="12.01" y2="17"/>
        </svg>`;

        return `
            <button type="button" class="alert-banner ${_alertClass(alert)} fade-in" style="animation-delay:${i * 80}ms" onclick="openAlertDetail(${i})">
                <div class="alert-header">
                    ${iconSvg}
                    <span class="alert-title">${headline}</span>
                </div>
                <div class="alert-detail">${excerpt}${hasMore ? '…' : ''}</div>
                <div class="alert-time">Areas: ${area}</div>
                <div class="alert-time">Expires: ${_formatAlertTime(alert.expires)}</div>
            </button>
        `;
    }).join('');
}

function openAlertDetail(index) {
    const alert = _renderedAlerts[index];
    if (!alert) return;

    const modal = document.getElementById('alert-modal');
    const titleEl = document.getElementById('alert-modal-title');
    const metaEl = document.getElementById('alert-modal-meta');
    const bodyEl = document.getElementById('alert-modal-body');
    if (!modal || !titleEl || !metaEl || !bodyEl) return;

    titleEl.textContent = alert.headline || alert.event || 'Weather Alert';
    metaEl.textContent = `Effective: ${_formatAlertTime(alert.onset || alert.effective)} • Expires: ${_formatAlertTime(alert.expires)} • Areas: ${alert.areaDesc || 'N/A'}`;

    const parts = [alert.description, alert.instruction].filter(Boolean);
    bodyEl.textContent = parts.length ? parts.join('\n\n') : 'No additional text provided by NWS.';

    modal.style.display = 'flex';
    document.body.style.overflow = 'hidden';
    _drawAlertMap(alert);
}

function closeAlertDetail() {
    const modal = document.getElementById('alert-modal');
    if (modal) modal.style.display = 'none';
    document.body.style.overflow = '';
}

function _drawAlertMap(alert) {
    const mapEl = document.getElementById('alert-modal-map');
    if (!mapEl) return;

    if (!window.mapboxgl) {
        mapEl.innerHTML = '<div style="padding:16px;color:var(--text-secondary);">Map preview unavailable.</div>';
        return;
    }

    if (!_alertMap) {
        mapboxgl.accessToken = CONFIG.MAPBOX_ACCESS_TOKEN;
        _alertMap = new mapboxgl.Map({
            container: 'alert-modal-map',
            style: 'mapbox://styles/mapbox/dark-v11',
            center: [LocationManager.getCurrent().lng, LocationManager.getCurrent().lat],
            zoom: 6
        });
        _alertMap.addControl(new mapboxgl.NavigationControl(), 'top-right');
    }

    const feature = {
        type: 'Feature',
        geometry: alert.geometry,
        properties: { title: alert.headline || alert.event || 'Alert' }
    };

    const sourceData = {
        type: 'FeatureCollection',
        features: alert.geometry ? [feature] : []
    };

    const loadOrUpdate = () => {
        if (_alertMap.getSource('alert-geo')) {
            _alertMap.getSource('alert-geo').setData(sourceData);
        } else {
            _alertMap.addSource('alert-geo', { type: 'geojson', data: sourceData });
            _alertMap.addLayer({
                id: 'alert-fill',
                type: 'fill',
                source: 'alert-geo',
                paint: { 'fill-color': '#ff7043', 'fill-opacity': 0.22 }
            });
            _alertMap.addLayer({
                id: 'alert-line',
                type: 'line',
                source: 'alert-geo',
                paint: { 'line-color': '#ffab91', 'line-width': 2.2 }
            });
        }

        if (alert.geometry && window.turf) {
            const bounds = turf.bbox(sourceData);
            _alertMap.fitBounds([[bounds[0], bounds[1]], [bounds[2], bounds[3]]], { padding: 30, duration: 0 });
        } else {
            const loc = LocationManager.getCurrent();
            _alertMap.easeTo({ center: [loc.lng, loc.lat], zoom: 7, duration: 0 });
        }
        setTimeout(() => _alertMap.resize(), 30);
    };

    if (_alertMap.loaded()) loadOrUpdate();
    else _alertMap.once('load', loadOrUpdate);
}

// ---- IndexedDB sync for service worker background notifications ----
// Writes current + starred locations (and the already-notified alert IDs) to
// IndexedDB so that sw.js can access them when the page is closed.
async function _syncLocationsToSW() {
    if (!('indexedDB' in window)) return;

    const currentLoc = LocationManager.getCurrent();
    const favorites = LocationManager.getFavorites() || [];

    const all = [];
    if (currentLoc?.lat != null) {
        all.push({ lat: currentLoc.lat, lng: currentLoc.lng, name: currentLoc.name || 'Current Location' });
    }
    favorites.forEach((f) => {
        if (f?.lat != null) all.push({ lat: f.lat, lng: f.lng, name: f.name });
    });

    // Dedupe by rounded coordinates
    const seen = new Set();
    const locations = all.filter((loc) => {
        const key = `${Number(loc.lat).toFixed(3)},${Number(loc.lng).toFixed(3)}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });

    const notifiedArr = JSON.parse(localStorage.getItem('ephrata_notified_alerts') || '[]');

    await new Promise((resolve) => {
        const req = indexedDB.open('ephrata-weather', 1);
        req.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains('store')) db.createObjectStore('store');
        };
        req.onsuccess = (e) => {
            const db = e.target.result;
            const tx = db.transaction('store', 'readwrite');
            tx.objectStore('store').put(locations, 'locations');
            tx.objectStore('store').put(notifiedArr, 'notifiedAlerts');
            tx.oncomplete = () => { db.close(); resolve(); };
            tx.onerror = () => { db.close(); resolve(); };
        };
        req.onerror = () => resolve();
    });
}

function sendAlertNotifications(byLocation) {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;

    const notifiedKey = 'ephrata_notified_alerts';
    const notified = new Set(JSON.parse(localStorage.getItem(notifiedKey) || '[]'));

    byLocation.forEach(({ location, alerts }) => {
        (alerts || []).forEach((alert) => {
            const id = alert.id || `${location.name}-${alert.event}-${alert.expires || ''}`;
            const noteKey = `${location.name}:${id}`;
            if (notified.has(noteKey)) return;

            const expiresText = _formatAlertTime(alert.expires);
            new Notification(`Weather Alert • ${location.name}`, {
                body: `${alert.event || 'Alert'} — Expires ${expiresText}`,
                icon: 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="%23FF9800"><path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z"/></svg>'),
                tag: noteKey,
                requireInteraction: true
            });
            notified.add(noteKey);
        });
    });

    localStorage.setItem(notifiedKey, JSON.stringify(Array.from(notified).slice(-200)));
}

// ---- Hourly detail popup ----
let _hourlyData = [];

function showHourlyDetail(idx) {
    const h = _hourlyData[idx];
    if (!h) return;

    // Remove any existing popup
    const existing = document.getElementById('hourly-detail-popup');
    if (existing) existing.remove();

    const time = idx === 0 ? 'Now' : WeatherAPI.formatTime(h.interval?.startTime || h.displayDateTime);
    const temp = WeatherAPI.formatTemp(h.temperature?.degrees);
    const feelsLike = h.feelsLikeTemperature?.degrees != null
        ? WeatherAPI.formatTemp(h.feelsLikeTemperature.degrees) + '°'
        : null;
    const cond = h.weatherCondition?.description?.text
        || (h.weatherCondition?.type || '').replace(/_/g, ' ').toLowerCase()
        || '—';
    const precip = h.precipitation?.probability;
    const windSpeed = h.wind?.speed;
    const windDir = h.wind?.direction != null ? WeatherAPI.windDirection(h.wind.direction) : null;
    const humidity = h.relativeHumidity;

    const rows = [];
    if (feelsLike) rows.push(`<div class="hpop-row"><span class="hpop-key">Feels Like</span><span>${feelsLike}</span></div>`);
    if (precip != null) rows.push(`<div class="hpop-row"><span class="hpop-key">Precip</span><span>${Math.round(precip)}%</span></div>`);
    if (windSpeed != null) rows.push(`<div class="hpop-row"><span class="hpop-key">Wind</span><span>${Math.round(windSpeed)} mph${windDir ? ' ' + windDir : ''}</span></div>`);
    if (humidity != null) rows.push(`<div class="hpop-row"><span class="hpop-key">Humidity</span><span>${Math.round(humidity)}%</span></div>`);

    const popup = document.createElement('div');
    popup.id = 'hourly-detail-popup';
    popup.className = 'hourly-detail-popup glass';
    popup.innerHTML = `
        <div class="hpop-header">
            <span class="hpop-time">${time}</span>
            <span class="hpop-temp">${temp}°</span>
            <button class="hpop-close" onclick="document.getElementById('hourly-detail-popup').remove()">&#x2715;</button>
        </div>
        <div class="hpop-cond">${cond}</div>
        ${rows.join('')}
    `;

    // Insert after the hourly strip container
    const strip = document.getElementById('hourly-strip');
    strip.parentNode.insertAdjacentElement('afterend', popup);

    // Auto-dismiss when clicking outside
    const dismiss = (e) => {
        if (!popup.contains(e.target)) {
            popup.remove();
            document.removeEventListener('click', dismiss);
        }
    };
    setTimeout(() => document.addEventListener('click', dismiss), 50);
}

// ---- Day/night helper ----
// Parses a sunrise or sunset string robustly.
// Open-Meteo returns "2026-03-08T06:45" (local, no tz offset).
// Google returns an ISO string with offset or Z.
function _parseSunTime(str) {
    if (!str) return NaN;
    if (typeof str === 'object') {
        const y = str.year;
        const m = str.month;
        const d = str.day;
        if (y != null && m != null && d != null) {
            const h = str.hours || 0;
            const min = str.minutes || 0;
            const s = str.seconds || 0;
            return new Date(y, m - 1, d, h, min, s).getTime();
        }
    }
    const ms = Date.parse(str);
    if (!isNaN(ms)) return ms;
    return NaN;
}

function _dateKeyFromMs(tsMs) {
    const d = new Date(tsMs);
    if (isNaN(d)) return null;
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function _dailyKey(day) {
    if (!day) return null;
    if (typeof day.displayDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(day.displayDate)) {
        return day.displayDate;
    }
    const base = day.interval?.startTime || day.displayDate;
    if (!base) return null;
    const tsMs = Date.parse(base);
    return isNaN(tsMs) ? null : _dateKeyFromMs(tsMs);
}

function _dayForTimestamp(tsMs, forecastDays) {
    if (!Array.isArray(forecastDays) || forecastDays.length === 0 || isNaN(tsMs)) return null;
    const targetKey = _dateKeyFromMs(tsMs);
    if (!targetKey) return forecastDays[0] || null;
    return forecastDays.find((d) => _dailyKey(d) === targetKey) || forecastDays[0] || null;
}

// Returns true if current time is between sunset and sunrise (nighttime).
function _isNighttime(day0) {
    if (!day0) return false;
    const srMs = _parseSunTime(day0.sunrise);
    const ssMs = _parseSunTime(day0.sunset);
    if (isNaN(srMs) || isNaN(ssMs)) return false;
    const now = Date.now();
    // Daytime = between sunrise and sunset; nighttime = everything else
    return now < srMs || now > ssMs;
}

// Returns true if a given timestamp (ms) is nighttime relative to a day's sunrise/sunset.
function _isTimestampNight(tsMs, day0) {
    if (!day0 || isNaN(tsMs)) return false;
    const srMs = _parseSunTime(day0.sunrise);
    const ssMs = _parseSunTime(day0.sunset);
    if (isNaN(srMs) || isNaN(ssMs)) return false;
    return tsMs < srMs || tsMs > ssMs;
}

// ---- Render functions ----

function renderCurrentConditions(data, dailyData) {
    const temp = data.temperature?.degrees;
    document.getElementById('current-temp').innerHTML =
        `${WeatherAPI.formatTemp(temp)}<span class="unit">&deg;F</span>`;

    const condition = data.weatherCondition?.description?.text || data.weatherCondition?.type?.replace(/_/g, ' ') || 'Unknown';
    document.getElementById('current-condition').textContent = condition;

    const feelsLike = data.feelsLikeTemperature?.degrees;
    if (feelsLike != null) {
        document.getElementById('feels-like').textContent = `Feels like ${WeatherAPI.formatTemp(feelsLike)}\u00B0`;
    }

    if (dailyData && dailyData.forecastDays && dailyData.forecastDays.length > 0) {
        const day = dailyData.forecastDays[0];
        const hi = day.maxTemperature?.degrees;
        const lo = day.minTemperature?.degrees;
        if (hi != null && lo != null) {
            document.getElementById('hi-lo').innerHTML =
                `<span class="hi">H:${WeatherAPI.formatTemp(hi)}\u00B0</span> &nbsp; <span class="lo">L:${WeatherAPI.formatTemp(lo)}\u00B0</span>`;
        }
    }

    const condType = data.weatherCondition?.type || condition;
    const isNight = _isNighttime(dailyData?.forecastDays?.[0]);
    const iconSvg = WeatherIcons.fromText(condType, isNight);
    document.getElementById('current-icon').innerHTML = iconSvg;

    // Wind
    const windSpeed = data.wind?.speed?.value;
    const windGust = data.wind?.gust?.value;
    const windDir = data.wind?.direction;
    if (windSpeed != null) {
        const fmtWind = v => v % 1 === 0 ? v : parseFloat(v.toFixed(1));
        document.getElementById('wind-speed').innerHTML =
            `${fmtWind(windSpeed)}<span class="unit"> mph</span>`;
        let detail = windDir != null ? WeatherAPI.windDirection(windDir) : '';
        if (windGust != null) detail += ` \u2022 Gusts ${fmtWind(windGust)} mph`;
        document.getElementById('wind-detail').textContent = detail;
    }

    // Humidity
    const humidity = data.relativeHumidity;
    if (humidity != null) {
        document.getElementById('humidity-value').innerHTML =
            `${Math.round(humidity)}<span class="unit">%</span>`;
    }
    const dewpoint = data.dewPoint?.degrees;
    if (dewpoint != null) {
        document.getElementById('dewpoint-detail').textContent = `Dew point: ${WeatherAPI.formatTemp(dewpoint)}\u00B0`;
    }

    // UV Index
    const uv = data.uvIndex;
    if (uv != null) {
        document.getElementById('uv-value').textContent = uv;
        let uvLabel = 'Low';
        if (uv >= 3 && uv < 6) uvLabel = 'Moderate';
        else if (uv >= 6 && uv < 8) uvLabel = 'High';
        else if (uv >= 8 && uv < 11) uvLabel = 'Very High';
        else if (uv >= 11) uvLabel = 'Extreme';
        document.getElementById('uv-detail').textContent = uvLabel;
    }

    // Pressure
    const pressure = data.pressure?.meanSeaLevelMillibars;
    if (pressure != null) {
        const inHg = (pressure * 0.02953).toFixed(2);
        document.getElementById('pressure-value').innerHTML =
            `${inHg}<span class="unit"> inHg</span>`;
    }

    // Cloud cover
    const clouds = data.cloudCover;
    if (clouds != null) {
        document.getElementById('cloud-value').innerHTML =
            `${Math.round(clouds)}<span class="unit">%</span>`;
    }
}

function renderHourlyForecast(data, forecastDays) {
    const strip = document.getElementById('hourly-strip');
    _hourlyData = data.forecastHours || [];

    if (_hourlyData.length === 0) {
        strip.innerHTML = '<div class="error-message">No hourly data available</div>';
        return;
    }

    strip.innerHTML = _hourlyData.map((hour, i) => {
        const time = i === 0 ? 'Now' : WeatherAPI.formatTime(hour.interval?.startTime || hour.displayDateTime);
        const temp = WeatherAPI.formatTemp(hour.temperature?.degrees);
        const condType = hour.weatherCondition?.type || '';

        // Night check per hour using that hour's forecast day sunrise/sunset
        const tsMs = Date.parse(hour.interval?.startTime || hour.displayDateTime || '');
        const dayForHour = _dayForTimestamp(tsMs, forecastDays);
        const hourNight = _isTimestampNight(tsMs, dayForHour);

        const iconSvg = WeatherIcons.fromText(condType, hourNight);
        const precip = hour.precipitation?.probability;
        const precipStr = precip != null && precip > 0 ? `${Math.round(precip)}%` : '';

        return `
            <div class="hourly-item ${i === 0 ? 'now' : ''} fade-in"
                 style="animation-delay:${i * 30}ms;cursor:pointer;"
                 onclick="showHourlyDetail(${i})"
                 title="Tap for details">
                <span class="time">${time}</span>
                <div style="width:36px;height:36px;">${iconSvg}</div>
                <span class="temp">${temp}&deg;</span>
                ${precipStr ? `<span class="precip" style="display:flex;align-items:center;gap:2px;white-space:nowrap;"><svg width="9" height="9" viewBox="0 0 24 24" fill="rgba(100,180,255,0.85)" style="flex-shrink:0;"><path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z"/></svg>${precipStr}</span>` : ''}
            </div>
        `;
    }).join('');

    // Render hourly charts after the strip
    renderHourlyCharts(_hourlyData);
}

// ---- Hourly Charts ----
let _activeChart = 'temp';

function renderHourlyCharts(hours) {
    const container = document.getElementById('hourly-charts-container');
    if (!container) return;
    container.style.display = 'block';
    _drawChart(_activeChart, hours);
}

function switchHourlyChart(metric) {
    _activeChart = metric;
    document.querySelectorAll('.chart-tab').forEach(btn =>
        btn.classList.toggle('active', btn.dataset.metric === metric));
    _drawChart(metric, _hourlyData);
}

function _drawChart(metric, hours) {
    const canvas = document.getElementById('hourly-chart-svg');
    if (!canvas || !hours.length) return;

    const W = canvas.clientWidth || 700;
    const H = 160;
    canvas.setAttribute('viewBox', `0 0 ${W} ${H}`);
    canvas.setAttribute('height', H);

    // Extract values
    const entries = hours.slice(0, 24).map((h, i) => {
        let val = null;
        if (metric === 'temp')    val = h.temperature?.degrees;
        if (metric === 'wind')    val = h.wind?.speed;
        if (metric === 'pressure') {
            const mb = h.pressure?.meanSeaLevelMillibars;
            val = mb != null ? (mb * 0.02953).toFixed(2) * 1 : null; // convert to inHg
        }
        if (metric === 'precip')  val = h.precipitation?.probability ?? 0;
        const time = i === 0 ? 'Now' : WeatherAPI.formatTime(h.interval?.startTime || h.displayDateTime);
        return { val, time, i };
    }).filter(e => e.val != null);

    if (entries.length < 2) {
        canvas.innerHTML = '<text x="50%" y="50%" text-anchor="middle" fill="rgba(255,255,255,0.4)" font-size="13">No data available</text>';
        return;
    }

    const PAD_L = 44, PAD_R = 12, PAD_T = 16, PAD_B = 36;
    const plotW = W - PAD_L - PAD_R;
    const plotH = H - PAD_T - PAD_B;

    const vals = entries.map(e => e.val);
    let minV = Math.min(...vals);
    let maxV = Math.max(...vals);
    // Add padding so line doesn't hit edges
    const spread = maxV - minV || 1;
    minV -= spread * 0.1;
    maxV += spread * 0.1;

    const xOf = (idx) => PAD_L + (idx / (entries.length - 1)) * plotW;
    const yOf = (v)   => PAD_T + plotH - ((v - minV) / (maxV - minV)) * plotH;

    // Build path
    let linePath = '';
    let areaPath = '';
    entries.forEach((e, i) => {
        const x = xOf(i), y = yOf(e.val);
        if (i === 0) { linePath += `M${x},${y}`; areaPath += `M${x},${PAD_T + plotH} L${x},${y}`; }
        else         { linePath += ` L${x},${y}`; areaPath += ` L${x},${y}`; }
    });
    areaPath += ` L${xOf(entries.length - 1)},${PAD_T + plotH} Z`;

    // Color by metric
    const colors = {
        temp:     { line: '#FF7043', area: 'rgba(255,112,67,0.18)', dot: '#FF7043' },
        wind:     { line: '#42A5F5', area: 'rgba(66,165,245,0.18)', dot: '#42A5F5' },
        pressure: { line: '#AB47BC', area: 'rgba(171,71,188,0.18)', dot: '#AB47BC' },
        precip:   { line: '#26C6DA', area: 'rgba(38,198,218,0.18)', dot: '#26C6DA' }
    };
    const c = colors[metric] || colors.temp;

    // Units for y axis labels
    const unitSuffix = metric === 'temp' ? '°' : metric === 'wind' ? '' : metric === 'pressure' ? '"' : '%';

    // Y axis ticks (5 evenly spaced)
    const yTicks = 4;
    let yLabels = '';
    for (let t = 0; t <= yTicks; t++) {
        const v = minV + (maxV - minV) * (t / yTicks);
        const y = yOf(v);
        const label = metric === 'pressure' ? v.toFixed(2) : Math.round(v) + unitSuffix;
        yLabels += `<line x1="${PAD_L}" y1="${y}" x2="${PAD_L + plotW}" y2="${y}" stroke="rgba(255,255,255,0.06)" stroke-width="1"/>
                    <text x="${PAD_L - 5}" y="${y + 4}" text-anchor="end" fill="rgba(255,255,255,0.45)" font-size="9.5">${label}</text>`;
    }

    // X axis time labels (every 4 hours)
    let xLabels = '';
    entries.forEach((e, i) => {
        if (i % 4 === 0 || i === entries.length - 1) {
            xLabels += `<text x="${xOf(i)}" y="${H - 6}" text-anchor="middle" fill="rgba(255,255,255,0.45)" font-size="9.5">${e.time}</text>`;
        }
    });

    // Dots at data points (every 4 hours to avoid clutter)
    let dots = '';
    entries.forEach((e, i) => {
        if (i % 4 === 0 || i === 0) {
            const v = metric === 'pressure' ? e.val.toFixed(2) + '"' : Math.round(e.val) + unitSuffix;
            dots += `<circle cx="${xOf(i)}" cy="${yOf(e.val)}" r="3" fill="${c.dot}" stroke="rgba(15,20,40,0.8)" stroke-width="1.5"/>
                     <text x="${xOf(i)}" y="${yOf(e.val) - 7}" text-anchor="middle" fill="${c.dot}" font-size="9" font-weight="500">${v}</text>`;
        }
    });

    const chartId = 'cg_' + metric;
    canvas.innerHTML = `
        <defs>
            <linearGradient id="${chartId}" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stop-color="${c.line}" stop-opacity="0.5"/>
                <stop offset="100%" stop-color="${c.line}" stop-opacity="0"/>
            </linearGradient>
        </defs>
        ${yLabels}
        ${xLabels}
        <path d="${areaPath}" fill="url(#${chartId})"/>
        <path d="${linePath}" fill="none" stroke="${c.line}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
        ${dots}
    `;
}

function renderAirQuality(data) {
    const index = data.indexes?.[0];
    if (!index) return;

    const aqi = index.aqi || index.aqiDisplay;
    const category = WeatherAPI.aqiCategory(aqi);

    document.getElementById('aqi-value').textContent = aqi;
    const badge = document.getElementById('aqi-badge');
    badge.textContent = category.label;
    badge.className = `badge ${category.class}`;

    // Position marker on the bar using same category thresholds
    // Bar segments: Good(0-50)=10%, Moderate(51-100)=10%, USG(101-150)=10%, Unhealthy(151-200)=10%, Very Unhealthy(201-300)=20%, Hazardous(301-500)=40%
    // Simplified: linear 0-500 scale mapped to percentage
    const pct = Math.min(100, (aqi / 500) * 100);
    document.getElementById('aqi-marker').style.left = pct + '%';

    // Dominant pollutant
    const detail = document.getElementById('aqi-detail');
    const dominant = index.dominantPollutant;
}

function renderPollen(data) {
    // Handle both possible response structures from the Pollen API
    const days = data.dailyInfo || [];
    if (days.length === 0) return;

    const today = days[0];
    const types = today.pollenTypeInfo || [];

    if (types.length === 0) return;

    types.forEach(pollen => {
        const code = (pollen.code || '').toUpperCase();
        const displayName = (pollen.displayName || '').toLowerCase();
        const indexInfo = pollen.indexInfo || {};
 
        // Get the display value - try category first, then displayName, then numeric value
        let level = indexInfo.category || indexInfo.displayName || '';
        if (!level && indexInfo.value != null) {
            // Convert numeric UPI value to label
            const v = indexInfo.value;
            if (v === 0) level = 'None';
            else if (v <= 1) level = 'Very Low';
            else if (v <= 2) level = 'Low';
            else if (v <= 3) level = 'Moderate';
            else if (v <= 4) level = 'High';
            else level = 'Very High';
        }
        if (!level) level = 'N/A';

        let elId = null;
        if (code === 'TREE' || displayName.includes('tree')) elId = 'pollen-tree';
        else if (code === 'GRASS' || displayName.includes('grass')) elId = 'pollen-grass';
        else if (code === 'WEED' || displayName.includes('weed')) elId = 'pollen-weed';

        if (elId) {
            const el = document.getElementById(elId);
            el.textContent = level;

            const lowerLevel = level.toLowerCase();
            if (lowerLevel.includes('very high')) {
                el.className = 'level pollen-very-high';
            } else if (lowerLevel.includes('high')) {
                el.className = 'level pollen-high';
            } else if (lowerLevel.includes('moderate') || lowerLevel.includes('medium')) {
                el.className = 'level pollen-moderate';
            } else {
                el.className = 'level pollen-low';
            }
        }
    });
}
