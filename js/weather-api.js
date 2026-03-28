// ============================================
// WEATHER API HELPER
// Primary: Google Weather API (GET with query params)
// Fallback: Open-Meteo (free, CORS-enabled)
// Optional: NWS (National Weather Service) — user-selectable
// Optional: Open-Meteo — direct Open-Meteo source
// Optional: OWM (OpenWeatherMap) — user-selectable
// ============================================

// --- Data Source Preference ---
const _DATA_SOURCE_KEY = 'ephrata_data_source';
function _getDataSource() { return localStorage.getItem(_DATA_SOURCE_KEY) || 'nws'; }
function _setDataSource(src) { localStorage.setItem(_DATA_SOURCE_KEY, src); }

// --- NWS Helpers ---

// Map NWS text description to our internal condition type codes
function _nwsConditionType(text) {
    if (!text) return 'PARTLY_CLOUDY';
    const t = text.toLowerCase();
    if (t.includes('thunderstorm') || t.includes('t-storm')) return t.includes('heavy') ? 'HEAVY_THUNDERSTORM' : 'THUNDERSTORM';
    if (t.includes('heavy rain') || t.includes('heavy shower')) return 'HEAVY_RAIN';
    if (t.includes('light rain') || t.includes('drizzle')) return 'LIGHT_RAIN';
    if (t.includes('rain') || t.includes('shower')) return 'RAIN';
    if (t.includes('blizzard') || t.includes('heavy snow')) return 'HEAVY_SNOW';
    if (t.includes('light snow') || t.includes('flurr')) return 'LIGHT_SNOW';
    if (t.includes('snow')) return 'SNOW';
    if (t.includes('sleet') || t.includes('freezing rain') || t.includes('ice pellet')) return 'SLEET';
    if (t.includes('freezing') || t.includes('ice')) return 'FREEZING_RAIN';
    if (t.includes('fog') || t.includes('mist') || t.includes('haze')) return 'FOG';
    if (t.includes('mostly sunny') || t.includes('mostly clear')) return 'MOSTLY_CLEAR';
    if (t.includes('partly cloudy') || t.includes('partly sunny') || t.includes('mix of sun')) return 'PARTLY_CLOUDY';
    if (t.includes('clear') || t.includes('sunny')) return 'CLEAR';
    if (t.includes('overcast') || t.includes('cloudy')) return t.includes('mostly') ? 'MOSTLY_CLOUDY' : 'OVERCAST';
    if (t.includes('windy') || t.includes('breezy')) return 'WIND';
    if (t.includes('hail')) return 'HAIL';
    return 'PARTLY_CLOUDY';
}

// Convert NWS cloud layer amount code to percentage
function _nwsCloudAmount(amount) {
    const map = { CLR: 0, SKC: 0, FEW: 12, SCT: 37, BKN: 75, OVC: 100, VV: 100 };
    return map[String(amount).toUpperCase()] ?? null;
}

// Convert NWS cardinal wind direction to degrees
function _nwsCardinalToDeg(dir) {
    if (dir == null) return null;
    if (typeof dir === 'number') return dir;
    const map = { N: 0, NNE: 22, NE: 45, ENE: 67, E: 90, ESE: 112, SE: 135, SSE: 157,
                  S: 180, SSW: 202, SW: 225, WSW: 247, W: 270, WNW: 292, NW: 315, NNW: 337 };
    return map[String(dir).toUpperCase().trim()] ?? 0;
}

// Parse NWS wind speed string like "10 mph", "10.5 mph", or "10 to 15 mph" → number
// For ranges, returns the higher value (max wind speed)
function _nwsWindSpeed(str) {
    if (str == null) return null;
    if (typeof str === 'number') return str;
    const s = String(str);
    // Handle ranges like "10 to 15 mph" — take the higher value
    const range = s.match(/(\d+\.?\d*)\s+to\s+(\d+\.?\d*)/i);
    if (range) return parseFloat(range[2]);
    const m = s.match(/(\d+\.?\d*)/);
    return m ? parseFloat(m[1]) : null;
}

// NWS grid points cache (avoids redundant /points requests)
const _nwsPointsCache = {};
async function _getNWSPoints(lat, lng) {
    const key = `${Number(lat).toFixed(3)},${Number(lng).toFixed(3)}`;
    if (_nwsPointsCache[key]) return _nwsPointsCache[key];
    const resp = await fetch(`https://api.weather.gov/points/${lat},${lng}`, {
        headers: { 'Accept': 'application/geo+json', 'User-Agent': 'EphrataWeather/1.0' }
    });
    if (!resp.ok) throw new Error(`NWS /points ${resp.status}`);
    const data = await resp.json();
    _nwsPointsCache[key] = data.properties;
    return data.properties;
}

// Fetch hourly wind speed + direction from Open-Meteo (used to supplement NWS data)
async function _fetchOpenMeteoWindHourly(lat, lng, forecastDays = 3) {
    const params = new URLSearchParams({
        latitude: lat, longitude: lng,
        hourly: 'wind_speed_10m,wind_direction_10m,wind_gusts_10m',
        wind_speed_unit: 'mph',
        timezone: 'auto',
        forecast_days: forecastDays
    });
    const resp = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`, { cache: 'no-store' });
    if (!resp.ok) return null;
    const data = await resp.json();
    const h = data.hourly;
    // Build a map from truncated ISO hour string ("2025-06-01T14:00") to wind values
    const map = {};
    (h.time || []).forEach((t, i) => {
        map[t.slice(0, 16)] = {
            speed: h.wind_speed_10m[i],
            direction: h.wind_direction_10m[i],
            gust: h.wind_gusts_10m?.[i] ?? null
        };
    });
    return map;
}

// Fetch current wind from Open-Meteo
async function _fetchOpenMeteoWindCurrent(lat, lng) {
    const params = new URLSearchParams({
        latitude: lat, longitude: lng,
        current: 'wind_speed_10m,wind_direction_10m,wind_gusts_10m',
        wind_speed_unit: 'mph',
        timezone: 'auto'
    });
    const resp = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`, { cache: 'no-store' });
    if (!resp.ok) return null;
    const data = await resp.json();
    const c = data.current;
    return {
        speed: c.wind_speed_10m,
        direction: c.wind_direction_10m,
        gust: c.wind_gusts_10m ?? null
    };
}

