'use strict';
/**
 * ui.js - the MGU Studio screen, a pure draw(cv, G, t, v, act) for the car and the preview.
 *
 * On the left a QR code with the address the phone opens and the PIN; on the right what can be changed, as three
 * cards (the car's picture, the start-up screen, the profile pictures) and one line for the small rest, each saying
 * whether the owner's picture or the car's own is in use; the tool's last message and the buttons.
 *
 * v = { state: 'ok' | 'down' | 'bad', url, host, pin, slots: [{ n, changed }] (the profile pictures),
 *       more: [{ n, label, changed }] (41 the car, 51 the start-up screen, the others the placeholder pictures),
 *       message, messageKind ('go' | 'warn' | 'crit' | 'dim'), needsRestart, busy, error, backup, anyChanged, version }
 * act = { restoreAll, newPin, reboot }
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

/** One thing that can be changed: its name, what it is, and whose picture is in use now. */
function card(cv, G, t, x, y, w, h, title, sub, mine, state) {
    const go = t.go || '#2fd27a';
    cv.roundRect(x, y, w, h, 14, G.withAlpha('#ffffff', mine ? 0.07 : 0.04));
    cv.strokeRoundRect(x, y, w, h, 14, mine ? 2 : 1.2, mine ? G.withAlpha(go, 0.9) : G.withAlpha('#ffffff', 0.2));
    cv.text(title, x + 22, y + 40, 24, t.text, { literal: true, font: 'bold' });
    cv.text(sub, x + 22, y + 68, 16, t.dim, { literal: true, font: 'label' });
    cv.circle(x + 29, y + h - 27, 6, mine ? go : G.withAlpha('#ffffff', 0.35));
    cv.text(state, x + 46, y + h - 20, 18, mine ? go : t.dim, { literal: true, font: 'label' });
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
    const sx = rx + cv.textWidth('MGU STUDIO', 40, { literal: true, font: 'bold', spacing: 3 }) + 28;
    cv.circle(sx + 8, G.TOP + 63, 7, kindColor(t, stateKind));
    cv.text(stateText, sx + 26, G.TOP + 70, 19, kindColor(t, stateKind), { literal: true, font: 'label' });
    if (v.version) cv.text(v.version, W - 64, G.TOP + 34, 14, G.withAlpha('#ffffff', 0.35), { literal: true, align: 'right', font: 'label' });
    cv.text('Quét mã QR bằng điện thoại, chọn ảnh, rồi bấm Khởi động lại để xe dùng hình mới.', rx, G.TOP + 112, 18, t.dim, { literal: true, font: 'label' });

    // what can be changed
    if (v.state === 'ok') {
        const more = v.more || [], car = more.filter((m) => m.n === CAR)[0], start = more.filter((m) => m.n === START)[0];
        const rest = more.filter((m) => m.n !== CAR && m.n !== START), restMine = rest.filter((m) => m.changed).length;
        const slots = v.slots || [], mine = slots.filter((x) => x.changed).length;
        const gap = 20, cw = (rw - 2 * gap) / 3, cy = G.TOP + 140, ch = 128;
        const whose = (m) => (!m ? 'Xe này chưa hỗ trợ' : m.changed ? 'Đang dùng ảnh của bạn' : 'Hình gốc của xe');
        card(cv, G, t, rx, cy, cw, ch, 'Hình chiếc xe', 'Menu Xe của tôi, ô xe màn hình chính', !!(car && car.changed), whose(car));
        card(cv, G, t, rx + cw + gap, cy, cw, ch, 'Màn hình khởi động', 'Lúc chào và lúc tạm biệt', !!(start && start.changed), whose(start));
        card(cv, G, t, rx + 2 * (cw + gap), cy, cw, ch, 'Ảnh đại diện', slots.length + ' hình của hồ sơ người lái', mine > 0, mine ? 'Đã đổi ' + mine + '/' + slots.length + ' hình' : 'Hình gốc của xe');
        if (rest.length) {
            const oy = cy + ch + 14, go = t.go || '#2fd27a';
            cv.roundRect(rx, oy, rw, 46, 12, G.withAlpha('#ffffff', 0.04));
            cv.strokeRoundRect(rx, oy, rw, 46, 12, 1.2, G.withAlpha('#ffffff', 0.16));
            cv.text('Khác', rx + 22, oy + 30, 19, t.text, { literal: true, font: 'bold' });
            const names = rest.map((m) => m.label).join(' · ');
            cv.text(fit(cv, names, 16, { literal: true, font: 'label' }, rw - 86 - 190), rx + 86, oy + 30, 16, t.dim, { literal: true, font: 'label' });
            cv.text(restMine ? 'Đã đổi ' + restMine + '/' + rest.length : 'Hình gốc', rx + rw - 22, oy + 30, 17, restMine ? go : t.dim, { literal: true, align: 'right', font: 'label' });
        }
    }

    // the last message and the buttons
    const by = bottom - 54;
    let msg = v.message, kind = v.messageKind;
    if (v.needsRestart) { msg = 'Có thay đổi: bấm Khởi động lại để thấy.'; kind = 'warn'; }
    if (msg && v.state === 'ok') cv.text(fit(cv, msg, 18, { literal: true, font: 'label' }, rw - 3 * 14 - 230 - 190 - 250), rx, by + 35, 18, kindColor(t, kind), { literal: true, font: 'label' });
    const bx = W - 64 - 250;
    G.button(cv, t, bx, by, 250, 54, 'Khôi phục tất cả', act.restoreAll || nop, { key: 'adRestore', color: v.anyChanged ? red : undefined, busy: !v.anyChanged, confirm: true });
    G.button(cv, t, bx - 14 - 190, by, 190, 54, 'Mã PIN mới', act.newPin || nop, { key: 'adPin' });
    G.button(cv, t, bx - 14 - 190 - 14 - 230, by, 230, 54, 'Khởi động lại', act.reboot || nop, { key: 'adReboot', color: v.needsRestart ? acc : undefined, confirm: true });
    return cv;
}

module.exports = { draw, W, H };
