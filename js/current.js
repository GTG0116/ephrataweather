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
    const [currentResult, hourlyResult, dailyResult, aqiResult, pollenResult, alertsResult] = await Promise.allSettled([
        WeatherAPI.getCurrentConditions(lat, lng),
        WeatherAPI.getHourlyForecast(lat, lng, 24),
        WeatherAPI.getDailyForecast(lat, lng, 1),
        WeatherAPI.getAirQuality(lat, lng),
        WeatherAPI.getPollen(lat, lng),
        WeatherAPI.getAlerts(lat, lng)
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
        const onset = alert.onset || alert.effective || alert.alertInfo?.[0]?.onset;
        const expires = alert.expires || alert.alertInfo?.[0]?.expires;

        let alertClass = 'alert-advisory';
        if (severity === 'extreme' || severity === 'severe') alertClass = 'alert-extreme';
        else if (event.toLowerCase().includes('warning')) alertClass = 'alert-warning';
        else if (event.toLowerCase().includes('watch')) alertClass = 'alert-watch';

        let timeStr = '';
        if (onset) {
            const start = new Date(onset).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
            timeStr = `Effective: ${start}`;
        }
        if (expires) {
            const end = new Date(expires).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
            timeStr += timeStr ? ` - Expires: ${end}` : `Expires: ${end}`;
        }

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

    sendAlertNotifications(alerts);
}

function sendAlertNotifications(alerts) {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;

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

    localStorage.setItem(notifiedKey, JSON.stringify(notified.slice(-50)));
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
    const iconSvg = WeatherIcons.fromText(condType);
    document.getElementById('current-icon').innerHTML = iconSvg;

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
    _hourlyData = data.forecastHours || [];

    if (_hourlyData.length === 0) {
        strip.innerHTML = '<div class="error-message">No hourly data available</div>';
        return;
    }

    strip.innerHTML = _hourlyData.map((hour, i) => {
        const time = i === 0 ? 'Now' : WeatherAPI.formatTime(hour.interval?.startTime || hour.displayDateTime);
        const temp = WeatherAPI.formatTemp(hour.temperature?.degrees);
        const condType = hour.weatherCondition?.type || '';
        const iconSvg = WeatherIcons.fromText(condType, false);
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
