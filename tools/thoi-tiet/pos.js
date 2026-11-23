'use strict';
/**
 * pos.js - read the car's own position from the head unit's SOME/IP positioning service.
 *
 * BMW's head unit publishes its map-matched / dead-reckoned location (which still knows where the car is inside
 * an underground parking garage) and raw GNSS fixes on `de.bmw.infotainment.navigation.positioning.Positioning`
 * (`currentLocation` and `rawPositionData`), and raw GNSS broadcasts on `de.bmw.sensors.gnss.GnssPositioning`.
 *
 * Run as a child of thoi-tiet.js so a native binding issue can never affect forecasts or the phone page:
 *   node pos.js read     prints one JSON line per event:
 *     {"ev":"pos","lat":10.728,"lon":106.723,"city":"Hồ Chí Minh","district":"Quận 7","source":"nav"}
 *     {"ev":"note","text":"..."}
 * Node 8, no dependencies.
 */
const fs = require('fs');
const path = require('path');
const cp = require('child_process');

const CATALOG = process.env.TT_CATALOG || '/etc/oap/someip/someip-interfaces.json';
const SOMEIP = process.env.TT_SOMEIP || '/usr/lib/someip.node';
const APPMGMTS = (process.env.TT_APPMGMT ? [process.env.TT_APPMGMT] : []).concat([
    '/usr/lib/oap-mainapp/src/AppManagement/AppManagement.js',
    '/usr/lib/oap-mainapp21/src/AppManagement/AppManagement.js',
]);

/* ---------------- pure helpers (tested without the car) ---------------- */

function validCoords(lat, lon) {
    if (typeof lat !== 'number' || typeof lon !== 'number' || !isFinite(lat) || !isFinite(lon)) return false;
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return false;
    // (0, 0) is what BMW's Positioning reports alongside NO_FIX / coordinatesValid: false
    if (Math.abs(lat) < 0.001 && Math.abs(lon) < 0.001) return false;
    return true;
}

function scaleDeg(v, maxAbs) {
    if (typeof v !== 'number' || !isFinite(v)) return NaN;
    if (Math.abs(v) <= maxAbs) return v;
    // Some raw GNSS structs report integer 1e-7 deg micro-coordinates.
    if (Math.abs(v) <= maxAbs * 1e7 && Math.floor(v) === v) return v * 1e-7;
    return NaN;
}

/** Extract { lat, lon } from a Wgs84Coordinate3D, CurrentLocation, BaseLocation or GnssPositioning struct; null if invalid. */
function extractCoords(v, depth) {
    if (!v || typeof v !== 'object' || (depth || 0) > 4) return null;
    if (v.coordinatesValid === false) return null;
    const rawLat = v.latitude !== undefined ? v.latitude : v.wgs84Latitude;
    const rawLon = v.longitude !== undefined ? v.longitude : v.wgs84Longitude;
    if (rawLat !== undefined && rawLon !== undefined) {
        const lat = scaleDeg(Number(rawLat), 90), lon = scaleDeg(Number(rawLon), 180);
        if (validCoords(lat, lon)) return { lat, lon };
    }
    const sub = ['position', 'baseLocation', 'geoLocation', 'guidableLocation', 'location', 'coordinates'];
    for (let i = 0; i < sub.length; i++) {
        const child = v[sub[i]];
        if (child && typeof child === 'object') {
            const hit = extractCoords(child, (depth || 0) + 1);
            if (hit) return hit;
        }
    }
    return null;
}

function speechText(v) {
    if (typeof v === 'string') return v.trim();
    if (!v || typeof v !== 'object') return '';
    const s = v.orthography || v.text || v.value || '';
    return typeof s === 'string' ? s.trim() : '';
}

// NavigationDataTypes.TextIdentifier enum names and wire numbers
const TEXT_IDS = {
    1: 'LOCATION_NAME', 2: 'FULL_ADDRESS', 11: 'COUNTRY', 12: 'STATE', 13: 'TOWN_CITY',
    14: 'STREET', 31: 'PREFECTURE', 33: 'DISTRICT', 34: 'PROVINCE', 204: 'WARD',
};

