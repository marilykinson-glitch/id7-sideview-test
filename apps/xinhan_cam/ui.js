'use strict';
/**
 * ui.js - the Camera xi nhan screen, a pure draw(cv, G, t, v, act) for the car and the preview.
 *
 * Two pages (tabs):
 *   0 "Camera"   a picture of the instrument cluster with where each camera view sits, lit while it
 *                shows; the state in large type and four status rows; buttons to try each view.
 *   1 "Vị trí"   the same picture, larger: a tap on it puts the view of the side being edited there, the
 *                buttons move it STEP cluster pixels, change its size and shape. While this page is open
 *                the app shows that side's camera on the real cluster, so every change is seen at once.
 *
 *   2 "Canh chỉnh"  one camera at a time, shown on the cluster while the page is open: the mirror cameras' part
 *                moved and enlarged; the front camera's height, tilt and so on, with marks at 5, 10 and 20 m drawn
 *                on its picture, which are moved until they lie on the road.
 *   3 "Dẫn đường"   what the navigation says the next turn is, how it is drawn on the front camera, a demo.
 *
 * v = { page, title, titleKind ('go' | 'warn' | 'dim'), rows: [{ label, text, kind }], shown (the view on the
 *       cluster now: 'left' | 'right' | 'front' | 'all' | null), enabled, front (the setting's label),
 *       discs: { left: { x, y, w, h }, right: {...} } (cluster pixels), frontRect: { x, y, w, h } | null,
 *       round, gauge (the views sit in the dials), edit ('left' | 'right'), sizeLabel, note, version }
 *       page 2: calCam ('left' | 'right' | 'front'), calRows: [{ key, label, text }] (front), calText (mirrors)
 *       page 3: navRows: [{ label, text, kind }], arLabel, arCard, demo
 * act = { camL, camR, camF, panL, panR, panU, panD, zoomIn, zoomOut, calReset, '<key>-' / '<key>+' per calRows key,
 *         arMode, arCard, demo, left, right, all, front, toggle, side, up, down, in, out, smaller, larger, shape, reset }
 * Node 8.
 */
const W = 1600, H = 520;
const TABS = ['Camera', 'Vị trí', 'Canh chỉnh', 'Dẫn đường'];
const STEP = 10;
const PANEL = { w: 1920, h: 720 };          // the whole cluster, in its own pixels
const MAP = { x: 416, y: 120, w: 1088, h: 480 };   // its middle map area
// the cluster's picture on each page: where, and how much smaller than the cluster
const PICS = [{ x: 56, y: 92, k: 0.4 }, { x: 56, y: 92, k: 0.5 }];

const kindColor = (t, kind) => (kind === 'go' ? (t.go || '#2fd27a') : kind === 'warn' ? (t.warn || '#ffb020') : kind === 'crit' ? (t.crit || '#ef2b2d') : t.dim);

/** A tap on the Position page's picture: { x, y } in cluster pixels, or null. */
function hit(px, py) {
    const p = PICS[1];
    const x = (px - p.x) / p.k, y = (py - p.y) / p.k;
    return x >= 0 && y >= 0 && x <= PANEL.w && y <= PANEL.h ? { x, y } : null;
}

