// ============================================
// MRMS VIEWER - Uses live tile layers from
// NOAA GeoServer (WMS) and IEM (TMS)
// ============================================

// --- Product definitions with tile sources ---
const MRMS_PRODUCTS = {
    precipType: {
        name: 'MRMS Precip Type',
        // NOAA GeoServer WMS - official MRMS precipitation type
        tileUrl: 'https://opengeo.ncep.noaa.gov/geoserver/conus/conus_pcpn_typ/ows?service=WMS&version=1.1.1&request=GetMap&layers=conus_pcpn_typ&bbox={bbox-epsg-3857}&width=256&height=256&srs=EPSG:3857&format=image/png&transparent=true',
        tileType: 'wms',
        legend: [
            { label: 'Warm Rain', color: 'rgb(0,200,0)' },
            { label: 'Stratiform Rain', color: 'rgb(80,200,80)' },
            { label: 'Snow', color: 'rgb(0,160,255)' },
            { label: 'Ice Pellets', color: 'rgb(255,140,200)' },
            { label: 'Freezing Rain', color: 'rgb(255,80,80)' },
            { label: 'Hail', color: 'rgb(255,255,255)' },
            { label: 'Graupel', color: 'rgb(200,180,255)' }
        ],
        legendTitle: 'Precip Type'
    },
    reflectivity: {
        name: 'MRMS Reflectivity',
        // NOAA GeoServer WMS - base reflectivity QC'd
        tileUrl: 'https://opengeo.ncep.noaa.gov/geoserver/conus/conus_bref_qcd/ows?service=WMS&version=1.1.1&request=GetMap&layers=conus_bref_qcd&bbox={bbox-epsg-3857}&width=256&height=256&srs=EPSG:3857&format=image/png&transparent=true',
        tileType: 'wms',
        legend: [
            { label: '5 dBZ', color: 'rgb(64,128,64)' },
            { label: '20 dBZ', color: 'rgb(20,230,20)' },
            { label: '30 dBZ', color: 'rgb(255,240,0)' },
            { label: '40 dBZ', color: 'rgb(255,140,0)' },
            { label: '50 dBZ', color: 'rgb(255,0,0)' },
            { label: '60 dBZ', color: 'rgb(180,0,180)' },
            { label: '70+ dBZ', color: 'rgb(255,255,255)' }
        ],
        legendTitle: 'dBZ'
    },
    precipRate: {
        name: 'MRMS Precip Rate',
        // IEM tile cache - MRMS precip rate
        tileUrl: 'https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0/q2_n1p/{z}/{x}/{y}.png',
        tileType: 'tms',
        legend: [
            { label: '0.1 mm/hr', color: 'rgb(0,180,0)' },
            { label: '1 mm/hr', color: 'rgb(100,240,0)' },
            { label: '5 mm/hr', color: 'rgb(255,180,0)' },
            { label: '10 mm/hr', color: 'rgb(255,100,0)' },
            { label: '20 mm/hr', color: 'rgb(255,0,0)' },
            { label: '50+ mm/hr', color: 'rgb(200,0,150)' }
        ],
        legendTitle: 'mm/hr'
    }
};

// --- State ---
let map = null;
let currentProduct = 'precipType';
let overlayOpacity = 0.7;

// --- Initialize Map ---
function initMap() {
    mapboxgl.accessToken = CONFIG.MAPBOX_ACCESS_TOKEN;

    map = new mapboxgl.Map({
        container: 'map',
        style: 'mapbox://styles/mapbox/dark-v11',
        center: [CONFIG.DEFAULT_LNG, CONFIG.DEFAULT_LAT],
        zoom: 6,
        attributionControl: true
    });

    map.addControl(new mapboxgl.NavigationControl(), 'bottom-right');
    map.addControl(new mapboxgl.ScaleControl({ unit: 'imperial' }), 'bottom-left');

    map.on('load', () => {
        loadProduct(currentProduct);
    });
}

// --- Load a product's tile layer ---
function loadProduct(product) {
    showLoading(true);

    const productDef = MRMS_PRODUCTS[product];
    if (!productDef) {
        showLoading(false);
        return;
    }

    // Remove existing layer/source
    if (map.getLayer('mrms-layer')) map.removeLayer('mrms-layer');
    if (map.getSource('mrms-overlay')) map.removeSource('mrms-overlay');

    // Add tile source
    if (productDef.tileType === 'wms') {
        map.addSource('mrms-overlay', {
            type: 'raster',
            tiles: [productDef.tileUrl],
            tileSize: 256
        });
    } else {
        map.addSource('mrms-overlay', {
            type: 'raster',
            tiles: [productDef.tileUrl],
            tileSize: 256,
            attribution: 'MRMS via Iowa Environmental Mesonet'
        });
    }

    map.addLayer({
        id: 'mrms-layer',
        type: 'raster',
        source: 'mrms-overlay',
        paint: {
            'raster-opacity': overlayOpacity,
            'raster-fade-duration': 300
        }
    });

    // Update UI
    document.getElementById('product-name').textContent = productDef.name;
    document.getElementById('data-timestamp').textContent = 'Live';
    document.getElementById('last-updated').textContent =
        'Updated ' + new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    updateLegend(product);

    showLoading(false);
}

// --- Update legend ---
function updateLegend(product) {
    const legend = document.getElementById('map-legend');
    const productDef = MRMS_PRODUCTS[product];
    if (!productDef) return;

    legend.innerHTML = `
        <h4>${productDef.legendTitle}</h4>
        ${productDef.legend.map(item => `
            <div class="legend-item">
                <div class="legend-color" style="background:${item.color};"></div>
                <span>${item.label}</span>
            </div>
        `).join('')}
    `;
}

// --- UI Controls ---
function switchProduct(product, btn) {
    currentProduct = product;
    document.querySelectorAll('.product-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    loadProduct(product);
}

function setOverlayOpacity(value) {
    overlayOpacity = value / 100;
    if (map && map.getLayer('mrms-layer')) {
        map.setPaintProperty('mrms-layer', 'raster-opacity', overlayOpacity);
    }
}

function showLoading(show) {
    document.getElementById('loading-overlay').style.display = show ? 'flex' : 'none';
}

// --- Initialize ---
initMap();
