// ============================================
// CURRENT CONDITIONS PAGE LOGIC
// ============================================

(async function () {
    const lat = CONFIG.DEFAULT_LAT;
    const lng = CONFIG.DEFAULT_LNG;

    // Fetch all data in parallel
    const [currentResult, hourlyResult, dailyResult, aqiResult, pollenResult] = await Promise.allSettled([
        WeatherAPI.getCurrentConditions(lat, lng),
        WeatherAPI.getHourlyForecast(lat, lng, 24),
        WeatherAPI.getDailyForecast(lat, lng, 1),
        WeatherAPI.getAirQuality(lat, lng),
        WeatherAPI.getPollen(lat, lng)
    ]);

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

    // Visibility
    const visibility = data.visibility?.distance;
    if (visibility != null) {
        const visMi = (visibility * 0.000621371).toFixed(1); // meters to miles
        document.getElementById('visibility-value').innerHTML =
            `${visMi}<span class="unit"> mi</span>`;
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
    const dominant = index.dominantPollutant;
    if (dominant) {
        document.getElementById('aqi-detail').textContent = `Dominant pollutant: ${dominant}`;
    }
}

function renderPollen(data) {
    const days = data.dailyInfo || [];
    if (days.length === 0) return;

    const today = days[0];
    const types = today.pollenTypeInfo || [];

    types.forEach(pollen => {
        const type = (pollen.code || pollen.displayName || '').toLowerCase();
        const level = pollen.indexInfo?.category || pollen.indexInfo?.displayName || 'N/A';
        const value = pollen.indexInfo?.value;

        let elId = null;
        if (type.includes('tree')) elId = 'pollen-tree';
        else if (type.includes('grass')) elId = 'pollen-grass';
        else if (type.includes('weed')) elId = 'pollen-weed';

        if (elId) {
            const el = document.getElementById(elId);
            el.textContent = level;

            // Color coding
            const lowerLevel = level.toLowerCase();
            if (lowerLevel.includes('very') || lowerLevel.includes('high')) {
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
