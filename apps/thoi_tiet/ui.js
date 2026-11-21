'use strict';
/**
 * ui.js - the Thời tiết screen, a pure draw(cv, G, t, v, act) for the car and the preview.
 *
 * Main: the places as tabs, the weather of the chosen place (icon, temperature, words, a tip for the driver, small tiles
 * the owner chose), a middle block (the next hours as icons or as a curve, or the sun's arc) and the next five days,
 * with the moving weather behind. Drive: the same, large and bare, for a glance on the road.
 * Pick: the list of places (by region, or the ones added from the phone). Phone: the QR code to add any place.
 * Settings: which figures, blocks and units to show.
 *
 * v = { mode: 'main' | 'pick' | 'settings' | 'phone', drive, state: 'ok' | 'down', places: [{ key, name, here }], sel,
 *       data: the chosen place's { name, ok, at, error, current, hourly, daily, air } or null, updated: 'HH:MM', busy,
 *       set: settings (weather.settingsOf), time (seconds, drives the motion), pick: { keys, page, pages, region, items, max },
 *       phone: { url, pin, host, count }, message, messageKind }
 * act = { select, openPick, closePick, togglePlace, region, page, refresh, openSettings, closeSettings, toggleTile, setBlock,
 *         toggle(key), setUnit, resetSettings, drive(on), openPhone, closePhone, nextIp }
 * Node 8.
 */
const Wx = require('./weather');
const Icons = require('./icons');
const Fx = require('./fx');
const QR = require('./kit/qr');
const W = 1600, H = 520;
const nop = () => {};
const kindColor = (t, kind) => (kind === 'go' ? (t.go || '#2fd27a') : kind === 'warn' ? (t.warn || '#ffb020') : kind === 'crit' ? (t.crit || '#ef2b2d') : t.dim);
const RAIN = '#4da3ff';
const LAB = { literal: true, font: 'label' }, BOLD = { literal: true, font: 'bold' };

function fit(cv, str, size, o, max) {
    str = String(str || '');
    if (cv.textWidth(str, size, o) <= max) return str;
    while (str.length > 1 && cv.textWidth(str + '…', size, o) > max) str = str.slice(0, -1);
    return str + '…';
}
/** A rounded tab/chip: filled when on, outlined when off; tapping it runs `run`. */
function chip(cv, G, t, x, y, w, h, label, on, run, key, size) {
    const acc = t.accent2 || '#81c4ff';
    cv.roundRect(x, y, w, h, h / 2, on ? G.withAlpha(acc, 0.9) : G.withAlpha('#ffffff', 0.06));
    if (!on) cv.strokeRoundRect(x, y, w, h, h / 2, 1.3, G.withAlpha('#ffffff', 0.28));
    cv.text(fit(cv, label, size || 20, BOLD, w - 24), x + w / 2, y + h / 2 + (size || 20) * 0.34, size || 20, on ? '#0b1118' : t.text, { literal: true, font: 'bold', align: 'center' });
    if (run) cv.target(x, y, w, h, run, key || label);
    return w;
}
function tempColor(v) { return v < 18 ? '#5ab0ff' : v < 25 ? '#6fd3b0' : v < 30 ? '#ffc933' : v < 35 ? '#ff9f2e' : '#ff5a3c'; }
const label = (cv, t, text, x, y) => cv.text(text, x, y, 16, t.dim, { literal: true, font: 'bold', spacing: 2 });

/** A small figure. tall: title, big value, sub; else one line (value and sub) under the title. */
function tile(cv, G, t, x, y, w, h, info, tall, windDir) {
    cv.roundRect(x, y, w, h, 12, G.withAlpha('#ffffff', 0.05));
    if (tall) {
        // the tile grows with the room the screen has: its three lines grow with it and stay spread evenly over its height
        const k = Math.max(1, Math.min(1.45, h / 104)), ts = Math.round(15 * k), vs = Math.round(26 * k), ss = Math.round(14 * k);
        const vy = Math.round(y + h * 0.5 + vs * 0.36);
        cv.text(info.title, x + 10, y + Math.round(10 * k) + ts, ts, t.dim, LAB);
        cv.text(fit(cv, info.value, vs, BOLD, w - 20), x + 10, vy, vs, t.text, BOLD);
        if (info.bar) cv.fillRect(x + 10, vy + Math.round(9 * k), w - 20, 3, info.bar);
        let s2 = ss; while (info.sub && s2 > 13 && cv.textWidth(info.sub, s2, LAB) > w - 20) s2--;
        if (info.sub) cv.text(fit(cv, info.sub, s2, LAB, w - 20), x + 10, y + h - Math.round(12 * k), s2, t.dim, LAB);
    } else {
        cv.text(info.title, x + 10, y + 19, 14, t.dim, LAB);
        const vw = cv.textWidth(info.value, 22, BOLD);
        cv.text(fit(cv, info.value, 22, BOLD, w - 20), x + 10, y + 44, 22, t.text, BOLD);
        if (info.sub && w - 20 - vw > 30) cv.text(fit(cv, info.sub, 13, LAB, w - 20 - vw - 6), x + 10 + vw + 6, y + 44, 13, t.dim, LAB);
        if (info.bar) cv.fillRect(x + 10, y + h - 7, w - 20, 3, info.bar);
    }
    if (windDir !== null && windDir !== undefined) {                          // the arrow points where the wind blows to
        const ax = x + w - 20, ay = y + 20, a = (windDir + 180) * Math.PI / 180, dx = Math.sin(a), dy = -Math.cos(a), r = 10;
        cv.line(ax - dx * r, ay - dy * r, ax + dx * r, ay + dy * r, 2.5, t.text);
        cv.line(ax + dx * r, ay + dy * r, ax + dx * r * 0.2 + dy * 6, ay + dy * r * 0.2 - dx * 6, 2.5, t.text);
        cv.line(ax + dx * r, ay + dy * r, ax + dx * r * 0.2 - dy * 6, ay + dy * r * 0.2 + dx * 6, 2.5, t.text);
    }
}
function tiles(cv, G, t, ids, cur, today, d, y0, ex) {
    const n = ids.length; if (!n) return;
    const two = n > 5, per = two ? Math.ceil(n / 2) : n, gap = 6, tw = Math.min(two ? 150 : 108, (464 - (per - 1) * gap) / per), th = two ? 54 + (ex || 0) / 2 : Math.max(92, G.BOTTOM + (ex || 0) - 18 - y0);
    ids.forEach((id, i) => {
        const r = two ? Math.floor(i / per) : 0, c = two ? i % per : i;
        tile(cv, G, t, 56 + c * (tw + gap), y0 + r * (th + 6), tw, th, Wx.tileInfo(id, cur, today, d.daily, d.air), !two, id === 'wind' ? cur.windDir : null);
    });
}