/** The cluster, schematically: its outline, the two dials, the map area, and the camera views on it. */
function cluster(cv, G, t, p, v, editing) {
    const k = p.k, X = (x) => p.x + x * k, Y = (y) => p.y + y * k;
    const acc = t.accent2 || '#81c4ff', go = t.go || '#2fd27a', line = G.withAlpha('#ffffff', 0.28);
    cv.roundRect(p.x, p.y, PANEL.w * k, PANEL.h * k, 18, G.withAlpha('#ffffff', 0.04));
    cv.strokeRoundRect(p.x, p.y, PANEL.w * k, PANEL.h * k, 18, 1.5, G.withAlpha('#ffffff', 0.2));
    // the map area between the dials
    cv.roundRect(X(MAP.x + 150), Y(MAP.y), (MAP.w - 300) * k, MAP.h * k, 10, G.withAlpha(acc, 0.07));
    if (!v.frontRect && v.shown !== 'all') cv.text('BẢN ĐỒ', X(PANEL.w / 2), Y(PANEL.h / 2) + 6, 15, G.withAlpha('#ffffff', 0.25), { literal: true, align: 'center', font: 'bold', spacing: 2 });
    // the dials: the speedometer opens to the right, the rev counter to the left
    const r = 300 * k, w = 5;
    cv.arc(X(430), Y(380), r - w, r, 200, 395, line, { round: true });
    cv.arc(X(PANEL.w - 430), Y(380), r - w, r, -35, 160, line, { round: true });
    cv.text('km/h', X(430), Y(170), 13, G.withAlpha('#ffffff', 0.3), { literal: true, align: 'center', font: 'label' });
    cv.text('1/min', X(PANEL.w - 430), Y(170), 13, G.withAlpha('#ffffff', 0.3), { literal: true, align: 'center', font: 'label' });
    // the front camera's place
    if (v.frontRect) {
        const f = v.frontRect, on = v.shown === 'front';
        cv.roundRect(X(f.x), Y(f.y), f.w * k, f.h * k, 8, G.withAlpha(on ? go : '#ffffff', on ? 0.3 : 0.06));
        cv.strokeRoundRect(X(f.x), Y(f.y), f.w * k, f.h * k, 8, on ? 3 : 1.5, on ? go : G.withAlpha('#ffffff', 0.3));
        cv.text('CAMERA TRƯỚC', X(f.x + f.w / 2), Y(f.y + f.h / 2) + 5, 14, on ? '#ffffff' : G.withAlpha('#ffffff', 0.45), { literal: true, align: 'center', font: 'bold', spacing: 1.5 });
    }
    // the mirror cameras' places
    ['left', 'right'].forEach((side) => {
        const d = v.discs && v.discs[side];
        if (!d) return;
        const on = v.shown === side || v.shownAux === side, ed = editing === side;
        const c = on ? go : ed ? acc : G.withAlpha('#ffffff', 0.4);
        const cx = X(d.x + d.w / 2), cy = Y(d.y + d.h / 2), rw = d.w * k / 2, rh = d.h * k / 2;
        if (v.round) {
            cv.circle(cx, cy, rw, G.withAlpha(on ? go : ed ? acc : '#ffffff', on ? 0.35 : ed ? 0.2 : 0.08));
            cv.arc(cx, cy, rw - (on || ed ? 3.5 : 2), rw, 0, 360, c);
        } else {
            cv.roundRect(cx - rw, cy - rh, rw * 2, rh * 2, 6, G.withAlpha(on ? go : ed ? acc : '#ffffff', on ? 0.35 : ed ? 0.2 : 0.08));
            cv.strokeRoundRect(cx - rw, cy - rh, rw * 2, rh * 2, 6, on || ed ? 3 : 1.5, c);
        }
        // a turn-signal arrow in it, pointing out
        const s = Math.min(rw, rh) * 0.45, dir = side === 'left' ? -1 : 1, ac = on ? '#ffffff' : c;
        cv.quad([[cx + dir * s, cy], [cx, cy - s * 0.8], [cx, cy + s * 0.8], [cx, cy + s * 0.8]], ac);
        cv.quad([[cx + 1 * dir, cy - s * 0.35], [cx + 1 * dir, cy + s * 0.35], [cx - dir * s, cy + s * 0.35], [cx - dir * s, cy - s * 0.35]], ac);
    });
    if (v.shown === 'all') {
        cv.strokeRoundRect(X(MAP.x + 224), Y(MAP.y), 640 * k, 480 * k, 8, 3, go);
        cv.text('4 CAMERA', X(PANEL.w / 2), Y(MAP.y + 60), 16, go, { literal: true, align: 'center', font: 'bold', spacing: 1.5 });
    }
}

