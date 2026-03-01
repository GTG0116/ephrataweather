// ============================================
// MRMS VIEWER - Fetches MRMS data from AWS S3,
// decodes GRIB2, and renders on Mapbox map
// ============================================

// --- MRMS Grid Constants (CONUS) ---
const MRMS_GRID = {
    // MRMS CONUS grid: 0.01 degree resolution
    latMin: 20.0,
    latMax: 55.0,
    lonMin: -130.0,
    lonMax: -60.0,
    dLat: 0.01,
    dLon: 0.01,
    nLat: 3500,
    nLon: 7000
};

// --- Color scales ---
const COLOR_SCALES = {
    reflectivity: {
        name: 'MRMS Reflectivity',
        unit: 'dBZ',
        stops: [
            { val: -999, color: [0, 0, 0, 0] },        // No data
            { val: 5, color: [64, 128, 64, 160] },      // Light green
            { val: 10, color: [50, 160, 50, 180] },     // Green
            { val: 15, color: [30, 200, 30, 190] },     // Bright green
            { val: 20, color: [20, 230, 20, 200] },     // Vivid green
            { val: 25, color: [200, 230, 0, 200] },     // Yellow-green
            { val: 30, color: [255, 240, 0, 210] },     // Yellow
            { val: 35, color: [255, 200, 0, 210] },     // Dark yellow
            { val: 40, color: [255, 140, 0, 220] },     // Orange
            { val: 45, color: [255, 80, 0, 230] },      // Dark orange
            { val: 50, color: [255, 0, 0, 240] },       // Red
            { val: 55, color: [200, 0, 50, 240] },      // Dark red
            { val: 60, color: [180, 0, 180, 240] },     // Magenta
            { val: 65, color: [120, 0, 200, 240] },     // Purple
            { val: 70, color: [255, 255, 255, 250] },   // White
        ],
        legend: [
            { label: '5 dBZ', color: 'rgb(64,128,64)' },
            { label: '20 dBZ', color: 'rgb(20,230,20)' },
            { label: '30 dBZ', color: 'rgb(255,240,0)' },
            { label: '40 dBZ', color: 'rgb(255,140,0)' },
            { label: '50 dBZ', color: 'rgb(255,0,0)' },
            { label: '60 dBZ', color: 'rgb(180,0,180)' },
            { label: '70+ dBZ', color: 'rgb(255,255,255)' },
        ]
    },
    precipRate: {
        name: 'MRMS Precip Rate',
        unit: 'mm/hr',
        stops: [
            { val: -999, color: [0, 0, 0, 0] },
            { val: 0.1, color: [0, 180, 0, 150] },
            { val: 0.5, color: [0, 220, 0, 170] },
            { val: 1.0, color: [100, 240, 0, 180] },
            { val: 2.0, color: [255, 255, 0, 190] },
            { val: 5.0, color: [255, 180, 0, 200] },
            { val: 10.0, color: [255, 100, 0, 220] },
            { val: 20.0, color: [255, 0, 0, 230] },
            { val: 50.0, color: [200, 0, 150, 240] },
            { val: 100.0, color: [150, 0, 200, 250] },
        ],
        legend: [
            { label: '0.1 mm/hr', color: 'rgb(0,180,0)' },
            { label: '1 mm/hr', color: 'rgb(100,240,0)' },
            { label: '5 mm/hr', color: 'rgb(255,180,0)' },
            { label: '10 mm/hr', color: 'rgb(255,100,0)' },
            { label: '20 mm/hr', color: 'rgb(255,0,0)' },
            { label: '50+ mm/hr', color: 'rgb(200,0,150)' },
        ]
    },
    precipType: {
        name: 'MRMS Precip Type',
        unit: '',
        // PrecipType values (NOT PrecipFlag):
        // 0 = No precip, 1 = Warm Rain, 2 = Snow, 3 = Ice Pellets,
        // 4 = Freezing Rain, 5 = Hail, 6 = Big Drops,
        // 91 = Cool/Stratiform Rain, 96 = Graupel/Small Hail
        typeColors: {
            0: [0, 0, 0, 0],            // No precip - transparent
            1: [0, 200, 0, 200],        // Warm Rain - green
            2: [0, 160, 255, 200],      // Snow - blue
            3: [255, 140, 200, 200],    // Ice Pellets - pink
            4: [255, 80, 80, 200],      // Freezing Rain - red
            5: [255, 255, 255, 230],    // Hail - white
            6: [0, 240, 120, 200],      // Big Drops - bright green
            91: [80, 200, 80, 190],     // Cool/Stratiform Rain - lighter green
            96: [200, 180, 255, 210],   // Graupel - lavender
        },
        legend: [
            { label: 'Warm Rain', color: 'rgb(0,200,0)' },
            { label: 'Stratiform Rain', color: 'rgb(80,200,80)' },
            { label: 'Snow', color: 'rgb(0,160,255)' },
            { label: 'Ice Pellets', color: 'rgb(255,140,200)' },
            { label: 'Freezing Rain', color: 'rgb(255,80,80)' },
            { label: 'Hail', color: 'rgb(255,255,255)' },
            { label: 'Graupel', color: 'rgb(200,180,255)' },
        ]
    }
};