/** The driver's tip as a rounded label whose right edge is at `right`; returns nothing. */
function tipChip(cv, G, t, tp, right, y, h, size, room) {
    const col = kindColor(t, tp.kind === 'info' ? 'go' : tp.kind), tw = Math.min(room, cv.textWidth(tp.text, size, BOLD) + 28);
    if (tw < 120) return;
    const tx = right - tw;
    cv.roundRect(tx, y, tw, h, h / 2, G.withAlpha(col, 0.2)); cv.strokeRoundRect(tx, y, tw, h, h / 2, 1.3, G.withAlpha(col, 0.7));
    cv.text(fit(cv, tp.text, size, BOLD, tw - 24), tx + tw / 2, y + h / 2 + size * 0.34, size, t.text, { literal: true, font: 'bold', align: 'center' });
}

/** "Mưa sau 20 phút" / "Đang mưa" as a blue pill whose right edge is at `right`, when the next 2 hours bring rain; nothing otherwise. */
function rainChip(cv, G, t, cur, right, y, h, size) {
    if (!cur || typeof cur.rainIn !== 'number') return;
    const text = cur.rainIn === 0 ? 'Đang mưa' : 'Mưa sau ' + (cur.rainIn >= 60 ? Math.floor(cur.rainIn / 60) + 'g' + (cur.rainIn % 60 ? ('0' + (cur.rainIn % 60)).slice(-2) : '') : cur.rainIn + ' phút');
    const tw = cv.textWidth(text, size, BOLD) + 36, x = right - tw;
    cv.roundRect(x, y, tw, h, h / 2, G.withAlpha(RAIN, 0.28)); cv.strokeRoundRect(x, y, tw, h, h / 2, 1.5, G.withAlpha(RAIN, 0.9));
    cv.text(text, x + tw / 2, y + h / 2 + size * 0.34, size, t.text, { literal: true, font: 'bold', align: 'center' });
}

