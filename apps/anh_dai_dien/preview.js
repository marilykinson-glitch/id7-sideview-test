'use strict';
/**
 * preview.js - plays the start-up picture on the car's screen the way the video it becomes will play it: the same
 * order of the parts (one cell here is one macroblock there), the same pictures (60 at 30 a second), the same light.
 *
 *   const p = new Player(rgba, w, h, shine)       rgba: w x h cells, RGBA, top-down (120 x 45 for a 1920 x 720 picture)
 *   p.frame('in' | 'out', f)  -> Buffer w*h*3     the cells' colours at picture f (0..FRAMES-1)
 *
 * It follows tools/anh-dai-dien/boot.js (opening(), openingVideo(), shiner()); the light is made at cell size.
 * Node 8.
 */
const FRAMES = 60, FPS = 30;

/** When each cell appears, 0..1: a band across the middle runs out from the centre, then the picture opens up and down. */
function opening(mw, mh) {
    const t = new Float32Array(mw * mh), cx = (mw - 1) / 2, cy = (mh - 1) / 2, band = Math.max(1, Math.round(mh / 14));
    for (let my = 0; my < mh; my++) for (let mx = 0; mx < mw; mx++) {
        const dy = Math.abs(my - cy), dx = Math.abs(mx - cx) / Math.max(1, cx);
        t[my * mw + mx] = dy <= band ? 0.5 * dx : 0.5 + 0.5 * (dy - band) / Math.max(1, cy - band) + 0.04 * dx;
    }
    return t;
}

/** The picture in which each cell changes (1..moving). */
function turns(mw, mh, moving, out) {
    const when = opening(mw, mh), turn = new Int32Array(mw * mh), max = when.reduce((m, v) => Math.max(m, v), 0) || 1;
    const ease = (x) => 1 - Math.pow(1 - x, 2.2);
    for (let n = 0; n < turn.length; n++) {
        const want = out ? 1 - when[n] / max : when[n] / max;
        let f = 1; while (f < moving && ease(f / moving) < want) f++;
        turn[n] = f;
    }
    return turn;
}

function blur(a, ch, w, h, r) {                       // box blur, three passes
    let cur = a;
    for (let pass = 0; pass < 3; pass++) {
        const tmp = new Float32Array(cur.length), out = new Float32Array(cur.length);
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) for (let c = 0; c < ch; c++) {
            let acc = 0; for (let k = -r; k <= r; k++) acc += cur[(y * w + Math.min(w - 1, Math.max(0, x + k))) * ch + c];
            tmp[(y * w + x) * ch + c] = acc / (2 * r + 1);
        }
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) for (let c = 0; c < ch; c++) {
            let acc = 0; for (let k = -r; k <= r; k++) acc += tmp[(Math.min(h - 1, Math.max(0, y + k)) * w + x) * ch + c];
            out[(y * w + x) * ch + c] = acc / (2 * r + 1);
        }
        cur = out;
    }
    return cur;
}

class Player {
    constructor(rgba, w, h, shine) {
        this.w = w; this.h = h; this.pic = Buffer.alloc(w * h * 3);
        for (let i = 0; i < w * h; i++) { const a = (rgba[i * 4 + 3] || 0) / 255; for (let c = 0; c < 3; c++) this.pic[i * 3 + c] = rgba[i * 4 + c] * a; }
        this.moving = { in: Math.round((FRAMES - 1) * (shine ? 0.6 : 0.8)), out: Math.round((FRAMES - 1) * 0.8) };
        this.lit = shine ? Math.min(FRAMES - 1 - this.moving.in, Math.round((FRAMES - 1) * 0.3)) : 0;
        this.turn = { in: turns(w, h, this.moving.in, false), out: turns(w, h, this.moving.out, true) };
        this.shine = null;
        if (shine && this.lit > 0) {
            const bx = shine.x * w, by = shine.y * h, bw = shine.w * w, bh = shine.h * h, cov = new Float32Array(w * h), src = new Float32Array(w * h * 3);
            for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
                const inside = x + 0.5 >= bx && x + 0.5 < bx + bw && y + 0.5 >= by && y + 0.5 < by + bh;
                const lum = 0.3 * this.pic[(y * w + x) * 3] + 0.59 * this.pic[(y * w + x) * 3 + 1] + 0.11 * this.pic[(y * w + x) * 3 + 2];
                const k = inside ? Math.min(1, lum / 90) : 0;
                cov[y * w + x] = k; for (let c = 0; c < 3; c++) src[(y * w + x) * 3 + c] = this.pic[(y * w + x) * 3 + c] * k;
            }
            this.shine = { bx, by, bw, bh, cov, wide: blur(src, 3, w, h, 2), tight: blur(src, 3, w, h, 1) };
        }
    }
    /** The light at moment t (0..1) added to the picture's cells, into out. */
    light(out, t) {
        const s = this.shine; if (!s) return;
        const pulse = t <= 0 || t >= 1 ? 0 : t < 0.3 ? Math.pow(t / 0.3, 2) : Math.pow((1 - t) / 0.7, 1.6);
        if (pulse <= 0) return;
        const sweep = t * 1.5 - 0.25, w = this.w, h = this.h;
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
            const i = y * w + x, u = ((x - s.bx) + (y - s.by) * 0.4) / (s.bw + s.bh * 0.4);
            const glint = Math.exp(-Math.pow((u - sweep) / 0.09, 2)) * s.cov[i] * Math.sin(Math.PI * Math.min(1, Math.max(0, t))) * 110;
            for (let c = 0; c < 3; c++) {
                const v = this.pic[i * 3 + c] + this.pic[i * 3 + c] * 0.12 * pulse * s.cov[i] + pulse * (1 - 0.75 * s.cov[i]) * (2.3 * s.wide[i * 3 + c] + 0.9 * s.tight[i * 3 + c]) + glint;
                out[i * 3 + c] = v > 255 ? 255 : v;
            }
        }
    }
    frame(kind, f) {
        const n = this.w * this.h, out = Buffer.alloc(n * 3), turn = this.turn[kind];
        f = Math.max(0, Math.min(FRAMES - 1, f | 0));
        if (kind === 'in') {
            for (let i = 0; i < n; i++) if (turn[i] <= f) for (let c = 0; c < 3; c++) out[i * 3 + c] = this.pic[i * 3 + c];
            const k = f - this.moving.in;
            if (this.shine && k >= 1 && k <= this.lit) { const full = Buffer.from(this.pic); this.light(full, k === this.lit ? 0 : k / this.lit); return full; }
            return out;
        }
        for (let i = 0; i < n; i++) if (turn[i] > f) for (let c = 0; c < 3; c++) out[i * 3 + c] = this.pic[i * 3 + c];
        return out;
    }
}

module.exports = { Player, FRAMES, FPS, opening, turns };