// --- State ---
let map = null;
let currentProduct = 'reflectivity';
let overlayOpacity = 0.7;
let canvasSource = null;

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
        // Add empty canvas source for MRMS overlay
        const canvas = document.createElement('canvas');
        canvas.width = 1;
        canvas.height = 1;

        map.addSource('mrms-overlay', {
            type: 'canvas',
            canvas: canvas,
            coordinates: [
                [MRMS_GRID.lonMin, MRMS_GRID.latMax],
                [MRMS_GRID.lonMax, MRMS_GRID.latMax],
                [MRMS_GRID.lonMax, MRMS_GRID.latMin],
                [MRMS_GRID.lonMin, MRMS_GRID.latMin]
            ],
            animate: false
        });

        map.addLayer({
            id: 'mrms-layer',
            type: 'raster',
            source: 'mrms-overlay',
            paint: {
                'raster-opacity': overlayOpacity,
                'raster-fade-duration': 0
            }
        });

        canvasSource = map.getSource('mrms-overlay');
        loadMRMSData(currentProduct);
    });
}

// --- Load MRMS Data from AWS S3 ---
async function loadMRMSData(product) {
    showLoading(true);

    try {
        // Find latest available file from S3
        const productPath = getProductPath(product);
        const latestFile = await findLatestMRMSFile(productPath);

        if (!latestFile) {
            throw new Error('No recent MRMS data found');
        }

        // Fetch the gzip'd GRIB2 file
        const url = `${CONFIG.MRMS_S3_BASE}/${latestFile}`;
        const response = await fetch(url);

        if (!response.ok) throw new Error(`Failed to fetch MRMS data: ${response.status}`);

        const compressedData = await response.arrayBuffer();

        // Decompress gzip
        let rawData;
        try {
            rawData = pako.ungzip(new Uint8Array(compressedData));
        } catch (e) {
            // File might not be gzipped
            rawData = new Uint8Array(compressedData);
        }

        // Parse GRIB2 and extract grid data
        const gridData = parseGRIB2(rawData, product);

        // Render to canvas and update map
        renderToCanvas(gridData, product);

        // Update UI
        const timestamp = extractTimestamp(latestFile);
        document.getElementById('data-timestamp').textContent = timestamp;
        document.getElementById('product-name').textContent = COLOR_SCALES[product].name;
        updateLegend(product);

        document.getElementById('last-updated').textContent =
            'Data: ' + timestamp;

    } catch (err) {
        console.error('MRMS load error:', err);
        document.getElementById('data-timestamp').textContent = 'Error loading data';
        document.getElementById('last-updated').textContent = 'Load failed';

        // Try fallback to rendered tiles
        loadFallbackTiles(product);
    }

    showLoading(false);
}

// --- Get S3 path for product ---
function getProductPath(product) {
    switch (product) {
        case 'reflectivity': return CONFIG.MRMS_PRODUCTS.SEAMLESS_HSR;
        case 'precipRate': return CONFIG.MRMS_PRODUCTS.PRECIP_RATE;
        case 'precipType': return CONFIG.MRMS_PRODUCTS.PRECIP_TYPE;
        default: return CONFIG.MRMS_PRODUCTS.SEAMLESS_HSR;
    }
}