// WMO Weather Codes for Open-Meteo fallback
const WMO_CODES = {
    0:  { type: 'CLEAR', description: 'Clear sky' },
    1:  { type: 'MOSTLY_CLEAR', description: 'Mainly clear' },
    2:  { type: 'PARTLY_CLOUDY', description: 'Partly cloudy' },
    3:  { type: 'OVERCAST', description: 'Overcast' },
    45: { type: 'FOG', description: 'Fog' },
    48: { type: 'FOG', description: 'Freezing fog' },
    51: { type: 'DRIZZLE', description: 'Light drizzle' },
    53: { type: 'DRIZZLE', description: 'Drizzle' },
    55: { type: 'DRIZZLE', description: 'Dense drizzle' },
    56: { type: 'FREEZING_DRIZZLE', description: 'Light freezing drizzle' },
    57: { type: 'FREEZING_DRIZZLE', description: 'Freezing drizzle' },
    61: { type: 'LIGHT_RAIN', description: 'Light rain' },
    63: { type: 'RAIN', description: 'Rain' },
    65: { type: 'HEAVY_RAIN', description: 'Heavy rain' },
    66: { type: 'FREEZING_RAIN', description: 'Light freezing rain' },
    67: { type: 'FREEZING_RAIN', description: 'Heavy freezing rain' },
    71: { type: 'LIGHT_SNOW', description: 'Light snow' },
    73: { type: 'SNOW', description: 'Snow' },
    75: { type: 'HEAVY_SNOW', description: 'Heavy snow' },
    77: { type: 'FLURRIES', description: 'Snow grains' },
    80: { type: 'LIGHT_RAIN', description: 'Light rain showers' },
    81: { type: 'RAIN', description: 'Rain showers' },
    82: { type: 'HEAVY_RAIN', description: 'Heavy rain showers' },
    85: { type: 'LIGHT_SNOW', description: 'Light snow showers' },
    86: { type: 'HEAVY_SNOW', description: 'Heavy snow showers' },
    95: { type: 'THUNDERSTORM', description: 'Thunderstorm' },
    96: { type: 'HAIL', description: 'Thunderstorm with hail' },
    99: { type: 'HAIL', description: 'Thunderstorm with heavy hail' }
};

function _wmoCondition(code) {
    return WMO_CODES[code] || { type: 'PARTLY_CLOUDY', description: 'Unknown' };
}

// Fetch sunrise/sunset times for day/night logic — tries Google first, then Open-Meteo
async function _fetchSunTimes(lat, lng, days) {
    try {
        const raw = await _googleGet('forecast/days:lookup', {
            'location.latitude': lat,
            'location.longitude': lng,
            'unitsSystem': 'IMPERIAL',
            'days': days,
            'pageSize': days
        });
        return (raw.forecastDays || []).map(day => ({
            displayDate: _googleDateToString(day.displayDate),
            sunrise: day.sunEvents?.sunriseTime,
            sunset: day.sunEvents?.sunsetTime
        }));
    } catch (e) {
        console.warn('Google sun times failed, falling back to Open-Meteo:', e.message);
    }
    // Fallback: Open-Meteo (free, no key needed)
    const params = new URLSearchParams({
        latitude: lat, longitude: lng,
        daily: 'sunrise,sunset',
        timezone: 'auto',
        forecast_days: Math.min(days, 16)
    });
    const resp = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`, { cache: 'no-store' });
    if (!resp.ok) return [];
    const data = await resp.json();
    const d = data.daily;
    return (d.time || []).map((t, i) => ({
        displayDate: t,
        sunrise: d.sunrise[i],
        sunset: d.sunset[i]
    }));
}

// --- Google Weather API helper (GET with query params) ---
async function _googleGet(endpoint, params) {
    const qp = new URLSearchParams(params);
    qp.set('key', CONFIG.GOOGLE_WEATHER_API_KEY);
    const url = `${CONFIG.GOOGLE_WEATHER_BASE}/${endpoint}?${qp}`;
    const resp = await fetch(url, { cache: 'no-store' });
    if (!resp.ok) throw new Error(`Google API ${resp.status}`);
    return resp.json();
}

// Convert Google displayDate {year, month, day} to "YYYY-MM-DD" string
function _googleDateToString(dd) {
    if (!dd) return null;
    if (typeof dd === 'string') return dd;
    return `${dd.year}-${String(dd.month).padStart(2, '0')}-${String(dd.day).padStart(2, '0')}`;
}

// Convert Google displayDateTime {year, month, day, hours, utcOffset} to ISO string
function _googleDateTimeToISO(dt) {
    if (!dt) return null;
    if (typeof dt === 'string') return dt;
    const d = new Date(dt.year, dt.month - 1, dt.day, dt.hours || 0);
    return d.toISOString();
}

// OWM condition code → our internal type (uses OWM weather id groups)
function _owmConditionType(id) {
    if (!id) return 'PARTLY_CLOUDY';
    if (id >= 200 && id < 300) return id >= 221 ? 'HEAVY_THUNDERSTORM' : 'THUNDERSTORM';
    if (id >= 300 && id < 400) return 'DRIZZLE';
    if (id === 500) return 'LIGHT_RAIN';
    if (id === 501) return 'RAIN';
    if (id >= 502 && id < 600) return 'HEAVY_RAIN';
    if (id === 511) return 'FREEZING_RAIN';
    if (id >= 520 && id < 530) return id === 522 || id === 531 ? 'HEAVY_RAIN' : 'RAIN';
    if (id === 600 || id === 620) return 'LIGHT_SNOW';
    if (id === 601 || id === 621) return 'SNOW';
    if (id >= 602 && id < 620) return 'HEAVY_SNOW';
    if (id >= 611 && id <= 616) return 'SLEET';
    if (id >= 700 && id < 800) return 'FOG';
    if (id === 800) return 'CLEAR';
    if (id === 801) return 'MOSTLY_CLEAR';
    if (id === 802) return 'PARTLY_CLOUDY';
    if (id === 803) return 'MOSTLY_CLOUDY';
    if (id === 804) return 'OVERCAST';
    return 'PARTLY_CLOUDY';
}

// Fetch complete Open-Meteo current conditions (dedicated, not fallback)
async function _fetchOpenMeteoCurrent(lat, lng) {
    const params = new URLSearchParams({
        latitude: lat, longitude: lng,
        current: 'temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,cloud_cover,pressure_msl,wind_speed_10m,wind_direction_10m,wind_gusts_10m,uv_index,dew_point_2m,visibility',
        temperature_unit: 'fahrenheit',
        wind_speed_unit: 'mph',
        timezone: 'auto'
    });
    const resp = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`, { cache: 'no-store' });
    if (!resp.ok) throw new Error(`Open-Meteo current: ${resp.status}`);
    const data = await resp.json();
    const c = data.current;
    const cond = _wmoCondition(c.weather_code);
    return {
        temperature: { degrees: c.temperature_2m },
        feelsLikeTemperature: { degrees: c.apparent_temperature },
        weatherCondition: { type: cond.type, description: { text: cond.description } },
        wind: { speed: { value: c.wind_speed_10m }, gust: { value: c.wind_gusts_10m }, direction: c.wind_direction_10m },
        relativeHumidity: c.relative_humidity_2m,
        dewPoint: { degrees: c.dew_point_2m },
        uvIndex: c.uv_index,
        visibility: { distance: c.visibility },
        pressure: { meanSeaLevelMillibars: c.pressure_msl },
        cloudCover: c.cloud_cover,
        _source: 'open-meteo'
    };
}

