'use strict';
/**
 * thoi-tiet - the helper of the Thời tiết app: fetches the forecast for the places the app asks for and leaves it
 * in RAM for the app to draw. It works because the head unit's own app cannot be sure of a network path or of the
 * newer TLS roots; this runs as root like the other helpers.
 *
 *   the app  -> <its folder>/data/command.json   { id, cmd: 'places' | 'refresh', places: [{ key, name, lat, lon, here }] }
 *   this     -> /run/thoi-tiet/weather.json      { at, places: [{ key, name, ok, at, error, current, hourly, daily }] }
 *   (kept)   -> /var/opt/thoi-tiet/places.json   the last list, so that a start without the app still has places
 *   the phone -> http://<head unit>:8138/?pin=NNNN  a page to search any place in the world and add it (custom.json keeps them)
 *
 * Forecasts come from Open-Meteo (no key). A place with `here: true` is placed by the address the head unit reaches
 * the internet from (ipwho.is): near the right city, not at the car's own position.
 * Node 8, no dependencies.
 */
const fs = require('fs');
const path = require('path');
const https = require('https');
const os = require('os');
const url = require('url');
const cp = require('child_process');
const httpMod = require('http');
const crypto = require('crypto');

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
    geoHost: env('TT_GEO_HOST', 'geocoding-api.open-meteo.com'),
    port: Number(env('TT_PORT', 8138)),
    nft: env('TT_NFT', 'nft'),
    route: env('TT_ROUTE', '/proc/net/route'),
    ips: env('TT_IPS', ''),
    noServer: env('TT_NO_SERVER', '') === '1',
    dns: env('TT_DNS', ''),                                   // tests/overrides: extra name servers, comma separated
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
const mkdirp = (d) => { if (fs.existsSync(d)) return; mkdirp(path.dirname(d)); try { fs.mkdirSync(d); } catch (e) { if (e.code !== 'EEXIST') throw e; } };
function writeAtomic(file, data) {
    mkdirp(path.dirname(file));
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, data, { mode: 0o644 });
    fs.renameSync(tmp, file);
}

/* ---------------- fetching ---------------- */
/* ---------------- names ----------------
 * The head unit's own resolver is not always usable by a service running as root (getaddrinfo EAI_AGAIN while the phone's
 * hotspot works). So when the system cannot find a name, ask name servers directly: the ones the system lists in its
 * resolv.conf files, the default gateway (a phone's hotspot answers DNS itself), then public ones. */
const dnsMod = require('dns');
const nsCache = {};
function nameServers() {
    const out = [];
    const add = (ip) => { if (/^\d+\.\d+\.\d+\.\d+$/.test(ip) && ip !== '0.0.0.0' && !/^127\./.test(ip) && out.indexOf(ip) < 0) out.push(ip); };
    CFG.dns.split(',').forEach((x) => add(x.trim()));
    ['/etc/resolv.conf', '/run/connman/resolv.conf', '/var/run/connman/resolv.conf', '/run/systemd/resolve/resolv.conf', '/run/dnsmasq/resolv.conf'].forEach((f) => {
        try { fs.readFileSync(f, 'utf8').split('\n').forEach((l) => { const m = /^\s*nameserver\s+(\S+)/.exec(l); if (m) add(m[1]); }); } catch (e) { /* not there */ }
    });
    try {                                                           // the default gateway: 4 bytes of hex, least significant first
        fs.readFileSync(CFG.route, 'utf8').split('\n').slice(1).map((l) => l.trim().split(/\s+/)).filter((c) => c.length > 7 && c[1] === '00000000').forEach((c) => {
            const g = parseInt(c[2], 16); add([g & 255, (g >>> 8) & 255, (g >>> 16) & 255, (g >>> 24) & 255].join('.'));
        });
    } catch (e) { /* no route table */ }
    ['1.1.1.1', '8.8.8.8', '9.9.9.9'].forEach(add);
    return out;
}
/** An IPv4 address of `host` from the name servers above, tried one after the other; kept 10 minutes. */
function resolveHost(host) {
    const c = nsCache[host];
    if (c && Date.now() - c.at < 600000) return Promise.resolve(c.ip);
    const servers = nameServers();
    return new Promise((resolve, reject) => {
        let i = 0, last = null;
        const next = () => {
            if (i >= servers.length) return reject(last || new Error('no name server'));
            const r = new dnsMod.Resolver(), srv = servers[i++];
            let done = false;
            const t = setTimeout(() => { if (done) return; done = true; last = new Error('DNS ' + srv + ': timeout'); next(); }, 3000);
            try { r.setServers([srv]); } catch (e) { clearTimeout(t); last = e; return next(); }
            r.resolve4(host, (err, ips) => {
                if (done) return; done = true; clearTimeout(t);
                if (err || !ips || !ips.length) { last = err || new Error('DNS ' + srv + ': no answer'); return next(); }
                nsCache[host] = { ip: ips[0], at: Date.now() }; log('dns: ' + host + ' = ' + ips[0] + ' (asked ' + srv + ')'); resolve(ips[0]);
            });
        };
        next();
    });
}

