'use strict';
/**
 * ui.js - the Thời tiết screen, a pure draw(cv, G, t, v, act) for the car and the preview.
 *
 * Main: the places as tabs (and a button for the list of places), the weather of the chosen place: icon, temperature,
 * words, feels-like / high / low, four small figures (wind, humidity, rain, UV), the next hours, the next five days.
 * Pick: the list of places to choose from (tap to add or drop).
 *
 * v = { mode: 'main' | 'pick', state: 'ok' | 'down' | 'wait' | 'offline', places: [{ key, name, here }], sel (index),
 *       data: the chosen place's { name, ok, at, error, current, hourly, daily } or null, updated: 'HH:MM', busy,
 *       pick: { keys: [chosen keys], page, pages, items: [{ key, name }], max }, message, messageKind }
 * act = { select(i), openPick, closePick, togglePlace(key), page(delta), refresh }
 * Node 8.
 */
const Wx = require('./weather');
const Icons = require('./icons');
const Fx = require('./fx');
const W = 1600, H = 520;
const nop = () => {};
const kindColor = (t, kind) => (kind === 'go' ? (t.go || '#2fd27a') : kind === 'warn' ? (t.warn || '#ffb020') : kind === 'crit' ? (t.crit || '#ef2b2d') : t.dim);
const RAIN = '#4da3ff';

function fit(cv, str, size, o, max) {
    str = String(str || '');
    if (cv.textWidth(str, size, o) <= max) return str;
    while (str.length > 1 && cv.textWidth(str + '…', size, o) > max) str = str.slice(0, -1);
    return str + '…';
}
const LAB = { literal: true, font: 'label' }, BOLD = { literal: true, font: 'bold' };

/** A rounded tab/chip: filled when on, outlined when off; tapping it runs `run`. Returns its width. */
function chip(cv, G, t, x, y, w, h, label, on, run, key, size) {
    const acc = t.accent2 || '#81c4ff';
    cv.roundRect(x, y, w, h, h / 2, on ? G.withAlpha(acc, 0.9) : G.withAlpha('#ffffff', 0.06));
    if (!on) cv.strokeRoundRect(x, y, w, h, h / 2, 1.3, G.withAlpha('#ffffff', 0.28));
    cv.text(fit(cv, label, size || 20, BOLD, w - 24), x + w / 2, y + h / 2 + (size || 20) * 0.34, size || 20, on ? '#0b1118' : t.text, { literal: true, font: 'bold', align: 'center' });
    if (run) cv.target(x, y, w, h, run, key || label);
    return w;
}

function tile(cv, G, t, x, y, w, h, title, value, sub) {
    cv.roundRect(x, y, w, h, 12, G.withAlpha('#ffffff', 0.05));
    cv.text(title, x + 10, y + 24, 15, t.dim, LAB);
    cv.text(fit(cv, value, 24, BOLD, w - 20), x + 10, y + 52, 24, t.text, BOLD);
    if (sub) cv.text(fit(cv, sub, 14, LAB, w - 20), x + 10, y + h - 10, 14, t.dim, LAB);
}

function tempColor(v) { return v < 18 ? '#5ab0ff' : v < 25 ? '#6fd3b0' : v < 30 ? '#ffc933' : v < 35 ? '#ff9f2e' : '#ff5a3c'; }

