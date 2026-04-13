// ============================================
// CURRENT CONDITIONS PAGE LOGIC
// ============================================

// Auto-refresh timer handle — cleared and restarted each time the view inits.
let _autoRefreshTimer = null;

// initCurrentView can be called by the SPA router or by a standalone page.
// Pass lat/lng directly, or omit to use LocationManager.getCurrent().
async function initCurrentView(lat, lng) {
    // Clear any existing auto-refresh timer before starting a new one.
    if (_autoRefreshTimer) { clearInterval(_autoRefreshTimer); _autoRefreshTimer = null; }

    if (lat == null || lng == null) {
        const loc = LocationManager.getCurrent();
        lat = loc.lat;
        lng = loc.lng;
    }

    // Determine data source
    const dataSource = WeatherAPI.getDataSource();
    const isNWS = dataSource === 'nws';
    const isOpenMeteo = dataSource === 'open-meteo';
    const isOWM = dataSource === 'owm';

    function _getCurrentFn() {
        if (isNWS) return WeatherAPI.getNWSCurrentConditions(lat, lng);
        if (isOpenMeteo) return WeatherAPI.getOpenMeteoCurrentConditions(lat, lng);
        if (isOWM) return WeatherAPI.getOWMCurrentConditions(lat, lng);
        return WeatherAPI.getCurrentConditions(lat, lng); // google
    }
    function _getHourlyFn() {
        if (isNWS) return WeatherAPI.getNWSHourlyForecast(lat, lng, 24);
        if (isOpenMeteo) return WeatherAPI.getOpenMeteoHourlyForecast(lat, lng, 24);
        if (isOWM) return WeatherAPI.getOWMHourlyForecast(lat, lng, 24);
        return WeatherAPI.getHourlyForecast(lat, lng, 24); // google
    }
    function _getDailyFn(days) {
        if (isNWS) return WeatherAPI.getNWSDailyForecast(lat, lng, days);
        if (isOpenMeteo) return WeatherAPI.getOpenMeteoDailyForecast(lat, lng, days);
        if (isOWM) return WeatherAPI.getOWMDailyForecast(lat, lng, days);
        return WeatherAPI.getDailyForecast(lat, lng, days); // google
    }

    // Start alerts loading concurrently — it renders to its own DOM sections
    // so it doesn't need to block the main weather data rendering.
    const _alertsTask = loadAndRenderAlerts(lat, lng).catch(err => console.warn('Alerts error:', err));

    // Load climate normals in parallel so FairWeatherIndex can use
    // location-specific historical temperature targets for FWI scoring.
    const _normalsTask = (typeof ClimateNormals !== 'undefined')
        ? ClimateNormals.loadForLocation(lat, lng).catch(e => console.warn('Climate normals unavailable:', e))
        : Promise.resolve();

    // Fetch weather data in parallel
    const [currentResult, hourlyResult, dailyResult, aqiResult, pollenResult] = await Promise.allSettled([
        _getCurrentFn(),
        _getHourlyFn(),
        // Pull a few days so hourly day/night selection can use
        // each hour's date-specific sunrise/sunset window.
        _getDailyFn(3),
        WeatherAPI.getAirQuality(lat, lng),
        WeatherAPI.getPollen(lat, lng)
    ]);

    // Ensure normals are ready before rendering FWI badges
    await _normalsTask;

    // --- Current Conditions ---
    if (currentResult.status === 'fulfilled') {
        renderCurrentConditions(currentResult.value, dailyResult.status === 'fulfilled' ? dailyResult.value : null);
    } else {
        document.getElementById('current-condition').textContent = 'Unable to load current conditions';
        console.error('Current conditions error:', currentResult.reason);
    }

    // --- Hourly Forecast ---
    if (hourlyResult.status === 'fulfilled') {
        const forecastDays = dailyResult.status === 'fulfilled' ? dailyResult.value?.forecastDays : [];
        renderHourlyForecast(hourlyResult.value, forecastDays);
    } else {
        document.getElementById('hourly-strip').innerHTML =
            '<div class="error-message">Unable to load hourly forecast<div class="error-hint">Check your API key</div></div>';
        console.error('Hourly forecast error:', hourlyResult.reason);
    }

    // --- Air Quality ---
    if (aqiResult.status === 'fulfilled') {
        renderAirQuality(aqiResult.value);
    } else {
        document.getElementById('aqi-value').textContent = 'N/A';
        document.getElementById('aqi-badge').textContent = 'Unavailable';
        console.error('AQI error:', aqiResult.reason);
    }

    // --- Pollen ---
    if (pollenResult.status === 'fulfilled') {
        renderPollen(pollenResult.value);
    } else {
        renderPollen({});  // sets all pollen levels to "None"
        console.error('Pollen error:', pollenResult.reason);
    }

    // Update timestamp
    const tsEl = document.getElementById('last-updated');
    if (tsEl) tsEl.textContent =
        'Updated ' + new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

    // Start 1-minute auto-refresh for alerts and current conditions.
    _autoRefreshTimer = setInterval(() => _autoRefreshCurrent(), 60 * 1000);
}