// --- Find latest MRMS file from S3 listing ---
async function findLatestMRMSFile(productPath) {
    // S3 list objects API - get latest files
    const listUrl = `${CONFIG.MRMS_S3_BASE}/?list-type=2&prefix=${productPath}/&delimiter=/`;
    const response = await fetch(listUrl);
    const text = await response.text();

    // Parse XML response
    const parser = new DOMParser();
    const xml = parser.parseFromString(text, 'text/xml');
    const contents = xml.querySelectorAll('Contents');

    if (contents.length === 0) {
        // Try without trailing slash
        const listUrl2 = `${CONFIG.MRMS_S3_BASE}/?list-type=2&prefix=${productPath}&delimiter=/`;
        const response2 = await fetch(listUrl2);
        const text2 = await response2.text();
        const xml2 = parser.parseFromString(text2, 'text/xml');
        const contents2 = xml2.querySelectorAll('Contents');

        if (contents2.length === 0) return null;

        // Get the most recent file (last in list, sorted by key)
        const keys = Array.from(contents2).map(c => c.querySelector('Key')?.textContent).filter(Boolean);
        const gribFiles = keys.filter(k => k.endsWith('.grib2.gz') || k.endsWith('.grib2'));
        return gribFiles.length > 0 ? gribFiles[gribFiles.length - 1] : null;
    }

    const keys = Array.from(contents).map(c => c.querySelector('Key')?.textContent).filter(Boolean);
    const gribFiles = keys.filter(k => k.endsWith('.grib2.gz') || k.endsWith('.grib2'));
    return gribFiles.length > 0 ? gribFiles[gribFiles.length - 1] : null;
}

// --- GRIB2 Parser (targeted for MRMS products) ---
function parseGRIB2(data, product) {
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    let offset = 0;

    // Section 0: Indicator Section
    // Verify GRIB magic number
    const magic = String.fromCharCode(data[0], data[1], data[2], data[3]);
    if (magic !== 'GRIB') {
        console.warn('Not a valid GRIB2 file, attempting raw data interpretation');
        return interpretRawGrid(data, product);
    }

    const discipline = data[6];
    const edition = data[7];
    const totalLength = Number(view.getBigUint64(8));

    offset = 16; // After section 0

    let gridDef = null;
    let gridData = null;
    let refValue = 0;
    let binaryScale = 0;
    let decimalScale = 0;
    let nBits = 0;
    let nDataPoints = 0;
    let scanMode = 0;
    let ni = 0, nj = 0;
    let la1 = 0, lo1 = 0, la2 = 0, lo2 = 0;

    // Parse sections
    while (offset < data.byteLength - 4) {
        // Check for end section '7777'
        if (data[offset] === 0x37 && data[offset + 1] === 0x37 &&
            data[offset + 2] === 0x37 && data[offset + 3] === 0x37) {
            break;
        }

        const sectionLength = view.getUint32(offset);
        if (sectionLength < 5 || sectionLength > data.byteLength - offset) break;

        const sectionNum = data[offset + 4];

        switch (sectionNum) {
            case 3: // Grid Definition Section
                nDataPoints = view.getUint32(offset + 6);
                const templateNum = view.getUint16(offset + 12);

                if (templateNum === 0) { // Lat/Lon grid
                    ni = view.getUint32(offset + 30);
                    nj = view.getUint32(offset + 34);
                    la1 = view.getInt32(offset + 46) / 1e6;
                    lo1 = view.getInt32(offset + 50) / 1e6;
                    la2 = view.getInt32(offset + 55) / 1e6;
                    lo2 = view.getInt32(offset + 59) / 1e6;
                    scanMode = data[offset + 71];
                }
                gridDef = { ni, nj, la1, lo1, la2, lo2, scanMode, nDataPoints };
                break;

            case 5: // Data Representation Section
                nDataPoints = view.getUint32(offset + 5);
                const drsTemplate = view.getUint16(offset + 9);

                if (drsTemplate === 0 || drsTemplate === 40 || drsTemplate === 200) {
                    // Simple packing or JPEG2000 or run length
                    refValue = view.getFloat32(offset + 11);
                    binaryScale = view.getInt16(offset + 15);
                    decimalScale = view.getInt16(offset + 17);
                    nBits = data[offset + 19];
                }
                break;

            case 7: // Data Section
                const dataStart = offset + 5;
                const dataLength = sectionLength - 5;

                if (nBits > 0 && nBits <= 32) {
                    gridData = decodeSimplePacking(
                        data.slice(dataStart, dataStart + dataLength),
                        nDataPoints, nBits, refValue, binaryScale, decimalScale
                    );
                } else if (nBits === 0) {
                    // All values are the reference value
                    gridData = new Float32Array(nDataPoints).fill(refValue);
                }
                break;
        }

        offset += sectionLength;
    }

    if (!gridData || !gridDef) {
        console.warn('Could not fully parse GRIB2, using fallback grid');
        return interpretRawGrid(data, product);
    }

    return {
        data: gridData,
        ni: gridDef.ni,
        nj: gridDef.nj,
        la1: gridDef.la1,
        lo1: gridDef.lo1,
        la2: gridDef.la2,
        lo2: gridDef.lo2,
        scanMode: gridDef.scanMode
    };
}

