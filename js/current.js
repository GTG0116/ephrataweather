// ============================================
// CURRENT CONDITIONS PAGE LOGIC
// ============================================

// Auto-refresh timer handle — cleared and restarted each time the view inits.
let _autoRefreshTimer = null;

// initCurrentView can be called by the SPA router or by a standalone page.
// Pass lat/lng directly, or omit to use LocationManager.getCurrent().
async function initCurrentView(lat, lng) {
    // Clear any existing auto-refresh timer before starting a new one.
    if (_autoRefreshTimer) { clearInterval(_autoRefreshTimer); _autoRefreshTimer = null; }

    if (lat == null || lng == null) {
        const loc = LocationManager.getCurrent();
        lat = loc.lat;
        lng = loc.lng;
    }

    // Determine data source
    const dataSource = WeatherAPI.getDataSource();
    const isNWS = dataSource === 'nws';
    const isOpenMeteo = dataSource === 'open-meteo';
    const isOWM = dataSource === 'owm';

    function _getCurrentFn() {
        if (isNWS) return WeatherAPI.getNWSCurrentConditions(lat, lng);
        if (isOpenMeteo) return WeatherAPI.getOpenMeteoCurrentConditions(lat, lng);
        if (isOWM) return WeatherAPI.getOWMCurrentConditions(lat, lng);
        return WeatherAPI.getCurrentConditions(lat, lng); // google
    }
    function _getHourlyFn() {
        if (isNWS) return WeatherAPI.getNWSHourlyForecast(lat, lng, 24);
        if (isOpenMeteo) return WeatherAPI.getOpenMeteoHourlyForecast(lat, lng, 24);
        if (isOWM) return WeatherAPI.getOWMHourlyForecast(lat, lng, 24);
        return WeatherAPI.getHourlyForecast(lat, lng, 24); // google
    }
    function _getDailyFn(days) {
        if (isNWS) return WeatherAPI.getNWSDailyForecast(lat, lng, days);
        if (isOpenMeteo) return WeatherAPI.getOpenMeteoDailyForecast(lat, lng, days);
        if (isOWM) return WeatherAPI.getOWMDailyForecast(lat, lng, days);
        return WeatherAPI.getDailyForecast(lat, lng, days); // google
    }

    // Fetch weather data in parallel
    const [currentResult, hourlyResult, dailyResult, aqiResult, pollenResult] = await Promise.allSettled([
        _getCurrentFn(),
        _getHourlyFn(),
        // Pull a few days so hourly day/night selection can use
        // each hour's date-specific sunrise/sunset window.
        _getDailyFn(3),
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
        renderPollen({});  // sets all pollen levels to "None"
        console.error('Pollen error:', pollenResult.reason);
    }

    // Update timestamp
    const tsEl = document.getElementById('last-updated');
    if (tsEl) tsEl.textContent =
        'Updated ' + new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

    // Start 1-minute auto-refresh for alerts and current conditions.
    _autoRefreshTimer = setInterval(() => _autoRefreshCurrent(), 60 * 1000);
}

// Lightweight periodic refresh: alerts + current conditions + AQI.
// Runs every minute while the current-conditions view is active.
async function _autoRefreshCurrent() {
    const loc = LocationManager.getCurrent();
    if (!loc?.lat) return;

    const _src = WeatherAPI.getDataSource();
    function _getAutoRefreshCurrentFn() {
        if (_src === 'nws') return WeatherAPI.getNWSCurrentConditions(loc.lat, loc.lng);
        if (_src === 'open-meteo') return WeatherAPI.getOpenMeteoCurrentConditions(loc.lat, loc.lng);
        if (_src === 'owm') return WeatherAPI.getOWMCurrentConditions(loc.lat, loc.lng);
        return WeatherAPI.getCurrentConditions(loc.lat, loc.lng);
    }

    const [currentResult, aqiResult] = await Promise.allSettled([
        _getAutoRefreshCurrentFn(),
        WeatherAPI.getAirQuality(loc.lat, loc.lng)
    ]);

    if (currentResult.status === 'fulfilled') {
        renderCurrentConditions(currentResult.value, null);
    }
    if (aqiResult.status === 'fulfilled') {
        renderAirQuality(aqiResult.value);
    }

    try {
        await loadAndRenderAlerts(loc.lat, loc.lng);
    } catch (e) { /* silent */ }

    // Also refresh MRMS radar on the open alert map (if any)
    if (_alertMap) _loadMRMSToAlertMap();

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
// Timezone of the currently-viewed location (IANA string, e.g. "America/Chicago").
// Set when alerts are loaded so times are shown in the location's local timezone.
let _locationTimeZone = null;

function _escapeHtml(str) {
    return String(str || '').replace(/[&<>"']/g, (ch) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[ch] || ch));
}

function _formatAlertTime(ts) {
    if (!ts) return 'N/A';
    const d = new Date(ts);
    if (isNaN(d)) return 'N/A';
    // Use the location's timezone so Midwest alerts show Central time, etc.
    const tz = _locationTimeZone || Intl.DateTimeFormat().resolvedOptions().timeZone;
    return d.toLocaleString('en-US', {
        month: 'short', day: 'numeric',
        hour: 'numeric', minute: '2-digit',
        timeZoneName: 'short',
        timeZone: tz
    });
}

// ---- Alert subtype classification ----
// Returns an object { type, label, colorClass } or null for standard alerts.
function _alertSubtype(alert) {
    const event = (alert.event || '').toLowerCase();
    const headline = (alert.headline || '').toUpperCase();
    const desc = (alert.description || '').toUpperCase();
    const params = alert.parameters || {};

    if (event.includes('tornado warning')) {
        // Tornado Emergency takes highest priority
        if (desc.includes('TORNADO EMERGENCY') || headline.includes('TORNADO EMERGENCY')) {
            return { type: 'tornado_emergency', label: 'TORNADO EMERGENCY', colorClass: 'subtype-emergency' };
        }
        const detection = (params.tornadoDetection?.[0] || '').toUpperCase();
        // PDS Tornado Warning
        if (detection.includes('PARTICULARLY DANGEROUS') || desc.includes('PARTICULARLY DANGEROUS SITUATION')) {
            return { type: 'pds_tornado', label: 'PARTICULARLY DANGEROUS SITUATION', colorClass: 'subtype-pds' };
        }
        // Observed tornado
        if (detection === 'OBSERVED') {
            return { type: 'tornado_observed', label: 'TORNADO OBSERVED', colorClass: 'subtype-observed' };
        }
        return null;
    }

    if (event.includes('flash flood warning')) {
        // Flash Flood Emergency
        if (desc.includes('FLASH FLOOD EMERGENCY') || headline.includes('FLASH FLOOD EMERGENCY')) {
            return { type: 'flash_flood_emergency', label: 'FLASH FLOOD EMERGENCY', colorClass: 'subtype-emergency' };
        }
        const detection = (params.flashFloodDetection?.[0] || '').toUpperCase();
        if (detection === 'OBSERVED') {
            return { type: 'flash_flood_observed', label: 'FLASH FLOOD OBSERVED', colorClass: 'subtype-observed' };
        }
        return null;
    }

    if (event.includes('severe thunderstorm warning')) {
        const threat = (params.thunderstormDamageThreat?.[0] || '').toUpperCase();
        // EXTREME = EDS (Extremely Dangerous Situation) — highest SVR tier
        if (threat === 'EXTREME') {
            return { type: 'eds_tstm', label: 'EXTREMELY DANGEROUS SITUATION', colorClass: 'subtype-pds' };
        }
        // DESTRUCTIVE — rare, ≥80 mph winds or ≥2.5" hail
        if (threat === 'DESTRUCTIVE') {
            return { type: 'destructive_tstm', label: 'DESTRUCTIVE', colorClass: 'subtype-emergency' };
        }
        // CONSIDERABLE — 70-79 mph winds or 1.75-2.49" hail
        if (threat === 'CONSIDERABLE') {
            return { type: 'considerable_tstm', label: 'CONSIDERABLE', colorClass: 'subtype-considerable' };
        }
        return null;
    }

    return null;
}

// ---- Extract wind/hail details from Severe Thunderstorm Warnings ----
function _extractSevereThunderstormDetails(alert) {
    const event = (alert.event || '').toLowerCase();
    if (!event.includes('severe thunderstorm warning')) return null;

    const params = alert.parameters || {};
    const desc = alert.description || '';

    // Try structured NWS parameters first
    let wind = null;
    let hail = null;

    if (params.maxWindGust?.[0]) {
        wind = params.maxWindGust[0].toString().replace(/mph/i, '').trim() + ' mph';
    } else {
        const m = desc.match(/WIND[S]?\.{2,3}(\d+)\s*MPH/i)
               || desc.match(/WINDS?\s+UP\s+TO\s+(\d+)\s*MPH/i)
               || desc.match(/(\d+)\s*MPH\s+WIND/i);
        if (m) wind = m[1] + ' mph';
    }

    if (params.maxHailSize?.[0]) {
        hail = params.maxHailSize[0].toString().replace(/in(ch(es)?)?/i, '').trim() + '"';
    } else {
        const m = desc.match(/HAIL\.{2,3}(\d+\.?\d*)\s*IN/i)
               || desc.match(/HAIL\s+UP\s+TO\s+(\d+\.?\d*)\s*IN/i)
               || desc.match(/(\d+\.?\d*)\s*INCH\s+HAIL/i);
        if (m) hail = m[1] + '"';
    }

    return (wind || hail) ? { wind, hail } : null;
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
    // Fetch location timezone so alert times display in the location's local time
    WeatherAPI.getLocationTimeZone(lat, lng).then(tz => { _locationTimeZone = tz; }).catch(() => {});

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

    // Check SPC Day 1 severe weather outlook
    try {
        await loadAndRenderSPCOutlook(lat, lng);
    } catch (err) {
        console.warn('SPC outlook error:', err);
    }

    // Check SPC Day 1 fire weather outlook
    try {
        await loadAndRenderSPCFireOutlook(lat, lng);
    } catch (err) {
        console.warn('SPC fire weather error:', err);
    }

    // Check WPC Day 1 excessive rainfall outlook
    try {
        await loadAndRenderWPCRainfallOutlook(lat, lng);
    } catch (err) {
        console.warn('WPC rainfall error:', err);
    }
}

function _buildAlertBannerHTML(alert, i) {
    const headline = _escapeHtml(alert.headline || alert.event || 'Weather Alert');
    const area = _escapeHtml(alert.areaDesc || 'Your county');
    const excerpt = _escapeHtml((alert.description || '').slice(0, 180));
    const hasMore = (alert.description || '').length > 180;
    const iconSvg = `<svg class="alert-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
        <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
        <line x1="12" y1="9" x2="12" y2="13"/>
        <line x1="12" y1="17" x2="12.01" y2="17"/>
    </svg>`;

    const subtype = _alertSubtype(alert);
    const subtypeBadge = subtype
        ? `<span class="alert-subtype-badge ${subtype.colorClass}">${_escapeHtml(subtype.label)}</span>`
        : '';

    const tstmDetails = _extractSevereThunderstormDetails(alert);
    let tstmRow = '';
    if (tstmDetails) {
        const parts = [];
        if (tstmDetails.wind) parts.push(`Wind: ${_escapeHtml(tstmDetails.wind)}`);
        if (tstmDetails.hail) parts.push(`Hail: ${_escapeHtml(tstmDetails.hail)}`);
        if (parts.length) tstmRow = `<div class="alert-tstm-details">${parts.join(' &nbsp;•&nbsp; ')}</div>`;
    }

    return `
        <button type="button" class="alert-banner ${_alertClass(alert)} fade-in" style="animation-delay:${i * 80}ms" onclick="openAlertDetail(${i})">
            <div class="alert-header">
                ${iconSvg}
                <span class="alert-title">${headline}</span>
            </div>
            ${subtypeBadge}
            ${tstmRow}
            <div class="alert-detail">${excerpt}${hasMore ? '…' : ''}</div>
            <div class="alert-time">Areas: ${area}</div>
            <div class="alert-time">Expires: ${_formatAlertTime(alert.expires)}</div>
        </button>
    `;
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

    // Always show the first (highest-priority) alert
    let html = _buildAlertBannerHTML(_renderedAlerts[0], 0);

    // If there are additional alerts, wrap them in a collapsible section
    if (_renderedAlerts.length > 1) {
        const extraCount = _renderedAlerts.length - 1;
        const extraHtml = _renderedAlerts.slice(1).map((a, i) => _buildAlertBannerHTML(a, i + 1)).join('');
        html += `
            <div class="alerts-extra-wrapper" id="alerts-extra" style="display:none;" aria-hidden="true">
                ${extraHtml}
            </div>
            <button type="button" class="alerts-toggle-btn" id="alerts-toggle"
                    onclick="toggleExtraAlerts()" aria-expanded="false">
                <svg class="alerts-toggle-chevron" width="14" height="14" viewBox="0 0 24 24"
                     fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
                    <polyline points="6 9 12 15 18 9"/>
                </svg>
                <span id="alerts-toggle-label">Show ${extraCount} more alert${extraCount > 1 ? 's' : ''}</span>
            </button>
        `;
    }

    container.innerHTML = html;
}

function toggleExtraAlerts() {
    const extra = document.getElementById('alerts-extra');
    const btn = document.getElementById('alerts-toggle');
    const label = document.getElementById('alerts-toggle-label');
    const chevron = btn && btn.querySelector('.alerts-toggle-chevron');
    if (!extra || !btn || !label) return;

    const isExpanded = extra.style.display !== 'none';
    const extraCount = _renderedAlerts.length - 1;

    if (isExpanded) {
        extra.style.display = 'none';
        extra.setAttribute('aria-hidden', 'true');
        btn.setAttribute('aria-expanded', 'false');
        label.textContent = `Show ${extraCount} more alert${extraCount > 1 ? 's' : ''}`;
        if (chevron) chevron.style.transform = '';
    } else {
        extra.style.display = 'block';
        extra.setAttribute('aria-hidden', 'false');
        btn.setAttribute('aria-expanded', 'true');
        label.textContent = 'Show fewer alerts';
        if (chevron) chevron.style.transform = 'rotate(180deg)';
    }
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

    // Inject subtype badge and thunderstorm details below the meta line
    const existingExtra = document.getElementById('alert-modal-extra');
    if (existingExtra) existingExtra.remove();
    const subtype = _alertSubtype(alert);
    const tstmDetails = _extractSevereThunderstormDetails(alert);
    if (subtype || tstmDetails) {
        const extraEl = document.createElement('div');
        extraEl.id = 'alert-modal-extra';
        extraEl.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:12px;';
        if (subtype) {
            const badge = document.createElement('span');
            badge.className = `alert-subtype-badge ${subtype.colorClass}`;
            badge.textContent = subtype.label;
            extraEl.appendChild(badge);
        }
        if (tstmDetails) {
            const parts = [];
            if (tstmDetails.wind) parts.push(`Wind: ${tstmDetails.wind}`);
            if (tstmDetails.hail) parts.push(`Hail: ${tstmDetails.hail}`);
            if (parts.length) {
                const detailSpan = document.createElement('span');
                detailSpan.className = 'alert-tstm-details';
                detailSpan.textContent = parts.join('  •  ');
                extraEl.appendChild(detailSpan);
            }
        }
        metaEl.insertAdjacentElement('afterend', extraEl);
    }

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

        // Add IEM NEXRAD radar beneath the alert polygon
        _loadIEMRadarToAlertMap();

        if (alert.geometry && window.turf) {
            const bounds = turf.bbox(sourceData);
            _alertMap.fitBounds([[bounds[0], bounds[1]], [bounds[2], bounds[3]]], { padding: 30, duration: 0 });
        } else {
            const loc = LocationManager.getCurrent();
            _alertMap.easeTo({ center: [loc.lng, loc.lat], zoom: 7, duration: 0 });
        }
        // Resize immediately and again after a delay to handle mobile layout settling
        _alertMap.resize();
        setTimeout(() => _alertMap.resize(), 100);
        setTimeout(() => _alertMap.resize(), 400);
    };

    if (_alertMap.loaded()) loadOrUpdate();
    else _alertMap.once('load', loadOrUpdate);
}

// ---- IEM NEXRAD radar layer on the alert map ----
// Uses Iowa Environmental Mesonet (IEM) NEXRAD composite tiles — no API
// fetch required, the URL always serves the latest radar frame.
function _loadIEMRadarToAlertMap() {
    if (!_alertMap) return;
    try {
        // IEM NEXRAD N0Q composite (highest resolution base reflectivity)
        const tileUrl = 'https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0/nexrad-n0q-900913/{z}/{x}/{y}.png';

        if (_alertMap.getSource('alert-mrms')) {
            // Source already exists — update tiles in place
            _alertMap.getSource('alert-mrms').setTiles([tileUrl]);
        } else {
            _alertMap.addSource('alert-mrms', {
                type: 'raster',
                tiles: [tileUrl],
                tileSize: 256,
                maxzoom: 10,
                attribution: 'Radar © <a href="https://mesonet.agron.iastate.edu/">IEM</a>'
            });
            // Insert radar BEFORE the alert-fill layer so it renders underneath
            const beforeId = _alertMap.getLayer('alert-fill') ? 'alert-fill' : undefined;
            _alertMap.addLayer({
                id: 'alert-mrms-layer',
                type: 'raster',
                source: 'alert-mrms',
                paint: {
                    'raster-opacity': 0.72,
                    'raster-fade-duration': 300
                }
            }, beforeId);
        }
    } catch (e) {
        console.warn('IEM radar unavailable on alert map:', e);
    }
}

// ---- SPC Outlook Severe Weather Risk ----

// Risk level ordering (TSTM is not severe enough to trigger a banner)
const _SPC_RISK_ORDER = ['TSTM', 'MRGL', 'SLGT', 'ENH', 'MDT', 'HIGH'];
const _SPC_RISK_LABELS = {
    MRGL: 'Marginal', SLGT: 'Slight', ENH: 'Enhanced', MDT: 'Moderate', HIGH: 'High'
};
// CSS class suffix mirrors stylesheet .spc-risk-* names
const _SPC_RISK_CLASS = { MRGL: 'mrgl', SLGT: 'slgt', ENH: 'enh', MDT: 'mdt', HIGH: 'high' };

// Ray-casting point-in-polygon (GeoJSON ring coords are [lng, lat])
function _raycastPoly(lngLat, ring) {
    const [px, py] = lngLat;
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [xi, yi] = ring[i];
        const [xj, yj] = ring[j];
        if (((yi > py) !== (yj > py)) && (px < ((xj - xi) * (py - yi)) / (yj - yi) + xi)) {
            inside = !inside;
        }
    }
    return inside;
}

function _pointInSPCGeometry(lng, lat, geometry) {
    if (!geometry) return false;
    const pt = [lng, lat];
    if (geometry.type === 'Polygon') {
        return _raycastPoly(pt, geometry.coordinates[0]);
    }
    if (geometry.type === 'MultiPolygon') {
        return geometry.coordinates.some(poly => _raycastPoly(pt, poly[0]));
    }
    return false;
}

async function loadAndRenderSPCOutlook(lat, lng) {
    const container = document.getElementById('spc-banner-container');
    if (!container) return;

    const SPC_CAT_URL = 'https://www.spc.noaa.gov/products/outlook/day1otlk_cat.nolyr.geojson';
    let data;
    try {
        const resp = await fetch(SPC_CAT_URL, { cache: 'no-store' });
        if (!resp.ok) throw new Error('SPC ' + resp.status);
        data = await resp.json();
    } catch (e) {
        // CORS fallback
        try {
            const proxy = 'https://corsproxy.io/?' + encodeURIComponent(SPC_CAT_URL);
            const resp2 = await fetch(proxy, { cache: 'no-store' });
            if (!resp2.ok) throw new Error('Proxy ' + resp2.status);
            data = await resp2.json();
        } catch (e2) {
            console.warn('SPC outlook unavailable:', e2.message);
            return;
        }
    }

    const features = (data.features || []);
    let highestRisk = null;

    for (const feature of features) {
        const label = (feature.properties?.LABEL || feature.properties?.label || '').trim().toUpperCase();
        const riskIdx = _SPC_RISK_ORDER.indexOf(label);
        if (riskIdx < 1) continue; // skip TSTM and unknowns
        if (_pointInSPCGeometry(lng, lat, feature.geometry)) {
            if (!highestRisk || riskIdx > _SPC_RISK_ORDER.indexOf(highestRisk)) {
                highestRisk = label;
            }
        }
    }

    if (highestRisk) {
        renderSPCBanner(highestRisk);
    } else {
        container.style.display = 'none';
        container.innerHTML = '';
    }
}

function renderSPCBanner(risk) {
    const container = document.getElementById('spc-banner-container');
    if (!container) return;
    const label = _SPC_RISK_LABELS[risk] || risk;
    const cls = _SPC_RISK_CLASS[risk] || 'mrgl';
    container.style.display = 'block';
    container.innerHTML = `
        <button type="button" class="spc-risk-banner spc-risk-${cls} fade-in"
                onclick="navigateToSPCMaps()"
                title="Tap to view SPC Outlook maps">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"
                 stroke-linecap="round" style="flex-shrink:0;">
                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
            </svg>
            <span><strong>${label} Risk</strong> of Severe Weather – Day 1 SPC Outlook. Tap to view maps.</span>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"
                 stroke-linecap="round" style="flex-shrink:0;">
                <polyline points="9 18 15 12 9 6"/>
            </svg>
        </button>
    `;
}

function navigateToSPCMaps() {
    window.location.hash = '#maps';
    if (typeof showView === 'function') showView('maps');
}


// ---- SPC Fire Weather Outlook ----

const _SPC_FIRE_ORDER = ['ELEV', 'CRIT', 'EXTM'];
const _SPC_FIRE_LABELS = { ELEV: 'Elevated', CRIT: 'Critical', EXTM: 'Extreme' };
const _SPC_FIRE_CLASS = { ELEV: 'elev', CRIT: 'crit', EXTM: 'extm' };

async function loadAndRenderSPCFireOutlook(lat, lng) {
    const container = document.getElementById('fire-weather-banner-container');
    if (!container) return;

    const SPC_FIRE_URL = 'https://www.spc.noaa.gov/products/fire_wx/fwdy1_cat.nolyr.geojson';
    let data;
    try {
        const resp = await fetch(SPC_FIRE_URL, { cache: 'no-store' });
        if (!resp.ok) throw new Error('SPC fire ' + resp.status);
        data = await resp.json();
    } catch (e) {
        try {
            const proxy = 'https://corsproxy.io/?' + encodeURIComponent(SPC_FIRE_URL);
            const resp2 = await fetch(proxy, { cache: 'no-store' });
            if (!resp2.ok) throw new Error('Proxy ' + resp2.status);
            data = await resp2.json();
        } catch (e2) {
            console.warn('SPC fire weather unavailable:', e2.message);
            container.style.display = 'none';
            return;
        }
    }

    const features = data.features || [];
    let highestRisk = null;

    for (const feature of features) {
        const label = (feature.properties?.LABEL || feature.properties?.label || '').trim().toUpperCase();
        const riskIdx = _SPC_FIRE_ORDER.indexOf(label);
        if (riskIdx < 0) continue;
        if (_pointInSPCGeometry(lng, lat, feature.geometry)) {
            if (!highestRisk || riskIdx > _SPC_FIRE_ORDER.indexOf(highestRisk)) {
                highestRisk = label;
            }
        }
    }

    if (highestRisk) {
        renderSPCFireBanner(highestRisk);
    } else {
        container.style.display = 'none';
        container.innerHTML = '';
    }
}

function renderSPCFireBanner(risk) {
    const container = document.getElementById('fire-weather-banner-container');
    if (!container) return;
    const label = _SPC_FIRE_LABELS[risk] || risk;
    const cls = _SPC_FIRE_CLASS[risk] || 'elev';
    container.style.display = 'block';
    container.innerHTML = `
        <button type="button" class="spc-fire-banner spc-fire-${cls} fade-in"
                onclick="navigateToSPCMaps()"
                title="Tap to view SPC Fire Weather Outlook maps">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" style="flex-shrink:0;">
                <path d="M13.5 0.67s.74 2.65.74 4.8c0 2.06-1.35 3.73-3.41 3.73-2.07 0-3.63-1.67-3.63-3.73l.03-.36C5.21 7.51 4 10.62 4 14c0 4.42 3.58 8 8 8s8-3.58 8-8C20 8.61 17.41 3.8 13.5 0.67zM11.71 19c-1.78 0-3.22-1.4-3.22-3.14 0-1.62 1.05-2.76 2.81-3.12 1.77-.36 3.6-1.21 4.62-2.58.39 1.29.59 2.65.59 4.04 0 2.65-2.15 4.8-4.8 4.8z"/>
            </svg>
            <span><strong>${label} Fire Weather Risk</strong> – Day 1 SPC Fire Outlook. Tap to view maps.</span>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"
                 stroke-linecap="round" style="flex-shrink:0;">
                <polyline points="9 18 15 12 9 6"/>
            </svg>
        </button>
    `;
}

// ---- WPC Excessive Rainfall Outlook ----

const _WPC_RAIN_ORDER = ['MRGL', 'SLGT', 'MDT', 'HIGH'];
const _WPC_RAIN_LABELS = { MRGL: 'Marginal', SLGT: 'Slight', MDT: 'Moderate', HIGH: 'High' };
const _WPC_RAIN_CLASS = { MRGL: 'mrgl', SLGT: 'slgt', MDT: 'mdt', HIGH: 'high' };

async function loadAndRenderWPCRainfallOutlook(lat, lng) {
    const container = document.getElementById('wpc-rainfall-banner-container');
    if (!container) return;

    const WPC_ERO_URL = 'https://www.wpc.ncep.noaa.gov/qpf/94erain.geojson';
    let data;
    try {
        const resp = await fetch(WPC_ERO_URL, { cache: 'no-store' });
        if (!resp.ok) throw new Error('WPC ERO ' + resp.status);
        data = await resp.json();
    } catch (e) {
        try {
            const proxy = 'https://corsproxy.io/?' + encodeURIComponent(WPC_ERO_URL);
            const resp2 = await fetch(proxy, { cache: 'no-store' });
            if (!resp2.ok) throw new Error('Proxy ' + resp2.status);
            data = await resp2.json();
        } catch (e2) {
            console.warn('WPC rainfall outlook unavailable:', e2.message);
            container.style.display = 'none';
            return;
        }
    }

    const features = data.features || [];
    let highestRisk = null;

    for (const feature of features) {
        const label = (feature.properties?.LABEL || feature.properties?.label ||
                       feature.properties?.CAT || feature.properties?.cat || '').trim().toUpperCase();
        const riskIdx = _WPC_RAIN_ORDER.indexOf(label);
        if (riskIdx < 0) continue;
        if (_pointInSPCGeometry(lng, lat, feature.geometry)) {
            if (!highestRisk || riskIdx > _WPC_RAIN_ORDER.indexOf(highestRisk)) {
                highestRisk = label;
            }
        }
    }

    if (highestRisk) {
        renderWPCRainfallBanner(highestRisk);
    } else {
        container.style.display = 'none';
        container.innerHTML = '';
    }
}

function renderWPCRainfallBanner(risk) {
    const container = document.getElementById('wpc-rainfall-banner-container');
    if (!container) return;
    const label = _WPC_RAIN_LABELS[risk] || risk;
    const cls = _WPC_RAIN_CLASS[risk] || 'mrgl';
    container.style.display = 'block';
    container.innerHTML = `
        <button type="button" class="wpc-rain-banner wpc-rain-${cls} fade-in"
                onclick="navigateToSPCMaps()"
                title="Tap to view WPC Excessive Rainfall Outlook">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" style="flex-shrink:0;">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 14H9V8h2v8zm4 0h-2V8h2v8z"/>
                <path d="M7 17.5l1.5-4h-3zM16.5 17.5L18 13.5h-3zM12 19l1.5-4h-3z"/>
            </svg>
            <span><strong>${label} Excessive Rainfall Risk</strong> – Day 1 WPC Outlook. Tap to view maps.</span>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"
                 stroke-linecap="round" style="flex-shrink:0;">
                <polyline points="9 18 15 12 9 6"/>
            </svg>
        </button>
    `;
}

// ---- Hourly detail popup ----
let _hourlyData = [];
let _hourlyForecastDays = [];

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
    const condType = h.weatherCondition?.type || '';
    const tsMs = Date.parse(h.interval?.startTime || h.displayDateTime || '');
    const dayForHour = _dayForTimestamp(tsMs, _hourlyForecastDays);
    const hourNight = _isTimestampNight(tsMs, dayForHour);
    const iconSvg = WeatherIcons.fromText(condType, hourNight);

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
            <div class="hpop-icon" aria-hidden="true">${iconSvg}</div>
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
    _hourlyForecastDays = forecastDays || [];

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
    // Default all pollen elements to "None" before processing
    ['pollen-tree', 'pollen-grass', 'pollen-weed'].forEach(id => {
        const el = document.getElementById(id);
        if (el) { el.textContent = 'None'; el.className = 'level pollen-low'; }
    });

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
        if (!level) level = 'None';

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
