'use strict';
/**
 * ui.js - the MGU Studio screen, a pure draw(cv, G, t, v, act) for the car and the preview.
 *
 * On the left a QR code with the address the phone opens and the PIN; on the right what can be changed, as three
 * cards (the car's picture, the start-up screen, the profile pictures) and one line for the small rest, each saying
 * whether the owner's picture or the car's own is in use; the tool's last message and the buttons.
 *
 * Pictures are drawn in 262k-colour horizontal runs and cached once as GPU layers (G.layer -> mgu-render FBO texture):
 *   - card thumbnails: 144 x 72 (car), 144 x 54 (start-up), 52 x 52 (three profile faces) at 1 x 1 logical px
 *   - boot preview: 480 x 180 base picture in 4 cached GPU strips (960 x 360 logical px), with fast macroblock mask
 *     and localised shine patch on top at 30 fps
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
const MINI = 144, LEGACY_MINI = 48, FACE = 52;       // 144 px wide at 1 x 1 logical px (legacy 48 px at 3 x 3); faces 52 x 52

function fnv1a(buf, from, to) {
    let h = 2166136261 >>> 0;
    const end = to == null ? buf.length : to;
    for (let i = from || 0; i < end; i++) h = Math.imul(h ^ buf[i], 16777619) >>> 0;
    return h.toString(36);
}

/**
 * Draws an RGBA picture (w x h, top-down) blended onto `#07080b` in 18-bit (262k) colour, merging equal horizontal
 * neighbours into single rectangles. Reuses one 4-element colour array so neither Recorder nor Canvas allocates.
 */
function paintRgba(cv, rgba, w, h, x, y, cell) {
    const px = [7, 8, 11, 255];
    cv.fillRect(x, y, w * cell, h * cell, px);
    if (!rgba || rgba.length < w * h * 4) return;
    const bgQ = ((7 & 0xfc) << 16) | ((8 & 0xfc) << 8) | (11 & 0xfc);
    for (let r = 0; r < h; r++) {
        let from = 0, last = -1;
        for (let c = 0; c <= w; c++) {
            let q = -1;
            if (c < w) {
                const i = (r * w + c) * 4, a = rgba[i + 3] / 255, ia = 1 - a;
                const cr = Math.round(rgba[i] * a + 7 * ia) & 0xfc;
                const cg = Math.round(rgba[i + 1] * a + 8 * ia) & 0xfc;
                const cb = Math.round(rgba[i + 2] * a + 11 * ia) & 0xfc;
                const packed = (cr << 16) | (cg << 8) | cb;
                q = packed === bgQ ? -1 : packed;
            }
            if (q === last) continue;
            if (last >= 0) {
                px[0] = (last >> 16) & 255; px[1] = (last >> 8) & 255; px[2] = last & 255;
                cv.fillRect(x + from * cell, y + r * cell, (c - from) * cell, cell, px);
            }
            from = c; last = q;
        }
    }
}

function mosaic(cv, G, rgba, w, h, x, y, cell) {
    if (cv.recording && G && G.layer && rgba && rgba.length >= w * h * 4) {
        const lw = w * cell, lh = h * cell;
        const L = G.layer('adPic|' + w + 'x' + h + 'c' + cell + '|' + fnv1a(rgba, 0, w * h * 4), lw, lh, (c) => paintRgba(c, rgba, w, h, 0, 0, cell), 1);
        cv.blit(L, x, y);
        return;
    }
    paintRgba(cv, rgba, w, h, x, y, cell);
}

/**
 * One thing that can be changed: its name, a sharp small picture of what is in use now (pics: [{ rgba, w, h, cell }]),
 * whose it is, and where it shows.
 */
function card(cv, G, t, x, y, w, h, title, sub, mine, state, pics, extra) {
    extra = extra || {};
    const go = t.go || '#2fd27a';
    cv.roundRect(x, y, w, h, 14, G.withAlpha('#ffffff', mine ? 0.07 : 0.04));
    cv.strokeRoundRect(x, y, w, h, 14, mine ? 2 : 1.2, mine ? G.withAlpha(go, 0.9) : G.withAlpha('#ffffff', 0.2));
    cv.text(title, x + 22, y + 38, 24, t.text, { literal: true, font: 'bold' });
    const py = y + 54, ph = 72;
    let px = x + 22;
    const picGap = (pics || []).length > 1 ? 6 : 8;
    (pics || []).forEach((p) => {
        const cell = p.cell || Math.max(1, Math.floor(Math.min(MINI / p.w, ph / p.h)));
        const dy = Math.floor((ph - p.h * cell) / 2);
        mosaic(cv, G, p.rgba, p.w, p.h, px, py + dy, cell);
        cv.strokeRoundRect(px - 1, py + dy - 1, p.w * cell + 2, p.h * cell + 2, 2, 1, G.withAlpha('#ffffff', 0.22));
        px += p.w * cell + picGap;
    });
    const tx = Math.max(px + 4, x + 22);
    cv.circle(tx + 7, py + 30, 6, mine ? go : G.withAlpha('#ffffff', 0.35));
    cv.text(fit(cv, state, 18, { literal: true, font: 'label' }, x + w - 14 - (tx + 20)), tx + 20, py + 37, 18, mine ? go : t.dim, { literal: true, font: 'label' });
    const hint = extra.run ? 'Xem thử' : '', hw = hint ? cv.textWidth(hint, 16, { literal: true, font: 'bold' }) + 8 : 0;
    cv.text(fit(cv, sub, 15, { literal: true, font: 'label' }, w - 44 - hw), x + 22, y + h - 16, 15, t.dim, { literal: true, font: 'label' });
    if (extra.run) {
        cv.text(hint, x + w - 22, y + h - 16, 16, extra.color || t.accent2 || '#81c4ff', { literal: true, align: 'right', font: 'bold' });
        cv.target(x, y, w, h, extra.run, 'adStartCard');
    }
}

