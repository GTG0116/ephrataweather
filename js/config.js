// ============================================
// WEATHER DATA VIEWER - CONFIGURATION
// ============================================

const CONFIG = {
    // Google Weather API Key (primary)
    GOOGLE_WEATHER_API_KEY: 'AIzaSyBAjoVkrRrLPzv9MSrlWaWTFELT8KpJ41E',
    GOOGLE_WEATHER_BASE: 'https://weather.googleapis.com/v1',

    // Mapbox Access Token
    MAPBOX_ACCESS_TOKEN: 'pk.eyJ1IjoiZ3RnMDExNiIsImEiOiJjbWxsODV6NXAwNThmM2ZwdWlkYm0xNjFlIn0.vI186twXYzY45nnuV5FucQ',

    // OpenWeatherMap API Key — add yours here for temperature/wind map overlays
    // Get a free key at: https://openweathermap.org/api
    OWM_API_KEY: '5906af06cdd57431ce881975e794e337',

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
