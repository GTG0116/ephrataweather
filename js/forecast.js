// ============================================
// 10-DAY FORECAST PAGE LOGIC
// ============================================

// Precipitation condition types that should be suppressed when chance is low
const _PRECIP_CONDITION_TYPES = new Set([
    'DRIZZLE', 'LIGHT_RAIN', 'RAIN', 'HEAVY_RAIN',
    'LIGHT_SNOW', 'SNOW', 'HEAVY_SNOW', 'FLURRIES',
    'SLEET', 'ICE_PELLETS', 'FREEZING_RAIN', 'FREEZING_DRIZZLE',
    'HAIL', 'MIXED'
]);
// Below this threshold (%), precip icons are replaced with sky/cloud conditions
const _PRECIP_ICON_THRESHOLD = 30;

// Return the effective icon condition code, suppressing precip icons when chance is low.
// Falls back to a sky condition parsed from the description text when possible.
function _effectiveIconCondition(condType, condText, precipChance) {
    if (!_PRECIP_CONDITION_TYPES.has(condType)) return condType;
    if (precipChance != null && precipChance >= _PRECIP_ICON_THRESHOLD) return condType;
    // Low (or unknown) precip chance — try to find a sky condition in the description
    const t = (condText || '').toUpperCase();
    if (t.includes('MOSTLY CLOUDY') || t.includes('MOSTLY_CLOUDY')) return 'MOSTLY_CLOUDY';
    if (t.includes('PARTLY CLOUDY') || t.includes('PARTLY_CLOUDY') ||
        t.includes('PARTLY SUNNY')) return 'PARTLY_CLOUDY';
    if (t.includes('OVERCAST') || t.includes('CLOUDY')) return 'OVERCAST';
    if (t.includes('MOSTLY CLEAR') || t.includes('MOSTLY_CLEAR')) return 'MOSTLY_CLEAR';
    if (t.includes('CLEAR') || t.includes('SUNNY') || t.includes('FAIR')) return 'CLEAR';
    return 'PARTLY_CLOUDY';
}

