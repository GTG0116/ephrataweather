// ============================================
// 10-DAY FORECAST PAGE LOGIC
// ============================================

async function initForecastView(lat, lng) {
    if (lat == null || lng == null) {
        const loc = LocationManager.getCurrent();
        lat = loc.lat;
        lng = loc.lng;
    }

    const isNWS = WeatherAPI.getDataSource() === 'nws';
    try {
        const data = isNWS
            ? await WeatherAPI.getNWSDailyForecast(lat, lng, 10)
            : await WeatherAPI.getDailyForecast(lat, lng, 10);
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
                dots += `<circle cx="${xOf(i)}" cy="${yOf(v)}" r="3" fill="#42A5F5" stroke="rgba(15,20,40,0.8)" stroke-width="1.5"/>
                         <text x="${xOf(i)}" y="${yOf(v) - 7}" text-anchor="middle" fill="#42A5F5" font-size="8.5" font-weight="500">${Math.round(v)}</text>`;
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
            if (hi != null) {
                dots += `<circle cx="${xOf(i)}" cy="${yOf(hi)}" r="3" fill="#FF7043" stroke="rgba(15,20,40,0.8)" stroke-width="1.5"/>
                         <text x="${xOf(i)}" y="${yOf(hi) - 7}" text-anchor="middle" fill="#FF7043" font-size="8.5" font-weight="500">${Math.round(hi)}\u00B0</text>`;
            }
            if (lo != null) {
                dots += `<circle cx="${xOf(i)}" cy="${yOf(lo)}" r="3" fill="#42A5F5" stroke="rgba(15,20,40,0.8)" stroke-width="1.5"/>
                         <text x="${xOf(i)}" y="${yOf(lo) + 15}" text-anchor="middle" fill="#42A5F5" font-size="8.5" font-weight="500">${Math.round(lo)}\u00B0</text>`;
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
                <div style="width:32px;height:32px;">${iconSvg}</div>
                <div class="temp-bar-wrapper">
                    <div class="temp-bar" style="left:${barLeft}%;width:${barWidth}%;"></div>
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
