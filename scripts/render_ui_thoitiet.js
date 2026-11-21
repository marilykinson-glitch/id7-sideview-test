'use strict';
/**
 * Draws the Thời tiết screen in a few states to PNG files:  node scripts/render_ui_thoitiet.js <out dir>
 * Uses a built app's kit (dist/anh_dai_dien, with the Vietnamese fonts).
 */
const fs = require('fs'), path = require('path');
const K = path.join(__dirname, '..', 'dist', 'anh_dai_dien', 'source', 'javascript', 'kit');
const Module = require('module');
const load = Module._load;                              // the app finds the kit as ./kit/...: here it is the built one
Module._load = function (request, parent, isMain) { return load.call(this, /^\.\/kit\//.test(request) ? path.join(K, request.slice(6)) : request, parent, isMain); };
const { Canvas } = require(path.join(K, 'canvas.js'));
const G = require(path.join(K, 'gauges.js'));
const { Recorder, play } = require(path.join(K, 'record.js'));
const themes = require(path.join(K, 'themes.js'));
const UI = require(path.join(__dirname, '..', 'apps', 'thoi_tiet', 'ui.js'));
const Wx = require(path.join(__dirname, '..', 'apps', 'thoi_tiet', 'weather.js'));
const out = process.argv[2] || '/tmp/tt';
fs.mkdirSync(out, { recursive: true });
const theme = themes.theme(themes.ids ? (Array.isArray(themes.ids) ? themes.ids[0] : themes.ids()[0]) : undefined);

function sample(o) {
    o = o || {};
    const codes = o.codes || [2, 2, 3, 61, 80, 95, 3, 1], hours = [];
    for (let i = 0; i < 24; i++) { const h = (14 + i) % 24; hours.push({ time: (h < 10 ? '0' : '') + h + ':00', t: (o.t || 31) - Math.abs(i - 3) * 0.7 - (i > 8 ? 3 : 0), pop: [0, 0, 10, 40, 60, 70, 20, 0][i % 8], code: codes[Math.floor(i / 3) % 8], day: h >= 6 && h < 18 }); }
    const daily = [];
    for (let i = 0; i < 6; i++) daily.push({ date: '2026-11-2' + (1 + i), dow: (6 + i) % 7, code: [95, 61, 3, 2, 80, 1][i], hi: 33 - i, lo: 25 - (i % 3), pop: [70, 55, 20, 10, 45, 5][i], uv: 8 - i, sunrise: '06:02', sunset: '17:28' });
    return { key: 'x', name: o.name || 'TP. Hồ Chí Minh', ok: true, at: Date.now(), error: '', here: false, air: o.air === undefined ? { aqi: 87, pm25: 29, pm10: 41, o3: 60, no2: 12 } : o.air, current: { t: o.t || 31, feels: (o.t || 31) + 5, humidity: 74, wind: 12, windDir: 135, code: o.code === undefined ? 2 : o.code, day: o.day !== false, rain: 0, pressure: 1009, time: '2026-11-21T14:00' }, hourly: hours, daily };
}
const places = Wx.placesFor(['here', 'hcm', 'hanoi', 'danang']);
const base = { set: Wx.settingsOf(null), fx: true, time: 3.2, mode: 'main', state: 'ok', places, sel: 1, data: sample(), busy: false, updated: '11:20', pick: { keys: ['here', 'hcm', 'hanoi', 'danang'], page: 0, pages: 2, region: 'all', max: 6, items: [Wx.HERE].concat(Wx.CITIES).slice(0, 24) }, message: '', messageKind: 'dim' };
const fxs = (name, o, extra) => Object.assign({}, base, { sel: 1, data: sample(Object.assign({ name: 'TP. Hồ Chí Minh' }, o)) }, extra || {});
const withSet = (o, extra) => Object.assign({}, base, { set: Wx.settingsOf(o) }, extra || {});
const states = {
    '15-cai-dat': Object.assign({}, base, { mode: 'settings', widget: { version: '0.5.5', ready: true, n: 1, frames: 12, ok: 0, lines: ['widget initialized', 'widget ready: []', 'warn: widget image 1: TypeError: example error'] }, set: Wx.settingsOf({ tiles: ['wind', 'humidity', 'uv', 'aqi', 'vis', 'sun'], block: 'chart', days: true, tips: true, fx: true, unit: 'C' }) }),
    '16-bieu-do': withSet({ tiles: ['wind', 'humidity', 'rain', 'uv', 'aqi'], block: 'chart' }, { time: 5 }),
    '17-cung-mat-troi': withSet({ tiles: ['wind', 'humidity', 'rain', 'uv', 'aqi'], block: 'sun' }),
    '18-8-o-nhieu-thong-so': withSet({ tiles: ['wind', 'gust', 'humidity', 'rain', 'uv', 'aqi', 'vis', 'pressure'], block: 'icons', unit: 'F' }),
    '19-chi-con-5-ngay': withSet({ tiles: ['aqi', 'uv'], block: 'off', fx: false }),
    '20-che-do-lai': Object.assign({}, base, { drive: true, time: 6, data: sample({ code: 63, t: 26 }) }),
    '21-tim-bang-dien-thoai': Object.assign({}, base, { mode: 'phone', phone: { url: 'http://192.168.43.15:8138/?pin=4821', pin: '4821', host: '192.168.43.15:8138', count: 2 } }),
    '22-cua-toi': Object.assign({}, base, { mode: 'pick', pick: { keys: ['here', 'hcm', 'c1234_5678'], page: 0, pages: 1, region: 'my', max: 6, items: [{ key: 'c1234_5678', name: 'Chiang Mai' }, { key: 'c2_3', name: 'Cao Bang' }] } }),
    '7-nang': fxs(null, { code: 0, t: 34 }, { time: 4.1 }),
    '8-mua': fxs(null, { code: 63, t: 26 }),
    '9-giong': fxs(null, { code: 95, t: 27 }, { time: 0.05 }),
    '10-may': fxs(null, { code: 3, t: 28 }),
    '11-tuyet': fxs(null, { code: 73, t: -2, name: 'Moskva' }),
    '12-suong': fxs(null, { code: 45, t: 14 }),
    '13-dem-sao': fxs(null, { code: 0, day: false, t: 19 }),
    '14-chon-nuoc-ngoai': Object.assign({}, base, { mode: 'pick', pick: { keys: ['here', 'hcm', 'tokyo', 'munich'], page: 0, pages: 1, region: 'nn', max: 6, items: Wx.listFor('nn') } }),
    '1-hom-nay': base,
    '24-sap-mua': fxs(null, { code: 3 }, { data: (() => { const d = sample({ code: 3 }); d.current.rainIn = 25; return d; })() }),
    '2-mua-giong': Object.assign({}, base, { sel: 3, data: sample({ name: 'Đà Nẵng', code: 95, t: 27, codes: [95, 65, 61, 80, 3, 3, 2, 1] }) }),
    '3-ban-dem': Object.assign({}, base, { sel: 2, data: sample({ name: 'Hà Nội', code: 0, day: false, t: 17, air: { aqi: 168, pm25: 85, pm10: 110, o3: 30, no2: 25 } }) }),
    '4-chon-dia-diem': Object.assign({}, base, { mode: 'pick', pick: { keys: ['here', 'hcm', 'hanoi', 'danang'], page: 0, pages: 3, region: 'all', max: 6, items: Wx.listFor('all').slice(0, 24) }, message: 'Tối đa 6 địa điểm: bỏ bớt một nơi trước.', messageKind: 'warn' }),
    '5-chua-co-mang': Object.assign({}, base, { data: { key: 'x', name: 'TP. Hồ Chí Minh', ok: false, at: 0, error: 'timeout', current: null, hourly: [], daily: [] }, updated: '' }),
    '6-tro-thu-chua-chay': Object.assign({}, base, { state: 'down', data: null }),
};
Object.keys(states).forEach((k) => {
    const r = new Recorder(UI.W, UI.H, { textScale: 1 });
    r.own = true;
    UI.draw(r, G, theme, states[k], {});
    const cv = new Canvas(UI.W, UI.H);
    play(r.words(), cv);
    fs.writeFileSync(path.join(out, k + '.png'), cv.png());
    console.log(path.join(out, k + '.png'));
});

// the car's screen with room under the page (cv.extra): the page must reach down into it
['1-hom-nay', '20-che-do-lai'].forEach((k) => {
    if (!states[k]) return;
    const ex = 56, r = new Recorder(UI.W, UI.H + ex, { textScale: 1 });
    r.own = true; r.extra = ex;
    UI.draw(r, G, theme, states[k], {});
    const cv = new Canvas(UI.W, UI.H + ex);
    play(r.words(), cv);
    fs.writeFileSync(path.join(out, k + '-xe.png'), cv.png());
});

// the home-screen widget, small and big (sizes are a guess from the home screen: the small cell is about 3:1)
{
    const w0 = sample({ code: 80 }); w0.current.rainIn = 20;
    [[640, 210, w0], [1000, 575, w0], [1000, 575, sample({ code: 2 })]].forEach((a, i) => {
        const rec = new Recorder(a[0], a[1], { textScale: 1 }), c2 = new Canvas(a[0], a[1]);
        UI.drawWidget(rec, G, theme, { data: a[2], big: a[0] > 700, w: a[0], h: a[1], tiles: Wx.settingsOf(null).tiles });
        play(rec.words(), c2); fs.writeFileSync(path.join(out, 'widget-' + i + '.png'), c2.png());
    });
}