// Fetch Open-Meteo hourly forecast (dedicated)
async function _fetchOpenMeteoHourly(lat, lng, hours = 24) {
    const params = new URLSearchParams({
        latitude: lat, longitude: lng,
        hourly: 'temperature_2m,apparent_temperature,weather_code,precipitation_probability,wind_speed_10m,wind_direction_10m,wind_gusts_10m,relative_humidity_2m,pressure_msl,cloud_cover',
        temperature_unit: 'fahrenheit',
        wind_speed_unit: 'mph',
        timezone: 'auto',
        forecast_days: Math.ceil(hours / 24) + 1
    });
    const resp = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`, { cache: 'no-store' });
    if (!resp.ok) throw new Error(`Open-Meteo hourly: ${resp.status}`);
    const data = await resp.json();
    const h = data.hourly;
    const forecastHours = [];
    const now = new Date();
    for (let i = 0; i < h.time.length && forecastHours.length < hours; i++) {
        if (new Date(h.time[i]) < now - 3600000 && forecastHours.length === 0) continue;
        const cond = _wmoCondition(h.weather_code[i]);
        forecastHours.push({
            interval: { startTime: h.time[i] },
            displayDateTime: h.time[i],
            temperature: { degrees: h.temperature_2m[i] },
            feelsLikeTemperature: { degrees: h.apparent_temperature?.[i] },
            weatherCondition: { type: cond.type, description: { text: cond.description } },
            precipitation: { probability: h.precipitation_probability[i] },
            wind: { speed: h.wind_speed_10m[i], direction: h.wind_direction_10m[i], gust: h.wind_gusts_10m?.[i] ?? null },
            relativeHumidity: h.relative_humidity_2m?.[i],
            cloudCover: h.cloud_cover?.[i] ?? null,
            pressure: h.pressure_msl?.[i] != null ? { meanSeaLevelMillibars: h.pressure_msl[i] } : null
        });
    }
    return { forecastHours };
}

// Fetch Open-Meteo daily forecast (dedicated)
async function _fetchOpenMeteoDaily(lat, lng, days = 10) {
    const params = new URLSearchParams({
        latitude: lat, longitude: lng,
        daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,snowfall_sum,wind_speed_10m_max,wind_gusts_10m_max,wind_direction_10m_dominant,uv_index_max,sunrise,sunset,relative_humidity_2m_mean,apparent_temperature_max,apparent_temperature_min,cloud_cover_mean',
        temperature_unit: 'fahrenheit',
        wind_speed_unit: 'mph',
        timezone: 'auto',
        forecast_days: Math.min(days, 16)
    });
    const resp = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`, { cache: 'no-store' });
    if (!resp.ok) throw new Error(`Open-Meteo daily: ${resp.status}`);
    const data = await resp.json();
    const d = data.daily;
    const forecastDays = [];
    for (let i = 0; i < d.time.length; i++) {
        const cond = _wmoCondition(d.weather_code[i]);
        forecastDays.push({
            displayDate: d.time[i],
            interval: { startTime: d.time[i] },
            maxTemperature: { degrees: d.temperature_2m_max[i] },
            minTemperature: { degrees: d.temperature_2m_min[i] },
            weatherCondition: { type: cond.type, description: { text: cond.description } },
            precipitation: {
                probability: d.precipitation_probability_max[i],
                qpf: { millimeters: d.precipitation_sum[i] || 0 }
            },
            maxWind: { speed: { value: d.wind_speed_10m_max[i] }, direction: d.wind_direction_10m_dominant[i] },
            windGust: d.wind_gusts_10m_max ? d.wind_gusts_10m_max[i] : null,
            relativeHumidity: d.relative_humidity_2m_mean ? d.relative_humidity_2m_mean[i] : null,
            avgHumidity: d.relative_humidity_2m_mean ? d.relative_humidity_2m_mean[i] : null,
            uvIndex: d.uv_index_max[i],
            maxUvIndex: d.uv_index_max[i],
            feelsLikeMax: d.apparent_temperature_max ? { degrees: d.apparent_temperature_max[i] } : null,
            feelsLikeMin: d.apparent_temperature_min ? { degrees: d.apparent_temperature_min[i] } : null,
            cloudCover: d.cloud_cover_mean ? d.cloud_cover_mean[i] : null,
            snowQpf: d.snowfall_sum ? { millimeters: d.snowfall_sum[i] || 0 } : null,
            sunrise: d.sunrise[i],
            sunset: d.sunset[i]
        });
    }
    return { forecastDays };
}

