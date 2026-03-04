// ============================================
// CURRENT CONDITIONS PAGE LOGIC
// ============================================

(async function () {
        // Initialize location (geolocation on first visit, then stored)
    const loc = await LocationManager.init();
    const lat = loc.lat;
    const lng = loc.lng;
 
    // Update location display
    const nameEl = document.getElementById('location-name');
    if (nameEl) nameEl.textContent = loc.name;

    // Request notification permission early
    if ('Notification' in window && Notification.permission === 'default') {
        Notification.requestPermission();
    }

    // Fetch all data in parallel
    const [currentResult, hourlyResult, dailyResult, aqiResult, pollenResult, alertsResult, spcResult] = await Promise.allSettled([
        WeatherAPI.getCurrentConditions(lat, lng),
        WeatherAPI.getHourlyForecast(lat, lng, 24),
        WeatherAPI.getDailyForecast(lat, lng, 1),
        WeatherAPI.getAirQuality(lat, lng),
        WeatherAPI.getPollen(lat, lng),
        WeatherAPI.getAlerts(lat, lng),
        fetchSPCOutlook(lat, lng)
    ]);

    // --- Weather Alerts ---
    if (alertsResult.status === 'fulfilled') {
        renderAlerts(alertsResult.value);
    } else {
        console.warn('Alerts error:', alertsResult.reason);
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
        renderHourlyForecast(hourlyResult.value);
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

    // --- SPC Outlooks ---
    if (spcResult.status === 'fulfilled') {
        renderSPCOutlook(spcResult.value);
    } else {
        document.getElementById('spc-content').innerHTML =
            '<div style="padding:12px;color:var(--text-muted);font-size:0.85rem;">Unable to load SPC data</div>';
        console.error('SPC error:', spcResult.reason);
    }

    // Update timestamp
    document.getElementById('last-updated').textContent =
        'Updated ' + new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
})();

// ---- Alerts ----
function renderAlerts(data) {
    const container = document.getElementById('alerts-container');
    const alerts = data.alerts || [];

    if (alerts.length === 0) {
        container.style.display = 'none';
        return;
    }

     container.style.display = 'block';
    container.innerHTML = alerts.map((alert, i) => {
        const event = alert.event || alert.alertInfo?.[0]?.event || 'Weather Alert';
        const headline = alert.headline || alert.alertInfo?.[0]?.headline || event;
        const description = alert.description || alert.alertInfo?.[0]?.description || '';
        const severity = (alert.severity || alert.alertInfo?.[0]?.severity || '').toLowerCase();
        const urgency = (alert.urgency || '').toLowerCase();
        const onset = alert.onset || alert.effective || alert.alertInfo?.[0]?.onset;
        const expires = alert.expires || alert.alertInfo?.[0]?.expires;
        const description = alert.description || alert.alertInfo?.[0]?.description || '';
        const severity = (alert.severity || alert.alertInfo?.[0]?.severity || '').toLowerCase();
        const onset = alert.onset || alert.effective || alert.alertInfo?.[0]?.onset;
        const expires = alert.expires || alert.alertInfo?.[0]?.expires;

        // Determine alert class
        let alertClass = 'alert-advisory';
        if (severity === 'extreme' || severity === 'severe') alertClass = 'alert-extreme';
        else if (event.toLowerCase().includes('warning')) alertClass = 'alert-warning';
        else if (event.toLowerCase().includes('watch')) alertClass = 'alert-watch';

        // Format times
        let timeStr = '';
        if (onset) {
            const start = new Date(onset).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
            timeStr = `Effective: ${start}`;
        }
        if (expires) {
            const end = new Date(expires).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
            timeStr += timeStr ? ` - Expires: ${end}` : `Expires: ${end}`;
        }

        // Alert icon SVG
        const iconSvg = `<svg class="alert-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
            <line x1="12" y1="9" x2="12" y2="13"/>
            <line x1="12" y1="17" x2="12.01" y2="17"/>
        </svg>`;

        return `
            <div class="alert-banner ${alertClass} fade-in" style="animation-delay:${i * 100}ms" onclick="this.classList.toggle('expanded')">
                <div class="alert-header">
                    ${iconSvg}
                    <span class="alert-title">${headline}</span>
                </div>
                ${description ? `<div class="alert-detail">${description.substring(0, 150)}${description.length > 150 ? '...' : ''}</div>` : ''}
                ${timeStr ? `<div class="alert-time">${timeStr}</div>` : ''}
                ${description.length > 150 ? `<div class="alert-expanded">${description}</div>` : ''}
            </div>
        `;
    }).join('');

    // Send browser notifications for alerts
    sendAlertNotifications(alerts);
}

function sendAlertNotifications(alerts) {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;

    // Track which alerts we've already notified about
    const notifiedKey = 'ephrata_notified_alerts';
    const notified = JSON.parse(localStorage.getItem(notifiedKey) || '[]');

    alerts.forEach(alert => {
        const event = alert.event || alert.alertInfo?.[0]?.event || 'Weather Alert';
        const headline = alert.headline || alert.alertInfo?.[0]?.headline || event;
        const id = alert.id || headline;

        if (!notified.includes(id)) {
             new Notification('Weather Alert', {
                body: headline,
                icon: 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="%23FF9800"><path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z"/></svg>'),
                tag: id,
                requireInteraction: true
            });
            notified.push(id);
        }
    });

    // Keep only recent notifications (last 50)
    localStorage.setItem(notifiedKey, JSON.stringify(notified.slice(-50)));
}

// ---- SPC Outlooks ----
async function fetchSPCOutlook(lat, lng) {
    // Fetch SPC Day 1 Categorical Outlook using their GIS endpoint
    const url = `https://www.spc.noaa.gov/products/outlook/day1otlk_cat.nolyr.geojson`;
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`SPC API ${resp.status}`);
    const geojson = await resp.json();

    // Find which polygon (if any) contains our point
    let maxRisk = null;
    const riskLevels = {
        'TSTM': { rank: 1, label: 'Thunderstorm', color: 'tstm' },
        'MRGL': { rank: 2, label: 'Marginal', color: 'mrgl' },
        'SLGT': { rank: 3, label: 'Slight', color: 'slgt' },
        'ENH':  { rank: 4, label: 'Enhanced', color: 'enh' },
        'MDT':  { rank: 5, label: 'Moderate', color: 'mod' },
        'HIGH': { rank: 6, label: 'High', color: 'high' }
    };

    if (geojson.features) {
        for (const feature of geojson.features) {
            const label = (feature.properties?.LABEL || feature.properties?.LABEL2 || '').toUpperCase();
            const risk = riskLevels[label];
            if (risk && feature.geometry) {
                if (pointInGeoJSON(lng, lat, feature.geometry)) {
                    if (!maxRisk || risk.rank > maxRisk.rank) {
                        maxRisk = { ...risk, raw: label };
                    }
                }
            }
        }
    }

    // Also fetch Day 1 tornado, wind, hail probabilities
    const [torResp, windResp, hailResp] = await Promise.allSettled([
        fetch('https://www.spc.noaa.gov/products/outlook/day1otlk_torn.nolyr.geojson').then(r => r.ok ? r.json() : null),
        fetch('https://www.spc.noaa.gov/products/outlook/day1otlk_wind.nolyr.geojson').then(r => r.ok ? r.json() : null),
        fetch('https://www.spc.noaa.gov/products/outlook/day1otlk_hail.nolyr.geojson').then(r => r.ok ? r.json() : null)
    ]);

    const probabilities = {};
    [['tornado', torResp], ['wind', windResp], ['hail', hailResp]].forEach(([type, result]) => {
        if (result.status !== 'fulfilled' || !result.value?.features) return;
        let maxProb = 0;
        for (const feature of result.value.features) {
            const label = feature.properties?.LABEL || feature.properties?.LABEL2 || '0';
            const prob = parseInt(label) || 0;
            if (prob > 0 && feature.geometry && pointInGeoJSON(lng, lat, feature.geometry)) {
                maxProb = Math.max(maxProb, prob);
            }
        }
        if (maxProb > 0) probabilities[type] = maxProb;
    });

    return { categorical: maxRisk, probabilities };
}

