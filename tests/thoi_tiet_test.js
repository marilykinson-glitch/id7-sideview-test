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
assert.ok(Wx.REGIONS.every((r) => r[0] === 'all' || r[0] === 'my' || Wx.listFor(r[0]).length > 0)); assert.strictEqual(Wx.listFor('all')[0].key, 'here'); assert.ok(Wx.listFor('nn').some((c) => c.key === 'tokyo')); assert.ok(Wx.listFor('tn').length >= 3);
assert.strictEqual(Wx.listFor('all').length, Wx.CITIES.length + 1); ok('regions');
const hr = (code, pop, time) => ({ code, pop, time });
assert.strictEqual(Wx.tip({ code: 61, t: 28, wind: 5, day: true }, {}, [], null).kind, 'warn'); assert.strictEqual(Wx.tip({ code: 95 }, {}, [], null).kind, 'crit');
assert.strictEqual(Wx.tip({ code: 3, t: 28, wind: 5, day: true }, {}, [hr(3, 0, '14:00'), hr(3, 10, '15:00'), hr(61, 70, '16:00')], null).text, 'Mưa lúc 16:00');
assert.strictEqual(Wx.tip({ code: 1, t: 28, wind: 5, day: true }, { uv: 3 }, [hr(1, 0, 'a'), hr(1, 0, 'b')], null), null);
assert.ok(/Tuyết/.test(Wx.tip({ code: 73 }, {}, [], null).text)); ok('driver tips');
assert.strictEqual(Wx.placesFor(Wx.CITIES.map((c) => c.key)).length, Wx.MAX_PLACES); assert.ok(Wx.CITIES.every((c) => isFinite(c.lat) && isFinite(c.lon) && c.region)); assert.strictEqual(new Set(Wx.CITIES.map((c) => c.key)).size, Wx.CITIES.length); ok('places');

assert.deepStrictEqual(Wx.settingsOf({ tiles: ['aqi', 'zz', 'wind'], block: 'x', unit: 'F', days: false }), { tiles: ['wind', 'aqi'], block: 'icons', days: false, tips: true, fx: true, unit: 'F' });
assert.deepStrictEqual(Wx.settingsOf(null), Wx.DEFAULT_SETTINGS); assert.strictEqual(Wx.settingsOf({ tiles: Wx.TILES.map((x) => x[0]).concat(Wx.TILES.map((x) => x[0])) }).tiles.length, Wx.MAX_TILES); ok('settings are made valid');
Wx.setUnit('F'); assert.strictEqual(Wx.deg(30), '86°'); assert.strictEqual(Wx.deg(-5), '23°'); Wx.setUnit('C'); assert.strictEqual(Wx.deg(30), '30°'); ok('units');
const sd = Wx.sunDay('2026-11-21T14:00', { sunrise: '06:02', sunset: '17:28' });
assert.strictEqual(sd.left, 208); assert.ok(sd.p > 0.69 && sd.p < 0.7); assert.strictEqual(Wx.sunDay('2026-11-21T20:00', { sunrise: '06:02', sunset: '17:28' }).p, null); assert.strictEqual(Wx.sunDay('x', {}), null); ok('the sun today');
const cur0 = { wind: 12.4, windDir: 135, gust: 30, humidity: 74, rain: 0, vis: 24000, pressure: 1008.6, time: '2026-11-21T14:00' };
assert.strictEqual(Wx.tileInfo('wind', cur0, {}, [], null).value, '12'); assert.strictEqual(Wx.tileInfo('vis', cur0, {}, [], null).value, '24'); assert.strictEqual(Wx.tileInfo('vis', Object.assign({}, cur0, { vis: 3200 }), {}, [], null).value, '3.2');
assert.strictEqual(Wx.tileInfo('pressure', cur0, {}, [], null).value, '1009'); assert.strictEqual(Wx.tileInfo('aqi', cur0, {}, [], { aqi: 87 }).sub, 'Trung bình'); assert.strictEqual(Wx.tileInfo('aqi', cur0, {}, [], null).value, '–');
assert.strictEqual(Wx.tileInfo('sun', cur0, { sunrise: '06:02', sunset: '17:28' }, [], null).title, 'Lặn lúc'); assert.strictEqual(Wx.tileInfo('sun', Object.assign({}, cur0, { time: '2026-11-21T20:00' }), { sunrise: '06:02', sunset: '17:28' }, [{}, { sunrise: '06:03' }], null).value, '06:03');
assert.ok(Wx.TILES.every((x) => Wx.tileInfo(x[0], cur0, { pop: 10, uv: 3 }, [], null).title)); ok('tiles');
const own = [{ key: 'c1_2', name: 'Chiang Mai', lat: 18.8, lon: 98.97 }];
assert.deepStrictEqual(Wx.placesFor(['here', 'c1_2', 'zz'], own).map((p) => p.key), ['here', 'c1_2']); assert.strictEqual(Wx.listFor('my', own).length, 1); assert.strictEqual(Wx.listFor('all', own).length, Wx.CITIES.length + 2); assert.strictEqual(Wx.listFor('my', []).length, 0); ok('places from the phone');