/** RGB rows [r0..r1) of w x h drawn in 262k-colour horizontal runs; groundFill clears to black first when true. */
function paintRgbRows(cv, buf, w, r0, r1, x, y, cell, groundFill) {
    const px = [0, 0, 0, 255];
    if (groundFill) cv.fillRect(x, y, w * cell, (r1 - r0) * cell, px);
    for (let r = r0; r < r1; r++) {
        let from = 0, last = -1;
        for (let c = 0; c <= w; c++) {
            let q = -1;
            if (c < w) {
                const i = (r * w + c) * 3;
                const cr = buf[i] & 0xfc, cg = buf[i + 1] & 0xfc, cb = buf[i + 2] & 0xfc;
                const packed = (cr << 16) | (cg << 8) | cb;
                q = groundFill && packed === 0 ? -1 : packed;
            }
            if (q === last) continue;
            if (last >= 0) {
                px[0] = (last >> 16) & 255; px[1] = (last >> 8) & 255; px[2] = last & 255;
                cv.fillRect(x + from * cell, y + (r - r0) * cell, (c - from) * cell, cell, px);
            }
            from = c; last = q;
        }
    }
}

/** Draws the 960 x 360 start-up preview using 4 GPU-cached base strips + fast macroblock mask & shine patch. */
function drawPreviewFrame(cv, G, pv, x, y) {
    const PW = 960, PH = 360;
    if (pv.player && cv.recording && G && G.layer) {
        const pl = pv.player, cell = Math.max(1, Math.round(PW / pl.w));
        const mask = pl.hiddenMask(pv.kind || 'in', pv.f || 0);
        if (mask) {
            let allBlack = true;
            for (let i = 0; i < mask.length; i++) if (!mask[i]) { allBlack = false; break; }
            if (allBlack) { cv.fillRect(x, y, PW, PH, '#000000'); return; }
        }
        const strips = 4, sh = Math.floor(pl.h / strips), hash = pl._hash || (pl._hash = fnv1a(pl.pic));
        for (let s = 0; s < strips; s++) {
            const r0 = s * sh, r1 = s === strips - 1 ? pl.h : (s + 1) * sh;
            const lw = pl.w * cell, lh = (r1 - r0) * cell;
            const L = G.layer('adPv|' + pl.w + 'x' + pl.h + '|' + hash + '|' + s, lw, lh,
                (c) => paintRgbRows(c, pl.pic, pl.w, r0, r1, 0, 0, cell, true), 1);
            cv.blit(L, x, y + r0 * cell);
        }
        if (mask) {
            const mw = pl.mw, mh = pl.mh, cw = PW / mw, ch = PH / mh, blk = [0, 0, 0, 255];
            for (let my = 0; my < mh; my++) {
                let from = -1;
                for (let mx = 0; mx <= mw; mx++) {
                    const hide = mx < mw && mask[my * mw + mx] !== 0;
                    if (hide && from < 0) from = mx;
                    else if (!hide && from >= 0) {
                        cv.fillRect(x + from * cw, y + my * ch, (mx - from) * cw, ch, blk);
                        from = -1;
                    }
                }
            }
            return;
        }
        const patch = pl.shinePatch(pv.kind || 'in', pv.f || 0);
        if (patch) paintRgbRows(cv, patch.rgb, patch.rw, 0, patch.rh, x + patch.x0 * cell, y + patch.y0 * cell, cell, false);
        return;
    }
    const buf = pv.buf || (pv.player ? pv.player.frame(pv.kind || 'in', pv.f || 0) : null);
    const w = pv.w || (pv.player && pv.player.w) || 120, h = pv.h || (pv.player && pv.player.h) || 45;
    if (!buf) { cv.fillRect(x, y, PW, PH, '#000000'); return; }
    paintRgbRows(cv, buf, w, 0, h, x, y, Math.max(1, Math.round(PW / w)), true);
}

/**
 * The preview of the start-up screen: the picture in a frame (960 x 360 logical px, 480 x 180 samples), played as the
 * car will play it (opening when getting in, closing when leaving), and the buttons: play the opening, the closing,
 * both; apply or drop a draft; back.
 */