/** Extract { city, district } from CurrentLocation.textDescription.textDescriptorList (map as object or array). */
function extractTextPlace(v) {
    const td = (v && v.textDescription) || (v && v.baseLocation && v.baseLocation.textDescription) ||
        (v && v.geoLocation && v.geoLocation.textDescription) || null;
    const list = td && td.textDescriptorList;
    if (!list || typeof list !== 'object') return { city: '', district: '' };
    const map = {};
    const put = (k, val) => {
        const key = TEXT_IDS[k] || String(k || '').toUpperCase();
        const txt = speechText(val);
        if (key && txt && !map[key]) map[key] = txt;
    };
    if (Array.isArray(list)) {
        list.forEach((item) => {
            if (Array.isArray(item) && item.length >= 2) put(item[0], item[1]);
            else if (item && typeof item === 'object') put(item.key !== undefined ? item.key : item.id, item.value !== undefined ? item.value : item);
        });
    } else {
        Object.keys(list).forEach((k) => put(k, list[k]));
    }
    const city = map.TOWN_CITY || map.PROVINCE || map.STATE || map.PREFECTURE || '';
    const district = map.DISTRICT || map.WARD || '';
    return { city, district };
}

/** Parse Positioning.currentLocation -> { lat, lon, city, district, source: 'nav' } or null. */
function parseCurrentLocation(v) {
    if (!v || typeof v !== 'object') return null;
    // OFF_MAP alone still has valid WGS84 coordinates; only reject explicit invalid coordinates.
    const c = extractCoords(v, 0);
    if (!c) return null;
    const pl = extractTextPlace(v);
    return { lat: c.lat, lon: c.lon, city: pl.city, district: pl.district, source: 'nav' };
}

/** Parse Positioning.rawPositionData or GnssPositioning.positioning -> { lat, lon, city: '', district: '', source: 'gnss' } or null. */
function parseRawPosition(v) {
    if (!v || typeof v !== 'object') return null;
    const ft = v.fixType;
    if (ft !== undefined && ft !== null) {
        const s = typeof ft === 'object' ? (ft.name !== undefined ? ft.name : ft.value) : ft;
        // GNSSFixType: NO_FIX = 0, FIX_1D = 1, FIX_2D = 2, FIX_3D = 3
        if (s === 'NO_FIX' || s === 'FIX_1D' || s === 0 || s === 1) return null;
    }
    const sol = v.solutionStatus;
    if (sol !== undefined && sol !== null && /NO_FIX|INVALID|NONE/i.test(String(sol))) return null;
    const c = extractCoords(v, 0);
    if (!c) return null;
    return { lat: c.lat, lon: c.lon, city: '', district: '', source: 'gnss' };
}

/** Choose the best live fix: map-matched `nav` wins while recent (works in underground parking); else `gnss`. */
function pickBestPosition(state, now) {
    const nav = state && state.nav, gnss = state && state.gnss;
    const freshNav = nav && (now - (nav.at || 0) < 30 * 60 * 1000);
    if (freshNav) return nav;
    if (gnss && (now - (gnss.at || 0) < 30 * 60 * 1000)) return gnss;
    return nav || gnss || null;
}

/** Find Positioning and GnssPositioning interfaces in a SOME/IP master catalog. */
function findPosInterfaces(db) {
    const all = (db && db.interfaces) || {};
    const out = [];
    Object.keys(all).forEach((name) => {
        const i = all[name] || {};
        const fields = Object.keys(i.fields || {});
        const broadcasts = Object.keys(i.broadcasts || i.events || {});
        if (/(^|\.)Positioning$/.test(name) && (fields.indexOf('currentLocation') >= 0 || fields.indexOf('rawPositionData') >= 0)) {
            const want = fields.filter((f) => f === 'currentLocation' || f === 'rawPositionData');
            out.push({ name, fields: want, broadcasts: [] });
        } else if (/GnssPositioning$/i.test(name) && broadcasts.indexOf('positioning') >= 0) {
            out.push({ name, fields: [], broadcasts: ['positioning'] });
        }
    });
    return out;
}

