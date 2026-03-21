// ============================================
// 10-DAY FORECAST PAGE LOGIC
// ============================================

async function initForecastView(lat, lng) {
    if (lat == null || lng == null) {
        const loc = LocationManager.getCurrent();
        lat = loc.lat;
        lng = loc.lng;
    }

    _forecastLat = lat;
    _forecastLng = lng;
    _spcRiskCache = {};
    _openDayDetailIndex = -1;

    const _src = WeatherAPI.getDataSource();
    try {
        let data;
        if (_src === 'nws') data = await WeatherAPI.getNWSDailyForecast(lat, lng, 10);
        else if (_src === 'open-meteo') data = await WeatherAPI.getOpenMeteoDailyForecast(lat, lng, 10);
        else if (_src === 'owm') data = await WeatherAPI.getOWMDailyForecast(lat, lng, 7);
        else data = await WeatherAPI.getDailyForecast(lat, lng, 10);
        renderForecast(data);
        // Fetch SPC risk data in the background (non-blocking)
        _loadSPCForecastData(lat, lng);
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

// ---- Forecast Charts ----
let _activeForecastChart = 'temp';

function switchForecastChart(metric) {
    _activeForecastChart = metric;
    document.querySelectorAll('.chart-tab[data-fmetric]').forEach((btn) =>
        btn.classList.toggle('active', btn.dataset.fmetric === metric));
    _drawForecastChart(metric, forecastDays);
}

function renderForecastCharts(days) {
    const container = document.getElementById('forecast-charts-container');
    if (!container || !days.length) return;
    container.style.display = 'block';
    _drawForecastChart(_activeForecastChart, days);
}

function _drawForecastChart(metric, days) {
    const svg = document.getElementById('forecast-chart-svg');
    if (!svg || !days.length) return;

    const W = svg.clientWidth || 700;
    const isTemp = metric === 'temp';
    const isWind = metric === 'wind';
    const H = isTemp ? 180 : 140;
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.setAttribute('height', H);

    const PAD_L = 44, PAD_R = 16, PAD_T = 20, PAD_B = 40;
    const plotW = W - PAD_L - PAD_R;
    const plotH = H - PAD_T - PAD_B;
    const n = days.length;
    const barW = plotW / n;

    if (isWind) {
        // Wind speed line chart
        const vals = days.map(d => d.maxWind?.speed?.value ?? null);
        const filtered = vals.filter(v => v != null);
        if (filtered.length < 2) { svg.innerHTML = ''; return; }

        let minV = Math.min(...filtered);
        let maxV = Math.max(...filtered);
        const spread = maxV - minV || 1;
        minV = Math.max(0, minV - spread * 0.1);
        maxV += spread * 0.15;

        const xOf = (i) => PAD_L + (i / (n - 1)) * plotW;
        const yOf = (v) => PAD_T + plotH - ((v - minV) / (maxV - minV)) * plotH;

        // Y-axis grid + labels
        let yLabels = '';
        for (let t = 0; t <= 4; t++) {
            const v = minV + (maxV - minV) * (t / 4);
            const y = yOf(v);
            yLabels += `<line x1="${PAD_L}" y1="${y}" x2="${PAD_L + plotW}" y2="${y}" stroke="rgba(255,255,255,0.06)" stroke-width="1"/>
                        <text x="${PAD_L - 5}" y="${y + 4}" text-anchor="end" fill="rgba(255,255,255,0.45)" font-size="9.5">${Math.round(v)}</text>`;
        }

        // X-axis labels
        let xLabels = '';
        days.forEach((d, i) => {
            const x = xOf(i);
            const dateStr = d.displayDate || d.interval?.startTime;
            const label = WeatherAPI.formatDayName(dateStr, true).slice(0, 3);
            xLabels += `<text x="${x}" y="${H - 6}" text-anchor="middle" fill="rgba(255,255,255,0.45)" font-size="9.5">${label}</text>`;
        });

        // Build area + line path
        const points = vals.map((v, i) => v != null ? { x: xOf(i), y: yOf(v) } : null).filter(Boolean);
        let linePath = '', areaPath = '';
        points.forEach((p, i) => {
            if (i === 0) { linePath += `M${p.x},${p.y}`; areaPath += `M${p.x},${PAD_T + plotH} L${p.x},${p.y}`; }
            else { linePath += ` L${p.x},${p.y}`; areaPath += ` L${p.x},${p.y}`; }
        });
        if (points.length) areaPath += ` L${points[points.length-1].x},${PAD_T + plotH} Z`;

        // Dots + labels
        let dots = '';
        days.forEach((d, i) => {
            const v = vals[i];
            if (v != null) {
                const anchor = i === 0 ? 'start' : (i === n - 1 ? 'end' : 'middle');
                dots += `<circle cx="${xOf(i)}" cy="${yOf(v)}" r="3" fill="#42A5F5" stroke="rgba(15,20,40,0.8)" stroke-width="1.5"/>
                         <text x="${xOf(i)}" y="${yOf(v) - 7}" text-anchor="${anchor}" fill="#42A5F5" font-size="8.5" font-weight="500">${Math.round(v)}</text>`;
            }
        });

        svg.innerHTML = `
            <defs>
                <linearGradient id="fg_wind" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stop-color="#42A5F5" stop-opacity="0.3"/>
                    <stop offset="100%" stop-color="#42A5F5" stop-opacity="0"/>
                </linearGradient>
            </defs>
            ${yLabels}${xLabels}
            <path d="${areaPath}" fill="url(#fg_wind)"/>
            <path d="${linePath}" fill="none" stroke="#42A5F5" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
            ${dots}
            <text x="${PAD_L - 5}" y="${PAD_T - 6}" text-anchor="end" fill="rgba(255,255,255,0.3)" font-size="8">mph</text>
        `;
        return;
    }

    if (isTemp) {
        // Temperature band chart: shaded area between lo and hi, line for each
        const hiVals = days.map((d) => d.maxTemperature?.degrees ?? null);
        const loVals = days.map((d) => d.minTemperature?.degrees ?? null);
        const allVals = [...hiVals, ...loVals].filter((v) => v != null);
        if (allVals.length < 2) { svg.innerHTML = ''; return; }

        let minV = Math.min(...allVals);
        let maxV = Math.max(...allVals);
        const spread = maxV - minV || 1;
        minV -= spread * 0.12;
        maxV += spread * 0.12;

        const xOf = (i) => PAD_L + (i / (n - 1)) * plotW;
        const yOf = (v) => PAD_T + plotH - ((v - minV) / (maxV - minV)) * plotH;

        // Y-axis grid + labels
        let yLabels = '';
        for (let t = 0; t <= 4; t++) {
            const v = minV + (maxV - minV) * (t / 4);
            const y = yOf(v);
            yLabels += `<line x1="${PAD_L}" y1="${y}" x2="${PAD_L + plotW}" y2="${y}" stroke="rgba(255,255,255,0.06)" stroke-width="1"/>
                        <text x="${PAD_L - 5}" y="${y + 4}" text-anchor="end" fill="rgba(255,255,255,0.45)" font-size="9.5">${Math.round(v)}\u00B0</text>`;
        }

        // Build band area path (hi forward, lo backward)
        const hiPoints = days.map((d, i) => ({ x: xOf(i), y: d.maxTemperature?.degrees != null ? yOf(d.maxTemperature.degrees) : null })).filter(p => p.y != null);
        const loPoints = days.map((d, i) => ({ x: xOf(i), y: d.minTemperature?.degrees != null ? yOf(d.minTemperature.degrees) : null })).filter(p => p.y != null);

        let bandPath = '', hiLine = '', loLine = '';
        hiPoints.forEach((p, i) => {
            hiLine += (i === 0 ? `M${p.x},${p.y}` : ` L${p.x},${p.y}`);
            bandPath += (i === 0 ? `M${p.x},${p.y}` : ` L${p.x},${p.y}`);
        });
        [...loPoints].reverse().forEach((p, i) => {
            bandPath += ` L${p.x},${p.y}`;
            if (i === 0) loLine = `M${p.x},${p.y}`;
            else loLine += ` L${p.x},${p.y}`;
        });
        // Reverse loLine so it reads left-to-right
        const loLineFixed = loPoints.map((p, i) => (i === 0 ? `M${p.x},${p.y}` : ` L${p.x},${p.y}`)).join('');
        bandPath += ' Z';

        // X-axis labels
        let xLabels = '';
        days.forEach((d, i) => {
            const x = xOf(i);
            const dateStr = d.displayDate || d.interval?.startTime;
            const label = WeatherAPI.formatDayName(dateStr, true).slice(0, 3);
            xLabels += `<text x="${x}" y="${H - 6}" text-anchor="middle" fill="rgba(255,255,255,0.45)" font-size="9.5">${label}</text>`;
        });

        // Dots on hi/lo lines at each day
        let dots = '';
        days.forEach((d, i) => {
            const hi = d.maxTemperature?.degrees;
            const lo = d.minTemperature?.degrees;
            const anchor = i === 0 ? 'start' : (i === n - 1 ? 'end' : 'middle');
            if (hi != null) {
                dots += `<circle cx="${xOf(i)}" cy="${yOf(hi)}" r="3" fill="#FF7043" stroke="rgba(15,20,40,0.8)" stroke-width="1.5"/>
                         <text x="${xOf(i)}" y="${yOf(hi) - 7}" text-anchor="${anchor}" fill="#FF7043" font-size="8.5" font-weight="500">${Math.round(hi)}\u00B0</text>`;
            }
            if (lo != null) {
                dots += `<circle cx="${xOf(i)}" cy="${yOf(lo)}" r="3" fill="#42A5F5" stroke="rgba(15,20,40,0.8)" stroke-width="1.5"/>
                         <text x="${xOf(i)}" y="${yOf(lo) + 15}" text-anchor="${anchor}" fill="#42A5F5" font-size="8.5" font-weight="500">${Math.round(lo)}\u00B0</text>`;
            }
        });

        svg.innerHTML = `
            <defs>
                <linearGradient id="fg_band" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stop-color="#FF7043" stop-opacity="0.25"/>
                    <stop offset="100%" stop-color="#42A5F5" stop-opacity="0.25"/>
                </linearGradient>
            </defs>
            ${yLabels}
            ${xLabels}
            <path d="${bandPath}" fill="url(#fg_band)"/>
            <path d="${hiLine}" fill="none" stroke="#FF7043" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
            <path d="${loLineFixed}" fill="none" stroke="#42A5F5" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
            ${dots}
        `;
    } else {
        // Precipitation chance — vertical bar chart
        const xOf = (i) => PAD_L + i * barW + barW * 0.15;
        const bw = barW * 0.7;
        const yOf = (v) => PAD_T + plotH - (v / 100) * plotH;

        let yLabels = '';
        [0, 25, 50, 75, 100].forEach((v) => {
            const y = yOf(v);
            yLabels += `<line x1="${PAD_L}" y1="${y}" x2="${PAD_L + plotW}" y2="${y}" stroke="rgba(255,255,255,0.06)" stroke-width="1"/>
                        <text x="${PAD_L - 5}" y="${y + 4}" text-anchor="end" fill="rgba(255,255,255,0.45)" font-size="9.5">${v}%</text>`;
        });

        let bars = '', xLabels = '';
        days.forEach((d, i) => {
            const chance = d.precipitation?.probability ?? 0;
            const x = xOf(i);
            const y = yOf(chance);
            const bh = (chance / 100) * plotH;
            const alpha = 0.2 + (chance / 100) * 0.6;
            bars += `<rect x="${x}" y="${y}" width="${bw}" height="${bh}"
                          fill="rgba(38,198,218,${alpha.toFixed(2)})"
                          rx="3" ry="3"/>`;
            if (chance > 0) {
                bars += `<text x="${x + bw / 2}" y="${y - 5}" text-anchor="middle" fill="rgba(38,198,218,0.9)" font-size="8.5" font-weight="500">${Math.round(chance)}%</text>`;
            }
            const dateStr = d.displayDate || d.interval?.startTime;
            const label = WeatherAPI.formatDayName(dateStr, true).slice(0, 3);
            xLabels += `<text x="${x + bw / 2}" y="${H - 6}" text-anchor="middle" fill="rgba(255,255,255,0.45)" font-size="9.5">${label}</text>`;
        });

        svg.innerHTML = `${yLabels}${bars}${xLabels}`;
    }
}

function renderForecast(data) {
    const list = document.getElementById('forecast-list');
    forecastDays = data.forecastDays || [];

    // Update the forecast section title to reflect how many days are available
    const isNWS = WeatherAPI.getDataSource() === 'nws';
    const titleEl = document.getElementById('forecast-section-title');
    if (titleEl) {
        titleEl.textContent = isNWS ? '7-Day Forecast' : '10-Day Forecast';
    }
    // Also update the SPA page title
    const titles = { forecast: isNWS ? '7-Day Forecast' : '10-Day Forecast' };
    if (document.title.includes('Forecast')) {
        document.title = titles.forecast + ' – Ephrata Weather';
    }

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
                <span class="day ${isToday ? 'today' : ''}">${dayName}<span id="spc-badge-${i}" style="display:none;"></span></span>
                <div style="width:32px;height:32px;">${iconSvg}</div>
                <div class="temp-bar-col">
                    <div class="temp-bar-wrapper">
                        <div class="temp-bar" style="left:${barLeft}%;width:${barWidth}%;"></div>
                    </div>
                    <span class="condition-brief">${condText}</span>
                </div>
                <span class="temp-lo">${lo != null ? WeatherAPI.formatTemp(lo) + '\u00B0' : '--'}</span>
                <span class="temp-hi">${hi != null ? WeatherAPI.formatTemp(hi) + '\u00B0' : '--'}</span>
                <span class="precip-chance">${precipChance != null && precipChance > 0
                    ? `<svg width="10" height="10" viewBox="0 0 24 24" fill="rgba(100,180,255,0.85)" style="vertical-align:middle;margin-right:1px;"><path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z"/></svg>${Math.round(precipChance)}%`
                    : ''}</span>
            </div>
        `;
    }).join('');

    // Render charts below the list
    renderForecastCharts(forecastDays);
}


function _buildDayDescription(day) {
    const cond = day.weatherCondition?.description?.text
        || (day.weatherCondition?.type || '').replace(/_/g, ' ').toLowerCase()
        || 'conditions';

    const hi = day.maxTemperature?.degrees;
    const lo = day.minTemperature?.degrees;
    const tempText = hi != null && lo != null
        ? `High near ${WeatherAPI.formatTemp(hi)}° and low around ${WeatherAPI.formatTemp(lo)}°.`
        : hi != null
            ? `High near ${WeatherAPI.formatTemp(hi)}°.`
            : lo != null
                ? `Low around ${WeatherAPI.formatTemp(lo)}°.`
                : 'Temperature details are limited for this period.';

    const precipChance = day.precipitation?.probability;
    const precipAmount = day.precipitation?.qpf?.millimeters;
    let precipText = '';
    if (precipChance != null) {
        precipText = ` Precipitation chance is around ${Math.round(precipChance)}%.`;
        if (precipAmount != null && precipAmount > 0) precipText += ` Expected rainfall is about ${(precipAmount / 25.4).toFixed(2)} inches.`;
    }

    const windSpeed = day.wind?.speed?.value || day.maxWind?.speed?.value;
    const windDir = day.wind?.direction || day.maxWind?.direction;
    const windText = windSpeed != null
        ? ` Winds near ${Math.round(windSpeed)} mph${windDir != null ? ` from the ${WeatherAPI.windDirection(windDir)}` : ''}.`
        : '';

    return `${cond.charAt(0).toUpperCase() + cond.slice(1)}. ${tempText}${precipText}${windText}`.replace(/\s+/g, ' ').trim();
}

function closeDayDetail() {
    const detail = document.getElementById('day-detail');
    if (detail) detail.style.display = 'none';
    _openDayDetailIndex = -1;
}

function showDayDetail(index) {
    const day = forecastDays[index];
    if (!day) return;

    _openDayDetailIndex = index;

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
    const descriptionEl = document.getElementById('detail-description');
    if (descriptionEl) descriptionEl.textContent = _buildDayDescription(day);

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

    // Humidity — hide when NWS (data is null)
    const humidity = day.relativeHumidity || day.avgHumidity;
    const humidityRow = document.getElementById('detail-humidity-row');
    if (humidityRow) humidityRow.style.display = humidity != null ? '' : 'none';
    document.getElementById('detail-humidity').textContent =
        humidity != null ? `${Math.round(humidity)}%` : 'N/A';

    // UV — hide when NWS (always null)
    const uv = day.uvIndex || day.maxUvIndex;
    const uvRow = document.getElementById('detail-uv-row');
    if (uvRow) uvRow.style.display = uv != null ? '' : 'none';
    document.getElementById('detail-uv').textContent = uv != null ? uv : 'N/A';

    // Sunrise/Sunset — hide when NWS (always null)
    const sunrise = day.sunrise;
    const sunset = day.sunset;
    const sunriseRow = document.getElementById('detail-sunrise-row');
    const sunsetRow = document.getElementById('detail-sunset-row');
    if (sunriseRow) sunriseRow.style.display = sunrise ? '' : 'none';
    if (sunsetRow) sunsetRow.style.display = sunset ? '' : 'none';
    document.getElementById('detail-sunrise').textContent =
        sunrise ? new Date(sunrise).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : 'N/A';
    document.getElementById('detail-sunset').textContent =
        sunset ? new Date(sunset).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : 'N/A';

    // Severe weather section (SPC outlook)
    _refreshDayDetailSPCInfo();
}

// ============================================================
// SPC SEVERE WEATHER OUTLOOK INTEGRATION
// ============================================================

let _forecastLat = null;
let _forecastLng = null;
let _spcRiskCache = {};   // keyed by SPC day number (1, 2, 3) → risk object
let _openDayDetailIndex = -1;

const _SPC_FORECAST_URLS = {
    1: {
        cat:  'https://www.spc.noaa.gov/products/outlook/day1otlk_cat.nolyr.geojson',
        torn: 'https://www.spc.noaa.gov/products/outlook/day1otlk_torn.nolyr.geojson',
        wind: 'https://www.spc.noaa.gov/products/outlook/day1otlk_wind.nolyr.geojson',
        hail: 'https://www.spc.noaa.gov/products/outlook/day1otlk_hail.nolyr.geojson',
    },
    2: {
        cat:  'https://www.spc.noaa.gov/products/outlook/day2otlk_cat.nolyr.geojson',
        torn: 'https://www.spc.noaa.gov/products/outlook/day2otlk_torn.nolyr.geojson',
        wind: 'https://www.spc.noaa.gov/products/outlook/day2otlk_wind.nolyr.geojson',
        hail: 'https://www.spc.noaa.gov/products/outlook/day2otlk_hail.nolyr.geojson',
    },
    3: {
        cat: 'https://www.spc.noaa.gov/products/outlook/day3otlk_cat.nolyr.geojson',
    },
};

// Rank of each categorical label (higher = more severe)
const _CAT_RANK = { TSTM: 1, MRGL: 2, SLGT: 3, ENH: 4, MDT: 5, HIGH: 6 };

// Plain-language wording per risk category
const _CAT_WORDING = {
    MRGL: 'Isolated',
    SLGT: 'A few scattered',
    ENH:  'Scattered to numerous',
    MDT:  'Numerous',
    HIGH: 'An outbreak of',
};

// Badge/alert colors per risk category
const _CAT_COLORS = {
    MRGL: { bg: 'rgba(102,204,102,0.18)', border: '#44BB44', text: '#7dcc7d' },
    SLGT: { bg: 'rgba(255,224,102,0.18)', border: '#DDBB00', text: '#e8cc55' },
    ENH:  { bg: 'rgba(255,160,64,0.18)',  border: '#CC7700', text: '#f0a040' },
    MDT:  { bg: 'rgba(255,96,96,0.18)',   border: '#CC2222', text: '#f07070' },
    HIGH: { bg: 'rgba(255,64,255,0.18)',  border: '#CC00CC', text: '#f070f0' },
};

async function _fetchSPCGeoJSONForForecast(url) {
    try {
        const r = await fetch(url, { mode: 'cors', cache: 'no-store' });
        if (r.ok) return r.json();
        throw new Error('HTTP ' + r.status);
    } catch (_) {
        const proxy = 'https://corsproxy.io/?' + encodeURIComponent(url);
        const r = await fetch(proxy, { cache: 'no-store' });
        if (!r.ok) throw new Error('Proxy HTTP ' + r.status);
        return r.json();
    }
}

// Ray-casting point-in-polygon for a single ring of [lng, lat] pairs
function _spcPointInRing(lng, lat, ring) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [xi, yi] = ring[i], [xj, yj] = ring[j];
        const cross = ((yi > lat) !== (yj > lat)) &&
            (lng < (xj - xi) * (lat - yi) / (yj - yi) + xi);
        if (cross) inside = !inside;
    }
    return inside;
}

function _spcPointInFeature(lng, lat, feature) {
    const geom = feature.geometry;
    if (!geom) return false;
    if (geom.type === 'Polygon')
        return _spcPointInRing(lng, lat, geom.coordinates[0]);
    if (geom.type === 'MultiPolygon')
        return geom.coordinates.some(poly => _spcPointInRing(lng, lat, poly[0]));
    return false;
}

// Find the highest categorical risk label at a location
function _highestCatRisk(lat, lng, geojson) {
    if (!geojson?.features) return null;
    let highest = null;
    for (const feature of geojson.features) {
        const label = String(feature.properties?.LABEL ?? '').toUpperCase();
        if (!_CAT_RANK[label] || label === 'TSTM') continue;
        if (!_spcPointInFeature(lng, lat, feature)) continue;
        if (!highest || _CAT_RANK[label] > _CAT_RANK[highest]) highest = label;
    }
    return highest;
}

// Check if a location is inside any polygon in a hazard (torn/wind/hail) GeoJSON
function _hasHazardAtLocation(lat, lng, geojson) {
    if (!geojson?.features) return false;
    return geojson.features.some(f => _spcPointInFeature(lng, lat, f));
}

// Return the highest CIG level (1, 2, or 3) at a location from the categorical GeoJSON, or 0 if none
function _getCigLevel(lat, lng, geojson) {
    if (!geojson?.features) return 0;
    let highest = 0;
    for (const feature of geojson.features) {
        const label = String(feature.properties?.LABEL ?? '').toUpperCase();
        const m = label.match(/^CIG(\d)$/);
        if (!m) continue;
        const level = parseInt(m[1], 10);
        if (level > highest && _spcPointInFeature(lng, lat, feature)) highest = level;
    }
    return highest;
}

// Fetch SPC data for one SPC day and return the risk object
async function _fetchSPCRisk(lat, lng, spcDay) {
    const urls = _SPC_FORECAST_URLS[spcDay];
    if (!urls) return null;

    let catData;
    try { catData = await _fetchSPCGeoJSONForForecast(urls.cat); }
    catch (_) { return null; }

    const catRisk = _highestCatRisk(lat, lng, catData);
    const cigLevel = _getCigLevel(lat, lng, catData);
    let hasTorn = false, hasWind = false, hasHail = false;

    // Only check specific hazards for Days 1-2 with MRGL+ risk
    if (catRisk && _CAT_RANK[catRisk] >= _CAT_RANK.MRGL && urls.torn && urls.wind && urls.hail) {
        const [tornData, windData, hailData] = await Promise.all([
            _fetchSPCGeoJSONForForecast(urls.torn).catch(() => null),
            _fetchSPCGeoJSONForForecast(urls.wind).catch(() => null),
            _fetchSPCGeoJSONForForecast(urls.hail).catch(() => null),
        ]);
        if (tornData) hasTorn = _hasHazardAtLocation(lat, lng, tornData);
        if (windData) hasWind = _hasHazardAtLocation(lat, lng, windData);
        if (hailData) hasHail = _hasHazardAtLocation(lat, lng, hailData);
    }

    return { catRisk, hasTorn, hasWind, hasHail, cigLevel };
}

// Build the user-facing severe weather sentence
function _buildSPCText(risk) {
    if (!risk?.catRisk || !_CAT_WORDING[risk.catRisk]) return null;
    const wording = _CAT_WORDING[risk.catRisk];
    const cig = risk.cigLevel || 0;

    const threats = [];
    if (risk.hasWind) {
        if      (cig >= 3) threats.push('wind gusts up to 80+ mph');
        else if (cig === 2) threats.push('wind gusts up to 75 mph');
        else if (cig === 1) threats.push('wind gusts up to 65 mph');
        else                threats.push('damaging winds');
    }
    if (risk.hasTorn) {
        if      (cig >= 3) threats.push('violent tornadoes (EF4+)');
        else if (cig === 2) threats.push('intense tornadoes (EF3+)');
        else if (cig === 1) threats.push('strong tornadoes (EF2+)');
        else                threats.push('tornadoes');
    }
    if (risk.hasHail) {
        if      (cig >= 2) threats.push('large hail up to baseball size (2.75")');
        else if (cig === 1) threats.push('large hail up to golf ball size (1.75")');
        else                threats.push('large hail');
    }

    // Use "severe storms" for SLGT; "severe weather" for all other risk levels
    const term = risk.catRisk === 'SLGT' ? 'severe storms' : 'severe weather';
    let sentence = `${wording} ${term} is possible`;
    if (threats.length > 0) {
        const last = threats.pop();
        sentence += threats.length > 0
            ? `, and threats include ${threats.join(', ')}, and ${last}`
            : `, and threats include ${last}`;
    }
    return sentence + '.';
}

// Return cached risk for the given forecast day index (0 = today)
function _spcRiskForForecastDay(dayIndex) {
    const spcDay = dayIndex + 1;  // forecast day 0 → SPC day 1
    return spcDay <= 3 ? (_spcRiskCache[spcDay] || null) : null;
}

// Update the badge chip in a forecast row after SPC data loads
function _updateSPCBadge(forecastDayIndex) {
    const badge = document.getElementById('spc-badge-' + forecastDayIndex);
    if (!badge) return;
    const risk = _spcRiskForForecastDay(forecastDayIndex);
    const col  = risk?.catRisk ? _CAT_COLORS[risk.catRisk] : null;
    if (!col) { badge.style.display = 'none'; return; }

    const label = risk.catRisk.charAt(0) + risk.catRisk.slice(1).toLowerCase();
    badge.style.cssText =
        `display:inline-block;font-size:0.6rem;font-weight:700;padding:1px 5px;` +
        `border-radius:4px;background:${col.bg};border:1px solid ${col.border};` +
        `color:${col.text};margin-left:5px;vertical-align:middle;white-space:nowrap;`;
    badge.textContent = '\u26A1 ' + label;

    // If this day's detail panel is open, refresh it too
    if (_openDayDetailIndex === forecastDayIndex) _refreshDayDetailSPCInfo();
}

// Refresh (or clear) the SPC info block inside the day-detail panel
function _refreshDayDetailSPCInfo() {
    const el = document.getElementById('detail-severe-weather');
    if (!el) return;
    const risk    = _spcRiskForForecastDay(_openDayDetailIndex);
    const spcText = _buildSPCText(risk);
    if (spcText && risk?.catRisk) {
        const col = _CAT_COLORS[risk.catRisk] || {};
        el.style.cssText =
            `display:block;margin-top:10px;padding:10px 12px;border-radius:8px;` +
            `font-size:0.88rem;line-height:1.5;` +
            `background:${col.bg || 'rgba(255,160,64,0.12)'};` +
            `border:1px solid ${col.border || 'rgba(255,160,64,0.35)'};` +
            `color:var(--text-secondary);`;
        el.innerHTML =
            `<strong style="color:${col.text || '#f0a040'};">\u26A1 Severe Weather Outlook</strong><br>${spcText}`;
    } else {
        el.style.display = 'none';
    }
}

// Kick off all SPC day fetches concurrently; update UI as each one resolves
async function _loadSPCForecastData(lat, lng) {
    await Promise.allSettled(
        [1, 2, 3].map(async (spcDay) => {
            try {
                const risk = await _fetchSPCRisk(lat, lng, spcDay);
                _spcRiskCache[spcDay] = risk;
                _updateSPCBadge(spcDay - 1);  // forecast row index = spcDay - 1
            } catch (_) { /* graceful degradation — no SPC info shown */ }
        })
    );
}