// Fetch OWM current conditions
async function _fetchOWMCurrent(lat, lng) {
    const key = (typeof CONFIG !== 'undefined') ? CONFIG.OWM_API_KEY : '';
    if (!key || key === 'YOUR_OWM_API_KEY_HERE') throw new Error('OWM API key not configured');
    const url = `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lng}&appid=${key}&units=imperial`;
    const resp = await fetch(url, { cache: 'no-store' });
    if (!resp.ok) throw new Error(`OWM current: ${resp.status}`);
    const d = await resp.json();
    const id = d.weather?.[0]?.id;
    const condType = _owmConditionType(id);
    const desc = d.weather?.[0]?.description || 'Unknown';
    // OWM free tier doesn't provide UV index; supplement from Open-Meteo
    let uvIndex = null;
    try {
        const p = new URLSearchParams({ latitude: lat, longitude: lng, current: 'uv_index', timezone: 'auto' });
        const r = await fetch(`https://api.open-meteo.com/v1/forecast?${p}`, { cache: 'no-store' });
        if (r.ok) { const uvd = await r.json(); uvIndex = uvd.current?.uv_index ?? null; }
    } catch (e) { /* ok */ }
    return {
        temperature: { degrees: d.main?.temp },
        feelsLikeTemperature: { degrees: d.main?.feels_like },
        weatherCondition: { type: condType, description: { text: desc.charAt(0).toUpperCase() + desc.slice(1) } },
        wind: {
            speed: { value: d.wind?.speed },
            gust: { value: d.wind?.gust ?? null },
            direction: d.wind?.deg
        },
        relativeHumidity: d.main?.humidity,
        dewPoint: { degrees: null }, // not in OWM free current
        uvIndex,
        visibility: { distance: d.visibility }, // meters
        pressure: { meanSeaLevelMillibars: d.main?.pressure },
        cloudCover: d.clouds?.all,
        _owmCity: d.name,
        _source: 'owm'
    };
}

// Fetch OWM hourly forecast (from 3-hour intervals, free tier)
async function _fetchOWMHourly(lat, lng, hours = 24) {
    const key = (typeof CONFIG !== 'undefined') ? CONFIG.OWM_API_KEY : '';
    if (!key || key === 'YOUR_OWM_API_KEY_HERE') throw new Error('OWM API key not configured');
    const url = `https://api.openweathermap.org/data/2.5/forecast?lat=${lat}&lon=${lng}&appid=${key}&units=imperial&cnt=${Math.ceil(hours / 3) + 2}`;
    const resp = await fetch(url, { cache: 'no-store' });
    if (!resp.ok) throw new Error(`OWM hourly: ${resp.status}`);
    const data = await resp.json();
    const list = data.list || [];
    const forecastHours = [];
    const now = new Date();
    for (const item of list) {
        if (forecastHours.length >= hours) break;
        const dt = new Date(item.dt * 1000);
        if (dt < now - 3600000 && forecastHours.length === 0) continue;
        const id = item.weather?.[0]?.id;
        const condType = _owmConditionType(id);
        const desc = item.weather?.[0]?.description || '';
        forecastHours.push({
            interval: { startTime: dt.toISOString() },
            displayDateTime: dt.toISOString(),
            temperature: { degrees: item.main?.temp },
            feelsLikeTemperature: { degrees: item.main?.feels_like },
            weatherCondition: { type: condType, description: { text: desc.charAt(0).toUpperCase() + desc.slice(1) } },
            precipitation: { probability: Math.round((item.pop || 0) * 100) },
            wind: { speed: item.wind?.speed, direction: item.wind?.deg },
            relativeHumidity: item.main?.humidity,
            pressure: item.main?.pressure != null ? { meanSeaLevelMillibars: item.main.pressure } : null
        });
    }
    return { forecastHours };
}

// Fetch OWM daily forecast (aggregated from 3-hour free forecast, up to ~5 days)
async function _fetchOWMDaily(lat, lng, days = 7) {
    const key = (typeof CONFIG !== 'undefined') ? CONFIG.OWM_API_KEY : '';
    if (!key || key === 'YOUR_OWM_API_KEY_HERE') throw new Error('OWM API key not configured');
    const cnt = Math.min(days * 8 + 4, 40); // 8 slots per day (3h intervals)
    const url = `https://api.openweathermap.org/data/2.5/forecast?lat=${lat}&lon=${lng}&appid=${key}&units=imperial&cnt=${cnt}`;
    const resp = await fetch(url, { cache: 'no-store' });
    if (!resp.ok) throw new Error(`OWM daily: ${resp.status}`);
    const data = await resp.json();
    const list = data.list || [];
    // Group 3h periods by local date
    const byDate = {};
    for (const item of list) {
        const dt = new Date(item.dt * 1000);
        const dateStr = dt.toLocaleDateString('en-CA'); // YYYY-MM-DD
        if (!byDate[dateStr]) byDate[dateStr] = [];
        byDate[dateStr].push(item);
    }
    // Also get sunrise/sunset from Open-Meteo for day/night icon
    let sunMap = {};
    try {
        const sunTimes = await _fetchSunTimes(lat, lng, days);
        sunTimes.forEach(s => { sunMap[s.displayDate?.slice(0, 10)] = s; });
    } catch (e) { /* ok */ }

    const forecastDays = [];
    for (const [dateStr, items] of Object.entries(byDate)) {
        if (forecastDays.length >= days) break;
        const temps = items.map(i => i.main?.temp).filter(t => t != null);
        const maxTemp = temps.length ? Math.max(...temps) : null;
        const minTemp = temps.length ? Math.min(...temps) : null;
        const pops = items.map(i => (i.pop || 0) * 100);
        const maxPop = pops.length ? Math.max(...pops) : 0;
        const winds = items.map(i => i.wind?.speed).filter(w => w != null);
        const maxWind = winds.length ? Math.max(...winds) : null;
        // Pick the weather condition from the midday slot or first available
        const midday = items.find(i => { const h = new Date(i.dt * 1000).getHours(); return h >= 11 && h <= 14; }) || items[0];
        const id = midday?.weather?.[0]?.id;
        const condType = _owmConditionType(id);
        const desc = midday?.weather?.[0]?.description || '';
        const humids = items.map(i => i.main?.humidity).filter(h => h != null);
        const avgHumidity = humids.length ? Math.round(humids.reduce((a, b) => a + b, 0) / humids.length) : null;
        const sun = sunMap[dateStr];
        forecastDays.push({
            displayDate: dateStr,
            interval: { startTime: dateStr },
            maxTemperature: { degrees: maxTemp },
            minTemperature: { degrees: minTemp },
            weatherCondition: { type: condType, description: { text: desc.charAt(0).toUpperCase() + desc.slice(1) } },
            precipitation: { probability: Math.round(maxPop), qpf: { millimeters: 0 } },
            maxWind: { speed: { value: maxWind }, direction: items[0]?.wind?.deg },
            relativeHumidity: avgHumidity,
            avgHumidity,
            uvIndex: null,
            maxUvIndex: null,
            sunrise: sun?.sunrise ?? null,
            sunset: sun?.sunset ?? null
        });
    }
    return { forecastDays };
}