// Point-in-polygon for GeoJSON geometries
function pointInGeoJSON(x, y, geometry) {
    if (geometry.type === 'Polygon') {
        return pointInPolygon(x, y, geometry.coordinates[0]);
    } else if (geometry.type === 'MultiPolygon') {
        return geometry.coordinates.some(poly => pointInPolygon(x, y, poly[0]));
    }
    return false;
}

function pointInPolygon(x, y, ring) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const xi = ring[i][0], yi = ring[i][1];
        const xj = ring[j][0], yj = ring[j][1];
        if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) {
            inside = !inside;
        }
    }
    return inside;
}

function renderSPCOutlook(data) {
    const content = document.getElementById('spc-content');
    const cat = data.categorical;
    const probs = data.probabilities || {};

    let html = '<div class="spc-outlook-grid">';

    // Categorical risk
    html += `<div class="spc-outlook-item ${cat ? 'spc-' + cat.color : 'spc-general'}">
        <div class="spc-label">Categorical</div>
        <div class="spc-level">${cat ? cat.label : 'General'}</div>
        <div class="spc-sublabel">${cat ? 'Risk Level ' + cat.rank + '/6' : 'No severe risk'}</div>
    </div>`;

    // Tornado probability
    html += `<div class="spc-outlook-item ${probs.tornado ? (probs.tornado >= 10 ? 'spc-mod' : 'spc-slgt') : 'spc-general'}">
        <div class="spc-label">Tornado</div>
        <div class="spc-level">${probs.tornado ? probs.tornado + '%' : '--'}</div>
        <div class="spc-sublabel">Probability</div>
    </div>`;

    // Wind probability
    html += `<div class="spc-outlook-item ${probs.wind ? (probs.wind >= 30 ? 'spc-enh' : 'spc-slgt') : 'spc-general'}">
        <div class="spc-label">Wind</div>
        <div class="spc-level">${probs.wind ? probs.wind + '%' : '--'}</div>
        <div class="spc-sublabel">Probability</div>
    </div>`;

    // Hail probability
    html += `<div class="spc-outlook-item ${probs.hail ? (probs.hail >= 30 ? 'spc-enh' : 'spc-slgt') : 'spc-general'}">
        <div class="spc-label">Hail</div>
        <div class="spc-level">${probs.hail ? probs.hail + '%' : '--'}</div>
        <div class="spc-sublabel">Probability</div>
    </div>`;

    html += '</div>';
    content.innerHTML = html;
}

