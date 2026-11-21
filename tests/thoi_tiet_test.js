'use strict';
/** Tests of Thời tiết: the words/places (apps/thoi_tiet/weather.js), the tool's reading of Open-Meteo, the tool end to end against a local server, and the drawing.  node tests/thoi_tiet_test.js */
const assert = require('assert'), fs = require('fs'), os = require('os'), path = require('path'), http = require('http');
const ROOT = path.join(__dirname, '..');
const Wx = require(path.join(ROOT, 'apps', 'thoi_tiet', 'weather.js'));
let n = 0; const ok = (m) => { n++; console.log('ok ' + n + ' - ' + m); };

/* words and places */
assert.strictEqual(Wx.describe(0).text, 'Trời quang'); assert.strictEqual(Wx.describe(95).icon, 'storm'); assert.strictEqual(Wx.describe(999).icon, 'cloudy'); ok('weather codes');
assert.strictEqual(Wx.compass(0), 'Bắc'); assert.strictEqual(Wx.compass(200), 'Nam'); assert.strictEqual(Wx.compass(359), 'Bắc'); assert.strictEqual(Wx.compass(null), ''); ok('wind directions');
assert.strictEqual(Wx.deg(28.6), '29°'); assert.strictEqual(Wx.deg(null), '–'); assert.strictEqual(Wx.uvText(9), 'Rất cao'); ok('numbers');
assert.deepStrictEqual(Wx.placesFor(['hcm', 'zz', 'hcm', 'hanoi']).map((p) => p.key), ['hcm', 'hanoi']); assert.deepStrictEqual(Wx.placesFor([]).map((p) => p.key), Wx.DEFAULT_KEYS);
assert.ok(Wx.REGIONS.every((r) => r[0] === 'all' || Wx.listFor(r[0]).length > 0)); assert.strictEqual(Wx.listFor('all')[0].key, 'here'); assert.ok(Wx.listFor('nn').some((c) => c.key === 'tokyo')); assert.ok(Wx.listFor('tn').length >= 3);
assert.strictEqual(Wx.listFor('all').length, Wx.CITIES.length + 1); ok('regions');
const hr = (code, pop, time) => ({ code, pop, time });
assert.strictEqual(Wx.tip({ code: 61, t: 28, wind: 5, day: true }, {}, [], null).kind, 'warn'); assert.strictEqual(Wx.tip({ code: 95 }, {}, [], null).kind, 'crit');
assert.strictEqual(Wx.tip({ code: 3, t: 28, wind: 5, day: true }, {}, [hr(3, 0, '14:00'), hr(3, 10, '15:00'), hr(61, 70, '16:00')], null).text, 'Mưa lúc 16:00');
assert.strictEqual(Wx.tip({ code: 1, t: 28, wind: 5, day: true }, { uv: 3 }, [hr(1, 0, 'a'), hr(1, 0, 'b')], null), null);
assert.ok(/Tuyết/.test(Wx.tip({ code: 73 }, {}, [], null).text)); ok('driver tips');
assert.strictEqual(Wx.placesFor(Wx.CITIES.map((c) => c.key)).length, Wx.MAX_PLACES); assert.ok(Wx.CITIES.every((c) => isFinite(c.lat) && isFinite(c.lon) && c.region)); assert.strictEqual(new Set(Wx.CITIES.map((c) => c.key)).size, Wx.CITIES.length); ok('places');

