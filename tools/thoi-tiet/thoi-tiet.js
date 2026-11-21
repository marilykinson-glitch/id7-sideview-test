'use strict';
/**
 * thoi-tiet - the helper of the Thời tiết app: fetches the forecast for the places the app asks for and leaves it
 * in RAM for the app to draw. It works because the head unit's own app cannot be sure of a network path or of the
 * newer TLS roots; this runs as root like the other helpers.
 *
 *   the app  -> <its folder>/data/command.json   { id, cmd: 'places' | 'refresh', places: [{ key, name, lat, lon, here }] }
 *   this     -> /run/thoi-tiet/weather.json      { at, places: [{ key, name, ok, at, error, current, hourly, daily }] }
 *   (kept)   -> /var/opt/thoi-tiet/places.json   the last list, so that a start without the app still has places
 *
 * Forecasts come from Open-Meteo (no key). A place with `here: true` is placed by the address the head unit reaches
 * the internet from (ipwho.is): near the right city, not at the car's own position.
 * Node 8, no dependencies.
 */
const fs = require('fs');
const path = require('path');
const https = require('https');

const env = (k, d) => (process.env[k] !== undefined && process.env[k] !== '' ? process.env[k] : d);
const CFG = {
    run: env('TT_RUN', '/run/thoi-tiet'),
    state: env('TT_STATE', '/var/opt/thoi-tiet'),
    oap: env('TT_OAP', '/var/opt/public/oap'),
    scanMs: Number(env('TT_SCAN_MS', 5000)),
    everyMs: Number(env('TT_EVERY_MS', 20 * 60 * 1000)),      // a new forecast this often while the app is there
    retryMs: Number(env('TT_RETRY_MS', 60 * 1000)),
    host: env('TT_HOST', 'api.open-meteo.com'),
    ipHost: env('TT_IP_HOST', 'ipwho.is'),
    airHost: env('TT_AIR_HOST', 'air-quality-api.open-meteo.com'),
    base: env('TT_BASE', ''),                                 // tests: http://127.0.0.1:port (no TLS)
};
const APP = /^thoi_tiet\d*$/;
const MAX_PLACES = 6;

const LOGS = [];
function log(m) {
    LOGS.push(new Date().toISOString() + ' ' + m); if (LOGS.length > 200) LOGS.shift();
    process.stdout.write(m + '\n');
}
function readJson(f) { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return null; } }
function mkdirp(d) { fs.mkdirSync(d, { recursive: true }); }
function writeAtomic(file, data) {
    mkdirp(path.dirname(file));
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, data, { mode: 0o644 });
    fs.renameSync(tmp, file);
}

/* ---------------- fetching ---------------- */
/**
 * GET a JSON document. A certificate the head unit's old Node does not trust (it carries an old set of roots) is
 * tried again without the check: this is public weather data, nothing of the car's goes out in the request.
 */
