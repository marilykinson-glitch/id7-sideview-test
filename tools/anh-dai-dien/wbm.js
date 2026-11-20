'use strict';
/**
 * wbm.js - reads and writes the head unit's picture bundles: the Ramses resource files
 * wbitmaps.res (+ wbitmaps.res.ids) under assetDB (the profile pictures, their small icons, the
 * placeholder covers of the media sources, ...).
 *
 * A bundle holds some pictures; each is an RGBA8 texture (format 5), rows from the bottom up, LZ4-block
 * compressed. Layout of the file (found from the files themselves):
 *
 *   text header  "[RamsesVersion:..]\n[GitHash:..]\n"      then 16 bytes, then the tables
 *   table A      per picture 52 bytes: index(4) 0(4) contentHash(16) idHash(16) width(4) height(4) format(4)
 *   table B      per picture 36 bytes: type=3 (4) contentHash(16) decompressed(4) compressed(4) offset(4) size(4)
 *   data         from the first offset to the end of the file, back to back, each picture:
 *                45 bytes of header (compressed size at +12, width/height at +24/+28) + the LZ4 block
 *
 * The .ids file maps a name to the idHash (as 0x + 32 hex digits, two little-endian 64-bit halves). A picture's
 * key here is its name without ".png"; the profile pictures (MyVehicle_Avatar_Icon_V001_S00..S20) are S00..S20.
 * Rebuilding with nothing replaced gives the same bytes as the file read (checked by selfTest).
 * Node 8: no dependencies.
 */
const zlib = require('zlib');

const SIZE = 570, RAW = SIZE * SIZE * 4, HEAD = 45;

function lz4Decompress(src, dsize) {
    const out = Buffer.allocUnsafe(dsize);
    let i = 0, o = 0;
    const n = src.length;
    while (i < n) {
        const t = src[i++];
        let ll = t >> 4;
        if (ll === 15) { let b; do { b = src[i++]; ll += b; } while (b === 255); }
        if (o + ll > dsize || i + ll > n) throw new Error('lz4: literal out of range');
        src.copy(out, o, i, i + ll); i += ll; o += ll;
        if (i >= n) break;
        const off = src[i] | (src[i + 1] << 8); i += 2;
        let ml = t & 15;
        if (ml === 15) { let b; do { b = src[i++]; ml += b; } while (b === 255); }
        ml += 4;
        if (off === 0 || off > o || o + ml > dsize) throw new Error('lz4: bad match');
        for (let k = 0; k < ml; k++, o++) out[o] = out[o - off];
    }
    if (o !== dsize) throw new Error('lz4: size ' + o + ' != ' + dsize);
    return out;
}

/** Greedy LZ4 block compressor: a valid stream, about a quarter bigger than lz4hc on photographs. */
function lz4Compress(src) {
    const n = src.length;
    const out = Buffer.allocUnsafe(n + Math.ceil(n / 255) + 32);     // the worst case: all literals
    let o = 0;
    const seq = (from, to, off, ml) => {                              // literals [from, to), then a match (off 0: the last literals)
        const ll = to - from;
        out[o++] = (Math.min(ll, 15) << 4) | (off ? Math.min(ml, 15) : 0);
        if (ll >= 15) { let v = ll - 15; while (v >= 255) { out[o++] = 255; v -= 255; } out[o++] = v; }
        src.copy(out, o, from, to); o += ll;
        if (!off) return;
        out[o++] = off & 255; out[o++] = off >> 8;
        if (ml >= 15) { let v = ml - 15; while (v >= 255) { out[o++] = 255; v -= 255; } out[o++] = v; }
    };
    const table = new Int32Array(1 << 16).fill(-1);
    const limit = n - 12;
    let i = 0, anchor = 0;
    while (i < limit) {
        const w = src.readUInt32LE(i);
        const h = (Math.imul(w, 2654435761) >>> 16) & 0xffff;
        const cand = table[h];
        table[h] = i;
        if (cand >= 0 && i - cand <= 65535 && src.readUInt32LE(cand) === w) {
            let m = 4;
            const maxm = n - 5 - i;
            while (m < maxm && src[cand + m] === src[i + m]) m++;
            seq(anchor, i, i - cand, m - 4);
            i += m; anchor = i;
        } else i++;
    }
    seq(anchor, n, 0, 0);
    return Buffer.from(out.slice(0, o));
}

function idBytes(hex) {                       // '0x' + 32 digits  ->  the 16 bytes as the file has them
    const b = Buffer.from(hex.replace(/^0x/, ''), 'hex');
    if (b.length !== 16) throw new Error('bad id ' + hex);
    return Buffer.concat([Buffer.from(b.slice(0, 8)).reverse(), Buffer.from(b.slice(8)).reverse()]);
}