function drawPosition(cv, G, t, v, act) {
    const acc = t.accent2 || '#81c4ff';
    const p = PICS[1];
    cv.text('Chạm vào hình đồng hồ để đặt camera ' + (v.edit === 'left' ? 'TRÁI' : 'PHẢI') + ' vào đó. Hình đang hiện trực tiếp trên đồng hồ xe.',
        p.x, G.TOP + 30, 18, t.dim, { literal: true, font: 'label' });
    cluster(cv, G, t, p, v, v.edit);
    const d = v.discs && v.discs[v.edit];
    if (d) {
        cv.text((v.gauge ? 'Trong vòng đồng hồ' : 'Vị trí cố định') + ' · ' + Math.round(d.x + d.w / 2) + ', ' + Math.round(d.y + d.h / 2) + ' · ' + (v.sizeLabel || ''),
            p.x, p.y + PANEL.h * p.k + 28, 16, t.dim, { literal: true, font: 'label' });
    }
    if (v.note) cv.text(v.note, p.x + PANEL.w * p.k, p.y + PANEL.h * p.k + 28, 16, kindColor(t, v.noteKind), { literal: true, align: 'right', font: 'label' });
    // the buttons: which side, the four steps, size, shape, back to the default
    const bx = 1090, bw = 140, bh = 50, gap = 14, y0 = G.TOP + 52;
    G.button(cv, t, bx, y0, 448, bh, 'Đang chỉnh: ' + (v.edit === 'left' ? 'bên trái' : 'bên phải'), act.side || nop, { key: 'xcSide', color: acc });
    G.button(cv, t, bx + bw + gap, y0 + 70, bw, bh, 'Lên', act.up || nop, { key: 'xcUp' });
    G.button(cv, t, bx, y0 + 134, bw, bh, v.edit === 'left' ? 'Ra ngoài' : 'Vào giữa', act.moveLeft || nop, { key: 'xcL' });
    G.button(cv, t, bx + 2 * (bw + gap), y0 + 134, bw, bh, v.edit === 'left' ? 'Vào giữa' : 'Ra ngoài', act.moveRight || nop, { key: 'xcR' });
    G.button(cv, t, bx + bw + gap, y0 + 198, bw, bh, 'Xuống', act.down || nop, { key: 'xcDn' });
    G.button(cv, t, bx, y0 + 278, 217, bh, 'Nhỏ hơn', act.smaller || nop, { key: 'xcSm' });
    G.button(cv, t, bx + 231, y0 + 278, 217, bh, 'Lớn hơn', act.larger || nop, { key: 'xcLg' });
    G.button(cv, t, bx, y0 + 342, 217, bh, v.round ? 'Tròn' : 'Chữ nhật', act.shape || nop, { key: 'xcSh' });
    G.button(cv, t, bx + 231, y0 + 342, 217, bh, 'Mặc định', act.reset || nop, { key: 'xcRs' });
    return cv;
}

const nop = () => {};

