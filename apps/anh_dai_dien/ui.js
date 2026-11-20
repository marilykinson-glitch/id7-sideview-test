'use strict';
/**
 * ui.js - the MGU Studio screen, a pure draw(cv, G, t, v, act) for the car and the preview.
 *
 * On the left a QR code with the address the phone opens and the PIN; on the right what can be changed, as three
 * cards (the car's picture, the start-up screen, the profile pictures) and one line for the small rest, each saying
 * whether the owner's picture or the car's own is in use; the tool's last message and the buttons.
 *
 * v = { state: 'ok' | 'down' | 'bad', url, host, pin, slots: [{ n, changed }] (the profile pictures),
 *       thumbs: { 41, 51: RGBA 48 wide; 1..15: RGBA 24 x 24 } (small pictures of what is in use; any may be missing),
 *       more: [{ n, label, changed }] (41 the car, 51 the start-up screen, the others the placeholder pictures),
 *       message, messageKind ('go' | 'warn' | 'crit' | 'dim'), needsRestart, busy, error, backup, anyChanged, version,
 *       carWhere ('both' | 'tile' | 'menu': where the car's picture is), armed ('reboot' | 'restore': the button pressed
 *       once, waiting for the second press), note, noteKind (what the app says about a press, before the tool answers) }
 * act = { restoreAll, reboot }
 * Node 8.
 */
const QR = require('./kit/qr');
const W = 1600, H = 520;
const kindColor = (t, kind) => (kind === 'go' ? (t.go || '#2fd27a') : kind === 'warn' ? (t.warn || '#ffb020') : kind === 'crit' ? (t.crit || '#ef2b2d') : t.dim);
const nop = () => {};
/** The text, cut with an ellipsis if it is wider than `max`. */
function fit(cv, str, size, o, max) {
    str = String(str || '');
    if (cv.textWidth(str, size, o) <= max) return str;
    while (str.length > 1 && cv.textWidth(str + '…', size, o) > max) str = str.slice(0, -1);
    return str + '…';
}

const CAR = 41, START = 51;
const MINI = 48, CELL = 3;             // a small picture: 48 pixels wide, each drawn as a 3 x 3 square

/**
 * A small picture (RGBA, w x h, top-down) drawn as coloured rectangles: the Store's renderer takes no pixel images.
 * Colours are rounded to 16 steps a channel and equal neighbours in a row become one rectangle; transparent and
 * black parts are the dark ground under it.
 */
function mosaic(cv, G, rgba, w, h, x, y, cell) {
    cv.fillRect(x, y, w * cell, h * cell, '#07080b');
    if (!rgba || rgba.length < w * h * 4) return;
    const hex = (v) => (v < 16 ? '0' : '') + v.toString(16);
    for (let r = 0; r < h; r++) {
        let from = 0, last = -1;
        for (let c = 0; c <= w; c++) {
            let q = -1;
            if (c < w) {
                const i = (r * w + c) * 4, a = rgba[i + 3] / 255;
                q = (((rgba[i] * a) >> 4) << 8) | (((rgba[i + 1] * a) >> 4) << 4) | ((rgba[i + 2] * a) >> 4);
            }
            if (q === last) continue;
            if (last > 0) cv.fillRect(x + from * cell, y + r * cell, (c - from) * cell, cell, '#' + hex(((last >> 8) & 15) * 17) + hex(((last >> 4) & 15) * 17) + hex((last & 15) * 17));
            from = c; last = q;
        }
    }
}

/**
 * One thing that can be changed: its name, a small picture of what is in use now (pics: [{ rgba, w, h }]), whose it
 * is, and where it shows.
 */
function card(cv, G, t, x, y, w, h, title, sub, mine, state, pics) {
    const go = t.go || '#2fd27a';
    cv.roundRect(x, y, w, h, 14, G.withAlpha('#ffffff', mine ? 0.07 : 0.04));
    cv.strokeRoundRect(x, y, w, h, 14, mine ? 2 : 1.2, mine ? G.withAlpha(go, 0.9) : G.withAlpha('#ffffff', 0.2));
    cv.text(title, x + 22, y + 38, 24, t.text, { literal: true, font: 'bold' });
    const py = y + 54, ph = 72;
    let px = x + 22;
    (pics || []).forEach((p) => {
        const cell = p.cell || Math.max(1, Math.floor(Math.min(MINI * CELL / p.w, ph / p.h)));
        mosaic(cv, G, p.rgba, p.w, p.h, px, py + Math.floor((ph - p.h * cell) / 2), cell);
        cv.strokeRoundRect(px - 1, py + Math.floor((ph - p.h * cell) / 2) - 1, p.w * cell + 2, p.h * cell + 2, 2, 1, G.withAlpha('#ffffff', 0.22));
        px += p.w * cell + 8;
    });
    const tx = Math.max(px + 6, x + 22);
    cv.circle(tx + 7, py + 30, 6, mine ? go : G.withAlpha('#ffffff', 0.35));
    cv.text(fit(cv, state, 18, { literal: true, font: 'label' }, x + w - 16 - (tx + 22)), tx + 22, py + 37, 18, mine ? go : t.dim, { literal: true, font: 'label' });
    cv.text(fit(cv, sub, 15, { literal: true, font: 'label' }, w - 44), x + 22, y + h - 16, 15, t.dim, { literal: true, font: 'label' });
}