async function initForecastView(lat, lng) {
    if (lat == null || lng == null) {
        const loc = LocationManager.getCurrent();
        lat = loc.lat;
        lng = loc.lng;
    }

    _forecastLat = lat;
    _forecastLng = lng;
    _spcRiskCache = {};
    _wpcRainCache = {};
    _spcFireCache = {};
    _openDayDetailIndex = -1;

    // Load climate normals in parallel with weather data so FairWeatherIndex
    // can use location-specific historical temperature targets.
    const _normalsTask = (typeof ClimateNormals !== 'undefined')
        ? ClimateNormals.loadForLocation(lat, lng).catch(e => console.warn('Climate normals unavailable:', e))
        : Promise.resolve();

    const _src = WeatherAPI.getDataSource();
    try {
        let data;
        if (_src === 'nws') data = await WeatherAPI.getNWSDailyForecast(lat, lng, 10);
        else if (_src === 'open-meteo') data = await WeatherAPI.getOpenMeteoDailyForecast(lat, lng, 10);
        else if (_src === 'owm') data = await WeatherAPI.getOWMDailyForecast(lat, lng, 7);
        else data = await WeatherAPI.getDailyForecast(lat, lng, 10);
        // Ensure normals are ready before rendering so FWI targets are accurate
        await _normalsTask;
        renderForecast(data);
        // Fetch SPC, WPC, and fire weather risk data in the background (non-blocking)
        _loadSPCForecastData(lat, lng);
        _loadWPCFireForecastData(lat, lng);
    } catch (err) {
        document.getElementById('forecast-list').innerHTML =
            '<div class="error-message" style="margin:24px;">Unable to load forecast data<div class="error-hint">Check your Google Weather API key in js/config.js</div></div>';
        console.error('Forecast error:', err);
    }

    // Fetch pollen forecast (5 days) in the background — non-blocking
    _forecastPollenData = [];
    WeatherAPI.getPollen(lat, lng, 5).then(pollenResp => {
        const days = pollenResp.dailyInfo || [];
        _forecastPollenData = days.map(day => {
            const result = { tree: null, grass: null, weed: null };
            (day.pollenTypeInfo || []).forEach(p => {
                const code = (p.code || '').toUpperCase();
                const displayName = (p.displayName || '').toLowerCase();
                const level = p.indexInfo?.category || p.indexInfo?.displayName || null;
                if (code === 'TREE' || displayName.includes('tree')) result.tree = level;
                else if (code === 'GRASS' || displayName.includes('grass')) result.grass = level;
                else if (code === 'WEED' || displayName.includes('weed')) result.weed = level;
            });
            return result;
        });
        // Refresh pollen rows if a day detail is currently open
        if (_openDayDetailIndex >= 0) _renderDayDetailPollen(_openDayDetailIndex);
    }).catch(e => console.warn('Forecast pollen unavailable:', e.message));

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

// Pollen data for the first 5 forecast days (from Google Pollen API).
// Array indexed by day (0–4); each entry is { tree, grass, weed } level strings.
let _forecastPollenData = [];

// ---- Forecast Charts ----
let _activeForecastChart = 'temp';
let _forecastChartTapEls = null;

function _ensureForecastChartTapUI() {
    const container = document.getElementById('forecast-charts-container');
    if (!container) return null;
    if (_forecastChartTapEls?.tooltip && _forecastChartTapEls?.hint && _forecastChartTapEls?.focus) {
        return _forecastChartTapEls;
    }
    const tip = document.createElement('div');
    tip.className = 'chart-touch-tip';
    tip.style.display = 'none';
    container.appendChild(tip);

    const hint = document.createElement('div');
    hint.className = 'chart-tap-hint';
    hint.textContent = 'Tap chart to inspect exact values';
    container.appendChild(hint);

    _forecastChartTapEls = { tooltip: tip, hint, focus: null };
    return _forecastChartTapEls;
}

function _attachForecastTapTargets(svg, tapTargets, domainX) {
    const ui = _ensureForecastChartTapUI();
    if (!ui || !Array.isArray(tapTargets) || !tapTargets.length) {
        if (ui?.tooltip) ui.tooltip.style.display = 'none';
        return;
    }
    const W = Number(svg.getAttribute('viewBox')?.split(' ')[2] || svg.clientWidth || 700);
    const H = Number(svg.getAttribute('viewBox')?.split(' ')[3] || svg.clientHeight || 180);
    const left = domainX?.left ?? 44;
    const right = domainX?.right ?? (W - 16);
    const span = Math.max(16, (right - left) / tapTargets.length);

    const focus = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    focus.innerHTML = `
        <line x1="0" y1="20" x2="0" y2="${H - 40}" stroke="rgba(255,255,255,0.35)" stroke-dasharray="3 3"/>
        <circle cx="0" cy="0" r="5" fill="none" stroke="#8dd4ff" stroke-width="2"/>
        <circle cx="0" cy="0" r="2.5" fill="#8dd4ff"/>
    `;
    focus.style.display = 'none';
    svg.appendChild(focus);
    ui.focus = focus;

    const overlay = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    tapTargets.forEach((pt) => {
        const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        rect.setAttribute('x', String(Math.max(left, pt.x - span * 0.5)));
        rect.setAttribute('y', '0');
        rect.setAttribute('width', String(span));
        rect.setAttribute('height', String(H));
        rect.setAttribute('fill', 'transparent');
        rect.style.cursor = 'pointer';
        const show = () => {
            const [vline, ring, dot] = focus.children;
            vline.setAttribute('x1', pt.x.toFixed(1));
            vline.setAttribute('x2', pt.x.toFixed(1));
            ring.setAttribute('cx', pt.x.toFixed(1));
            ring.setAttribute('cy', pt.y.toFixed(1));
            dot.setAttribute('cx', pt.x.toFixed(1));
            dot.setAttribute('cy', pt.y.toFixed(1));
            ring.setAttribute('stroke', pt.color || '#8dd4ff');
            dot.setAttribute('fill', pt.color || '#8dd4ff');
            focus.style.display = '';
            ui.tooltip.innerHTML = `<strong>${pt.title}</strong><br>${pt.value}`;
            ui.tooltip.style.left = `${Math.min(W - 140, Math.max(8, pt.x - 64))}px`;
            ui.tooltip.style.top = `${Math.max(12, pt.y - 58)}px`;
            ui.tooltip.style.display = 'block';
        };
        rect.addEventListener('click', show);
        rect.addEventListener('touchstart', show, { passive: true });
        overlay.appendChild(rect);
    });
    svg.appendChild(overlay);
}

function switchForecastChart(metric) {
    _activeForecastChart = metric;
    document.querySelectorAll('.chart-tab[data-fmetric]').forEach((btn) =>
        btn.classList.toggle('active', btn.dataset.fmetric === metric));
    if (_forecastChartTapEls?.tooltip) _forecastChartTapEls.tooltip.style.display = 'none';
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
    const isUV = metric === 'uv';
    const isFeelsLike = metric === 'feelslike';
    const isHumidity = metric === 'humidity';
    const isSunriseset = metric === 'sunriseset';
    const H = isTemp || isFeelsLike ? 180 : isSunriseset ? 220 : 140;
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

        const tapTargets = [];
        // Dots
        let dots = '';
        days.forEach((d, i) => {
            const v = vals[i];
            if (v != null) {
                dots += `<circle cx="${xOf(i)}" cy="${yOf(v)}" r="3" fill="#42A5F5" stroke="rgba(15,20,40,0.8)" stroke-width="1.5"/>
                `;
                const dateStr = d.displayDate || d.interval?.startTime;
                tapTargets.push({ x: xOf(i), y: yOf(v), title: WeatherAPI.formatDayName(dateStr, false), value: `${Math.round(v)} mph`, color: '#42A5F5' });
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
        _attachForecastTapTargets(svg, tapTargets, { left: PAD_L, right: PAD_L + plotW });
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

        const tapTargets = [];
        // Dots on hi/lo lines at each day
        let dots = '';
        days.forEach((d, i) => {
            const hi = d.maxTemperature?.degrees;
            const lo = d.minTemperature?.degrees;
            if (hi != null) {
                dots += `<circle cx="${xOf(i)}" cy="${yOf(hi)}" r="3" fill="#FF7043" stroke="rgba(15,20,40,0.8)" stroke-width="1.5"/>
                `;
            }
            if (lo != null) {
                dots += `<circle cx="${xOf(i)}" cy="${yOf(lo)}" r="3" fill="#42A5F5" stroke="rgba(15,20,40,0.8)" stroke-width="1.5"/>
                `;
            }
            const dateStr = d.displayDate || d.interval?.startTime;
            if (hi != null && lo != null) tapTargets.push({ x: xOf(i), y: (yOf(hi) + yOf(lo)) / 2, title: WeatherAPI.formatDayName(dateStr, false), value: `High ${Math.round(hi)}° · Low ${Math.round(lo)}°`, color: '#FF8A65' });
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
        _attachForecastTapTargets(svg, tapTargets, { left: PAD_L, right: PAD_L + plotW });
    } else if (metric === 'precip') {
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

        const tapTargets = [];
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
            const dateStr = d.displayDate || d.interval?.startTime;
            const label = WeatherAPI.formatDayName(dateStr, true).slice(0, 3);
            xLabels += `<text x="${x + bw / 2}" y="${H - 6}" text-anchor="middle" fill="rgba(255,255,255,0.45)" font-size="9.5">${label}</text>`;
            tapTargets.push({ x: x + bw / 2, y: Math.max(y, PAD_T + 14), title: WeatherAPI.formatDayName(dateStr, false), value: `${Math.round(chance)}% chance`, color: '#26C6DA' });
        });

        svg.innerHTML = `${yLabels}${bars}${xLabels}`;
        _attachForecastTapTargets(svg, tapTargets, { left: PAD_L, right: PAD_L + plotW });
        return;
    }

    if (isUV) {
        // UV Index bar chart
        const vals = days.map(d => d.uvIndex ?? d.maxUvIndex ?? null);
        const filtered = vals.filter(v => v != null);
        if (!filtered.length) { svg.innerHTML = ''; return; }

        const maxV = Math.max(...filtered, 11);
        const xOf = (i) => PAD_L + i * barW + barW * 0.15;
        const bw = barW * 0.7;
        const yOf = (v) => PAD_T + plotH - (v / maxV) * plotH;

        const uvColor = (v) => {
            if (v <= 2) return 'rgba(76,175,80,0.85)';
            if (v <= 5) return 'rgba(255,235,59,0.85)';
            if (v <= 7) return 'rgba(255,152,0,0.85)';
            if (v <= 10) return 'rgba(244,67,54,0.85)';
            return 'rgba(156,39,176,0.85)';
        };

        let yLabels = '';
        [0, 3, 6, 9, 11].forEach(v => {
            const y = yOf(v);
            yLabels += `<line x1="${PAD_L}" y1="${y}" x2="${PAD_L + plotW}" y2="${y}" stroke="rgba(255,255,255,0.06)" stroke-width="1"/>
                        <text x="${PAD_L - 5}" y="${y + 4}" text-anchor="end" fill="rgba(255,255,255,0.45)" font-size="9.5">${v}</text>`;
        });

        const tapTargets = [];
        let bars = '', xLabels = '';
        days.forEach((d, i) => {
            const v = vals[i];
            const x = xOf(i);
            if (v != null) {
                const y = yOf(v);
                const bh = (v / maxV) * plotH;
                bars += `<rect x="${x}" y="${y}" width="${bw}" height="${bh}" fill="${uvColor(v)}" rx="3" ry="3"/>`;
                const dateStr = d.displayDate || d.interval?.startTime;
                tapTargets.push({ x: x + bw / 2, y: Math.max(y, PAD_T + 14), title: WeatherAPI.formatDayName(dateStr, false), value: `UV ${Math.round(v)}`, color: uvColor(v) });
            }
            const dateStr = d.displayDate || d.interval?.startTime;
            const label = WeatherAPI.formatDayName(dateStr, true).slice(0, 3);
            xLabels += `<text x="${x + bw / 2}" y="${H - 6}" text-anchor="middle" fill="rgba(255,255,255,0.45)" font-size="9.5">${label}</text>`;
        });

        svg.innerHTML = `${yLabels}${bars}${xLabels}
            <text x="${PAD_L - 5}" y="${PAD_T - 6}" text-anchor="end" fill="rgba(255,255,255,0.3)" font-size="8">UV</text>`;
        _attachForecastTapTargets(svg, tapTargets, { left: PAD_L, right: PAD_L + plotW });
        return;
    }

    if (isFeelsLike) {
        // Feels Like band chart (same style as temperature)
        const hiVals = days.map(d => d.feelsLikeMax?.degrees ?? null);
        const loVals = days.map(d => d.feelsLikeMin?.degrees ?? null);
        const allVals = [...hiVals, ...loVals].filter(v => v != null);
        if (allVals.length < 2) { svg.innerHTML = ''; return; }

        let minV = Math.min(...allVals);
        let maxV = Math.max(...allVals);
        const spread = maxV - minV || 1;
        minV -= spread * 0.12;
        maxV += spread * 0.12;

        const xOf = (i) => PAD_L + (i / (n - 1)) * plotW;
        const yOf = (v) => PAD_T + plotH - ((v - minV) / (maxV - minV)) * plotH;

        let yLabels = '';
        for (let t = 0; t <= 4; t++) {
            const v = minV + (maxV - minV) * (t / 4);
            const y = yOf(v);
            yLabels += `<line x1="${PAD_L}" y1="${y}" x2="${PAD_L + plotW}" y2="${y}" stroke="rgba(255,255,255,0.06)" stroke-width="1"/>
                        <text x="${PAD_L - 5}" y="${y + 4}" text-anchor="end" fill="rgba(255,255,255,0.45)" font-size="9.5">${Math.round(v)}\u00B0</text>`;
        }

        const hiPoints = days.map((d, i) => ({ x: xOf(i), y: hiVals[i] != null ? yOf(hiVals[i]) : null })).filter(p => p.y != null);
        const loPoints = days.map((d, i) => ({ x: xOf(i), y: loVals[i] != null ? yOf(loVals[i]) : null })).filter(p => p.y != null);

        let bandPath = '', hiLine = '', loLineFixed = '';
        hiPoints.forEach((p, i) => {
            hiLine += (i === 0 ? `M${p.x},${p.y}` : ` L${p.x},${p.y}`);
            bandPath += (i === 0 ? `M${p.x},${p.y}` : ` L${p.x},${p.y}`);
        });
        [...loPoints].reverse().forEach((p) => { bandPath += ` L${p.x},${p.y}`; });
        loLineFixed = loPoints.map((p, i) => (i === 0 ? `M${p.x},${p.y}` : ` L${p.x},${p.y}`)).join('');
        bandPath += ' Z';

        const tapTargets = [];
        let xLabels = '', dots = '';
        days.forEach((d, i) => {
            const dateStr = d.displayDate || d.interval?.startTime;
            const label = WeatherAPI.formatDayName(dateStr, true).slice(0, 3);
            xLabels += `<text x="${xOf(i)}" y="${H - 6}" text-anchor="middle" fill="rgba(255,255,255,0.45)" font-size="9.5">${label}</text>`;
            const hi = hiVals[i];
            const lo = loVals[i];
            if (hi != null) dots += `<circle cx="${xOf(i)}" cy="${yOf(hi)}" r="3" fill="#FF7043" stroke="rgba(15,20,40,0.8)" stroke-width="1.5"/>`;
            if (lo != null) dots += `<circle cx="${xOf(i)}" cy="${yOf(lo)}" r="3" fill="#42A5F5" stroke="rgba(15,20,40,0.8)" stroke-width="1.5"/>`;
            if (hi != null && lo != null) tapTargets.push({ x: xOf(i), y: (yOf(hi) + yOf(lo)) / 2, title: WeatherAPI.formatDayName(dateStr, false), value: `Feels ${Math.round(hi)}° / ${Math.round(lo)}°`, color: '#FF8A65' });
        });

        svg.innerHTML = `
            <defs>
                <linearGradient id="fg_feels" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stop-color="#FF7043" stop-opacity="0.25"/>
                    <stop offset="100%" stop-color="#42A5F5" stop-opacity="0.25"/>
                </linearGradient>
            </defs>
            ${yLabels}${xLabels}
            <path d="${bandPath}" fill="url(#fg_feels)"/>
            <path d="${hiLine}" fill="none" stroke="#FF7043" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
            <path d="${loLineFixed}" fill="none" stroke="#42A5F5" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
            ${dots}`;
        _attachForecastTapTargets(svg, tapTargets, { left: PAD_L, right: PAD_L + plotW });
        return;
    }

    if (isHumidity) {
        // Humidity line chart
        const vals = days.map(d => d.relativeHumidity ?? d.avgHumidity ?? null);
        const filtered = vals.filter(v => v != null);
        if (filtered.length < 2) { svg.innerHTML = ''; return; }

        const xOf = (i) => PAD_L + (i / (n - 1)) * plotW;
        const yOf = (v) => PAD_T + plotH - ((v - 0) / 100) * plotH;

        let yLabels = '';
        [0, 25, 50, 75, 100].forEach(v => {
            const y = yOf(v);
            yLabels += `<line x1="${PAD_L}" y1="${y}" x2="${PAD_L + plotW}" y2="${y}" stroke="rgba(255,255,255,0.06)" stroke-width="1"/>
                        <text x="${PAD_L - 5}" y="${y + 4}" text-anchor="end" fill="rgba(255,255,255,0.45)" font-size="9.5">${v}%</text>`;
        });

        let xLabels = '';
        days.forEach((d, i) => {
            const dateStr = d.displayDate || d.interval?.startTime;
            const label = WeatherAPI.formatDayName(dateStr, true).slice(0, 3);
            xLabels += `<text x="${xOf(i)}" y="${H - 6}" text-anchor="middle" fill="rgba(255,255,255,0.45)" font-size="9.5">${label}</text>`;
        });

        const points = vals.map((v, i) => v != null ? { x: xOf(i), y: yOf(v) } : null).filter(Boolean);
        let linePath = '', areaPath = '';
        points.forEach((p, i) => {
            if (i === 0) { linePath += `M${p.x},${p.y}`; areaPath += `M${p.x},${PAD_T + plotH} L${p.x},${p.y}`; }
            else { linePath += ` L${p.x},${p.y}`; areaPath += ` L${p.x},${p.y}`; }
        });
        if (points.length) areaPath += ` L${points[points.length-1].x},${PAD_T + plotH} Z`;

        const tapTargets = [];
        let dots = '';
        days.forEach((d, i) => {
            const v = vals[i];
            if (v != null) {
                dots += `<circle cx="${xOf(i)}" cy="${yOf(v)}" r="3" fill="#26C6DA" stroke="rgba(15,20,40,0.8)" stroke-width="1.5"/>`;
                const dateStr = d.displayDate || d.interval?.startTime;
                tapTargets.push({ x: xOf(i), y: yOf(v), title: WeatherAPI.formatDayName(dateStr, false), value: `${Math.round(v)}% humidity`, color: '#26C6DA' });
            }
        });

        svg.innerHTML = `
            <defs>
                <linearGradient id="fg_hum" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stop-color="#26C6DA" stop-opacity="0.3"/>
                    <stop offset="100%" stop-color="#26C6DA" stop-opacity="0"/>
                </linearGradient>
            </defs>
            ${yLabels}${xLabels}
            <path d="${areaPath}" fill="url(#fg_hum)"/>
            <path d="${linePath}" fill="none" stroke="#26C6DA" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
            ${dots}`;
        _attachForecastTapTargets(svg, tapTargets, { left: PAD_L, right: PAD_L + plotW });
        return;
    }

    if (isSunriseset) {
        // Sunrise & Sunset — horizontal time bars per day
        const sunriseVals = days.map(d => d.sunrise ? new Date(d.sunrise) : null);
        const sunsetVals = days.map(d => d.sunset ? new Date(d.sunset) : null);
        const hasData = sunriseVals.some(v => v != null);
        if (!hasData) { svg.innerHTML = '<text x="50%" y="50%" text-anchor="middle" fill="rgba(255,255,255,0.4)" font-size="11">No sunrise/sunset data</text>'; return; }

        // Convert time to minutes since midnight for positioning
        const toMins = (dt) => dt ? dt.getHours() * 60 + dt.getMinutes() : null;
        const rMins = sunriseVals.map(toMins);
        const sMins = sunsetVals.map(toMins);
        const allMins = [...rMins, ...sMins].filter(v => v != null);
        const minM = Math.min(...allMins) - 30;
        const maxM = Math.max(...allMins) + 30;

        const xOf = (m) => PAD_L + ((m - minM) / (maxM - minM)) * plotW;
        const rowH = plotH / n;
        const barH = Math.min(rowH * 0.35, 10);
        const yOf = (i) => PAD_T + i * rowH + rowH / 2;

        // X-axis time labels (whole-hour steps, ~4-5 labels)
        let xLabels = '';
        const stepMins = Math.ceil((maxM - minM) / 5 / 60) * 60;
        for (let m = Math.ceil(minM / stepMins) * stepMins; m <= maxM; m += stepMins) {
            const x = xOf(m);
            const h = Math.floor(m / 60) % 12 || 12;
            const ampm = m < 720 ? 'AM' : 'PM';
            xLabels += `<line x1="${x}" y1="${PAD_T}" x2="${x}" y2="${PAD_T + plotH}" stroke="rgba(255,255,255,0.07)" stroke-width="1"/>
                        <text x="${x}" y="${H - 7}" text-anchor="middle" fill="rgba(255,255,255,0.35)" font-size="8.5">${h}${ampm}</text>`;
        }

        // Legend: sunrise / sunset color key
        const legendX = PAD_L + plotW;
        const legendY = PAD_T - 7;
        const legend = `<circle cx="${legendX - 86}" cy="${legendY}" r="3.5" fill="rgba(255,183,77,0.9)"/>
                        <text x="${legendX - 80}" y="${legendY + 4}" fill="rgba(255,183,77,0.8)" font-size="8">Sunrise</text>
                        <circle cx="${legendX - 36}" cy="${legendY}" r="3.5" fill="rgba(255,112,67,0.9)"/>
                        <text x="${legendX - 30}" y="${legendY + 4}" fill="rgba(255,112,67,0.8)" font-size="8">Sunset</text>`;

        const tapTargets = [];
        let bars = '', dayLabels = '';
        days.forEach((d, i) => {
            const rm = rMins[i];
            const sm = sMins[i];
            const y = yOf(i);
            const dateStr = d.displayDate || d.interval?.startTime;
            const label = WeatherAPI.formatDayName(dateStr, true).slice(0, 3);
            dayLabels += `<text x="${PAD_L - 5}" y="${y + 4}" text-anchor="end" fill="rgba(255,255,255,0.55)" font-size="9.5">${label}</text>`;

            if (rm != null && sm != null) {
                const x1 = xOf(rm);
                const x2 = xOf(sm);
                const labelY = y - barH / 2 - 3;
                // Day bar between sunrise and sunset
                bars += `<rect x="${x1}" y="${y - barH / 2}" width="${x2 - x1}" height="${barH}" fill="rgba(255,213,79,0.2)" rx="2"/>`;
                // Sunrise dot + label (anchored start = extends right, away from sunset label)
                bars += `<circle cx="${x1}" cy="${y}" r="4" fill="rgba(255,183,77,0.9)" stroke="rgba(15,20,40,0.7)" stroke-width="1.5"/>`;
                const rTime = sunriseVals[i].toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
                // Sunset dot + label (anchored end = extends left, away from sunrise label)
                bars += `<circle cx="${x2}" cy="${y}" r="4" fill="rgba(255,112,67,0.9)" stroke="rgba(15,20,40,0.7)" stroke-width="1.5"/>`;
                const sTime = sunsetVals[i].toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
                tapTargets.push({ x: (x1 + x2) / 2, y, title: WeatherAPI.formatDayName(dateStr, false), value: `Sunrise ${rTime} · Sunset ${sTime}`, color: 'rgba(255,183,77,0.9)' });
            }
        });

        svg.innerHTML = `${xLabels}${dayLabels}${legend}${bars}`;
        _attachForecastTapTargets(svg, tapTargets, { left: PAD_L, right: PAD_L + plotW });
        return;
    }
}

function renderForecast(data) {
    const list = document.getElementById('forecast-list');
    forecastDays = data.forecastDays || [];

    // Detect if NWS omitted today (happens near end-of-day when no daytime period remains).
    // _spcDayOffset = how many days ahead of today forecastDays[0] is (normally 0, sometimes 1).
    {
        const todayStr = new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD in local time
        const firstRaw = forecastDays[0]?.displayDate || forecastDays[0]?.interval?.startTime;
        const firstStr = firstRaw ? firstRaw.slice(0, 10) : todayStr;
        _spcDayOffset = Math.max(0, Math.round(
            (new Date(firstStr + 'T12:00:00') - new Date(todayStr + 'T12:00:00')) / 86400000
        ));
    }

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
        const iconSvg = WeatherIcons.fromText(_effectiveIconCondition(condType, condText, precipChance));

        // Temperature bar positioning
        const barLeft = lo != null ? ((lo - globalMin) / tempRange) * 100 : 0;
        const barRight = hi != null ? ((hi - globalMin) / tempRange) * 100 : 100;
        const barWidth = barRight - barLeft;

        // Fair Weather Index badge
        const fwi = FairWeatherIndex.calculate(day);
        const fwiBadge = `<span class="fwi-badge" style="color:${fwi.color};border-color:${fwi.color};background:${fwi.bg};">
            <span class="fwi-dot" style="width:6px;height:6px;border-radius:50%;background:${fwi.color};flex-shrink:0;"></span>
            <span class="fwi-label-text">${fwi.short}</span>
        </span>`;

        return `
            <div class="forecast-row fade-in" style="animation-delay:${i * 50}ms;cursor:pointer;" onclick="showDayDetail(${i})">
                <span class="day ${isToday ? 'today' : ''}">${dayName}<span id="spc-badge-${i}" style="display:none;"></span><span id="wpc-rain-badge-${i}" style="display:none;"></span><span id="fire-badge-${i}" style="display:none;"></span></span>
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
                ${fwiBadge}
            </div>
        `;
    }).join('');

    // Render charts below the list
    renderForecastCharts(forecastDays);
}


function _buildDayDescription(day) {
    const cond = day.detailedForecast
        || day.weatherCondition?.description?.text
        || (day.weatherCondition?.type || '').replace(/_/g, ' ').toLowerCase()
        || 'conditions';

    // If NWS detailed forecast is available, use it as the base description
    if (day.detailedForecast) {
        return day.detailedForecast;
    }

    const hi = day.maxTemperature?.degrees;
    const lo = day.minTemperature?.degrees;
    const tempText = hi != null && lo != null
        ? `High near ${WeatherAPI.formatTemp(hi)}° and low around ${WeatherAPI.formatTemp(lo)}°.`
        : hi != null
            ? `High near ${WeatherAPI.formatTemp(hi)}°.`
            : lo != null
                ? `Low around ${WeatherAPI.formatTemp(lo)}°.`
                : 'Temperature details are limited for this period.';

    const feelsHi = day.feelsLikeMax?.degrees;
    const feelsLo = day.feelsLikeMin?.degrees;
    let feelsText = '';
    if (feelsHi != null && hi != null && Math.abs(feelsHi - hi) >= 3) {
        feelsText = ` Feels like ${WeatherAPI.formatTemp(feelsHi)}°.`;
    } else if (feelsLo != null && lo != null && Math.abs(feelsLo - lo) >= 3) {
        feelsText = ` Feels like ${WeatherAPI.formatTemp(feelsLo)}° overnight.`;
    }

    const precipChance = day.precipitation?.probability;
    const precipAmount = day.precipitation?.qpf?.millimeters;
    const snowMm = day.snowQpf?.millimeters;
    let precipText = '';
    if (precipChance != null && precipChance > 0) {
        precipText = ` Precipitation chance is around ${Math.round(precipChance)}%.`;
        if (snowMm != null && snowMm > 0) {
            precipText += ` Possible snowfall of about ${(snowMm / 25.4).toFixed(1)} inches.`;
        } else if (precipAmount != null && precipAmount > 0) {
            precipText += ` Expected rainfall is about ${(precipAmount / 25.4).toFixed(2)} inches.`;
        }
    }

    const windSpeed = day.wind?.speed?.value || day.maxWind?.speed?.value;
    const windDir = day.wind?.direction || day.maxWind?.direction;
    const windGust = day.windGust;
    let windText = '';
    if (windSpeed != null) {
        windText = ` Winds near ${Math.round(windSpeed)} mph${windDir != null ? ` from the ${WeatherAPI.windDirection(windDir)}` : ''}`;
        if (windGust != null && windGust > windSpeed + 5) {
            windText += `, gusting to ${Math.round(windGust)} mph`;
        }
        windText += '.';
    }

    const cloudCover = day.cloudCover;
    let cloudText = '';
    if (cloudCover != null) {
        if (cloudCover >= 85) cloudText = ' Mostly cloudy.';
        else if (cloudCover >= 60) cloudText = ' Partly to mostly cloudy.';
        else if (cloudCover >= 30) cloudText = ' Partly cloudy.';
        else cloudText = ' Mostly clear skies.';
    }

    return `${cond.charAt(0).toUpperCase() + cond.slice(1)}. ${tempText}${feelsText}${precipText}${windText}${cloudText}`.replace(/\s+/g, ' ').trim();
}

function closeDayDetail() {
    const detail = document.getElementById('day-detail');
    if (!detail || detail.style.display === 'none') { _openDayDetailIndex = -1; return; }
    detail.classList.remove('is-open');
    detail.classList.add('is-closing');
    _openDayDetailIndex = -1;
    setTimeout(() => {
        detail.style.display = 'none';
        detail.classList.remove('is-closing');
    }, 220);
}

function showDayDetail(index) {
    const day = forecastDays[index];
    if (!day) return;

    _openDayDetailIndex = index;

    const detail = document.getElementById('day-detail');
    detail.classList.remove('is-closing', 'is-open');
    detail.style.display = 'block';
    // Trigger reflow so removing+re-adding the animation class restarts it
    void detail.offsetWidth;
    detail.classList.add('is-open');
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

    const iconSvg = WeatherIcons.fromText(_effectiveIconCondition(condType, condText, day.precipitation?.probability));
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

    // Wind Gusts
    const windGust = day.windGust;
    const windGustRow = document.getElementById('detail-wind-gust-row');
    if (windGustRow) windGustRow.style.display = windGust != null ? '' : 'none';
    const windGustEl = document.getElementById('detail-wind-gust');
    if (windGustEl) windGustEl.textContent = windGust != null ? `${Math.round(windGust)} mph` : 'N/A';

    // Feels Like (high/low)
    const feelsHi = day.feelsLikeMax?.degrees;
    const feelsLo = day.feelsLikeMin?.degrees;
    const feelsRow = document.getElementById('detail-feels-like-row');
    const feelsEl = document.getElementById('detail-feels-like');
    const hasFeels = feelsHi != null || feelsLo != null;
    if (feelsRow) feelsRow.style.display = hasFeels ? '' : 'none';
    if (feelsEl) feelsEl.innerHTML = hasFeels
        ? `<span style="color:var(--accent-warm);">${feelsHi != null ? WeatherAPI.formatTemp(feelsHi) + '\u00B0' : '--'}</span> / <span style="color:var(--accent-blue);">${feelsLo != null ? WeatherAPI.formatTemp(feelsLo) + '\u00B0' : '--'}</span>`
        : 'N/A';

    // Cloud Cover
    const cloudCover = day.cloudCover;
    const cloudRow = document.getElementById('detail-cloud-row');
    if (cloudRow) cloudRow.style.display = cloudCover != null ? '' : 'none';
    const cloudEl = document.getElementById('detail-cloud');
    if (cloudEl) cloudEl.textContent = cloudCover != null ? `${Math.round(cloudCover)}%` : 'N/A';

    // Snow QPF
    const snowMm = day.snowQpf?.millimeters;
    const snowRow = document.getElementById('detail-snow-row');
    const hasSnow = snowMm != null && snowMm > 0;
    if (snowRow) snowRow.style.display = hasSnow ? '' : 'none';
    const snowEl = document.getElementById('detail-snow');
    if (snowEl) snowEl.textContent = hasSnow ? `${(snowMm / 25.4).toFixed(1)} in` : 'N/A';

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

    // Fair Weather Index
    _renderDayDetailFWI(day);

    // Pollen (available for first 5 days from Google Pollen API)
    _renderDayDetailPollen(index);

    // Severe weather section (SPC outlook)
    _refreshDayDetailSPCInfo();
    // Rainfall and fire weather sections
    _refreshDayDetailWPCRainInfo();
    _refreshDayDetailFireInfo();
}

function _renderDayDetailPollen(index) {
    const treeRow  = document.getElementById('detail-pollen-tree-row');
    const grassRow = document.getElementById('detail-pollen-grass-row');
    const weedRow  = document.getElementById('detail-pollen-weed-row');
    if (!treeRow || !grassRow || !weedRow) return;

    // Pollen is only available for the first 5 days
    const pollen = (index < 5) ? _forecastPollenData[index] : null;

    function _applyPollen(row, el, level) {
        const hasData = level != null;
        row.style.display = hasData ? '' : 'none';
        if (!hasData) return;
        el.textContent = level;
        const lower = level.toLowerCase();
        el.style.color = lower.includes('very high') ? '#EF5350'
            : lower.includes('high')                 ? '#FF7043'
            : lower.includes('moderate') || lower.includes('medium') ? '#FFC107'
            : 'var(--text-secondary)';
    }

    _applyPollen(treeRow,  document.getElementById('detail-pollen-tree'),  pollen?.tree);
    _applyPollen(grassRow, document.getElementById('detail-pollen-grass'), pollen?.grass);
    _applyPollen(weedRow,  document.getElementById('detail-pollen-weed'),  pollen?.weed);
}

function _renderDayDetailFWI(day) {
    const fwiContainer = document.getElementById('detail-fwi');
    const fwiBlock     = document.getElementById('detail-fwi-block');
    const fwiFactors   = document.getElementById('detail-fwi-factors');
    if (!fwiContainer || !fwiBlock || !fwiFactors) return;

    const fwi = FairWeatherIndex.calculate(day);
    fwiContainer.style.display = '';

    // Build the header block
    fwiBlock.style.background = fwi.bg;
    fwiBlock.style.border = `1px solid ${fwi.color}33`;
    fwiBlock.innerHTML = `
        <div class="fwi-detail-score" style="color:${fwi.color};">${fwi.score}<span style="font-size:1rem;opacity:0.5;">/5</span></div>
        <div>
            <div class="fwi-detail-label" style="color:${fwi.color};">${fwi.label}</div>
            <div class="fwi-detail-sub">Fair Weather Index &bull; ${fwi.score100}/100</div>
            <div class="fwi-detail-sub" style="margin-top:3px;">
                ${fwi.details.climateNormalUsed ? 'Historical avg target' : 'Seasonal comfort target'}: ~${Math.round(fwi.details.seasonalCenter)}\u00B0F feels like
                ${fwi.details.feelsLike != null ? `&bull; actual ${Math.round(fwi.details.feelsLike)}\u00B0F` : ''}
            </div>
        </div>
    `;

    // Build factor chips
    const d = fwi.details;
    const chips = [];

    function _pct(result) {
        if (!result.available || result.pts == null) return null;
        return Math.round((result.pts / result.max) * 100);
    }
    function _chipColor(pct) {
        if (pct == null)  return '#888';
        if (pct >= 80)    return '#4CAF50';
        if (pct >= 55)    return '#8BC34A';
        if (pct >= 35)    return '#FFC107';
        if (pct >= 15)    return '#FF7043';
        return '#EF5350';
    }

    // Temperature
    const tPct = _pct(d.temperature);
    chips.push({ label: `Feels Like ${d.feelsLike != null ? Math.round(d.feelsLike) + '\u00B0' : '--'}`, pct: tPct });

    // Humidity
    const hPct = _pct(d.humidity);
    if (d.humidity.available) chips.push({ label: `Humidity`, pct: hPct });

    // Wind
    const wPct = _pct(d.wind);
    if (d.wind.available) chips.push({ label: `Wind`, pct: wPct });

    // Cloud cover
    const cPct = _pct(d.cloudCover);
    if (d.cloudCover.available) chips.push({ label: `Cloud Cover`, pct: cPct });

    // Precipitation
    const pPct = _pct(d.precipitation);
    if (d.precipitation.available) chips.push({ label: `Precipitation`, pct: pPct });

    fwiFactors.innerHTML = chips.map(chip => {
        const c = _chipColor(chip.pct);
        const bar = chip.pct != null
            ? `<span style="display:inline-block;width:${Math.round(chip.pct * 0.28)}px;height:3px;border-radius:2px;background:${c};vertical-align:middle;margin-right:3px;"></span>`
            : '';
        return `<span class="fwi-factor-chip">
            <span class="fwi-dot" style="background:${c};"></span>
            ${bar}${chip.label}${chip.pct != null ? ` <span style="opacity:0.55;margin-left:2px;">${chip.pct}%</span>` : ''}
        </span>`;
    }).join('');
}

// ============================================================
// SPC SEVERE WEATHER OUTLOOK INTEGRATION
// ============================================================

let _forecastLat = null;
let _forecastLng = null;
let _spcRiskCache = {};     // keyed by SPC day number (1, 2, 3) → risk object
let _spcDayOffset = 0;      // days forecastDays[0] is ahead of today (normally 0; 1 when NWS omits today near end-of-day)
let _wpcRainCache = {};     // keyed by day number (1, 2, 3) → { risk: 'MRGL'|'SLGT'|'MDT'|'HIGH'|null }
let _spcFireCache = {};     // keyed by day number (1, 2) → { risk: 'ELEV'|'CRIT'|'EXTM'|null }
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

// For a hazard GeoJSON (torn/wind/hail), return { present, cig } at the given location.
// CIG1/2/3 polygons live in the same file as the probability polygons.
function _getHazardInfo(lat, lng, geojson) {
    if (!geojson?.features) return { present: false, cig: 0 };
    let present = false, cig = 0;
    for (const feature of geojson.features) {
        if (!_spcPointInFeature(lng, lat, feature)) continue;
        const label = String(feature.properties?.LABEL ?? '').toUpperCase();
        const m = label.match(/^CIG(\d)$/);
        if (m) {
            const level = parseInt(m[1], 10);
            if (level > cig) cig = level;
        } else {
            present = true;
        }
    }
    return { present, cig };
}

// Fetch SPC data for one SPC day and return the risk object
async function _fetchSPCRisk(lat, lng, spcDay) {
    const urls = _SPC_FORECAST_URLS[spcDay];
    if (!urls) return null;

    let catData;
    try { catData = await _fetchSPCGeoJSONForForecast(urls.cat); }
    catch (_) { return null; }

    const catRisk = _highestCatRisk(lat, lng, catData);
    let hasTorn = false, hasWind = false, hasHail = false;
    let tornCig = 0, windCig = 0, hailCig = 0;

    // Only check specific hazards for Days 1-2 with MRGL+ risk
    if (catRisk && _CAT_RANK[catRisk] >= _CAT_RANK.MRGL && urls.torn && urls.wind && urls.hail) {
        const [tornData, windData, hailData] = await Promise.all([
            _fetchSPCGeoJSONForForecast(urls.torn).catch(() => null),
            _fetchSPCGeoJSONForForecast(urls.wind).catch(() => null),
            _fetchSPCGeoJSONForForecast(urls.hail).catch(() => null),
        ]);
        if (tornData) ({ present: hasTorn, cig: tornCig } = _getHazardInfo(lat, lng, tornData));
        if (windData) ({ present: hasWind, cig: windCig } = _getHazardInfo(lat, lng, windData));
        if (hailData) ({ present: hasHail, cig: hailCig } = _getHazardInfo(lat, lng, hailData));
    }

    return { catRisk, hasTorn, hasWind, hasHail, tornCig, windCig, hailCig };
}

// Build the user-facing severe weather sentence
function _buildSPCText(risk) {
    if (!risk?.catRisk || !_CAT_WORDING[risk.catRisk]) return null;
    const wording = _CAT_WORDING[risk.catRisk];

    const threats = [];
    if (risk.hasWind) {
        const c = risk.windCig || 0;
        if      (c >= 3) threats.push('wind gusts up to 80+ mph');
        else if (c === 2) threats.push('wind gusts up to 75 mph');
        else if (c === 1) threats.push('wind gusts up to 65 mph');
        else              threats.push('damaging winds');
    }
    if (risk.hasTorn) {
        const c = risk.tornCig || 0;
        if      (c >= 3) threats.push('violent tornadoes (EF4+)');
        else if (c === 2) threats.push('intense tornadoes (EF3+)');
        else if (c === 1) threats.push('strong tornadoes (EF2+)');
        else              threats.push('tornadoes');
    }
    if (risk.hasHail) {
        const c = risk.hailCig || 0;
        if      (c >= 2) threats.push('large hail up to baseball size (2.75")');
        else if (c === 1) threats.push('large hail up to golf ball size (1.75")');
        else              threats.push('large hail');
    }

    // Use "severe storms" for SLGT; "severe weather" for all other risk levels
    const term = risk.catRisk === 'SLGT' ? 'severe storms' : 'severe weather';
    const verb = term === 'severe storms' ? 'are' : 'is';
    let sentence = `${wording} ${term} ${verb} possible`;
    if (threats.length > 0) {
        const last = threats.pop();
        sentence += threats.length > 0
            ? `, and threats include ${threats.join(', ')}, and ${last}`
            : `, and threats include ${last}`;
    }
    return sentence + '.';
}

// Return cached risk for the given forecast day index (0 = first day shown).
// _spcDayOffset shifts the mapping when NWS omits today (e.g. near midnight).
function _spcRiskForForecastDay(dayIndex) {
    const spcDay = dayIndex + 1 + _spcDayOffset;
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
                // Map SPC day to forecast row index, accounting for any day offset
                // (when NWS omits "today" near end-of-day, _spcDayOffset = 1).
                const forecastIdx = spcDay - 1 - _spcDayOffset;
                if (forecastIdx >= 0) _updateSPCBadge(forecastIdx);
            } catch (_) { /* graceful degradation — no SPC info shown */ }
        })
    );
}