/**
 * GET a JSON document. A certificate the head unit's old Node does not trust (it carries an old set of roots) is
 * tried again without the check: this is public weather data, nothing of the car's goes out in the request.
 */
function getJson(host, pathAndQuery, strict, ip) {
    if (!ip && !CFG.base && nsCache[host] && Date.now() - nsCache[host].at < 600000) ip = nsCache[host].ip;      // the system could not find it before: do not wait for it again
    return new Promise((resolve, reject) => {
        let done = false;
        const fin = (err, v) => { if (done) return; done = true; err ? reject(err) : resolve(v); };
        const http = CFG.base ? httpMod : https;
        const opts = CFG.base
            ? { host: '127.0.0.1', port: Number(CFG.base.replace(/^.*:/, '')), path: pathAndQuery, method: 'GET', headers: { Host: host } }
            : { host, path: pathAndQuery, method: 'GET', headers: { 'User-Agent': 'thoi-tiet/1', Accept: 'application/json', Host: host }, rejectUnauthorized: strict !== false };
        if (ip && !CFG.base) { opts.host = ip; opts.servername = host; }
        const req = http.request(opts, (res) => {
            if (res.statusCode !== 200) { res.resume(); return fin(new Error('HTTP ' + res.statusCode)); }
            const chunks = []; let n = 0;
            res.on('data', (c) => { n += c.length; if (n > 2e6) { req.abort(); return fin(new Error('answer too large')); } chunks.push(c); });
            res.on('end', () => { try { fin(null, JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch (e) { fin(new Error('answer is not JSON')); } });
        });
        req.setTimeout(15000, () => { req.abort(); fin(new Error('timeout')); });
        req.on('error', (e) => {
            if (strict !== false && !CFG.base && /certificate|CERT|self signed|issuer/i.test(String(e && (e.code || e.message)))) return getJson(host, pathAndQuery, false, ip).then((v) => fin(null, v), (e2) => fin(e2));
            if (!ip && !CFG.base && /EAI_AGAIN|ENOTFOUND/.test(String(e && (e.code || e.message)))) return resolveHost(host).then((addr) => getJson(host, pathAndQuery, strict, addr)).then((v) => fin(null, v), (e2) => fin(new Error(String(e.code || e.message) + ' (và tra DNS trực tiếp cũng lỗi: ' + e2.message + ')')));
            fin(e);
        });
        req.end();
    });
}

const FORECAST = '/v1/forecast?current=temperature_2m,relative_humidity_2m,apparent_temperature,is_day,precipitation,weather_code,wind_speed_10m,wind_direction_10m,wind_gusts_10m,pressure_msl,visibility'
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
        windDir: num(c.wind_direction_10m), gust: num(c.wind_gusts_10m), vis: num(c.visibility), code: num(c.weather_code), day: c.is_day === 1, rain: num(c.precipitation), pressure: num(c.pressure_msl), time: String(c.time || ''),
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
const S = { places: [], custom: [], seq: 0, lastAdded: '', pin: '', port: 0, ipIndex: 0, data: {}, ipPlace: null, ipAt: 0, startedAt: Date.now(), lastCmd: null, busy: false };
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
    const ips = addresses();
    const st = { at: Date.now(), version: VERSION, busy: S.busy, pin: S.pin, port: S.port, url: ips.length && S.port ? 'http://' + ips[S.ipIndex % ips.length] + ':' + S.port + '/?pin=' + S.pin : '', host: ips.length && S.port ? ips[S.ipIndex % ips.length] + ':' + S.port : '', custom: S.custom, seq: S.seq, lastAdded: S.lastAdded, places: S.places.map((p) => S.data[p.key] || { key: p.key, name: p.name, ok: false, at: 0, error: 'chưa có dữ liệu', current: null, hourly: [], daily: [], here: p.here }), keys };
    try { writeAtomic(path.join(CFG.run, 'weather.json'), JSON.stringify(st)); } catch (e) { /* no RAM folder (tests) */ }
    return st;
}

/* ---------------- places the owner searched for on the phone ---------------- */
const MAX_CUSTOM = 30;
const VI = 'àáâãèéêìíòóôõùúýăđĩũơưạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹÀÁÂÃÈÉÊÌÍÒÓÔÕÙÚÝĂĐĨŨƠƯẠẢẤẦẨẪẬẮẰẲẴẶẸẺẼẾỀỂỄỆỈỊỌỎỐỒỔỖỘỚỜỞỠỢỤỦỨỪỬỮỰỲỴỶỸ';
/** A name the car's font can draw: Vietnamese letters stay, other accents go (ü -> u), what is left outside plain ASCII goes. */
function plain(str) {
    let out = '';
    for (const ch of String(str || '').normalize('NFC')) {
        if (VI.indexOf(ch) >= 0 || (ch >= ' ' && ch <= '~')) out += ch;
        else out += ch.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\x20-\x7e]/g, '');
    }
    return out.replace(/\s+/g, ' ').trim();
}
const customKey = (lat, lon) => 'c' + Math.round(lat * 100) + '_' + Math.round(lon * 100);
function loadCustom() { const c = readJson(path.join(CFG.state, 'custom.json')); S.custom = Array.isArray(c) ? c.map(cleanCustom).filter(Boolean).slice(0, MAX_CUSTOM) : []; }
function cleanCustom(p) {
    if (!p) return null;
    const lat = Number(p.lat), lon = Number(p.lon), name = plain(p.name).slice(0, 40);
    if (!name || !(isFinite(lat) && isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180)) return null;
    return { key: customKey(lat, lon), name, lat: Math.round(lat * 1000) / 1000, lon: Math.round(lon * 1000) / 1000 };
}
function saveCustom() { try { writeAtomic(path.join(CFG.state, 'custom.json'), JSON.stringify(S.custom)); } catch (e) { /* tests */ } }
function addCustom(p) {
    const c = cleanCustom(p);
    if (!c) { const e = new Error('Địa điểm không hợp lệ.'); e.bad = true; throw e; }
    if (!S.custom.some((x) => x.key === c.key)) {
        if (S.custom.length >= MAX_CUSTOM) { const e = new Error('Đã có ' + MAX_CUSTOM + ' địa điểm: xoá bớt trước.'); e.bad = true; throw e; }
        S.custom.push(c); saveCustom();
    }
    S.seq++; S.lastAdded = c.key; writeStatus();
    return c;
}
function removeCustom(key) { S.custom = S.custom.filter((x) => x.key !== key); saveCustom(); S.seq++; writeStatus(); }

