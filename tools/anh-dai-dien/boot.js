'use strict';
/**
 * boot.js - the pieces for the head unit's start-up pictures (what animationplayer shows: eva_splash_*.png,
 * eva_hi_*.h264 on getting in, eva_bye_*.h264 on leaving, under /mnt/dataro/dataro1/ent/animationplayer/mgu<gen>):
 *
 *   h264Info(buf)                      size, level and number of pictures of an H.264 elementary stream (its first SPS)
 *   stillVideo(rgba, w, h, opt)        an H.264 stream that shows one picture for `frames` pictures:
 *                                      the first picture as uncompressed (I_PCM) macroblocks, the rest "nothing changed"
 *   openingVideo(rgba, w, h, opt)      the same without an encoder, moving: the picture opens out of black from its
 *                                      middle (or closes into black), each part sent once, uncompressed, in its turn
 *   pngInfo(buf), pngDecode(buf)       size of a PNG; its pixels as RGBA (8-bit, not interlaced: what the head unit has)
 *
 * The stream is Constrained Baseline, CAVLC, pictures shown in the order decoded, the same timing - as the originals.
 * There is no encoder on the head unit; uncompressed macroblocks need none, and a still picture costs one of them.
 * Node 8: no dependencies.
 */
const zlib = require('zlib');

/* ---------------- bits ---------------- */
class BitWriter {
    constructor(size) { this.b = Buffer.alloc(size); this.n = 0; }          // n: bits written
    u(bits, v) { for (let i = bits - 1; i >= 0; i--) { if ((v >>> i) & 1) this.b[this.n >> 3] |= 0x80 >> (this.n & 7); this.n++; } }
    ue(v) { v += 1; let len = 0; while ((v >>> len) > 1) len++; this.u(len, 0); this.u(len + 1, v); }
    se(v) { this.ue(v > 0 ? 2 * v - 1 : -2 * v); }
    align() { this.n = (this.n + 7) & ~7; }
    bytes(buf) { buf.copy(this.b, this.n >> 3); this.n += buf.length * 8; }  // only when aligned
    trailing() { this.u(1, 1); this.align(); }
    done() { return this.b.slice(0, this.n >> 3); }
}
class BitReader {
    constructor(b) { this.b = b; this.n = 0; }
    u(bits) { let v = 0; for (let i = 0; i < bits; i++) { v = (v * 2) + ((this.b[this.n >> 3] >> (7 - (this.n & 7))) & 1); this.n++; } return v; }
    ue() { let z = 0; while (this.u(1) === 0 && z < 32) z++; return z ? (Math.pow(2, z) - 1 + this.u(z)) : 0; }
    se() { const k = this.ue(); return k & 1 ? (k + 1) / 2 : -k / 2; }
}

/** A NAL unit with its start code; 00 00 0x in the payload gets its emulation-prevention byte. */
function nal(refIdc, type, payload) {
    const out = [0, 0, 0, 1, (refIdc << 5) | type];
    let zeros = 0, extra = 0;
    for (let i = 0; i < payload.length; i++) { if (zeros >= 2 && payload[i] <= 3) { extra++; zeros = 0; } zeros = payload[i] === 0 ? zeros + 1 : 0; }
    if (!extra) return Buffer.concat([Buffer.from(out), payload]);
    const b = Buffer.alloc(5 + payload.length + extra);
    Buffer.from(out).copy(b);
    let o = 5; zeros = 0;
    for (let i = 0; i < payload.length; i++) {
        if (zeros >= 2 && payload[i] <= 3) { b[o++] = 3; zeros = 0; }
        b[o++] = payload[i]; zeros = payload[i] === 0 ? zeros + 1 : 0;
    }
    return b;
}