// ============================================================
// WPC EXCESSIVE RAINFALL & SPC FIRE WEATHER FORECAST INTEGRATION
// ============================================================

// WPC ERO moved to the experimental map endpoint (new URL structure)
const _WPC_ERO_FORECAST_URLS = {
    1: 'https://www.wpc.ncep.noaa.gov/exper/eromap/geojson/Day1_Latest.geojson',
    2: 'https://www.wpc.ncep.noaa.gov/exper/eromap/geojson/Day2_Latest.geojson',
    3: 'https://www.wpc.ncep.noaa.gov/exper/eromap/geojson/Day3_Latest.geojson',
};

// SPC fire weather is now split into two component files per day
const _SPC_FIRE_FORECAST_URLS = {
    1: {
        windrh: 'https://www.spc.noaa.gov/products/fire_wx/day1fw_windrh.nolyr.geojson',
        dryt:   'https://www.spc.noaa.gov/products/fire_wx/day1fw_dryt.nolyr.geojson',
    },
    2: {
        windrh: 'https://www.spc.noaa.gov/products/fire_wx/day2fw_windrh.nolyr.geojson',
        dryt:   'https://www.spc.noaa.gov/products/fire_wx/day2fw_dryt.nolyr.geojson',
    },
};

// WPC ERO risk order and badge colors
const _WPC_RAIN_ORDER_FC = ['MRGL', 'SLGT', 'MDT', 'HIGH'];
const _WPC_RAIN_LABELS_FC = { MRGL: 'Marginal', SLGT: 'Slight', MDT: 'Moderate', HIGH: 'High' };
const _WPC_RAIN_COLORS = {
    MRGL: { bg: 'rgba(0,160,130,0.18)',   border: '#00C8A8', text: '#00C8A8' },
    SLGT: { bg: 'rgba(100,180,20,0.18)',  border: '#90D030', text: '#90D030' },
    MDT:  { bg: 'rgba(200,30,30,0.17)',   border: '#FF5050', text: '#FF5050' },
    HIGH: { bg: 'rgba(220,40,220,0.15)',  border: '#FF73DF', text: '#FF73DF' },
};

