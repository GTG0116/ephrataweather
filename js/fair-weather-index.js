// ============================================
// FAIR WEATHER INDEX
// Rates a day on a 1–5 scale based on:
//   temperature (seasonally adjusted), feels like,
//   humidity, wind speed/gusts, cloud cover, and precipitation
//
// Designed to work with both daily and hourly forecast objects.
// ============================================

const FairWeatherIndex = (() => {

    // Monthly seasonal comfort zone center (feels-like °F)
    // Represents a "pleasant outdoor activity" expectation for each month.
    // A warm January day (50°F) should score similarly to a warm July day (85°F).
    const SEASONAL_CENTER = [
        45, // Jan — cold is expected; 45°F is a nice day
        48, // Feb
        55, // Mar
        63, // Apr
        70, // May
        76, // Jun
        82, // Jul
        80, // Aug
        72, // Sep
        62, // Oct
        51, // Nov
        45  // Dec
    ];

    // Width of the "full score" comfort zone around the seasonal center (°F)
    const COMFORT_WINDOW = 8;

    // Rating thresholds — score is 0–100
    const RATINGS = [
        { min: 83, score: 5, label: 'Excellent',      color: '#4CAF50', bg: 'rgba(76,175,80,0.18)',   short: 'EXC'  },
        { min: 65, score: 4, label: 'Good',           color: '#8BC34A', bg: 'rgba(139,195,74,0.15)', short: 'GOOD' },
        { min: 45, score: 3, label: 'OK',             color: '#FFC107', bg: 'rgba(255,193,7,0.18)',   short: 'OK'   },
        { min: 25, score: 2, label: 'Poor',           color: '#FF7043', bg: 'rgba(255,112,67,0.2)',   short: 'POOR' },
        { min:  0, score: 1, label: 'Extremely Poor', color: '#EF5350', bg: 'rgba(239,83,80,0.22)',   short: 'X.POOR' },
    ];

    function _clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

    // ── Component scorers ─────────────────────────────────────────────────────

    // Feels-like temperature, seasonally adjusted (max 25 pts)
    function _scoreTemperature(feelsLike, month) {
        if (feelsLike == null) return { pts: null, max: 25, available: false };
        const center = SEASONAL_CENTER[month];
        const diff = Math.abs(feelsLike - center);
        let pts;
        if (diff <= COMFORT_WINDOW)          pts = 25;
        else if (diff <= COMFORT_WINDOW + 7) pts = 25 - ((diff - COMFORT_WINDOW) / 7) * 10; // 25→15
        else if (diff <= COMFORT_WINDOW + 17) pts = 15 - ((diff - COMFORT_WINDOW - 7) / 10) * 12; // 15→3
        else                                  pts = Math.max(0, 3 - (diff - COMFORT_WINDOW - 17) * 0.3);
        return { pts: _clamp(pts, 0, 25), max: 25, available: true };
    }

    // Relative humidity (max 15 pts)
    function _scoreHumidity(humidity) {
        if (humidity == null) return { pts: null, max: 15, available: false };
        let pts;
        if      (humidity >= 35 && humidity <= 60) pts = 15;
        else if (humidity >= 25 && humidity <= 70) pts = 11;
        else if (humidity >= 15 && humidity <= 80) pts = 6;
        else if (humidity >=  5 && humidity <= 90) pts = 2;
        else                                       pts = 0;
        return { pts, max: 15, available: true };
    }

    // Wind speed + gust (max 20 pts)
    function _scoreWind(windSpeed, windGust) {
        if (windSpeed == null) return { pts: null, max: 20, available: false };
        let pts;
        if      (windSpeed <=  8) pts = 20;
        else if (windSpeed <= 15) pts = 20 - ((windSpeed -  8) /  7) * 6;   // 20→14
        else if (windSpeed <= 25) pts = 14 - ((windSpeed - 15) / 10) * 9;   // 14→5
        else if (windSpeed <= 35) pts =  5 - ((windSpeed - 25) / 10) * 5;   // 5→0
        else                      pts = 0;

        // Extra penalty when gusts are much higher than sustained winds
        if (windGust != null && windGust > windSpeed + 10) {
            const extra = Math.min(6, (windGust - windSpeed - 10) * 0.4);
            pts = Math.max(0, pts - extra);
        }
        return { pts: _clamp(pts, 0, 20), max: 20, available: true };
    }

    // Cloud cover percentage (max 15 pts)
    function _scoreCloudCover(cloudCover) {
        if (cloudCover == null) return { pts: null, max: 15, available: false };
        let pts;
        if      (cloudCover <= 20) pts = 15;
        else if (cloudCover <= 40) pts = 13;
        else if (cloudCover <= 60) pts = 9;
        else if (cloudCover <= 80) pts = 5;
        else                       pts = 2;
        return { pts, max: 15, available: true };
    }

    // Precipitation probability + condition severity (max 25 pts)
    function _scorePrecipitation(precipChance, conditionType, precipAmountMm) {
        if (precipChance == null) return { pts: null, max: 25, available: false };

        // Base score from probability
        let pts;
        if      (precipChance <=  0) pts = 25;
        else if (precipChance <= 15) pts = 22;
        else if (precipChance <= 30) pts = 16;
        else if (precipChance <= 50) pts = 10;
        else if (precipChance <= 70) pts =  5;
        else                         pts =  0;

        // Cap score based on condition severity
        const type = (conditionType || '').toUpperCase();
        if      (type.includes('HEAVY_THUNDERSTORM') || type === 'HAIL') pts = Math.min(pts, 1);
        else if (type.includes('THUNDER'))                                pts = Math.min(pts, 4);
        else if (type === 'HEAVY_RAIN' || type === 'SLEET')              pts = Math.min(pts, 6);
        else if (type === 'RAIN' || type === 'FREEZING_RAIN')            pts = Math.min(pts, 10);
        else if (type === 'SNOW' || type === 'HEAVY_SNOW')               pts = Math.min(pts, 8);
        else if (type === 'LIGHT_RAIN' || type === 'DRIZZLE'
              || type === 'LIGHT_SNOW' || type === 'FLURRIES'
              || type === 'FREEZING_DRIZZLE')                            pts = Math.min(pts, 14);

        // Additional penalty for meaningful accumulation
        if (precipAmountMm != null) {
            const inches = precipAmountMm / 25.4;
            if      (inches > 1.0) pts = Math.max(0, pts - 5);
            else if (inches > 0.5) pts = Math.max(0, pts - 3);
            else if (inches > 0.1) pts = Math.max(0, pts - 1);
        }

        return { pts: _clamp(pts, 0, 25), max: 25, available: true };
    }

    // ── Main calculator ───────────────────────────────────────────────────────

    /**
     * Calculate the fair weather index for a forecast day (or hour).
     *
     * @param {Object} day  - A daily or hourly forecast object
     * @returns {{ score, label, short, color, bg, score100, details }}
     */
    function calculate(day) {
        // Determine the month from the day's date string
        const dateStr = day.displayDate || day.interval?.startTime;
        let month = new Date().getMonth(); // fallback to current month
        if (dateStr) {
            if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
                month = parseInt(dateStr.split('-')[1], 10) - 1;
            } else {
                const d = new Date(dateStr);
                if (!isNaN(d)) month = d.getMonth();
            }
        }

        // Pull values — support both daily and hourly field shapes
        const feelsLike     = day.feelsLikeMax?.degrees
                           ?? day.feelsLike?.degrees
                           ?? null;
        const humidity      = day.relativeHumidity ?? day.avgHumidity ?? null;
        const windSpeed     = day.maxWind?.speed?.value ?? day.wind?.speed?.value ?? null;
        const windGust      = day.windGust ?? null;
        const cloudCover    = day.cloudCover ?? null;
        const precipChance  = day.precipitation?.probability ?? null;
        const precipAmount  = day.precipitation?.qpf?.millimeters ?? null;
        const conditionType = day.weatherCondition?.type ?? '';

        // Score each factor
        const tempResult   = _scoreTemperature(feelsLike, month);
        const humidResult  = _scoreHumidity(humidity);
        const windResult   = _scoreWind(windSpeed, windGust);
        const cloudResult  = _scoreCloudCover(cloudCover);
        const precipResult = _scorePrecipitation(precipChance, conditionType, precipAmount);

        const components = [tempResult, humidResult, windResult, cloudResult, precipResult];

        // Sum available points; for unavailable components use a neutral 60% of max
        let totalPts = 0, totalMax = 0;
        components.forEach(c => {
            totalMax += c.max;
            if (c.available && c.pts != null) {
                totalPts += c.pts;
            } else {
                totalPts += c.max * 0.6; // neutral placeholder
            }
        });

        const score100 = totalMax > 0 ? _clamp((totalPts / totalMax) * 100, 0, 100) : 50;
        const rating = RATINGS.find(r => score100 >= r.min) ?? RATINGS[RATINGS.length - 1];

        return {
            score:    rating.score,
            label:    rating.label,
            short:    rating.short,
            color:    rating.color,
            bg:       rating.bg,
            score100: Math.round(score100),
            details: {
                temperature:   tempResult,
                humidity:      humidResult,
                wind:          windResult,
                cloudCover:    cloudResult,
                precipitation: precipResult,
                feelsLike,
                month,
                seasonalCenter: SEASONAL_CENTER[month],
            },
        };
    }

    return { calculate, RATINGS, SEASONAL_CENTER };
})();
