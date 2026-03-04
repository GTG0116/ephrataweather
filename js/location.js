// ============================================
// LOCATION MANAGER
// Handles geolocation, search, favorites
// ============================================
 
const LocationManager = {
    STORAGE_KEY: 'ephrata_weather_location',
    FAVORITES_KEY: 'ephrata_weather_favorites',
 
    // Get current location from localStorage or default
    getCurrent() {
        try {
            const stored = localStorage.getItem(this.STORAGE_KEY);
            if (stored) return JSON.parse(stored);
        } catch (e) {}
        return {
            lat: CONFIG.DEFAULT_LAT,
            lng: CONFIG.DEFAULT_LNG,
            name: CONFIG.DEFAULT_LOCATION_NAME
        };
    },
 
    // Save current location
    setCurrent(lat, lng, name) {
        const loc = { lat, lng, name };
        localStorage.setItem(this.STORAGE_KEY, JSON.stringify(loc));
        return loc;
    },
 
    // Get favorites list
    getFavorites() {
        try {
            const stored = localStorage.getItem(this.FAVORITES_KEY);
            if (stored) return JSON.parse(stored);
        } catch (e) {}
        return [];
    },
 
    // Add a favorite
    addFavorite(lat, lng, name) {
        const favs = this.getFavorites();
        if (favs.some(f => f.name === name)) return favs;
        favs.unshift({ lat, lng, name });
        localStorage.setItem(this.FAVORITES_KEY, JSON.stringify(favs.slice(0, 20)));
        return favs;
    },
 
    // Remove a favorite
    removeFavorite(name) {
        let favs = this.getFavorites();
        favs = favs.filter(f => f.name !== name);
        localStorage.setItem(this.FAVORITES_KEY, JSON.stringify(favs));
        return favs;
    },
 
    // Check if location is a favorite
    isFavorite(name) {
        return this.getFavorites().some(f => f.name === name);
    },
 
    // Search for locations using Nominatim
    async search(query) {
        if (!query || query.length < 2) return [];
        const params = new URLSearchParams({
            q: query,
            format: 'json',
            limit: '6',
            addressdetails: '1',
            'accept-language': 'en'
        });
        const resp = await fetch(`https://nominatim.openstreetmap.org/search?${params}`, {
            headers: { 'User-Agent': 'EphrataWeatherApp/1.0' }
        });
        if (!resp.ok) return [];
        const results = await resp.json();
        return results.map(r => {
            const parts = [];
            const addr = r.address || {};
            const city = addr.city || addr.town || addr.village || addr.hamlet || r.name || '';
            const state = addr.state || '';
            const country = addr.country_code?.toUpperCase() || '';
            if (city) parts.push(city);
            if (state) parts.push(state);
            if (country && country !== 'US') parts.push(country);
            return {
                lat: parseFloat(r.lat),
                lng: parseFloat(r.lon),
                name: parts.join(', ') || r.display_name.split(',').slice(0, 2).join(',')
            };
        });
    },
 
    // Reverse geocode lat/lng to a name
    async reverseGeocode(lat, lng) {
        try {
            const params = new URLSearchParams({
                lat, lon: lng,
                format: 'json',
                addressdetails: '1',
                'accept-language': 'en'
            });
            const resp = await fetch(`https://nominatim.openstreetmap.org/reverse?${params}`, {
                headers: { 'User-Agent': 'EphrataWeatherApp/1.0' }
            });
            if (!resp.ok) return null;
            const r = await resp.json();
            const addr = r.address || {};
            const city = addr.city || addr.town || addr.village || addr.hamlet || '';
            const state = addr.state || '';
            if (city && state) return `${city}, ${state}`;
            if (city) return city;
            return r.display_name?.split(',').slice(0, 2).join(',') || null;
        } catch (e) {
            return null;
        }
    },
 
    // Detect user location via browser geolocation
    detectLocation() {
        return new Promise((resolve) => {
            if (!navigator.geolocation) {
                resolve(null);
                return;
            }
            navigator.geolocation.getCurrentPosition(
                pos => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
                () => resolve(null),
                { timeout: 8000, maximumAge: 300000 }
            );
        });
    },
 
    // Initialize on first load - try geolocation, fall back to default
    async init() {
        const stored = localStorage.getItem(this.STORAGE_KEY);
        if (stored) return this.getCurrent();
 
        const pos = await this.detectLocation();
        if (pos) {
            const name = await this.reverseGeocode(pos.lat, pos.lng);
            if (name) {
                return this.setCurrent(pos.lat, pos.lng, name);
            }
        }
        return this.getCurrent();
    }
};
 
// ============================================
// LOCATION SEARCH UI
// ============================================
 