// --- Decode simple packing ---
function decodeSimplePacking(packedData, nPoints, nBits, refValue, binaryScale, decimalScale) {
    const result = new Float32Array(nPoints);
    const bsFactor = Math.pow(2, binaryScale);
    const dsFactor = Math.pow(10, -decimalScale);

    let bitOffset = 0;

    for (let i = 0; i < nPoints; i++) {
        let raw = 0;
        let bitsRemaining = nBits;
        let byteIndex = Math.floor(bitOffset / 8);
        let bitInByte = bitOffset % 8;

        while (bitsRemaining > 0) {
            if (byteIndex >= packedData.length) break;

            const bitsAvail = 8 - bitInByte;
            const bitsToRead = Math.min(bitsRemaining, bitsAvail);
            const mask = ((1 << bitsToRead) - 1) << (bitsAvail - bitsToRead);
            const val = (packedData[byteIndex] & mask) >> (bitsAvail - bitsToRead);

            raw = (raw << bitsToRead) | val;
            bitsRemaining -= bitsToRead;
            bitOffset += bitsToRead;
            bitInByte = 0;
            byteIndex = Math.floor(bitOffset / 8);
        }

        result[i] = (refValue + raw * bsFactor) * dsFactor;
        bitOffset = Math.ceil(bitOffset); // Align
    }

    return result;
}

// --- Fallback: interpret raw binary data as grid ---
function interpretRawGrid(data, product) {
    // Create a default CONUS grid if GRIB2 parsing fails
    const ni = 700; // Downsampled for performance
    const nj = 350;
    const gridData = new Float32Array(ni * nj);

    // This is a fallback - data won't be meaningful without proper GRIB2 decode
    console.warn('Using raw data fallback - display may be inaccurate');

    return {
        data: gridData,
        ni: ni,
        nj: nj,
        la1: MRMS_GRID.latMax,
        lo1: MRMS_GRID.lonMin,
        la2: MRMS_GRID.latMin,
        lo2: MRMS_GRID.lonMax,
        scanMode: 0
    };
}

// --- Render grid data to canvas ---
function renderToCanvas(gridInfo, product) {
    // Downsample for rendering performance
    const maxCanvasSize = 2000;
    const scaleX = Math.min(1, maxCanvasSize / gridInfo.ni);
    const scaleY = Math.min(1, maxCanvasSize / gridInfo.nj);
    const width = Math.floor(gridInfo.ni * scaleX);
    const height = Math.floor(gridInfo.nj * scaleY);

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    const imageData = ctx.createImageData(width, height);
    const pixels = imageData.data;

    const colorScale = COLOR_SCALES[product];
    const isType = product === 'precipType';

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            // Map canvas pixel to grid index
            const srcX = Math.floor(x / scaleX);
            const srcY = Math.floor(y / scaleY);

            // Handle scan mode (bit flags for direction)
            let idx;
            if (gridInfo.scanMode & 0x80) {
                // +i direction (left to right) is default
                idx = srcY * gridInfo.ni + srcX;
            } else {
                idx = srcY * gridInfo.ni + srcX;
            }
            if (!(gridInfo.scanMode & 0x40)) {
                // -j direction (top to bottom)
                idx = (gridInfo.nj - 1 - srcY) * gridInfo.ni + srcX;
            }

            if (idx < 0 || idx >= gridInfo.data.length) continue;

            const value = gridInfo.data[idx];
            const color = isType ? getTypeColor(value, colorScale) : getScaleColor(value, colorScale);

            const pixelIdx = (y * width + x) * 4;
            pixels[pixelIdx] = color[0];
            pixels[pixelIdx + 1] = color[1];
            pixels[pixelIdx + 2] = color[2];
            pixels[pixelIdx + 3] = color[3];
        }
    }

    ctx.putImageData(imageData, 0, 0);

    // Update map source
    updateMapOverlay(canvas, gridInfo);
}