function drawCalibrate(cv, G, t, v, act) {
    const acc = t.accent2 || '#81c4ff', go = t.go || '#2fd27a';
    const x0 = 56, y0 = G.TOP + 24;
    // which camera
    [['left', 'Gương trái', act.camL], ['right', 'Gương phải', act.camR], ['front', 'Camera trước', act.camF]].forEach((b, i) => {
        const on = v.calCam === b[0];
        G.button(cv, t, x0 + i * 256, y0, 240, 50, b[1], b[2] || nop, on ? { key: 'cc' + i, color: go, primary: true } : { key: 'cc' + i });
    });
    if (v.note) cv.text(v.note, x0 + 3 * 256 + 16, y0 + 32, 16, kindColor(t, v.noteKind), { literal: true, font: 'label' });
    G.button(cv, t, W - 56 - 220, y0, 220, 50, 'Mặc định', act.calReset || nop, { key: 'ccReset' });
    const ty = y0 + 92;
    if (v.calCam === 'front') {
        cv.text('Đậu xe trên đường thẳng, phẳng. Chỉnh đến khi hai vạch vàng nằm trên mép làn (rộng 3 m) và các vạch ngang đúng 5, 10, 20 m.',
            x0, ty, 17, t.dim, { literal: true, font: 'label' });
        // the numbers, in two columns: name, value, - and +
        (v.calRows || []).forEach((r, i) => {
            const col = i < 4 ? 0 : 1, row = i < 4 ? i : i - 4;
            const x = x0 + col * 760, y = ty + 30 + row * 72;
            cv.roundRect(x, y, 728, 60, 12, G.withAlpha('#ffffff', 0.05));
            cv.text(r.label, x + 20, y + 38, 19, t.text, { literal: true, font: 'bold' });
            cv.text(r.text, x + 440, y + 38, 22, acc, { literal: true, font: 'bold', align: 'right' });
            G.button(cv, t, x + 470, y + 6, 112, 48, 'Giảm', act[r.key + '-'] || nop, { key: 'cm' + i });
            G.button(cv, t, x + 598, y + 6, 112, 48, 'Tăng', act[r.key + '+'] || nop, { key: 'cp' + i });
        });
        return cv;
    }
    cv.text('Camera ' + (v.calCam === 'left' ? 'gương trái' : 'gương phải') + ' đang hiện trên đồng hồ. Dịch phần hình được lấy cho đến khi thấy đúng vùng điểm mù phía sau, rồi phóng to nếu muốn.',
        x0, ty, 17, t.dim, { literal: true, font: 'label' });
    const bw = 220, bh = 56, gx = 20, cx = x0 + 240, cy = ty + 44;
    G.button(cv, t, cx + bw + gx, cy, bw, bh, 'Nhìn lên', act.panU || nop, { key: 'cU' });
    G.button(cv, t, cx, cy + 76, bw, bh, 'Sang trái', act.panL || nop, { key: 'cL' });
    G.button(cv, t, cx + 2 * (bw + gx), cy + 76, bw, bh, 'Sang phải', act.panR || nop, { key: 'cR' });
    G.button(cv, t, cx + bw + gx, cy + 152, bw, bh, 'Nhìn xuống', act.panD || nop, { key: 'cD' });
    G.button(cv, t, cx + 3 * (bw + gx) + 60, cy + 38, bw, bh, 'Phóng to', act.zoomIn || nop, { key: 'cZi' });
    G.button(cv, t, cx + 3 * (bw + gx) + 60, cy + 114, bw, bh, 'Thu nhỏ', act.zoomOut || nop, { key: 'cZo' });
    if (v.calText) cv.text(v.calText, x0, cy + 260, 18, acc, { literal: true, font: 'label' });
    cv.text('Hướng nhìn chung (chếch về sau / ngang / chếch về trước) và mức phóng chung nằm trong Cài đặt; trang này chỉnh thêm cho từng bên.', x0, cy + 296, 16, t.dim, { literal: true, font: 'label' });
    return cv;
}

function drawNav(cv, G, t, v, act) {
    const go = t.go || '#2fd27a';
    const x0 = 56, y0 = G.TOP + 44;
    cv.text('MŨI TÊN DẪN ĐƯỜNG TRÊN CAMERA TRƯỚC', x0, y0, 26, t.text, { literal: true, font: 'bold', spacing: 1.2 });
    cv.text('Khi bản đồ BMW, CarPlay hoặc Android Auto đang dẫn đường, camera trước hiện giữa đồng hồ, dải mũi tên trắng nằm ở chỗ rẽ và chỉ vào hướng rẽ.',
        x0, y0 + 34, 17, t.dim, { literal: true, font: 'label' });
    (v.navRows || []).forEach((r, i) => {
        const y = y0 + 92 + i * 46;
        cv.circle(x0 + 8, y - 7, 7, kindColor(t, r.kind));
        cv.text(r.label, x0 + 30, y, 18, t.text, { literal: true, font: 'bold' });
        cv.text(r.text, x0 + 220, y, 18, r.kind === 'warn' ? kindColor(t, r.kind) : t.dim, { literal: true, font: 'label' });
    });
    const by = G.pageBottom(cv) - (cv.own ? G.MARGIN : 0) - 58;
    G.button(cv, t, x0, by, 520, 54, 'Hiện mũi tên: ' + String(v.arLabel || '').toLowerCase(), act.arMode || nop, { key: 'nvMode' });
    G.button(cv, t, x0 + 540, by, 300, 54, 'Thẻ rẽ: ' + (v.arCard ? 'hiện' : 'ẩn'), act.arCard || nop, { key: 'nvCard' });
    G.button(cv, t, x0 + 860, by, 380, 54, v.demo ? 'Đang xem thử (bấm để tắt)' : 'Xem thử 25 giây', act.demo || nop, v.demo ? { key: 'nvDemo', color: go, primary: true } : { key: 'nvDemo' });
    return cv;
}