// SPC Fire Weather risk order and badge colors
const _FIRE_RISK_ORDER_FC = ['ELEV', 'CRIT', 'EXTM'];
const _FIRE_RISK_LABELS_FC = { ELEV: 'Elevated', CRIT: 'Critical', EXTM: 'Extreme' };
const _FIRE_RISK_COLORS = {
    ELEV: { bg: 'rgba(180,120,20,0.15)', border: '#E8A840', text: '#E8A840' },
    CRIT: { bg: 'rgba(210,80,10,0.15)',  border: '#FF7030', text: '#FF7030' },
    EXTM: { bg: 'rgba(200,20,20,0.18)',  border: '#FF4040', text: '#FF4040' },
};

// Normalize WPC ERO properties to a short risk code.
// New ERO GeoJSON uses CATEGORY (short) or OUTLOOK (full name) depending on field present.
function _wpcRainLabelFC(props) {
    const cat = (props?.CATEGORY || '').trim().toUpperCase();
    if (_WPC_RAIN_ORDER_FC.indexOf(cat) >= 0) return cat;
    const outlook = (props?.OUTLOOK || '').trim().toUpperCase();
    const map = { MARGINAL: 'MRGL', SLIGHT: 'SLGT', MODERATE: 'MDT', HIGH: 'HIGH' };
    return map[outlook] || null;
}

