'use strict';
/**
 * ui.js - the Ảnh đại diện screen, a pure draw(cv, G, t, v, act) for the car and the preview.
 *
 * On the left a QR code with the address the phone opens and the PIN; on the right what to do in three
 * steps, the fifteen pictures as they are on the car now (96x96 each, from the tool), the tool's last message
 * and the buttons.
 *
 * v = { state: 'ok' | 'down' | 'bad', url, host, pin, slots: [{ n, changed }], thumbs: { n: RGBA 96x96 },
 *       more: [{ n, label, changed }] (the placeholder pictures: named, not drawn),
 *       message, messageKind ('go' | 'warn' | 'crit' | 'dim'), needsRestart, busy, error, backup, anyChanged, version }
 * act = { restoreAll, newPin }
 * Node 8.
 */
const QR = require('./kit/qr');
const REC = require('./kit/record');
const W = 1600, H = 520;
const SMALL = 96;
const kindColor = (t, kind) => (kind === 'go' ? (t.go || '#2fd27a') : kind === 'warn' ? (t.warn || '#ffb020') : kind === 'crit' ? (t.crit || '#ef2b2d') : t.dim);
const nop = () => {};

// A picture: a Canvas draws RGBA bytes itself; the kit's Recorder (the car) draws a registered pixel image by id.
const known = {};
function pic(cv, n, rgba, x, y, w, h) {
    if (typeof cv.drawImage === 'function') return cv.drawImage(rgba, SMALL, SMALL, x, y, w, h);
    const id = 7100 + n;
    if (known[id] !== rgba) { REC.setImage(id, SMALL, SMALL, rgba); known[id] = rgba; }
    return cv.image(id, x, y, w, h);
}

function steps(cv, G, t, x, y) {
    const acc = t.accent2 || '#81c4ff';
    const rows = [
        ['1', 'Quét mã QR bằng điện thoại', 'điện thoại và xe cùng Wi-Fi hoặc điểm phát sóng'],
        ['2', 'Chọn hình, chọn ảnh, kéo để cắt vuông', 'rồi bấm "Dùng ảnh này"'],
        ['3', 'Khởi động lại màn hình xe', 'để xe dùng hình mới'],
    ];
    rows.forEach((r, i) => {
        const yy = y + i * 40;
        cv.circle(x + 15, yy - 7, 15, G.withAlpha(acc, 0.16));
        cv.arc(x + 15, yy - 7, 13.5, 15, 0, 360, G.withAlpha(acc, 0.85));
        cv.text(r[0], x + 15, yy, 17, acc, { literal: true, align: 'center', font: 'bold' });
        cv.text(r[1], x + 44, yy, 21, t.text, { literal: true, font: 'bold' });
        cv.text(r[2], x + 44 + cv.textWidth(r[1], 21, { literal: true, font: 'bold' }) + 14, yy, 16, t.dim, { literal: true, font: 'label' });
    });
}

function strip(cv, G, t, v, x, y, tile, gap) {
    const go = t.go || '#2fd27a';
    cv.text('ẢNH ĐẠI DIỆN TRÊN XE', x, y - 12, 14, t.dim, { literal: true, font: 'bold', spacing: 1.5 });
    (v.slots || []).forEach((s, i) => {
        const tx = x + i * (tile + gap), im = v.thumbs && v.thumbs[s.n];
        if (im) pic(cv, s.n, im, tx, y, tile, tile);
        else cv.roundRect(tx, y, tile, tile, 6, G.withAlpha('#ffffff', 0.08));
        cv.strokeRoundRect(tx, y, tile, tile, 4, s.changed ? 3 : 1.5, s.changed ? go : G.withAlpha('#ffffff', 0.28));
        cv.roundRect(tx + 4, y + 4, 22, 20, 6, G.withAlpha('#000000', 0.62));
        cv.text(String(s.n), tx + 15, y + 20, 14, '#ffffff', { literal: true, align: 'center', font: 'bold' });
    });
}

/** The placeholder pictures by name: a green one is the owner's, a grey one the car's. */
function chips(cv, G, t, v, x, y) {
    const go = t.go || '#2fd27a';
    const label = 'HÌNH MẶC ĐỊNH';
    cv.text(label, x, y + 5, 14, t.dim, { literal: true, font: 'bold', spacing: 1.5 });
    let cx = x + cv.textWidth(label, 14, { literal: true, font: 'bold', spacing: 1.5 }) + 18;
    (v.more || []).forEach((m) => {
        const w = cv.textWidth(m.label, 15, { literal: true, font: 'label' }) + 24;
        if (cx + w > W - 64) return;
        cv.strokeRoundRect(cx, y - 14, w, 28, 14, m.changed ? 2 : 1.2, m.changed ? go : G.withAlpha('#ffffff', 0.25));
        cv.text(m.label, cx + w / 2, y + 5, 15, m.changed ? go : t.dim, { literal: true, align: 'center', font: 'label' });
        cx += w + 8;
    });
}