/** The next hours as icons, every 3 hours. */
function hoursIcons(cv, G, t, d, rx, rw) {
    const hours = (d.hourly || []).filter((_, i) => i % 3 === 0).slice(0, 8), cw = rw / 8, TOP = rx.top;
    hours.forEach((hr, i) => {
        const cx = rx.x + cw * i + cw / 2, h2 = Wx.describe(hr.code);
        cv.text(i === 0 ? 'Bây giờ' : hr.time, cx, TOP + 128, 18, i === 0 ? t.text : t.dim, { literal: true, font: i === 0 ? 'bold' : 'label', align: 'center' });
        Icons.draw(cv, h2.icon, hr.day, cx, TOP + 160, 50);
        cv.text(Wx.deg(hr.t), cx, TOP + 202, 26, t.text, { literal: true, font: 'bold', align: 'center' });
        cv.text(hr.pop > 0 ? Wx.pct(hr.pop) : '', cx, TOP + 224, 16, RAIN, { literal: true, font: 'label', align: 'center' });
        if (i > 0) cv.fillRect(rx.x + cw * i, TOP + 112, 1, 120, G.withAlpha('#ffffff', 0.08));
    });
}
/** The temperature of the next 24 hours as a curve, with the time and the chance of rain every 3 hours. */
function hoursChart(cv, G, t, d, rx, rw) {
    const TOP = rx.top, hs = (d.hourly || []).slice(0, 24).filter((h) => h.t !== null);
    if (hs.length < 3) return;
    const lo = Math.min.apply(null, hs.map((h) => h.t)), hi = Math.max.apply(null, hs.map((h) => h.t)), x0 = rx.x + 30, x1 = rx.x + rw - 30, ytop = TOP + 140, ybot = TOP + 196;
    const px = (i) => x0 + (x1 - x0) * i / (hs.length - 1), py = (v) => (hi > lo ? ybot - (ybot - ytop) * (v - lo) / (hi - lo) : (ytop + ybot) / 2);
    const pts = hs.map((h, i) => [px(i), py(h.t)]);
    cv.fillUnder(pts, ybot + 6, G.withAlpha(tempColor((lo + hi) / 2), 0.16));
    cv.polyline(pts, 3.5, tempColor((lo + hi) / 2));
    hs.forEach((h, i) => {
        if (i % 3 !== 0) return;
        cv.circle(pts[i][0], pts[i][1], i === 0 ? 6 : 4.5, i === 0 ? '#ffffff' : tempColor(h.t));
        cv.text(Wx.deg(h.t), pts[i][0], pts[i][1] - 14, 20, t.text, { literal: true, font: 'bold', align: 'center' });
        cv.text(i === 0 ? 'Bây giờ' : h.time, pts[i][0], TOP + 222, 16, t.dim, { literal: true, font: 'label', align: 'center' });
        if (h.pop > 0) cv.text(Wx.pct(h.pop), pts[i][0], TOP + 240, 14, RAIN, { literal: true, font: 'label', align: 'center' });
    });
}
/** The sun's arc for today: where it is now, the hours of rise and set, the light left. */
function sunArc(cv, G, t, cur, today, rx, rw) {
    const TOP = rx.top, sd = Wx.sunDay(cur.time, today), cx = rx.x + rw / 2, cy = TOP + 222, r = 98;
    if (!sd) { cv.text('Chưa có giờ mặt trời mọc/lặn.', cx, TOP + 190, 20, t.dim, { literal: true, font: 'label', align: 'center' }); return; }
    cv.fillRect(cx - r - 70, cy, 2 * r + 140, 2, G.withAlpha('#ffffff', 0.25));
    cv.arc(cx, cy, r - 1.5, r + 1.5, -90, 90, G.withAlpha('#ffffff', 0.22));
    if (sd.p !== null) cv.arc(cx, cy, r - 2.5, r + 2.5, -90, -90 + 180 * sd.p, '#ffc933');
    if (sd.p !== null) {
        const a = (-90 + 180 * sd.p) * Math.PI / 180, sx = cx + Math.sin(a) * r, sy = cy - Math.cos(a) * r;
        cv.circle(sx, sy, 22, G.withAlpha('#ffcf4a', 0.2)); cv.circle(sx, sy, 12, '#ffc933'); cv.circle(sx - 2, sy - 2, 6, '#ffe28a');
    }
    cv.text('Mọc', cx - r - 70, cy + 26, 15, t.dim, { literal: true, font: 'label', align: 'center' });
    cv.text(Wx.hm(sd.rise), cx - r - 70, cy + 48, 20, t.text, { literal: true, font: 'bold', align: 'center' });
    cv.text('Lặn', cx + r + 70, cy + 26, 15, t.dim, { literal: true, font: 'label', align: 'center' });
    cv.text(Wx.hm(sd.set), cx + r + 70, cy + 48, 20, t.text, { literal: true, font: 'bold', align: 'center' });
    const msg = sd.p !== null ? 'Còn ' + Math.floor(sd.left / 60) + ' giờ ' + (sd.left % 60) + ' phút nắng' : sd.now < sd.rise ? 'Mặt trời chưa mọc' : 'Mặt trời đã lặn';
    cv.text(msg, cx, cy - 40, 22, t.text, { literal: true, font: 'bold', align: 'center' });
    cv.text('Ban ngày ' + Math.floor((sd.set - sd.rise) / 60) + ' giờ ' + ((sd.set - sd.rise) % 60) + ' phút', cx, cy - 12, 16, t.dim, { literal: true, font: 'label', align: 'center' });
}
/** The next days with their range as a bar. */
function days(cv, G, t, d, rx, rw, y0, step) {
    const ds = (d.daily || []).slice(1, 6);
    const lo = Math.min.apply(null, ds.map((x) => (x.lo === null ? 99 : x.lo)).concat([99])), hi = Math.max.apply(null, ds.map((x) => (x.hi === null ? -99 : x.hi)).concat([-99]));
    const bx = rx + 330, bw = rw - 330 - 150;
    ds.forEach((dy, i) => {
        const yy = y0 + i * step, di = Wx.describe(dy.code);
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

function message(cv, t, v, x, y) { if (v.message) cv.text(fit(cv, v.message, 19, LAB, 650), x, y, 19, kindColor(t, v.messageKind), LAB); }

function drawMain(cv, G, t, v, act) {
    const set = v.set, places = v.places || [], d = v.data, cur = d && d.current;
    const time = v.time || 0, wc = cur ? Wx.describe(cur.code) : null, fx = set.fx && !!cur;
    // the room the car's screen has under the page (the panel reaches down into it): the page's lower parts stretch into it
    const ex = G.pageBottom(cv) - G.BOTTOM;
    if (fx) Fx.sky(cv, G, wc.icon, cur.day, 26, G.TOP + 2, W - 52, G.BOTTOM + ex - G.TOP - 4);
    if (fx) Fx.draw(cv, G, wc.icon, cur.day, cur.wind || 0, 30, G.TOP + 4, 520, G.BOTTOM + ex - G.TOP - 8, time);
    // top row: the places, the list of places | settings, drive, refresh
    const y0 = G.TOP + 14, hh = 40, rbw = 150, sbw = 130, dbw = 120;
    const rightStart = W - 56 - rbw - 10 - sbw - 10 - dbw - 16;
    let x = 56; const avail = rightStart - 56 - 160;
    // the place the car is at keeps its own label (its town is written under the row): a town of the list may be there too
    const names = places.map((p, i) => '' + (i === v.sel && d && d.name && !p.here ? d.name : p.name));
    if (cur && places[v.sel] && places[v.sel].here && d.name && d.name !== places[v.sel].name) cv.text(fit(cv, d.name, 17, BOLD, 440), 58, G.TOP + 78, 17, t.dim, BOLD);
    const want = names.map((n) => Math.max(110, Math.min(240, cv.textWidth(n, 20, BOLD) + 40)));
    const sum = want.reduce((a, b) => a + b + 10, 0), k = sum > avail ? avail / sum : 1;
    names.forEach((n, i) => { const w = Math.floor(want[i] * k); chip(cv, G, t, x, y0, w, hh, n, i === v.sel, () => act.select && act.select(i), 'wxTab' + i); x += w + 10; });
    chip(cv, G, t, x, y0, 150, hh, '+ Địa điểm', false, () => act.openPick && act.openPick(), 'wxPick', 18);
    G.button(cv, t, W - 56 - rbw, y0 - 2, rbw, hh + 4, v.busy ? 'Đang tải…' : 'Làm mới', act.refresh || nop, { key: 'wxRefresh', busy: !!v.busy });
    G.button(cv, t, W - 56 - rbw - 10 - sbw, y0 - 2, sbw, hh + 4, 'Cài đặt', act.openSettings || nop, { key: 'wxSettings' });
    G.button(cv, t, W - 56 - rbw - 10 - sbw - 10 - dbw, y0 - 2, dbw, hh + 4, 'Lái xe', () => act.drive && act.drive(true), { key: 'wxDrive' });
    if (v.updated) cv.text('Cập nhật ' + v.updated, W - 56, G.TOP + 80, 15, d && d.ok ? t.dim : (t.warn || '#ffb020'), { literal: true, font: 'label', align: 'right' });

    if (!cur) {
        const why = String(v.why || ''), msg = v.state === 'down' ? (why === 'missing' ? 'Chưa thấy trợ thủ thời tiết: vào Store cài "Trợ thủ Thời tiết" (thoi-tiet), rồi khởi động lại màn hình.' : why === 'denied' ? 'App không đọc được dữ liệu của trợ thủ (bị chặn quyền).' : why.indexOf('old') === 0 ? 'Trợ thủ thời tiết dừng từ ' + why.slice(4) + ' trước: khởi động lại màn hình xe.' : 'Trợ thủ thời tiết trả dữ liệu hỏng: khởi động lại màn hình xe.') : d && d.error === 'chưa có dữ liệu' ? 'Đang lấy dự báo…' : d && d.error ? (/EAI_AGAIN|ECONNREFUSED|ENETUNREACH|ETIMEDOUT|EHOSTUNREACH|timeout|DNS/i.test(d.error + (v.netError || '')) ? 'Xe chưa ra được mạng internet (' + d.error + '). Kiểm tra Wi-Fi của xe rồi bấm Làm mới.' : 'Chưa lấy được dự báo: ' + d.error) : 'Đang lấy dự báo…';
        Icons.draw(cv, 'partly', true, W / 2, G.TOP + 200, 150);
        cv.text(fit(cv, msg, 26, LAB, W - 160), W / 2, G.TOP + 320, 26, t.dim, { literal: true, font: 'label', align: 'center' });

        return;
    }
    const today = d.daily[0] || {};
    // left: now
    Icons.draw(cv, wc.icon, cur.day, 150, G.TOP + 170 + (set.fx ? Math.sin(time * 1.5) * 4 : 0), 170);
    const big = Wx.deg(cur.t).replace('°', ''), bw2 = cv.textWidth(big, 118, BOLD);
    cv.text(big, 262, G.TOP + 218, 118, t.text, BOLD);
    cv.text('°' + Wx.getUnit(), 262 + bw2 + 6, G.TOP + 130, 34, t.dim, BOLD);
    const wtw = cv.textWidth(wc.text, 32, BOLD), tp = set.tips ? Wx.tip(cur, today, d.hourly, d.air) : null;
    cv.text(wc.text, 56, G.TOP + 292, 32, t.text, BOLD);
    if (tp) tipChip(cv, G, t, tp, 520, G.TOP + 266, 34, 17, 520 - (56 + wtw + 24));
    cv.text('Cảm giác như ' + Wx.deg(cur.feels) + '  ·  Cao ' + Wx.deg(today.hi) + '  ·  Thấp ' + Wx.deg(today.lo), 56, G.TOP + 324, 19, t.dim, LAB);
    tiles(cv, G, t, set.tiles, cur, today, d, G.TOP + 346, ex);
    rainChip(cv, G, t, cur, 520, G.TOP + 226, 34, 18);

    // right: the middle block, the next days
    const rx = 560, rw = W - 56 - rx, R = { x: rx, top: G.TOP };
    if (set.block !== 'off') {
        label(cv, t, set.block === 'chart' ? 'NHIỆT ĐỘ 24 GIỜ' : set.block === 'sun' ? 'MẶT TRỜI' : 'THEO GIỜ', rx, G.TOP + 100);
        if (set.block === 'icons') hoursIcons(cv, G, t, d, R, rw); else if (set.block === 'chart') hoursChart(cv, G, t, d, R, rw); else sunArc(cv, G, t, cur, today, R, rw);
    }
    if (set.days) {
        if (set.block !== 'off') { cv.fillRect(rx, G.TOP + 250, rw, 1, G.withAlpha('#ffffff', 0.12)); label(cv, t, '5 NGÀY TỚI', rx, G.TOP + 274); days(cv, G, t, d, rx, rw, G.TOP + 290 + ex * 0.2, 35 + ex * 0.2); }
        else { label(cv, t, '5 NGÀY TỚI', rx, G.TOP + 100); days(cv, G, t, d, rx, rw, G.TOP + 120 + ex * 0.2, 62 + ex * 0.2); }
    }
}

/** The bare screen for a glance on the road: place, icon, temperature, words, the tip, four figures. */
function drawDrive(cv, G, t, v, act) {
    const set = v.set, d = v.data, cur = d && d.current, places = v.places || [], time = v.time || 0;
    if (!cur) { cv.text('Chưa có dự báo.', W / 2, G.TOP + 220, 30, t.dim, { literal: true, font: 'label', align: 'center' }); G.button(cv, t, W - 56 - 150, G.TOP + 14, 150, 44, 'Thoát', () => act.drive && act.drive(false), { key: 'wxExit' }); return; }
    const wc = Wx.describe(cur.code), today = d.daily[0] || {};
    const ex = G.pageBottom(cv) - G.BOTTOM, sg = ex / 4;
    if (set.fx) { Fx.sky(cv, G, wc.icon, cur.day, 26, G.TOP + 2, W - 52, G.BOTTOM + ex - G.TOP - 4); Fx.draw(cv, G, wc.icon, cur.day, cur.wind || 0, 30, G.TOP + 4, W - 60, G.BOTTOM + ex - G.TOP - 8, time); }
    const name = (d.name || (places[v.sel] && places[v.sel].name) || '') + (places.length > 1 ? '  >' : '');
    cv.text(fit(cv, name, 30, BOLD, 700), 64, G.TOP + 58, 30, t.text, BOLD);
    if (places.length > 1) cv.target(40, G.TOP + 18, 760, 54, () => act.select && act.select((v.sel + 1) % places.length), 'wxNext');
    if (v.updated) cv.text('Cập nhật ' + v.updated, 64, G.TOP + 84, 16, d.ok ? t.dim : (t.warn || '#ffb020'), { literal: true, font: 'label' });
    G.button(cv, t, W - 56 - 150, G.TOP + 14, 150, 44, 'Thoát', () => act.drive && act.drive(false), { key: 'wxExit' });
    Icons.draw(cv, wc.icon, cur.day, 240, G.TOP + 250 + (set.fx ? Math.sin(time * 1.5) * 5 : 0), 280);
    const big = Wx.deg(cur.t).replace('°', ''), bw = cv.textWidth(big, 190, BOLD);
    cv.text(big, 440, G.TOP + 310, 190, t.text, BOLD);
    cv.text('°' + Wx.getUnit(), 440 + bw + 8, G.TOP + 180, 52, t.dim, BOLD);
    cv.text(wc.text, 440, G.TOP + 372, 48, t.text, BOLD);
    rainChip(cv, G, t, cur, 1530, G.TOP + 62, 30, 19);
    const tp = Wx.tip(cur, today, d.hourly, d.air);
    if (tp) tipChip(cv, G, t, tp, 1060, G.TOP + 392, 56, 28, 620);
    const stats = [['Cao / Thấp', Wx.deg(today.hi) + ' / ' + Wx.deg(today.lo), ''], ['Mưa', Wx.pct(today.pop), cur.rain > 0 ? cur.rain + ' mm' : ''], ['Gió km/h', cur.wind === null ? '–' : String(Math.round(cur.wind)), Wx.compass(cur.windDir)], ['AQI', d.air ? String(Math.round(d.air.aqi)) : '–', d.air ? Wx.aqiBand(d.air.aqi).text : '']];
    stats.forEach((s, i) => {
        const sx = 1130, sy = G.TOP + 96 + i * (92 + sg), sh = 80 + sg;
        cv.roundRect(sx, sy, 400, sh, 14, G.withAlpha('#000000', 0.28)); cv.roundRect(sx, sy, 400, sh, 14, G.withAlpha('#ffffff', 0.05));
        cv.text(s[0], sx + 20, sy + 30, 18, t.dim, LAB);
        cv.text(s[1], sx + 20, sy + 66 + sg * 0.7, 34, t.text, BOLD);
        if (s[2]) cv.text(s[2], sx + 380, sy + 66 + sg * 0.7, 22, i === 3 ? Wx.aqiBand(d.air && d.air.aqi).color : t.dim, { literal: true, font: 'bold', align: 'right' });
    });
}

function drawPick(cv, G, t, v, act) {
    const p = v.pick || { keys: [], page: 0, pages: 1, items: [], max: 6, region: 'all' };
    cv.text('CHỌN ĐỊA ĐIỂM', 56, G.TOP + 52, 28, t.text, { literal: true, font: 'bold', spacing: 2 });
    cv.text('Đã chọn ' + p.keys.length + '/' + p.max + '  ·  chạm để thêm hoặc bỏ', W - 56, G.TOP + 50, 19, t.dim, { literal: true, font: 'label', align: 'right' });
    let rx = 56;
    Wx.REGIONS.forEach((r) => { const w2 = Math.max(110, cv.textWidth(r[1], 19, BOLD) + 36); chip(cv, G, t, rx, G.TOP + 68, w2, 38, r[1], (p.region || 'all') === r[0], () => act.region && act.region(r[0]), 'wxReg' + r[0], 19); rx += w2 + 10; });
    const cols = 6, gap = 10, cw = (W - 112 - (cols - 1) * gap) / cols, ch = 52;
    if (!p.items.length) cv.text(p.region === 'my' ? 'Chưa có nơi nào: bấm "Tìm bằng điện thoại" để thêm bất kỳ nơi nào trên thế giới.' : 'Không có địa điểm.', 56, G.TOP + 160, 21, t.dim, LAB);
    p.items.forEach((it, i) => {
        const cx = 56 + (i % cols) * (cw + gap), cy = G.TOP + 120 + Math.floor(i / cols) * (ch + gap), on = p.keys.indexOf(it.key) >= 0;
        chip(cv, G, t, cx, cy, cw, ch, '' + it.name, on, () => act.togglePlace && act.togglePlace(it.key), 'wxCity' + it.key, 19);
    });
    const by = G.pageBottom(cv) - (cv.own ? G.MARGIN : 0) - 54, bw = 220, pw = 330;
    message(cv, t, v, 56, by + 35);
    G.button(cv, t, W - 56 - bw, by, bw, 54, 'Xong', act.closePick || nop, { key: 'wxDone', primary: true });
    G.button(cv, t, W - 56 - 2 * bw - 14, by, bw, 54, 'Trang ' + (p.page + 1) + '/' + p.pages, () => act.page && act.page(1), { key: 'wxPage', busy: p.pages < 2 });
    G.button(cv, t, W - 56 - 2 * bw - 14 - 14 - pw, by, pw, 54, 'Tìm bằng điện thoại', act.openPhone || nop, { key: 'wxPhone' });
}

function drawPhone(cv, G, t, v, act) {
    const ph = v.phone || {}, lx = 64, top = G.TOP + 34;
    if (ph.url) {
        let side = 0;
        try { side = QR.draw(cv, ph.url, lx, top, 7); } catch (e) { side = 0; }
        const qx = lx + (side || 259) / 2;
        cv.text('MÃ PIN', qx, top + (side || 259) + 34, 14, t.dim, { literal: true, align: 'center', font: 'bold', spacing: 2 });
        cv.text(String(ph.pin || '').split('').join(' '), qx, top + (side || 259) + 86, 54, t.text, { literal: true, align: 'center', font: 'bold', spacing: 3 });
        cv.text(ph.host || '', qx, top + (side || 259) + 114, 14, G.withAlpha('#ffffff', 0.35), { literal: true, align: 'center', font: 'label' });
    } else {
        cv.roundRect(lx, top, 259, 259, 18, G.withAlpha('#ffffff', 0.05)); cv.strokeRoundRect(lx, top, 259, 259, 18, 1.5, G.withAlpha('#ffffff', 0.2));
        cv.text(v.state === 'down' ? 'CHƯA CÓ TRỢ THỦ' : 'CHƯA CÓ MẠNG', lx + 130, top + 138, 18, t.dim, { literal: true, align: 'center', font: 'bold', spacing: 1.5 });
    }
    const rx = 460;
    cv.text('TÌM BẰNG ĐIỆN THOẠI', rx, G.TOP + 76, 36, t.text, { literal: true, font: 'bold', spacing: 2 });
    ['1. Nối điện thoại cùng Wi-Fi với xe (hoặc điểm phát sóng).', '2. Quét mã QR bên trái, nhập mã PIN nếu được hỏi.', '3. Gõ tên nơi cần xem (thành phố, huyện, nước ngoài), bấm Thêm.', '4. Nơi đó hiện ngay trong danh sách của xe.'].forEach((s, i) => cv.text(s, rx, G.TOP + 130 + i * 38, 22, t.text, LAB));
    cv.text('Đã thêm từ điện thoại: ' + (ph.count || 0) + ' nơi (xem ở mục "Của tôi").', rx, G.TOP + 300, 19, t.dim, LAB);
    const by = G.pageBottom(cv) - (cv.own ? G.MARGIN : 0) - 54, bw = 220;
    message(cv, t, v, rx, by + 35);
    G.button(cv, t, W - 56 - bw, by, bw, 54, 'Xong', act.closePhone || nop, { key: 'wxPhoneDone', primary: true });
    G.button(cv, t, W - 56 - 2 * bw - 14, by, bw, 54, 'Địa chỉ khác', act.nextIp || nop, { key: 'wxNextIp' });
}

function drawSettings(cv, G, t, v, act) {
    const set = v.set, onChip = (x, y, w, text, on, run, key) => chip(cv, G, t, x, y, w, 46, text, on, run, key, 19);
    cv.text('CÀI ĐẶT', 56, G.TOP + 52, 28, t.text, { literal: true, font: 'bold', spacing: 2 });
    cv.text('Chạm để bật hoặc tắt, nhớ lại cho lần sau.', W - 56, G.TOP + 50, 19, t.dim, { literal: true, font: 'label', align: 'right' });
    label(cv, t, 'THÔNG SỐ HIỆN TRONG Ô NHỎ (TỐI ĐA ' + Wx.MAX_TILES + ')', 56, G.TOP + 90);
    const cols = 5, gap = 10, cw = (W - 112 - (cols - 1) * gap) / cols;
    Wx.TILES.forEach((tl, i) => onChip(56 + (i % cols) * (cw + gap), G.TOP + 102 + Math.floor(i / cols) * 56, cw, tl[1], set.tiles.indexOf(tl[0]) >= 0, () => act.toggleTile && act.toggleTile(tl[0]), 'wxT' + tl[0]));
    label(cv, t, 'KHỐI Ở GIỮA BÊN PHẢI', 56, G.TOP + 232);
    Wx.BLOCKS.forEach((b, i) => onChip(56 + i * (cw + gap), G.TOP + 244, cw, b[1], set.block === b[0], () => act.setBlock && act.setBlock(b[0]), 'wxB' + b[0]));
    label(cv, t, 'KHÁC', 56, G.TOP + 314);
    const other = [['5 ngày tới', set.days ? 'Bật' : 'Tắt', set.days, 'days'], ['Lời nhắc cho người lái', set.tips ? 'Bật' : 'Tắt', set.tips, 'tips'], ['Hiệu ứng chuyển động', set.fx ? 'Bật' : 'Tắt', set.fx, 'fx']];
    other.forEach((o, i) => onChip(56 + i * (cw + gap), G.TOP + 326, cw, o[0] + ': ' + o[1], o[2], () => act.toggle && act.toggle(o[3]), 'wxO' + o[3]));
    onChip(56 + 3 * (cw + gap), G.TOP + 326, cw, 'Đơn vị: °' + set.unit, true, () => act.setUnit && act.setUnit(set.unit === 'C' ? 'F' : 'C'), 'wxUnit');
    const wd = v.widget;
    if (wd) {
        label(cv, t, 'WIDGET MÀN HÌNH CHÍNH', 56, G.TOP + 392);
        cv.text(fit(cv, 'Bản ' + wd.version + '  ·  ' + (wd.ready ? 'xe đã giao ô widget' : 'xe chưa giao ô widget') + '  ·  số ô: ' + wd.n + '  ·  đã vẽ: ' + wd.ok + '/' + wd.frames, 16, LAB, 1000), 56, G.TOP + 412, 16, t.text, LAB);
        (wd.lines || []).forEach((l, i) => cv.text(fit(cv, l, 14, LAB, 1000), 56, G.TOP + 430 + i * 16, 14, t.dim, LAB));
    }
    const by = G.pageBottom(cv) - (cv.own ? G.MARGIN : 0) - 54, bw = 220;
    message(cv, t, v, 56, by + 35);
    G.button(cv, t, W - 56 - bw, by, bw, 54, 'Xong', act.closeSettings || nop, { key: 'wxSetDone', primary: true });
    G.button(cv, t, W - 56 - 2 * bw - 14, by, bw, 54, 'Về mặc định', act.resetSettings || nop, { key: 'wxReset' });
}

/**
 * The home-screen widget picture: the place, icon, temperature, words and the rain alert; the big one adds the high and low
 * and the next hours. v = { data (place's { name, ok, current, hourly, daily }), big, w, h }. Pixel size of the widget is not known
 * from here, so everything is laid out from v.w and v.h.
 */
/** The big home-screen widget (about 2:1): place, rain alert or high/low, icon, temperature, words, the next hours and the chosen figures. */
function drawWidgetBig(cv, G, t, v) {
    // measured on the car: ~85px of the picture are cropped on each side, and the layout lays a whitish veil over it that is
    // thickest at the top and bottom and thinnest ~40% down. So: flat deep colours, pure white text on near-opaque dark plates,
    // the name row at the top fills the gap, the main block sits in the clearest band.
    const w = v.w, h = v.h, d = v.data, cur = d.current, ox = 104, R = 900, W2 = R - ox;
    const wc = Wx.describe(cur.code), today = (d.daily && d.daily[0]) || {};
    const DIM = '#f0f4fb', PLATE = 0.72;
    cv.fillRect(0, 0, w, h, cur.day ? '#06214d' : '#0a1236');
    const nm = fit(cv, d.name || '', 34, BOLD, 400), nw = cv.textWidth(nm, 34, BOLD) + 32;
    cv.roundRect(ox, 36, nw, 54, 27, G.withAlpha('#000000', PLATE));
    cv.text(nm, ox + 16, 75, 34, t.text, BOLD);
    if (typeof cur.rainIn === 'number') rainChip(cv, G, t, cur, R, 40, 46, 26);
    else {
        const hl = 'Cao ' + Wx.deg(today.hi) + '  ·  Thấp ' + Wx.deg(today.lo), hw = cv.textWidth(hl, 26, { literal: true, font: 'bold' }) + 32;
        cv.roundRect(R - hw, 36, hw, 54, 27, G.withAlpha('#000000', PLATE));
        cv.text(hl, R - 16, 73, 26, t.text, { literal: true, font: 'bold', align: 'right' });
    }
    cv.roundRect(ox - 4, 108, 180, 180, 90, G.withAlpha('#000000', PLATE));
    Icons.draw(cv, wc.icon, cur.day, ox + 86, 198, 150);
    const big = Wx.deg(cur.t).replace('°', '');
    cv.text(big, ox + 196, 236, 124, t.text, BOLD);
    cv.text('°' + Wx.getUnit(), ox + 196 + cv.textWidth(big, 124, BOLD) + 4, 164, 34, DIM, BOLD);
    cv.text(fit(cv, wc.text, 30, BOLD, 230), ox + 196, 284, 30, t.text, BOLD);
    const hrs = (d.hourly || []).filter((_, i) => i % 3 === 0).slice(1, 5), x0 = 540, cw = (R - x0) / 4;
    hrs.forEach((hr, i) => {
        const cx = x0 + cw * i + cw / 2;
        cv.roundRect(cx - cw / 2 + 3, 108, cw - 6, 180, 14, G.withAlpha('#000000', PLATE));
        cv.text(hr.time, cx, 146, 20, DIM, { literal: true, font: 'label', align: 'center' });
        Icons.draw(cv, Wx.describe(hr.code).icon, hr.day, cx, 200, 52);
        cv.text(Wx.deg(hr.t), cx, 262, 28, t.text, { literal: true, font: 'bold', align: 'center' });
    });
    cv.fillRect(ox, 310, W2, 2, G.withAlpha('#ffffff', 0.5));
    const ids = (v.tiles || []).slice(0, 5), n = ids.length;
    if (!n) return;
    const gap = 8, tw = (W2 - (n - 1) * gap) / n, ty = 326, th = h - ty - 28;
    ids.forEach((id, i) => {
        const info = Wx.tileInfo(id, cur, today, d.daily, d.air), x = ox + i * (tw + gap);
        cv.roundRect(x, ty, tw, th, 14, G.withAlpha('#000000', PLATE));
        cv.text(fit(cv, info.title, 21, LAB, tw - 20), x + 12, ty + 40, 21, DIM, LAB);
        cv.text(fit(cv, info.value, 46, BOLD, tw - 20), x + 12, ty + 112, 46, t.text, BOLD);
        if (info.sub) cv.text(fit(cv, info.sub, 19, LAB, tw - 20), x + 12, ty + th - 18, 19, DIM, LAB);
        if (info.bar) cv.fillRect(x + 12, ty + 130, tw - 24, 5, info.bar);
    });
}

function drawWidget(cv, G, t, v) {
    const w = v.w, h = v.h, d = v.data, cur = d && d.current;
    // the car shows the picture centred and cropped at the sides: keep the content off them
    const ox = Math.round(w * 0.07), W2 = w - 2 * ox;
    cv.fillRect(0, 0, w, h, '#101319');
    if (!cur) { cv.text('Thời tiết', w / 2, h / 2 - 6, Math.round(h * 0.16), t.text, { literal: true, font: 'bold', align: 'center' }); cv.text('đang chờ dữ liệu', w / 2, h / 2 + h * 0.14, Math.round(h * 0.1), t.dim, { literal: true, font: 'label', align: 'center' }); return; }
    if (v.big) return drawWidgetBig(cv, G, t, v);
    const wc = Wx.describe(cur.code), s = h / 240, today = (d.daily && d.daily[0]) || {};
    const tint = cur.day ? '#2a5a9a' : '#1a2340';
    cv.gradientRect(0, 0, w, h, [[0, G.withAlpha(tint, 0.9)], [1, '#101319']]);
    Icons.draw(cv, wc.icon, cur.day, ox + 78 * s, 100 * s, 120 * s);
    const big = Wx.deg(cur.t).replace('°', '');
    cv.text(big, ox + 150 * s, 118 * s, 84 * s, t.text, BOLD);
    cv.text('°' + Wx.getUnit(), ox + 150 * s + cv.textWidth(big, 84 * s, BOLD) + 4, 70 * s, 26 * s, t.dim, BOLD);
    cv.text(fit(cv, d.name || '', 22 * s, BOLD, W2 - 24 * s), ox + 14 * s, 26 * s, 22 * s, t.text, BOLD);
    cv.text(fit(cv, wc.text, 24 * s, BOLD, 190 * s), ox + 150 * s, 152 * s, 24 * s, t.text, BOLD);
    const rainIn = cur.rainIn;
    let msg = '', col = t.dim;
    if (typeof rainIn === 'number') { msg = rainIn === 0 ? 'Đang mưa' : 'Mưa sau ' + rainIn + ' phút'; col = RAIN; }
    else if (today.pop >= 50) { msg = 'Mưa hôm nay ' + Wx.pct(today.pop); col = RAIN; }
    else msg = 'Cao ' + Wx.deg(today.hi) + '  ·  Thấp ' + Wx.deg(today.lo);
    if (typeof rainIn === 'number') { cv.roundRect(ox + 12 * s, 176 * s, W2 - 24 * s, 46 * s, 23 * s, G.withAlpha(RAIN, 0.25)); cv.strokeRoundRect(ox + 12 * s, 176 * s, W2 - 24 * s, 46 * s, 23 * s, 1.5, G.withAlpha(RAIN, 0.8)); }
    cv.text(fit(cv, msg, 24 * s, BOLD, W2 - 48 * s), w / 2, 208 * s, 24 * s, typeof rainIn === 'number' ? t.text : col, { literal: true, font: 'bold', align: 'center' });
    {
        const hrs = (d.hourly || []).filter((_, i) => i % 3 === 0).slice(1, 5), x0 = ox + 318 * s, cw = (w - ox - x0 - 10 * s) / 4;
        hrs.forEach((hr, i) => {
            const cx = x0 + cw * i + cw / 2;
            cv.text(hr.time, cx, 52 * s, 15 * s, t.dim, { literal: true, font: 'label', align: 'center' });
            Icons.draw(cv, Wx.describe(hr.code).icon, hr.day, cx, 92 * s, 40 * s);
            cv.text(Wx.deg(hr.t), cx, 140 * s, 22 * s, t.text, { literal: true, font: 'bold', align: 'center' });
        });
    }
}


function draw(cv, G, t, v, act) {
    act = act || {};
    v = Object.assign({ set: Wx.settingsOf(null) }, v);
    Wx.setUnit(v.set.unit);
    cv.clear(t.bg);
    G.frame(cv, t, ['Thời tiết'], 0, []);
    G.panel(cv, t, 24, G.TOP, W - 48, G.BOTTOM - G.TOP, null);
    if (v.mode === 'pick') drawPick(cv, G, t, v, act);
    else if (v.mode === 'phone') drawPhone(cv, G, t, v, act);
    else if (v.mode === 'settings') drawSettings(cv, G, t, v, act);
    else if (v.drive) drawDrive(cv, G, t, v, act);
    else drawMain(cv, G, t, v, act);
    return cv;
}

module.exports = { draw, drawWidget, W, H };