// Fetch WPC ERO risk for one day
async function _fetchWPCRainRisk(lat, lng, day) {
    const url = _WPC_ERO_FORECAST_URLS[day];
    if (!url) return null;
    let data;
    try { data = await _fetchSPCGeoJSONForForecast(url); }
    catch (_) { return null; }

    const features = data?.features || [];
    let highestRisk = null;
    for (const feature of features) {
        const label = _wpcRainLabelFC(feature.properties);
        if (!label) continue;
        const idx = _WPC_RAIN_ORDER_FC.indexOf(label);
        if (idx < 0) continue;
        if (_spcPointInFeature(lng, lat, feature)) {
            if (!highestRisk || idx > _WPC_RAIN_ORDER_FC.indexOf(highestRisk)) highestRisk = label;
        }
    }
    return highestRisk;
}

// Fetch SPC Fire Weather risk for one day (merges both windrh and dryt component files)
async function _fetchSPCFireRisk(lat, lng, day) {
    const urls = _SPC_FIRE_FORECAST_URLS[day];
    if (!urls) return null;

    const [windrhRes, drytRes] = await Promise.allSettled([
        _fetchSPCGeoJSONForForecast(urls.windrh),
        _fetchSPCGeoJSONForForecast(urls.dryt),
    ]);

    const allFeatures = [
        ...(windrhRes.status === 'fulfilled' ? windrhRes.value?.features || [] : []),
        ...(drytRes.status === 'fulfilled' ? drytRes.value?.features || [] : []),
    ];

    let highestRisk = null;
    for (const feature of allFeatures) {
        // LABEL: 'ELEV', 'CRIT', or 'EXTCRIT' — normalize EXTCRIT → EXTM
        const raw = (feature.properties?.LABEL || feature.properties?.CATEGORY || '').trim().toUpperCase();
        const label = raw === 'EXTCRIT' ? 'EXTM' : raw;
        const idx = _FIRE_RISK_ORDER_FC.indexOf(label);
        if (idx < 0) continue;
        if (_spcPointInFeature(lng, lat, feature)) {
            if (!highestRisk || idx > _FIRE_RISK_ORDER_FC.indexOf(highestRisk)) highestRisk = label;
        }
    }
    return highestRisk;
}