/* ---------------- loading BMW's IFConfigGenerator on the unit ---------------- */

function loadIFConfigGeneratorFromText(bundleText) {
    // Format 1: Browserify bundle (ID7 oap-mainapp)
    const m = /"someip-interfaces-generator\/IFConfigGenerator(?:\.js)?":(\d+)/.exec(bundleText);
    if (m) {
        const tail = /,\{\},\[\d+\]\)\s*;?\s*$/;
        if (!tail.test(bundleText)) throw new Error('unexpected browserify bundle tail');
        const req = new Function('require', 'return ' + bundleText.replace(tail, ',{},[])'))(require);
        return req(m[1]);
    }
    // Format 2: Webpack bundle (mgu-IFA/IFConfigGenerator.js)
    let start = bundleText.indexOf('/*** "./node_modules/mgu-IFA/IFConfigGenerator.js":');
    if (start < 0) start = bundleText.indexOf('IFConfigGenerator.js":');
    if (start >= 0) {
        const firstFn = bundleText.indexOf('function(', start);
        const end = bundleText.indexOf('\n/***/ }),', firstFn);
        if (firstFn >= 0 && end > firstFn) {
            const mod = { exports: {} };
            let src = bundleText.slice(firstFn, end).trim();
            if (src.slice(-1) !== '}') src += '\n}';
            const fn = new Function('return (' + src + ')')();
            fn(mod, mod.exports, function (id) { return require(id); });
            if (mod.exports && typeof mod.exports.generate === 'function') return mod.exports;
        }
    }
    throw new Error('IFConfigGenerator not found in bundle');
}

function loadIFConfigGenerator() {
    let lastErr = null;
    for (let i = 0; i < APPMGMTS.length; i++) {
        const p = APPMGMTS[i];
        if (!fs.existsSync(p)) continue;
        try { return loadIFConfigGeneratorFromText(fs.readFileSync(p, 'utf8')); } catch (e) { lastErr = e; }
    }
    throw lastErr || new Error('no AppManagement.js found');
}

/* ---------------- running on the head unit ---------------- */

const cut = (s, n) => { s = String(s); return s.length > n ? s.slice(0, n) + '...' : s; };
const say = (o) => { try { process.stdout.write(JSON.stringify(o) + '\n'); } catch (e) { /* parent gone */ } };
const within = (p, ms, what) => Promise.race([p, new Promise((r, j) => setTimeout(() => j(new Error(what + ': timeout')), ms))]);

