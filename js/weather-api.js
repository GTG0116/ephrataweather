// ============================================
// GOOGLE WEATHER API HELPER
// ============================================

const WeatherAPI = {
    // Fetch current conditions
    async getCurrentConditions(lat, lng) {
        const url = `${CONFIG.GOOGLE_WEATHER_BASE}/currentConditions:lookup?key=${CONFIG.GOOGLE_WEATHER_API_KEY}`;
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                location: { latitude: lat, longitude: lng },
                unitsSystem: 'IMPERIAL'
            })
        });
        if (!response.ok) throw new Error(`Current conditions API error: ${response.status}`);
        return response.json();
    },

    // Fetch hourly forecast
    async getHourlyForecast(lat, lng, hours = 24) {
        const url = `${CONFIG.GOOGLE_WEATHER_BASE}/forecast/hours:lookup?key=${CONFIG.GOOGLE_WEATHER_API_KEY}`;
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                location: { latitude: lat, longitude: lng },
                hours: hours,
                unitsSystem: 'IMPERIAL'
            })
        });
        if (!response.ok) throw new Error(`Hourly forecast API error: ${response.status}`);
        return response.json();
    },

    // Fetch daily forecast (10-day)
    async getDailyForecast(lat, lng, days = 10) {
        const url = `${CONFIG.GOOGLE_WEATHER_BASE}/forecast/days:lookup?key=${CONFIG.GOOGLE_WEATHER_API_KEY}`;
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                location: { latitude: lat, longitude: lng },
                days: days,
                unitsSystem: 'IMPERIAL'
            })
        });
        if (!response.ok) throw new Error(`Daily forecast API error: ${response.status}`);
        return response.json();
    },

    // Fetch air quality
    async getAirQuality(lat, lng) {
        const url = `${CONFIG.GOOGLE_WEATHER_BASE}/airQuality:lookup?key=${CONFIG.GOOGLE_WEATHER_API_KEY}`;
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                location: { latitude: lat, longitude: lng }
            })
        });
        if (!response.ok) throw new Error(`Air quality API error: ${response.status}`);
        return response.json();
    },

    // Fetch pollen
    async getPollen(lat, lng) {
        const url = `${CONFIG.GOOGLE_WEATHER_BASE}/pollen:lookup?key=${CONFIG.GOOGLE_WEATHER_API_KEY}`;
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                location: { latitude: lat, longitude: lng },
                days: 1
            })
        });
        if (!response.ok) throw new Error(`Pollen API error: ${response.status}`);
        return response.json();
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
        const date = new Date(isoString);
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