/* the tool */
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tt-'));
process.env.TT_NO_SERVER = '1'; process.env.TT_IPS = '192.168.43.15'; process.env.TT_RUN = path.join(dir, 'run'); process.env.TT_STATE = path.join(dir, 'state'); process.env.TT_OAP = path.join(dir, 'oap');
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
    if (/^\/v1\/search/.test(req.url)) { res.setHeader('Content-Type', 'application/json'); return res.end(JSON.stringify({ results: [{ name: 'Düsseldorf', latitude: 51.22, longitude: 6.78, admin1: 'Nordrhein-Westfalen', country: 'Đức' }, { name: 'Bad', latitude: 'x', longitude: 1 }] })); }
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
    T.S.data.hcm.ok = true; T.S.data.hcm.at = Date.now() - 3600000; const good = T.S.data.hcm.current;
    T.S.places = T.S.places.map((q) => (q.key === 'hcm' ? Object.assign({}, q, { lat: 50, lon: 5 }) : q));
    await T.refreshAll();
    assert.strictEqual(T.S.data.hcm.ok, false); assert.deepStrictEqual(T.S.data.hcm.current, good); ok('a failure keeps the old forecast, marked');
    // the app's command
    const root = path.join(dir, 'oap', 'oap_1'); fs.mkdirSync(path.join(root, 'source', 'javascript', 'kit'), { recursive: true }); fs.mkdirSync(path.join(root, 'data'));
    fs.writeFileSync(path.join(root, 'source', 'javascript', 'kit', 'app-spec.json'), JSON.stringify({ id: 'thoi_tiet' }));
    fs.writeFileSync(path.join(root, 'data', 'command.json'), JSON.stringify({ id: 1, cmd: 'places', places: [{ key: 'hcm', name: 'HCM', lat: 10.7, lon: 106.7 }] }));
    T.pollCommands(); await T.refreshAll();
    assert.deepStrictEqual(T.S.places.map((q) => q.key), ['hcm']); assert.strictEqual(T.S.data.hcm.ok, true); ok('the app\'s command changes the places');
    /* names: the servers asked when the system's resolver fails */
    const rt = path.join(dir, 'route'); fs.writeFileSync(rt, 'Iface\tDestination\tGateway\tFlags\tRefCnt\tUse\tMetric\tMask\nwlan0\t00000000\t012BA8C0\t0003\t0\t0\t0\t00000000\n');
    T.CFG.route = rt; T.CFG.dns = '10.1.1.1, 127.0.0.1, nonsense';
    const ns = T.nameServers(); assert.strictEqual(ns[0], '10.1.1.1'); assert.ok(ns.indexOf('192.168.43.1') > 0); assert.ok(ns.indexOf('127.0.0.1') < 0 && ns.indexOf('nonsense') < 0); ['1.1.1.1', '8.8.8.8', '9.9.9.9'].forEach((x) => assert.ok(ns.indexOf(x) >= 0)); assert.strictEqual(new Set(ns).size, ns.length); ok('name servers: the gateway of a hotspot, then public ones');
    /* the phone's page */
    assert.strictEqual(T.plain('Düsseldorf'), 'Dusseldorf'); assert.strictEqual(T.plain('Hà Nội'), 'Hà Nội'); assert.strictEqual(T.plain('東京 Tokyo'), 'Tokyo'); assert.strictEqual(T.plain('São Paulo'), 'São Paulo'); assert.strictEqual(T.plain('Zürich'), 'Zurich'); ok('names the car can draw');
    const found = await T.search('dus'); assert.strictEqual(found.length, 1); assert.strictEqual(found[0].name, 'Dusseldorf'); assert.strictEqual(found[0].where, 'Nordrhein-Westfalen, Đức'); assert.deepStrictEqual(await T.search('d'), []); ok('search');
    const web = http.createServer((q, r) => T.handle(q, r)); await new Promise((r) => web.listen(0, '127.0.0.1', r));
    const call = (method, p, body, pin) => new Promise((resolve, reject) => {
        const rq = http.request({ host: '127.0.0.1', port: web.address().port, path: p + (p.indexOf('?') < 0 ? '?' : '&') + 'pin=' + (pin || T.S.pin), method }, (res) => { const c = []; res.on('data', (d) => c.push(d)); res.on('end', () => resolve({ code: res.statusCode, text: Buffer.concat(c).toString(), json: (() => { try { return JSON.parse(Buffer.concat(c).toString()); } catch (e) { return null; } })() })); });
        rq.on('error', reject); if (body) rq.write(JSON.stringify(body)); rq.end();
    });
    T.S.pin = '4321'; T.S.custom = [];
    assert.strictEqual((await call('GET', '/')).code, 200); assert.ok(/Thời tiết cho xe/.test((await call('GET', '/')).text));
    assert.strictEqual((await call('GET', '/api/state', null, '0000')).code, 401); assert.strictEqual((await call('GET', '/api/state')).json.custom.length, 0); ok('the page and the PIN');
    const add = await call('POST', '/api/add', { name: 'Düsseldorf', lat: 51.22, lon: 6.78 });
    assert.strictEqual(add.json.added.name, 'Dusseldorf'); assert.strictEqual(add.json.custom.length, 1); assert.strictEqual(T.S.lastAdded, add.json.added.key);
    await call('POST', '/api/add', { name: 'Düsseldorf', lat: 51.22, lon: 6.78 }); assert.strictEqual(T.S.custom.length, 1);
    assert.strictEqual((await call('POST', '/api/add', { name: '', lat: 1, lon: 1 })).code, 400); assert.strictEqual((await call('POST', '/api/add', { name: 'X', lat: 99, lon: 1 })).code, 400);
    assert.strictEqual(JSON.parse(fs.readFileSync(path.join(dir, 'state', 'custom.json'), 'utf8')).length, 1);
    const st2 = T.writeStatus(); assert.strictEqual(st2.custom.length, 1); assert.ok(st2.seq >= 1); assert.strictEqual(st2.pin, '4321');
    assert.strictEqual((await call('GET', '/api/search?q=dus')).json.results.length, 1);
    assert.strictEqual((await call('POST', '/api/remove', { key: add.json.added.key })).json.custom.length, 0); ok('add, remove, keep');
    const pl = await call('GET', '/api/places'); assert.ok(pl.json.places.some((x) => x.key === 'hcm')); assert.ok(/^\/v1\/forecast/.test(pl.json.forecast) && /^\/v1\/air-quality/.test(pl.json.air));
    T.S.data.hcm = { key: 'hcm', name: 'old', ok: false, at: 0, error: 'EAI_AGAIN', current: null, hourly: [], daily: [] };
    const pushed = await call('POST', '/api/push', { key: 'hcm', name: 'HCM', forecast: answer, air: { current: { us_aqi: 55 } } });
    assert.strictEqual(pushed.json.accepted, 'hcm'); assert.strictEqual(T.S.data.hcm.ok, true); assert.strictEqual(T.S.data.hcm.via, 'phone'); assert.strictEqual(T.S.data.hcm.air.aqi, 55); assert.strictEqual(T.S.data.hcm.current.t, 31.2); assert.strictEqual(T.S.data.hcm.name, 'HCM' === 'x' ? '' : T.S.places.filter((x) => x.key === 'hcm')[0].name);
    assert.strictEqual((await call('POST', '/api/push', { key: 'nope', forecast: answer })).code, 400); assert.strictEqual((await call('POST', '/api/push', { key: 'hcm', forecast: { current: {} } })).code, 400);
    T.S.places = T.S.places.map((q) => (q.key === 'hcm' ? Object.assign({}, q, { lat: 50, lon: 5 }) : q)); await T.refreshAll();     // the car's own fetch fails: what the phone sent a moment ago stays
    assert.strictEqual(T.S.data.hcm.ok, true); assert.strictEqual(T.S.data.hcm.via, 'phone'); ok('forecast sent by the phone');
    for (let i = 0; i < 6; i++) await call('GET', '/api/state', null, '9999'); assert.strictEqual((await call('GET', '/api/state', null, '9999')).code, 429); ok('wrong PINs are slowed down');
    web.close();
    /* the firewall rule: one rule of this tool, kept, replaced when the interface changes, taken away */
    let rules = ['table ip filter {', ' chain input {', '  iifname "lo" accept # handle 4', '  ct state established accept # handle 5', ' }', '}'];
    const nft = async (a) => {
        if (a[0] === '-a') return rules.join('\n');
        if (a[0] === 'insert') { rules.splice(2, 0, '  ' + a.slice(5).join(' ').replace(/"/g, '"') + ' # handle ' + (10 + rules.length)); return ''; }
        if (a[0] === 'delete') { const h = a[a.length - 1]; rules = rules.filter((l) => !new RegExp('# handle ' + h + '$').test(l)); return ''; }
        throw new Error('?');
    };
    assert.strictEqual(await T.fwEnsure(8138, 'wlan0', nft), 'added'); assert.strictEqual(await T.fwEnsure(8138, 'wlan0', nft), 'kept');
    rules.splice(2, 0, '  tcp dport 8137 accept comment "id-studio" # handle 77'); assert.strictEqual(await T.fwEnsure(8138, 'wlan0', nft), 'kept');   // another tool's rule above is no reason to move
    assert.strictEqual(await T.fwEnsure(8138, 'uap0', nft), 'added'); assert.strictEqual(rules.filter((l) => /thoi-tiet/.test(l)).length, 1); assert.ok(rules.some((l) => /id-studio/.test(l)));
    assert.strictEqual(await T.fwClose(nft), 'closed'); assert.strictEqual(rules.filter((l) => /thoi-tiet/.test(l)).length, 0); assert.ok(rules.some((l) => /id-studio/.test(l))); ok('firewall');
    srv.close();

    /* the drawing */
    const K = path.join(ROOT, 'dist', 'anh_dai_dien', 'source', 'javascript', 'kit');
    if (fs.existsSync(K)) {
        const Module = require('module'), load0 = Module._load;
        Module._load = function (request, parent, isMain) { return load0.call(this, /^\.\/kit\//.test(request) ? path.join(K, request.slice(6)) : request, parent, isMain); };
        const { Canvas } = require(path.join(K, 'canvas.js')), G = require(path.join(K, 'gauges.js')), themes = require(path.join(K, 'themes.js')), { Recorder } = require(path.join(K, 'record.js'));
        const UI = require(path.join(ROOT, 'apps', 'thoi_tiet', 'ui.js'));
        const t = themes.theme(themes.ids ? (Array.isArray(themes.ids) ? themes.ids[0] : themes.ids()[0]) : undefined);
        const places = Wx.placesFor(['hcm']);
        const data = { name: 'HCM', ok: true, at: 1, current: p.current, hourly: p.hourly, daily: [].concat(p.daily, p.daily, p.daily) };
        const Fx = require(path.join(ROOT, 'apps', 'thoi_tiet', 'fx.js'));
        ['clear', 'mostly-clear', 'partly', 'cloudy', 'fog', 'drizzle', 'rain', 'heavy-rain', 'showers', 'sleet', 'snow', 'storm'].forEach((k) => [true, false].forEach((day) => [0, 0.05, 1.7, 99].forEach((tm) => Fx.draw(new Recorder(UI.W, UI.H, { textScale: 1 }), G, k, day, 30, 30, 48, 520, 460, tm))));
        UI.draw(new Recorder(UI.W, UI.H, { textScale: 1 }), G, t, { fx: true, time: 2, mode: 'main', state: 'ok', places, sel: 0, data }, {});
        const rec = () => new Recorder(UI.W, UI.H, { textScale: 1 });
        Wx.TILES.length && ['icons', 'chart', 'sun', 'off'].forEach((b) => [false, true].forEach((fx) => UI.draw(rec(), G, t, { mode: 'main', state: 'ok', places, sel: 0, data: Object.assign({}, data, { air: { aqi: 90 } }), time: 3, set: Wx.settingsOf({ tiles: Wx.TILES.map((x) => x[0]), block: b, fx, unit: 'F' }) }, {})));
        UI.draw(rec(), G, t, { drive: true, mode: 'main', state: 'ok', places, sel: 0, data, time: 3 }, {}); UI.draw(rec(), G, t, { drive: true, mode: 'main', state: 'down', places, sel: 0, data: null }, {});
        UI.draw(rec(), G, t, { mode: 'settings', places, sel: 0, set: Wx.settingsOf(null) }, {}); UI.draw(rec(), G, t, { mode: 'phone', places, phone: { url: 'http://192.168.1.2:8138/?pin=1234', pin: '1234', host: '192.168.1.2:8138', count: 1 } }, {}); UI.draw(rec(), G, t, { mode: 'phone', state: 'ok', places, phone: {} }, {});
        UI.draw(rec(), G, t, { mode: 'pick', places, pick: { keys: [], page: 0, pages: 1, region: 'my', max: 6, items: [] } }, {});
        UI.draw(rec(), G, t, { mode: 'main', state: 'ok', places, sel: 0, data }, {}); UI.draw(new Recorder(UI.W, UI.H, { textScale: 1 }), G, t, { mode: 'main', state: 'down', places, sel: 0, data: null }, {});
        UI.draw(new Recorder(UI.W, UI.H, { textScale: 1 }), G, t, { mode: 'pick', places, sel: 0, pick: { keys: ['hcm'], page: 0, pages: 2, max: 6, items: Wx.CITIES.slice(0, 24) } }, {}); ok('the screens draw');
    } else console.log('skip - the screens (build dist/anh_dai_dien first)');
    console.log('all ' + n + ' passed');
});