/** Search a place by name (Open-Meteo's geocoding): up to 8 answers, names the car can draw. */
async function search(q) {
    q = String(q || '').trim().slice(0, 60);
    if (q.length < 2) return [];
    const j = await getJson(CFG.geoHost, '/v1/search?count=8&language=vi&format=json&name=' + encodeURIComponent(q));
    return (Array.isArray(j && j.results) ? j.results : []).map((r) => {
        const where = [r.admin1, r.country].filter(Boolean).map(plain).filter((v, i, a) => v && a.indexOf(v) === i && v !== plain(r.name)).join(', ');
        return { name: plain(r.name), where, lat: r.latitude, lon: r.longitude };
    }).filter((r) => r.name && isFinite(r.lat) && isFinite(r.lon));
}

/* ---------------- the phone's page ---------------- */
const newPin = () => String(1000 + crypto.randomBytes(2).readUInt16BE(0) % 9000);
const fails = {};
function json(res, code, obj) {
    const b = Buffer.from(JSON.stringify(obj));
    res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': b.length, 'Cache-Control': 'no-store' });
    res.end(b);
}
function pinOk(req, q, res) {
    const ip = req.socket.remoteAddress || '?', f = fails[ip];
    if (f && f.n >= 5 && Date.now() - f.at < 60000) { json(res, 429, { ok: false, error: 'Nhập sai quá nhiều lần. Chờ 1 phút rồi thử lại.' }); return false; }
    const given = String(q.pin || req.headers['x-pin'] || '');
    if (given === S.pin) { delete fails[ip]; return true; }
    fails[ip] = { n: (f && Date.now() - f.at < 60000 ? f.n : 0) + 1, at: Date.now() };
    json(res, 401, { ok: false, error: given ? 'Mã PIN chưa đúng.' : 'Cần mã PIN.' });
    return false;
}
function readBody(req, max) {
    return new Promise((resolve, reject) => {
        const parts = []; let len = 0, over = false;
        req.on('data', (c) => { if (over) return; len += c.length; if (len > max) { over = true; reject(new Error('quá lớn')); } else parts.push(c); });
        req.on('end', () => { if (!over) resolve(Buffer.concat(parts, len)); });
        req.on('error', reject);
    });
}
let pageHtml = null;
async function handle(req, res) {
    const u = url.parse(req.url, true), q = u.query, p = u.pathname;
    if (req.method === 'GET' && (p === '/' || p === '/index.html')) {
        if (!pageHtml) pageHtml = fs.readFileSync(path.join(__dirname, 'page.html'));
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
        return res.end(pageHtml);
    }
    if (p === '/favicon.ico') { res.writeHead(204); return res.end(); }
    if (p.indexOf('/api/') !== 0) { res.writeHead(404); return res.end(); }
    if (!pinOk(req, q, res)) return;
    try {
        if (req.method === 'GET' && p === '/api/state') return json(res, 200, { ok: true, version: VERSION, custom: S.custom, max: MAX_CUSTOM });
        if (req.method === 'GET' && p === '/api/search') return json(res, 200, { ok: true, results: await search(q.q) });
        if (req.method === 'POST' && p === '/api/add') { const b = JSON.parse((await readBody(req, 4096)).toString('utf8') || '{}'); const c = addCustom(b); return json(res, 200, { ok: true, added: c, custom: S.custom }); }
        if (req.method === 'POST' && p === '/api/remove') { const b = JSON.parse((await readBody(req, 4096)).toString('utf8') || '{}'); removeCustom(String(b.key || '')); return json(res, 200, { ok: true, custom: S.custom }); }
    } catch (e) {
        if (e.bad) return json(res, 400, { ok: false, error: e.message });
        log(p + ' failed: ' + e.message);
        return json(res, 502, { ok: false, error: 'Không tìm được lúc này (xe có mạng không?): ' + e.message });
    }
    res.writeHead(404); res.end();
}