// Update the WPC rain badge chip in a forecast row
function _updateWPCRainBadge(forecastDayIndex) {
    const badge = document.getElementById('wpc-rain-badge-' + forecastDayIndex);
    if (!badge) return;
    const day = forecastDayIndex + 1;
    const risk = day <= 3 ? (_wpcRainCache[day] ?? null) : null;
    const col = risk ? _WPC_RAIN_COLORS[risk] : null;
    if (!col) { badge.style.display = 'none'; return; }

    const label = _WPC_RAIN_LABELS_FC[risk] || risk;
    badge.style.cssText =
        `display:inline-block;font-size:0.6rem;font-weight:700;padding:1px 5px;` +
        `border-radius:4px;background:${col.bg};border:1px solid ${col.border};` +
        `color:${col.text};margin-left:5px;vertical-align:middle;white-space:nowrap;`;
    badge.textContent = '\uD83D\uDCA7 ' + label;

    if (_openDayDetailIndex === forecastDayIndex) _refreshDayDetailWPCRainInfo();
}

// Update the fire weather badge chip in a forecast row
function _updateFireBadge(forecastDayIndex) {
    const badge = document.getElementById('fire-badge-' + forecastDayIndex);
    if (!badge) return;
    const day = forecastDayIndex + 1;
    const risk = day <= 2 ? (_spcFireCache[day] ?? null) : null;
    const col = risk ? _FIRE_RISK_COLORS[risk] : null;
    if (!col) { badge.style.display = 'none'; return; }

    const label = _FIRE_RISK_LABELS_FC[risk] || risk;
    badge.style.cssText =
        `display:inline-block;font-size:0.6rem;font-weight:700;padding:1px 5px;` +
        `border-radius:4px;background:${col.bg};border:1px solid ${col.border};` +
        `color:${col.text};margin-left:5px;vertical-align:middle;white-space:nowrap;`;
    badge.textContent = '\uD83D\uDD25 ' + label;

    if (_openDayDetailIndex === forecastDayIndex) _refreshDayDetailFireInfo();
}

