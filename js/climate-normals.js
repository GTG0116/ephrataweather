// ============================================
// CLIMATE NORMALS
// Fetches historical average apparent (feels-like) max temperatures
// for a location using the Open-Meteo Archive API.
//
// Used by FairWeatherIndex to set location-specific
// temperature targets instead of hardcoded PA-centric values.
// ============================================

const ClimateNormals = (() => {
    const CACHE_KEY    = 'ephrata_climate_normals_v2';
    const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
    const YEARS        = 10; // number of complete past years to average

    // In-memory: { cacheKey, data: {'MM-DD': avgTempF}, timestamp }
    let _mem = null;

    function _locKey(lat, lng) {
        // Round to 2 decimal places (~1 km) — climate normals are stable at this scale
        return `${Math.round(lat * 100) / 100}_${Math.round(lng * 100) / 100}`;
    }

    function _fromStorage(key) {
        try {
            const s = localStorage.getItem(CACHE_KEY);
            if (!s) return null;
            const p = JSON.parse(s);
            if (p.cacheKey !== key) return null;
            if (Date.now() - p.timestamp > CACHE_TTL_MS) return null;
            return p.data;
        } catch { return null; }
    }

    function _toStorage(key, data) {
        try {
            localStorage.setItem(CACHE_KEY, JSON.stringify({
                cacheKey:  key,
                timestamp: Date.now(),
                data
            }));
        } catch {}
    }

    /**
     * Load climate normals for a location from the Open-Meteo Archive API.
     *
     * Fetches `apparent_temperature_max` (daily maximum apparent/feels-like
     * temperature) for the past YEARS complete calendar years and averages
     * each calendar day across all years.  Results are cached in localStorage
     * for 30 days.
     *
     * @param  {number} lat
     * @param  {number} lng
     * @returns {Promise<Object>}  Map of 'MM-DD' → average apparent max temp in °F
     */
    async function loadForLocation(lat, lng) {
        const key = _locKey(lat, lng);

        // In-memory hit (same session, same location)
        if (_mem && _mem.cacheKey === key) return _mem.data;

        // localStorage hit
        const stored = _fromStorage(key);
        if (stored) {
            _mem = { cacheKey: key, data: stored };
            return stored;
        }

        // Fetch from Open-Meteo Archive API
        const now       = new Date();
        const endYear   = now.getFullYear() - 1;        // last fully-complete year
        const startYear = endYear - YEARS + 1;          // e.g. 2016–2025

        const params = new URLSearchParams({
            latitude:         lat.toFixed(4),
            longitude:        lng.toFixed(4),
            start_date:       `${startYear}-01-01`,
            end_date:         `${endYear}-12-31`,
            daily:            'apparent_temperature_max',
            temperature_unit: 'fahrenheit',
            timezone:         'auto'
        });

        const resp = await fetch(`https://archive-api.open-meteo.com/v1/archive?${params}`);
        if (!resp.ok) throw new Error(`Climate normals fetch failed: ${resp.status}`);
        const json = await resp.json();

        const dates = json.daily?.time ?? [];
        const temps = json.daily?.apparent_temperature_max ?? [];

        // Bucket values by 'MM-DD'
        const buckets = {};
        dates.forEach((dateStr, i) => {
            const val = temps[i];
            if (val == null || isNaN(val)) return;
            const mmdd = dateStr.slice(5); // 'YYYY-MM-DD' → 'MM-DD'
            (buckets[mmdd] = buckets[mmdd] || []).push(val);
        });

        // Average each bucket, round to 1 decimal
        const data = {};
        for (const [mmdd, values] of Object.entries(buckets)) {
            data[mmdd] = Math.round(
                (values.reduce((a, b) => a + b, 0) / values.length) * 10
            ) / 10;
        }

        _toStorage(key, data);
        _mem = { cacheKey: key, data };
        return data;
    }

    /**
     * Return the historical average apparent max temperature for a given date.
     * Returns null if normals have not been loaded for this session yet.
     *
     * @param  {string|null} dateStr - 'YYYY-MM-DD' format
     * @returns {number|null} Temperature in °F, or null if unavailable
     */
    function getTargetTemp(dateStr) {
        if (!_mem?.data || !dateStr) return null;
        const mmdd = dateStr.length >= 10 ? dateStr.slice(5, 10) : dateStr;
        // If Feb-29 doesn't exist in the normals (non-leap-year coverage gap),
        // fall back to Feb-28
        return _mem.data[mmdd] ?? _mem.data['02-28'] ?? null;
    }

    return { loadForLocation, getTargetTemp };
})();