function nals(buf) {                         // [{ type, start (of the payload after the header byte), end }]
    const out = [];
    let i = 0;
    const next = (from) => { for (let k = from; k + 3 <= buf.length; k++) if (buf[k] === 0 && buf[k + 1] === 0 && buf[k + 2] === 1) return k; return -1; };
    let s = next(0);
    while (s >= 0) {
        const e = next(s + 3);
        let end = e < 0 ? buf.length : e;
        while (end > s + 3 && buf[end - 1] === 0) end--;
        out.push({ type: buf[s + 3] & 31, start: s + 4, end });
        s = e; i++;
        if (i > 100000) break;
    }
    return out;
}
function unescape(buf) {
    const out = []; let zeros = 0;
    for (let i = 0; i < buf.length; i++) { if (zeros >= 2 && buf[i] === 3) { zeros = 0; continue; } out.push(buf[i]); zeros = buf[i] === 0 ? zeros + 1 : 0; }
    return Buffer.from(out);
}

/** { w, h, level, profile, frames } of an H.264 elementary stream; throws if it has no SPS this can read. */
function h264Info(buf) {
    const list = nals(buf), sps = list.filter((n) => n.type === 7)[0];
    if (!sps) throw new Error('no SPS');
    const r = new BitReader(unescape(buf.slice(sps.start, Math.min(sps.end, sps.start + 256))));
    const profile = r.u(8); r.u(8); const level = r.u(8); r.ue();
    if ([100, 110, 122, 244, 44, 83, 86, 118, 128].indexOf(profile) >= 0) {
        const chroma = r.ue(); if (chroma === 3) r.u(1);
        r.ue(); r.ue(); r.u(1);
        if (r.u(1)) throw new Error('scaling lists');
    }
    r.ue();
    const poc = r.ue();
    if (poc === 0) r.ue();
    else if (poc === 1) { r.u(1); r.se(); r.se(); const k = r.ue(); for (let i = 0; i < k; i++) r.se(); }
    r.ue(); r.u(1);
    const wm = r.ue() + 1, hm = r.ue() + 1, frameOnly = r.u(1);
    if (!frameOnly) r.u(1);
    r.u(1);
    let cl = 0, cr = 0, ct = 0, cb = 0;
    if (r.u(1)) { cl = r.ue(); cr = r.ue(); ct = r.ue(); cb = r.ue(); }
    const w = wm * 16 - (cl + cr) * 2, h = hm * 16 * (frameOnly ? 1 : 2) - (ct + cb) * 2 * (frameOnly ? 1 : 2);
    if (!(w > 0 && h > 0 && w <= 4096 && h <= 4096)) throw new Error('odd size ' + w + 'x' + h);
    return { w, h, level, profile, frames: list.filter((n) => n.type === 1 || n.type === 5).length };
}

/** RGBA (top-down) to the three planes of 4:2:0, for a picture padded to whole macroblocks; no sample is 0 (I_PCM forbids it). */
function planes(rgba, w, h, W, H) {
    const Y = Buffer.alloc(W * H), U = Buffer.alloc(W * H / 4), V = Buffer.alloc(W * H / 4);
    const clamp = (v) => (v < 1 ? 1 : v > 255 ? 255 : v | 0);
    for (let y = 0; y < H; y++) {
        const sy = y < h ? y : h - 1;
        for (let x = 0; x < W; x++) {
            const p = (sy * w + (x < w ? x : w - 1)) * 4;
            Y[y * W + x] = clamp(16.5 + 0.257 * rgba[p] + 0.504 * rgba[p + 1] + 0.098 * rgba[p + 2]);
        }
    }
    for (let y = 0; y < H; y += 2) for (let x = 0; x < W; x += 2) {
        let r = 0, g = 0, b = 0;
        for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
            const p = (Math.min(h - 1, y + dy) * w + Math.min(w - 1, x + dx)) * 4; r += rgba[p]; g += rgba[p + 1]; b += rgba[p + 2];
        }
        r /= 4; g /= 4; b /= 4;
        const q = (y >> 1) * (W >> 1) + (x >> 1);
        U[q] = clamp(128.5 - 0.148 * r - 0.291 * g + 0.439 * b);
        V[q] = clamp(128.5 + 0.439 * r - 0.368 * g - 0.071 * b);
    }
    return { Y, U, V };
}

