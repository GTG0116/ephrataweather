// ============================================
// ANIMATED WEATHER ICONS (SVG-based)
// ============================================

const WeatherIcons = {
    _uid: 0,
    _id() { return 'wi' + (++this._uid); },

    // Generate an animated SVG icon by condition code
    get(conditionCode, size = 64) {
        const s = size;
        const fn = this._iconMap[conditionCode] || this._iconMap['default'];
        return fn(s);
    },

    // Map Google Weather API condition codes to icon generators
    _iconMap: {
        'CLEAR':               (s) => WeatherIcons._sunny(s),
        'MOSTLY_CLEAR':        (s) => WeatherIcons._sunny(s),
        'SUNNY':               (s) => WeatherIcons._sunny(s),
        'PARTLY_CLOUDY':       (s) => WeatherIcons._partlyCloudy(s),
        'MOSTLY_CLOUDY':       (s) => WeatherIcons._cloudy(s),
        'CLOUDY':              (s) => WeatherIcons._overcast(s),
        'OVERCAST':            (s) => WeatherIcons._overcast(s),
        'FOG':                 (s) => WeatherIcons._fog(s),
        'LIGHT_FOG':           (s) => WeatherIcons._fog(s),
        'DRIZZLE':             (s) => WeatherIcons._lightRain(s),
        'LIGHT_RAIN':          (s) => WeatherIcons._lightRain(s),
        'RAIN':                (s) => WeatherIcons._rain(s),
        'HEAVY_RAIN':          (s) => WeatherIcons._heavyRain(s),
        'SNOW':                (s) => WeatherIcons._snow(s),
        'LIGHT_SNOW':          (s) => WeatherIcons._lightSnow(s),
        'HEAVY_SNOW':          (s) => WeatherIcons._heavySnow(s),
        'FLURRIES':            (s) => WeatherIcons._lightSnow(s),
        'ICE_PELLETS':         (s) => WeatherIcons._sleet(s),
        'SLEET':               (s) => WeatherIcons._sleet(s),
        'FREEZING_RAIN':       (s) => WeatherIcons._freezingRain(s),
        'FREEZING_DRIZZLE':    (s) => WeatherIcons._freezingRain(s),
        'THUNDERSTORM':        (s) => WeatherIcons._thunderstorm(s),
        'THUNDERSTORMS':       (s) => WeatherIcons._thunderstorm(s),
        'LIGHT_THUNDERSTORM':  (s) => WeatherIcons._thunderstorm(s),
        'HEAVY_THUNDERSTORM':  (s) => WeatherIcons._heavyThunderstorm(s),
        'WIND':                (s) => WeatherIcons._wind(s),
        'WINDY':               (s) => WeatherIcons._wind(s),
        'HAIL':                (s) => WeatherIcons._hail(s),
        'MIXED':               (s) => WeatherIcons._sleet(s),
        'default':             (s) => WeatherIcons._partlyCloudy(s)
    },

    // Resolve text-based conditions - uses 100% sizing so SVGs fill their containers
    fromText(text, isNight = false) {
        const sz = '100%';
        if (!text) return this.get('default', sz);
        const t = text.toUpperCase().replace(/\s+/g, '_');

        // Try direct match first (for non-clear conditions, night doesn't change icon)
        if (this._iconMap[t] && !['CLEAR','MOSTLY_CLEAR','SUNNY','PARTLY_CLOUDY'].includes(t)) {
            return this.get(t, sz);
        }

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
        if (t.includes('CLOUDY') && t.includes('PART')) {
            return isNight ? this._partlyCloudyNight(sz) : this.get('PARTLY_CLOUDY', sz);
        }
        if (t.includes('CLOUD')) return this.get('CLOUDY', sz);
        if (t.includes('WIND')) return this.get('WIND', sz);
        if (t.includes('CLEAR') || t.includes('SUNNY') || t.includes('FAIR') ||
            t === 'CLEAR' || t === 'MOSTLY_CLEAR' || t === 'SUNNY') {
            return isNight ? this._clearNight(sz) : this.get('CLEAR', sz);
        }
        if (t === 'PARTLY_CLOUDY') {
            return isNight ? this._partlyCloudyNight(sz) : this.get('PARTLY_CLOUDY', sz);
        }
        return this.get('default', sz);
    },

    // ---- SVG snowflake path (6-armed) ----
    _snowflakePath(cx, cy, r) {
        let d = '';
        for (let i = 0; i < 6; i++) {
            const angle = (i * 60) * Math.PI / 180;
            const x2 = cx + Math.cos(angle) * r;
            const y2 = cy + Math.sin(angle) * r;
            d += `M${cx},${cy}L${x2.toFixed(1)},${y2.toFixed(1)}`;
            // Small branches
            const br = r * 0.45;
            const ba1 = angle + 0.5;
            const ba2 = angle - 0.5;
            const mx = cx + Math.cos(angle) * r * 0.6;
            const my = cy + Math.sin(angle) * r * 0.6;
            d += `M${mx.toFixed(1)},${my.toFixed(1)}L${(mx + Math.cos(ba1) * br).toFixed(1)},${(my + Math.sin(ba1) * br).toFixed(1)}`;
            d += `M${mx.toFixed(1)},${my.toFixed(1)}L${(mx + Math.cos(ba2) * br).toFixed(1)},${(my + Math.sin(ba2) * br).toFixed(1)}`;
        }
        return d;
    },

    // ---- Individual icon SVG generators ----

    _sunny(s) {
        const id = this._id();
        return `<svg viewBox="0 0 100 100" width="${s}" height="${s}">
            <defs>
                <radialGradient id="${id}sg" cx="50%" cy="50%">
                    <stop offset="0%" stop-color="#FFEB3B"/>
                    <stop offset="100%" stop-color="#FFB300"/>
                </radialGradient>
            </defs>
            <g>
                <animateTransform attributeName="transform" type="rotate" from="0 50 50" to="360 50 50" dur="60s" repeatCount="indefinite"/>
                ${[0,45,90,135,180,225,270,315].map(a =>
                    `<line x1="50" y1="18" x2="50" y2="8" stroke="#FFCA28" stroke-width="4" stroke-linecap="round" transform="rotate(${a} 50 50)"/>`
                ).join('')}
            </g>
            <circle cx="50" cy="50" r="22" fill="url(#${id}sg)">
                <animate attributeName="r" values="22;24;22" dur="6s" repeatCount="indefinite"/>
            </circle>
        </svg>`;
    },

    _clearNight(s) {
        const id = this._id();
        return `<svg viewBox="0 0 100 100" width="${s}" height="${s}">
            <defs>
                <radialGradient id="${id}mg" cx="38%" cy="38%">
                    <stop offset="0%" stop-color="#FFF9C4"/>
                    <stop offset="70%" stop-color="#E8EAF6"/>
                    <stop offset="100%" stop-color="#B0BEC5"/>
                </radialGradient>
                <mask id="${id}mm">
                    <rect width="100" height="100" fill="white"/>
                    <circle cx="57" cy="37" r="17" fill="black"/>
                </mask>
            </defs>
            <!-- Crescent moon using mask (no background-color hack) -->
            <circle cx="46" cy="46" r="22" fill="url(#${id}mg)" mask="url(#${id}mm)"/>
            ${[{x:74,y:22,d:0.3},{x:82,y:48,d:0.7},{x:68,y:72,d:1.1},{x:28,y:20,d:1.5},{x:18,y:66,d:0.1}].map(star =>
                `<circle cx="${star.x}" cy="${star.y}" r="1.2" fill="#FFF9C4">
                    <animate attributeName="opacity" values="0.3;1;0.3" dur="2s" begin="${star.d}s" repeatCount="indefinite"/>
                </circle>`
            ).join('')}
        </svg>`;
    },

    _partlyCloudy(s) {
        const id = this._id();
        return `<svg viewBox="0 0 100 100" width="${s}" height="${s}">
            <defs>
                <radialGradient id="${id}sg" cx="50%" cy="50%" r="50%">
                    <stop offset="0%" stop-color="#FFE066"/>
                    <stop offset="100%" stop-color="#FFB300"/>
                </radialGradient>
                <linearGradient id="${id}cg" x1="0%" y1="0%" x2="0%" y2="100%">
                    <stop offset="0%" stop-color="rgba(255,255,255,0.95)"/>
                    <stop offset="100%" stop-color="rgba(220,225,230,0.9)"/>
                </linearGradient>
            </defs>
            <!-- Sun behind cloud -->
            <g transform="translate(58,30)">
                <g>
                    <animateTransform attributeName="transform" type="rotate" from="0 0 0" to="360 0 0" dur="30s" repeatCount="indefinite"/>
                    ${[0,60,120,180,240,300].map(a =>
                        `<line x1="0" y1="-22" x2="0" y2="-28" stroke="#FFD54F" stroke-width="2.5" stroke-linecap="round" transform="rotate(${a})">
                            <animate attributeName="opacity" values="0.4;0.9;0.4" dur="3s" begin="${a/360*3}s" repeatCount="indefinite"/>
                        </line>`
                    ).join('')}
                </g>
                <circle r="16" fill="url(#${id}sg)">
                    <animate attributeName="r" values="16;17;16" dur="4s" repeatCount="indefinite"/>
                </circle>
            </g>
            <!-- Cloud in front -->
            <g>
                <animateTransform attributeName="transform" type="translate" values="0,0;2,0;0,0" dur="6s" repeatCount="indefinite"/>
                <ellipse cx="55" cy="62" rx="30" ry="14" fill="url(#${id}cg)"/>
                <ellipse cx="42" cy="55" rx="18" ry="14" fill="rgba(255,255,255,0.95)"/>
                <ellipse cx="65" cy="56" rx="16" ry="12" fill="rgba(245,245,245,0.95)"/>
            </g>
        </svg>`;
    },

    _partlyCloudyNight(s) {
        const id = this._id();
        return `<svg viewBox="0 0 100 100" width="${s}" height="${s}">
            <defs>
                <radialGradient id="${id}mg" cx="38%" cy="38%">
                    <stop offset="0%" stop-color="#FFF9C4"/>
                    <stop offset="70%" stop-color="#E8EAF6"/>
                    <stop offset="100%" stop-color="#B0BEC5"/>
                </radialGradient>
                <mask id="${id}mm">
                    <rect width="100" height="100" fill="white"/>
                    <circle cx="72" cy="26" r="13" fill="black"/>
                </mask>
                <linearGradient id="${id}cg" x1="0%" y1="0%" x2="0%" y2="100%">
                    <stop offset="0%" stop-color="rgba(200,210,230,0.95)"/>
                    <stop offset="100%" stop-color="rgba(160,175,200,0.9)"/>
                </linearGradient>
            </defs>
            <!-- Crescent moon behind cloud -->
            <circle cx="62" cy="32" r="18" fill="url(#${id}mg)" mask="url(#${id}mm)"/>
            ${[{x:78,y:16,d:0.4},{x:85,y:40,d:1.0}].map(star =>
                `<circle cx="${star.x}" cy="${star.y}" r="1" fill="#FFF9C4">
                    <animate attributeName="opacity" values="0.2;0.9;0.2" dur="2s" begin="${star.d}s" repeatCount="indefinite"/>
                </circle>`
            ).join('')}
            <!-- Cloud in front -->
            <g>
                <animateTransform attributeName="transform" type="translate" values="0,0;2,0;0,0" dur="8s" repeatCount="indefinite"/>
                <ellipse cx="50" cy="65" rx="32" ry="15" fill="url(#${id}cg)"/>
                <ellipse cx="38" cy="57" rx="19" ry="14" fill="rgba(190,200,220,0.95)"/>
                <ellipse cx="62" cy="59" rx="17" ry="13" fill="rgba(180,190,215,0.95)"/>
            </g>
        </svg>`;
    },

    _cloudy(s) {
        const id = this._id();
        return `<svg viewBox="0 0 100 100" width="${s}" height="${s}">
            <defs>
                <linearGradient id="${id}cg" x1="0%" y1="0%" x2="0%" y2="100%">
                    <stop offset="0%" stop-color="rgba(220,225,230,0.95)"/>
                    <stop offset="100%" stop-color="rgba(180,190,200,0.9)"/>
                </linearGradient>
            </defs>
            <g>
                <animateTransform attributeName="transform" type="translate" values="0,0;3,0;0,0" dur="12s" repeatCount="indefinite"/>
                <ellipse cx="50" cy="55" rx="34" ry="18" fill="url(#${id}cg)"/>
                <ellipse cx="35" cy="48" rx="20" ry="15" fill="rgba(240,240,245,0.95)"/>
                <ellipse cx="65" cy="52" rx="18" ry="13" fill="rgba(230,235,240,0.92)"/>
            </g>
        </svg>`;
    },

    _overcast(s) {
        const id = this._id();
        return `<svg viewBox="0 0 100 100" width="${s}" height="${s}">
            <defs>
                <linearGradient id="${id}og" x1="0%" y1="0%" x2="0%" y2="100%">
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
                <ellipse cx="58" cy="55" rx="30" ry="15" fill="url(#${id}og)"/>
                <ellipse cx="48" cy="47" rx="18" ry="14" fill="rgba(195,205,215,0.95)"/>
                <ellipse cx="68" cy="49" rx="15" ry="12" fill="rgba(185,195,210,0.9)"/>
            </g>
        </svg>`;
    },

    _fog(s) {
        const id = this._id();
        return `<svg viewBox="0 0 100 100" width="${s}" height="${s}">
            <defs>
                <linearGradient id="${id}cg" x1="0%" y1="0%" x2="0%" y2="100%">
                    <stop offset="0%" stop-color="rgba(225,230,240,0.97)"/>
                    <stop offset="100%" stop-color="rgba(190,200,215,0.92)"/>
                </linearGradient>
            </defs>
            <!-- Clear cloud body -->
            <g>
                <animateTransform attributeName="transform" type="translate" values="0,0;2,0;0,0" dur="10s" repeatCount="indefinite"/>
                <ellipse cx="50" cy="38" rx="28" ry="13" fill="url(#${id}cg)"/>
                <ellipse cx="36" cy="32" rx="17" ry="13" fill="rgba(232,237,245,0.97)"/>
                <ellipse cx="65" cy="34" rx="15" ry="12" fill="rgba(225,232,242,0.94)"/>
            </g>
            <!-- Fog lines -->
            <line x1="16" y1="60" x2="84" y2="60" stroke="rgba(175,188,210,0.80)" stroke-width="4.5" stroke-linecap="round"/>
            <line x1="22" y1="70" x2="78" y2="70" stroke="rgba(175,188,210,0.68)" stroke-width="4.5" stroke-linecap="round"/>
            <line x1="16" y1="80" x2="82" y2="80" stroke="rgba(175,188,210,0.55)" stroke-width="4.5" stroke-linecap="round"/>
            <line x1="22" y1="90" x2="76" y2="90" stroke="rgba(175,188,210,0.42)" stroke-width="4.5" stroke-linecap="round"/>
        </svg>`;
    },

    // --- Rain icons: cloud with vertical drops falling DOWN only ---

    _lightRain(s) {
        const id = this._id();
        return `<svg viewBox="0 0 100 100" width="${s}" height="${s}">
            <defs>
                <linearGradient id="${id}cg" x1="0%" y1="0%" x2="0%" y2="100%">
                    <stop offset="0%" stop-color="rgba(180,190,205,0.9)"/>
                    <stop offset="100%" stop-color="rgba(150,160,180,0.85)"/>
                </linearGradient>
            </defs>
            <g>
                <animateTransform attributeName="transform" type="translate" values="0,0;2,0;0,0" dur="7s" repeatCount="indefinite"/>
                <ellipse cx="50" cy="30" rx="28" ry="14" fill="url(#${id}cg)"/>
                <ellipse cx="40" cy="24" rx="16" ry="12" fill="rgba(185,195,210,0.9)"/>
                <ellipse cx="60" cy="26" rx="14" ry="11" fill="rgba(175,185,200,0.9)"/>
            </g>
            ${[{x:40,d:0},{x:56,d:0.8}].map(drop =>
                `<line x1="${drop.x}" y1="55" x2="${drop.x}" y2="70" stroke="rgba(80,160,255,0.7)" stroke-width="2" stroke-linecap="round">
                    <animate attributeName="y1" values="55;78" dur="1.2s" begin="${drop.d}s" repeatCount="indefinite"/>
                    <animate attributeName="y2" values="70;93" dur="1.2s" begin="${drop.d}s" repeatCount="indefinite"/>
                    <animate attributeName="opacity" values="0.8;0" dur="1.2s" begin="${drop.d}s" repeatCount="indefinite"/>
                </line>`
            ).join('')}
        </svg>`;
    },

    _rain(s) {
        const id = this._id();
        return `<svg viewBox="0 0 100 100" width="${s}" height="${s}">
            <defs>
                <linearGradient id="${id}cg" x1="0%" y1="0%" x2="0%" y2="100%">
                    <stop offset="0%" stop-color="rgba(160,170,190,0.9)"/>
                    <stop offset="100%" stop-color="rgba(130,140,165,0.85)"/>
                </linearGradient>
            </defs>
            <g>
                <animateTransform attributeName="transform" type="translate" values="0,0;2,0;0,0" dur="7s" repeatCount="indefinite"/>
                <ellipse cx="50" cy="30" rx="28" ry="14" fill="url(#${id}cg)"/>
                <ellipse cx="40" cy="24" rx="16" ry="12" fill="rgba(185,195,210,0.9)"/>
                <ellipse cx="60" cy="26" rx="14" ry="11" fill="rgba(175,185,200,0.9)"/>
            </g>
            ${[{x:38,d:0},{x:50,d:0.5},{x:62,d:1.0}].map(drop =>
                `<line x1="${drop.x}" y1="46" x2="${drop.x}" y2="56" stroke="rgba(80,160,255,0.7)" stroke-width="2" stroke-linecap="round">
                    <animate attributeName="y1" values="46;78" dur="1.4s" begin="${drop.d}s" repeatCount="indefinite"/>
                    <animate attributeName="y2" values="56;88" dur="1.4s" begin="${drop.d}s" repeatCount="indefinite"/>
                    <animate attributeName="opacity" values="0.8;0" dur="1.4s" begin="${drop.d}s" repeatCount="indefinite"/>
                </line>`
            ).join('')}
        </svg>`;
    },

    _heavyRain(s) {
        const id = this._id();
        return `<svg viewBox="0 0 100 100" width="${s}" height="${s}">
            <defs>
                <linearGradient id="${id}cg" x1="0%" y1="0%" x2="0%" y2="100%">
                    <stop offset="0%" stop-color="rgba(130,140,165,0.95)"/>
                    <stop offset="100%" stop-color="rgba(100,110,140,0.9)"/>
                </linearGradient>
            </defs>
            <g>
                <animateTransform attributeName="transform" type="translate" values="0,0;2,0;0,0" dur="6s" repeatCount="indefinite"/>
                <ellipse cx="50" cy="24" rx="32" ry="16" fill="url(#${id}cg)"/>
                <ellipse cx="36" cy="16" rx="18" ry="14" fill="rgba(140,150,175,0.95)"/>
                <ellipse cx="64" cy="18" rx="16" ry="13" fill="rgba(125,135,160,0.95)"/>
            </g>
            ${[{x:31,d:0},{x:43,d:0.25},{x:55,d:0.5},{x:67,d:0.12},{x:37,d:0.38}].map(drop =>
                `<line x1="${drop.x}" y1="40" x2="${drop.x}" y2="50" stroke="rgba(40,120,255,0.85)" stroke-width="2.2" stroke-linecap="round">
                    <animate attributeName="y1" values="40;82" dur="0.75s" begin="${drop.d}s" repeatCount="indefinite"/>
                    <animate attributeName="y2" values="50;92" dur="0.75s" begin="${drop.d}s" repeatCount="indefinite"/>
                    <animate attributeName="opacity" values="0.95;0" dur="0.75s" begin="${drop.d}s" repeatCount="indefinite"/>
                </line>`
            ).join('')}
        </svg>`;
    },

    // --- Snow icons: SVG-drawn snowflakes ---

    _snow(s) {
        const id = this._id();
        const flakes = [{x:38,y:48,r:6,d:0},{x:54,y:50,r:5,d:0.7},{x:64,y:46,r:5.5,d:1.4},{x:46,y:52,r:4.5,d:2.1}];
        return `<svg viewBox="0 0 100 100" width="${s}" height="${s}">
            <defs>
                <linearGradient id="${id}cg" x1="0%" y1="0%" x2="0%" y2="100%">
                    <stop offset="0%" stop-color="rgba(220,230,240,0.95)"/>
                    <stop offset="100%" stop-color="rgba(190,200,215,0.9)"/>
                </linearGradient>
            </defs>
            <g>
                <animateTransform attributeName="transform" type="translate" values="0,0;2,0;0,0" dur="8s" repeatCount="indefinite"/>
                <ellipse cx="50" cy="26" rx="28" ry="14" fill="url(#${id}cg)"/>
                <ellipse cx="40" cy="20" rx="16" ry="12" fill="rgba(195,205,220,0.9)"/>
                <ellipse cx="60" cy="22" rx="14" ry="11" fill="rgba(185,195,210,0.9)"/>
            </g>
            ${flakes.map(f => `
                <g>
                    <path d="${this._snowflakePath(f.x, f.y, f.r)}" fill="none" stroke="#E3F2FD" stroke-width="1.3" stroke-linecap="round">
                        <animateTransform attributeName="transform" type="translate" values="0,0;0,100" dur="4s" begin="${f.d}s" repeatCount="indefinite"/>
                        <animate attributeName="opacity" values="0;1;0" dur="4s" begin="${f.d}s" repeatCount="indefinite"/>
                    </path>
                </g>
            `).join('')}
        </svg>`;
    },

    _lightSnow(s) {
        const id = this._id();
        const flakes = [{x:42,y:50,r:5,d:0},{x:58,y:48,r:4.5,d:1.2}];
        return `<svg viewBox="0 0 100 100" width="${s}" height="${s}">
            <defs>
                <linearGradient id="${id}cg" x1="0%" y1="0%" x2="0%" y2="100%">
                    <stop offset="0%" stop-color="rgba(230,235,245,0.95)"/>
                    <stop offset="100%" stop-color="rgba(200,210,225,0.9)"/>
                </linearGradient>
            </defs>
            <g>
                <animateTransform attributeName="transform" type="translate" values="0,0;2,0;0,0" dur="8s" repeatCount="indefinite"/>
                <ellipse cx="50" cy="30" rx="26" ry="13" fill="url(#${id}cg)"/>
                <ellipse cx="42" cy="24" rx="14" ry="11" fill="rgba(205,212,225,0.9)"/>
                <ellipse cx="58" cy="26" rx="13" ry="10" fill="rgba(195,205,218,0.9)"/>
            </g>
            ${flakes.map(f => `
                <g>
                    <path d="${this._snowflakePath(f.x, f.y, f.r)}" fill="none" stroke="#E3F2FD" stroke-width="1.2" stroke-linecap="round">
                        <animateTransform attributeName="transform" type="translate" values="0,0;0,90" dur="4.5s" begin="${f.d}s" repeatCount="indefinite"/>
                        <animate attributeName="opacity" values="0;0.9;0" dur="4.5s" begin="${f.d}s" repeatCount="indefinite"/>
                    </path>
                </g>
            `).join('')}
        </svg>`;
    },

    _heavySnow(s) {
        const id = this._id();
        const flakes = [
            {x:32,y:44,r:6,d:0}, {x:42,y:46,r:5.5,d:0.4}, {x:52,y:42,r:6,d:0.8},
            {x:62,y:44,r:5,d:0.3}, {x:48,y:48,r:5,d:1.2}, {x:38,y:50,r:4.5,d:1.6}
        ];
        return `<svg viewBox="0 0 100 100" width="${s}" height="${s}">
            <defs>
                <linearGradient id="${id}cg" x1="0%" y1="0%" x2="0%" y2="100%">
                    <stop offset="0%" stop-color="rgba(200,210,225,0.95)"/>
                    <stop offset="100%" stop-color="rgba(170,180,200,0.9)"/>
                </linearGradient>
            </defs>
            <g>
                <animateTransform attributeName="transform" type="translate" values="0,0;2,0;0,0" dur="7s" repeatCount="indefinite"/>
                <ellipse cx="50" cy="22" rx="30" ry="15" fill="url(#${id}cg)"/>
                <ellipse cx="38" cy="14" rx="17" ry="13" fill="rgba(175,185,205,0.95)"/>
                <ellipse cx="62" cy="16" rx="15" ry="12" fill="rgba(160,170,195,0.95)"/>
            </g>
            ${flakes.map(f => `
                <g>
                    <path d="${this._snowflakePath(f.x, f.y, f.r)}" fill="none" stroke="#E3F2FD" stroke-width="1.4" stroke-linecap="round">
                        <animateTransform attributeName="transform" type="translate" values="0,0;0,110" dur="3.5s" begin="${f.d}s" repeatCount="indefinite"/>
                        <animate attributeName="opacity" values="0;1;0" dur="3.5s" begin="${f.d}s" repeatCount="indefinite"/>
                    </path>
                </g>
            `).join('')}
        </svg>`;
    },

    _sleet(s) {
        const id = this._id();
        return `<svg viewBox="0 0 100 100" width="${s}" height="${s}">
            <defs>
                <linearGradient id="${id}cg" x1="0%" y1="0%" x2="0%" y2="100%">
                    <stop offset="0%" stop-color="rgba(200,210,225,0.9)"/>
                    <stop offset="100%" stop-color="rgba(170,185,205,0.85)"/>
                </linearGradient>
            </defs>
            <g>
                <animateTransform attributeName="transform" type="translate" values="0,0;2,0;0,0" dur="7s" repeatCount="indefinite"/>
                <ellipse cx="50" cy="30" rx="28" ry="14" fill="url(#${id}cg)"/>
                <ellipse cx="40" cy="24" rx="16" ry="12" fill="rgba(175,185,205,0.9)"/>
                <ellipse cx="60" cy="26" rx="14" ry="11" fill="rgba(165,175,195,0.9)"/>
            </g>
            ${[{x:38,d:0},{x:55,d:0.6}].map(drop =>
                `<line x1="${drop.x}" y1="46" x2="${drop.x}" y2="56" stroke="rgba(150,200,255,0.8)" stroke-width="2" stroke-linecap="round">
                    <animate attributeName="y1" values="46;78" dur="1.2s" begin="${drop.d}s" repeatCount="indefinite"/>
                    <animate attributeName="y2" values="56;88" dur="1.2s" begin="${drop.d}s" repeatCount="indefinite"/>
                    <animate attributeName="opacity" values="0.8;0" dur="1.2s" begin="${drop.d}s" repeatCount="indefinite"/>
                </line>`
            ).join('')}
            ${[{x:46,d:0.3},{x:62,d:1.0}].map(f => `
                <g>
                    <path d="${this._snowflakePath(f.x, 50, 4)}" fill="none" stroke="#E3F2FD" stroke-width="1" stroke-linecap="round">
                        <animateTransform attributeName="transform" type="translate" values="0,0;0,80" dur="2s" begin="${f.d}s" repeatCount="indefinite"/>
                        <animate attributeName="opacity" values="0;0.8;0" dur="2s" begin="${f.d}s" repeatCount="indefinite"/>
                    </path>
                </g>
            `).join('')}
        </svg>`;
    },

    _freezingRain(s) {
        const id = this._id();
        return `<svg viewBox="0 0 100 100" width="${s}" height="${s}">
            <defs>
                <linearGradient id="${id}cg" x1="0%" y1="0%" x2="0%" y2="100%">
                    <stop offset="0%" stop-color="rgba(170,185,210,0.9)"/>
                    <stop offset="100%" stop-color="rgba(140,160,190,0.85)"/>
                </linearGradient>
            </defs>
            <g>
                <animateTransform attributeName="transform" type="translate" values="0,0;2,0;0,0" dur="7s" repeatCount="indefinite"/>
                <ellipse cx="50" cy="30" rx="28" ry="14" fill="url(#${id}cg)"/>
                <ellipse cx="40" cy="24" rx="16" ry="12" fill="rgba(170,185,210,0.9)"/>
                <ellipse cx="60" cy="26" rx="14" ry="11" fill="rgba(160,175,200,0.9)"/>
            </g>
            ${[{x:36,d:0},{x:48,d:0.4},{x:60,d:0.8}].map(drop =>
                `<line x1="${drop.x}" y1="46" x2="${drop.x - 2}" y2="66" stroke="rgba(120,200,255,0.7)" stroke-width="2" stroke-linecap="round">
                    <animate attributeName="y1" values="46;78" dur="1.2s" begin="${drop.d}s" repeatCount="indefinite"/>
                    <animate attributeName="y2" values="56;88" dur="1.2s" begin="${drop.d}s" repeatCount="indefinite"/>
                    <animate attributeName="opacity" values="0.8;0" dur="1.2s" begin="${drop.d}s" repeatCount="indefinite"/>
                </line>
                <circle cx="${drop.x}" cy="82" r="3" fill="none" stroke="rgba(120,200,255,0.5)" stroke-width="1">
                    <animate attributeName="r" values="0;6;0" dur="1.2s" begin="${drop.d + 0.8}s" repeatCount="indefinite"/>
                    <animate attributeName="opacity" values="0;0.6;0" dur="1.2s" begin="${drop.d + 0.8}s" repeatCount="indefinite"/>
                </circle>`
            ).join('')}
        </svg>`;
    },

    _thunderstorm(s) {
        const id = this._id();
        return `<svg viewBox="0 0 100 100" width="${s}" height="${s}">
            <defs>
                <linearGradient id="${id}cg" x1="0%" y1="0%" x2="0%" y2="100%">
                    <stop offset="0%" stop-color="rgba(120,130,160,0.95)"/>
                    <stop offset="100%" stop-color="rgba(80,90,120,0.9)"/>
                </linearGradient>
            </defs>
            <g>
                <animateTransform attributeName="transform" type="translate" values="0,0;2,0;0,0" dur="6s" repeatCount="indefinite"/>
                <ellipse cx="50" cy="28" rx="32" ry="16" fill="url(#${id}cg)"/>
                <ellipse cx="36" cy="20" rx="18" ry="14" fill="rgba(130,140,170,0.95)"/>
                <ellipse cx="64" cy="22" rx="16" ry="13" fill="rgba(110,120,155,0.95)"/>
            </g>
            <polygon points="48,42 42,62 50,58 45,80 58,52 50,56" fill="#FFD54F">
                <animate attributeName="opacity" values="0;1;1;0;0;0;0;1;0" dur="3s" repeatCount="indefinite"/>
            </polygon>
            ${[{x:35,d:0.2},{x:62,d:0.7}].map(drop =>
                `<line x1="${drop.x}" y1="46" x2="${drop.x}" y2="56" stroke="rgba(80,150,255,0.7)" stroke-width="2" stroke-linecap="round">
                    <animate attributeName="y1" values="46;80" dur="1.1s" begin="${drop.d}s" repeatCount="indefinite"/>
                    <animate attributeName="y2" values="56;90" dur="1.1s" begin="${drop.d}s" repeatCount="indefinite"/>
                    <animate attributeName="opacity" values="0.7;0" dur="1.1s" begin="${drop.d}s" repeatCount="indefinite"/>
                </line>`
            ).join('')}
        </svg>`;
    },

    _heavyThunderstorm(s) {
        const id = this._id();
        return `<svg viewBox="0 0 100 100" width="${s}" height="${s}">
            <defs>
                <linearGradient id="${id}cg" x1="0%" y1="0%" x2="0%" y2="100%">
                    <stop offset="0%" stop-color="rgba(90,100,135,0.95)"/>
                    <stop offset="100%" stop-color="rgba(60,70,100,0.9)"/>
                </linearGradient>
            </defs>
            <g>
                <ellipse cx="50" cy="24" rx="34" ry="17" fill="url(#${id}cg)"/>
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
                `<line x1="${drop.x}" y1="42" x2="${drop.x}" y2="52" stroke="rgba(60,130,255,0.8)" stroke-width="2.5" stroke-linecap="round">
                    <animate attributeName="y1" values="42;82" dur="0.8s" begin="${drop.d}s" repeatCount="indefinite"/>
                    <animate attributeName="y2" values="52;92" dur="0.8s" begin="${drop.d}s" repeatCount="indefinite"/>
                    <animate attributeName="opacity" values="0.85;0" dur="0.8s" begin="${drop.d}s" repeatCount="indefinite"/>
                </line>`
            ).join('')}
        </svg>`;
    },

    _wind(s) {
        const id = this._id();
        return `<svg viewBox="0 0 100 100" width="${s}" height="${s}">
            <defs>
                <linearGradient id="${id}wg" x1="0%" y1="0%" x2="100%" y2="0%">
                    <stop offset="0%" stop-color="rgba(150,200,255,0.4)"/>
                    <stop offset="100%" stop-color="rgba(100,180,255,0.1)"/>
                </linearGradient>
            </defs>
            ${[{y:35,len:60,d:0},{y:50,len:45,d:1.2},{y:65,len:70,d:0.6}].map(line =>
                `<path d="M${20} ${line.y} Q${20 + line.len * 0.4} ${line.y - 12} ${20 + line.len} ${line.y}" fill="none" stroke="url(#${id}wg)" stroke-width="6" stroke-linecap="round">
                    <animate attributeName="d" values="
                        M20 ${line.y} Q${20 + line.len * 0.4} ${line.y - 12} ${20 + line.len} ${line.y};
                        M20 ${line.y} Q${20 + line.len * 0.6} ${line.y + 8} ${20 + line.len} ${line.y};
                        M20 ${line.y} Q${20 + line.len * 0.4} ${line.y - 12} ${20 + line.len} ${line.y}"
                        dur="${2 + line.d}s" repeatCount="indefinite"/>
                    <animate attributeName="opacity" values="0.4;0.8;0.4" dur="${3 + line.d}s" repeatCount="indefinite"/>
                </path>`
            ).join('')}
        </svg>`;
    },

    _hail(s) {
        const id = this._id();
        return `<svg viewBox="0 0 100 100" width="${s}" height="${s}">
            <defs>
                <linearGradient id="${id}cg" x1="0%" y1="0%" x2="0%" y2="100%">
                    <stop offset="0%" stop-color="rgba(140,150,180,0.95)"/>
                    <stop offset="100%" stop-color="rgba(100,110,145,0.9)"/>
                </linearGradient>
                <radialGradient id="${id}hs" cx="40%" cy="35%">
                    <stop offset="0%" stop-color="rgba(220,235,255,0.9)"/>
                    <stop offset="100%" stop-color="rgba(180,200,230,0.7)"/>
                </radialGradient>
            </defs>
            <g>
                <ellipse cx="50" cy="28" rx="30" ry="15" fill="url(#${id}cg)"/>
                <ellipse cx="38" cy="20" rx="17" ry="13" fill="rgba(150,160,190,0.95)"/>
                <ellipse cx="62" cy="22" rx="15" ry="12" fill="rgba(130,140,170,0.95)"/>
            </g>
            ${[{x:36,d:0},{x:50,d:0.4},{x:64,d:0.8},{x:42,d:1.2},{x:56,d:0.6}].map(stone =>
                `<circle cx="${stone.x}" cy="48" r="3.5" fill="url(#${id}hs)" stroke="rgba(180,200,230,0.5)" stroke-width="0.5">
                    <animate attributeName="cy" values="48;88" dur="1s" begin="${stone.d}s" repeatCount="indefinite"/>
                    <animate attributeName="opacity" values="0.9;0" dur="1s" begin="${stone.d}s" repeatCount="indefinite"/>
                </circle>`
            ).join('')}
        </svg>`;
    }
};

// If you're using modules:
// export default WeatherIcons;

// If you're using plain <script> tags, just leave it like this — WeatherIcons will be global