function draw(cv, G, t, v, act) {
    act = act || {};
    cv.clear(t.bg);
    G.frame(cv, t, TABS, v.page || 0, []);
    G.panel(cv, t, 24, G.TOP, W - 48, G.BOTTOM - G.TOP, null);
    if (v.page === 1) return drawPosition(cv, G, t, v, act);
    if (v.page === 2) return drawCalibrate(cv, G, t, v, act);
    if (v.page === 3) return drawNav(cv, G, t, v, act);
    const bottom = G.pageBottom(cv) - (cv.own ? G.MARGIN : 0);
    const p = PICS[0];
    cluster(cv, G, t, p, v, null);
    cv.text('Xi nhan trái: camera gương trái trong đồng hồ tốc độ. Xi nhan phải: trong vòng tua.', p.x, p.y + PANEL.h * p.k + 30, 16, t.dim, { literal: true, font: 'label' });

    // the state, large, and what each part reports
    const rx = 880;
    cv.text(String(v.title || '').toUpperCase(), rx, G.TOP + 82, 40, v.titleKind === 'go' ? (t.go || '#2fd27a') : v.titleKind === 'warn' ? (t.warn || '#ffb020') : t.text, { literal: true, font: 'bold', spacing: 1.5 });
    if (v.subtitle) cv.text(v.subtitle, rx, G.TOP + 116, 18, t.dim, { literal: true, font: 'label' });
    (v.rows || []).slice(0, 6).forEach((r, i) => {
        const y = G.TOP + 150 + i * 38;
        cv.circle(rx + 8, y - 7, 7, kindColor(t, r.kind));
        cv.text(r.label, rx + 30, y, 18, t.text, { literal: true, font: 'bold' });
        cv.text(r.text, rx + 170, y, r.text.length > 46 ? 15 : 18, r.kind === 'warn' || r.kind === 'crit' ? kindColor(t, r.kind) : t.dim, { literal: true, font: 'label' });
    });
    if (v.version) cv.text(v.version, W - 56, G.TOP + 34, 14, G.withAlpha('#ffffff', 0.35), { literal: true, align: 'right', font: 'label' });

    // the buttons (drawn where the app owns the screen; else they are the HMI's bar)
    const red = t.crit || '#ef2b2d', go = t.go || '#2fd27a';
    const specs = [
        ['Thử trái', act.left, v.shown === 'left'], ['Thử phải', act.right, v.shown === 'right'], ['4 camera', act.all, v.shown === 'all'],
        ['Camera trước: ' + (v.front || 'tắt'), act.front, v.shown === 'front'], [v.enabled ? 'Đang bật' : 'Đang tắt', act.toggle, false],
    ];
    const bh = 54, gap = 18, by = bottom - bh;
    const widths = [200, 200, 200, 420, 220];
    let bx = (W - (widths.reduce((a, b) => a + b, 0) + (specs.length - 1) * gap)) / 2;
    specs.forEach((s, i) => {
        const opts = { key: 'xc' + i };
        if (s[2]) Object.assign(opts, { color: go, primary: true });
        else if (i === 4) Object.assign(opts, { color: v.enabled ? go : red });
        G.button(cv, t, bx, by, widths[i], bh, s[0], s[1] || (() => {}), opts);
        bx += widths[i] + gap;
    });
    return cv;
}

module.exports = { draw, hit, W, H, TABS, STEP, PICS, PANEL, MAP };