/** The stream's two parameter sets for a picture of mw x mh macroblocks showing w x h. */
function headers(w, h, mw, mh, level) {
    const W = mw * 16, H = mh * 16;
    const sps = new BitWriter(64);
    sps.u(8, 66); sps.u(8, 0xc0); sps.u(8, level);          // Baseline with constraint_set0 and 1: Constrained Baseline
    sps.ue(0);                                              // seq_parameter_set_id
    sps.ue(0);                                              // log2_max_frame_num - 4: frame numbers 0..15
    sps.ue(2);                                              // pic_order_cnt_type 2: shown in the order decoded
    sps.ue(1); sps.u(1, 0);                                 // one reference picture; no gaps
    sps.ue(mw - 1); sps.ue(mh - 1); sps.u(1, 1); sps.u(1, 1);   // size in macroblocks; frames only; direct_8x8_inference
    const cropR = (W - w) >> 1, cropB = (H - h) >> 1;
    if (cropR || cropB) { sps.u(1, 1); sps.ue(0); sps.ue(cropR); sps.ue(0); sps.ue(cropB); } else sps.u(1, 0);
    sps.u(1, 1);                                            // VUI: only the timing and "no reordering"
    sps.u(1, 0); sps.u(1, 0); sps.u(1, 0); sps.u(1, 0);
    sps.u(1, 1); sps.u(32, 1); sps.u(32, 60); sps.u(1, 0);  // the timing the head unit's own files state
    sps.u(1, 0); sps.u(1, 0); sps.u(1, 0);
    sps.u(1, 1); sps.u(1, 1); sps.ue(0); sps.ue(0); sps.ue(10); sps.ue(10); sps.ue(0); sps.ue(1);
    sps.trailing();

    const pps = new BitWriter(16);
    pps.ue(0); pps.ue(0); pps.u(1, 0); pps.u(1, 0); pps.ue(0);  // ids; CAVLC; no extra order fields; one slice group
    pps.ue(0); pps.ue(0); pps.u(1, 0); pps.u(2, 0);             // one reference by default; no weighted prediction
    pps.se(0); pps.se(0); pps.se(0);                            // qp
    pps.u(1, 1); pps.u(1, 0); pps.u(1, 0);                      // the slice says "no deblocking"; the rest off
    pps.trailing();
    return [nal(3, 7, sps.done()), nal(3, 8, pps.done())];
}
/** The 384 samples of macroblock (mx, my) of the planes: 256 of brightness, 64 + 64 of colour. */
function samples(pl, W, mx, my, mb) {
    for (let y = 0; y < 16; y++) pl.Y.copy(mb, y * 16, (my * 16 + y) * W + mx * 16, (my * 16 + y) * W + mx * 16 + 16);
    for (let y = 0; y < 8; y++) {
        pl.U.copy(mb, 256 + y * 8, (my * 8 + y) * (W >> 1) + mx * 8, (my * 8 + y) * (W >> 1) + mx * 8 + 8);
        pl.V.copy(mb, 320 + y * 8, (my * 8 + y) * (W >> 1) + mx * 8, (my * 8 + y) * (W >> 1) + mx * 8 + 8);
    }
    return mb;
}
const BLACK = Buffer.concat([Buffer.alloc(256, 16), Buffer.alloc(128, 128)]);
/** The first picture: every macroblock I_PCM (mb_type 25 of an I slice), its samples as they are; black without planes. */
function firstPicture(pl, W, mw, mh) {
    const idr = new BitWriter(64 + mw * mh * (2 + 384));
    idr.ue(0); idr.ue(7); idr.ue(0); idr.u(4, 0); idr.ue(0);    // first_mb, I slice, pps, frame_num, idr_pic_id
    idr.u(1, 0); idr.u(1, 0);                                   // dec_ref_pic_marking of an IDR picture
    idr.se(0); idr.ue(1);                                       // slice_qp_delta; deblocking off
    const mb = Buffer.alloc(384);
    for (let my = 0; my < mh; my++) for (let mx = 0; mx < mw; mx++) { idr.ue(25); idr.align(); idr.bytes(pl ? samples(pl, W, mx, my, mb) : BLACK); }
    idr.trailing();
    return nal(3, 5, idr.done());
}
/**
 * A later picture: the macroblocks in `list` (their numbers, ascending) anew as I_PCM (mb_type 30 of a P slice), every
 * other one skipped: as it was. `get(n)` gives a macroblock's 384 samples.
 */