class Bundle {
    constructor(data, idsText) {
        this.data = data;
        this.entries = [];
        String(idsText).split('\n').forEach((line) => {
            const m = /^(0x[0-9a-fA-F]{32})\s+(\S+)$/.exec(line.trim());
            if (!m) return;
            const av = /_(S\d\d)\.png$/.exec(m[2]);
            const key = av ? av[1] : m[2].replace(/\.png$/, '');
            const p = data.indexOf(idBytes(m[1]));
            if (p < 16) throw new Error('no id hash for ' + m[2]);
            const content = data.slice(p - 16, p);
            let toc = -1, from = 0;
            for (;;) {                        // the table-B entry: type 3 then the content hash
                const q = data.indexOf(content, from);
                if (q < 0) break;
                if (q >= 4 && data.readUInt32LE(q - 4) === 3) toc = q;
                from = q + 1;
            }
            if (toc < 0) throw new Error('no table entry for ' + m[2]);
            const dec = data.readUInt32LE(toc + 16), comp = data.readUInt32LE(toc + 20);
            const off = data.readUInt32LE(toc + 24), size = data.readUInt32LE(toc + 28);
            if (off + size > data.length || size !== comp + HEAD) throw new Error('unexpected entry ' + m[2]);
            const w = data.readUInt32LE(off + 24), h = data.readUInt32LE(off + 28);
            if (w !== data.readUInt32LE(p + 16) || h !== data.readUInt32LE(p + 20)) throw new Error('two sizes for ' + m[2]);
            if (!w || !h || dec !== w * h * 4 || data.readUInt32LE(p + 24) !== 5) throw new Error(m[2] + ' is not an RGBA picture');
            this.entries.push({ key, toc, dec, comp, off, size, w, h });
        });
        this.entries.sort((a, b) => a.off - b.off);
        if (!this.entries.length) throw new Error('no pictures found');
        this.dataStart = this.entries[0].off;
        let end = this.dataStart;
        this.entries.forEach((e) => { if (e.off !== end) throw new Error('pictures are not back to back'); end += e.size; });
        if (end !== data.length) throw new Error('data after the last picture');
        this.byKey = {};
        this.entries.forEach((e) => { this.byKey[e.key] = e; });
    }

    blob(key) { const e = this.byKey[key]; return this.data.slice(e.off, e.off + e.size); }

    /** The picture as RGBA, rows from the bottom up (as stored). */
    rgba(key) { const e = this.byKey[key]; return lz4Decompress(this.data.slice(e.off + HEAD, e.off + HEAD + e.comp), e.dec); }

    /** A picture's blob (its 45-byte header + the LZ4 block) for RGBA bytes, rows from the bottom up. */
    encode(key, rgba) {
        const e = this.byKey[key];
        if (rgba.length !== e.dec) throw new Error('wrong picture size for ' + key);
        const z = lz4Compress(rgba);
        const hdr = Buffer.from(this.data.slice(e.off, e.off + HEAD));
        hdr.writeUInt32LE(z.length, 12);
        return Buffer.concat([hdr, z]);
    }

    /** A new file with the pictures in `replace` swapped in: { key: RGBA bottom-up, or { blob } (a header + block) }. */
    build(replace) {
        replace = replace || {};
        const head = Buffer.from(this.data.slice(0, this.dataStart));
        const parts = [];
        let pos = this.dataStart;
        this.entries.forEach((e) => {
            let blob = this.blob(e.key);
            const r = replace[e.key];
            if (r && r.blob) blob = r.blob;
            else if (r && r.length === e.dec) blob = this.encode(e.key, r);
            else if (r) blob = r;            // a whole blob from another bundle of the same pictures
            if (blob.length <= HEAD || blob.readUInt32LE(24) !== e.w || blob.readUInt32LE(28) !== e.h || blob.readUInt32LE(12) !== blob.length - HEAD) throw new Error('bad picture for ' + e.key);
            head.writeUInt32LE(blob.length - HEAD, e.toc + 20);
            head.writeUInt32LE(pos, e.toc + 24);
            head.writeUInt32LE(blob.length, e.toc + 28);
            parts.push(blob); pos += blob.length;
        });
        return Buffer.concat([head].concat(parts));
    }
}

/** Parses, and checks that rebuilding changes nothing and one picture survives a round trip. */
function selfTest(data, idsText) {
    const b = new Bundle(data, idsText);
    if (Buffer.compare(b.build({}), data) !== 0) throw new Error('rebuild differs from the file');
    const e = b.entries.reduce((m, x) => (x.dec < m.dec ? x : m), b.entries[0]);       // the smallest: this runs at every start
    const probe = Buffer.alloc(e.dec, 0x5a);
    for (let i = 0; i < e.dec; i += 7) probe[i] = i & 255;
    const nb = new Bundle(b.build({ [e.key]: probe }), idsText);
    if (Buffer.compare(nb.rgba(e.key), probe) !== 0) throw new Error('picture round trip failed');
    return b;
}

