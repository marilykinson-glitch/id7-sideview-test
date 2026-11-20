'use strict';
/**
 * wbm.js - reads and writes the head unit's avatar bundle: the Ramses resource file
 * wbitmaps.res (+ wbitmaps.res.ids) under assetDB/.../Static/Avatar/MyVehicle_Avatar.
 *
 * The bundle holds 21 pictures (names MyVehicle_Avatar_Icon_V001_S00..S20): S00 the default,
 * S01..S15 the fifteen the profile picker offers. Each is a 570x570 RGBA8 texture, rows from the
 * bottom up, LZ4-block compressed. Layout of the file (found from the file itself):
 *
 *   text header  "[RamsesVersion:..]\n[GitHash:..]\n"      then 16 bytes, then the tables
 *   table A      per picture 52 bytes: contentHash(16) idHash(16) 20 more (size, size, 5, index, 0)
 *   table B      per picture 36 bytes: type=3 (4) contentHash(16) decompressed(4) compressed(4) offset(4) size(4)
 *   data         from the first offset to the end of the file, back to back, each picture:
 *                45 bytes of header (compressed size at +12, width/height at +24/+28) + the LZ4 block
 *
 * The .ids file maps a name to the idHash (as 0x + 32 hex digits, two little-endian 64-bit halves).
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
    const out = [];
    let outLen = 0;
    const push = (buf) => { out.push(buf); outLen += buf.length; };
    const lenBytes = (v) => { const a = []; while (v >= 255) { a.push(255); v -= 255; } a.push(v); return Buffer.from(a); };
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
            const ll = i - anchor, ml = m - 4;
            push(Buffer.from([(Math.min(ll, 15) << 4) | Math.min(ml, 15)]));
            if (ll >= 15) push(lenBytes(ll - 15));
            push(src.slice(anchor, i));
            push(Buffer.from([(i - cand) & 255, (i - cand) >> 8]));
            if (ml >= 15) push(lenBytes(ml - 15));
            i += m; anchor = i;
        } else i++;
    }
    const ll = n - anchor;
    push(Buffer.from([Math.min(ll, 15) << 4]));
    if (ll >= 15) push(lenBytes(ll - 15));
    push(src.slice(anchor));
    return Buffer.concat(out, outLen);
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
            const key = /_(S\d\d)\.png$/.exec(m[2]);
            if (!key) return;
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
            if (off + size > data.length || size !== comp + HEAD || dec !== RAW) throw new Error('unexpected entry ' + m[2]);
            const w = data.readUInt32LE(off + 24), h = data.readUInt32LE(off + 28);
            if (w !== SIZE || h !== SIZE) throw new Error('unexpected size ' + w + 'x' + h + ' in ' + m[2]);
            this.entries.push({ key: key[1], toc, dec, comp, off, size });
        });
        this.entries.sort((a, b) => a.off - b.off);
        if (this.entries.length < 16) throw new Error('only ' + this.entries.length + ' pictures found');
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

    /** A new file with the pictures in `replace` ({ 'S01': rgba bottom-up | blob: Buffer }) swapped in. */
    build(replace) {
        replace = replace || {};
        const head = Buffer.from(this.data.slice(0, this.dataStart));
        const parts = [];
        let pos = this.dataStart;
        this.entries.forEach((e) => {
            let blob = this.blob(e.key), comp = e.comp;
            const r = replace[e.key];
            if (r && r.length === RAW) {
                const z = lz4Compress(r);
                const hdr = Buffer.from(blob.slice(0, HEAD));
                hdr.writeUInt32LE(z.length, 12);
                blob = Buffer.concat([hdr, z]); comp = z.length;
            } else if (r) {                  // a whole blob (header + block) from another bundle
                blob = r; comp = r.length - HEAD;
            }
            head.writeUInt32LE(comp, e.toc + 20);
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
    const probe = Buffer.alloc(RAW, 0x5a);
    for (let i = 0; i < RAW; i += 7) probe[i] = i & 255;
    const nb = new Bundle(b.build({ S01: probe }), idsText);
    if (Buffer.compare(nb.rgba('S01'), probe) !== 0) throw new Error('picture round trip failed');
    return b;
}

/* ---- pictures: the phone sends top-down RGBA; the file has rows from the bottom up ---- */
function flipRows(rgba, w, h) {
    const out = Buffer.allocUnsafe(rgba.length), row = w * 4;
    for (let y = 0; y < h; y++) rgba.copy(out, (h - 1 - y) * row, y * row, (y + 1) * row);
    return out;
}

/** Box-filter shrink of an RGBA picture to size x size (size divides w*k closely; nearest cell edges). */
function shrink(rgba, w, h, size) {
    const out = Buffer.allocUnsafe(size * size * 4);
    for (let y = 0; y < size; y++) {
        const y0 = Math.floor(y * h / size), y1 = Math.max(y0 + 1, Math.floor((y + 1) * h / size));
        for (let x = 0; x < size; x++) {
            const x0 = Math.floor(x * w / size), x1 = Math.max(x0 + 1, Math.floor((x + 1) * w / size));
            let r = 0, g = 0, b = 0, a = 0, c = 0;
            for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) {
                const p = (yy * w + xx) * 4; r += rgba[p]; g += rgba[p + 1]; b += rgba[p + 2]; a += rgba[p + 3]; c++;
            }
            const q = (y * size + x) * 4;
            out[q] = r / c; out[q + 1] = g / c; out[q + 2] = b / c; out[q + 3] = a / c;
        }
    }
    return out;
}

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

module.exports = { SIZE, RAW, Bundle, selfTest, lz4Compress, lz4Decompress, flipRows, shrink, png, crc32 };