function initLocationSearch() {
    const container = document.getElementById('location-search-container');
    if (!container) return;
 
    const current = LocationManager.getCurrent();
    const locationNameEl = document.getElementById('location-name');
    if (locationNameEl) locationNameEl.textContent = current.name;
 
    let searchTimeout = null;
    let isOpen = false;
 
    // Build the dropdown HTML
    container.innerHTML = `
        <div class="loc-trigger" id="loc-trigger">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></svg>
            <span id="loc-display-name">${current.name}</span>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>
        </div>
        <div class="loc-dropdown" id="loc-dropdown" style="display:none;">
            <div class="loc-search-wrap">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.5)" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                <input type="text" id="loc-search-input" class="loc-search-input" placeholder="Search for a city..." autocomplete="off"/>
            </div>
            <div id="loc-favorites" class="loc-favorites"></div>
            <div id="loc-results" class="loc-results"></div>
        </div>
    `;
 
    const trigger = document.getElementById('loc-trigger');
    const dropdown = document.getElementById('loc-dropdown');
    const searchInput = document.getElementById('loc-search-input');
    const favoritesEl = document.getElementById('loc-favorites');
    const resultsEl = document.getElementById('loc-results');
 
    function renderFavorites() {
        const favs = LocationManager.getFavorites();
        if (favs.length === 0) {
            favoritesEl.innerHTML = '';
            return;
        }
        favoritesEl.innerHTML = `<div class="loc-section-label">Favorites</div>` +
            favs.map(f => `
                <div class="loc-fav-chip" data-lat="${f.lat}" data-lng="${f.lng}" data-name="${f.name}">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="rgba(255,220,100,0.8)" stroke="none"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
                    <span>${f.name}</span>
                </div>
            `).join('');
 
        favoritesEl.querySelectorAll('.loc-fav-chip').forEach(chip => {
            chip.addEventListener('click', () => {
                selectLocation(parseFloat(chip.dataset.lat), parseFloat(chip.dataset.lng), chip.dataset.name);
            });
        });
    }
 
    function renderResults(results) {
        if (results.length === 0) {
            resultsEl.innerHTML = searchInput.value.length >= 2
                ? '<div class="loc-no-results">No results found</div>'
                : '';
            return;
        }
        const currentFavs = LocationManager.getFavorites();
        resultsEl.innerHTML = results.map(r => {
            const isFav = currentFavs.some(f => f.name === r.name);
            return `
                <div class="loc-result-item">
                    <div class="loc-result-name" data-lat="${r.lat}" data-lng="${r.lng}" data-name="${r.name}">${r.name}</div>
                    <button class="loc-fav-btn ${isFav ? 'active' : ''}" data-lat="${r.lat}" data-lng="${r.lng}" data-name="${r.name}" title="${isFav ? 'Remove from favorites' : 'Add to favorites'}">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="${isFav ? 'rgba(255,220,100,0.8)' : 'none'}" stroke="${isFav ? 'rgba(255,220,100,0.8)' : 'rgba(255,255,255,0.4)'}" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
                    </button>
                </div>
            `;
        }).join('');
 
        resultsEl.querySelectorAll('.loc-result-name').forEach(el => {
            el.addEventListener('click', () => {
                selectLocation(parseFloat(el.dataset.lat), parseFloat(el.dataset.lng), el.dataset.name);
            });
        });
 
        resultsEl.querySelectorAll('.loc-fav-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const name = btn.dataset.name;
                const lat = parseFloat(btn.dataset.lat);
                const lng = parseFloat(btn.dataset.lng);
                if (LocationManager.isFavorite(name)) {
                    LocationManager.removeFavorite(name);
                } else {
                    LocationManager.addFavorite(lat, lng, name);
                }
                renderFavorites();
                renderResults(lastResults);
            });
        });
    }
 
    let lastResults = [];
 
    searchInput.addEventListener('input', () => {
        clearTimeout(searchTimeout);
        const q = searchInput.value.trim();
        if (q.length < 2) {
            resultsEl.innerHTML = '';
            lastResults = [];
            return;
        }
        searchTimeout = setTimeout(async () => {
            const results = await LocationManager.search(q);
            // Sort favorites to top
            const favNames = LocationManager.getFavorites().map(f => f.name);
            results.sort((a, b) => {
                const aFav = favNames.includes(a.name) ? 0 : 1;
                const bFav = favNames.includes(b.name) ? 0 : 1;
                return aFav - bFav;
            });
            lastResults = results;
            renderResults(results);
        }, 350);
    });
 
    function selectLocation(lat, lng, name) {
        LocationManager.setCurrent(lat, lng, name);
        closeDropdown();
        // Reload the page to fetch new data
        window.location.reload();
    }
 
    function openDropdown() {
        dropdown.style.display = 'block';
        isOpen = true;
        renderFavorites();
        searchInput.value = '';
        resultsEl.innerHTML = '';
        setTimeout(() => searchInput.focus(), 50);
    }
 
    function closeDropdown() {
        dropdown.style.display = 'none';
        isOpen = false;
    }
 
    trigger.addEventListener('click', (e) => {
        e.stopPropagation();
        if (isOpen) closeDropdown();
        else openDropdown();
    });
 
    dropdown.addEventListener('click', (e) => e.stopPropagation());
 
    document.addEventListener('click', () => {
        if (isOpen) closeDropdown();
    });
 
    searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeDropdown();
    });
}
 
// Auto-init when DOM ready
document.addEventListener('DOMContentLoaded', () => {
    initLocationSearch();
});