/* the tool */
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tt-'));
process.env.TT_RUN = path.join(dir, 'run'); process.env.TT_STATE = path.join(dir, 'state'); process.env.TT_OAP = path.join(dir, 'oap');
const T = require(path.join(ROOT, 'tools', 'thoi-tiet', 'thoi-tiet.js'));
const hrs = []; for (let i = 0; i < 48; i++) hrs.push('2026-11-21T' + ('0' + (i % 24)).slice(-2) + ':00');
const answer = { current: { time: '2026-11-21T14:00', temperature_2m: 31.2, apparent_temperature: 36, relative_humidity_2m: 74, wind_speed_10m: 12, wind_direction_10m: 135, weather_code: 2, is_day: 1, precipitation: 0, pressure_msl: 1009 },
    hourly: { time: hrs.map((s, i) => (i < 24 ? s : s.replace('21', '22'))), temperature_2m: hrs.map((_, i) => 20 + i % 10), precipitation_probability: hrs.map(() => 10), weather_code: hrs.map(() => 3), is_day: hrs.map((_, i) => (i % 24 >= 6 && i % 24 < 18 ? 1 : 0)) },
    daily: { time: ['2026-11-21', '2026-11-22', '2026-11-23'], weather_code: [95, 61, 3], temperature_2m_max: [33, 32, 31], temperature_2m_min: [25, 24, 24], precipitation_probability_max: [70, 50, 20], uv_index_max: [8, 7, 6], sunrise: ['2026-11-21T06:02', '', ''], sunset: ['2026-11-21T17:28', '', ''] } };
const p = T.parse(answer);
assert.strictEqual(p.current.t, 31.2); assert.strictEqual(p.current.day, true); assert.strictEqual(p.hourly.length, 24); assert.strictEqual(p.hourly[0].time, '14:00'); assert.strictEqual(p.daily[0].dow, 6); assert.strictEqual(p.daily[0].sunrise, '06:02'); ok('parse');
assert.throws(() => T.parse({}), /unexpected/); assert.throws(() => T.parse({ current: {}, hourly: {}, daily: {} }), /temperature/); ok('parse refuses junk');
assert.deepStrictEqual(T.parseAir({ current: { us_aqi: 87, pm2_5: 29.1, pm10: 41, ozone: 60, nitrogen_dioxide: 12 } }), { aqi: 87, pm25: 29.1, pm10: 41, o3: 60, no2: 12 }); assert.strictEqual(T.parseAir({ current: {} }), null); assert.strictEqual(T.parseAir(null), null);
assert.strictEqual(Wx.aqiBand(30).text, 'Tốt'); assert.strictEqual(Wx.aqiBand(168).text, 'Xấu'); assert.strictEqual(Wx.aqiBand(null).text, ''); ok('air quality');
assert.ok(!T.setPlaces([{ key: 'a', name: 'A', lat: 999, lon: 0 }])); assert.ok(T.setPlaces([{ key: 'here', name: 'Đây', here: true }, { key: 'hcm', name: 'HCM', lat: 10.7, lon: 106.7 }])); ok('places are checked');