/* ---- pictures: the phone sends top-down RGBA; the file has rows from the bottom up ---- */
function flipRows(rgba, w, h) {
    const out = Buffer.allocUnsafe(rgba.length), row = w * 4;
    for (let y = 0; y < h; y++) rgba.copy(out, (h - 1 - y) * row, y * row, (y + 1) * row);
    return out;
}

/** An RGBA picture at another size: every new pixel is the area average of what it covers (for making it smaller). */
function resize(rgba, w, h, w2, h2) {
    if (w === w2 && h === h2) return Buffer.from(rgba);
    const spans = (n, n2) => {                // per new pixel: the first old pixel, and the weights of those it covers
        const out = [], k = n / n2;
        for (let i = 0; i < n2; i++) {
            const a = i * k, b = Math.min(n, (i + 1) * k);
            const first = Math.floor(a), last = Math.min(n - 1, Math.ceil(b) - 1), ws = [];
            for (let j = first; j <= last; j++) ws.push(Math.max(0, Math.min(b, j + 1) - Math.max(a, j)));
            const sum = ws.reduce((x, y) => x + y, 0) || 1;
            out.push({ first, ws: ws.map((x) => x / sum) });
        }
        return out;
    };
    const sx = spans(w, w2), sy = spans(h, h2);
    const mid = new Float32Array(w2 * h * 4);                       // across first
    for (let y = 0; y < h; y++) for (let x = 0; x < w2; x++) {
        const s = sx[x]; let r = 0, g = 0, b = 0, a = 0;
        for (let j = 0; j < s.ws.length; j++) { const p = (y * w + s.first + j) * 4, k = s.ws[j]; r += rgba[p] * k; g += rgba[p + 1] * k; b += rgba[p + 2] * k; a += rgba[p + 3] * k; }
        const q = (y * w2 + x) * 4; mid[q] = r; mid[q + 1] = g; mid[q + 2] = b; mid[q + 3] = a;
    }
    const out = Buffer.allocUnsafe(w2 * h2 * 4);                   // then down
    for (let y = 0; y < h2; y++) {
        const s = sy[y];
        for (let x = 0; x < w2; x++) {
            let r = 0, g = 0, b = 0, a = 0;
            for (let j = 0; j < s.ws.length; j++) { const p = ((s.first + j) * w2 + x) * 4, k = s.ws[j]; r += mid[p] * k; g += mid[p + 1] * k; b += mid[p + 2] * k; a += mid[p + 3] * k; }
            const q = (y * w2 + x) * 4; out[q] = Math.round(r); out[q + 1] = Math.round(g); out[q + 2] = Math.round(b); out[q + 3] = Math.round(a);
        }
    }
    return out;
}

/** A picture fitted into a w x h one: it covers the box [x, y, bw, bh] (cut at the middle), the rest is transparent. */
function fit(rgba, sw, sh, w, h, box) {
    const bx = box ? box[0] : 0, by = box ? box[1] : 0, bw = box ? box[2] : w, bh = box ? box[3] : h;
    const k = Math.max(bw / sw, bh / sh);
    const mw = Math.max(bw, Math.round(sw * k)), mh = Math.max(bh, Math.round(sh * k));
    const sc = resize(rgba, sw, sh, mw, mh);
    const out = Buffer.alloc(w * h * 4);
    const cx = Math.floor((mw - bw) / 2), cy = Math.floor((mh - bh) / 2);
    for (let y = 0; y < bh; y++) sc.copy(out, ((by + y) * w + bx) * 4, ((cy + y) * mw + cx) * 4, ((cy + y) * mw + cx + bw) * 4);
    return out;
}
const place = (rgba, size, w, h, box) => fit(rgba, size, size, w, h, box);

/** Shrinks an RGBA picture to size x size. */
function shrink(rgba, w, h, size) { return resize(rgba, w, h, size, size); }

const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(buf) { let c = 0xffffffff; for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }

function png(rgba, w, h) {
    const raw = Buffer.allocUnsafe((w * 4 + 1) * h);
    for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4); }
    const chunk = (type, data) => {
        const b = Buffer.alloc(12 + data.length);
        b.writeUInt32BE(data.length, 0); b.write(type, 4, 'latin1'); data.copy(b, 8);
        b.writeUInt32BE(crc32(b.slice(4, 8 + data.length)), 8 + data.length);
        return b;
    };
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
    return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 6 })), chunk('IEND', Buffer.alloc(0))]);
}

module.exports = { SIZE, RAW, HEAD, Bundle, selfTest, lz4Compress, lz4Decompress, flipRows, resize, fit, place, shrink, png, crc32 };
