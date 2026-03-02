// ============================================
// WEATHER DATA VIEWER - CONFIGURATION
// ============================================
// Insert your API keys below

const CONFIG = {
    // Weather data powered by Open-Meteo (free, no API key required)
    // https://open-meteo.com/

    // Mapbox Access Token
    // Get yours at: https://account.mapbox.com/
    MAPBOX_ACCESS_TOKEN: 'pk.eyJ1IjoiZ3RnMDExNiIsImEiOiJjbWxsODV6NXAwNThmM2ZwdWlkYm0xNjFlIn0.vI186twXYzY45nnuV5FucQ',

    // Default location (Ephrata, WA)
    DEFAULT_LAT: 47.3176,
    DEFAULT_LNG: -119.5536,
    DEFAULT_LOCATION_NAME: 'Ephrata, WA',

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