// Refresh (or clear) the WPC rain info block inside the day-detail panel
function _refreshDayDetailWPCRainInfo() {
    const el = document.getElementById('detail-wpc-rainfall');
    if (!el) return;
    const day = _openDayDetailIndex + 1;
    const risk = day <= 3 ? (_wpcRainCache[day] ?? null) : null;
    if (risk) {
        const col = _WPC_RAIN_COLORS[risk] || {};
        const label = _WPC_RAIN_LABELS_FC[risk] || risk;
        el.style.cssText =
            `display:block;margin-top:10px;padding:10px 12px;border-radius:8px;` +
            `font-size:0.88rem;line-height:1.5;` +
            `background:${col.bg || 'rgba(0,160,130,0.12)'};` +
            `border:1px solid ${col.border || 'rgba(0,160,130,0.35)'};` +
            `color:var(--text-secondary);`;
        el.innerHTML =
            `<strong style="color:${col.text || '#00C8A8'};">\uD83D\uDCA7 Excessive Rainfall Outlook</strong><br>` +
            `${label} risk of excessive rainfall and potential flash flooding.`;
    } else {
        el.style.display = 'none';
    }
}

// Refresh (or clear) the fire weather info block inside the day-detail panel
function _refreshDayDetailFireInfo() {
    const el = document.getElementById('detail-fire-weather');
    if (!el) return;
    const day = _openDayDetailIndex + 1;
    const risk = day <= 2 ? (_spcFireCache[day] ?? null) : null;
    if (risk) {
        const col = _FIRE_RISK_COLORS[risk] || {};
        const label = _FIRE_RISK_LABELS_FC[risk] || risk;
        el.style.cssText =
            `display:block;margin-top:10px;padding:10px 12px;border-radius:8px;` +
            `font-size:0.88rem;line-height:1.5;` +
            `background:${col.bg || 'rgba(180,120,20,0.12)'};` +
            `border:1px solid ${col.border || 'rgba(180,120,20,0.35)'};` +
            `color:var(--text-secondary);`;
        el.innerHTML =
            `<strong style="color:${col.text || '#E8A840'};">\uD83D\uDD25 Fire Weather Outlook</strong><br>` +
            `${label} fire weather conditions are possible due to low humidity and/or strong winds.`;
    } else {
        el.style.display = 'none';
    }
}

// Kick off all WPC rain and fire weather fetches concurrently
async function _loadWPCFireForecastData(lat, lng) {
    await Promise.allSettled([
        // WPC Excessive Rainfall – Days 1-3
        ...[1, 2, 3].map(async (day) => {
            try {
                const risk = await _fetchWPCRainRisk(lat, lng, day);
                _wpcRainCache[day] = risk;
                _updateWPCRainBadge(day - 1);
            } catch (_) { /* graceful degradation */ }
        }),
        // SPC Fire Weather – Days 1-2
        ...[1, 2].map(async (day) => {
            try {
                const risk = await _fetchSPCFireRisk(lat, lng, day);
                _spcFireCache[day] = risk;
                _updateFireBadge(day - 1);
            } catch (_) { /* graceful degradation */ }
        }),
    ]);
}