function nextPicture(f, mbs, list, get) {
    const p = new BitWriter(32 + list.length * (8 + 384));
    p.ue(0); p.ue(5); p.ue(0); p.u(4, f & 15);                  // first_mb, P slice, pps, frame_num
    p.u(1, 0); p.u(1, 0);                                       // the default number of references; the default list
    p.u(1, 0);                                                  // sliding window
    p.se(0); p.ue(1);                                           // slice_qp_delta; deblocking off
    let at = 0;
    list.forEach((n) => { p.ue(n - at); p.ue(30); p.align(); p.bytes(get(n)); at = n + 1; });
    if (at < mbs) p.ue(mbs - at);                               // mb_skip_run: the rest
    p.trailing();
    return nal(2, 1, p.done());
}
function sizes(rgba, w, h, opt) {
    if (rgba.length !== w * h * 4) throw new Error('wrong picture size');
    const frames = Math.max(1, opt.frames || 60);
    const mw = Math.ceil(w / 16), mh = Math.ceil(h / 16), mbs = mw * mh;
    return { frames, mw, mh, W: mw * 16, H: mh * 16, mbs, level: Math.max(opt.level || 31, mbs > 8192 ? 50 : mbs > 3600 ? 40 : mbs > 1620 ? 31 : 30) };
}

/**
 * An H.264 stream showing the RGBA picture (top-down, w x h) for opt.frames pictures.
 * opt: { frames (60), level (31) }.
 */
function stillVideo(rgba, w, h, opt) {
    opt = opt || {};
    const z = sizes(rgba, w, h, opt);
    const parts = headers(w, h, z.mw, z.mh, z.level).concat([firstPicture(planes(rgba, w, h, z.W, z.H), z.W, z.mw, z.mh)]);
    for (let f = 1; f < z.frames; f++) parts.push(nextPicture(f, z.mbs, [], null));
    return Buffer.concat(parts);
}

/**
 * When each macroblock of the opening appears, 0..1: first a band across the middle runs from the centre to both
 * sides (two lines shooting out), then the picture opens from that band to the top and the bottom.
 */
function opening(mw, mh) {
    const t = new Float32Array(mw * mh), cx = (mw - 1) / 2, cy = (mh - 1) / 2, band = Math.max(1, Math.round(mh / 14));
    for (let my = 0; my < mh; my++) for (let mx = 0; mx < mw; mx++) {
        const dy = Math.abs(my - cy), dx = Math.abs(mx - cx) / Math.max(1, cx);
        t[my * mw + mx] = dy <= band ? 0.5 * dx : 0.5 + 0.5 * (dy - band) / Math.max(1, cy - band) + 0.04 * dx;
    }
    return t;
}
/**
 * An H.264 stream of opt.frames pictures in which the RGBA picture opens out of black (or, opt.out, closes into it)
 * as opening() says, with a moment of the whole picture (or of black) at the end. Every part of the picture is sent
 * once, uncompressed, when its turn comes. opt: { frames (60), level (31), out }.
 */
