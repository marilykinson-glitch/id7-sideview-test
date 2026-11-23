'use strict';
/**
 * preview.js - plays the start-up picture on the car's screen the way the video it becomes will play it: the same
 * macroblock order (120 x 45 for a 1920 x 720 picture, with 4 x 4 sharp subpixels per macroblock at 480 x 180),
 * the same timing (60 pictures at 30 a second), the same light, and optional auto-close back to black (brief).
 *
 *   const p = new Player(rgba, w, h, shine, brief)   rgba: w x h RGBA, top-down (480 x 180 or 120 x 45)
 *   p.frame('in' | 'out', f)  -> Buffer w*h*3        RGB pixels at picture f (0..FRAMES-1)
 *   p.hiddenMask(kind, f)     -> Uint8Array mw*mh    1 where macroblock is black (fast overlay over GPU base layer)
 *   p.shinePatch(kind, f)     -> { x0, y0, rw, rh, rgb } | null   lit region only, for fast GPU overlay
 *
 * Follows tools/anh-dai-dien/boot.js (opening(), openingVideo(), shiner()). Node 8.
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

function blurRegion(a, ch, w, h, r) {                  // sliding-window box blur, three passes
    let cur = a;
    for (let pass = 0; pass < 3; pass++) {
        const tmp = new Float32Array(cur.length), out = new Float32Array(cur.length);
        for (let y = 0; y < h; y++) for (let c = 0; c < ch; c++) {
            let acc = 0; for (let x = -r; x <= r; x++) acc += cur[(y * w + Math.min(w - 1, Math.max(0, x))) * ch + c];
            for (let x = 0; x < w; x++) {
                tmp[(y * w + x) * ch + c] = acc / (2 * r + 1);
                acc += cur[(y * w + Math.min(w - 1, x + r + 1)) * ch + c] - cur[(y * w + Math.max(0, x - r)) * ch + c];
            }
        }
        for (let x = 0; x < w; x++) for (let c = 0; c < ch; c++) {
            let acc = 0; for (let y = -r; y <= r; y++) acc += tmp[(Math.min(h - 1, Math.max(0, y)) * w + x) * ch + c];
            for (let y = 0; y < h; y++) {
                out[(y * w + x) * ch + c] = acc / (2 * r + 1);
                acc += tmp[(Math.min(h - 1, y + r + 1) * w + x) * ch + c] - tmp[(Math.max(0, y - r) * w + x) * ch + c];
            }
        }
        cur = out;
    }
    return cur;
}

class Player {
    constructor(rgba, w, h, shine, brief) {
        this.w = w; this.h = h; this.brief = !!brief;
        // 480 x 180 carries 4 x 4 subpixels per macroblock of the 1920 x 720 H.264 stream (120 x 45 macroblocks)
        this.block = (w >= 240 && w % 4 === 0 && h % 4 === 0) ? 4 : 1;
        this.mw = (w / this.block) | 0; this.mh = (h / this.block) | 0;
        this.pic = Buffer.alloc(w * h * 3);
        for (let i = 0; i < w * h; i++) {
            const a = (rgba[i * 4 + 3] || 0) / 255;
            this.pic[i * 3] = Math.round(rgba[i * 4] * a);
            this.pic[i * 3 + 1] = Math.round(rgba[i * 4 + 1] * a);
            this.pic[i * 3 + 2] = Math.round(rgba[i * 4 + 2] * a);
        }
        const inMove = this.brief
            ? Math.max(1, Math.round((FRAMES - 1) * (shine ? 0.42 : 0.48)))
            : Math.max(1, Math.round((FRAMES - 1) * (shine ? 0.6 : 0.8)));
        this.moving = { in: inMove, out: Math.round((FRAMES - 1) * 0.8) };
        this.lit = shine
            ? Math.min(FRAMES - 1 - inMove - (this.brief ? 4 : 0), Math.max(2, Math.round((FRAMES - 1) * (this.brief ? 0.28 : 0.3))))
            : 0;
        const hold = this.brief && !shine ? Math.max(2, Math.round((FRAMES - 1) * 0.24)) : 0;
        this.closeFrom = this.brief ? Math.min(FRAMES - 2, inMove + this.lit + hold) : 0;
        this.closeLen = this.brief ? Math.max(1, (FRAMES - 1) - this.closeFrom) : 0;
        this.turn = {
            in: turns(this.mw, this.mh, this.moving.in, false),
            out: turns(this.mw, this.mh, this.moving.out, true),
            close: this.brief ? turns(this.mw, this.mh, this.closeLen, true) : null,
        };
        this.shine = null;
        if (shine && this.lit > 0) {
            const k = this.block, pad = 16 * k;
            const bx = shine.x * w, by = shine.y * h, bw = shine.w * w, bh = shine.h * h;
            const x0 = Math.max(0, Math.floor(bx - pad)), y0 = Math.max(0, Math.floor(by - pad));
            const x1 = Math.min(w, Math.ceil(bx + bw + pad)), y1 = Math.min(h, Math.ceil(by + bh + pad));
            const rw = Math.max(1, x1 - x0), rh = Math.max(1, y1 - y0);
            const cov = new Float32Array(rw * rh), src = new Float32Array(rw * rh * 3);
            const feScale = 3.5 * k;
            for (let y = 0; y < rh; y++) for (let x = 0; x < rw; x++) {
                const gx = x0 + x, gy = y0 + y, p = (gy * w + gx) * 3, i = y * rw + x;
                const inside = gx + 0.5 >= bx && gx + 0.5 < bx + bw && gy + 0.5 >= by && gy + 0.5 < by + bh;
                const lum = 0.3 * this.pic[p] + 0.59 * this.pic[p + 1] + 0.11 * this.pic[p + 2];
                const fe = feScale > 4 ? Math.min(1, Math.max(0, Math.min(gx - bx, bx + bw - 1 - gx, gy - by, by + bh - 1 - gy)) / feScale) : 1;
                const c = inside ? Math.min(1, lum / 90) * fe : 0;
                cov[i] = c; src[i * 3] = this.pic[p] * c; src[i * 3 + 1] = this.pic[p + 1] * c; src[i * 3 + 2] = this.pic[p + 2] * c;
            }
            this.shine = {
                bx, by, bw, bh, x0, y0, rw, rh, cov, edgeSpan: 7 * k,
                wide: blurRegion(src, 3, rw, rh, Math.max(2, Math.round(5.5 * k))),
                tight: blurRegion(src, 3, rw, rh, Math.max(1, Math.round(1.8 * k))),
            };
        }
    }

    /** Computes the lit sub-region RGB buffer (rw x rh x 3) at moment t (0..1), or null when unlit. */
    _lightPatch(t) {
        const s = this.shine; if (!s) return null;
        const pulse = t <= 0 || t >= 1 ? 0 : t < 0.3 ? Math.pow(t / 0.3, 2) : Math.pow((1 - t) / 0.7, 1.6);
        if (pulse <= 0) return null;
        const sweep = t * 1.5 - 0.25, w = this.w, rw = s.rw, rh = s.rh, rgb = Buffer.allocUnsafe(rw * rh * 3);
        const denom = Math.max(1e-3, s.bw + s.bh * 0.4), glAmp = Math.sin(Math.PI * Math.min(1, Math.max(0, t))) * 110;
        for (let y = 0; y < rh; y++) {
            const gy = s.y0 + y;
            for (let x = 0; x < rw; x++) {
                const gx = s.x0 + x, p = (gy * w + gx) * 3, i = y * rw + x;
                const e = s.edgeSpan > 8 ? Math.min(1, Math.min(x, rw - 1 - x, y, rh - 1 - y) / s.edgeSpan) : 1;
                const u = ((gx - s.bx) + (gy - s.by) * 0.4) / denom;
                const glint = Math.exp(-Math.pow((u - sweep) / 0.09, 2)) * s.cov[i] * glAmp;
                for (let c = 0; c < 3; c++) {
                    const v = this.pic[p + c] + e * (this.pic[p + c] * 0.12 * pulse * s.cov[i] + pulse * (1 - 0.75 * s.cov[i]) * (2.3 * s.wide[i * 3 + c] + 0.9 * s.tight[i * 3 + c]) + glint);
                    rgb[i * 3 + c] = v > 255 ? 255 : v;
                }
            }
        }
        return { x0: s.x0, y0: s.y0, rw, rh, rgb };
    }

    /** 1 for each macroblock (mw x mh) that is black at frame f; null when the whole picture is visible. */
    hiddenMask(kind, f) {
        f = Math.max(0, Math.min(FRAMES - 1, f | 0));
        const n = this.mw * this.mh;
        if (kind === 'in') {
            if (f <= this.moving.in) {
                if (f === this.moving.in) return null;
                const mask = new Uint8Array(n), t = this.turn.in;
                for (let i = 0; i < n; i++) if (t[i] > f) mask[i] = 1;
                return mask;
            }
            if (this.turn.close && f > this.closeFrom) {
                const cf = f - this.closeFrom, mask = new Uint8Array(n), ct = this.turn.close;
                for (let i = 0; i < n; i++) if (ct[i] <= cf) mask[i] = 1;
                return mask;
            }
            return null;
        }
        const mask = new Uint8Array(n), t = this.turn.out;
        for (let i = 0; i < n; i++) if (t[i] <= f) mask[i] = 1;
        return mask;
    }

    /** Lit sub-region { x0, y0, rw, rh, rgb } when the logo shine is active at frame f, else null. */
    shinePatch(kind, f) {
        if (kind !== 'in' || !this.shine) return null;
        f = Math.max(0, Math.min(FRAMES - 1, f | 0));
        const k = f - this.moving.in;
        if (k < 1 || k >= this.lit) return null;
        return this._lightPatch(k / this.lit);
    }

    /** The light at moment t (0..1) added to the picture's pixels, into out. */
    light(out, t) {
        const patch = this._lightPatch(t);
        if (!patch) return;
        for (let y = 0; y < patch.rh; y++) {
            const src = y * patch.rw * 3, dst = ((patch.y0 + y) * this.w + patch.x0) * 3;
            patch.rgb.copy(out, dst, src, src + patch.rw * 3);
        }
    }

    frame(kind, f) {
        f = Math.max(0, Math.min(FRAMES - 1, f | 0));
        const mask = this.hiddenMask(kind, f);
        if (!mask) {
            const out = Buffer.from(this.pic);
            const k = kind === 'in' ? f - this.moving.in : 0;
            if (this.shine && k >= 1 && k < this.lit) this.light(out, k / this.lit);
            return out;
        }
        const out = Buffer.alloc(this.w * this.h * 3), b = this.block, mw = this.mw, mh = this.mh, rowBytes = b * 3;
        for (let my = 0; my < mh; my++) for (let mx = 0; mx < mw; mx++) {
            if (mask[my * mw + mx]) continue;
            for (let dy = 0; dy < b; dy++) {
                const off = ((my * b + dy) * this.w + mx * b) * 3;
                this.pic.copy(out, off, off, off + rowBytes);
            }
        }
        return out;
    }
}

module.exports = { Player, FRAMES, FPS, opening, turns };
