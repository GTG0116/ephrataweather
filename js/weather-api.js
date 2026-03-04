// ============================================
// WEATHER API HELPER
// Primary: Google Weather API (GET with query params)
// Fallback: Open-Meteo (free, CORS-enabled)
// ============================================

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
    const resp = await fetch(url);
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
        const resp = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`);
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
                weatherCondition: h.weatherCondition,
                precipitation: {
                    probability: h.precipitation?.probability?.percent
                }
            }));
            return { forecastHours };
        } catch (e) {
            console.warn('Google hourly failed, using Open-Meteo:', e.message);
        }

        const params = new URLSearchParams({
            latitude: lat, longitude: lng,
            hourly: 'temperature_2m,weather_code,precipitation_probability,wind_speed_10m,wind_direction_10m',
            temperature_unit: 'fahrenheit',
            wind_speed_unit: 'mph',
            timezone: 'auto',
            forecast_days: 3
        });
        const resp = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`);
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
                weatherCondition: { type: cond.type },
                precipitation: { probability: h.precipitation_probability[i] }
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
        const resp = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`);
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

    // === Weather Alerts ===
    async getAlerts(lat, lng) {
        const url = `${CONFIG.GOOGLE_WEATHER_BASE}/publicAlerts:lookup?key=${CONFIG.GOOGLE_WEATHER_API_KEY}&location.latitude=${lat}&location.longitude=${lng}&languageCode=en`;
        const resp = await fetch(url);
        if (!resp.ok) throw new Error(`Google Alerts API ${resp.status}`);
        return await resp.json();
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