// Lightweight periodic refresh: alerts + current conditions + AQI.
// Runs every minute while the current-conditions view is active.
async function _autoRefreshCurrent() {
    const loc = LocationManager.getCurrent();
    if (!loc?.lat) return;

    const _src = WeatherAPI.getDataSource();
    function _getAutoRefreshCurrentFn() {
        if (_src === 'nws') return WeatherAPI.getNWSCurrentConditions(loc.lat, loc.lng);
        if (_src === 'open-meteo') return WeatherAPI.getOpenMeteoCurrentConditions(loc.lat, loc.lng);
        if (_src === 'owm') return WeatherAPI.getOWMCurrentConditions(loc.lat, loc.lng);
        return WeatherAPI.getCurrentConditions(loc.lat, loc.lng);
    }

    const [currentResult, aqiResult] = await Promise.allSettled([
        _getAutoRefreshCurrentFn(),
        WeatherAPI.getAirQuality(loc.lat, loc.lng)
    ]);

    if (currentResult.status === 'fulfilled') {
        renderCurrentConditions(currentResult.value, null);
    }
    if (aqiResult.status === 'fulfilled') {
        renderAirQuality(aqiResult.value);
    }

    try {
        await loadAndRenderAlerts(loc.lat, loc.lng);
    } catch (e) { /* silent */ }

    // Also refresh MRMS radar on the open alert map (if any)
    if (_alertMap) _loadMRMSToAlertMap();

    const tsEl = document.getElementById('last-updated');
    if (tsEl) tsEl.textContent =
        'Updated ' + new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

// Auto-run on standalone page (not loaded inside the SPA)
if (typeof _SPA_MODE === 'undefined') {
    (async function () {
        const loc = await LocationManager.init();
        const nameEl = document.getElementById('location-name');
        if (nameEl) nameEl.textContent = loc.name;
        await initCurrentView(loc.lat, loc.lng);
    })();
}

// ---- Alerts ----
let _renderedAlerts = [];
let _alertMap = null;
// The alert currently open in the modal — used by action buttons.
let _currentOpenAlert = null;
// Bounds [[west,south],[east,north]] of the last-drawn alert map polygon (for radar nav).
let _lastAlertMapBounds = null;
// Timezone of the currently-viewed location (IANA string, e.g. "America/Chicago").
// Set when alerts are loaded so times are shown in the location's local timezone.
let _locationTimeZone = null;

function _escapeHtml(str) {
    return String(str || '').replace(/[&<>"']/g, (ch) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[ch] || ch));
}

function _formatAlertTime(ts) {
    if (!ts) return 'N/A';
    const d = new Date(ts);
    if (isNaN(d)) return 'N/A';
    // Use the location's timezone so Midwest alerts show Central time, etc.
    const tz = _locationTimeZone || Intl.DateTimeFormat().resolvedOptions().timeZone;
    return d.toLocaleString('en-US', {
        month: 'short', day: 'numeric',
        hour: 'numeric', minute: '2-digit',
        timeZoneName: 'short',
        timeZone: tz
    });
}

// ---- Alert subtype classification ----
// Returns an object { type, label, colorClass } or null for standard alerts.
function _alertSubtype(alert) {
    const event = (alert.event || '').toLowerCase();
    const headline = (alert.headline || '').toUpperCase();
    const desc = (alert.description || '').toUpperCase();
    const params = alert.parameters || {};

    if (event.includes('tornado warning')) {
        // Tornado Emergency takes highest priority
        if (desc.includes('TORNADO EMERGENCY') || headline.includes('TORNADO EMERGENCY')) {
            return { type: 'tornado_emergency', label: 'TORNADO EMERGENCY', colorClass: 'subtype-emergency' };
        }
        const detection = (params.tornadoDetection?.[0] || '').toUpperCase();
        // PDS Tornado Warning
        if (detection.includes('PARTICULARLY DANGEROUS') || desc.includes('PARTICULARLY DANGEROUS SITUATION')) {
            return { type: 'pds_tornado', label: 'PARTICULARLY DANGEROUS SITUATION', colorClass: 'subtype-pds' };
        }
        // Observed tornado
        if (detection === 'OBSERVED') {
            return { type: 'tornado_observed', label: 'TORNADO OBSERVED', colorClass: 'subtype-observed' };
        }
        return null;
    }

    if (event.includes('flash flood warning')) {
        // Flash Flood Emergency
        if (desc.includes('FLASH FLOOD EMERGENCY') || headline.includes('FLASH FLOOD EMERGENCY')) {
            return { type: 'flash_flood_emergency', label: 'FLASH FLOOD EMERGENCY', colorClass: 'subtype-emergency' };
        }
        const detection = (params.flashFloodDetection?.[0] || '').toUpperCase();
        if (detection === 'OBSERVED') {
            return { type: 'flash_flood_observed', label: 'FLASH FLOOD OBSERVED', colorClass: 'subtype-observed' };
        }
        return null;
    }

    if (event.includes('severe thunderstorm warning')) {
        const threat = (params.thunderstormDamageThreat?.[0] || '').toUpperCase();
        // EXTREME = EDS (Extremely Dangerous Situation) — highest SVR tier
        if (threat === 'EXTREME') {
            return { type: 'eds_tstm', label: 'EXTREMELY DANGEROUS SITUATION', colorClass: 'subtype-pds' };
        }
        // DESTRUCTIVE — rare, ≥80 mph winds or ≥2.5" hail
        if (threat === 'DESTRUCTIVE') {
            return { type: 'destructive_tstm', label: 'DESTRUCTIVE', colorClass: 'subtype-emergency' };
        }
        // CONSIDERABLE — 70-79 mph winds or 1.75-2.49" hail
        if (threat === 'CONSIDERABLE') {
            return { type: 'considerable_tstm', label: 'CONSIDERABLE', colorClass: 'subtype-considerable' };
        }
        return null;
    }

    return null;
}

// ---- Extract wind/hail details from Severe Thunderstorm Warnings ----
function _extractSevereThunderstormDetails(alert) {
    const event = (alert.event || '').toLowerCase();
    if (!event.includes('severe thunderstorm warning')) return null;

    const params = alert.parameters || {};
    const desc = alert.description || '';

    // Try structured NWS parameters first
    let wind = null;
    let hail = null;

    if (params.maxWindGust?.[0]) {
        wind = params.maxWindGust[0].toString().replace(/mph/i, '').trim() + ' mph';
    } else {
        const m = desc.match(/WIND[S]?\.{2,3}(\d+)\s*MPH/i)
               || desc.match(/WINDS?\s+UP\s+TO\s+(\d+)\s*MPH/i)
               || desc.match(/(\d+)\s*MPH\s+WIND/i);
        if (m) wind = m[1] + ' mph';
    }

    if (params.maxHailSize?.[0]) {
        hail = params.maxHailSize[0].toString().replace(/in(ch(es)?)?/i, '').trim() + '"';
    } else {
        const m = desc.match(/HAIL\.{2,3}(\d+\.?\d*)\s*IN/i)
               || desc.match(/HAIL\s+UP\s+TO\s+(\d+\.?\d*)\s*IN/i)
               || desc.match(/(\d+\.?\d*)\s*INCH\s+HAIL/i);
        if (m) hail = m[1] + '"';
    }

    return (wind || hail) ? { wind, hail } : null;
}

// ---- Parse structured NWS sections (WHAT / WHERE / WHEN / IMPACTS) ----
// Handles both modern format ("* WHAT...") and older format ("HAZARD...").
// Always returns at least a 'WHAT' entry from the first meaningful paragraph.
function _parseAlertSections(description) {
    if (!description) return {};
    const sections = {};

    // 1. Try modern NWS CAP format: "* WHAT...", "* WHERE...", "* WHEN...", "* IMPACTS..."
    const modernRe = /\*\s*(WHAT|WHERE|WHEN|IMPACTS|ADDITIONAL DETAILS)\.\.\.([\s\S]*?)(?=\n\s*\*\s*[A-Z]|PRECAUTIONARY\/PREPAREDNESS ACTIONS|&&|\s*$)/gi;
    let match;
    while ((match = modernRe.exec(description)) !== null) {
        const text = match[2].trim().replace(/\n+/g, ' ').replace(/\s{2,}/g, ' ');
        if (text) sections[match[1].toUpperCase()] = text;
    }

    // 2. Try older NWS format: "HAZARD...", "SOURCE...", "IMPACT..."
    if (!sections['WHAT']) {
        const hazardM = /\bHAZARD\.\.\.([\s\S]*?)(?=\n\s*[A-Z]+\.\.\.|&&|\s*$)/i.exec(description);
        if (hazardM) {
            const t = hazardM[1].trim().replace(/\n+/g, ' ').replace(/\s{2,}/g, ' ');
            if (t) sections['WHAT'] = t;
        }
    }
    if (!sections['IMPACTS']) {
        const impactM = /\bIMPACT\.\.\.([\s\S]*?)(?=\n\s*[A-Z]+\.\.\.|Locations impacted|&&|\s*$)/i.exec(description);
        if (impactM) {
            const t = impactM[1].trim().replace(/\n+/g, ' ').replace(/\s{2,}/g, ' ');
            if (t) sections['IMPACTS'] = t;
        }
    }

    // 3. Fallback: extract the first substantive paragraph (skip preamble lines like "...WARNING...")
    if (!sections['WHAT']) {
        const lines = description.split('\n');
        const meaningful = [];
        for (const line of lines) {
            const t = line.trim();
            if (!t || /^\.\.\.[A-Z]/.test(t)) continue; // skip "...WARNING IN EFFECT..." lines
            meaningful.push(t);
            if (meaningful.length >= 3) break;
        }
        if (meaningful.length) {
            sections['WHAT'] = meaningful.join(' ').replace(/\s{2,}/g, ' ').slice(0, 300);
        }
    }

    return sections;
}

// ---- Safety advice lookup by alert type ----
// Returns { level: 'critical'|'warning'|'advisory', title, steps[] } or null.
function _getAlertAdvice(alert) {
    const event = (alert.event || '').toLowerCase();
    const subtype = _alertSubtype(alert);

    if (subtype?.type === 'tornado_emergency') {
        return {
            level: 'critical',
            title: 'Tornado Emergency — Extreme Danger',
            steps: [
                'Take cover in the lowest interior room of a sturdy building NOW',
                'Avoid all windows — this is a confirmed life-threatening tornado',
                'Cover your body with a mattress, cushions, or heavy blankets',
                'Mobile homes, vehicles, and bridges provide NO protection',
            ]
        };
    }
    if (event.includes('tornado warning')) {
        return {
            level: 'critical',
            title: 'Take Shelter Immediately',
            steps: [
                'Go to an interior room on the lowest floor of a sturdy building',
                'Stay away from all windows',
                'If caught outdoors, get to the nearest building; if no shelter, lie flat in a low-lying area and cover your head',
                'Do not shelter under bridges or overpasses',
            ]
        };
    }
    if (event.includes('tornado watch')) {
        return {
            level: 'warning',
            title: 'Be Ready to Take Shelter',
            steps: [
                'Know your shelter location before a warning is issued',
                'Monitor weather updates closely — conditions can change rapidly',
                'Prepare an emergency kit and be ready to act quickly',
                'Keep a NOAA Weather Radio or weather app nearby',
            ]
        };
    }
    if (event.includes('severe thunderstorm warning')) {
        return {
            level: 'warning',
            title: 'Seek Sturdy Shelter Indoors',
            steps: [
                'Move indoors to a sturdy building immediately',
                'Stay away from windows and doors',
                'Unplug sensitive electronics to protect from power surges',
                'Avoid trees, open areas, tall structures, and bodies of water',
            ]
        };
    }
    if (event.includes('severe thunderstorm watch')) {
        return {
            level: 'advisory',
            title: 'Severe Thunderstorms Possible',
            steps: [
                'Know where you will shelter if a warning is issued',
                'Avoid outdoor activities in open areas',
                'Monitor weather updates closely',
                'Be ready to move indoors quickly',
            ]
        };
    }
    if (event.includes('flash flood warning') || event.includes('flash flood emergency')) {
        return {
            level: 'critical',
            title: 'Move to Higher Ground Now',
            steps: [
                'Move away from streams, rivers, and low-lying areas immediately',
                'Never walk, swim, or drive through flood waters — Turn Around, Don\'t Drown',
                'Just 6 inches of fast-moving water can knock you down; 12 inches can carry a vehicle',
                'Evacuate immediately if directed by local officials',
            ]
        };
    }
    if (event.includes('flash flood watch') || event.includes('flood watch')) {
        return {
            level: 'advisory',
            title: 'Prepare for Potential Flooding',
            steps: [
                'Stay informed and monitor local emergency alerts',
                'Move valuables and important documents to higher floors',
                'Know your evacuation routes before flooding begins',
                'Avoid areas that are prone to rapid flooding',
            ]
        };
    }
    if (event.includes('flood warning')) {
        return {
            level: 'warning',
            title: 'Avoid Flooded Areas',
            steps: [
                'Stay away from rivers, streams, and flooded roads',
                'Do not drive through water of unknown depth',
                'Turn around if roads are flooded — Turn Around, Don\'t Drown',
                'Evacuate if directed by local officials',
            ]
        };
    }
    if (event.includes('blizzard warning')) {
        return {
            level: 'warning',
            title: 'Stay Indoors — Do Not Travel',
            steps: [
                'Avoid all travel — whiteout conditions will be life-threatening',
                'If you must go out, dress in waterproof layers and carry an emergency kit',
                'Have flashlights, batteries, extra food, and water on hand',
                'Check on neighbors and anyone without adequate shelter or heat',
            ]
        };
    }
    if (event.includes('ice storm warning')) {
        return {
            level: 'warning',
            title: 'Dangerous Icing Conditions',
            steps: [
                'Avoid driving — ice will make roads extremely hazardous',
                'Expect widespread power outages; have flashlights and backup heat ready',
                'If you must walk outside, wear footwear with good traction',
                'Stay away from downed power lines and damaged trees',
            ]
        };
    }
    if (event.includes('winter storm warning') || event.includes('winter storm watch')) {
        return {
            level: 'warning',
            title: 'Prepare for Winter Storm Conditions',
            steps: [
                'Avoid unnecessary travel, especially when roads are icy or snow-covered',
                'Stock up on supplies, food, and medications in case you lose power',
                'Have flashlights, batteries, and a backup heat source ready',
                'Bring pets indoors and check on elderly neighbors',
            ]
        };
    }
    if (event.includes('snow squall warning')) {
        return {
            level: 'warning',
            title: 'Dangerous Driving Conditions Imminent',
            steps: [
                'Visibility can drop to near zero within seconds — reduce speed now',
                'Exit at the nearest ramp if possible before the squall hits',
                'Turn on hazard lights but do not stop on the highway shoulder',
                'Allow extra following distance and avoid sudden braking on slick roads',
            ]
        };
    }
    if (event.includes('high wind warning')) {
        return {
            level: 'warning',
            title: 'Dangerous Wind Conditions',
            steps: [
                'Secure or bring in all outdoor furniture, decorations, and loose objects',
                'Avoid driving high-profile vehicles (RVs, box trucks) or towing trailers',
                'Stay away from trees and power lines that could fall',
                'Prepare for possible extended power outages',
            ]
        };
    }
    if (event.includes('red flag warning')) {
        return {
            level: 'critical',
            title: 'Critical Fire Weather — Extreme Danger',
            steps: [
                'Do not start any outdoor fires — burning bans are likely in effect',
                'Report any smoke or fire immediately by calling 911',
                'If in a fire-prone area, review your defensible space and evacuation plan',
                'Be ready to evacuate quickly if a wildfire starts nearby',
            ]
        };
    }
    if (event.includes('fire weather watch')) {
        return {
            level: 'warning',
            title: 'Critical Fire Weather Possible',
            steps: [
                'Avoid any outdoor burning or activities that could spark a fire',
                'Report smoke or fire immediately to local authorities',
                'Review your home\'s defensible space around structures',
                'Know your evacuation plan and be ready to leave quickly',
            ]
        };
    }
    if (event.includes('excessive heat warning') || event.includes('heat advisory') || event.includes('excessive heat watch')) {
        return {
            level: 'advisory',
            title: 'Protect Yourself from Dangerous Heat',
            steps: [
                'Stay hydrated — drink water regularly, even if you don\'t feel thirsty',
                'Avoid strenuous outdoor activity during peak heat hours (10 AM – 4 PM)',
                'Never leave children, elderly, or pets in a parked vehicle',
                'Check on neighbors, the elderly, and those without air conditioning',
            ]
        };
    }
    if (event.includes('dense fog advisory')) {
        return {
            level: 'advisory',
            title: 'Reduced Visibility — Drive With Caution',
            steps: [
                'Slow down and allow extra following distance',
                'Use low-beam headlights — high beams reflect off fog and reduce visibility',
                'Do not stop on roads or highway shoulders in dense fog',
                'Delay travel if visibility is severely limited',
            ]
        };
    }
    if (event.includes('wind advisory') || event.includes('high wind watch')) {
        return {
            level: 'advisory',
            title: 'Gusty Wind Conditions Expected',
            steps: [
                'Secure lightweight outdoor items that could be blown away',
                'Use caution when driving, especially in high-profile vehicles',
                'Expect possible tree limb damage and isolated power outages',
                'Stay away from damaged trees or downed power lines',
            ]
        };
    }
    if (event.includes('special marine warning')) {
        return {
            level: 'warning',
            title: 'Dangerous Marine Conditions',
            steps: [
                'Return to port or seek safe harbor immediately',
                'All mariners should avoid going out on affected waters',
                'Secure all loose gear and equipment',
                'Monitor VHF marine radio for updated conditions',
            ]
        };
    }
    if (event.includes('freeze warning') || event.includes('hard freeze warning')) {
        return {
            level: 'warning',
            title: 'Protect Sensitive Plants and Pipes',
            steps: [
                'Cover or bring in tender plants, flowers, and vegetables',
                'Wrap or insulate exposed outdoor pipes to prevent freezing and bursting',
                'Bring pets and outdoor animals inside',
                'Disconnect and drain garden hoses',
            ]
        };
    }
    if (event.includes('freeze watch') || event.includes('frost advisory')) {
        return {
            level: 'advisory',
            title: 'Protect Plants and Pipes Tonight',
            steps: [
                'Cover sensitive plants, flowers, and garden beds before nightfall',
                'Bring potted plants and hanging baskets indoors',
                'Protect exposed water pipes in unheated areas',
                'Bring pets indoors overnight',
            ]
        };
    }
    if (event.includes('winter weather advisory')) {
        return {
            level: 'advisory',
            title: 'Slippery Travel Conditions Expected',
            steps: [
                'Allow extra time for travel — roads may be slick or snow-covered',
                'Reduce speed and increase following distance',
                'Carry an emergency kit in your vehicle',
                'Check road conditions before departing',
            ]
        };
    }
    if (event.includes('wind chill warning') || event.includes('wind chill advisory')) {
        return {
            level: event.includes('warning') ? 'warning' : 'advisory',
            title: 'Dangerous Wind Chills',
            steps: [
                'Limit time outdoors — exposed skin can suffer frostbite rapidly',
                'Dress in multiple warm layers, covering all exposed skin',
                'Keep children and pets indoors when wind chills are dangerous',
                'Watch for signs of frostbite (numbness, white/pale skin) and hypothermia',
            ]
        };
    }
    if (event.includes('coastal flood') || event.includes('lakeshore flood')) {
        return {
            level: event.includes('warning') ? 'warning' : 'advisory',
            title: 'Coastal Flooding Expected',
            steps: [
                'Stay away from low-lying coastal and waterfront areas',
                'Do not attempt to walk or drive through flooded streets',
                'Move vehicles and valuables away from flood-prone areas',
                'Monitor updates from local emergency management',
            ]
        };
    }
    if (event.includes('rip current') || event.includes('high surf') || event.includes('beach hazards')) {
        return {
            level: 'warning',
            title: 'Dangerous Beach and Water Conditions',
            steps: [
                'Stay out of the water — dangerous currents can overpower even strong swimmers',
                'If caught in a rip current, swim parallel to shore, then angle back to the beach',
                'Never swim alone or beyond designated swimming areas',
                'Obey all beach closure signs and flags',
            ]
        };
    }
    if (event.includes('air quality') || event.includes('smoke')) {
        return {
            level: 'advisory',
            title: 'Unhealthy Air Quality',
            steps: [
                'Limit strenuous outdoor activities, especially for children and the elderly',
                'Keep windows and doors closed and run air conditioning if available',
                'Wear an N95 or higher-rated mask if you must be outdoors for extended periods',
                'Those with asthma, heart disease, or lung conditions should stay indoors',
            ]
        };
    }
    if (event.includes('special weather statement') || event.includes('hazardous weather outlook')) {
        return {
            level: 'advisory',
            title: 'Weather Awareness',
            steps: [
                'Read the full statement for specific hazards and timing in your area',
                'Monitor weather conditions and stay updated on forecasts',
                'Be prepared to act quickly if conditions deteriorate',
                'Follow guidance from local emergency management officials',
            ]
        };
    }
    // Generic fallback for any unrecognized alert type
    const severity = (alert.severity || '').toLowerCase();
    if (severity === 'extreme' || severity === 'severe' || event.includes('warning')) {
        return {
            level: severity === 'extreme' ? 'critical' : 'warning',
            title: 'Follow Official Guidance',
            steps: [
                'Read the full alert text for specific hazards and timing',
                'Monitor weather updates and be ready to take action',
                'Follow all guidance from local emergency management officials',
                'Have an emergency plan and kit prepared',
            ]
        };
    }
    if (event.includes('watch') || event.includes('advisory') || event.includes('statement')) {
        return {
            level: 'advisory',
            title: 'Stay Informed',
            steps: [
                'Read the full alert text for specific hazards and timing in your area',
                'Monitor weather conditions and stay updated on forecasts',
                'Be prepared to act quickly if conditions deteriorate',
            ]
        };
    }
    return null;
}

function _alertClass(alert) {
    const event = (alert.event || '').toLowerCase();
    const severity = (alert.severity || '').toLowerCase();

    // Event-specific classes (match the NWS standard alert color palette)
    // More-specific checks must come before broader ones (e.g. coastal flood before flood)
    if (event.includes('tornado warning'))               return 'alert-tornado-warning';
    if (event.includes('tornado watch'))                 return 'alert-tornado-watch';
    if (event.includes('severe thunderstorm warning'))   return 'alert-svr-warning';
    if (event.includes('severe thunderstorm watch'))     return 'alert-svr-watch';
    if (event.includes('flash flood warning'))           return 'alert-flash-flood-warning';
    if (event.includes('winter storm watch'))            return 'alert-winter-storm-watch';
    if (event.includes('winter storm warning'))          return 'alert-winter-storm-warning';
    if (event.includes('blizzard warning'))              return 'alert-blizzard-warning';
    if (event.includes('snow squall warning'))           return 'alert-snow-squall-warning';
    if (event.includes('special weather statement'))     return 'alert-sws';

    // Coastal flood (before generic flood checks)
    if (event.includes('coastal flood warning'))         return 'alert-coastal-flood-warning';
    if (event.includes('coastal flood watch'))           return 'alert-coastal-flood-watch';
    if (event.includes('coastal flood advisory'))        return 'alert-coastal-flood-advisory';
    if (event.includes('coastal flood statement'))       return 'alert-coastal-flood-stmt';

    // Flood
    if (event.includes('flood warning'))                 return 'alert-flood-warning';
    if (event.includes('flood watch'))                   return 'alert-flood-watch';
    if (event.includes('flood advisory'))                return 'alert-flood-advisory';

    // High wind (more specific before wind advisory)
    if (event.includes('high wind warning'))             return 'alert-high-wind-warning';
    if (event.includes('high wind watch'))               return 'alert-high-wind-watch';

    // Gale (more specific before storm warning)
    if (event.includes('gale warning'))                  return 'alert-gale-warning';
    if (event.includes('gale watch'))                    return 'alert-gale-watch';

    // Other marine/coastal
    if (event.includes('storm warning'))                 return 'alert-storm-warning';
    if (event.includes('special marine warning'))        return 'alert-special-marine-warning';
    if (event.includes('small craft advisory'))          return 'alert-small-craft';
    if (event.includes('marine weather statement'))      return 'alert-marine-weather-stmt';
    if (event.includes('hazardous seas warning'))        return 'alert-hazardous-seas';
    if (event.includes('heavy freezing spray warning'))  return 'alert-heavy-freezing-spray';
    if (event.includes('rip current statement'))         return 'alert-rip-current';
    if (event.includes('beach hazards statement'))       return 'alert-beach-hazards';
    if (event.includes('high surf advisory'))            return 'alert-high-surf-advisory';
    if (event.includes('low water advisory'))            return 'alert-low-water-advisory';

    // Winter (after winter storm checks above)
    if (event.includes('winter weather advisory'))       return 'alert-winter-weather-advisory';
    if (event.includes('freeze warning'))                return 'alert-freeze-warning';
    if (event.includes('freeze watch'))                  return 'alert-freeze-watch';
    if (event.includes('frost advisory'))                return 'alert-frost-advisory';

    // Wind (more specific before generic; brisk wind before wind advisory)
    if (event.includes('lake wind advisory'))            return 'alert-lake-wind-advisory';
    if (event.includes('brisk wind advisory'))           return 'alert-brisk-wind-advisory';
    if (event.includes('wind advisory'))                 return 'alert-wind-advisory';

    // Fire weather
    if (event.includes('red flag warning'))              return 'alert-red-flag-warning';
    if (event.includes('fire weather watch'))            return 'alert-fire-weather-watch';

    // Other
    if (event.includes('heat advisory'))                 return 'alert-heat-advisory';
    if (event.includes('air quality alert'))             return 'alert-air-quality';
    if (event.includes('dense fog advisory'))            return 'alert-dense-fog';
    if (event.includes('hydrologic outlook'))            return 'alert-hydrologic-outlook';

    // Fall back to generic severity-based classes
    if (severity === 'extreme' || severity === 'severe') return 'alert-extreme';
    if (event.includes('warning'))                       return 'alert-warning';
    if (event.includes('watch'))                         return 'alert-watch';
    return 'alert-advisory';
}

function _dedupeLocations(locations) {
    const seen = new Set();
    const out = [];
    locations.forEach((loc) => {
        if (loc?.lat == null || loc?.lng == null) return;
        const key = `${Number(loc.lat).toFixed(3)},${Number(loc.lng).toFixed(3)}`;
        if (seen.has(key)) return;
        seen.add(key);
        out.push(loc);
    });
    return out;
}

async function loadAndRenderAlerts(lat, lng) {
    // Fetch location timezone so alert times display in the location's local time
    WeatherAPI.getLocationTimeZone(lat, lng).then(tz => { _locationTimeZone = tz; }).catch(() => {});

    const currentLoc = LocationManager.getCurrent();
    const favorites = LocationManager.getFavorites() || [];
    const locations = _dedupeLocations([
        { lat, lng, name: currentLoc?.name || 'Current Location', isCurrent: true },
        ...favorites.map((f) => ({ lat: f.lat, lng: f.lng, name: f.name, isCurrent: false }))
    ]);

    const results = await Promise.allSettled(locations.map((loc) => WeatherAPI.getAlerts(loc.lat, loc.lng)));

    const byLocation = [];
    results.forEach((result, i) => {
        if (result.status === 'fulfilled') {
            byLocation.push({ location: locations[i], alerts: result.value.alerts || [] });
        }
    });

    const currentAlerts = byLocation.find((x) => x.location.isCurrent)?.alerts || [];
    renderAlerts(currentAlerts);

    // Handle shared alert link: if the URL contains an alert ID, open it now
    const pendingId = window._pendingSharedAlertId;
    if (pendingId) {
        window._pendingSharedAlertId = null;
        const found = currentAlerts.find(a => a.id === pendingId);
        if (found) {
            setTimeout(() => openAlertDetail(found), 300);
        } else {
            // Alert may be outside current location or expired — fetch directly from NWS
            _fetchAndOpenAlertById(pendingId);
        }
    }

    // Fetch SPC and WPC outlooks in parallel instead of sequentially
    await Promise.allSettled([
        loadAndRenderSPCOutlook(lat, lng).catch(err => console.warn('SPC outlook error:', err)),
        loadAndRenderSPCFireOutlook(lat, lng).catch(err => console.warn('SPC fire weather error:', err)),
        loadAndRenderWPCRainfallOutlook(lat, lng).catch(err => console.warn('WPC rainfall error:', err))
    ]);
}

function _buildAlertBannerHTML(alert, i) {
    const headline = _escapeHtml(alert.headline || alert.event || 'Weather Alert');
    const area = _escapeHtml(alert.areaDesc || 'Your county');
    const excerpt = _escapeHtml((alert.description || '').slice(0, 180));
    const hasMore = (alert.description || '').length > 180;
    const iconSvg = `<svg class="alert-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
        <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
        <line x1="12" y1="9" x2="12" y2="13"/>
        <line x1="12" y1="17" x2="12.01" y2="17"/>
    </svg>`;

    const subtype = _alertSubtype(alert);
    const subtypeBadge = subtype
        ? `<span class="alert-subtype-badge ${subtype.colorClass}">${_escapeHtml(subtype.label)}</span>`
        : '';

    const tstmDetails = _extractSevereThunderstormDetails(alert);
    let tstmRow = '';
    if (tstmDetails) {
        const parts = [];
        if (tstmDetails.wind) parts.push(`Wind: ${_escapeHtml(tstmDetails.wind)}`);
        if (tstmDetails.hail) parts.push(`Hail: ${_escapeHtml(tstmDetails.hail)}`);
        if (parts.length) tstmRow = `<div class="alert-tstm-details">${parts.join(' &nbsp;•&nbsp; ')}</div>`;
    }

    return `
        <button type="button" class="alert-banner ${_alertClass(alert)} fade-in" style="animation-delay:${i * 80}ms" onclick="openAlertDetail(${i})">
            <div class="alert-header">
                ${iconSvg}
                <span class="alert-title">${headline}</span>
            </div>
            ${subtypeBadge}
            ${tstmRow}
            <div class="alert-detail">${excerpt}${hasMore ? '…' : ''}</div>
            <div class="alert-time">Areas: ${area}</div>
            <div class="alert-time">Expires: ${_formatAlertTime(alert.expires)}</div>
        </button>
    `;
}

// Returns a numeric priority score for an alert — higher = more impactful.
function _alertPriority(alert) {
    const event = (alert.event || '').toLowerCase();
    const severity = (alert.severity || '').toLowerCase();
    const subtype = _alertSubtype(alert);

    // Subtype-specific overrides (most dangerous subtypes)
    if (subtype) {
        switch (subtype.type) {
            case 'tornado_emergency':      return 1000;
            case 'flash_flood_emergency':  return 950;
            case 'pds_tornado':            return 900;
            case 'tornado_observed':       return 850;
            case 'eds_tstm':               return 800;
            case 'destructive_tstm':       return 790;
            case 'flash_flood_observed':   return 780;
            case 'considerable_tstm':      return 760;
        }
    }

    // Event-type scoring
    if (event.includes('tornado warning'))              return 700;
    if (event.includes('flash flood warning'))          return 650;
    if (event.includes('severe thunderstorm warning'))  return 600;
    if (event.includes('special marine warning'))       return 590;
    if (event.includes('tornado watch'))                return 560;
    if (event.includes('flash flood watch'))            return 540;
    if (event.includes('severe thunderstorm watch'))    return 520;
    if (event.includes('flood warning'))                return 500;
    if (event.includes('blizzard warning'))             return 490;
    if (event.includes('ice storm warning'))            return 480;
    if (event.includes('winter storm warning'))         return 470;
    if (event.includes('high wind warning'))            return 460;
    if (event.includes('hurricane warning') ||
        event.includes('typhoon warning'))              return 450;
    if (event.includes('tropical storm warning'))       return 440;
    if (event.includes('red flag warning'))             return 430;
    if (event.includes('fire weather watch'))           return 420;

    // Fall back to NWS severity field
    if (severity === 'extreme')  return 400;
    if (event.includes('warning')) {
        if (severity === 'severe')   return 380;
        if (severity === 'moderate') return 360;
        return 350;
    }
    if (event.includes('watch')) {
        if (severity === 'severe')   return 320;
        if (severity === 'moderate') return 300;
        return 290;
    }
    if (event.includes('advisory')) return 200;
    if (event.includes('statement')) return 150;
    return 100;
}

function renderAlerts(alerts) {
    const container = document.getElementById('alerts-container');
    if (!container) return;

    // Sort by impact severity (most dangerous first)
    const sorted = [...(alerts || [])].sort((a, b) => _alertPriority(b) - _alertPriority(a));
    _renderedAlerts = sorted;
    if (_renderedAlerts.length === 0) {
        container.style.display = 'none';
        container.innerHTML = '';
        return;
    }

    container.style.display = 'block';

    // Always show the first (highest-priority) alert
    let html = _buildAlertBannerHTML(_renderedAlerts[0], 0);

    // If there are additional alerts, wrap them in a collapsible section
    if (_renderedAlerts.length > 1) {
        const extraCount = _renderedAlerts.length - 1;
        const extraHtml = _renderedAlerts.slice(1).map((a, i) => _buildAlertBannerHTML(a, i + 1)).join('');
        html += `
            <div class="alerts-extra-wrapper" id="alerts-extra" style="display:none;" aria-hidden="true">
                ${extraHtml}
            </div>
            <button type="button" class="alerts-toggle-btn" id="alerts-toggle"
                    onclick="toggleExtraAlerts()" aria-expanded="false">
                <svg class="alerts-toggle-chevron" width="14" height="14" viewBox="0 0 24 24"
                     fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
                    <polyline points="6 9 12 15 18 9"/>
                </svg>
                <span id="alerts-toggle-label">Show ${extraCount} more alert${extraCount > 1 ? 's' : ''}</span>
            </button>
        `;
    }

    container.innerHTML = html;
}

function toggleExtraAlerts() {
    const extra = document.getElementById('alerts-extra');
    const btn = document.getElementById('alerts-toggle');
    const label = document.getElementById('alerts-toggle-label');
    const chevron = btn && btn.querySelector('.alerts-toggle-chevron');
    if (!extra || !btn || !label) return;

    const isExpanded = extra.style.display !== 'none';
    const extraCount = _renderedAlerts.length - 1;

    if (isExpanded) {
        extra.style.display = 'none';
        extra.setAttribute('aria-hidden', 'true');
        btn.setAttribute('aria-expanded', 'false');
        label.textContent = `Show ${extraCount} more alert${extraCount > 1 ? 's' : ''}`;
        if (chevron) chevron.style.transform = '';
    } else {
        extra.style.display = 'block';
        extra.setAttribute('aria-hidden', 'false');
        btn.setAttribute('aria-expanded', 'true');
        label.textContent = 'Show fewer alerts';
        if (chevron) chevron.style.transform = 'rotate(180deg)';
    }
}

function openAlertDetail(indexOrAlert, skipMap) {
    const alert = (typeof indexOrAlert === 'number') ? _renderedAlerts[indexOrAlert] : indexOrAlert;
    if (!alert) return;

    // Store the currently open alert so action buttons can reference it
    _currentOpenAlert = alert;

    const modal = document.getElementById('alert-modal');
    const titleEl = document.getElementById('alert-modal-title');
    const metaEl = document.getElementById('alert-modal-meta');
    const bodyEl = document.getElementById('alert-modal-body');
    if (!modal || !titleEl || !metaEl || !bodyEl) return;

    titleEl.textContent = alert.headline || alert.event || 'Weather Alert';
    metaEl.textContent = `Effective: ${_formatAlertTime(alert.onset || alert.effective)} • Expires: ${_formatAlertTime(alert.expires)} • Areas: ${alert.areaDesc || 'N/A'}`;

    // Remove any previously injected dynamic elements
    ['alert-modal-extra', 'alert-modal-summary', 'alert-modal-advice'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.remove();
    });

    // Inject subtype badge and thunderstorm details below the meta line
    const subtype = _alertSubtype(alert);
    const tstmDetails = _extractSevereThunderstormDetails(alert);
    let lastInserted = metaEl;
    if (subtype || tstmDetails) {
        const extraEl = document.createElement('div');
        extraEl.id = 'alert-modal-extra';
        extraEl.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:12px;';
        if (subtype) {
            const badge = document.createElement('span');
            badge.className = `alert-subtype-badge ${subtype.colorClass}`;
            badge.textContent = subtype.label;
            extraEl.appendChild(badge);
        }
        if (tstmDetails) {
            const parts = [];
            if (tstmDetails.wind) parts.push(`Wind: ${tstmDetails.wind}`);
            if (tstmDetails.hail) parts.push(`Hail: ${tstmDetails.hail}`);
            if (parts.length) {
                const detailSpan = document.createElement('span');
                detailSpan.className = 'alert-tstm-details';
                detailSpan.textContent = parts.join('  •  ');
                extraEl.appendChild(detailSpan);
            }
        }
        lastInserted.insertAdjacentElement('afterend', extraEl);
        lastInserted = extraEl;
    }

    // ---- Summary card: WHAT / WHEN / WHERE / IMPACTS extracted from NWS text ----
    const sections = _parseAlertSections(alert.description || '');
    if (Object.keys(sections).length) {
        const summaryEl = document.createElement('div');
        summaryEl.id = 'alert-modal-summary';
        summaryEl.className = 'alert-modal-summary';
        const ORDER = ['WHAT', 'WHEN', 'WHERE', 'IMPACTS', 'ADDITIONAL DETAILS'];
        const LABELS = { WHAT: 'What', WHEN: 'When', WHERE: 'Where', IMPACTS: 'Impacts', 'ADDITIONAL DETAILS': 'Details' };
        summaryEl.innerHTML = ORDER.filter(k => sections[k]).map(k =>
            `<div class="alert-summary-row">
                <span class="alert-summary-label">${LABELS[k]}</span>
                <span class="alert-summary-text">${_escapeHtml(sections[k])}</span>
            </div>`
        ).join('');
        lastInserted.insertAdjacentElement('afterend', summaryEl);
        lastInserted = summaryEl;
    }

    // ---- Safety advice based on alert type ----
    const advice = _getAlertAdvice(alert);
    if (advice) {
        const adviceEl = document.createElement('div');
        adviceEl.id = 'alert-modal-advice';
        adviceEl.className = `alert-modal-advice alert-advice-${advice.level}`;
        adviceEl.innerHTML =
            `<div class="alert-advice-title">${_escapeHtml(advice.title)}</div>` +
            `<ul class="alert-advice-steps">${advice.steps.map(s => `<li>${_escapeHtml(s)}</li>`).join('')}</ul>`;
        lastInserted.insertAdjacentElement('afterend', adviceEl);
    }

    const parts = [alert.description, alert.instruction].filter(Boolean);
    bodyEl.textContent = parts.length ? parts.join('\n\n') : 'No additional text provided by NWS.';

    // ---- Action buttons: View on Radar / Screenshot / Share ----
    const existingActions = document.getElementById('alert-modal-actions');
    if (existingActions) existingActions.remove();
    const actionsEl = document.createElement('div');
    actionsEl.id = 'alert-modal-actions';
    actionsEl.className = 'alert-modal-actions';
    actionsEl.innerHTML = `
        <button class="alert-action-btn" onclick="navigateAlertToRadar()" title="View alert area on radar map">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
            View on Radar
        </button>
        <button class="alert-action-btn" onclick="screenshotAlert()" title="Save screenshot with alert text and radar">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
            Screenshot
        </button>
        <button class="alert-action-btn" onclick="shareAlert()" title="Copy shareable link to this alert">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
            Share Link
        </button>`;
    bodyEl.insertAdjacentElement('afterend', actionsEl);

    // Optionally hide the map section (e.g. when opened from the map view)
    const mapEl = document.getElementById('alert-modal-map');
    if (skipMap) {
        if (mapEl) mapEl.style.display = 'none';
    } else {
        if (mapEl) mapEl.style.display = '';
        _drawAlertMap(alert);
    }

    modal.style.display = 'flex';
    document.body.style.overflow = 'hidden';
}

function closeAlertDetail() {
    const modal = document.getElementById('alert-modal');
    if (modal) modal.style.display = 'none';
    document.body.style.overflow = '';
    // Restore map section so next open from current conditions shows it
    const mapEl = document.getElementById('alert-modal-map');
    if (mapEl) mapEl.style.display = '';
}

function _drawAlertMap(alert) {
    const mapEl = document.getElementById('alert-modal-map');
    if (!mapEl) return;

    if (!window.mapboxgl) {
        mapEl.innerHTML = '<div style="padding:16px;color:var(--text-secondary);">Map preview unavailable.</div>';
        return;
    }

    if (!_alertMap) {
        mapboxgl.accessToken = CONFIG.MAPBOX_ACCESS_TOKEN;
        _alertMap = new mapboxgl.Map({
            container: 'alert-modal-map',
            style: 'mapbox://styles/mapbox/dark-v11',
            center: [LocationManager.getCurrent().lng, LocationManager.getCurrent().lat],
            zoom: 6,
            preserveDrawingBuffer: true
        });
        _alertMap.addControl(new mapboxgl.NavigationControl(), 'top-right');
    }

    // Apply a GeoJSON FeatureCollection to the map and fit bounds
    const _applyGeoJSON = (geojson) => {
        const doUpdate = () => {
            if (_alertMap.getSource('alert-geo')) {
                _alertMap.getSource('alert-geo').setData(geojson);
            } else {
                _alertMap.addSource('alert-geo', { type: 'geojson', data: geojson });
                _alertMap.addLayer({
                    id: 'alert-fill',
                    type: 'fill',
                    source: 'alert-geo',
                    paint: { 'fill-color': '#ff7043', 'fill-opacity': 0.22 }
                });
                _alertMap.addLayer({
                    id: 'alert-line',
                    type: 'line',
                    source: 'alert-geo',
                    paint: { 'line-color': '#ffab91', 'line-width': 2.2 }
                });
            }
            _loadMRMSToAlertMap();
            if (geojson.features.length && window.turf) {
                const bounds = turf.bbox(geojson);
                _lastAlertMapBounds = [[bounds[0], bounds[1]], [bounds[2], bounds[3]]];
                _alertMap.fitBounds(_lastAlertMapBounds, { padding: 30, duration: 0 });
            } else {
                const loc = LocationManager.getCurrent();
                _lastAlertMapBounds = [[loc.lng - 2, loc.lat - 1.5], [loc.lng + 2, loc.lat + 1.5]];
                _alertMap.easeTo({ center: [loc.lng, loc.lat], zoom: 7, duration: 0 });
            }
            _alertMap.resize();
            setTimeout(() => _alertMap.resize(), 100);
            setTimeout(() => _alertMap.resize(), 400);
        };
        if (_alertMap.loaded()) doUpdate();
        else _alertMap.once('load', doUpdate);
    };

    if (alert.geometry) {
        // Storm-based warning: direct polygon supplied by NWS
        _applyGeoJSON({
            type: 'FeatureCollection',
            features: [{ type: 'Feature', geometry: alert.geometry, properties: {} }]
        });
    } else {
        // County/zone-based alert: fetch zone polygons from affectedZones URLs
        const zoneUrls = (alert.raw?.properties?.affectedZones || []).slice(0, 25);
        if (!zoneUrls.length) {
            _applyGeoJSON({ type: 'FeatureCollection', features: [] });
            return;
        }
        Promise.allSettled(
            zoneUrls.map(url =>
                fetch(url, { headers: { 'Accept': 'application/geo+json' } })
                    .then(r => r.ok ? r.json() : null)
            )
        ).then(results => {
            const features = results
                .filter(r => r.status === 'fulfilled' && r.value?.geometry)
                .map(r => ({ type: 'Feature', geometry: r.value.geometry, properties: {} }));
            _applyGeoJSON({ type: 'FeatureCollection', features });
        });
    }
}

// ---- MRMS Precip Type radar layer on the alert map ----
// Uses the GitHub-hosted MRMS master.png image overlay (same source as the main map).
const _ALERT_MRMS_BASE   = 'https://raw.githubusercontent.com/EphrataWeather/MRMS/main/public/data/';
const _ALERT_MRMS_COORDS = [[-130, 50], [-60, 50], [-60, 24], [-130, 24]];

function _loadMRMSToAlertMap() {
    if (!_alertMap) return;
    try {
        // 1-minute cache-bust to always fetch the latest frame
        const url = _ALERT_MRMS_BASE + 'master.png?cb=' + Math.floor(Date.now() / 60000);

        if (_alertMap.getSource('alert-mrms')) {
            _alertMap.getSource('alert-mrms').updateImage({ url });
        } else {
            _alertMap.addSource('alert-mrms', {
                type: 'image',
                url,
                coordinates: _ALERT_MRMS_COORDS
            });
            // Insert radar BEFORE the alert-fill layer so it renders underneath
            const beforeId = _alertMap.getLayer('alert-fill') ? 'alert-fill' : undefined;
            _alertMap.addLayer({
                id: 'alert-mrms-layer',
                type: 'raster',
                source: 'alert-mrms',
                paint: {
                    'raster-opacity': 0.75,
                    'raster-fade-duration': 300,
                    'raster-resampling': 'nearest'
                }
            }, beforeId);
        }
    } catch (e) {
        console.warn('MRMS radar unavailable on alert map:', e);
    }
}

// ---- SPC Outlook Severe Weather Risk ----

// Risk level ordering (TSTM is not severe enough to trigger a banner)
const _SPC_RISK_ORDER = ['TSTM', 'MRGL', 'SLGT', 'ENH', 'MDT', 'HIGH'];
const _SPC_RISK_LABELS = {
    MRGL: 'Marginal', SLGT: 'Slight', ENH: 'Enhanced', MDT: 'Moderate', HIGH: 'High'
};
// CSS class suffix mirrors stylesheet .spc-risk-* names
const _SPC_RISK_CLASS = { MRGL: 'mrgl', SLGT: 'slgt', ENH: 'enh', MDT: 'mdt', HIGH: 'high' };

// Ray-casting point-in-polygon (GeoJSON ring coords are [lng, lat])
function _raycastPoly(lngLat, ring) {
    const [px, py] = lngLat;
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [xi, yi] = ring[i];
        const [xj, yj] = ring[j];
        if (((yi > py) !== (yj > py)) && (px < ((xj - xi) * (py - yi)) / (yj - yi) + xi)) {
            inside = !inside;
        }
    }
    return inside;
}

function _pointInSPCGeometry(lng, lat, geometry) {
    if (!geometry) return false;
    const pt = [lng, lat];
    if (geometry.type === 'Polygon') {
        return _raycastPoly(pt, geometry.coordinates[0]);
    }
    if (geometry.type === 'MultiPolygon') {
        return geometry.coordinates.some(poly => _raycastPoly(pt, poly[0]));
    }
    return false;
}

// Returns a human-readable day label for a given day offset from today.
function _spcDayLabel(offset) {
    const d = new Date();
    d.setDate(d.getDate() + offset);
    const weekday = d.toLocaleDateString('en-US', { weekday: 'short' });
    const month   = d.toLocaleDateString('en-US', { month: 'short' });
    const day     = d.getDate();
    if (offset === 0) return `Today (${weekday}, ${month} ${day})`;
    if (offset === 1) return `Tomorrow (${weekday}, ${month} ${day})`;
    return `${weekday}, ${month} ${day}`;
}

async function _fetchSPCCatData(url) {
    try {
        const r = await fetch(url, { cache: 'no-store' });
        if (r.ok) return r.json();
    } catch (_) { /* fall through */ }
    // Proxy 1: codetabs — works for WPC gov endpoints that block CORS
    try {
        const p1 = 'https://api.codetabs.com/v1/proxy/?quest=' + encodeURIComponent(url);
        const r1 = await fetch(p1, { cache: 'no-store' });
        if (r1.ok) return r1.json();
    } catch (_) { /* fall through */ }
    // Proxy 2: corsproxy.io as last resort
    const proxy = 'https://corsproxy.io/?' + encodeURIComponent(url);
    const r2 = await fetch(proxy, { cache: 'no-store' });
    if (!r2.ok) throw new Error('SPC fetch failed (' + r2.status + ')');
    return r2.json();
}

async function loadAndRenderSPCOutlook(lat, lng) {
    const container = document.getElementById('spc-banner-container');
    if (!container) return;

    const DAY_URLS = [
        'https://www.spc.noaa.gov/products/outlook/day1otlk_cat.nolyr.geojson',
        'https://www.spc.noaa.gov/products/outlook/day2otlk_cat.nolyr.geojson',
        'https://www.spc.noaa.gov/products/outlook/day3otlk_cat.nolyr.geojson',
    ];

    // Fetch all three days in parallel; use allSettled so one failure won't
    // suppress results from the other days.
    const settled = await Promise.allSettled(DAY_URLS.map(url => _fetchSPCCatData(url)));

    const hits = [];
    settled.forEach((result, i) => {
        if (result.status !== 'fulfilled') {
            console.warn('SPC Day ' + (i + 1) + ' unavailable:', result.reason?.message);
            return;
        }
        const features = result.value?.features || [];
        let highestRisk = null;
        for (const feature of features) {
            const label = (feature.properties?.LABEL || feature.properties?.label || '').trim().toUpperCase();
            const riskIdx = _SPC_RISK_ORDER.indexOf(label);
            if (riskIdx < 1) continue; // skip TSTM and unknowns
            if (_pointInSPCGeometry(lng, lat, feature.geometry)) {
                if (!highestRisk || riskIdx > _SPC_RISK_ORDER.indexOf(highestRisk)) {
                    highestRisk = label;
                }
            }
        }
        if (highestRisk) hits.push({ risk: highestRisk, dayLabel: _spcDayLabel(i), dayNum: i + 1 });
    });

    if (hits.length > 0) {
        renderSPCBanners(hits);
    } else {
        container.style.display = 'none';
        container.innerHTML = '';
    }
}

function renderSPCBanners(entries) {
    const container = document.getElementById('spc-banner-container');
    if (!container) return;
    container.style.display = 'block';
    container.innerHTML = entries.map(({ risk, dayLabel, dayNum }) => {
        const label = _SPC_RISK_LABELS[risk] || risk;
        const cls   = _SPC_RISK_CLASS[risk] || 'mrgl';
        return `
        <button type="button" class="spc-risk-banner spc-risk-${cls} fade-in"
                onclick="navigateToSPCMaps(${dayNum})"
                title="Tap to view SPC Day ${dayNum} Outlook map">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"
                 stroke-linecap="round" style="flex-shrink:0;">
                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
            </svg>
            <span><strong>${label} Risk</strong> of Severe Weather – ${dayLabel}. Tap to view maps.</span>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"
                 stroke-linecap="round" style="flex-shrink:0;">
                <polyline points="9 18 15 12 9 6"/>
            </svg>
        </button>`;
    }).join('');
}

function navigateToSPCMaps(dayNum, targetLayer) {
    if (dayNum) window._spcTargetDay = dayNum;
    if (targetLayer) window._spcTargetLayer = targetLayer;
    window.location.hash = '#maps';
    if (typeof showView === 'function') showView('maps');
}


// ---- SPC Fire Weather Outlook ----

const _SPC_FIRE_ORDER = ['ELEV', 'CRIT', 'EXTM'];
const _SPC_FIRE_LABELS = { ELEV: 'Elevated', CRIT: 'Critical', EXTM: 'Extreme' };
const _SPC_FIRE_CLASS = { ELEV: 'elev', CRIT: 'crit', EXTM: 'extm' };

async function loadAndRenderSPCFireOutlook(lat, lng) {
    const container = document.getElementById('fire-weather-banner-container');
    if (!container) return;

    // SPC now publishes fire weather as two component files per day (windrh + dryt)
    const FIRE_DAY_URLS = [
        {
            windrh: 'https://www.spc.noaa.gov/products/fire_wx/day1fw_windrh.nolyr.geojson',
            dryt:   'https://www.spc.noaa.gov/products/fire_wx/day1fw_dryt.nolyr.geojson',
        },
        {
            windrh: 'https://www.spc.noaa.gov/products/fire_wx/day2fw_windrh.nolyr.geojson',
            dryt:   'https://www.spc.noaa.gov/products/fire_wx/day2fw_dryt.nolyr.geojson',
        },
    ];

    // Fetch both component files and merge features
    async function _fetchFireDayFeatures(urls) {
        const [windrhRes, drytRes] = await Promise.allSettled([
            _fetchSPCCatData(urls.windrh),
            _fetchSPCCatData(urls.dryt),
        ]);
        return [
            ...(windrhRes.status === 'fulfilled' ? windrhRes.value?.features || [] : []),
            ...(drytRes.status === 'fulfilled' ? drytRes.value?.features || [] : []),
        ];
    }

    const settled = await Promise.allSettled(FIRE_DAY_URLS.map(urls => _fetchFireDayFeatures(urls)));

    const hits = [];
    settled.forEach((result, i) => {
        if (result.status !== 'fulfilled') {
            console.warn('SPC Fire Day ' + (i + 1) + ' unavailable:', result.reason?.message);
            return;
        }
        const features = result.value || [];
        let highestRisk = null;
        for (const feature of features) {
            // LABEL field: 'ELEV', 'CRIT', 'EXTCRIT' — normalize EXTCRIT → EXTM
            const raw = (feature.properties?.LABEL || feature.properties?.CATEGORY || '').trim().toUpperCase();
            const label = raw === 'EXTCRIT' ? 'EXTM' : raw;
            const riskIdx = _SPC_FIRE_ORDER.indexOf(label);
            if (riskIdx < 0) continue;
            if (_pointInSPCGeometry(lng, lat, feature.geometry)) {
                if (!highestRisk || riskIdx > _SPC_FIRE_ORDER.indexOf(highestRisk)) {
                    highestRisk = label;
                }
            }
        }
        if (highestRisk) hits.push({ risk: highestRisk, dayLabel: _spcDayLabel(i), dayNum: i + 1 });
    });

    if (hits.length > 0) {
        renderSPCFireBanners(hits);
    } else {
        container.style.display = 'none';
        container.innerHTML = '';
    }
}

function renderSPCFireBanners(entries) {
    const container = document.getElementById('fire-weather-banner-container');
    if (!container) return;
    container.style.display = 'block';
    container.innerHTML = entries.map(({ risk, dayLabel, dayNum }) => {
        const label = _SPC_FIRE_LABELS[risk] || risk;
        const cls = _SPC_FIRE_CLASS[risk] || 'elev';
        return `
        <button type="button" class="spc-fire-banner spc-fire-${cls} fade-in"
                onclick="navigateToSPCMaps(${dayNum}, 'fire-wx')"
                title="Tap to view SPC Fire Weather Outlook maps">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" style="flex-shrink:0;">
                <path d="M13.5 0.67s.74 2.65.74 4.8c0 2.06-1.35 3.73-3.41 3.73-2.07 0-3.63-1.67-3.63-3.73l.03-.36C5.21 7.51 4 10.62 4 14c0 4.42 3.58 8 8 8s8-3.58 8-8C20 8.61 17.41 3.8 13.5 0.67zM11.71 19c-1.78 0-3.22-1.4-3.22-3.14 0-1.62 1.05-2.76 2.81-3.12 1.77-.36 3.6-1.21 4.62-2.58.39 1.29.59 2.65.59 4.04 0 2.65-2.15 4.8-4.8 4.8z"/>
            </svg>
            <span><strong>${label} Fire Weather Risk</strong> – ${dayLabel} SPC Fire Outlook. Tap to view maps.</span>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"
                 stroke-linecap="round" style="flex-shrink:0;">
                <polyline points="9 18 15 12 9 6"/>
            </svg>
        </button>`;
    }).join('');
}

// ---- WPC Excessive Rainfall Outlook ----

const _WPC_RAIN_ORDER = ['MRGL', 'SLGT', 'MDT', 'HIGH'];
const _WPC_RAIN_LABELS = { MRGL: 'Marginal', SLGT: 'Slight', MDT: 'Moderate', HIGH: 'High' };
const _WPC_RAIN_CLASS = { MRGL: 'mrgl', SLGT: 'slgt', MDT: 'mdt', HIGH: 'high' };

// Normalize a WPC ERO feature's properties to a short risk code (MRGL/SLGT/MDT/HIGH)
// New ERO GeoJSON uses CATEGORY (short code) or OUTLOOK (full name) depending on version.
function _wpcRainLabel(props) {
    const cat = (props?.CATEGORY || '').trim().toUpperCase();
    if (_WPC_RAIN_ORDER.indexOf(cat) >= 0) return cat;
    const outlook = (props?.OUTLOOK || '').trim().toUpperCase();
    const nameMap = { MARGINAL: 'MRGL', SLIGHT: 'SLGT', MODERATE: 'MDT', HIGH: 'HIGH' };
    return nameMap[outlook] || null;
}

async function loadAndRenderWPCRainfallOutlook(lat, lng) {
    const container = document.getElementById('wpc-rainfall-banner-container');
    if (!container) return;

    // WPC ERO moved to the experimental map endpoint
    const WPC_ERO_URLS = [
        'https://www.wpc.ncep.noaa.gov/exper/eromap/geojson/Day1_Latest.geojson',
        'https://www.wpc.ncep.noaa.gov/exper/eromap/geojson/Day2_Latest.geojson',
        'https://www.wpc.ncep.noaa.gov/exper/eromap/geojson/Day3_Latest.geojson',
    ];

    const settled = await Promise.allSettled(WPC_ERO_URLS.map(url => _fetchSPCCatData(url)));

    const hits = [];
    settled.forEach((result, i) => {
        if (result.status !== 'fulfilled') {
            console.warn('WPC ERO Day ' + (i + 1) + ' unavailable:', result.reason?.message);
            return;
        }
        const features = result.value?.features || [];
        let highestRisk = null;
        for (const feature of features) {
            const label = _wpcRainLabel(feature.properties);
            if (!label) continue;
            const riskIdx = _WPC_RAIN_ORDER.indexOf(label);
            if (riskIdx < 0) continue;
            if (_pointInSPCGeometry(lng, lat, feature.geometry)) {
                if (!highestRisk || riskIdx > _WPC_RAIN_ORDER.indexOf(highestRisk)) {
                    highestRisk = label;
                }
            }
        }
        if (highestRisk) hits.push({ risk: highestRisk, dayLabel: _spcDayLabel(i), dayNum: i + 1 });
    });

    if (hits.length > 0) {
        renderWPCRainfallBanners(hits);
    } else {
        container.style.display = 'none';
        container.innerHTML = '';
    }
}

function renderWPCRainfallBanners(entries) {
    const container = document.getElementById('wpc-rainfall-banner-container');
    if (!container) return;
    container.style.display = 'block';
    container.innerHTML = entries.map(({ risk, dayLabel, dayNum }) => {
        const label = _WPC_RAIN_LABELS[risk] || risk;
        const cls = _WPC_RAIN_CLASS[risk] || 'mrgl';
        return `
        <button type="button" class="wpc-rain-banner wpc-rain-${cls} fade-in"
                onclick="navigateToSPCMaps(${dayNum}, 'wpc-rain')"
                title="Tap to view WPC Excessive Rainfall Outlook">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" style="flex-shrink:0;">
                <path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z"/>
            </svg>
            <span><strong>${label} Excessive Rainfall Risk</strong> – ${dayLabel} WPC Outlook. Tap to view maps.</span>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"
                 stroke-linecap="round" style="flex-shrink:0;">
                <polyline points="9 18 15 12 9 6"/>
            </svg>
        </button>`;
    }).join('');
}

// ---- Hourly detail popup ----
let _hourlyData = [];
let _hourlyForecastDays = [];

function showHourlyDetail(idx) {
    const h = _hourlyData[idx];
    if (!h) return;

    // Remove any existing popup
    const existing = document.getElementById('hourly-detail-popup');
    if (existing) existing.remove();

    const time = idx === 0 ? 'Now' : WeatherAPI.formatTime(h.interval?.startTime || h.displayDateTime);
    const temp = WeatherAPI.formatTemp(h.temperature?.degrees);
    const feelsLike = h.feelsLikeTemperature?.degrees != null
        ? WeatherAPI.formatTemp(h.feelsLikeTemperature.degrees) + '°'
        : null;
    const cond = h.weatherCondition?.description?.text
        || (h.weatherCondition?.type || '').replace(/_/g, ' ').toLowerCase()
        || '—';
    const precip = h.precipitation?.probability;
    const windSpeed = h.wind?.speed;
    const windDir = h.wind?.direction != null ? WeatherAPI.windDirection(h.wind.direction) : null;
    const windGust = h.wind?.gust;
    const humidity = h.relativeHumidity;
    const condType = h.weatherCondition?.type || '';
    const tsMs = Date.parse(h.interval?.startTime || h.displayDateTime || '');
    const dayForHour = _dayForTimestamp(tsMs, _hourlyForecastDays);
    const hourNight = _isTimestampNight(tsMs, dayForHour);
    const iconSvg = WeatherIcons.fromText(condType, hourNight);

    // Fair Weather Index for this hour
    let fwiBadgeHtml = '';
    if (typeof FairWeatherIndex !== 'undefined') {
        const fwiInput = {
            interval: h.interval,
            displayDateTime: h.displayDateTime,
            feelsLike: h.feelsLikeTemperature,
            relativeHumidity: h.relativeHumidity,
            wind: { speed: { value: h.wind?.speed }, gust: h.wind?.gust },
            windGust: h.wind?.gust,
            cloudCover: h.cloudCover,
            precipitation: h.precipitation,
            weatherCondition: h.weatherCondition,
        };
        const fwi = FairWeatherIndex.calculate(fwiInput);
        fwiBadgeHtml = `<span class="fwi-badge" style="color:${fwi.color};border-color:${fwi.color};background:${fwi.bg};font-size:0.75rem;margin-left:auto;">
            <span style="width:6px;height:6px;border-radius:50%;background:${fwi.color};flex-shrink:0;display:inline-block;"></span>
            <span>${fwi.label}</span>
        </span>`;
    }

    const rows = [];
    if (feelsLike) rows.push(`<div class="hpop-row"><span class="hpop-key">Feels Like</span><span>${feelsLike}</span></div>`);
    if (precip != null) rows.push(`<div class="hpop-row"><span class="hpop-key">Precip</span><span>${Math.round(precip)}%</span></div>`);
    if (windSpeed != null) rows.push(`<div class="hpop-row"><span class="hpop-key">Wind</span><span>${Math.round(windSpeed)} mph${windDir ? ' ' + windDir : ''}</span></div>`);
    if (windGust != null) rows.push(`<div class="hpop-row"><span class="hpop-key">Wind Gusts</span><span>${Math.round(windGust)} mph</span></div>`);
    if (humidity != null) rows.push(`<div class="hpop-row"><span class="hpop-key">Humidity</span><span>${Math.round(humidity)}%</span></div>`);

    const popup = document.createElement('div');
    popup.id = 'hourly-detail-popup';
    popup.className = 'hourly-detail-popup glass';
    popup.innerHTML = `
        <div class="hpop-header">
            <span class="hpop-time">${time}</span>
            <div class="hpop-icon" aria-hidden="true">${iconSvg}</div>
            <span class="hpop-temp">${temp}°</span>
            ${fwiBadgeHtml}
            <button class="hpop-close" onclick="document.getElementById('hourly-detail-popup').remove()">&#x2715;</button>
        </div>
        <div class="hpop-cond">${cond}</div>
        ${rows.join('')}
    `;

    // Insert after the whole hourly forecast card (outside it) to avoid
    // double-overlay and scrollbar overlap
    const strip = document.getElementById('hourly-strip');
    const card = strip.closest('.hourly-forecast-card') || strip.parentNode;
    card.insertAdjacentElement('afterend', popup);

    // Auto-dismiss when clicking outside
    const dismiss = (e) => {
        if (!popup.contains(e.target)) {
            popup.remove();
            document.removeEventListener('click', dismiss);
        }
    };
    setTimeout(() => document.addEventListener('click', dismiss), 50);
}

// ---- Day/night helper ----
// Parses a sunrise or sunset string robustly.
// Open-Meteo returns "2026-03-08T06:45" (local, no tz offset).
// Google returns an ISO string with offset or Z.
function _parseSunTime(str) {
    if (!str) return NaN;
    if (typeof str === 'object') {
        const y = str.year;
        const m = str.month;
        const d = str.day;
        if (y != null && m != null && d != null) {
            const h = str.hours || 0;
            const min = str.minutes || 0;
            const s = str.seconds || 0;
            return new Date(y, m - 1, d, h, min, s).getTime();
        }
    }
    const ms = Date.parse(str);
    if (!isNaN(ms)) return ms;
    return NaN;
}

function _dateKeyFromMs(tsMs) {
    const d = new Date(tsMs);
    if (isNaN(d)) return null;
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function _dailyKey(day) {
    if (!day) return null;
    if (typeof day.displayDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(day.displayDate)) {
        return day.displayDate;
    }
    const base = day.interval?.startTime || day.displayDate;
    if (!base) return null;
    const tsMs = Date.parse(base);
    return isNaN(tsMs) ? null : _dateKeyFromMs(tsMs);
}

function _dayForTimestamp(tsMs, forecastDays) {
    if (!Array.isArray(forecastDays) || forecastDays.length === 0 || isNaN(tsMs)) return null;
    const targetKey = _dateKeyFromMs(tsMs);
    if (!targetKey) return forecastDays[0] || null;
    return forecastDays.find((d) => _dailyKey(d) === targetKey) || forecastDays[0] || null;
}

// Returns true if current time is between sunset and sunrise (nighttime).
function _isNighttime(day0) {
    if (!day0) return false;
    const srMs = _parseSunTime(day0.sunrise);
    const ssMs = _parseSunTime(day0.sunset);
    if (isNaN(srMs) || isNaN(ssMs)) return false;
    const now = Date.now();
    // Daytime = between sunrise and sunset; nighttime = everything else
    return now < srMs || now > ssMs;
}

// Returns true if a given timestamp (ms) is nighttime relative to a day's sunrise/sunset.
function _isTimestampNight(tsMs, day0) {
    if (!day0 || isNaN(tsMs)) return false;
    const srMs = _parseSunTime(day0.sunrise);
    const ssMs = _parseSunTime(day0.sunset);
    if (isNaN(srMs) || isNaN(ssMs)) return false;
    return tsMs < srMs || tsMs > ssMs;
}

// ---- Render functions ----

function renderCurrentConditions(data, dailyData) {
    const temp = data.temperature?.degrees;
    document.getElementById('current-temp').innerHTML =
        `${WeatherAPI.formatTemp(temp)}<span class="unit">&deg;F</span>`;

    const condition = data.weatherCondition?.description?.text || data.weatherCondition?.type?.replace(/_/g, ' ') || 'Unknown';
    document.getElementById('current-condition').textContent = condition;

    const feelsLike = data.feelsLikeTemperature?.degrees;
    if (feelsLike != null) {
        document.getElementById('feels-like').textContent = `Feels like ${WeatherAPI.formatTemp(feelsLike)}\u00B0`;
    }

    if (dailyData && dailyData.forecastDays && dailyData.forecastDays.length > 0) {
        const day = dailyData.forecastDays[0];
        const hi = day.maxTemperature?.degrees;
        const lo = day.minTemperature?.degrees;
        if (hi != null && lo != null) {
            document.getElementById('hi-lo').innerHTML =
                `<span class="hi">H:${WeatherAPI.formatTemp(hi)}\u00B0</span> &nbsp; <span class="lo">L:${WeatherAPI.formatTemp(lo)}\u00B0</span>`;
        }
    }

    const condType = data.weatherCondition?.type || condition;
    const isNight = _isNighttime(dailyData?.forecastDays?.[0]);
    const iconSvg = WeatherIcons.fromText(condType, isNight);
    document.getElementById('current-icon').innerHTML = iconSvg;

    // Wind
    const windSpeed = data.wind?.speed?.value;
    const windGust = data.wind?.gust?.value;
    const windDir = data.wind?.direction;
    if (windSpeed != null) {
        const fmtWind = v => v % 1 === 0 ? v : parseFloat(v.toFixed(1));
        document.getElementById('wind-speed').innerHTML =
            `${fmtWind(windSpeed)}<span class="unit"> mph</span>`;
        let detail = windDir != null ? WeatherAPI.windDirection(windDir) : '';
        if (windGust != null) detail += ` \u2022 Gusts ${fmtWind(windGust)} mph`;
        document.getElementById('wind-detail').textContent = detail;
    }

    // Humidity
    const humidity = data.relativeHumidity;
    if (humidity != null) {
        document.getElementById('humidity-value').innerHTML =
            `${Math.round(humidity)}<span class="unit">%</span>`;
    }
    const dewpoint = data.dewPoint?.degrees;
    if (dewpoint != null) {
        document.getElementById('dewpoint-detail').textContent = `Dew point: ${WeatherAPI.formatTemp(dewpoint)}\u00B0`;
    }

    // UV Index
    const uv = data.uvIndex;
    if (uv != null) {
        document.getElementById('uv-value').textContent = uv;
        let uvLabel = 'Low';
        if (uv >= 3 && uv < 6) uvLabel = 'Moderate';
        else if (uv >= 6 && uv < 8) uvLabel = 'High';
        else if (uv >= 8 && uv < 11) uvLabel = 'Very High';
        else if (uv >= 11) uvLabel = 'Extreme';
        document.getElementById('uv-detail').textContent = uvLabel;
    }

    // Pressure
    const pressure = data.pressure?.meanSeaLevelMillibars;
    if (pressure != null) {
        const inHg = (pressure * 0.02953).toFixed(2);
        document.getElementById('pressure-value').innerHTML =
            `${inHg}<span class="unit"> inHg</span>`;
    }

    // Cloud cover
    const clouds = data.cloudCover;
    if (clouds != null) {
        document.getElementById('cloud-value').innerHTML =
            `${Math.round(clouds)}<span class="unit">%</span>`;
    }

    applyWeatherBackground(condType, isNight);
}

// Maps a condition type to one of the bg-cond-* CSS classes and applies it
// to the .bg-gradient element with a brief opacity cross-fade.
function applyWeatherBackground(condType, isNight) {
    const el = document.querySelector('.bg-gradient');
    if (!el) return;
    const ct = (condType || '').toUpperCase();

    let cls = '';
    if (ct === 'CLEAR' || ct === 'MOSTLY_CLEAR') {
        cls = isNight ? 'bg-cond-clear-night' : 'bg-cond-clear-day';
    } else if (ct === 'PARTLY_CLOUDY') {
        cls = isNight ? 'bg-cond-partly-cloudy-night' : 'bg-cond-partly-cloudy-day';
    } else if (ct === 'MOSTLY_CLOUDY' || ct === 'OVERCAST') {
        cls = 'bg-cond-cloudy';
    } else if (ct.includes('THUNDER')) {
        cls = 'bg-cond-storm';
    } else if (ct.includes('RAIN') || ct === 'DRIZZLE' || ct === 'FREEZING_RAIN') {
        cls = 'bg-cond-rain';
    } else if (ct.includes('SNOW') || ct === 'SLEET') {
        cls = 'bg-cond-snow';
    } else if (ct === 'FOG') {
        cls = 'bg-cond-fog';
    }

    if (!cls) return;
    if (el.classList.contains(cls)) return; // already correct, nothing to do

    el.style.transition = 'opacity 0.6s ease';
    void el.offsetHeight; // flush styles so transition is registered before opacity change
    el.style.opacity = '0';
    setTimeout(() => {
        el.className = el.className.replace(/\bbg-cond-\S+/g, '').trim();
        el.classList.add(cls);
        void el.offsetHeight; // flush again so the new class is painted before fade-in
        el.style.opacity = '1';
    }, 650);
}

function renderHourlyForecast(data, forecastDays) {
    const strip = document.getElementById('hourly-strip');
    _hourlyData = data.forecastHours || [];
    _hourlyForecastDays = forecastDays || [];

    if (_hourlyData.length === 0) {
        strip.innerHTML = '<div class="error-message">No hourly data available</div>';
        return;
    }

    strip.innerHTML = _hourlyData.map((hour, i) => {
        const time = i === 0 ? 'Now' : WeatherAPI.formatTime(hour.interval?.startTime || hour.displayDateTime);
        const condType = hour.weatherCondition?.type || '';

        const tsMs = Date.parse(hour.interval?.startTime || hour.displayDateTime || '');
        const dayForHour = _dayForTimestamp(tsMs, forecastDays);
        const hourNight = _isTimestampNight(tsMs, dayForHour);

        const iconSvg = WeatherIcons.fromText(condType, hourNight);
        const precip = hour.precipitation?.probability;
        const precipStr = precip != null && precip > 0 ? `${Math.round(precip)}%` : '';

        return `
            <div class="hourly-item ${i === 0 ? 'now' : ''} fade-in"
                 style="animation-delay:${i * 30}ms;cursor:pointer;"
                 onclick="showHourlyDetail(${i})"
                 title="Tap for details">
                <span class="time">${time}</span>
                <div style="width:36px;height:36px;">${iconSvg}</div>
                ${precipStr ? `<span class="precip" style="display:flex;align-items:center;gap:2px;white-space:nowrap;"><svg width="9" height="9" viewBox="0 0 24 24" fill="rgba(100,180,255,0.85)" style="flex-shrink:0;"><path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z"/></svg>${precipStr}</span>` : '<span class="precip" style="visibility:hidden;font-size:0.7rem;">--</span>'}
            </div>
        `;
    }).join('');

    _updateMetricPills(_hourlyData);
    _renderMetricRow(_hourlyData, _activeMetric);
    document.querySelectorAll('.metric-pill').forEach(btn =>
        btn.classList.toggle('active', btn.dataset.metric === _activeMetric));
}

// ---- Hourly Metric Chart ----
let _activeMetric = 'temp';

// Column geometry must match .hourly-strip layout (padding:20px, gap:4px, item min-width:72px)
const _ITEM_COL = 76; // 72px item + 4px gap
const _STRIP_PAD = 20;

function _getMetricValue(hour, metric) {
    switch (metric) {
        case 'temp':      return hour.temperature?.degrees != null ? Math.round(hour.temperature.degrees) : null;
        case 'feelslike': return hour.feelsLikeTemperature?.degrees != null ? Math.round(hour.feelsLikeTemperature.degrees) : null;
        case 'humidity':  return hour.relativeHumidity != null ? Math.round(hour.relativeHumidity) : null;
        case 'wind':      return hour.wind?.speed != null ? Math.round(hour.wind.speed) : null;
        case 'precip':    return hour.precipitation?.probability != null ? Math.round(hour.precipitation.probability) : null;
        case 'fwi': {
            if (typeof FairWeatherIndex === 'undefined') return null;
            const fwiInput = {
                interval: hour.interval,
                displayDateTime: hour.displayDateTime,
                feelsLike: hour.feelsLikeTemperature,
                relativeHumidity: hour.relativeHumidity,
                wind: { speed: { value: hour.wind?.speed }, gust: hour.wind?.gust },
                windGust: hour.wind?.gust,
                cloudCover: hour.cloudCover,
                precipitation: hour.precipitation,
                weatherCondition: hour.weatherCondition,
            };
            return FairWeatherIndex.calculate(fwiInput).score100;
        }
        default:          return null;
    }
}

function _metricUnit(metric) {
    switch (metric) {
        case 'temp':
        case 'feelslike': return '\u00b0';
        case 'humidity':
        case 'precip':    return '%';
        case 'wind':      return ' mph';
        case 'fwi':       return '';
        default:          return '';
    }
}

const _METRIC_COLORS = {
    temp:      '#FF7043',
    feelslike: '#FFA726',
    humidity:  '#42A5F5',
    wind:      '#4DB6AC',
    precip:    '#26C6DA',
    fwi:       '#8BC34A'
};

function _renderMetricRow(hours, metric) {
    const row = document.getElementById('hourly-metric-row');
    if (!row || !hours.length) return;

    const vals = hours.map(h => _getMetricValue(h, metric));
    const validVals = vals.filter(v => v != null);
    if (validVals.length === 0) { row.innerHTML = ''; return; }

    const unit = _metricUnit(metric);
    const color = _METRIC_COLORS[metric] || '#4DB6AC';

    const H = 88;
    const PAD_T = 26; // room for value labels above dots
    const PAD_B = 6;
    const plotH = H - PAD_T - PAD_B;
    const n = hours.length;
    const svgW = _STRIP_PAD + n * _ITEM_COL - 4 + _STRIP_PAD; // -4: no trailing gap

    let minV = Math.min(...validVals);
    let maxV = Math.max(...validVals);
    const spread = maxV - minV || 1;
    minV -= spread * 0.15;
    maxV += spread * 0.15;

    const xOf = i => _STRIP_PAD + i * _ITEM_COL + _ITEM_COL / 2 - 2;
    const yOf = v => PAD_T + plotH - ((v - minV) / (maxV - minV)) * plotH;

    // Line path and area fill
    let linePath = '';
    let areaPath = '';
    let firstX = null, lastX = null, lastY = null;
    vals.forEach((v, i) => {
        if (v == null) return;
        const x = xOf(i), y = yOf(v);
        if (firstX === null) { linePath += `M${x.toFixed(1)},${y.toFixed(1)}`; areaPath += `M${x.toFixed(1)},${H} L${x.toFixed(1)},${y.toFixed(1)}`; firstX = x; }
        else                 { linePath += ` L${x.toFixed(1)},${y.toFixed(1)}`; areaPath += ` L${x.toFixed(1)},${y.toFixed(1)}`; }
        lastX = x; lastY = y;
    });
    if (lastX !== null) areaPath += ` L${lastX.toFixed(1)},${H} Z`;

    // Dots and value labels
    let dotsHtml = '';
    vals.forEach((v, i) => {
        if (v == null) return;
        const x = xOf(i), y = yOf(v);
        let dotColor = color;
        let label = `${v}${unit}`;
        if (metric === 'fwi' && typeof FairWeatherIndex !== 'undefined') {
            const rating = FairWeatherIndex.RATINGS.find(r => v >= r.min) ?? FairWeatherIndex.RATINGS[FairWeatherIndex.RATINGS.length - 1];
            dotColor = rating.color;
            label = rating.short;
        }
        dotsHtml += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2.5" fill="${dotColor}" stroke="rgba(10,15,35,0.8)" stroke-width="1.5"/>`;
        dotsHtml += `<text x="${x.toFixed(1)}" y="${(y - 7).toFixed(1)}" text-anchor="middle" fill="${metric === 'fwi' ? dotColor : 'rgba(255,255,255,0.9)'}" font-size="10.5" font-weight="500">${label}</text>`;
    });

    const gradId = `mg_${metric}`;
    row.innerHTML = `<svg width="${svgW}" height="${H}" style="display:block;overflow:visible;">
        <defs>
            <linearGradient id="${gradId}" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stop-color="${color}" stop-opacity="0.3"/>
                <stop offset="100%" stop-color="${color}" stop-opacity="0"/>
            </linearGradient>
        </defs>
        <path d="${areaPath}" fill="url(#${gradId})"/>
        <path d="${linePath}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
        ${dotsHtml}
    </svg>`;
}

function _updateMetricPills(hours) {
    const allMetrics = ['temp', 'feelslike', 'humidity', 'wind', 'precip', 'windgusts', 'fwi'];
    let firstVisible = null;
    allMetrics.forEach(metric => {
        const btn = document.querySelector(`#hourly-metric-selector [data-metric="${metric}"]`);
        if (!btn) return;
        const hasData = hours.some(h => _getMetricValue(h, metric) != null);
        btn.style.display = hasData ? '' : 'none';
        if (hasData && firstVisible === null) firstVisible = metric;
    });
    // If active metric has no data, switch to first available
    const activeHasData = hours.some(h => _getMetricValue(h, _activeMetric) != null);
    if (!activeHasData && firstVisible) {
        _activeMetric = firstVisible;
    }
}

function switchMetric(metric) {
    _activeMetric = metric;
    document.querySelectorAll('.metric-pill').forEach(btn =>
        btn.classList.toggle('active', btn.dataset.metric === metric));
    _renderMetricRow(_hourlyData, metric);
}

function renderAirQuality(data) {
    const index = data.indexes?.[0];
    if (!index) return;

    const aqi = index.aqi || index.aqiDisplay;
    const category = WeatherAPI.aqiCategory(aqi);

    document.getElementById('aqi-value').textContent = aqi;
    const badge = document.getElementById('aqi-badge');
    badge.textContent = category.label;
    badge.className = `badge ${category.class}`;

    // Position marker on the bar using same category thresholds
    // Bar segments: Good(0-50)=10%, Moderate(51-100)=10%, USG(101-150)=10%, Unhealthy(151-200)=10%, Very Unhealthy(201-300)=20%, Hazardous(301-500)=40%
    // Simplified: linear 0-500 scale mapped to percentage
    const pct = Math.min(100, (aqi / 500) * 100);
    document.getElementById('aqi-marker').style.left = pct + '%';

    // Dominant pollutant
    const detail = document.getElementById('aqi-detail');
    const dominant = index.dominantPollutant;
}

function renderPollen(data) {
    // Default all pollen elements to "None" before processing
    ['pollen-tree', 'pollen-grass', 'pollen-weed'].forEach(id => {
        const el = document.getElementById(id);
        if (el) { el.textContent = 'None'; el.className = 'level pollen-low'; }
    });

    // Handle both possible response structures from the Pollen API
    const days = data.dailyInfo || [];
    if (days.length === 0) return;

    const today = days[0];
    const types = today.pollenTypeInfo || [];

    if (types.length === 0) return;

    types.forEach(pollen => {
        const code = (pollen.code || '').toUpperCase();
        const displayName = (pollen.displayName || '').toLowerCase();
        const indexInfo = pollen.indexInfo || {};
 
        // Get the display value - try category first, then displayName, then numeric value
        let level = indexInfo.category || indexInfo.displayName || '';
        if (!level && indexInfo.value != null) {
            // Convert numeric UPI value to label
            const v = indexInfo.value;
            if (v === 0) level = 'None';
            else if (v <= 1) level = 'Very Low';
            else if (v <= 2) level = 'Low';
            else if (v <= 3) level = 'Moderate';
            else if (v <= 4) level = 'High';
            else level = 'Very High';
        }
        if (!level) level = 'None';

        let elId = null;
        if (code === 'TREE' || displayName.includes('tree')) elId = 'pollen-tree';
        else if (code === 'GRASS' || displayName.includes('grass')) elId = 'pollen-grass';
        else if (code === 'WEED' || displayName.includes('weed')) elId = 'pollen-weed';

        if (elId) {
            const el = document.getElementById(elId);
            el.textContent = level;

            const lowerLevel = level.toLowerCase();
            if (lowerLevel.includes('very high')) {
                el.className = 'level pollen-very-high';
            } else if (lowerLevel.includes('high')) {
                el.className = 'level pollen-high';
            } else if (lowerLevel.includes('moderate') || lowerLevel.includes('medium')) {
                el.className = 'level pollen-moderate';
            } else {
                el.className = 'level pollen-low';
            }
        }
    });
}

// ============================================================
// ALERT ACTION FUNCTIONS
// ============================================================

// Navigate the maps view to radar, zoomed to the current alert's area.
function navigateAlertToRadar() {
    if (!_currentOpenAlert) return;
    closeAlertDetail();

    // Use the bounds saved when the alert map polygon was drawn
    if (_lastAlertMapBounds) {
        window._alertRadarTarget = { bounds: _lastAlertMapBounds };
    } else if (_currentOpenAlert.geometry) {
        const coords = _extractGeometryCoords(_currentOpenAlert.geometry);
        if (coords.length >= 2) {
            const lngs = coords.map(c => c[0]);
            const lats = coords.map(c => c[1]);
            window._alertRadarTarget = {
                bounds: [
                    [Math.min(...lngs), Math.min(...lats)],
                    [Math.max(...lngs), Math.max(...lats)]
                ]
            };
        }
    }
    if (!window._alertRadarTarget) {
        const loc = LocationManager.getCurrent();
        window._alertRadarTarget = { center: [loc.lng, loc.lat], zoom: 8 };
    }

    // Tell showView to switch to radar layer
    window._spcTargetLayer = 'radar';
    window.location.hash = '#maps';
    if (typeof showView === 'function') showView('maps');
}

// Extract all coordinates from a GeoJSON geometry for bounding-box calculation.
function _extractGeometryCoords(geometry) {
    if (!geometry) return [];
    if (geometry.type === 'Polygon') return geometry.coordinates[0] || [];
    if (geometry.type === 'MultiPolygon') return geometry.coordinates.flatMap(poly => poly[0] || []);
    return [];
}

// Save a composite PNG (alert text left + radar map right) and trigger a download.
function screenshotAlert() {
    const alert = _currentOpenAlert;
    if (!alert) return;

    const W = 1200, H = 660;
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');

    // Dark background
    ctx.fillStyle = '#0d1525';
    ctx.fillRect(0, 0, W, H);

    // Right half — radar/alert map canvas
    let mapDrawn = false;
    if (_alertMap) {
        try {
            const mc = _alertMap.getCanvas();
            if (mc && mc.width > 0) {
                ctx.drawImage(mc, W / 2, 0, W / 2, H);
                mapDrawn = true;
            }
        } catch (e) { /* canvas may not be readable */ }
    }

    // Divider
    if (mapDrawn) {
        ctx.strokeStyle = 'rgba(255,255,255,0.15)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(W / 2, 0);
        ctx.lineTo(W / 2, H);
        ctx.stroke();
    }

    // Left half — colour strip + text
    const textW = (mapDrawn ? W / 2 : W) - 48;
    const x = 24;

    // Alert-type colour strip on left edge
    const _STRIP_COLORS = {
        'alert-tornado-warning': '#DD0000', 'alert-tornado-watch': '#BB44BB',
        'alert-svr-warning': '#FF8800',     'alert-svr-watch': '#DDC000',
        'alert-flash-flood-warning': '#00AA44', 'alert-flood-warning': '#00CC44',
        'alert-flood-watch': '#22BB66',     'alert-blizzard-warning': '#FF4400',
        'alert-winter-storm-warning': '#EE66AA', 'alert-winter-storm-watch': '#4488EE',
        'alert-high-wind-warning': '#DAA520', 'alert-red-flag-warning': '#FF1493',
        'alert-sws': '#00BBCC',             'alert-extreme': '#FF4444',
        'alert-warning': '#FF8800',         'alert-watch': '#DDC000',
        'alert-advisory': '#6688BB'
    };
    const stripColor = _STRIP_COLORS[_alertClass(alert)] || '#6688BB';
    ctx.fillStyle = stripColor;
    ctx.fillRect(0, 0, 5, H);

    // Title
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 18px system-ui,-apple-system,Arial,sans-serif';
    let y = _drawWrappedText(ctx, alert.headline || alert.event || 'Weather Alert', x + 8, 38, textW - 8, 24);
    y += 12;

    // Meta
    ctx.fillStyle = '#88a0b8';
    ctx.font = '12px system-ui,-apple-system,Arial,sans-serif';
    ctx.fillText(`Effective: ${_formatAlertTime(alert.onset || alert.effective)}`, x + 8, y); y += 17;
    ctx.fillText(`Expires:   ${_formatAlertTime(alert.expires)}`, x + 8, y); y += 17;
    if (alert.areaDesc) {
        ctx.font = '11px system-ui,-apple-system,Arial,sans-serif';
        ctx.fillStyle = '#607890';
        const area = alert.areaDesc.length > 110 ? alert.areaDesc.slice(0, 107) + '\u2026' : alert.areaDesc;
        y = _drawWrappedText(ctx, `Areas: ${area}`, x + 8, y, textW - 8, 16);
    }

    // Divider line
    y += 10;
    ctx.strokeStyle = 'rgba(255,255,255,0.1)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + textW, y); ctx.stroke();
    y += 14;

    // Description / Instruction body text
    ctx.fillStyle = '#b0c8e0';
    ctx.font = '11px system-ui,-apple-system,Arial,sans-serif';
    const bodyText = [alert.description, alert.instruction].filter(Boolean).join('\n\n');
    for (const line of bodyText.split('\n')) {
        if (y > H - 36) break;
        if (!line.trim()) { y += 8; continue; }
        y = _drawWrappedText(ctx, line.trim(), x + 8, y, textW - 8, 15);
        y += 2;
    }

    // Watermark
    ctx.fillStyle = 'rgba(255,255,255,0.22)';
    ctx.font = '10px system-ui,-apple-system,Arial,sans-serif';
    ctx.fillText('ephrataweather.com', x + 8, H - 12);

    // Trigger download
    const a = document.createElement('a');
    a.download = `weather-alert-${Date.now()}.png`;
    a.href = canvas.toDataURL('image/png');
    a.click();
}

// Word-wrap text onto a canvas context; returns the new y position after the last line.
function _drawWrappedText(ctx, text, x, y, maxWidth, lineHeight) {
    if (!text) return y;
    const words = text.split(/\s+/);
    let line = '';
    for (const word of words) {
        const test = line ? line + ' ' + word : word;
        if (ctx.measureText(test).width > maxWidth && line) {
            ctx.fillText(line, x, y);
            line = word;
            y += lineHeight;
        } else {
            line = test;
        }
    }
    if (line) { ctx.fillText(line, x, y); y += lineHeight; }
    return y;
}

// Copy a shareable URL for the current alert to the clipboard (or use Web Share API).
function shareAlert() {
    const alert = _currentOpenAlert;
    if (!alert) return;
    const alertId = alert.id || '';
    if (!alertId) { _showAlertToast('No shareable ID for this alert.'); return; }

    const url = `${window.location.origin}${window.location.pathname}#current&alert=${encodeURIComponent(alertId)}`;
    const title = alert.headline || alert.event || 'Weather Alert';
    const text = `${title}\n${alert.areaDesc || ''}`.trim();

    if (navigator.share) {
        navigator.share({ title, text, url }).catch(() => {});
    } else if (navigator.clipboard) {
        navigator.clipboard.writeText(url).then(() => _showAlertToast('Link copied!')).catch(() => {
            prompt('Copy this link:', url);
        });
    } else {
        prompt('Copy this link:', url);
    }
}

// Show a brief toast notification.
function _showAlertToast(msg) {
    let toast = document.getElementById('alert-share-toast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'alert-share-toast';
        toast.className = 'alert-share-toast';
        document.body.appendChild(toast);
    }
    toast.textContent = msg;
    toast.style.opacity = '1';
    clearTimeout(toast._hideTimer);
    toast._hideTimer = setTimeout(() => { toast.style.opacity = '0'; }, 2500);
}

// Fetch an alert directly from the NWS API by its ID and open the detail modal.
async function _fetchAndOpenAlertById(alertId) {
    try {
        const url = alertId.startsWith('http')
            ? alertId
            : `https://api.weather.gov/alerts/${encodeURIComponent(alertId)}`;
        const resp = await fetch(url, { headers: { 'Accept': 'application/geo+json' } });
        if (!resp.ok) return;
        const data = await resp.json();
        const p = data.properties || {};
        const alert = {
            id: data.id || alertId,
            event: p.event || 'Weather Alert',
            headline: p.headline || p.event || 'Weather Alert',
            description: p.description || '',
            instruction: p.instruction || '',
            severity: (p.severity || '').toLowerCase(),
            certainty: p.certainty || '',
            urgency: p.urgency || '',
            onset: p.onset || p.effective || null,
            effective: p.effective || null,
            expires: p.expires || p.ends || null,
            areaDesc: p.areaDesc || '',
            sender: p.senderName || '',
            geometry: data.geometry || null,
            parameters: p.parameters || {},
            raw: data
        };
        openAlertDetail(alert);
    } catch (e) {
        console.warn('Failed to fetch shared alert:', e);
    }
}