function drawMain(cv, G, t, v, act) {
    const acc = t.accent2 || '#81c4ff';
    const places = v.places || [], d = v.data, cur = d && d.current;
    const time = v.time || 0, wc = cur ? Wx.describe(cur.code) : null;
    if (v.fx && cur) Fx.sky(cv, G, wc.icon, cur.day, 26, G.TOP + 2, W - 52, G.BOTTOM - G.TOP - 4);
    if (v.fx && cur) Fx.draw(cv, G, wc.icon, cur.day, cur.wind || 0, 30, G.TOP + 4, 520, G.BOTTOM - G.TOP - 8, time);
    // tabs: the places, then the list of places; refresh at the right
    let x = 56; const y0 = G.TOP + 14, hh = 40;
    places.forEach((p, i) => {
        const label = '' + (i === v.sel && d && d.name ? d.name : p.name);
        const w = Math.max(110, Math.min(240, cv.textWidth(label, 20, BOLD) + 40));
        chip(cv, G, t, x, y0, w, hh, label, i === v.sel, () => act.select && act.select(i), 'wxTab' + i);
        x += w + 10;
    });
    chip(cv, G, t, x, y0, 150, hh, '+ Địa điểm', false, () => act.openPick && act.openPick(), 'wxPick', 18);
    const rbw = 150;
    chip(cv, G, t, W - 56 - rbw - 16 - 120 - 16 - 168, y0, 168, hh, 'Hiệu ứng: ' + (v.fx ? 'Bật' : 'Tắt'), !!v.fx, () => act.toggleFx && act.toggleFx(), 'wxFx', 18);
    G.button(cv, t, W - 56 - rbw, y0 - 2, rbw, hh + 4, v.busy ? 'Đang tải…' : 'Làm mới', act.refresh || nop, { key: 'wxRefresh', busy: !!v.busy });
    if (v.updated) cv.text('Cập nhật ' + v.updated, W - 56 - rbw - 16, y0 + 27, 16, d && d.ok ? t.dim : (t.warn || '#ffb020'), { literal: true, font: 'label', align: 'right' });

    if (!cur) {
        const msg = v.state === 'down' ? 'Trợ thủ thời tiết chưa chạy: khởi động lại màn hình xe.' : v.state === 'offline' ? 'Xe chưa có mạng: nối Wi-Fi hoặc điểm phát sóng của điện thoại.'
            : d && d.error ? 'Chưa lấy được dự báo: ' + d.error : 'Đang lấy dự báo…';
        Icons.draw(cv, 'partly', true, W / 2, G.TOP + 200, 150);
        cv.text(msg, W / 2, G.TOP + 330, 26, t.dim, { literal: true, font: 'label', align: 'center' });
        return;
    }
    const today = d.daily[0] || {};
    // left: now
    Icons.draw(cv, wc.icon, cur.day, 150, G.TOP + 170 + (v.fx ? Math.sin(time * 1.5) * 4 : 0), 170);
    cv.text(Wx.deg(cur.t).replace('°', ''), 262, G.TOP + 218, 118, t.text, { literal: true, font: 'bold' });
    const tw = cv.textWidth(Wx.deg(cur.t).replace('°', ''), 118, { literal: true, font: 'bold' });
    cv.text('°C', 262 + tw + 6, G.TOP + 130, 34, t.dim, BOLD);
    const wtw = cv.textWidth(wc.text, 32, BOLD), tp = Wx.tip(cur, today, d.hourly, d.air);
    cv.text(wc.text, 56, G.TOP + 292, 32, t.text, BOLD);
    if (tp) {
        const col = kindColor(t, tp.kind === 'info' ? 'go' : tp.kind), room = 520 - (56 + wtw + 24), tw3 = Math.min(room, cv.textWidth(tp.text, 17, BOLD) + 28);
        if (tw3 > 120) {
            const tx = 520 - tw3;
            cv.roundRect(tx, G.TOP + 266, tw3, 34, 17, G.withAlpha(col, 0.2)); cv.strokeRoundRect(tx, G.TOP + 266, tw3, 34, 17, 1.3, G.withAlpha(col, 0.7));
            cv.text(fit(cv, tp.text, 17, BOLD, tw3 - 24), tx + tw3 / 2, G.TOP + 289, 17, t.text, { literal: true, font: 'bold', align: 'center' });
        }
    }
    cv.text('Cảm giác như ' + Wx.deg(cur.feels) + '  ·  Cao ' + Wx.deg(today.hi) + '  ·  Thấp ' + Wx.deg(today.lo), 56, G.TOP + 324, 19, t.dim, LAB);
    const ty = G.TOP + 346, tw2 = 88, tg = 6, air = d.air, band = Wx.aqiBand(air && air.aqi);
    tile(cv, G, t, 56, ty, tw2, 92, 'Gió km/h', Wx.kmh(cur.wind).replace(' km/h', ''), Wx.compass(cur.windDir));
    if (cur.windDir !== null && cur.windDir !== undefined) {                 // the arrow points where the wind blows to
        const ax = 56 + tw2 - 22, ay = ty + 22, a = (cur.windDir + 180) * Math.PI / 180, dx = Math.sin(a), dy = -Math.cos(a), r = 11;
        cv.line(ax - dx * r, ay - dy * r, ax + dx * r, ay + dy * r, 2.5, t.text);
        cv.line(ax + dx * r, ay + dy * r, ax + dx * r * 0.2 + dy * 6, ay + dy * r * 0.2 - dx * 6, 2.5, t.text);
        cv.line(ax + dx * r, ay + dy * r, ax + dx * r * 0.2 - dy * 6, ay + dy * r * 0.2 + dx * 6, 2.5, t.text);
    }
    tile(cv, G, t, 56 + (tw2 + tg), ty, tw2, 92, 'Độ ẩm', Wx.pct(cur.humidity), '');
    tile(cv, G, t, 56 + 2 * (tw2 + tg), ty, tw2, 92, 'Mưa', Wx.pct(today.pop), cur.rain > 0 ? cur.rain + ' mm' : '');
    tile(cv, G, t, 56 + 3 * (tw2 + tg), ty, tw2, 92, 'UV', today.uv === null || today.uv === undefined ? '–' : String(Math.round(today.uv)), Wx.uvText(today.uv));
    tile(cv, G, t, 56 + 4 * (tw2 + tg), ty, tw2, 92, 'AQI', air ? String(Math.round(air.aqi)) : '–', air ? band.text : 'chưa có');
    if (air) cv.fillRect(56 + 4 * (tw2 + tg) + 10, ty + 62, tw2 - 20, 3, band.color);

    // right: next hours (every 3 hours), next days
    const rx = 560, rw = W - 56 - rx;
    cv.text('THEO GIỜ', rx, G.TOP + 100, 16, t.dim, { literal: true, font: 'bold', spacing: 2 });
    const hours = (d.hourly || []).filter((_, i) => i % 3 === 0).slice(0, 8), cw = rw / 8;
    hours.forEach((hr, i) => {
        const cx = rx + cw * i + cw / 2, h2 = Wx.describe(hr.code);
        cv.text(i === 0 ? 'Bây giờ' : hr.time, cx, G.TOP + 128, 18, i === 0 ? t.text : t.dim, { literal: true, font: i === 0 ? 'bold' : 'label', align: 'center' });
        Icons.draw(cv, h2.icon, hr.day, cx, G.TOP + 160, 50);
        cv.text(Wx.deg(hr.t), cx, G.TOP + 202, 26, t.text, { literal: true, font: 'bold', align: 'center' });
        cv.text(hr.pop > 0 ? Wx.pct(hr.pop) : '', cx, G.TOP + 224, 16, RAIN, { literal: true, font: 'label', align: 'center' });
        if (i > 0) cv.fillRect(rx + cw * i, G.TOP + 112, 1, 120, G.withAlpha('#ffffff', 0.08));
    });
    cv.fillRect(rx, G.TOP + 240, rw, 1, G.withAlpha('#ffffff', 0.12));
    cv.text('5 NGÀY TỚI', rx, G.TOP + 266, 16, t.dim, { literal: true, font: 'bold', spacing: 2 });
    const days = (d.daily || []).slice(1, 6);
    const lo = Math.min.apply(null, days.map((x) => (x.lo === null ? 99 : x.lo)).concat([99])), hi = Math.max.apply(null, days.map((x) => (x.hi === null ? -99 : x.hi)).concat([-99]));
    const bx = rx + 330, bw = rw - 330 - 150;
    days.forEach((dy, i) => {
        const yy = G.TOP + 282 + i * 36, di = Wx.describe(dy.code);
        cv.text(i === 0 ? 'Ngày mai' : Wx.DOW[dy.dow], rx, yy + 20, 20, t.text, LAB);
        Icons.draw(cv, di.icon, true, rx + 190, yy + 13, 30);
        cv.text(dy.pop > 0 ? Wx.pct(dy.pop) : '', rx + 262, yy + 20, 17, RAIN, { literal: true, font: 'label', align: 'right' });
        cv.text(Wx.deg(dy.lo), bx - 16, yy + 21, 20, t.dim, { literal: true, font: 'label', align: 'right' });
        cv.roundRect(bx, yy + 8, bw, 8, 4, G.withAlpha('#ffffff', 0.1));
        if (dy.lo !== null && dy.hi !== null && hi > lo) {
            const a = bx + bw * (dy.lo - lo) / (hi - lo), b = bx + bw * (dy.hi - lo) / (hi - lo);
            cv.gradientRect(a, yy + 8, Math.max(8, b - a), 8, [[0, tempColor(dy.lo)], [1, tempColor(dy.hi)]]);
        }
        cv.text(Wx.deg(dy.hi), bx + bw + 56, yy + 21, 22, t.text, { literal: true, font: 'bold', align: 'right' });
    });
}

