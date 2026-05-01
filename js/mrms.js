// ============================================
// RADAR VIEWER - RainViewer API
// https://www.rainviewer.com/api.html
// ============================================

let map = null;
let overlayOpacity = 0.7;
let radarFrames = [];
let currentFrameIndex = -1;
let animationTimer = null;
let rainviewerHost = '';

// --- Initialize Map ---
function initMap() {
    const loc = LocationManager.getCurrent();

    const nameEl = document.getElementById('location-name');
    if (nameEl) nameEl.textContent = loc.name;

    mapboxgl.accessToken = CONFIG.MAPBOX_ACCESS_TOKEN;

    map = new mapboxgl.Map({
        container: 'map',
        style: 'mapbox://styles/mapbox/dark-v11',
        center: [loc.lng, loc.lat],
        zoom: 6,
        attributionControl: true
    });

    map.addControl(new mapboxgl.NavigationControl(), 'bottom-right');
    map.addControl(new mapboxgl.ScaleControl({ unit: 'imperial' }), 'bottom-left');

    map.on('load', () => {
        loadRadarData();
    });
}

// --- Load radar data from RainViewer ---
async function loadRadarData() {
    showLoading(true);

    try {
        const resp = await fetch('https://api.rainviewer.com/public/weather-maps.json');
        if (!resp.ok) throw new Error(`RainViewer API error: ${resp.status}`);
        const data = await resp.json();

        rainviewerHost = data.host;
        radarFrames = (data.radar?.past || []).concat(data.radar?.nowcast || []);

        if (radarFrames.length === 0) {
            throw new Error('No radar frames available');
        }

        // Show the latest frame
        showFrame(radarFrames.length - 1);

        document.getElementById('last-updated').textContent =
            'Updated ' + new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

    } catch (err) {
        console.error('Radar load error:', err);
        document.getElementById('data-timestamp').textContent = 'Error loading radar data';
        document.getElementById('last-updated').textContent = 'Load failed';
    }

    showLoading(false);
}

// --- Show a specific radar frame ---
function showFrame(index) {
    if (index < 0 || index >= radarFrames.length) return;
    currentFrameIndex = index;

    const frame = radarFrames[index];
    // Color scheme 2 = Universal Blue, options: smooth=1, snow=1
    const tileUrl = `${rainviewerHost}${frame.path}/256/{z}/{x}/{y}/2/1_1.png`;

    // Remove existing layer/source
    if (map.getLayer('radar-layer')) map.removeLayer('radar-layer');
    if (map.getSource('radar-overlay')) map.removeSource('radar-overlay');

    map.addSource('radar-overlay', {
        type: 'raster',
        tiles: [tileUrl],
        tileSize: 256,
        maxzoom: 7
    });

    map.addLayer({
        id: 'radar-layer',
        type: 'raster',
        source: 'radar-overlay',
        paint: {
            'raster-opacity': overlayOpacity,
            'raster-fade-duration': 0
        }
    });

    // Update timestamp display
    const ts = new Date(frame.time * 1000);
    document.getElementById('data-timestamp').textContent =
        ts.toLocaleString('en-US', {
            month: 'short', day: 'numeric',
            hour: 'numeric', minute: '2-digit',
            timeZoneName: 'short'
        });

    // Update timeline slider
    const slider = document.getElementById('timeline-slider');
    if (slider) {
        slider.max = radarFrames.length - 1;
        slider.value = index;
    }
}

// --- Animation controls ---
function playAnimation() {
    if (animationTimer) {
        stopAnimation();
        return;
    }

    const playBtn = document.getElementById('play-btn');
    if (playBtn) playBtn.textContent = 'Pause';

    let i = 0; // Start from the beginning
    animationTimer = setInterval(() => {
        showFrame(i);
        i++;
        if (i >= radarFrames.length) {
            i = 0; // Loop
        }
    }, 500);
}

function stopAnimation() {
    if (animationTimer) {
        clearInterval(animationTimer);
        animationTimer = null;
    }
    const playBtn = document.getElementById('play-btn');
    if (playBtn) playBtn.textContent = 'Play';
}

function onTimelineChange(value) {
    stopAnimation();
    showFrame(parseInt(value));
}

// --- UI Controls ---
function setOverlayOpacity(value) {
    overlayOpacity = value / 100;
    if (map && map.getLayer('radar-layer')) {
        map.setPaintProperty('radar-layer', 'raster-opacity', overlayOpacity);
    }
}

function showLoading(show) {
    document.getElementById('loading-overlay').style.display = show ? 'flex' : 'none';
}

function refreshRadar() {
    stopAnimation();
    loadRadarData();
}

// --- Initialize ---
initMap();
