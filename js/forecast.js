// ============================================
// 10-DAY FORECAST PAGE LOGIC
// ============================================

async function initForecastView(lat, lng) {
    if (lat == null || lng == null) {
        const loc = LocationManager.getCurrent();
        lat = loc.lat;
        lng = loc.lng;
    }

    try {
        const data = await WeatherAPI.getDailyForecast(lat, lng, 10);
        renderForecast(data);
    } catch (err) {
        document.getElementById('forecast-list').innerHTML =
            '<div class="error-message" style="margin:24px;">Unable to load forecast data<div class="error-hint">Check your Google Weather API key in js/config.js</div></div>';
        console.error('Forecast error:', err);
    }

    const tsEl = document.getElementById('last-updated');
    if (tsEl) tsEl.textContent =
        'Updated ' + new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

// Auto-run on standalone page
if (typeof _SPA_MODE === 'undefined') {
    (async function () {
        const loc = await LocationManager.init();
        const nameEl = document.getElementById('location-name');
        if (nameEl) nameEl.textContent = loc.name;
        await initForecastView(loc.lat, loc.lng);
    })();
}

// Store forecast data for detail view
let forecastDays = [];

function renderForecast(data) {
    const list = document.getElementById('forecast-list');
    forecastDays = data.forecastDays || [];

    if (forecastDays.length === 0) {
        list.innerHTML = '<div class="error-message" style="margin:24px;">No forecast data available</div>';
        return;
    }

    // Find global min/max for temperature bar scaling
    let globalMin = Infinity, globalMax = -Infinity;
    forecastDays.forEach(day => {
        const lo = day.minTemperature?.degrees;
        const hi = day.maxTemperature?.degrees;
        if (lo != null && lo < globalMin) globalMin = lo;
        if (hi != null && hi > globalMax) globalMax = hi;
    });
    const tempRange = globalMax - globalMin || 1;

    list.innerHTML = forecastDays.map((day, i) => {
        const dateStr = day.displayDate || day.interval?.startTime;
        const dayName = WeatherAPI.formatDayName(dateStr, true);
        const isToday = dayName === 'Today';

        const hi = day.maxTemperature?.degrees;
        const lo = day.minTemperature?.degrees;
        const condType = day.weatherCondition?.type || '';
        const condText = day.weatherCondition?.description?.text || condType.replace(/_/g, ' ').toLowerCase();
        const precipChance = day.precipitation?.probability;
        const iconSvg = WeatherIcons.fromText(condType);

        // Temperature bar positioning
        const barLeft = lo != null ? ((lo - globalMin) / tempRange) * 100 : 0;
        const barRight = hi != null ? ((hi - globalMin) / tempRange) * 100 : 100;
        const barWidth = barRight - barLeft;

        return `
            <div class="forecast-row fade-in" style="animation-delay:${i * 50}ms;cursor:pointer;" onclick="showDayDetail(${i})">
                <span class="day ${isToday ? 'today' : ''}">${dayName}</span>
                <div style="width:36px;height:36px;">${iconSvg}</div>
                <div class="temp-bar-wrapper">
                    <div class="temp-bar" style="left:${barLeft}%;width:${barWidth}%;"></div>
                </div>
                <span class="temp-lo">${lo != null ? WeatherAPI.formatTemp(lo) + '\u00B0' : '--'}</span>
                <span class="temp-hi">${hi != null ? WeatherAPI.formatTemp(hi) + '\u00B0' : '--'}</span>
                <span class="precip-chance">${precipChance != null && precipChance > 0
                    ? `<svg width="11" height="11" viewBox="0 0 24 24" fill="rgba(100,180,255,0.85)" style="vertical-align:middle;margin-right:2px;"><path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z"/></svg>${Math.round(precipChance)}%`
                    : ''}</span>
            </div>
        `;
    }).join('');
}

function showDayDetail(index) {
    const day = forecastDays[index];
    if (!day) return;

    const detail = document.getElementById('day-detail');
    detail.style.display = 'block';
    detail.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

    const dateStr = day.displayDate || day.interval?.startTime;
    const dayName = WeatherAPI.formatDayName(dateStr, false);
    // Parse date-only strings as local time to avoid timezone issues
    let date;
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
        const [y, m, d] = dateStr.split('-').map(Number);
        date = new Date(y, m - 1, d);
    } else {
        date = new Date(dateStr);
    }

    document.getElementById('detail-day-name').textContent = dayName;
    document.getElementById('detail-date').textContent =
        date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

    const condType = day.weatherCondition?.type || '';
    const condText = day.weatherCondition?.description?.text || condType.replace(/_/g, ' ');
    document.getElementById('detail-condition').textContent = condText;

    const hi = day.maxTemperature?.degrees;
    const lo = day.minTemperature?.degrees;
    document.getElementById('detail-temps').innerHTML =
        `<span style="color:var(--accent-warm);">${hi != null ? WeatherAPI.formatTemp(hi) + '\u00B0' : '--'}</span> / <span style="color:var(--accent-blue);">${lo != null ? WeatherAPI.formatTemp(lo) + '\u00B0' : '--'}</span>`;

    const iconSvg = WeatherIcons.fromText(condType);
    document.getElementById('detail-icon').innerHTML = iconSvg;

    // Precipitation
    const precipChance = day.precipitation?.probability;
    const precipAmount = day.precipitation?.qpf?.millimeters;
    let precipText = precipChance != null ? `${Math.round(precipChance)}% chance` : 'N/A';
    if (precipAmount != null && precipAmount > 0) {
        precipText += ` \u2022 ${(precipAmount / 25.4).toFixed(2)} in`;
    }
    document.getElementById('detail-precip').textContent = precipText;

    // Wind
    const windSpeed = day.wind?.speed?.value || day.maxWind?.speed?.value;
    const windDir = day.wind?.direction || day.maxWind?.direction;
    let windText = windSpeed != null ? `${Math.round(windSpeed)} mph` : 'N/A';
    if (windDir != null) windText += ` ${WeatherAPI.windDirection(windDir)}`;
    document.getElementById('detail-wind').textContent = windText;

    // Humidity
    const humidity = day.relativeHumidity || day.avgHumidity;
    document.getElementById('detail-humidity').textContent =
        humidity != null ? `${Math.round(humidity)}%` : 'N/A';

    // UV
    const uv = day.uvIndex || day.maxUvIndex;
    document.getElementById('detail-uv').textContent = uv != null ? uv : 'N/A';

    // Sunrise/Sunset
    const sunrise = day.sunrise;
    const sunset = day.sunset;
    document.getElementById('detail-sunrise').textContent =
        sunrise ? new Date(sunrise).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : 'N/A';
    document.getElementById('detail-sunset').textContent =
        sunset ? new Date(sunset).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : 'N/A';
}