// ---- Existing render functions ----

function renderCurrentConditions(data, dailyData) {
    // Temperature
    const temp = data.temperature?.degrees;
    document.getElementById('current-temp').innerHTML =
        `${WeatherAPI.formatTemp(temp)}<span class="unit">&deg;F</span>`;

    // Condition text
    const condition = data.weatherCondition?.description?.text || data.weatherCondition?.type?.replace(/_/g, ' ') || 'Unknown';
    document.getElementById('current-condition').textContent = condition;

    // Feels like
    const feelsLike = data.feelsLikeTemperature?.degrees;
    if (feelsLike != null) {
        document.getElementById('feels-like').textContent = `Feels like ${WeatherAPI.formatTemp(feelsLike)}\u00B0`;
    }

    // Hi/Lo from daily forecast
    if (dailyData && dailyData.forecastDays && dailyData.forecastDays.length > 0) {
        const day = dailyData.forecastDays[0];
        const hi = day.maxTemperature?.degrees;
        const lo = day.minTemperature?.degrees;
        if (hi != null && lo != null) {
            document.getElementById('hi-lo').innerHTML =
                `<span class="hi">H:${WeatherAPI.formatTemp(hi)}\u00B0</span> &nbsp; <span class="lo">L:${WeatherAPI.formatTemp(lo)}\u00B0</span>`;
        }
    }

    // Icon
    const condType = data.weatherCondition?.type || condition;
    const iconSvg = WeatherIcons.fromText(condType);
    document.getElementById('current-icon').innerHTML = iconSvg;

    // Detail cards
    // Wind
    const windSpeed = data.wind?.speed?.value;
    const windGust = data.wind?.gust?.value;
    const windDir = data.wind?.direction;
    if (windSpeed != null) {
        document.getElementById('wind-speed').innerHTML =
            `${Math.round(windSpeed)}<span class="unit"> mph</span>`;
        let detail = windDir != null ? WeatherAPI.windDirection(windDir) : '';
        if (windGust != null) detail += ` \u2022 Gusts ${Math.round(windGust)} mph`;
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

function renderHourlyForecast(data) {
    const strip = document.getElementById('hourly-strip');
    const hours = data.forecastHours || [];

    if (hours.length === 0) {
        strip.innerHTML = '<div class="error-message">No hourly data available</div>';
        return;
    }

    strip.innerHTML = hours.map((hour, i) => {
        const time = i === 0 ? 'Now' : WeatherAPI.formatTime(hour.interval?.startTime || hour.displayDateTime);
        const temp = WeatherAPI.formatTemp(hour.temperature?.degrees);
        const condType = hour.weatherCondition?.type || '';
        const iconSvg = WeatherIcons.fromText(condType, false);
        const precip = hour.precipitation?.probability;
        const precipStr = precip != null && precip > 0 ? `${Math.round(precip)}%` : '';

        return `
            <div class="hourly-item ${i === 0 ? 'now' : ''} fade-in" style="animation-delay:${i * 30}ms">
                <span class="time">${time}</span>
                <div style="width:36px;height:36px;">${iconSvg}</div>
                <span class="temp">${temp}&deg;</span>
                ${precipStr ? `<span class="precip">${precipStr}</span>` : ''}
            </div>
        `;
    }).join('');
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

    // Position marker (AQI 0-500 scale)
    const pct = Math.min(100, (aqi / 500) * 100);
    document.getElementById('aqi-marker').style.left = pct + '%';

    // Dominant pollutant
    const detail = document.getElementById('aqi-detail');
    const dominant = index.dominantPollutant;
}

function renderPollen(data) {
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

            // Color coding
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