function drawPreview(cv, G, t, v, act) {
    cv.clear(t.bg);
    G.frame(cv, t, ['MGU Studio'], 0, []);
    G.panel(cv, t, 24, G.TOP, W - 48, G.BOTTOM - G.TOP, null);
    const go = t.go || '#2fd27a', warn = t.warn || '#ffb020';
    cv.text('XEM THỬ MÀN HÌNH KHỞI ĐỘNG', 64, G.TOP + 52, 28, t.text, { literal: true, font: 'bold', spacing: 2 });
    cv.text(v.draft ? 'Bản nháp: chưa áp dụng cho xe' : 'Đang dùng trên xe', W - 64, G.TOP + 50, 19, v.draft ? warn : go, { literal: true, align: 'right', font: 'label' });
    const px = 64, py = G.TOP + 70, pv = v.pv;
    if (pv) {
        drawPreviewFrame(cv, G, pv, px, py);
        cv.strokeRoundRect(px - 2, py - 2, 964, 364, 3, 1.5, G.withAlpha('#ffffff', 0.3));
    }
    const inNote = pv && pv.player && pv.player.brief ? 'Đang chạy: lúc lên xe, hình mở ra rồi tự tắt về nền đen.' : 'Đang chạy: lúc lên xe, hình mở ra.';
    const msg = v.note || (v.playing === 'in' ? inNote : v.playing === 'out' ? 'Đang chạy: lúc tắt xe, hình khép lại.' : v.playing === 'both' ? 'Đang chạy: lên xe, giữ hình, rồi tắt xe.' : 'Chạm một nút bên phải để xem lại. Trên xe có thể nhanh hoặc chậm hơn một chút.');
    cv.text(fit(cv, msg, 16, { literal: true, font: 'label' }, 960), px, py + 360 + 30, 16, v.note ? kindColor(t, v.noteKind) : t.dim, { literal: true, font: 'label' });
    const bx = 64 + 960 + 40, bw = W - 64 - bx, bh = 54, g = 10;
    let by = py;
    const btn = (label, run, o) => { G.button(cv, t, bx, by, bw, bh, label, run || nop, o || {}); by += bh + g; };
    btn('Xem lúc lên xe', () => act.play && act.play('in'), { key: 'adPvIn', primary: v.playing === 'in' });
    btn('Xem lúc tắt xe', () => act.play && act.play('out'), { key: 'adPvOut', primary: v.playing === 'out' });
    btn('Xem cả hai', () => act.play && act.play('both'), { key: 'adPvBoth', primary: v.playing === 'both' });
    by += 8;
    if (v.draft) {
        btn('Áp dụng cho xe', act.apply, { key: 'adPvApply', color: go, primary: true });
        btn('Bỏ bản nháp', act.discard, { key: 'adPvDrop', color: t.crit || '#ef2b2d' });
    }
    btn('Quay lại', act.back, { key: 'adPvBack' });
    return cv;
}

function widePic(buf) {
    if (!buf) return [];
    if (buf.length >= MINI * 4 && buf.length % (MINI * 4) === 0) {
        return [{ rgba: buf, w: MINI, h: Math.max(1, Math.min(72, Math.floor(buf.length / 4 / MINI))), cell: 1 }];
    }
    if (buf.length >= LEGACY_MINI * 4 && buf.length % (LEGACY_MINI * 4) === 0) {
        return [{ rgba: buf, w: LEGACY_MINI, h: Math.max(1, Math.min(24, Math.floor(buf.length / 4 / LEGACY_MINI))), cell: 3 }];
    }
    return [];
}

function facePic(buf) {
    if (!buf) return null;
    if (buf.length === FACE * FACE * 4) return { rgba: buf, w: FACE, h: FACE, cell: 1 };
    if (buf.length === 24 * 24 * 4) return { rgba: buf, w: 24, h: 24, cell: 2 };
    return null;
}

function draw(cv, G, t, v, act) {
    act = act || {};
    if (v.mode === 'preview') return drawPreview(cv, G, t, v, act);
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
        const faces = slots.filter((x) => x.changed && th[x.n]).concat(slots.filter((x) => !x.changed && th[x.n])).slice(0, 3)
            .map((x) => facePic(th[x.n])).filter(Boolean);
        const carSub = !(car && car.changed) ? 'Menu Xe của tôi, ô xe ở màn hình chính' : v.carWhere === 'tile' ? 'Chỉ ô xe ở màn hình chính' : v.carWhere === 'menu' ? 'Chỉ trong menu Xe của tôi' : 'Menu Xe của tôi và ô xe màn hình chính';
        card(cv, G, t, rx, cy, cw, ch, 'Hình chiếc xe', carSub, !!(car && car.changed), whose(car), widePic(th[CAR]));
        card(cv, G, t, rx + cw + gap, cy, cw, ch, 'Màn hình khởi động', v.draft ? 'Có bản nháp chờ xem' : 'Lúc chào và lúc tạm biệt', !!(start && start.changed), v.draft ? 'Bản nháp' : whose(start), widePic(th[START]),
            v.pvReady && act.openPreview ? { run: act.openPreview, color: v.draft ? (t.warn || '#ffb020') : undefined } : null);
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

module.exports = { draw, drawPreview, W, H, MINI, FACE };
