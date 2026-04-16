// ============================================
// HISTORICAL WEATHER SEARCH
// Uses Open-Meteo Archive API
// Data available from January 1940
// ============================================

const HistoricalWeather = (() => {
    const ARCHIVE_BASE = 'https://archive-api.open-meteo.com/v1/archive';
    const MIN_YEAR = 1940;
    const ARCHIVE_DELAY_DAYS = 5;

    let _selectedDate = null;
    let _calYear = null;
    let _calMonth = null;

    function _maxDate() {
        const d = new Date();
        d.setDate(d.getDate() - ARCHIVE_DELAY_DAYS);
        return d;
    }

    function _todayStr() {
        const d = new Date();
        return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    }

    function _formatDate(dateStr) {
        if (!dateStr) return '';
        const [y, m, d] = dateStr.split('-').map(Number);
        return new Date(y, m - 1, d).toLocaleDateString('en-US', {
            weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
        });
    }

    function _windDir(deg) {
        if (deg == null) return '--';
        const dirs = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
        return dirs[Math.round(deg / 22.5) % 16];
    }

    function _uvLabel(uv) {
        if (uv == null) return '--';
        if (uv <= 2) return 'Low';
        if (uv <= 5) return 'Moderate';
        if (uv <= 7) return 'High';
        if (uv <= 10) return 'Very High';
        return 'Extreme';
    }

    function _cloudLabel(pct) {
        if (pct == null) return '--';
        if (pct < 10) return 'Clear';
        if (pct < 30) return 'Mostly Clear';
        if (pct < 60) return 'Partly Cloudy';
        if (pct < 85) return 'Mostly Cloudy';
        return 'Overcast';
    }

    function _sunshineHours(seconds) {
        if (seconds == null) return '--';
        const h = Math.floor(seconds / 3600);
        const m = Math.round((seconds % 3600) / 60);
        if (h === 0) return `${m}m`;
        if (m === 0) return `${h}h`;
        return `${h}h ${m}m`;
    }

    function _fmtTime(iso) {
        if (!iso) return '--';
        return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    }

    // -------------------------------------------------------
    // CALENDAR
    // -------------------------------------------------------
    function _renderCalendar() {
        const container = document.getElementById('hist-calendar');
        if (!container) return;

        const maxD = _maxDate();
        const maxYear = maxD.getFullYear();
        const maxMonth = maxD.getMonth();

        if (_calYear === null) { _calYear = maxYear; _calMonth = maxMonth; }
        if (_calYear < MIN_YEAR) { _calYear = MIN_YEAR; _calMonth = 0; }
        if (_calYear > maxYear || (_calYear === maxYear && _calMonth > maxMonth)) {
            _calYear = maxYear; _calMonth = maxMonth;
        }

        const MONTH_NAMES = ['January','February','March','April','May','June',
                             'July','August','September','October','November','December'];
        const prevDisabled = (_calYear === MIN_YEAR && _calMonth === 0);
        const nextDisabled = (_calYear === maxYear && _calMonth === maxMonth);
        const firstDay = new Date(_calYear, _calMonth, 1).getDay();
        const daysInMonth = new Date(_calYear, _calMonth + 1, 0).getDate();
        const todayStr = _todayStr();

        let daysHtml = ['Su','Mo','Tu','We','Th','Fr','Sa']
            .map(d => `<div class="hist-cal-dow">${d}</div>`).join('');

        for (let i = 0; i < firstDay; i++) {
            daysHtml += `<div class="hist-cal-day empty"></div>`;
        }
        for (let d = 1; d <= daysInMonth; d++) {
            const ds = `${_calYear}-${String(_calMonth+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
            const isDisabled = new Date(_calYear, _calMonth, d) > maxD;
            let cls = 'hist-cal-day';
            if (ds === _selectedDate) cls += ' selected';
            if (ds === todayStr) cls += ' today';
            if (isDisabled) cls += ' disabled';
            daysHtml += isDisabled
                ? `<div class="${cls}">${d}</div>`
                : `<div class="${cls}" onclick="HistoricalWeather.selectDate('${ds}')">${d}</div>`;
        }

        let yearOpts = '';
        for (let y = maxYear; y >= MIN_YEAR; y--) {
            yearOpts += `<option value="${y}"${y === _calYear ? ' selected' : ''}>${y}</option>`;
        }
        const monthOpts = MONTH_NAMES.map((n, i) =>
            `<option value="${i}"${i === _calMonth ? ' selected' : ''}>${n}</option>`).join('');

        container.innerHTML = `
            <div class="hist-cal-nav">
                <button class="hist-cal-btn" onclick="HistoricalWeather.prevMonth()"${prevDisabled ? ' disabled' : ''}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="15 18 9 12 15 6"/></svg>
                </button>
                <div class="hist-cal-title">
                    <select class="hist-select" onchange="HistoricalWeather.setMonth(this.value)">${monthOpts}</select>
                    <select class="hist-select" onchange="HistoricalWeather.setYear(this.value)">${yearOpts}</select>
                </div>
                <button class="hist-cal-btn" onclick="HistoricalWeather.nextMonth()"${nextDisabled ? ' disabled' : ''}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="9 18 15 12 9 6"/></svg>
                </button>
            </div>
            <div class="hist-cal-grid">${daysHtml}</div>
            <div class="hist-cal-note">Archive data available Jan 1940 &ndash; ${MONTH_NAMES[maxD.getMonth()]} ${maxD.getDate()}, ${maxD.getFullYear()}</div>
        `;
    }

    // -------------------------------------------------------
    // DATA FETCH
    // -------------------------------------------------------
    async function _fetchDay(lat, lng, dateStr) {
        const daily = [
            'weather_code',
            'temperature_2m_max','temperature_2m_min','temperature_2m_mean',
            'apparent_temperature_max','apparent_temperature_min',
            'precipitation_sum','rain_sum','snowfall_sum',
            'wind_speed_10m_max','wind_gusts_10m_max','wind_direction_10m_dominant',
            'cloud_cover_mean','pressure_msl_mean','relative_humidity_2m_mean',
            'dew_point_2m_mean','sunshine_duration','uv_index_max',
            'sunrise','sunset'
        ].join(',');

        const hourly = [
            'temperature_2m','apparent_temperature','relative_humidity_2m',
            'dew_point_2m','precipitation','weather_code',
            'wind_speed_10m','wind_direction_10m','wind_gusts_10m',
            'cloud_cover','pressure_msl','visibility','uv_index'
        ].join(',');

        const params = new URLSearchParams({
            latitude: lat, longitude: lng,
            start_date: dateStr, end_date: dateStr,
            daily, hourly,
            temperature_unit: 'fahrenheit',
            wind_speed_unit: 'mph',
            precipitation_unit: 'inch',
            timezone: 'auto'
        });

        const resp = await fetch(`${ARCHIVE_BASE}?${params}`);
        if (!resp.ok) throw new Error(`Archive API returned ${resp.status}`);
        return resp.json();
    }

    // -------------------------------------------------------
    // RENDER RESULT
    // -------------------------------------------------------
    function _renderResult(data, dateStr) {
        const container = document.getElementById('hist-result');
        if (!container) return;

        if (!data?.daily?.time?.length) {
            container.innerHTML = '<div class="hist-message glass-static">No data available for this date and location.</div>';
            return;
        }

        const d = data.daily;
        const h = data.hourly;
        const i = 0;

        const cond = _wmoCondition(d.weather_code?.[i]);
        const iconSvg = WeatherIcons.get(cond.type, 80);

        const tempMax  = d.temperature_2m_max?.[i];
        const tempMin  = d.temperature_2m_min?.[i];
        const feelsMax = d.apparent_temperature_max?.[i];
        const feelsMin = d.apparent_temperature_min?.[i];
        const precip   = d.precipitation_sum?.[i];
        const rain     = d.rain_sum?.[i];
        const snow     = d.snowfall_sum?.[i];
        const windMax  = d.wind_speed_10m_max?.[i];
        const windGust = d.wind_gusts_10m_max?.[i];
        const windDir  = d.wind_direction_10m_dominant?.[i];
        const cloud    = d.cloud_cover_mean?.[i];
        const pressure = d.pressure_msl_mean?.[i];
        const humidity = d.relative_humidity_2m_mean?.[i];
        const dew      = d.dew_point_2m_mean?.[i];
        const sunshine = d.sunshine_duration?.[i];
        const uv       = d.uv_index_max?.[i];
        const sunrise  = d.sunrise?.[i];
        const sunset   = d.sunset?.[i];

        // Hourly strip
        let hourlyHtml = '';
        if (h?.time) {
            h.time.forEach((t, idx) => {
                if (!t.startsWith(dateStr)) return;
                const hourNum = parseInt(t.slice(11, 13), 10);
                const label = hourNum === 0 ? '12 AM' : hourNum < 12 ? `${hourNum} AM` : hourNum === 12 ? '12 PM' : `${hourNum - 12} PM`;
                const temp = h.temperature_2m?.[idx];
                const precH = h.precipitation?.[idx];
                const hcond = _wmoCondition(h.weather_code?.[idx]);
                const hIcon = WeatherIcons.get(hcond.type, 32);
                const wind = h.wind_speed_10m?.[idx];
                hourlyHtml += `
                    <div class="hist-hourly-item">
                        <div class="hist-hourly-time">${label}</div>
                        <div class="hist-hourly-icon">${hIcon}</div>
                        <div class="hist-hourly-temp">${temp != null ? Math.round(temp) + '°' : '--'}</div>
                        <div class="hist-hourly-wind">${wind != null ? Math.round(wind) + ' mph' : '--'}</div>
                        <div class="hist-hourly-precip">${precH != null && precH > 0 ? precH.toFixed(2) + '"' : ''}</div>
                    </div>`;
            });
        }

        const precipDetail = (() => {
            const parts = [];
            if (rain != null && rain > 0) parts.push(`Rain: ${rain.toFixed(2)}"`);
            if (snow != null && snow > 0) parts.push(`Snow: ${snow.toFixed(1)}"`);
            return parts.length ? parts.join(' · ') : 'No precipitation';
        })();

        container.innerHTML = `
            <div class="hist-result-hero glass-static fade-in">
                <div class="hist-hero-left">
                    <div class="hist-date-label">${_formatDate(dateStr)}</div>
                    <div class="hist-temp-range">
                        <span class="hist-temp-hi">${tempMax != null ? Math.round(tempMax) + '°' : '--'}</span>
                        <span class="hist-temp-sep"> / </span>
                        <span class="hist-temp-lo">${tempMin != null ? Math.round(tempMin) + '°' : '--'}</span>
                        <span class="hist-temp-unit">°F</span>
                    </div>
                    <div class="hist-condition-text">${cond.description}</div>
                    <div class="hist-feels">Feels like ${feelsMax != null ? Math.round(feelsMax) + '°' : '--'} high / ${feelsMin != null ? Math.round(feelsMin) + '°' : '--'} low</div>
                </div>
                <div class="hist-hero-icon">${iconSvg}</div>
            </div>

            ${hourlyHtml ? `
            <h3 class="section-title" style="margin-top:20px;margin-bottom:12px;">Hourly Breakdown</h3>
            <div class="hist-hourly-wrap glass-static fade-in">
                <div class="hist-hourly-scroll">${hourlyHtml}</div>
            </div>` : ''}

            <h3 class="section-title" style="margin-bottom:12px;">Day Summary</h3>
            <div class="cards-grid cards-grid-3 fade-in" style="margin-bottom:24px;">

                <div class="card glass">
                    <div class="card-header">
                        <span class="card-title">Peak Wind</span>
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.4)" stroke-width="2" stroke-linecap="round"><path d="M9.59 4.59A2 2 0 1 1 11 8H2m10.59 11.41A2 2 0 1 0 14 16H2m15.73-8.27A2.5 2.5 0 1 1 19.5 12H2"/></svg>
                    </div>
                    <div class="card-value">${windMax != null ? Math.round(windMax) : '--'}<span class="unit"> mph</span></div>
                    <div class="card-detail">${windGust != null ? Math.round(windGust) + ' mph gusts' : '--'} &middot; ${_windDir(windDir)}</div>
                </div>

                <div class="card glass">
                    <div class="card-header">
                        <span class="card-title">Avg Humidity</span>
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.4)" stroke-width="2" stroke-linecap="round"><path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z"/></svg>
                    </div>
                    <div class="card-value">${humidity != null ? Math.round(humidity) : '--'}<span class="unit">%</span></div>
                    <div class="card-detail">Dew point: ${dew != null ? Math.round(dew) + '°F' : '--'}</div>
                </div>

                <div class="card glass">
                    <div class="card-header">
                        <span class="card-title">Peak UV Index</span>
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.4)" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>
                    </div>
                    <div class="card-value">${uv != null ? uv.toFixed(1) : '--'}</div>
                    <div class="card-detail">${_uvLabel(uv)}</div>
                </div>

                <div class="card glass">
                    <div class="card-header">
                        <span class="card-title">Avg Pressure</span>
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.4)" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/></svg>
                    </div>
                    <div class="card-value">${pressure != null ? (pressure * 0.02953).toFixed(2) : '--'}<span class="unit"> inHg</span></div>
                    <div class="card-detail">${pressure != null ? Math.round(pressure) + ' hPa' : '--'}</div>
                </div>

                <div class="card glass">
                    <div class="card-header">
                        <span class="card-title">Avg Cloud Cover</span>
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.4)" stroke-width="2" stroke-linecap="round"><path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"/></svg>
                    </div>
                    <div class="card-value">${cloud != null ? Math.round(cloud) : '--'}<span class="unit">%</span></div>
                    <div class="card-detail">${_cloudLabel(cloud)}</div>
                </div>

                <div class="card glass">
                    <div class="card-header">
                        <span class="card-title">Precipitation</span>
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.4)" stroke-width="2" stroke-linecap="round"><line x1="8" y1="19" x2="8" y2="21"/><line x1="8" y1="13" x2="8" y2="15"/><line x1="16" y1="19" x2="16" y2="21"/><line x1="16" y1="13" x2="16" y2="15"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="12" y1="15" x2="12" y2="17"/><path d="M20 16.58A5 5 0 0 0 18 7h-1.26A8 8 0 1 0 4 15.25"/></svg>
                    </div>
                    <div class="card-value">${precip != null ? precip.toFixed(2) : '0.00'}<span class="unit">"</span></div>
                    <div class="card-detail">${precipDetail}</div>
                </div>

                ${snow != null && snow > 0 ? `
                <div class="card glass">
                    <div class="card-header">
                        <span class="card-title">Snowfall</span>
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.4)" stroke-width="2" stroke-linecap="round"><line x1="12" y1="2" x2="12" y2="22"/><path d="m20 10-8-8-8 8"/><path d="m20 14-8 8-8-8"/><line x1="2" y1="12" x2="22" y2="12"/></svg>
                    </div>
                    <div class="card-value">${snow.toFixed(1)}<span class="unit">"</span></div>
                    <div class="card-detail">Snowfall total</div>
                </div>` : ''}

                <div class="card glass">
                    <div class="card-header">
                        <span class="card-title">Sunshine</span>
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.4)" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>
                    </div>
                    <div class="card-value">${_sunshineHours(sunshine)}</div>
                    <div class="card-detail">Duration of sunshine</div>
                </div>

                <div class="card glass">
                    <div class="card-header">
                        <span class="card-title">Sun Times</span>
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.4)" stroke-width="2" stroke-linecap="round"><path d="M17 18a5 5 0 0 0-10 0"/><line x1="12" y1="2" x2="12" y2="9"/><line x1="4.22" y1="10.22" x2="5.64" y2="11.64"/><line x1="1" y1="18" x2="3" y2="18"/><line x1="21" y1="18" x2="23" y2="18"/><line x1="18.36" y1="11.64" x2="19.78" y2="10.22"/></svg>
                    </div>
                    <div class="card-value" style="font-size:1.15rem;">${_fmtTime(sunrise)}</div>
                    <div class="card-detail">Sunrise &middot; Sunset ${_fmtTime(sunset)}</div>
                </div>

            </div>
        `;
    }

    // -------------------------------------------------------
    // PUBLIC API
    // -------------------------------------------------------
    async function selectDate(dateStr) {
        _selectedDate = dateStr;
        _renderCalendar();

        const container = document.getElementById('hist-result');
        if (!container) return;
        container.innerHTML = `
            <div style="margin-top:24px;">
                <div class="loading-shimmer loading-placeholder" style="width:100%;height:160px;border-radius:var(--radius-lg);margin-bottom:16px;"></div>
                <div class="loading-shimmer loading-placeholder" style="width:100%;height:90px;border-radius:var(--radius-md);margin-bottom:16px;"></div>
                <div class="loading-shimmer loading-placeholder" style="width:100%;height:90px;border-radius:var(--radius-md);"></div>
            </div>`;

        try {
            const loc = LocationManager.getCurrent();
            const data = await _fetchDay(loc.lat, loc.lng, dateStr);
            _renderResult(data, dateStr);
        } catch (err) {
            container.innerHTML = `<div class="hist-message glass-static" style="color:var(--accent-red);">Failed to load data: ${err.message}</div>`;
        }
    }

    function prevMonth() {
        if (_calMonth === 0) { _calYear--; _calMonth = 11; }
        else { _calMonth--; }
        _renderCalendar();
    }

    function nextMonth() {
        const maxD = _maxDate();
        if (_calYear === maxD.getFullYear() && _calMonth === maxD.getMonth()) return;
        if (_calMonth === 11) { _calYear++; _calMonth = 0; }
        else { _calMonth++; }
        _renderCalendar();
    }

    function setMonth(m) {
        _calMonth = parseInt(m, 10);
        const maxD = _maxDate();
        if (_calYear === maxD.getFullYear() && _calMonth > maxD.getMonth()) {
            _calMonth = maxD.getMonth();
        }
        _renderCalendar();
    }

    function setYear(y) {
        _calYear = parseInt(y, 10);
        const maxD = _maxDate();
        if (_calYear === maxD.getFullYear() && _calMonth > maxD.getMonth()) {
            _calMonth = maxD.getMonth();
        }
        _renderCalendar();
    }

    function init() {
        const maxD = _maxDate();
        _calYear = maxD.getFullYear();
        _calMonth = maxD.getMonth();
        _selectedDate = null;
        const result = document.getElementById('hist-result');
        if (result) result.innerHTML = '<div class="hist-message">Select a date on the calendar to view historical weather observations.</div>';
        const nameEl = document.getElementById('hist-location-name');
        if (nameEl) nameEl.textContent = LocationManager.getCurrent().name;
        _renderCalendar();
    }

    return { init, selectDate, prevMonth, nextMonth, setMonth, setYear };
})();
