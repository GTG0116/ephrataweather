// ============================================
// WEATHER DATA VIEWER - CONFIGURATION
// ============================================
// Insert your API keys below

const CONFIG = {
    // Google Weather API Key
    // Get yours at: https://console.cloud.google.com/
    GOOGLE_WEATHER_API_KEY: 'YOUR_GOOGLE_WEATHER_API_KEY_HERE',

    // Mapbox Access Token
    // Get yours at: https://account.mapbox.com/
    MAPBOX_ACCESS_TOKEN: 'YOUR_MAPBOX_ACCESS_TOKEN_HERE',

    // Default location (Ephrata, WA)
    DEFAULT_LAT: 47.3176,
    DEFAULT_LNG: -119.5536,
    DEFAULT_LOCATION_NAME: 'Ephrata, WA',

    // Google Weather API base URL
    GOOGLE_WEATHER_BASE: 'https://weather.googleapis.com/v1',

    // MRMS AWS S3 base URL
    MRMS_S3_BASE: 'https://noaa-mrms-pds.s3.amazonaws.com',

    // MRMS products to use (avoiding PrecipFlag per user preference)
    MRMS_PRODUCTS: {
        PRECIP_RATE: 'CONUS/PrecipRate_00.00',
        PRECIP_TYPE: 'CONUS/PrecipType_00.00',
        REFLECTIVITY: 'CONUS/MergedBaseReflectivityQC_00.00',
        SEAMLESS_HSR: 'CONUS/SeamlessHSR_00.00'
    }
};