function getJson(host, pathAndQuery, strict) {
    return new Promise((resolve, reject) => {
        let done = false;
        const fin = (err, v) => { if (done) return; done = true; err ? reject(err) : resolve(v); };
        const http = CFG.base ? require('http') : https;
        const opts = CFG.base
            ? { host: '127.0.0.1', port: Number(CFG.base.replace(/^.*:/, '')), path: pathAndQuery, method: 'GET', headers: { Host: host } }
            : { host, path: pathAndQuery, method: 'GET', headers: { 'User-Agent': 'thoi-tiet/1', Accept: 'application/json' }, rejectUnauthorized: strict !== false };
        const req = http.request(opts, (res) => {
            if (res.statusCode !== 200) { res.resume(); return fin(new Error('HTTP ' + res.statusCode)); }
            const chunks = []; let n = 0;
            res.on('data', (c) => { n += c.length; if (n > 2e6) { req.abort(); return fin(new Error('answer too large')); } chunks.push(c); });
            res.on('end', () => { try { fin(null, JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch (e) { fin(new Error('answer is not JSON')); } });
        });
        req.setTimeout(15000, () => { req.abort(); fin(new Error('timeout')); });
        req.on('error', (e) => {
            if (strict !== false && !CFG.base && /certificate|CERT|self signed|issuer/i.test(String(e && (e.code || e.message)))) return getJson(host, pathAndQuery, false).then((v) => fin(null, v), (e2) => fin(e2));
            fin(e);
        });
        req.end();
    });
}

const FORECAST = '/v1/forecast?current=temperature_2m,relative_humidity_2m,apparent_temperature,is_day,precipitation,weather_code,wind_speed_10m,wind_direction_10m,pressure_msl'
    + '&hourly=temperature_2m,precipitation_probability,weather_code,is_day'
    + '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,uv_index_max,sunrise,sunset'
    + '&timezone=auto&forecast_days=6&wind_speed_unit=kmh';

const AIR = '/v1/air-quality?current=us_aqi,pm2_5,pm10,ozone,nitrogen_dioxide&timezone=auto';
/** The air: { aqi (US scale 0..500), pm25, pm10, o3, no2 } or null when the answer has no index. */
function parseAir(j) {
    const c = j && j.current, num = (v) => (typeof v === 'number' && isFinite(v) ? v : null);
    if (!c || num(c.us_aqi) === null) return null;
    return { aqi: num(c.us_aqi), pm25: num(c.pm2_5), pm10: num(c.pm10), o3: num(c.ozone), no2: num(c.nitrogen_dioxide) };
}

/**
 * What Open-Meteo answered, as the app uses it:
 *   { current: { t, feels, humidity, wind, windDir, code, day, rain, pressure, time },
 *     hourly: [{ time 'HH:MM', t, pop, code, day }]   (the next 24 hours, from the current one),
 *     daily:  [{ date 'YYYY-MM-DD', dow 0..6 (0 = Sunday), code, hi, lo, pop, uv, sunrise, sunset }] }
 */
function parse(j) {
    if (!j || !j.current || !j.hourly || !j.daily) throw new Error('unexpected answer');
    const num = (v) => (typeof v === 'number' && isFinite(v) ? v : null);
    const c = j.current;
    const current = {
        t: num(c.temperature_2m), feels: num(c.apparent_temperature), humidity: num(c.relative_humidity_2m), wind: num(c.wind_speed_10m),
        windDir: num(c.wind_direction_10m), code: num(c.weather_code), day: c.is_day === 1, rain: num(c.precipitation), pressure: num(c.pressure_msl), time: String(c.time || ''),
    };
    const h = j.hourly, hourly = [];
    const now = String(c.time || '').slice(0, 13);                           // YYYY-MM-DDTHH
    let from = (h.time || []).findIndex((s) => String(s).slice(0, 13) >= now); if (from < 0) from = 0;
    for (let i = from; i < Math.min((h.time || []).length, from + 24); i++) {
        hourly.push({ time: String(h.time[i]).slice(11, 16), t: num(h.temperature_2m[i]), pop: num((h.precipitation_probability || [])[i]), code: num((h.weather_code || [])[i]), day: (h.is_day || [])[i] === 1 });
    }
    const d = j.daily, daily = [];
    for (let i = 0; i < (d.time || []).length; i++) {
        const date = String(d.time[i]), dt = new Date(date + 'T12:00:00Z');
        daily.push({
            date, dow: dt.getUTCDay(), code: num(d.weather_code[i]), hi: num(d.temperature_2m_max[i]), lo: num(d.temperature_2m_min[i]),
            pop: num((d.precipitation_probability_max || [])[i]), uv: num((d.uv_index_max || [])[i]), sunrise: String((d.sunrise || [])[i] || '').slice(11, 16), sunset: String((d.sunset || [])[i] || '').slice(11, 16),
        });
    }
    if (current.t === null || !daily.length) throw new Error('no temperature in the answer');
    return { current, hourly, daily };
}

/* ---------------- state ---------------- */
const S = { places: [], data: {}, ipPlace: null, ipAt: 0, startedAt: Date.now(), lastCmd: null, busy: false };
const clean = (p) => {
    if (!p || typeof p !== 'object') return null;
    const key = String(p.key || '').slice(0, 40), name = String(p.name || '').slice(0, 60);
    if (!key || !name) return null;
    const lat = Number(p.lat), lon = Number(p.lon), here = !!p.here;
    if (!here && !(isFinite(lat) && isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180)) return null;
    return { key, name, lat: isFinite(lat) ? lat : 0, lon: isFinite(lon) ? lon : 0, here };
};
function setPlaces(list) {
    const out = (Array.isArray(list) ? list : []).map(clean).filter(Boolean).slice(0, MAX_PLACES);
    if (!out.length) return false;
    S.places = out;
    try { writeAtomic(path.join(CFG.state, 'places.json'), JSON.stringify(out)); } catch (e) { /* tests */ }
    return true;
}

async function whereIAm() {
    if (S.ipPlace && Date.now() - S.ipAt < 6 * 3600 * 1000) return S.ipPlace;
    const j = await getJson(CFG.ipHost, '/');
    const lat = Number(j && j.latitude), lon = Number(j && j.longitude);
    if (!(j && j.success !== false && isFinite(lat) && isFinite(lon))) throw new Error('chưa biết xe đang ở đâu');
    S.ipPlace = { lat, lon, city: String(j.city || '') }; S.ipAt = Date.now();
    return S.ipPlace;
}

async function fetchPlace(p) {
    const prev = S.data[p.key] || {};
    let lat = p.lat, lon = p.lon, name = p.name;
    try {
        if (p.here) { const w = await whereIAm(); lat = w.lat; lon = w.lon; if (w.city) name = w.city; }
        const j = await getJson(CFG.host, FORECAST + '&latitude=' + lat.toFixed(3) + '&longitude=' + lon.toFixed(3));
        const w = parse(j);
        let air = null;                                  // the air is a second request: without it the weather still shows
        try { air = parseAir(await getJson(CFG.airHost, AIR + '&latitude=' + lat.toFixed(3) + '&longitude=' + lon.toFixed(3))); } catch (e) { log('air for ' + p.key + ': ' + e.message); air = prev.air || null; }
        S.data[p.key] = { key: p.key, name, ok: true, at: Date.now(), error: '', current: w.current, hourly: w.hourly, daily: w.daily, air, here: p.here };
    } catch (e) {
        log('forecast for ' + p.key + ': ' + e.message);
        // the last good forecast stays on the screen, marked as old
        S.data[p.key] = Object.assign({ key: p.key, name, current: null, hourly: [], daily: [], here: p.here }, prev, { ok: false, error: String(e.message || e).slice(0, 80), at: prev.at || 0, name });
    }
}

let working = null;
function refreshAll() {
    if (working) return working;
    S.busy = true; writeStatus();
    working = (async () => {
        for (const p of S.places.slice()) await fetchPlace(p);
    })().catch((e) => log('refresh: ' + e.message)).then(() => { working = null; S.busy = false; S.fetchedAt = Date.now(); writeStatus(); });
    return working;
}

function writeStatus() {
    const keys = S.places.map((p) => p.key);
    const st = { at: Date.now(), version: VERSION, busy: S.busy, places: S.places.map((p) => S.data[p.key] || { key: p.key, name: p.name, ok: false, at: 0, error: 'chưa có dữ liệu', current: null, hourly: [], daily: [], here: p.here }), keys };
    try { writeAtomic(path.join(CFG.run, 'weather.json'), JSON.stringify(st)); } catch (e) { /* no RAM folder (tests) */ }
    return st;
}

/* ---------------- the app ---------------- */
let appCache = null, appScanAt = 0;
function findApp(now) {
    if (appCache && fs.existsSync(appCache.spec)) return appCache;
    if (now - appScanAt < CFG.scanMs && now >= appScanAt) return null;
    appScanAt = now; appCache = null;
    let dirs = [];
    try { dirs = fs.readdirSync(CFG.oap).filter((d) => /^oap_\d+$/.test(d)); } catch (e) { return null; }
    for (const d of dirs) for (const rel of ['source/javascript/kit/app-spec.json', 'javascript/kit/app-spec.json']) {
        const spec = path.join(CFG.oap, d, rel), s = readJson(spec);
        if (s && typeof s.id === 'string' && APP.test(s.id)) { appCache = { id: s.id, root: path.join(CFG.oap, d), spec }; return appCache; }
    }
    return null;
}
function pollCommands() {
    const app = findApp(Date.now());
    if (!app) return;
    const c = readJson(path.join(app.root, 'data', 'command.json'));
    if (!c || typeof c.id !== 'number') return;
    if (c.id === S.lastCmd) return;
    const first = S.lastCmd === null; S.lastCmd = c.id;
    log('command ' + c.cmd);
    if (c.cmd === 'places' && setPlaces(c.places)) { for (const k of Object.keys(S.data)) if (!S.places.some((p) => p.key === k)) delete S.data[k]; refreshAll(); }
    else if (c.cmd === 'refresh' && !first) refreshAll();
}

const VERSION = '0.2.0';
function start() {
    try { mkdirp(CFG.state); } catch (e) { /* tests */ }
    const saved = readJson(path.join(CFG.state, 'places.json'));
    if (saved) setPlaces(saved);
    writeStatus();
    log('thoi-tiet ' + VERSION + ' started, ' + S.places.length + ' places');
    const tick = () => {
        try { pollCommands(); } catch (e) { log('poll: ' + e.message); }
        const stale = !S.fetchedAt || Date.now() - S.fetchedAt > (S.places.some((p) => !(S.data[p.key] && S.data[p.key].ok)) ? CFG.retryMs : CFG.everyMs);
        if (S.places.length && findApp(Date.now()) && stale && !working) refreshAll();
        writeStatus();
    };
    setInterval(tick, 1500); tick();
}

if (require.main === module) {
    const cmd = process.argv[2] || 'run';
    if (cmd === 'status') process.stdout.write(JSON.stringify(readJson(path.join(CFG.run, 'weather.json')) || {}, null, 2) + '\n');
    else start();
}

module.exports = { CFG, S, parse, parseAir, getJson, setPlaces, refreshAll, fetchPlace, pollCommands, writeStatus, findApp, start, VERSION, FORECAST };
