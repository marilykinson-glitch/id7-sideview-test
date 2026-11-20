'use strict';
/**
 * res.js - a Ramses resource file of any kind (bitmaps.res, effects.res, meshes.res), for replacing single
 * resources in it. wbm.js is the reader for files that hold only plain RGBA pictures; this one keeps every
 * resource as the bytes it is and only moves the table of contents.
 *
 *   text header "[RamsesVersion:..]\n[GitHash:..]\n", 16 bytes (offsets of table A and B), the tables
 *   table A   per resource: its content hash, its id hash and what it is (not changed here)
 *   table B   per resource 36 bytes: type(4) contentHash(16) uncompressed(4) compressed(4) offset(4) size(4)
 *   data      the resources back to back: a header (kind, name, compressed?, sizes, what it has) + the payload
 *
 * A resource's header ends where its payload begins: size - (compressed || uncompressed) bytes.
 *   texture   (type 3) 45 bytes for one mip level; compressed size at +12; LZ4 block
 *   effect    (type 6) name "shd", sizes, the uniforms and attributes, then the vertex shader's length;
 *             payload: the vertex shader and the fragment shader, each a string with its final NUL, not compressed
 *
 * The .ids file maps a resource's name to its id hash. Node 8: no dependencies.
 */
const W = require('./wbm');

function idBytes(hex) {
    const b = Buffer.from(hex.replace(/^0x/, ''), 'hex');
    if (b.length !== 16) throw new Error('bad id ' + hex);
    return Buffer.concat([Buffer.from(b.slice(0, 8)).reverse(), Buffer.from(b.slice(8)).reverse()]);
}

class Res {
    constructor(data, idsText) {
        this.data = data;
        let p = 0;
        while (data[p] === 0x5b) { const e = data.indexOf(0x0a, p); if (e < 0) throw new Error('no header'); p = e + 1; }
        if (!p || p + 16 > data.length) throw new Error('not a resource file');
        const offA = data.readUInt32LE(p), offB = data.readUInt32LE(p + 8);
        if (data.readUInt32LE(p + 4) || data.readUInt32LE(p + 12) || !(offA < offB && offB + 4 <= data.length)) throw new Error('odd table offsets');
        const n = data.readUInt32LE(offB);
        if (!n || offB + 4 + n * 36 > data.length) throw new Error('odd table');
        this.rows = [];
        for (let i = 0; i < n; i++) {
            const t = offB + 4 + i * 36;
            this.rows.push({ toc: t, type: data.readUInt32LE(t), hash: data.slice(t + 4, t + 20), dec: data.readUInt32LE(t + 20), comp: data.readUInt32LE(t + 24), off: data.readUInt32LE(t + 28), size: data.readUInt32LE(t + 32) });
        }
        this.order = this.rows.slice().sort((a, b) => a.off - b.off);
        this.dataStart = this.order[0].off;
        if (this.dataStart !== offB + 4 + n * 36) throw new Error('data does not follow the tables');
        let end = this.dataStart;
        this.order.forEach((r) => { if (r.off !== end || r.size < (r.comp || r.dec)) throw new Error('resources are not back to back'); end += r.size; });
        if (end !== data.length) throw new Error('data after the last resource');
        this.byName = {};
        String(idsText).split('\n').forEach((line) => {
            const m = /^(0x[0-9a-fA-F]{32})\s+(\S+)$/.exec(line.trim());
            if (!m) return;
            const at = data.indexOf(idBytes(m[1]));
            if (at < offA + 16 || at >= offB) return;
            const hash = data.slice(at - 16, at), row = this.rows.filter((r) => r.hash.equals(hash))[0];
            if (row) this.byName[m[2]] = row;
        });
    }

    has(name) { return !!this.byName[name]; }
    blob(name) { const r = this.byName[name]; return this.data.slice(r.off, r.off + r.size); }
    headerLength(name) { const r = this.byName[name]; return r.size - (r.comp || r.dec); }
    /** The resource's payload, uncompressed. */
    payload(name) {
        const r = this.byName[name], b = this.data.slice(r.off + this.headerLength(name), r.off + r.size);
        return r.comp ? W.lz4Decompress(b, r.dec) : b;
    }

