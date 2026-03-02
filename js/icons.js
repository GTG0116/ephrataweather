// ============================================
// ANIMATED WEATHER ICONS (SVG-based)
// ============================================

const WeatherIcons = {
    // Generate an animated SVG icon by condition code
    get(conditionCode, size = 64) {
        const s = size;
        const fn = this._iconMap[conditionCode] || this._iconMap['default'];
        return fn(s);
    },

    // Map Google Weather API condition codes to icon generators
    _iconMap: {
        'CLEAR': (s) => WeatherIcons._sunny(s),
        'MOSTLY_CLEAR': (s) => WeatherIcons._sunny(s),
        'SUNNY': (s) => WeatherIcons._sunny(s),
        'PARTLY_CLOUDY': (s) => WeatherIcons._partlyCloudy(s),
        'MOSTLY_CLOUDY': (s) => WeatherIcons._cloudy(s),
        'CLOUDY': (s) => WeatherIcons._overcast(s),
        'OVERCAST': (s) => WeatherIcons._overcast(s),
        'FOG': (s) => WeatherIcons._fog(s),
        'LIGHT_FOG': (s) => WeatherIcons._fog(s),
        'DRIZZLE': (s) => WeatherIcons._lightRain(s),
        'LIGHT_RAIN': (s) => WeatherIcons._lightRain(s),
        'RAIN': (s) => WeatherIcons._rain(s),
        'HEAVY_RAIN': (s) => WeatherIcons._heavyRain(s),
        'SNOW': (s) => WeatherIcons._snow(s),
        'LIGHT_SNOW': (s) => WeatherIcons._lightSnow(s),
        'HEAVY_SNOW': (s) => WeatherIcons._heavySnow(s),
        'FLURRIES': (s) => WeatherIcons._lightSnow(s),
        'ICE_PELLETS': (s) => WeatherIcons._sleet(s),
        'SLEET': (s) => WeatherIcons._sleet(s),
        'FREEZING_RAIN': (s) => WeatherIcons._freezingRain(s),
        'FREEZING_DRIZZLE': (s) => WeatherIcons._freezingRain(s),
        'THUNDERSTORM': (s) => WeatherIcons._thunderstorm(s),
        'THUNDERSTORMS': (s) => WeatherIcons._thunderstorm(s),
        'LIGHT_THUNDERSTORM': (s) => WeatherIcons._thunderstorm(s),
        'HEAVY_THUNDERSTORM': (s) => WeatherIcons._heavyThunderstorm(s),
        'WIND': (s) => WeatherIcons._wind(s),
        'WINDY': (s) => WeatherIcons._wind(s),
        'HAIL': (s) => WeatherIcons._hail(s),
        'MIXED': (s) => WeatherIcons._sleet(s),
        'default': (s) => WeatherIcons._partlyCloudy(s)
    },

    // Resolve text-based conditions - uses 100% sizing so SVGs fill their containers
    fromText(text, isNight = false) {
        const sz = '100%';
        if (!text) return this.get('default', sz);
        const t = text.toUpperCase().replace(/\s+/g, '_');
        // Try direct match first
        if (this._iconMap[t]) return this.get(t, sz);
        // Keyword matching
        if (t.includes('THUNDER')) return this.get(t.includes('HEAVY') ? 'HEAVY_THUNDERSTORM' : 'THUNDERSTORM', sz);
        if (t.includes('FREEZING') && t.includes('RAIN')) return this.get('FREEZING_RAIN', sz);
        if (t.includes('SLEET') || t.includes('ICE')) return this.get('SLEET', sz);
        if (t.includes('HAIL')) return this.get('HAIL', sz);
        if (t.includes('HEAVY') && t.includes('SNOW')) return this.get('HEAVY_SNOW', sz);
        if (t.includes('SNOW') || t.includes('FLURR')) return this.get('SNOW', sz);
        if (t.includes('HEAVY') && t.includes('RAIN')) return this.get('HEAVY_RAIN', sz);
        if (t.includes('RAIN') || t.includes('SHOWER')) return this.get('RAIN', sz);
        if (t.includes('DRIZZLE')) return this.get('DRIZZLE', sz);
        if (t.includes('FOG') || t.includes('MIST') || t.includes('HAZE')) return this.get('FOG', sz);
        if (t.includes('OVERCAST')) return this.get('OVERCAST', sz);
        if (t.includes('CLOUDY') && t.includes('MOST')) return this.get('MOSTLY_CLOUDY', sz);
        if (t.includes('CLOUDY') && t.includes('PART')) return this.get('PARTLY_CLOUDY', sz);
        if (t.includes('CLOUD')) return this.get('CLOUDY', sz);
        if (t.includes('WIND')) return this.get('WIND', sz);
        if (t.includes('CLEAR') || t.includes('SUNNY') || t.includes('FAIR')) {
            return isNight ? this._clearNight(sz) : this.get('CLEAR', sz);
        }
        return this.get('default', sz);
    },

    // ---- Individual icon SVG generators ----

    _sunny(s) {
        return `<svg viewBox="0 0 100 100" width="${s}" height="${s}">
            <defs>
                <radialGradient id="sunGrad" cx="50%" cy="50%" r="50%">
                    <stop offset="0%" stop-color="#FFE066"/>
                    <stop offset="100%" stop-color="#FFB300"/>
                </radialGradient>
            </defs>
            <g transform="translate(50,50)">
                <g>
                    <animateTransform attributeName="transform" type="rotate" from="0" to="360" dur="30s" repeatCount="indefinite"/>
                    ${[0,45,90,135,180,225,270,315].map(a =>
                        `<line x1="0" y1="-30" x2="0" y2="-40" stroke="#FFD54F" stroke-width="3" stroke-linecap="round" transform="rotate(${a})">
                            <animate attributeName="opacity" values="0.5;1;0.5" dur="3s" begin="${a/360*3}s" repeatCount="indefinite"/>
                        </line>`
                    ).join('')}
                </g>
                <circle r="22" fill="url(#sunGrad)">
                    <animate attributeName="r" values="22;24;22" dur="4s" repeatCount="indefinite"/>
                </circle>
            </g>
        </svg>`;
    },

    _clearNight(s) {
        return `<svg viewBox="0 0 100 100" width="${s}" height="${s}">
            <defs>
                <radialGradient id="moonGrad" cx="40%" cy="40%">
                    <stop offset="0%" stop-color="#FFF9C4"/>
                    <stop offset="100%" stop-color="#CFD8DC"/>
                </radialGradient>
            </defs>
            <circle cx="45" cy="45" r="20" fill="url(#moonGrad)"/>
            <circle cx="55" cy="38" r="16" fill="#1a1a3e"/>
            ${[{x:72,y:25,d:0.3},{x:80,y:50,d:0.7},{x:65,y:70,d:1.1},{x:30,y:22,d:1.5},{x:20,y:65,d:0.1}].map(star =>
                `<circle cx="${star.x}" cy="${star.y}" r="1.2" fill="#FFF9C4">
                    <animate attributeName="opacity" values="0.3;1;0.3" dur="2s" begin="${star.d}s" repeatCount="indefinite"/>
                </circle>`
            ).join('')}
        </svg>`;
    },

    _partlyCloudy(s) {
        return `<svg viewBox="0 0 100 100" width="${s}" height="${s}">
            <defs>
                <radialGradient id="pcSunGrad" cx="50%" cy="50%" r="50%">
                    <stop offset="0%" stop-color="#FFE066"/>
                    <stop offset="100%" stop-color="#FFB300"/>
                </radialGradient>
                <linearGradient id="pcCloudGrad" x1="0%" y1="0%" x2="0%" y2="100%">
                    <stop offset="0%" stop-color="rgba(255,255,255,0.95)"/>
                    <stop offset="100%" stop-color="rgba(220,225,230,0.9)"/>
                </linearGradient>
            </defs>
            <!-- Sun behind cloud, upper-right -->
            <g transform="translate(58,30)">
                <g>
                    <animateTransform attributeName="transform" type="rotate" from="0" to="360" dur="30s" repeatCount="indefinite"/>
                    ${[0,60,120,180,240,300].map(a =>
                        `<line x1="0" y1="-22" x2="0" y2="-28" stroke="#FFD54F" stroke-width="2.5" stroke-linecap="round" transform="rotate(${a})">
                            <animate attributeName="opacity" values="0.4;0.9;0.4" dur="3s" begin="${a/360*3}s" repeatCount="indefinite"/>
                        </line>`
                    ).join('')}
                </g>
                <circle r="16" fill="url(#pcSunGrad)">
                    <animate attributeName="r" values="16;17;16" dur="4s" repeatCount="indefinite"/>
                </circle>
            </g>
            <!-- Cloud in front, overlapping lower part of sun -->
            <g>
                <animateTransform attributeName="transform" type="translate" values="0,0;2,0;0,0" dur="6s" repeatCount="indefinite"/>
                <ellipse cx="42" cy="62" rx="30" ry="14" fill="url(#pcCloudGrad)"/>
                <ellipse cx="30" cy="55" rx="18" ry="14" fill="rgba(255,255,255,0.95)"/>
                <ellipse cx="52" cy="55" rx="16" ry="12" fill="rgba(245,245,245,0.95)"/>
            </g>
        </svg>`;
    },

    _cloudy(s) {
        return `<svg viewBox="0 0 100 100" width="${s}" height="${s}">
            <defs>
                <linearGradient id="cloudGrad1" x1="0%" y1="0%" x2="0%" y2="100%">
                    <stop offset="0%" stop-color="rgba(255,255,255,0.9)"/>
                    <stop offset="100%" stop-color="rgba(200,210,220,0.85)"/>
                </linearGradient>
                <linearGradient id="cloudGrad2" x1="0%" y1="0%" x2="0%" y2="100%">
                    <stop offset="0%" stop-color="rgba(230,235,240,0.9)"/>
                    <stop offset="100%" stop-color="rgba(180,190,200,0.8)"/>
                </linearGradient>
            </defs>
            <g>
                <animateTransform attributeName="transform" type="translate" values="0,0;4,0;0,0" dur="8s" repeatCount="indefinite"/>
                <ellipse cx="40" cy="48" rx="22" ry="12" fill="url(#cloudGrad2)"/>
                <ellipse cx="35" cy="42" rx="14" ry="11" fill="rgba(220,225,235,0.9)"/>
            </g>
            <g>
                <animateTransform attributeName="transform" type="translate" values="0,0;-3,0;0,0" dur="7s" repeatCount="indefinite"/>
                <ellipse cx="60" cy="58" rx="26" ry="14" fill="url(#cloudGrad1)"/>
                <ellipse cx="50" cy="50" rx="16" ry="13" fill="rgba(255,255,255,0.95)"/>
                <ellipse cx="68" cy="52" rx="14" ry="11" fill="rgba(245,248,252,0.9)"/>
            </g>
        </svg>`;
    },

    _overcast(s) {
        return `<svg viewBox="0 0 100 100" width="${s}" height="${s}">
            <defs>
                <linearGradient id="ocGrad" x1="0%" y1="0%" x2="0%" y2="100%">
                    <stop offset="0%" stop-color="rgba(190,200,210,0.95)"/>
                    <stop offset="100%" stop-color="rgba(150,160,175,0.9)"/>
                </linearGradient>
            </defs>
            <g>
                <animateTransform attributeName="transform" type="translate" values="0,0;2,-1;0,0" dur="10s" repeatCount="indefinite"/>
                <ellipse cx="35" cy="45" rx="24" ry="13" fill="rgba(170,180,195,0.85)"/>
                <ellipse cx="30" cy="38" rx="15" ry="12" fill="rgba(180,190,200,0.9)"/>
            </g>
            <g>
                <animateTransform attributeName="transform" type="translate" values="0,0;-2,1;0,0" dur="9s" repeatCount="indefinite"/>
                <ellipse cx="58" cy="55" rx="30" ry="15" fill="url(#ocGrad)"/>
                <ellipse cx="48" cy="47" rx="18" ry="14" fill="rgba(195,205,215,0.95)"/>
                <ellipse cx="68" cy="49" rx="15" ry="12" fill="rgba(185,195,210,0.9)"/>
            </g>
        </svg>`;
    },

    _fog(s) {
        return `<svg viewBox="0 0 100 100" width="${s}" height="${s}">
            ${[38,50,62,74].map((y, i) =>
                `<line x1="18" y1="${y}" x2="82" y2="${y}" stroke="rgba(200,210,225,0.7)" stroke-width="4" stroke-linecap="round">
                    <animate attributeName="x1" values="18;22;18" dur="${3 + i * 0.5}s" repeatCount="indefinite"/>
                    <animate attributeName="x2" values="82;78;82" dur="${3 + i * 0.5}s" repeatCount="indefinite"/>
                    <animate attributeName="opacity" values="0.4;0.8;0.4" dur="${4 + i * 0.3}s" repeatCount="indefinite"/>
                </line>`
            ).join('')}
            <ellipse cx="50" cy="32" rx="22" ry="10" fill="rgba(200,210,225,0.5)">
                <animateTransform attributeName="transform" type="translate" values="0,0;3,0;0,0" dur="6s" repeatCount="indefinite"/>
            </ellipse>
        </svg>`;
    },

    _lightRain(s) {
        return `<svg viewBox="0 0 100 100" width="${s}" height="${s}">
            <defs>
                <linearGradient id="lrCloudGrad" x1="0%" y1="0%" x2="0%" y2="100%">
                    <stop offset="0%" stop-color="rgba(180,190,205,0.9)"/>
                    <stop offset="100%" stop-color="rgba(150,160,180,0.85)"/>
                </linearGradient>
            </defs>
            <g>
                <animateTransform attributeName="transform" type="translate" values="0,0;2,0;0,0" dur="7s" repeatCount="indefinite"/>
                <ellipse cx="50" cy="35" rx="28" ry="14" fill="url(#lrCloudGrad)"/>
                <ellipse cx="40" cy="28" rx="16" ry="12" fill="rgba(185,195,210,0.9)"/>
                <ellipse cx="60" cy="30" rx="14" ry="11" fill="rgba(175,185,200,0.9)"/>
            </g>
            ${[{x:40,d:0},{x:55,d:0.8}].map(drop =>
                `<line x1="${drop.x}" y1="55" x2="${drop.x - 2}" y2="65" stroke="rgba(100,160,255,0.6)" stroke-width="2" stroke-linecap="round">
                    <animate attributeName="y1" values="52;80;52" dur="1.5s" begin="${drop.d}s" repeatCount="indefinite"/>
                    <animate attributeName="y2" values="60;88;60" dur="1.5s" begin="${drop.d}s" repeatCount="indefinite"/>
                    <animate attributeName="opacity" values="0;0.7;0" dur="1.5s" begin="${drop.d}s" repeatCount="indefinite"/>
                </line>`
            ).join('')}
        </svg>`;
    },

    _rain(s) {
        return `<svg viewBox="0 0 100 100" width="${s}" height="${s}">
            <defs>
                <linearGradient id="rCloudGrad" x1="0%" y1="0%" x2="0%" y2="100%">
                    <stop offset="0%" stop-color="rgba(160,170,190,0.9)"/>
                    <stop offset="100%" stop-color="rgba(130,140,165,0.85)"/>
                </linearGradient>
            </defs>
            <g>
                <animateTransform attributeName="transform" type="translate" values="0,0;2,0;0,0" dur="7s" repeatCount="indefinite"/>
                <ellipse cx="50" cy="32" rx="30" ry="15" fill="url(#rCloudGrad)"/>
                <ellipse cx="38" cy="25" rx="17" ry="13" fill="rgba(165,175,195,0.9)"/>
                <ellipse cx="62" cy="27" rx="15" ry="12" fill="rgba(155,165,185,0.9)"/>
            </g>
            ${[{x:35,d:0},{x:48,d:0.4},{x:60,d:0.8},{x:42,d:1.2}].map(drop =>
                `<line x1="${drop.x}" y1="52" x2="${drop.x - 3}" y2="64" stroke="rgba(80,150,255,0.7)" stroke-width="2" stroke-linecap="round">
                    <animate attributeName="y1" values="50;82;50" dur="1.2s" begin="${drop.d}s" repeatCount="indefinite"/>
                    <animate attributeName="y2" values="58;90;58" dur="1.2s" begin="${drop.d}s" repeatCount="indefinite"/>
                    <animate attributeName="opacity" values="0;0.8;0" dur="1.2s" begin="${drop.d}s" repeatCount="indefinite"/>
                </line>`
            ).join('')}
        </svg>`;
    },

    _heavyRain(s) {
        return `<svg viewBox="0 0 100 100" width="${s}" height="${s}">
            <defs>
                <linearGradient id="hrCloudGrad" x1="0%" y1="0%" x2="0%" y2="100%">
                    <stop offset="0%" stop-color="rgba(130,140,165,0.95)"/>
                    <stop offset="100%" stop-color="rgba(100,110,140,0.9)"/>
                </linearGradient>
            </defs>
            <g>
                <animateTransform attributeName="transform" type="translate" values="0,0;2,0;0,0" dur="6s" repeatCount="indefinite"/>
                <ellipse cx="50" cy="28" rx="32" ry="16" fill="url(#hrCloudGrad)"/>
                <ellipse cx="36" cy="20" rx="18" ry="14" fill="rgba(140,150,175,0.95)"/>
                <ellipse cx="64" cy="22" rx="16" ry="13" fill="rgba(125,135,160,0.95)"/>
            </g>
            ${[{x:30,d:0},{x:40,d:0.2},{x:50,d:0.5},{x:60,d:0.3},{x:70,d:0.7},{x:45,d:0.9}].map(drop =>
                `<line x1="${drop.x}" y1="48" x2="${drop.x - 4}" y2="62" stroke="rgba(60,130,255,0.8)" stroke-width="2.5" stroke-linecap="round">
                    <animate attributeName="y1" values="46;84;46" dur="0.9s" begin="${drop.d}s" repeatCount="indefinite"/>
                    <animate attributeName="y2" values="56;94;56" dur="0.9s" begin="${drop.d}s" repeatCount="indefinite"/>
                    <animate attributeName="opacity" values="0;0.85;0" dur="0.9s" begin="${drop.d}s" repeatCount="indefinite"/>
                </line>`
            ).join('')}
        </svg>`;
    },

    _snow(s) {
        return `<svg viewBox="0 0 100 100" width="${s}" height="${s}">
            <defs>
                <linearGradient id="sCloudGrad" x1="0%" y1="0%" x2="0%" y2="100%">
                    <stop offset="0%" stop-color="rgba(190,200,215,0.9)"/>
                    <stop offset="100%" stop-color="rgba(165,175,195,0.85)"/>
                </linearGradient>
            </defs>
            <g>
                <animateTransform attributeName="transform" type="translate" values="0,0;2,0;0,0" dur="8s" repeatCount="indefinite"/>
                <ellipse cx="50" cy="30" rx="28" ry="14" fill="url(#sCloudGrad)"/>
                <ellipse cx="40" cy="24" rx="16" ry="12" fill="rgba(195,205,220,0.9)"/>
                <ellipse cx="60" cy="26" rx="14" ry="11" fill="rgba(185,195,210,0.9)"/>
            </g>
            ${[{x:38,d:0},{x:52,d:0.7},{x:62,d:1.4},{x:45,d:2.1}].map(flake =>
                `<text x="${flake.x}" y="55" font-size="8" fill="rgba(200,220,255,0.9)" text-anchor="middle" font-family="sans-serif">❄
                    <animate attributeName="y" values="50;90;50" dur="3s" begin="${flake.d}s" repeatCount="indefinite"/>
                    <animateTransform attributeName="transform" type="rotate" values="0 ${flake.x} 65;360 ${flake.x} 65" dur="4s" begin="${flake.d}s" repeatCount="indefinite"/>
                    <animate attributeName="opacity" values="0;0.9;0" dur="3s" begin="${flake.d}s" repeatCount="indefinite"/>
                </text>`
            ).join('')}
        </svg>`;
    },

    _lightSnow(s) {
        return `<svg viewBox="0 0 100 100" width="${s}" height="${s}">
            <defs>
                <linearGradient id="lsCloudGrad" x1="0%" y1="0%" x2="0%" y2="100%">
                    <stop offset="0%" stop-color="rgba(200,208,220,0.85)"/>
                    <stop offset="100%" stop-color="rgba(180,190,205,0.8)"/>
                </linearGradient>
            </defs>
            <g>
                <animateTransform attributeName="transform" type="translate" values="0,0;2,0;0,0" dur="8s" repeatCount="indefinite"/>
                <ellipse cx="50" cy="34" rx="26" ry="13" fill="url(#lsCloudGrad)"/>
                <ellipse cx="42" cy="28" rx="14" ry="11" fill="rgba(205,212,225,0.9)"/>
                <ellipse cx="58" cy="30" rx="13" ry="10" fill="rgba(195,205,218,0.9)"/>
            </g>
            ${[{x:42,d:0},{x:58,d:1.2}].map(flake =>
                `<text x="${flake.x}" y="55" font-size="7" fill="rgba(200,220,255,0.8)" text-anchor="middle" font-family="sans-serif">❄
                    <animate attributeName="y" values="52;88;52" dur="3.5s" begin="${flake.d}s" repeatCount="indefinite"/>
                    <animate attributeName="opacity" values="0;0.8;0" dur="3.5s" begin="${flake.d}s" repeatCount="indefinite"/>
                </text>`
            ).join('')}
        </svg>`;
    },

    _heavySnow(s) {
        return `<svg viewBox="0 0 100 100" width="${s}" height="${s}">
            <defs>
                <linearGradient id="hsCloudGrad" x1="0%" y1="0%" x2="0%" y2="100%">
                    <stop offset="0%" stop-color="rgba(170,180,200,0.95)"/>
                    <stop offset="100%" stop-color="rgba(145,155,180,0.9)"/>
                </linearGradient>
            </defs>
            <g>
                <animateTransform attributeName="transform" type="translate" values="0,0;2,0;0,0" dur="7s" repeatCount="indefinite"/>
                <ellipse cx="50" cy="26" rx="30" ry="15" fill="url(#hsCloudGrad)"/>
                <ellipse cx="38" cy="18" rx="17" ry="13" fill="rgba(175,185,205,0.95)"/>
                <ellipse cx="62" cy="20" rx="15" ry="12" fill="rgba(160,170,195,0.95)"/>
            </g>
            ${[{x:32,d:0},{x:42,d:0.4},{x:52,d:0.8},{x:62,d:0.3},{x:48,d:1.2},{x:38,d:1.6}].map(flake =>
                `<text x="${flake.x}" y="50" font-size="9" fill="rgba(210,225,255,0.9)" text-anchor="middle" font-family="sans-serif">❄
                    <animate attributeName="y" values="46;90;46" dur="2.5s" begin="${flake.d}s" repeatCount="indefinite"/>
                    <animateTransform attributeName="transform" type="rotate" values="0 ${flake.x} 65;360 ${flake.x} 65" dur="3s" begin="${flake.d}s" repeatCount="indefinite"/>
                    <animate attributeName="opacity" values="0;0.9;0" dur="2.5s" begin="${flake.d}s" repeatCount="indefinite"/>
                </text>`
            ).join('')}
        </svg>`;
    },

    _sleet(s) {
        return `<svg viewBox="0 0 100 100" width="${s}" height="${s}">
            <defs>
                <linearGradient id="slCloudGrad" x1="0%" y1="0%" x2="0%" y2="100%">
                    <stop offset="0%" stop-color="rgba(170,180,200,0.9)"/>
                    <stop offset="100%" stop-color="rgba(145,155,180,0.85)"/>
                </linearGradient>
            </defs>
            <g>
                <animateTransform attributeName="transform" type="translate" values="0,0;2,0;0,0" dur="7s" repeatCount="indefinite"/>
                <ellipse cx="50" cy="30" rx="28" ry="14" fill="url(#slCloudGrad)"/>
                <ellipse cx="40" cy="24" rx="16" ry="12" fill="rgba(175,185,205,0.9)"/>
                <ellipse cx="60" cy="26" rx="14" ry="11" fill="rgba(165,175,195,0.9)"/>
            </g>
            ${[{x:38,d:0},{x:55,d:0.6}].map(drop =>
                `<line x1="${drop.x}" y1="50" x2="${drop.x - 2}" y2="60" stroke="rgba(80,150,255,0.7)" stroke-width="2" stroke-linecap="round">
                    <animate attributeName="y1" values="48;80;48" dur="1.2s" begin="${drop.d}s" repeatCount="indefinite"/>
                    <animate attributeName="y2" values="56;88;56" dur="1.2s" begin="${drop.d}s" repeatCount="indefinite"/>
                    <animate attributeName="opacity" values="0;0.8;0" dur="1.2s" begin="${drop.d}s" repeatCount="indefinite"/>
                </line>`
            ).join('')}
            ${[{x:46,d:0.3},{x:62,d:1.0}].map(flake =>
                `<circle cx="${flake.x}" cy="55" r="2.5" fill="rgba(200,220,255,0.8)">
                    <animate attributeName="cy" values="50;85;50" dur="1.8s" begin="${flake.d}s" repeatCount="indefinite"/>
                    <animate attributeName="opacity" values="0;0.8;0" dur="1.8s" begin="${flake.d}s" repeatCount="indefinite"/>
                </circle>`
            ).join('')}
        </svg>`;
    },

    _freezingRain(s) {
        return `<svg viewBox="0 0 100 100" width="${s}" height="${s}">
            <defs>
                <linearGradient id="frCloudGrad" x1="0%" y1="0%" x2="0%" y2="100%">
                    <stop offset="0%" stop-color="rgba(160,175,200,0.9)"/>
                    <stop offset="100%" stop-color="rgba(135,150,180,0.85)"/>
                </linearGradient>
            </defs>
            <g>
                <animateTransform attributeName="transform" type="translate" values="0,0;2,0;0,0" dur="7s" repeatCount="indefinite"/>
                <ellipse cx="50" cy="30" rx="28" ry="14" fill="url(#frCloudGrad)"/>
                <ellipse cx="40" cy="24" rx="16" ry="12" fill="rgba(170,185,210,0.9)"/>
                <ellipse cx="60" cy="26" rx="14" ry="11" fill="rgba(160,175,200,0.9)"/>
            </g>
            ${[{x:36,d:0},{x:48,d:0.4},{x:60,d:0.8}].map(drop =>
                `<line x1="${drop.x}" y1="50" x2="${drop.x - 2}" y2="60" stroke="rgba(120,200,255,0.7)" stroke-width="2" stroke-linecap="round">
                    <animate attributeName="y1" values="48;80;48" dur="1.2s" begin="${drop.d}s" repeatCount="indefinite"/>
                    <animate attributeName="y2" values="56;88;56" dur="1.2s" begin="${drop.d}s" repeatCount="indefinite"/>
                    <animate attributeName="opacity" values="0;0.8;0" dur="1.2s" begin="${drop.d}s" repeatCount="indefinite"/>
                </line>
                <circle cx="${drop.x - 1}" cy="82" r="3" fill="none" stroke="rgba(120,200,255,0.5)" stroke-width="1">
                    <animate attributeName="r" values="0;6;0" dur="1.2s" begin="${drop.d + 0.8}s" repeatCount="indefinite"/>
                    <animate attributeName="opacity" values="0;0.6;0" dur="1.2s" begin="${drop.d + 0.8}s" repeatCount="indefinite"/>
                </circle>`
            ).join('')}
        </svg>`;
    },

    _thunderstorm(s) {
        return `<svg viewBox="0 0 100 100" width="${s}" height="${s}">
            <defs>
                <linearGradient id="tsCloudGrad" x1="0%" y1="0%" x2="0%" y2="100%">
                    <stop offset="0%" stop-color="rgba(120,130,160,0.95)"/>
                    <stop offset="100%" stop-color="rgba(80,90,120,0.9)"/>
                </linearGradient>
            </defs>
            <g>
                <animateTransform attributeName="transform" type="translate" values="0,0;2,0;0,0" dur="6s" repeatCount="indefinite"/>
                <ellipse cx="50" cy="28" rx="32" ry="16" fill="url(#tsCloudGrad)"/>
                <ellipse cx="36" cy="20" rx="18" ry="14" fill="rgba(130,140,170,0.95)"/>
                <ellipse cx="64" cy="22" rx="16" ry="13" fill="rgba(110,120,155,0.95)"/>
            </g>
            <polygon points="48,42 42,62 50,58 45,80 58,52 50,56" fill="#FFD54F">
                <animate attributeName="opacity" values="0;1;1;0;0;0;0;1;0" dur="3s" repeatCount="indefinite"/>
            </polygon>
            ${[{x:35,d:0.2},{x:62,d:0.7}].map(drop =>
                `<line x1="${drop.x}" y1="50" x2="${drop.x - 3}" y2="62" stroke="rgba(80,150,255,0.7)" stroke-width="2" stroke-linecap="round">
                    <animate attributeName="y1" values="48;82;48" dur="1.1s" begin="${drop.d}s" repeatCount="indefinite"/>
                    <animate attributeName="y2" values="56;90;56" dur="1.1s" begin="${drop.d}s" repeatCount="indefinite"/>
                    <animate attributeName="opacity" values="0;0.7;0" dur="1.1s" begin="${drop.d}s" repeatCount="indefinite"/>
                </line>`
            ).join('')}
        </svg>`;
    },

    _heavyThunderstorm(s) {
        return `<svg viewBox="0 0 100 100" width="${s}" height="${s}">
            <defs>
                <linearGradient id="htsCloudGrad" x1="0%" y1="0%" x2="0%" y2="100%">
                    <stop offset="0%" stop-color="rgba(90,100,135,0.95)"/>
                    <stop offset="100%" stop-color="rgba(60,70,100,0.9)"/>
                </linearGradient>
            </defs>
            <g>
                <ellipse cx="50" cy="24" rx="34" ry="17" fill="url(#htsCloudGrad)"/>
                <ellipse cx="34" cy="16" rx="19" ry="14" fill="rgba(100,110,145,0.95)"/>
                <ellipse cx="66" cy="18" rx="17" ry="13" fill="rgba(85,95,130,0.95)"/>
            </g>
            <polygon points="44,38 36,60 46,55 40,80 56,48 46,54" fill="#FFD54F">
                <animate attributeName="opacity" values="0;1;0;0;1;1;0;0;0;1;0" dur="2s" repeatCount="indefinite"/>
            </polygon>
            <polygon points="58,40 52,55 58,52 54,70 64,48 58,51" fill="#FFF176">
                <animate attributeName="opacity" values="0;0;1;0;0;0;1;0;1;0;0" dur="2.5s" repeatCount="indefinite"/>
            </polygon>
            ${[{x:30,d:0},{x:42,d:0.2},{x:54,d:0.5},{x:66,d:0.3},{x:48,d:0.7}].map(drop =>
                `<line x1="${drop.x}" y1="46" x2="${drop.x - 4}" y2="60" stroke="rgba(60,130,255,0.8)" stroke-width="2.5" stroke-linecap="round">
                    <animate attributeName="y1" values="44;84;44" dur="0.8s" begin="${drop.d}s" repeatCount="indefinite"/>
                    <animate attributeName="y2" values="54;94;54" dur="0.8s" begin="${drop.d}s" repeatCount="indefinite"/>
                    <animate attributeName="opacity" values="0;0.85;0" dur="0.8s" begin="${drop.d}s" repeatCount="indefinite"/>
                </line>`
            ).join('')}
        </svg>`;
    },

    _wind(s) {
        return `<svg viewBox="0 0 100 100" width="${s}" height="${s}">
            ${[{y:35,len:50,d:0},{y:50,len:40,d:0.5},{y:65,len:55,d:1}].map(line =>
                `<path d="M${25} ${line.y} Q${25 + line.len * 0.5} ${line.y - 8} ${25 + line.len} ${line.y}" fill="none" stroke="rgba(160,185,220,0.7)" stroke-width="3" stroke-linecap="round">
                    <animate attributeName="d" values="M${25} ${line.y} Q${25 + line.len * 0.5} ${line.y - 8} ${25 + line.len} ${line.y};M${25} ${line.y} Q${25 + line.len * 0.5} ${line.y + 5} ${25 + line.len} ${line.y};M${25} ${line.y} Q${25 + line.len * 0.5} ${line.y - 8} ${25 + line.len} ${line.y}" dur="${2 + line.d}s" repeatCount="indefinite"/>
                    <animate attributeName="opacity" values="0.4;0.8;0.4" dur="${3 + line.d}s" repeatCount="indefinite"/>
                </path>`
            ).join('')}
        </svg>`;
    },

    _hail(s) {
        return `<svg viewBox="0 0 100 100" width="${s}" height="${s}">
            <defs>
                <linearGradient id="hailCloudGrad" x1="0%" y1="0%" x2="0%" y2="100%">
                    <stop offset="0%" stop-color="rgba(140,150,180,0.95)"/>
                    <stop offset="100%" stop-color="rgba(100,110,145,0.9)"/>
                </linearGradient>
                <radialGradient id="hailStone" cx="40%" cy="35%">
                    <stop offset="0%" stop-color="rgba(220,235,255,0.9)"/>
                    <stop offset="100%" stop-color="rgba(180,200,230,0.7)"/>
                </radialGradient>
            </defs>
            <g>
                <ellipse cx="50" cy="28" rx="30" ry="15" fill="url(#hailCloudGrad)"/>
                <ellipse cx="38" cy="20" rx="17" ry="13" fill="rgba(150,160,190,0.95)"/>
                <ellipse cx="62" cy="22" rx="15" ry="12" fill="rgba(130,140,170,0.95)"/>
            </g>
            ${[{x:36,d:0},{x:50,d:0.4},{x:64,d:0.8},{x:42,d:1.2},{x:56,d:0.6}].map(stone =>
                `<circle cx="${stone.x}" cy="55" r="3.5" fill="url(#hailStone)" stroke="rgba(180,200,230,0.5)" stroke-width="0.5">
                    <animate attributeName="cy" values="48;85;48" dur="1s" begin="${stone.d}s" repeatCount="indefinite"/>
                    <animate attributeName="opacity" values="0;0.9;0" dur="1s" begin="${stone.d}s" repeatCount="indefinite"/>
                </circle>`
            ).join('')}
        </svg>`;
    }
};