const WeatherAPI = {
    // === Current Conditions ===
    async getCurrentConditions(lat, lng) {
        try {
            const raw = await _googleGet('currentConditions:lookup', {
                'location.latitude': lat,
                'location.longitude': lng,
                'unitsSystem': 'IMPERIAL'
            });
            // Transform Google response to normalized format
            return {
                temperature: raw.temperature,
                feelsLikeTemperature: raw.feelsLikeTemperature,
                weatherCondition: raw.weatherCondition,
                wind: {
                    speed: raw.wind?.speed,
                    gust: raw.wind?.gust,
                    direction: raw.wind?.direction?.degrees
                },
                relativeHumidity: raw.relativeHumidity,
                dewPoint: raw.dewPoint,
                uvIndex: raw.uvIndex,
                visibility: raw.visibility ? { distance: raw.visibility.distance } : { distance: null },
                pressure: { meanSeaLevelMillibars: raw.airPressure?.meanSeaLevelMillibars },
                cloudCover: raw.cloudCover
            };
        } catch (e) {
            console.warn('Google Weather API failed, using Open-Meteo:', e.message);
        }

        // Fallback: Open-Meteo
        const params = new URLSearchParams({
            latitude: lat, longitude: lng,
            current: 'temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,cloud_cover,pressure_msl,wind_speed_10m,wind_direction_10m,wind_gusts_10m,uv_index,dew_point_2m,visibility',
            temperature_unit: 'fahrenheit',
            wind_speed_unit: 'mph',
            timezone: 'auto'
        });
        const resp = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`, { cache: 'no-store' });
        if (!resp.ok) throw new Error(`Open-Meteo error: ${resp.status}`);
        const data = await resp.json();
        const c = data.current;
        const cond = _wmoCondition(c.weather_code);

        return {
            temperature: { degrees: c.temperature_2m },
            feelsLikeTemperature: { degrees: c.apparent_temperature },
            weatherCondition: { type: cond.type, description: { text: cond.description } },
            wind: { speed: { value: c.wind_speed_10m }, gust: { value: c.wind_gusts_10m }, direction: c.wind_direction_10m },
            relativeHumidity: c.relative_humidity_2m,
            dewPoint: { degrees: c.dew_point_2m },
            uvIndex: c.uv_index,
            visibility: { distance: c.visibility },
            pressure: { meanSeaLevelMillibars: c.pressure_msl },
            cloudCover: c.cloud_cover
        };
    },

    // === Hourly Forecast ===
    async getHourlyForecast(lat, lng, hours = 24) {
        try {
            const raw = await _googleGet('forecast/hours:lookup', {
                'location.latitude': lat,
                'location.longitude': lng,
                'unitsSystem': 'IMPERIAL',
                'hours': hours,
                'pageSize': hours
            });
            // Transform Google hourly response
            const forecastHours = (raw.forecastHours || []).map(h => ({
                interval: h.interval,
                displayDateTime: _googleDateTimeToISO(h.displayDateTime) || h.interval?.startTime,
                temperature: h.temperature,
                feelsLikeTemperature: h.feelsLikeTemperature,
                weatherCondition: h.weatherCondition,
                precipitation: {
                    probability: h.precipitation?.probability?.percent
                },
                wind: {
                    speed: h.wind?.speed?.value,
                    direction: h.wind?.direction?.degrees
                },
                relativeHumidity: h.relativeHumidity,
                pressure: h.airPressure?.meanSeaLevelMillibars != null
                    ? { meanSeaLevelMillibars: h.airPressure.meanSeaLevelMillibars }
                    : null
            }));
            return { forecastHours };
        } catch (e) {
            console.warn('Google hourly failed, using Open-Meteo:', e.message);
        }

        const params = new URLSearchParams({
            latitude: lat, longitude: lng,
            hourly: 'temperature_2m,apparent_temperature,weather_code,precipitation_probability,wind_speed_10m,wind_direction_10m,wind_gusts_10m,relative_humidity_2m,pressure_msl,cloud_cover',
            temperature_unit: 'fahrenheit',
            wind_speed_unit: 'mph',
            timezone: 'auto',
            forecast_days: 3
        });
        const resp = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`, { cache: 'no-store' });
        if (!resp.ok) throw new Error(`Open-Meteo error: ${resp.status}`);
        const data = await resp.json();
        const h = data.hourly;

        const forecastHours = [];
        const now = new Date();
        for (let i = 0; i < h.time.length && forecastHours.length < hours; i++) {
            if (new Date(h.time[i]) < now - 3600000 && forecastHours.length === 0) continue;
            const cond = _wmoCondition(h.weather_code[i]);
            forecastHours.push({
                interval: { startTime: h.time[i] },
                displayDateTime: h.time[i],
                temperature: { degrees: h.temperature_2m[i] },
                feelsLikeTemperature: { degrees: h.apparent_temperature?.[i] },
                weatherCondition: { type: cond.type, description: { text: cond.description } },
                precipitation: { probability: h.precipitation_probability[i] },
                wind: { speed: h.wind_speed_10m[i], direction: h.wind_direction_10m[i], gust: h.wind_gusts_10m?.[i] ?? null },
                relativeHumidity: h.relative_humidity_2m?.[i],
                cloudCover: h.cloud_cover?.[i] ?? null,
                pressure: h.pressure_msl?.[i] != null
                    ? { meanSeaLevelMillibars: h.pressure_msl[i] }
                    : null
            });
        }
        return { forecastHours };
    },

    // === Daily Forecast ===
    async getDailyForecast(lat, lng, days = 10) {
        try {
            const raw = await _googleGet('forecast/days:lookup', {
                'location.latitude': lat,
                'location.longitude': lng,
                'unitsSystem': 'IMPERIAL',
                'days': days,
                'pageSize': days
            });
            // Transform Google daily response
            const forecastDays = (raw.forecastDays || []).map(day => {
                const dt = day.daytimeForecast || {};
                return {
                    displayDate: _googleDateToString(day.displayDate) || day.interval?.startTime,
                    interval: day.interval,
                    maxTemperature: day.maxTemperature,
                    minTemperature: day.minTemperature,
                    weatherCondition: dt.weatherCondition,
                    precipitation: {
                        probability: dt.precipitation?.probability?.percent,
                        qpf: { millimeters: dt.precipitation?.qpf?.quantity || 0 }
                    },
                    snowQpf: dt.precipitation?.snowfall?.quantity != null
                        ? { millimeters: dt.precipitation.snowfall.quantity }
                        : null,
                    maxWind: {
                        speed: dt.wind?.speed,
                        direction: dt.wind?.direction?.degrees
                    },
                    windGust: dt.wind?.gust?.speed?.value ?? null,
                    relativeHumidity: dt.relativeHumidity,
                    avgHumidity: dt.relativeHumidity,
                    uvIndex: dt.uvIndex,
                    maxUvIndex: dt.uvIndex,
                    cloudCover: dt.cloudCover ?? null,
                    feelsLikeMax: day.maxFeelsLikeTemperature ?? null,
                    feelsLikeMin: day.minFeelsLikeTemperature ?? null,
                    sunrise: day.sunEvents?.sunriseTime,
                    sunset: day.sunEvents?.sunsetTime
                };
            });
            return { forecastDays };
        } catch (e) {
            console.warn('Google daily failed, using Open-Meteo:', e.message);
        }

        const params = new URLSearchParams({
            latitude: lat, longitude: lng,
            daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,snowfall_sum,wind_speed_10m_max,wind_gusts_10m_max,wind_direction_10m_dominant,uv_index_max,sunrise,sunset,relative_humidity_2m_mean,apparent_temperature_max,apparent_temperature_min,cloud_cover_mean',
            temperature_unit: 'fahrenheit',
            wind_speed_unit: 'mph',
            timezone: 'auto',
            forecast_days: Math.min(days, 16)
        });
        const resp = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`, { cache: 'no-store' });
        if (!resp.ok) throw new Error(`Open-Meteo error: ${resp.status}`);
        const data = await resp.json();
        const d = data.daily;

        const forecastDays = [];
        for (let i = 0; i < d.time.length; i++) {
            const cond = _wmoCondition(d.weather_code[i]);
            forecastDays.push({
                displayDate: d.time[i],
                interval: { startTime: d.time[i] },
                maxTemperature: { degrees: d.temperature_2m_max[i] },
                minTemperature: { degrees: d.temperature_2m_min[i] },
                weatherCondition: { type: cond.type, description: { text: cond.description } },
                precipitation: {
                    probability: d.precipitation_probability_max[i],
                    qpf: { millimeters: d.precipitation_sum[i] || 0 }
                },
                maxWind: { speed: { value: d.wind_speed_10m_max[i] }, direction: d.wind_direction_10m_dominant[i] },
                windGust: d.wind_gusts_10m_max ? d.wind_gusts_10m_max[i] : null,
                relativeHumidity: d.relative_humidity_2m_mean ? d.relative_humidity_2m_mean[i] : null,
                avgHumidity: d.relative_humidity_2m_mean ? d.relative_humidity_2m_mean[i] : null,
                uvIndex: d.uv_index_max[i],
                maxUvIndex: d.uv_index_max[i],
                feelsLikeMax: d.apparent_temperature_max ? { degrees: d.apparent_temperature_max[i] } : null,
                feelsLikeMin: d.apparent_temperature_min ? { degrees: d.apparent_temperature_min[i] } : null,
                cloudCover: d.cloud_cover_mean ? d.cloud_cover_mean[i] : null,
                snowQpf: d.snowfall_sum ? { millimeters: d.snowfall_sum[i] || 0 } : null,
                sunrise: d.sunrise[i],
                sunset: d.sunset[i]
            });
        }
        return { forecastDays };
    },

    // === Air Quality ===
    async getAirQuality(lat, lng) {
        try {
            // AQI uses airquality.googleapis.com with POST request
            const url = `https://airquality.googleapis.com/v1/currentConditions:lookup?key=${CONFIG.GOOGLE_WEATHER_API_KEY}`;
            const resp = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    location: { latitude: lat, longitude: lng }
                })
            });
            if (!resp.ok) throw new Error(`Google AQI API ${resp.status}`);
            return await resp.json();
        } catch (e) {
            console.warn('Google AQI failed, using Open-Meteo:', e.message);
        }

        const params = new URLSearchParams({
            latitude: lat, longitude: lng,
            current: 'us_aqi,pm10,pm2_5'
        });
        const resp = await fetch(`https://air-quality-api.open-meteo.com/v1/air-quality?${params}`);
        if (!resp.ok) throw new Error(`Open-Meteo AQI error: ${resp.status}`);
        const data = await resp.json();
        const c = data.current;
        return {
            indexes: [{ aqi: c.us_aqi, dominantPollutant: (c.pm2_5 || 0) >= (c.pm10 || 0) ? 'PM2.5' : 'PM10' }]
        };
    },

    // === Pollen ===
    async getPollen(lat, lng) {
        // Pollen uses pollen.googleapis.com, not weather.googleapis.com
        const url = `https://pollen.googleapis.com/v1/forecast:lookup?key=${CONFIG.GOOGLE_WEATHER_API_KEY}&location.latitude=${lat}&location.longitude=${lng}&days=1`;
        const resp = await fetch(url);
        if (!resp.ok) throw new Error(`Google Pollen API ${resp.status}`);
        return await resp.json();
    },

    // === Weather Alerts (NWS API) ===
    async getAlerts(lat, lng) {
        const url = `https://api.weather.gov/alerts/active?point=${lat},${lng}`;
        const resp = await fetch(url, {
            cache: 'no-store',
            headers: { 'Accept': 'application/geo+json' }
        });
        if (!resp.ok) throw new Error(`NWS Alerts API ${resp.status}`);

        const data = await resp.json();
        const alerts = (data.features || []).map(feature => {
            const p = feature.properties || {};
            return {
                id: feature.id || p.id || `${p.event || 'alert'}-${p.sent || ''}`,
                event: p.event || 'Weather Alert',
                headline: p.headline || p.event || 'Weather Alert',
                description: p.description || '',
                instruction: p.instruction || '',
                severity: (p.severity || '').toLowerCase(),
                certainty: p.certainty || '',
                urgency: p.urgency || '',
                onset: p.onset || p.effective || null,
                effective: p.effective || null,
                expires: p.expires || p.ends || null,
                areaDesc: p.areaDesc || '',
                sender: p.senderName || '',
                geometry: feature.geometry || null,
                parameters: p.parameters || {},
                raw: feature
            };
        });

        return { alerts };
    },

    // === Location Timezone (from NWS /points) ===
    // Returns an IANA timezone string like "America/Chicago" for a lat/lng.
    // Used to format alert times in the location's local timezone.
    async getLocationTimeZone(lat, lng) {
        try {
            const points = await _getNWSPoints(lat, lng);
            return points.timeZone || null;
        } catch (e) {
            return null;
        }
    },

    // === Data Source Preference ===
    getDataSource: _getDataSource,
    setDataSource: _setDataSource,

    // === Open-Meteo (dedicated source) ===
    getOpenMeteoCurrentConditions(lat, lng) { return _fetchOpenMeteoCurrent(lat, lng); },
    getOpenMeteoHourlyForecast(lat, lng, hours) { return _fetchOpenMeteoHourly(lat, lng, hours); },
    getOpenMeteoDailyForecast(lat, lng, days) { return _fetchOpenMeteoDaily(lat, lng, days); },

    // === OWM (OpenWeatherMap) ===
    getOWMCurrentConditions(lat, lng) { return _fetchOWMCurrent(lat, lng); },
    getOWMHourlyForecast(lat, lng, hours) { return _fetchOWMHourly(lat, lng, hours); },
    getOWMDailyForecast(lat, lng, days) { return _fetchOWMDaily(lat, lng, days); },

    // === NWS Current Conditions ===
    async getNWSCurrentConditions(lat, lng) {
        const [points, omWind, uvIndex] = await Promise.all([
            _getNWSPoints(lat, lng),
            _fetchOpenMeteoWindCurrent(lat, lng).catch(() => null),
            // NWS does not provide UV index — supplement from Open-Meteo
            (async () => {
                const p = new URLSearchParams({ latitude: lat, longitude: lng, current: 'uv_index', timezone: 'auto' });
                const r = await fetch(`https://api.open-meteo.com/v1/forecast?${p}`, { cache: 'no-store' });
                if (!r.ok) return null;
                const d = await r.json();
                return d.current?.uv_index ?? null;
            })().catch(() => null)
        ]);
        // Fetch observation station list
        const stResp = await fetch(points.observationStations, {
            headers: { 'Accept': 'application/geo+json', 'User-Agent': 'EphrataWeather/1.0' }
        });
        if (!stResp.ok) throw new Error(`NWS stations ${stResp.status}`);
        const stData = await stResp.json();
        const stationId = stData.features?.[0]?.properties?.stationIdentifier;
        if (!stationId) throw new Error('No NWS station found nearby');

        // Fetch latest observation
        const obsResp = await fetch(`https://api.weather.gov/stations/${stationId}/observations/latest`, {
            headers: { 'Accept': 'application/geo+json', 'User-Agent': 'EphrataWeather/1.0' }
        });
        if (!obsResp.ok) throw new Error(`NWS observations ${obsResp.status}`);
        let obs = (await obsResp.json()).properties;

        // The /observations/latest endpoint sometimes returns a stale or incomplete
        // observation with null temperature. Fall back to recent observations list
        // to find the most recent valid reading.
        if (obs.temperature?.value == null) {
            try {
                const recentResp = await fetch(
                    `https://api.weather.gov/stations/${stationId}/observations?limit=5`,
                    { headers: { 'Accept': 'application/geo+json', 'User-Agent': 'EphrataWeather/1.0' } }
                );
                if (recentResp.ok) {
                    const recentData = await recentResp.json();
                    const validObs = (recentData.features || [])
                        .map(f => f.properties)
                        .find(p => p?.temperature?.value != null);
                    if (validObs) obs = validObs;
                }
            } catch (e) { /* use original observation */ }
        }

        // Convert SI units to imperial
        const toF = c => c != null ? c * 9 / 5 + 32 : null;
        const tempF = toF(obs.temperature?.value);
        const feelsRaw = obs.heatIndex?.value ?? obs.windChill?.value;
        const feelsF = feelsRaw != null ? toF(feelsRaw) : tempF;
        const pressMb = obs.barometricPressure?.value != null ? obs.barometricPressure.value / 100 : null;
        const cloudLayers = obs.cloudLayers || [];
        const topLayer = cloudLayers[cloudLayers.length - 1];

        // Use Open-Meteo wind data (accurate) in place of NWS observation wind
        const wind = omWind
            ? { speed: { value: omWind.speed }, gust: { value: omWind.gust }, direction: omWind.direction }
            : { speed: { value: null }, gust: { value: null }, direction: null };

        return {
            temperature: { degrees: tempF },
            feelsLikeTemperature: { degrees: feelsF },
            weatherCondition: {
                type: _nwsConditionType(obs.textDescription),
                description: { text: obs.textDescription || 'Unknown' }
            },
            wind,
            relativeHumidity: obs.relativeHumidity?.value,
            dewPoint: { degrees: toF(obs.dewpoint?.value) },
            uvIndex: uvIndex,
            visibility: { distance: obs.visibility?.value },
            pressure: { meanSeaLevelMillibars: pressMb },
            cloudCover: topLayer ? _nwsCloudAmount(topLayer.amount) : null,
            _nwsStation: stationId
        };
    },

    // === NWS Hourly Forecast ===
    async getNWSHourlyForecast(lat, lng, hours = 24) {
        const [points, omWindMap] = await Promise.all([
            _getNWSPoints(lat, lng),
            _fetchOpenMeteoWindHourly(lat, lng, Math.ceil(hours / 24) + 1).catch(() => null)
        ]);
        const resp = await fetch(points.forecastHourly, {
            headers: { 'Accept': 'application/geo+json', 'User-Agent': 'EphrataWeather/1.0' }
        });
        if (!resp.ok) throw new Error(`NWS hourly forecast ${resp.status}`);
        const data = await resp.json();
        const periods = (data.properties?.periods || []).slice(0, hours);

        const forecastHours = periods.map(p => {
            // Look up Open-Meteo wind by matching the hour (first 16 chars of ISO timestamp)
            const hourKey = p.startTime ? p.startTime.slice(0, 16) : null;
            const omWind = hourKey && omWindMap ? omWindMap[hourKey] : null;
            return {
                interval: { startTime: p.startTime },
                displayDateTime: p.startTime,
                temperature: { degrees: p.temperature }, // NWS hourly is already °F
                feelsLikeTemperature: { degrees: null },
                weatherCondition: {
                    type: _nwsConditionType(p.shortForecast),
                    description: { text: p.shortForecast || '' }
                },
                precipitation: { probability: p.probabilityOfPrecipitation?.value ?? 0 },
                wind: omWind
                    ? { speed: omWind.speed, direction: omWind.direction, gust: omWind.gust ?? null }
                    : { speed: _nwsWindSpeed(p.windSpeed), direction: _nwsCardinalToDeg(p.windDirection), gust: null },
                relativeHumidity: p.relativeHumidity?.value ?? null,
                pressure: null
            };
        });
        return { forecastHours };
    },

    // === NWS Daily Forecast ===
    async getNWSDailyForecast(lat, lng, days = 10) {
        const points = await _getNWSPoints(lat, lng);

        // Fetch NWS forecast periods, sunrise/sunset, and Open-Meteo daily wind in parallel
        const [resp, sunTimes, omDailyRaw] = await Promise.all([
            fetch(points.forecast, {
                headers: { 'Accept': 'application/geo+json', 'User-Agent': 'EphrataWeather/1.0' }
            }),
            _fetchSunTimes(lat, lng, days).catch(() => []),
            (async () => {
                const params = new URLSearchParams({
                    latitude: lat, longitude: lng,
                    daily: 'wind_speed_10m_max,wind_gusts_10m_max,wind_direction_10m_dominant,apparent_temperature_max,apparent_temperature_min,snowfall_sum,cloud_cover_mean,uv_index_max',
                    temperature_unit: 'fahrenheit',
                    wind_speed_unit: 'mph',
                    timezone: 'auto',
                    forecast_days: Math.min(days, 16)
                });
                const r = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`, { cache: 'no-store' });
                if (!r.ok) return null;
                const d = await r.json();
                const map = {};
                (d.daily?.time || []).forEach((t, i) => {
                    map[t] = {
                        speed: d.daily.wind_speed_10m_max[i],
                        direction: d.daily.wind_direction_10m_dominant[i],
                        gust: d.daily.wind_gusts_10m_max?.[i] ?? null,
                        feelsLikeMax: d.daily.apparent_temperature_max?.[i] != null ? { degrees: d.daily.apparent_temperature_max[i] } : null,
                        feelsLikeMin: d.daily.apparent_temperature_min?.[i] != null ? { degrees: d.daily.apparent_temperature_min[i] } : null,
                        snowQpf: d.daily.snowfall_sum?.[i] != null ? { millimeters: d.daily.snowfall_sum[i] || 0 } : null,
                        cloudCover: d.daily.cloud_cover_mean?.[i] ?? null,
                        uvIndex: d.daily.uv_index_max?.[i] ?? null,
                    };
                });
                return map;
            })().catch(() => null)
        ]);

        if (!resp.ok) throw new Error(`NWS daily forecast ${resp.status}`);
        const data = await resp.json();
        const periods = data.properties?.periods || [];

        const forecastDays = [];
        for (let i = 0; i < periods.length && forecastDays.length < days; i++) {
            const p = periods[i];
            if (!p.isDaytime) continue; // pair day + night
            const night = periods[i + 1]; // immediately following night period
            const dateStr = p.startTime?.split('T')[0];

            // Merge sunrise/sunset from Google/Open-Meteo for day/night icon logic
            const sun = sunTimes.find(s => s.displayDate === dateStr);

            const omWind = omDailyRaw ? omDailyRaw[dateStr] : null;
            forecastDays.push({
                displayDate: dateStr,
                interval: { startTime: p.startTime },
                maxTemperature: { degrees: p.temperature },       // daytime temp = high
                minTemperature: { degrees: night?.temperature ?? null }, // night temp = low
                weatherCondition: {
                    type: _nwsConditionType(p.shortForecast),
                    description: { text: p.shortForecast || p.detailedForecast || '' }
                },
                detailedForecast: p.detailedForecast || null,
                precipitation: {
                    probability: p.probabilityOfPrecipitation?.value ?? 0,
                    qpf: { millimeters: 0 }
                },
                maxWind: omWind
                    ? { speed: { value: omWind.speed }, direction: omWind.direction }
                    : { speed: { value: _nwsWindSpeed(p.windSpeed) }, direction: _nwsCardinalToDeg(p.windDirection) },
                windGust: omWind?.gust ?? null,
                relativeHumidity: p.relativeHumidity?.value ?? null,
                avgHumidity: p.relativeHumidity?.value ?? null,
                uvIndex: omWind?.uvIndex ?? null,
                maxUvIndex: omWind?.uvIndex ?? null,
                feelsLikeMax: omWind?.feelsLikeMax ?? null,
                feelsLikeMin: omWind?.feelsLikeMin ?? null,
                cloudCover: omWind?.cloudCover ?? null,
                snowQpf: omWind?.snowQpf ?? null,
                sunrise: sun?.sunrise ?? null,
                sunset: sun?.sunset ?? null
            });
        }
        return { forecastDays };
    },

    // === Helpers ===
    formatTemp(temp) {
        if (temp == null) return '--';
        return Math.round(temp);
    },

    formatTime(isoString) {
        if (!isoString) return '';
        const date = new Date(isoString);
        if (isNaN(date)) return '';
        return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: undefined, hour12: true });
    },

    formatDayName(isoString, short = false) {
        if (!isoString) return '';
        let date;
        if (/^\d{4}-\d{2}-\d{2}$/.test(isoString)) {
            const [y, m, d] = isoString.split('-').map(Number);
            date = new Date(y, m - 1, d);
        } else {
            date = new Date(isoString);
        }
        if (isNaN(date)) return '';
        const today = new Date();
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);
        if (date.toDateString() === today.toDateString()) return 'Today';
        if (date.toDateString() === tomorrow.toDateString()) return 'Tomorrow';
        return date.toLocaleDateString('en-US', { weekday: short ? 'short' : 'long' });
    },

    windDirection(degrees) {
        if (degrees == null || isNaN(degrees)) return '';
        const dirs = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
                      'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
        return dirs[Math.round(degrees / 22.5) % 16];
    },

    aqiCategory(aqi) {
        if (aqi <= 50) return { label: 'Good', class: 'badge-good' };
        if (aqi <= 100) return { label: 'Moderate', class: 'badge-warn' };
        if (aqi <= 150) return { label: 'Unhealthy for Sensitive', class: 'badge-warn' };
        if (aqi <= 200) return { label: 'Unhealthy', class: 'badge-danger' };
        return { label: 'Very Unhealthy', class: 'badge-danger' };
    }
};