/** The head unit's addresses, the likeliest for a phone first (the default route's, then Wi-Fi's, then private ranges). */
let lastIfaces = {};
function addresses() {
    if (CFG.ips) return CFG.ips.split(',');
    let via = '';
    try {
        const rows = fs.readFileSync(CFG.route, 'utf8').split('\n').slice(1).map((l) => l.trim().split(/\s+/)).filter((c) => c.length > 7 && c[1] === '00000000' && c[7] === '00000000');
        rows.sort((x, y) => Number(x[6]) - Number(y[6])); via = rows.length ? rows[0][0] : '';
    } catch (e) { via = ''; }
    const out = [], nets = os.networkInterfaces();
    Object.keys(nets).forEach((name) => (nets[name] || []).forEach((a) => {
        if (a.internal || (a.family !== 'IPv4' && a.family !== 4) || /^169\.254\./.test(a.address)) return;
        const range = /^192\.168\./.test(a.address) ? 0 : /^172\.(1[6-9]|2\d|3[01])\./.test(a.address) ? 1 : /^10\./.test(a.address) ? 2 : 3;
        out.push({ ip: a.address, iface: name, rank: (name === via ? 0 : /^(wl|ml|uap|ap|wifi)/i.test(name) ? 10 : 20) + range });
    }));
    lastIfaces = {}; out.forEach((a) => { lastIfaces[a.ip] = a.iface; });
    return out.sort((a, b) => a.rank - b.rank).map((a) => a.ip);
}

/* The head unit's firewall (nftables: table ip filter, chain input) drops what it does not accept: this tool keeps one rule
 * of its own (comment "thoi-tiet") that lets the phone reach its port, and takes it away when it stops (`fwclose`). */