// --- Get color from continuous scale ---
function getScaleColor(value, scale) {
    if (value == null || value <= scale.stops[0].val || isNaN(value) || value === -999 || value === -9999 || value < -900) {
        return [0, 0, 0, 0];
    }

    const stops = scale.stops;
    for (let i = stops.length - 1; i >= 0; i--) {
        if (value >= stops[i].val) {
            if (i === stops.length - 1) return stops[i].color;

            // Interpolate between stops
            const t = (value - stops[i].val) / (stops[i + 1].val - stops[i].val);
            return [
                Math.round(stops[i].color[0] + t * (stops[i + 1].color[0] - stops[i].color[0])),
                Math.round(stops[i].color[1] + t * (stops[i + 1].color[1] - stops[i].color[1])),
                Math.round(stops[i].color[2] + t * (stops[i + 1].color[2] - stops[i].color[2])),
                Math.round(stops[i].color[3] + t * (stops[i + 1].color[3] - stops[i].color[3]))
            ];
        }
    }
    return [0, 0, 0, 0];
}

// --- Get color from type map ---
function getTypeColor(value, scale) {
    if (value == null || isNaN(value)) return [0, 0, 0, 0];
    const intVal = Math.round(value);
    return scale.typeColors[intVal] || [0, 0, 0, 0];
}

// --- Update map with rendered canvas ---
function updateMapOverlay(canvas, gridInfo) {
    // Remove existing source/layer and re-add with new canvas
    if (map.getLayer('mrms-layer')) map.removeLayer('mrms-layer');
    if (map.getSource('mrms-overlay')) map.removeSource('mrms-overlay');

    // Determine coordinates from grid info
    const west = gridInfo.lo1 > 180 ? gridInfo.lo1 - 360 : gridInfo.lo1;
    const east = gridInfo.lo2 > 180 ? gridInfo.lo2 - 360 : gridInfo.lo2;
    const north = Math.max(gridInfo.la1, gridInfo.la2);
    const south = Math.min(gridInfo.la1, gridInfo.la2);

    map.addSource('mrms-overlay', {
        type: 'image',
        url: canvas.toDataURL(),
        coordinates: [
            [west, north],
            [east, north],
            [east, south],
            [west, south]
        ]
    });

    map.addLayer({
        id: 'mrms-layer',
        type: 'raster',
        source: 'mrms-overlay',
        paint: {
            'raster-opacity': overlayOpacity,
            'raster-fade-duration': 0
        }
    });
}

// --- Fallback: use WMS tiles if GRIB2 fails ---
function loadFallbackTiles(product) {
    // Use Iowa Environmental Mesonet MRMS tiles as fallback
    const iemProducts = {
        reflectivity: 'q2_hsr',
        precipRate: 'q2_p1h',
        precipType: 'q2_hsr'
    };

    const tileProduct = iemProducts[product] || 'q2_hsr';
    const tileUrl = `https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0/${tileProduct}/{z}/{x}/{y}.png`;

    if (map.getLayer('mrms-layer')) map.removeLayer('mrms-layer');
    if (map.getSource('mrms-overlay')) map.removeSource('mrms-overlay');

    map.addSource('mrms-overlay', {
        type: 'raster',
        tiles: [tileUrl],
        tileSize: 256,
        attribution: 'MRMS via Iowa Environmental Mesonet'
    });

    map.addLayer({
        id: 'mrms-layer',
        type: 'raster',
        source: 'mrms-overlay',
        paint: {
            'raster-opacity': overlayOpacity,
            'raster-fade-duration': 300
        }
    });

    document.getElementById('data-timestamp').textContent = 'Live tiles (fallback)';
    document.getElementById('last-updated').textContent = 'Using tile fallback';
}

// --- Extract timestamp from filename ---
function extractTimestamp(filename) {
    // MRMS filenames contain timestamps like: MRMS_SeamlessHSR_00.00_20240101-120000.grib2.gz
    const match = filename.match(/(\d{8})-(\d{6})/);
    if (match) {
        const dateStr = match[1];
        const timeStr = match[2];
        const year = dateStr.substring(0, 4);
        const month = dateStr.substring(4, 6);
        const day = dateStr.substring(6, 8);
        const hour = timeStr.substring(0, 2);
        const min = timeStr.substring(2, 4);

        const utcDate = new Date(Date.UTC(year, month - 1, day, hour, min));
        return utcDate.toLocaleString('en-US', {
            month: 'short', day: 'numeric',
            hour: 'numeric', minute: '2-digit',
            timeZoneName: 'short'
        });
    }
    return 'Recent';
}

// --- Update legend ---
function updateLegend(product) {
    const legend = document.getElementById('map-legend');
    const scale = COLOR_SCALES[product];

    legend.innerHTML = `
        <h4>${product === 'precipType' ? 'Precip Type' : scale.unit}</h4>
        ${scale.legend.map(item => `
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
    loadMRMSData(product);
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