const hits = [];
const srv = http.createServer((req, res) => {
    hits.push(req.url);
    if (/^\/v1\/air-quality/.test(req.url)) { res.setHeader('Content-Type', 'application/json'); return res.end(JSON.stringify({ current: { us_aqi: 87, pm2_5: 29, pm10: 41, ozone: 60, nitrogen_dioxide: 12 } })); }
    if (/^\/v1\/forecast/.test(req.url) && /latitude=10\.7/.test(req.url)) { res.setHeader('Content-Type', 'application/json'); return res.end(JSON.stringify(answer)); }
    if (/^\/v1\/forecast/.test(req.url)) { res.statusCode = 500; return res.end('no'); }
    res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ success: true, latitude: 21.03, longitude: 105.85, city: 'Hanoi' }));
});
srv.listen(0, '127.0.0.1', async () => {
    T.CFG.base = 'http://127.0.0.1:' + srv.address().port;
    await T.refreshAll();
    const st = JSON.parse(fs.readFileSync(path.join(dir, 'run', 'weather.json'), 'utf8'));
    assert.strictEqual(st.places.length, 2);
    const here = st.places[0], hcm = st.places[1];
    assert.strictEqual(hcm.ok, true); assert.strictEqual(hcm.current.t, 31.2); assert.strictEqual(hcm.air.aqi, 87);
    assert.strictEqual(here.ok, false); assert.ok(here.error);          // the here place used 21.03: the fake server fails it
    assert.strictEqual(here.name, 'Hanoi'); ok('end to end: a good place, a failing one, the place by address');
    // a failure keeps the last good forecast
    T.S.data.hcm.ok = true; const good = T.S.data.hcm.current;
    T.S.places = T.S.places.map((q) => (q.key === 'hcm' ? Object.assign({}, q, { lat: 50, lon: 5 }) : q));
    await T.refreshAll();
    assert.strictEqual(T.S.data.hcm.ok, false); assert.deepStrictEqual(T.S.data.hcm.current, good); ok('a failure keeps the old forecast, marked');
    // the app's command
    const root = path.join(dir, 'oap', 'oap_1'); fs.mkdirSync(path.join(root, 'source', 'javascript', 'kit'), { recursive: true }); fs.mkdirSync(path.join(root, 'data'));
    fs.writeFileSync(path.join(root, 'source', 'javascript', 'kit', 'app-spec.json'), JSON.stringify({ id: 'thoi_tiet' }));
    fs.writeFileSync(path.join(root, 'data', 'command.json'), JSON.stringify({ id: 1, cmd: 'places', places: [{ key: 'hcm', name: 'HCM', lat: 10.7, lon: 106.7 }] }));
    T.pollCommands(); await T.refreshAll();
    assert.deepStrictEqual(T.S.places.map((q) => q.key), ['hcm']); assert.strictEqual(T.S.data.hcm.ok, true); ok('the app\'s command changes the places');
    srv.close();

    /* the drawing */
    const K = path.join(ROOT, 'dist', 'anh_dai_dien', 'source', 'javascript', 'kit');
    if (fs.existsSync(K)) {
        const { Canvas } = require(path.join(K, 'canvas.js')), G = require(path.join(K, 'gauges.js')), themes = require(path.join(K, 'themes.js')), { Recorder } = require(path.join(K, 'record.js'));
        const UI = require(path.join(ROOT, 'apps', 'thoi_tiet', 'ui.js'));
        const t = themes.theme(themes.ids ? (Array.isArray(themes.ids) ? themes.ids[0] : themes.ids()[0]) : undefined);
        const places = Wx.placesFor(['hcm']);
        const data = { name: 'HCM', ok: true, at: 1, current: p.current, hourly: p.hourly, daily: [].concat(p.daily, p.daily, p.daily) };
        const Fx = require(path.join(ROOT, 'apps', 'thoi_tiet', 'fx.js'));
        ['clear', 'mostly-clear', 'partly', 'cloudy', 'fog', 'drizzle', 'rain', 'heavy-rain', 'showers', 'sleet', 'snow', 'storm'].forEach((k) => [true, false].forEach((day) => [0, 0.05, 1.7, 99].forEach((tm) => Fx.draw(new Recorder(UI.W, UI.H, { textScale: 1 }), G, k, day, 30, 30, 48, 520, 460, tm))));
        UI.draw(new Recorder(UI.W, UI.H, { textScale: 1 }), G, t, { fx: true, time: 2, mode: 'main', state: 'ok', places, sel: 0, data }, {});
        UI.draw(new Recorder(UI.W, UI.H, { textScale: 1 }), G, t, { mode: 'main', state: 'ok', places, sel: 0, data }, {}); UI.draw(new Recorder(UI.W, UI.H, { textScale: 1 }), G, t, { mode: 'main', state: 'down', places, sel: 0, data: null }, {});
        UI.draw(new Recorder(UI.W, UI.H, { textScale: 1 }), G, t, { mode: 'pick', places, sel: 0, pick: { keys: ['hcm'], page: 0, pages: 2, max: 6, items: Wx.CITIES.slice(0, 24) } }, {}); ok('the screens draw');
    } else console.log('skip - the screens (build dist/anh_dai_dien first)');
    console.log('all ' + n + ' passed');
});