async function read() {
    let db;
    try { db = JSON.parse(fs.readFileSync(CATALOG, 'utf8')); } catch (e) { say({ ev: 'note', text: 'no catalog: ' + cut(e.message, 140) }); return; }
    const ifaces = findPosInterfaces(db);
    if (!ifaces.length) { say({ ev: 'note', text: 'no positioning interface in catalog' }); return; }
    let gen;
    try { gen = loadIFConfigGenerator(); } catch (e) { say({ ev: 'note', text: 'no generator: ' + cut(e.message, 140) }); return; }
    let someip;
    try { someip = require(SOMEIP); } catch (e) { say({ ev: 'note', text: 'no someip binding: ' + cut(e.message, 140) }); return; }

    const configs = [];
    ifaces.forEach((it) => {
        const buildOne = (fields, broadcasts) => {
            const entry = { instances: '*' };
            if (fields.length) { entry.attributes = {}; fields.forEach((f) => { entry.attributes[f] = 'rs'; }); }
            if (broadcasts.length) entry.broadcasts = broadcasts;
            const proxies = {}; proxies[it.name] = entry;
            const out = gen.generate(db, { proxies, services: {} });
            return out && out[it.name] ? { name: it.name, cfg: out[it.name], fields, broadcasts } : null;
        };
        try {
            const c = buildOne(it.fields, it.broadcasts);
            if (c) configs.push(c);
        } catch (e) {
            // If describing both fields together fails on an older firmware, try each field alone.
            it.fields.forEach((f) => { try { const c = buildOne([f], []); if (c) configs.push(c); } catch (e2) { /* skip */ } });
        }
    });
    db = null;
    if (!configs.length) { say({ ev: 'note', text: 'could not generate positioning config' }); return; }

    const state = { nav: null, gnss: null };
    let lastSent = null, lastSentAt = 0;
    const emitIfChanged = () => {
        const now = Date.now();
        const best = pickBestPosition(state, now);
        if (!best) return;
        const moved = !lastSent || Math.abs(best.lat - lastSent.lat) >= 0.002 || Math.abs(best.lon - lastSent.lon) >= 0.002;
        const renamed = !lastSent || best.city !== lastSent.city || best.district !== lastSent.district || best.source !== lastSent.source;
        if (!moved && !renamed && now - lastSentAt < 5 * 60 * 1000) return;
        lastSent = { lat: best.lat, lon: best.lon, city: best.city, district: best.district, source: best.source };
        lastSentAt = now;
        say({ ev: 'pos', lat: best.lat, lon: best.lon, city: best.city, district: best.district, source: best.source });
    };

    const onField = (field, val) => {
        const now = Date.now();
        if (field === 'currentLocation') {
            const p = parseCurrentLocation(val);
            if (p) { p.at = now; state.nav = p; emitIfChanged(); }
        } else {
            const p = parseRawPosition(val);
            if (p) { p.at = now; state.gnss = p; emitIfChanged(); }
        }
    };

    let up = 0;
    for (let i = 0; i < configs.length; i++) {
        const item = configs[i];
        const insts = Object.keys(item.cfg.instances || { '1': 1 }).slice(0, 3);
        for (let j = 0; j < insts.length; j++) {
            const inst = insts[j];
            let px;
            try {
                px = await within(someip.buildProxy(item.cfg, String(inst)).then((p) => p.init().then(() => p)), 6000, item.name);
            } catch (e) {
                say({ ev: 'note', text: item.name + '@' + inst + ': ' + cut(e && e.message || e, 140) });
                continue;
            }
            up++;
            const pollFields = () => {
                item.fields.forEach((f) => {
                    try { Promise.resolve(px.getValue(f, 3000)).then((v) => onField(f, v)).catch(() => {}); } catch (e) { /* no getter */ }
                });
            };
            try { px.subscribeToAvailability((a) => { if (a) setTimeout(pollFields, 300); }); } catch (e) { /* optional */ }
            item.fields.concat(item.broadcasts).forEach((name) => {
                try { Promise.resolve(px.subscribe({ name, onReceive: (v) => onField(name, v) })).catch(() => {}); } catch (e) { /* optional */ }
            });
            setTimeout(pollFields, 500);
            setInterval(pollFields, 20000);
        }
    }
    if (!up) {
        say({ ev: 'note', text: 'no positioning proxy opened' });
        setTimeout(() => process.exit(0), 200);
    }
}

if (require.main === module && process.argv[2] === 'read') {
    process.on('uncaughtException', (e) => { say({ ev: 'note', text: 'error: ' + cut(e && e.message || e, 200) }); process.exit(1); });
    process.on('unhandledRejection', (e) => say({ ev: 'note', text: 'rejected: ' + cut(e && e.message || e, 200) }));
    process.on('SIGTERM', () => process.exit(0));
    read().catch((e) => { say({ ev: 'note', text: 'error: ' + cut(e && e.message || e, 200) }); process.exit(1); });
}

module.exports = {
    validCoords, scaleDeg, extractCoords, speechText, extractTextPlace,
    parseCurrentLocation, parseRawPosition, pickBestPosition, findPosInterfaces, loadIFConfigGeneratorFromText,
};
