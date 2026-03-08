// ============================================
// WEATHER API HELPER
// Primary: Google Weather API (GET with query params)
// Fallback: Open-Meteo (free, CORS-enabled)
// Optional: NWS (National Weather Service) — user-selectable
// ============================================

// --- Data Source Preference ---
const _DATA_SOURCE_KEY = 'ephrata_data_source';
function _getDataSource() { return localStorage.getItem(_DATA_SOURCE_KEY) || 'google'; }
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

// Parse NWS wind speed string like "10 mph" → number
function _nwsWindSpeed(str) {
    if (str == null) return null;
    if (typeof str === 'number') return str;
    const m = String(str).match(/(\d+)/);
    return m ? parseInt(m[1]) : null;
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
            hourly: 'temperature_2m,apparent_temperature,weather_code,precipitation_probability,wind_speed_10m,wind_direction_10m,relative_humidity_2m,pressure_msl',
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
                wind: { speed: h.wind_speed_10m[i], direction: h.wind_direction_10m[i] },
                relativeHumidity: h.relative_humidity_2m?.[i],
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
                    maxWind: {
                        speed: dt.wind?.speed,
                        direction: dt.wind?.direction?.degrees
                    },
                    relativeHumidity: dt.relativeHumidity,
                    avgHumidity: dt.relativeHumidity,
                    uvIndex: dt.uvIndex,
                    maxUvIndex: dt.uvIndex,
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
            daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,wind_speed_10m_max,wind_direction_10m_dominant,uv_index_max,sunrise,sunset,relative_humidity_2m_mean',
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
                relativeHumidity: d.relative_humidity_2m_mean ? d.relative_humidity_2m_mean[i] : null,
                avgHumidity: d.relative_humidity_2m_mean ? d.relative_humidity_2m_mean[i] : null,
                uvIndex: d.uv_index_max[i],
                maxUvIndex: d.uv_index_max[i],
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
                raw: feature
            };
        });

        return { alerts };
    },

    // === Data Source Preference ===
    getDataSource: _getDataSource,
    setDataSource: _setDataSource,

    // === NWS Current Conditions ===
    async getNWSCurrentConditions(lat, lng) {
        const points = await _getNWSPoints(lat, lng);
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
        const obs = (await obsResp.json()).properties;

        // Convert SI units to imperial
        const toF = c => c != null ? c * 9 / 5 + 32 : null;
        const toMph = mps => mps != null ? mps * 2.237 : null;
        const tempF = toF(obs.temperature?.value);
        const feelsRaw = obs.heatIndex?.value ?? obs.windChill?.value;
        const feelsF = feelsRaw != null ? toF(feelsRaw) : tempF;
        const pressMb = obs.barometricPressure?.value != null ? obs.barometricPressure.value / 100 : null;
        const cloudLayers = obs.cloudLayers || [];
        const topLayer = cloudLayers[cloudLayers.length - 1];

        return {
            temperature: { degrees: tempF },
            feelsLikeTemperature: { degrees: feelsF },
            weatherCondition: {
                type: _nwsConditionType(obs.textDescription),
                description: { text: obs.textDescription || 'Unknown' }
            },
            wind: {
                speed: { value: toMph(obs.windSpeed?.value) },
                gust: { value: toMph(obs.windGust?.value) },
                direction: obs.windDirection?.value
            },
            relativeHumidity: obs.relativeHumidity?.value,
            dewPoint: { degrees: toF(obs.dewpoint?.value) },
            uvIndex: null,
            visibility: { distance: obs.visibility?.value },
            pressure: { meanSeaLevelMillibars: pressMb },
            cloudCover: topLayer ? _nwsCloudAmount(topLayer.amount) : null,
            _nwsStation: stationId
        };
    },

    // === NWS Hourly Forecast ===
    async getNWSHourlyForecast(lat, lng, hours = 24) {
        const points = await _getNWSPoints(lat, lng);
        const resp = await fetch(points.forecastHourly, {
            headers: { 'Accept': 'application/geo+json', 'User-Agent': 'EphrataWeather/1.0' }
        });
        if (!resp.ok) throw new Error(`NWS hourly forecast ${resp.status}`);
        const data = await resp.json();
        const periods = (data.properties?.periods || []).slice(0, hours);

        const forecastHours = periods.map(p => ({
            interval: { startTime: p.startTime },
            displayDateTime: p.startTime,
            temperature: { degrees: p.temperature }, // NWS hourly is already °F
            feelsLikeTemperature: { degrees: null },
            weatherCondition: {
                type: _nwsConditionType(p.shortForecast),
                description: { text: p.shortForecast || '' }
            },
            precipitation: { probability: p.probabilityOfPrecipitation?.value ?? 0 },
            wind: {
                speed: _nwsWindSpeed(p.windSpeed),
                direction: _nwsCardinalToDeg(p.windDirection)
            },
            relativeHumidity: p.relativeHumidity?.value ?? null,
            pressure: null
        }));
        return { forecastHours };
    },

    // === NWS Daily Forecast ===
    async getNWSDailyForecast(lat, lng, days = 10) {
        const points = await _getNWSPoints(lat, lng);
        const resp = await fetch(points.forecast, {
            headers: { 'Accept': 'application/geo+json', 'User-Agent': 'EphrataWeather/1.0' }
        });
        if (!resp.ok) throw new Error(`NWS daily forecast ${resp.status}`);
        const data = await resp.json();
        const periods = data.properties?.periods || [];

        const forecastDays = [];
        for (let i = 0; i < periods.length && forecastDays.length < days; i++) {
            const p = periods[i];
            if (!p.isDaytime) continue; // pair day + night
            const night = periods[i + 1]; // immediately following night period
            const dateStr = p.startTime?.split('T')[0];

            forecastDays.push({
                displayDate: dateStr,
                interval: { startTime: p.startTime },
                maxTemperature: { degrees: p.temperature },       // daytime temp = high
                minTemperature: { degrees: night?.temperature ?? null }, // night temp = low
                weatherCondition: {
                    type: _nwsConditionType(p.shortForecast),
                    description: { text: p.shortForecast || '' }
                },
                precipitation: {
                    probability: p.probabilityOfPrecipitation?.value ?? 0,
                    qpf: { millimeters: 0 }
                },
                maxWind: {
                    speed: { value: _nwsWindSpeed(p.windSpeed) },
                    direction: _nwsCardinalToDeg(p.windDirection)
                },
                relativeHumidity: p.relativeHumidity?.value ?? null,
                avgHumidity: p.relativeHumidity?.value ?? null,
                uvIndex: null,
                maxUvIndex: null,
                sunrise: null,
                sunset: null
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
