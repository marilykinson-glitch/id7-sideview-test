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
 * v = { page, title, titleKind ('go' | 'warn' | 'dim'), rows: [{ label, text, kind }], shown (the view on the
 *       cluster now: 'left' | 'right' | 'front' | 'all' | null), enabled, front (the setting's label),
 *       discs: { left: { x, y, w, h }, right: {...} } (cluster pixels), frontRect: { x, y, w, h } | null,
 *       round, gauge (the views sit in the dials), edit ('left' | 'right'), sizeLabel, note, version }
 * act = { left, right, all, front, toggle, side, up, down, in, out, smaller, larger, shape, reset }
 * Node 8.
 */
const W = 1600, H = 520;
const TABS = ['Camera', 'Vị trí'];
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
    if (!v.frontRect && v.shown !== 'all') cv.text('BẢN ĐỒ', X(PANEL.w / 2), Y(PANEL.h / 2) + 6, 15, G.withAlpha('#ffffff', 0.25), { align: 'center', font: 'bold', spacing: 2 });
    // the dials: the speedometer opens to the right, the rev counter to the left
    const r = 300 * k, w = 5;
    cv.arc(X(430), Y(380), r - w, r, 200, 395, line, { round: true });
    cv.arc(X(PANEL.w - 430), Y(380), r - w, r, -35, 160, line, { round: true });
    cv.text('km/h', X(430), Y(170), 13, G.withAlpha('#ffffff', 0.3), { align: 'center', font: 'label' });
    cv.text('1/min', X(PANEL.w - 430), Y(170), 13, G.withAlpha('#ffffff', 0.3), { align: 'center', font: 'label' });
    // the front camera's place
    if (v.frontRect) {
        const f = v.frontRect, on = v.shown === 'front';
        cv.roundRect(X(f.x), Y(f.y), f.w * k, f.h * k, 8, G.withAlpha(on ? go : '#ffffff', on ? 0.3 : 0.06));
        cv.strokeRoundRect(X(f.x), Y(f.y), f.w * k, f.h * k, 8, on ? 3 : 1.5, on ? go : G.withAlpha('#ffffff', 0.3));
        cv.text('CAMERA TRƯỚC', X(f.x + f.w / 2), Y(f.y + f.h / 2) + 5, 14, on ? '#ffffff' : G.withAlpha('#ffffff', 0.45), { align: 'center', font: 'bold', spacing: 1.5 });
    }
    // the mirror cameras' places
    ['left', 'right'].forEach((side) => {
        const d = v.discs && v.discs[side];
        if (!d) return;
        const on = v.shown === side, ed = editing === side;
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
        cv.text('4 CAMERA', X(PANEL.w / 2), Y(MAP.y + 60), 16, go, { align: 'center', font: 'bold', spacing: 1.5 });
    }
}

function drawPosition(cv, G, t, v, act) {
    const acc = t.accent2 || '#81c4ff';
    const p = PICS[1];
    cv.text('Chạm vào hình đồng hồ để đặt camera ' + (v.edit === 'left' ? 'TRÁI' : 'PHẢI') + ' vào đó. Hình đang hiện trực tiếp trên đồng hồ xe.',
        p.x, G.TOP + 30, 18, t.dim, { font: 'label' });
    cluster(cv, G, t, p, v, v.edit);
    const d = v.discs && v.discs[v.edit];
    if (d) {
        cv.text((v.gauge ? 'Trong vòng đồng hồ' : 'Vị trí cố định') + ' · ' + Math.round(d.x + d.w / 2) + ', ' + Math.round(d.y + d.h / 2) + ' · ' + (v.sizeLabel || ''),
            p.x, p.y + PANEL.h * p.k + 28, 16, t.dim, { font: 'label' });
    }
    if (v.note) cv.text(v.note, p.x + PANEL.w * p.k, p.y + PANEL.h * p.k + 28, 16, kindColor(t, v.noteKind), { align: 'right', font: 'label' });
    // the buttons: which side, the four steps, size, shape, back to the default
    const bx = 1090, bw = 140, bh = 50, gap = 14, y0 = G.TOP + 52;
    const nop = () => {};
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

function draw(cv, G, t, v, act) {
    act = act || {};
    cv.clear(t.bg);
    G.frame(cv, t, TABS, v.page || 0, []);
    G.panel(cv, t, 24, G.TOP, W - 48, G.BOTTOM - G.TOP, null);
    if (v.page === 1) return drawPosition(cv, G, t, v, act);
    const bottom = G.pageBottom(cv) - (cv.own ? G.MARGIN : 0);
    const p = PICS[0];
    cluster(cv, G, t, p, v, null);
    cv.text('Xi nhan trái: camera gương trái trong đồng hồ tốc độ. Xi nhan phải: trong vòng tua.', p.x, p.y + PANEL.h * p.k + 30, 16, t.dim, { font: 'label' });

    // the state, large, and what each part reports
    const rx = 880;
    cv.text(String(v.title || '').toUpperCase(), rx, G.TOP + 82, 40, v.titleKind === 'go' ? (t.go || '#2fd27a') : v.titleKind === 'warn' ? (t.warn || '#ffb020') : t.text, { font: 'bold', spacing: 1.5 });
    if (v.subtitle) cv.text(v.subtitle, rx, G.TOP + 116, 18, t.dim, { font: 'label' });
    (v.rows || []).slice(0, 5).forEach((r, i) => {
        const y = G.TOP + 162 + i * 42;
        cv.circle(rx + 8, y - 7, 7, kindColor(t, r.kind));
        cv.text(r.label, rx + 30, y, 18, t.text, { font: 'bold' });
        cv.text(r.text, rx + 170, y, 18, r.kind === 'warn' || r.kind === 'crit' ? kindColor(t, r.kind) : t.dim, { font: 'label' });
    });
    if (v.version) cv.text(v.version, W - 56, G.TOP + 34, 14, G.withAlpha('#ffffff', 0.35), { align: 'right', font: 'label' });

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