    /** A new file with the resources in `replace` ({ name: { blob, dec, comp } }) swapped in. */
    build(replace) {
        replace = replace || {};
        const byToc = {};
        Object.keys(replace).forEach((name) => { if (!this.byName[name]) throw new Error('no resource ' + name); byToc[this.byName[name].toc] = replace[name]; });
        const head = Buffer.from(this.data.slice(0, this.dataStart)), parts = [];
        let pos = this.dataStart;
        this.order.forEach((r) => {
            const x = byToc[r.toc];
            const blob = x ? x.blob : this.data.slice(r.off, r.off + r.size);
            if (x) { head.writeUInt32LE(x.dec, r.toc + 20); head.writeUInt32LE(x.comp, r.toc + 24); }
            head.writeUInt32LE(pos, r.toc + 28); head.writeUInt32LE(blob.length, r.toc + 32);
            parts.push(blob); pos += blob.length;
        });
        return Buffer.concat([head].concat(parts));
    }

    /* ---- textures ---- */
    /** { w, h, format, mips } of a texture (format 5: RGBA8, 3: RGB8, 1: R8). */
    texture(name) {
        const r = this.byName[name], b = this.data;
        if (r.type !== 3) throw new Error(name + ' is not a texture');
        return { w: b.readUInt32LE(r.off + 24), h: b.readUInt32LE(r.off + 28), mips: b.readUInt32LE(r.off + 36), rgba: r.dec === b.readUInt32LE(r.off + 24) * b.readUInt32LE(r.off + 28) * 4 && this.headerLength(name) === 45 };
    }
    /** The replacement for a one-level RGBA texture: its header + the LZ4 block of `rgba` (rows from the bottom up). */
    textureBlob(name, rgba) {
        const r = this.byName[name], t = this.texture(name);
        if (!t.rgba || t.mips !== 1 || rgba.length !== r.dec) throw new Error(name + ' is not a plain RGBA picture of this size');
        const z = W.lz4Compress(rgba), hdr = Buffer.from(this.data.slice(r.off, r.off + 45));
        hdr.writeUInt32LE(1, 8); hdr.writeUInt32LE(z.length, 12);
        return { blob: Buffer.concat([hdr, z]), dec: r.dec, comp: z.length };
    }

    /* ---- effects ---- */
    /** { vertex, fragment } of an effect, as text. */
    shaders(name) {
        const r = this.byName[name];
        if (r.type !== 6 || r.comp) throw new Error(name + ' is not a plain effect');
        const hl = this.headerLength(name), vlen = this.data.readUInt32LE(r.off + hl - 4), pay = this.payload(name);
        if (!(vlen > 1 && vlen < pay.length) || pay[vlen - 1] !== 0 || pay[pay.length - 1] !== 0) throw new Error(name + ': odd shader strings');
        const nameLen = this.data.readUInt32LE(r.off + 4);
        if (this.data.readUInt32LE(r.off + 8 + nameLen + 8) !== r.dec) throw new Error(name + ': odd effect header');
        return { vertex: pay.toString('latin1', 0, vlen - 1), fragment: pay.toString('latin1', vlen, pay.length - 1) };
    }
    /** The replacement for an effect with other shader texts (the same uniforms and attributes). */
    effectBlob(name, vertex, fragment) {
        const r = this.byName[name], hl = this.headerLength(name);
        this.shaders(name);                                         // the layout is the one known
        const v = Buffer.from(vertex + '\0', 'latin1'), f = Buffer.from(fragment + '\0', 'latin1');
        const hdr = Buffer.from(this.data.slice(r.off, r.off + hl));
        hdr.writeUInt32LE(v.length + f.length, 8 + hdr.readUInt32LE(4) + 8);
        hdr.writeUInt32LE(v.length, hl - 4);
        return { blob: Buffer.concat([hdr, v, f]), dec: v.length + f.length, comp: 0 };
    }
}

module.exports = { Res };