function draw(cv, G, t, v, act) {
    act = act || {};
    cv.clear(t.bg);
    G.frame(cv, t, ['MGU Studio'], 0, []);
    G.panel(cv, t, 24, G.TOP, W - 48, G.BOTTOM - G.TOP, null);
    const acc = t.accent2 || '#81c4ff', red = t.crit || '#ef2b2d';
    const bottom = G.pageBottom(cv) - (cv.own ? G.MARGIN : 0);
    const lx = 64, top = G.TOP + 34;

    // left: the QR code, the PIN, the address
    if (v.state === 'ok' && v.url) {
        let side = 0;
        try { side = QR.draw(cv, v.url, lx, top, 7); } catch (e) { side = 0; }
        const qx = lx + (side || 259) / 2;
        cv.text('MÃ PIN', qx, top + (side || 259) + 34, 14, t.dim, { literal: true, align: 'center', font: 'bold', spacing: 2 });
        cv.text(String(v.pin || '').split('').join(' '), qx, top + (side || 259) + 86, 54, t.text, { literal: true, align: 'center', font: 'bold', spacing: 3 });
        cv.text(v.host || '', qx, top + (side || 259) + 114, 14, G.withAlpha('#ffffff', 0.35), { literal: true, align: 'center', font: 'label' });
    } else {
        cv.roundRect(lx, top, 259, 259, 18, G.withAlpha('#ffffff', 0.05));
        cv.strokeRoundRect(lx, top, 259, 259, 18, 1.5, G.withAlpha('#ffffff', 0.2));
        cv.text(v.state === 'down' ? 'CHƯA CÓ TRỢ THỦ' : v.state === 'bad' ? 'KHÔNG DÙNG ĐƯỢC' : 'CHƯA CÓ MẠNG', lx + 130, top + 138, 18, t.dim, { literal: true, align: 'center', font: 'bold', spacing: 1.5 });
    }

    // right: title, state, how to
    const rx = 460, rw = W - 64 - rx;
    cv.text('MGU STUDIO', rx, G.TOP + 76, 40, t.text, { literal: true, font: 'bold', spacing: 3 });
    const stateText = v.state === 'down' ? 'Trợ thủ chưa chạy: khởi động lại màn hình xe' : v.state === 'bad' ? (v.error || 'Gói ảnh của xe này chưa dùng được')
        : !v.url ? 'Xe chưa vào mạng Wi-Fi nào: nối Wi-Fi hoặc điểm phát sóng của điện thoại' : v.busy ? 'Đang ghi vào xe…' : 'Sẵn sàng';
    const stateKind = v.state === 'ok' && v.url ? (v.busy ? 'warn' : 'go') : 'warn';
    const note = 'Tuỳ biến hình ảnh MGU ID7', nx = rx + cv.textWidth('MGU STUDIO', 40, { literal: true, font: 'bold', spacing: 3 }) + 20;
    cv.text(note, nx, G.TOP + 76, 18, t.dim, { literal: true, font: 'label' });
    const sx = nx + cv.textWidth(note, 18, { literal: true, font: 'label' }) + 30;
    cv.circle(sx + 8, G.TOP + 69, 7, kindColor(t, stateKind));
    cv.text(fit(cv, stateText, 19, { literal: true, font: 'label' }, W - 64 - (sx + 26)), sx + 26, G.TOP + 76, 19, kindColor(t, stateKind), { literal: true, font: 'label' });
    if (v.version) cv.text(v.version, W - 64, G.TOP + 34, 14, G.withAlpha('#ffffff', 0.35), { literal: true, align: 'right', font: 'label' });
    cv.text('Quét mã QR bằng điện thoại, chọn ảnh, rồi bấm Khởi động lại để xe dùng hình mới.', rx, G.TOP + 112, 18, t.dim, { literal: true, font: 'label' });

    // what can be changed
    if (v.state === 'ok') {
        const more = v.more || [], car = more.filter((m) => m.n === CAR)[0], start = more.filter((m) => m.n === START)[0];
        const rest = more.filter((m) => m.n !== CAR && m.n !== START), restMine = rest.filter((m) => m.changed).length;
        const slots = v.slots || [], mine = slots.filter((x) => x.changed).length;
        const gap = 20, cw = (rw - 2 * gap) / 3, cy = G.TOP + 134, ch = 166, th = v.thumbs || {};
        const whose = (m) => (!m ? 'Chưa hỗ trợ' : m.changed ? 'Ảnh của bạn' : 'Hình gốc');
        const one = (n) => (th[n] ? [{ rgba: th[n], w: MINI, h: Math.max(1, Math.min(24, Math.floor(th[n].length / 4 / MINI))) }] : []);
        const faces = slots.filter((x) => x.changed && th[x.n]).concat(slots.filter((x) => !x.changed && th[x.n])).slice(0, 3).map((x) => ({ rgba: th[x.n], w: 24, h: 24, cell: 2 }));
        const carSub = !(car && car.changed) ? 'Menu Xe của tôi, ô xe ở màn hình chính' : v.carWhere === 'tile' ? 'Chỉ ô xe ở màn hình chính' : v.carWhere === 'menu' ? 'Chỉ trong menu Xe của tôi' : 'Menu Xe của tôi và ô xe màn hình chính';
        card(cv, G, t, rx, cy, cw, ch, 'Hình chiếc xe', carSub, !!(car && car.changed), whose(car), one(CAR));
        card(cv, G, t, rx + cw + gap, cy, cw, ch, 'Màn hình khởi động', 'Lúc chào và lúc tạm biệt', !!(start && start.changed), whose(start), one(START));
        card(cv, G, t, rx + 2 * (cw + gap), cy, cw, ch, 'Ảnh đại diện', slots.length + ' hình của hồ sơ người lái', mine > 0, mine ? 'Đã đổi ' + mine + '/' + slots.length : 'Hình gốc', faces);
        if (rest.length) {
            const oy = cy + ch + 12, go = t.go || '#2fd27a';
            cv.roundRect(rx, oy, rw, 46, 12, G.withAlpha('#ffffff', 0.04));
            cv.strokeRoundRect(rx, oy, rw, 46, 12, 1.2, G.withAlpha('#ffffff', 0.16));
            cv.text('Khác', rx + 22, oy + 30, 19, t.text, { literal: true, font: 'bold' });
            const names = rest.map((m) => m.label).join(' · ');
            cv.text(fit(cv, names, 16, { literal: true, font: 'label' }, rw - 86 - 190), rx + 86, oy + 30, 16, t.dim, { literal: true, font: 'label' });
            cv.text(restMine ? 'Đã đổi ' + restMine + '/' + rest.length : 'Hình gốc', rx + rw - 22, oy + 30, 17, restMine ? go : t.dim, { literal: true, align: 'right', font: 'label' });
        }
    }

    // the last message and the two buttons; a button pressed once is filled and asks for the second press
    const by = bottom - 54, bw = 290, gap2 = 16;
    let msg = v.message, kind = v.messageKind;
    if (v.needsRestart) { msg = 'Có thay đổi: bấm Khởi động lại để thấy.'; kind = 'warn'; }
    if (v.note) { msg = v.note; kind = v.noteKind; }
    if (msg && (v.state === 'ok' || v.note)) cv.text(fit(cv, msg, 19, { literal: true, font: 'label' }, rw - 2 * bw - gap2 - 24), rx, by + 35, 19, kindColor(t, kind), { literal: true, font: 'label' });
    const bx = W - 64 - bw;
    const ask = 'Bấm lần nữa';
    G.button(cv, t, bx, by, bw, 54, v.armed === 'restore' ? ask : 'Khôi phục tất cả', act.restoreAll || nop,
        { key: 'adRestore', color: v.armed === 'restore' || v.anyChanged ? red : undefined, primary: v.armed === 'restore', busy: !v.anyChanged });
    G.button(cv, t, bx - gap2 - bw, by, bw, 54, v.armed === 'reboot' ? ask : 'Khởi động lại', act.reboot || nop,
        { key: 'adReboot', color: v.armed === 'reboot' ? red : v.needsRestart ? acc : undefined, primary: v.armed === 'reboot' || !!v.needsRestart });
    return cv;
}

module.exports = { draw, W, H, MINI };
