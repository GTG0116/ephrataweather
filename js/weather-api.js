// ============================================
// WEATHER API HELPER (Open-Meteo - free, no key, CORS-enabled)
// ============================================

// WMO Weather Interpretation Codes → condition type + description
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

function _weatherCondition(code) {
    return WMO_CODES[code] || { type: 'PARTLY_CLOUDY', description: 'Unknown' };
}

const WeatherAPI = {
    // Fetch current conditions (returns same shape as before)
    async getCurrentConditions(lat, lng) {
        const params = new URLSearchParams({
            latitude: lat,
            longitude: lng,
            current: [
                'temperature_2m', 'relative_humidity_2m', 'apparent_temperature',
                'weather_code', 'cloud_cover', 'pressure_msl',
                'wind_speed_10m', 'wind_direction_10m', 'wind_gusts_10m',
                'uv_index', 'dew_point_2m', 'visibility'
            ].join(','),
            temperature_unit: 'fahrenheit',
            wind_speed_unit: 'mph',
            timezone: 'auto'
        });

        const response = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`);
        if (!response.ok) throw new Error(`Current conditions API error: ${response.status}`);
        const data = await response.json();
        const c = data.current;
        const cond = _weatherCondition(c.weather_code);

        return {
            temperature: { degrees: c.temperature_2m },
            feelsLikeTemperature: { degrees: c.apparent_temperature },
            weatherCondition: {
                type: cond.type,
                description: { text: cond.description }
            },
            wind: {
                speed: { value: c.wind_speed_10m },
                gust: { value: c.wind_gusts_10m },
                direction: c.wind_direction_10m
            },
            relativeHumidity: c.relative_humidity_2m,
            dewPoint: { degrees: c.dew_point_2m },
            uvIndex: c.uv_index,
            visibility: { distance: c.visibility }, // Open-Meteo returns meters
            pressure: { meanSeaLevelMillibars: c.pressure_msl },
            cloudCover: c.cloud_cover
        };
    },

    // Fetch hourly forecast
    async getHourlyForecast(lat, lng, hours = 24) {
        const params = new URLSearchParams({
            latitude: lat,
            longitude: lng,
            hourly: [
                'temperature_2m', 'weather_code', 'precipitation_probability',
                'wind_speed_10m', 'wind_direction_10m'
            ].join(','),
            temperature_unit: 'fahrenheit',
            wind_speed_unit: 'mph',
            timezone: 'auto',
            forecast_days: 3
        });

        const response = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`);
        if (!response.ok) throw new Error(`Hourly forecast API error: ${response.status}`);
        const data = await response.json();
        const h = data.hourly;

        const forecastHours = [];
        const now = new Date();

        for (let i = 0; i < h.time.length && forecastHours.length < hours; i++) {
            const time = new Date(h.time[i]);
            // Skip past hours (but include the current hour)
            if (time < now - 3600000 && forecastHours.length === 0) continue;

            const cond = _weatherCondition(h.weather_code[i]);
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

    // Fetch daily forecast (up to 16 days)
    async getDailyForecast(lat, lng, days = 10) {
        const params = new URLSearchParams({
            latitude: lat,
            longitude: lng,
            daily: [
                'weather_code', 'temperature_2m_max', 'temperature_2m_min',
                'precipitation_sum', 'precipitation_probability_max',
                'wind_speed_10m_max', 'wind_direction_10m_dominant',
                'uv_index_max', 'sunrise', 'sunset', 'relative_humidity_2m_mean'
            ].join(','),
            temperature_unit: 'fahrenheit',
            wind_speed_unit: 'mph',
            timezone: 'auto',
            forecast_days: Math.min(days, 16)
        });

        const response = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`);
        if (!response.ok) throw new Error(`Daily forecast API error: ${response.status}`);
        const data = await response.json();
        const d = data.daily;

        const forecastDays = [];
        for (let i = 0; i < d.time.length; i++) {
            const cond = _weatherCondition(d.weather_code[i]);
            // precipitation_sum from Open-Meteo is in mm by default
            const precipMm = d.precipitation_sum[i] || 0;

            forecastDays.push({
                displayDate: d.time[i],
                interval: { startTime: d.time[i] },
                maxTemperature: { degrees: d.temperature_2m_max[i] },
                minTemperature: { degrees: d.temperature_2m_min[i] },
                weatherCondition: {
                    type: cond.type,
                    description: { text: cond.description }
                },
                precipitation: {
                    probability: d.precipitation_probability_max[i],
                    qpf: { millimeters: precipMm }
                },
                maxWind: {
                    speed: { value: d.wind_speed_10m_max[i] },
                    direction: d.wind_direction_10m_dominant[i]
                },
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

    // Fetch air quality
    async getAirQuality(lat, lng) {
        const params = new URLSearchParams({
            latitude: lat,
            longitude: lng,
            current: 'us_aqi,pm10,pm2_5'
        });

        const response = await fetch(`https://air-quality-api.open-meteo.com/v1/air-quality?${params}`);
        if (!response.ok) throw new Error(`Air quality API error: ${response.status}`);
        const data = await response.json();
        const c = data.current;

        const dominant = (c.pm2_5 || 0) >= (c.pm10 || 0) ? 'PM2.5' : 'PM10';

        return {
            indexes: [{
                aqi: c.us_aqi,
                dominantPollutant: dominant
            }]
        };
    },

    // Pollen data (not available from Open-Meteo)
    async getPollen(lat, lng) {
        throw new Error('Pollen data not available from current API provider');
    },

    // Helper: format temperature
    formatTemp(temp) {
        if (temp == null) return '--';
        return Math.round(temp);
    },

    // Helper: format time from ISO string
    formatTime(isoString) {
        const date = new Date(isoString);
        return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: undefined, hour12: true });
    },

    // Helper: format day name
    formatDayName(isoString, short = false) {
        // Handle date-only strings (YYYY-MM-DD) by parsing components directly
        // to avoid UTC vs local timezone issues
        let date;
        if (/^\d{4}-\d{2}-\d{2}$/.test(isoString)) {
            const [y, m, d] = isoString.split('-').map(Number);
            date = new Date(y, m - 1, d); // Local timezone
        } else {
            date = new Date(isoString);
        }

        const today = new Date();
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);

        if (date.toDateString() === today.toDateString()) return 'Today';
        if (date.toDateString() === tomorrow.toDateString()) return 'Tomorrow';

        return date.toLocaleDateString('en-US', { weekday: short ? 'short' : 'long' });
    },

    // Helper: get wind direction from degrees
    windDirection(degrees) {
        const dirs = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
                      'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
        return dirs[Math.round(degrees / 22.5) % 16];
    },

    // Helper: AQI category
    aqiCategory(aqi) {
        if (aqi <= 50) return { label: 'Good', class: 'badge-good' };
        if (aqi <= 100) return { label: 'Moderate', class: 'badge-warn' };
        if (aqi <= 150) return { label: 'Unhealthy for Sensitive', class: 'badge-warn' };
        if (aqi <= 200) return { label: 'Unhealthy', class: 'badge-danger' };
        return { label: 'Very Unhealthy', class: 'badge-danger' };
    }
};