function draw(cv, G, t, v, act) {
    act = act || {};
    cv.clear(t.bg);
    G.frame(cv, t, ['Dấu Ấn'], 0, []);
    G.panel(cv, t, 24, G.TOP, W - 48, G.BOTTOM - G.TOP, null);
    const acc = t.accent2 || '#81c4ff', go = t.go || '#2fd27a', red = t.crit || '#ef2b2d';
    const bottom = G.pageBottom(cv) - (cv.own ? G.MARGIN : 0);
    const lx = 64, top = G.TOP + 34;

    // left: the QR code, the address, the PIN
    if (v.state === 'ok' && v.url) {
        let side = 0;
        try { side = QR.draw(cv, v.url, lx, top, 7); } catch (e) { side = 0; }
        const qx = lx + (side || 259) / 2;
        cv.text(v.host || '', qx, top + (side || 259) + 28, 17, t.dim, { literal: true, align: 'center', font: 'label' });
        cv.text('MÃ PIN', qx, top + (side || 259) + 62, 14, t.dim, { literal: true, align: 'center', font: 'bold', spacing: 2 });
        cv.text(String(v.pin || '').split('').join(' '), qx, top + (side || 259) + 112, 54, t.text, { literal: true, align: 'center', font: 'bold', spacing: 3 });
    } else {
        cv.roundRect(lx, top, 259, 259, 18, G.withAlpha('#ffffff', 0.05));
        cv.strokeRoundRect(lx, top, 259, 259, 18, 1.5, G.withAlpha('#ffffff', 0.2));
        cv.text(v.state === 'down' ? 'CHƯA CÓ TRỢ THỦ' : v.state === 'bad' ? 'KHÔNG DÙNG ĐƯỢC' : 'CHƯA CÓ MẠNG', lx + 130, top + 138, 18, t.dim, { literal: true, align: 'center', font: 'bold', spacing: 1.5 });
    }

    // right: title, state, the steps, the pictures
    const rx = 460;
    cv.text('DẤU ẤN', rx, G.TOP + 76, 40, t.text, { literal: true, font: 'bold', spacing: 3 });
    cv.text('Hình trên xe, theo ý bạn', rx + cv.textWidth('DẤU ẤN', 40, { literal: true, font: 'bold', spacing: 3 }) + 20, G.TOP + 76, 20, t.dim, { literal: true, font: 'label' });
    const stateText = v.state === 'down' ? 'Trợ thủ chưa chạy: khởi động lại màn hình xe' : v.state === 'bad' ? (v.error || 'Gói ảnh của xe này chưa dùng được')
        : !v.url ? 'Xe chưa vào mạng Wi-Fi nào: nối Wi-Fi hoặc điểm phát sóng của điện thoại' : v.busy ? 'Đang ghi vào xe…' : 'Sẵn sàng';
    const stateKind = v.state === 'ok' && v.url ? (v.busy ? 'warn' : 'go') : 'warn';
    cv.circle(rx + 8, G.TOP + 105, 7, kindColor(t, stateKind));
    cv.text(stateText, rx + 26, G.TOP + 112, 19, kindColor(t, stateKind), { literal: true, font: 'label' });
    if (v.version) cv.text(v.version, W - 64, G.TOP + 34, 14, G.withAlpha('#ffffff', 0.35), { literal: true, align: 'right', font: 'label' });

    steps(cv, G, t, rx, G.TOP + 164);

    if (v.slots && v.slots.length) {
        const tile = 56, gap = 8;
        strip(cv, G, t, v, rx, G.TOP + 288, tile, gap);
    }
    if (v.more && v.more.length) chips(cv, G, t, v, rx, G.TOP + 372);

    // the last message and the buttons
    const by = bottom - 54;
    let msg = v.message, kind = v.messageKind;
    if (v.needsRestart) { msg = 'Có thay đổi: khởi động lại màn hình xe để thấy.'; kind = 'warn'; }
    if (msg && !(v.state !== 'ok')) cv.text(msg, rx, by + 35, 18, kindColor(t, kind), { literal: true, font: 'label' });
    const bx = W - 64 - 250 - 14 - 190;
    G.button(cv, t, bx, by, 190, 54, 'Mã PIN mới', act.newPin || nop, { key: 'adPin' });
    G.button(cv, t, bx + 204, by, 250, 54, 'Khôi phục tất cả', act.restoreAll || nop, { key: 'adRestore', color: v.anyChanged ? red : undefined, busy: !v.anyChanged, confirm: true });
    return cv;
}

module.exports = { draw, W, H, SMALL };