function drawPick(cv, G, t, v, act) {
    const p = v.pick || { keys: [], page: 0, pages: 1, items: [], max: 6 }, acc = t.accent2 || '#81c4ff';
    cv.text('CHỌN ĐỊA ĐIỂM', 56, G.TOP + 52, 28, t.text, { literal: true, font: 'bold', spacing: 2 });
    cv.text('Đã chọn ' + p.keys.length + '/' + p.max + '  ·  chạm để thêm hoặc bỏ', W - 56, G.TOP + 50, 19, t.dim, { literal: true, font: 'label', align: 'right' });
    let rx = 56;
    Wx.REGIONS.forEach((r) => { const w2 = Math.max(120, cv.textWidth(r[1], 19, BOLD) + 36); chip(cv, G, t, rx, G.TOP + 68, w2, 38, r[1], (p.region || 'all') === r[0], () => act.region && act.region(r[0]), 'wxReg' + r[0], 19); rx += w2 + 10; });
    const cols = 6, gap = 10, cw = (W - 112 - (cols - 1) * gap) / cols, ch = 52;
    p.items.forEach((it, i) => {
        const cx = 56 + (i % cols) * (cw + gap), cy = G.TOP + 120 + Math.floor(i / cols) * (ch + gap), on = p.keys.indexOf(it.key) >= 0;
        chip(cv, G, t, cx, cy, cw, ch, '' + it.name, on, () => act.togglePlace && act.togglePlace(it.key), 'wxCity' + it.key, 19);
    });
    const by = G.pageBottom(cv) - (cv.own ? G.MARGIN : 0) - 54, bw = 220;
    if (v.message) cv.text(fit(cv, v.message, 19, LAB, 700), 56, by + 35, 19, kindColor(t, v.messageKind), LAB);
    G.button(cv, t, W - 56 - bw, by, bw, 54, 'Xong', act.closePick || nop, { key: 'wxDone', primary: true });
    G.button(cv, t, W - 56 - 2 * bw - 14, by, bw, 54, 'Trang ' + (p.page + 1) + '/' + p.pages, () => act.page && act.page(1), { key: 'wxPage', busy: p.pages < 2 });
}

function draw(cv, G, t, v, act) {
    act = act || {};
    cv.clear(t.bg);
    G.frame(cv, t, ['Thời tiết'], 0, []);
    G.panel(cv, t, 24, G.TOP, W - 48, G.BOTTOM - G.TOP, null);
    if (v.mode === 'pick') drawPick(cv, G, t, v, act); else drawMain(cv, G, t, v, act);
    return cv;
}

module.exports = { draw, W, H };
