// ============================================
// WEATHER DATA VIEWER - CONFIGURATION
// ============================================

// Optional runtime config injection (set by server before app scripts load):
// window.__APP_CONFIG__ = { GOOGLE_WEATHER_API_KEY: '...', MAPBOX_ACCESS_TOKEN: '...', OWM_API_KEY: '...' }
const RUNTIME_CONFIG = (typeof window !== 'undefined' && window.__APP_CONFIG__) ? window.__APP_CONFIG__ : {};

const CONFIG = {
    // API keys must be injected at runtime for security. Do not hardcode secrets in this repo.
    GOOGLE_WEATHER_API_KEY: RUNTIME_CONFIG.GOOGLE_WEATHER_API_KEY || '',
    GOOGLE_WEATHER_BASE: 'https://weather.googleapis.com/v1',

    // Mapbox access token (public token still should be injected so it can be rotated without code changes)
    MAPBOX_ACCESS_TOKEN: RUNTIME_CONFIG.MAPBOX_ACCESS_TOKEN || '',

    // OpenWeatherMap API Key — runtime injected
    OWM_API_KEY: RUNTIME_CONFIG.OWM_API_KEY || '',

    // Default location (Ephrata, PA)
    DEFAULT_LAT: 40.1798,
    DEFAULT_LNG: -76.1789,
    DEFAULT_LOCATION_NAME: 'Ephrata, PA',

    // MRMS AWS S3 base URL
    MRMS_S3_BASE: 'https://noaa-mrms-pds.s3.amazonaws.com',

    // MRMS products
    MRMS_PRODUCTS: {
        PRECIP_RATE: 'CONUS/PrecipRate_00.00',
        PRECIP_TYPE: 'CONUS/PrecipType_00.00',
        REFLECTIVITY: 'CONUS/MergedBaseReflectivityQC_00.00',
        SEAMLESS_HSR: 'CONUS/SeamlessHSR_00.00'
    }
};