function openingVideo(rgba, w, h, opt) {
    opt = opt || {};
    const z = sizes(rgba, w, h, opt), pl = planes(rgba, w, h, z.W, z.H), when = opening(z.mw, z.mh);
    const moving = Math.max(1, Math.round((z.frames - 1) * 0.8));             // the last fifth stands still
    const ease = (x) => 1 - Math.pow(1 - x, 2.2);                           // fast at first, settling
    // the picture in which each macroblock changes: 1..moving
    const turn = new Int32Array(z.mbs), max = when.reduce((m, v) => Math.max(m, v), 0) || 1;
    for (let n = 0; n < z.mbs; n++) {
        const want = (opt.out ? 1 - when[n] / max : when[n] / max);
        let f = 1; while (f < moving && ease(f / moving) < want) f++;
        turn[n] = f;
    }
    const mb = Buffer.alloc(384);
    const parts = headers(w, h, z.mw, z.mh, z.level).concat([firstPicture(opt.out ? pl : null, z.W, z.mw, z.mh)]);
    for (let f = 1; f < z.frames; f++) {
        const list = [];
        for (let n = 0; n < z.mbs; n++) if (turn[n] === f) list.push(n);
        parts.push(nextPicture(f, z.mbs, list, (n) => (opt.out ? BLACK : samples(pl, z.W, n % z.mw, (n / z.mw) | 0, mb))));
    }
    return Buffer.concat(parts);
}

/* ---------------- PNG ---------------- */
function pngInfo(buf) {
    if (buf.length < 33 || buf.readUInt32BE(0) !== 0x89504e47 || buf.toString('latin1', 12, 16) !== 'IHDR') throw new Error('not a PNG');
    return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20), depth: buf[24], colour: buf[25], interlace: buf[28] };
}

/** { w, h, rgba } of an 8-bit, not interlaced PNG (grey, RGB, palette or with alpha). */
function pngDecode(buf) {
    const info = pngInfo(buf);
    if (info.depth !== 8 || info.interlace) throw new Error('PNG kind not read here');
    const ch = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[info.colour];
    if (!ch) throw new Error('PNG colour type ' + info.colour);
    const idat = []; let pal = null, trns = null;
    for (let p = 8; p + 12 <= buf.length;) {
        const len = buf.readUInt32BE(p), type = buf.toString('latin1', p + 4, p + 8);
        if (type === 'IDAT') idat.push(buf.slice(p + 8, p + 8 + len));
        else if (type === 'PLTE') pal = buf.slice(p + 8, p + 8 + len);
        else if (type === 'tRNS') trns = buf.slice(p + 8, p + 8 + len);
        else if (type === 'IEND') break;
        p += 12 + len;
    }
    const raw = zlib.inflateSync(Buffer.concat(idat));
    const w = info.w, h = info.h, stride = w * ch;
    if (raw.length < (stride + 1) * h) throw new Error('PNG data too short');
    const out = Buffer.alloc(w * h * 4), cur = Buffer.alloc(stride);
    let prev = Buffer.alloc(stride);
    for (let y = 0; y < h; y++) {
        const f = raw[y * (stride + 1)], row = y * (stride + 1) + 1;
        for (let x = 0; x < stride; x++) {
            const a = x >= ch ? cur[x - ch] : 0, b = prev[x], c = x >= ch ? prev[x - ch] : 0;
            let v = raw[row + x];
            if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
            else if (f === 4) { const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
            cur[x] = v & 255;
        }
        for (let x = 0; x < w; x++) {
            const q = (y * w + x) * 4, s = x * ch;
            if (info.colour === 6) { out[q] = cur[s]; out[q + 1] = cur[s + 1]; out[q + 2] = cur[s + 2]; out[q + 3] = cur[s + 3]; }
            else if (info.colour === 2) { out[q] = cur[s]; out[q + 1] = cur[s + 1]; out[q + 2] = cur[s + 2]; out[q + 3] = 255; }
            else if (info.colour === 0) { out[q] = out[q + 1] = out[q + 2] = cur[s]; out[q + 3] = 255; }
            else if (info.colour === 4) { out[q] = out[q + 1] = out[q + 2] = cur[s]; out[q + 3] = cur[s + 1]; }
            else { const i = cur[s]; out[q] = pal ? pal[i * 3] : 0; out[q + 1] = pal ? pal[i * 3 + 1] : 0; out[q + 2] = pal ? pal[i * 3 + 2] : 0; out[q + 3] = trns && i < trns.length ? trns[i] : 255; }
        }
        cur.copy(prev);
    }
    return { w, h, rgba: out };
}

module.exports = { h264Info, stillVideo, openingVideo, pngInfo, pngDecode, nals };