const FW_TAG = 'thoi-tiet';
function execNft(args) {
    return new Promise((resolve, reject) => cp.execFile(CFG.nft, args, { timeout: 15000, maxBuffer: 4 << 20 }, (err, out, stderr) => {
        if (!err) return resolve(out);
        const e = new Error('nft ' + args.join(' ') + ': ' + (String(stderr || '').trim() || err.message));
        e.absent = err.code === 'ENOENT' || /No such file or directory/.test(String(stderr));
        reject(e);
    }));
}
const fwRules = (out) => out.split('\n').filter((l) => /# handle \d+\s*$/.test(l) && !/^\s*(chain|table)\b/.test(l));
const fwMine = (rules) => rules.filter((l) => l.indexOf('comment "' + FW_TAG + '"') >= 0);
async function fwClose(nft) {
    nft = nft || execNft;
    let out;
    try { out = await nft(['-a', 'list', 'chain', 'ip', 'filter', 'input']); } catch (e) { if (e.absent) return 'absent'; throw e; }
    const mine = fwMine(fwRules(out));
    for (let i = 0; i < mine.length; i++) await nft(['delete', 'rule', 'ip', 'filter', 'input', 'handle', /# handle (\d+)\s*$/.exec(mine[i])[1]]);
    return 'closed';
}
/** Exactly one rule of this tool in ip filter input (anywhere in it: another tool may have put its own above): 'kept' | 'added' | 'absent'. */
async function fwEnsure(port, iface, nft) {
    nft = nft || execNft;
    let out;
    try { out = await nft(['-a', 'list', 'chain', 'ip', 'filter', 'input']); } catch (e) { if (e.absent) return 'absent'; throw e; }
    const mine = fwMine(fwRules(out));
    const want = (iface ? ['iifname', '"' + iface + '"'] : []).concat(['tcp', 'dport', String(port), 'accept', 'comment', '"' + FW_TAG + '"']);
    const same = (l) => l.indexOf('dport ' + port + ' ') >= 0 && (iface ? l.indexOf('iifname "' + iface + '"') >= 0 : l.indexOf('iifname') < 0);
    if (mine.length === 1 && same(mine[0])) return 'kept';
    await fwClose(nft);
    await nft(['insert', 'rule', 'ip', 'filter', 'input'].concat(want));
    return 'added';
}
let fwLast = '', fwBusy = false;
function fwCheck() {
    if (fwBusy || !S.port) return Promise.resolve();
    const ips = addresses(), ip = ips.length ? ips[S.ipIndex % ips.length] : '';
    fwBusy = true;
    return fwEnsure(S.port, ip ? (lastIfaces[ip] || '') : '').then((r) => {
        if (r !== 'kept' && r !== fwLast) log(r === 'added' ? 'firewall: port ' + S.port + ' open on ' + (lastIfaces[ip] || 'every interface') : 'firewall: no ip filter input chain, nothing to open');
        if (r !== 'kept') fwLast = r;
    }, (e) => { if (e.message !== fwLast) log('firewall: ' + e.message); fwLast = e.message; }).then(() => { fwBusy = false; });
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
    if (c.cmd === 'new_pin') { S.pin = newPin(); writeStatus(); }
    else if (c.cmd === 'next_ip') { S.ipIndex++; fwLast = ''; fwCheck(); writeStatus(); }
    else if (c.cmd === 'places' && setPlaces(c.places)) { for (const k of Object.keys(S.data)) if (!S.places.some((p) => p.key === k)) delete S.data[k]; refreshAll(); }
    else if (c.cmd === 'refresh' && !first) refreshAll();
}

const VERSION = '0.3.1';
function start() {
    try { mkdirp(CFG.state); } catch (e) { /* tests */ }
    S.pin = newPin(); loadCustom();
    const saved = readJson(path.join(CFG.state, 'places.json'));
    if (saved) setPlaces(saved);
    writeStatus();
    log('thoi-tiet ' + VERSION + ' started, ' + S.places.length + ' places, ' + S.custom.length + ' own');
    if (!CFG.noServer) {
        const server = httpMod.createServer((req, res) => handle(req, res).catch((e) => { log('request failed: ' + e.message); try { json(res, 500, { ok: false, error: e.message }); } catch (e2) { /* gone */ } }));
        let port = CFG.port;
        server.on('error', (e) => { if (e.code === 'EADDRINUSE' && port < CFG.port + 9) { port++; server.listen(port, '0.0.0.0'); } else log('server: ' + e.message); });
        server.on('listening', () => { S.port = server.address().port; log('page on port ' + S.port + ', PIN ' + S.pin); writeStatus(); fwCheck(); });
        server.listen(port, '0.0.0.0');
        S.server = server;
    }
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
    if (cmd === 'fwclose') fwClose().then((r) => process.stdout.write(r + '\n'), (e) => { process.stdout.write(e.message + '\n'); });
    else if (cmd === 'status') process.stdout.write(JSON.stringify(readJson(path.join(CFG.run, 'weather.json')) || {}, null, 2) + '\n');
    else start();
}

module.exports = { CFG, S, nameServers, resolveHost, handle, search, plain, addCustom, removeCustom, loadCustom, fwEnsure, fwClose, newPin, addresses, parse, parseAir, getJson, setPlaces, refreshAll, fetchPlace, pollCommands, writeStatus, findApp, start, VERSION, FORECAST };
