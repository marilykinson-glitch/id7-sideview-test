'use strict';
/**
 * Tests of Ảnh đại diện: the bundle reader/writer (tools/anh-dai-dien/wbm.js) on a bundle made here in the
 * layout of the car's wbitmaps.res files (the profile pictures, their icons, a placeholder cover), the service end
 * to end over HTTP (PIN, upload, restore, backup, the app's
 * commands, a bundle it does not know), and the car screen's drawing.
 *   node tests/anh_dai_dien_test.js          (with AVATAR_REAL_RES + AVATAR_REAL_IDS: also the car's real bundle;
 *                                             with AVATAR_REAL_TREE: every bundle in a folder copied from a car)
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const Module = require('module');

const ROOT = path.join(__dirname, '..');
const W = require(path.join(ROOT, 'tools', 'anh-dai-dien', 'wbm.js'));
let n = 0;
const ok = (name) => { n++; console.log('ok ' + n + ' - ' + name); };

/* ---------- bundles like the car's, made here ---------- */
const KEYS = []; for (let i = 0; i <= 20; i++) KEYS.push('S' + (i < 10 ? '0' : '') + i);
function picture(seed, w, h) {                // RGBA: smooth, with edges, so LZ4 finds matches and literals
    w = w || W.SIZE; h = h || w;
    const b = Buffer.alloc(w * h * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const p = (y * w + x) * 4, edge = ((x >> 5) + (y >> 6) + seed) & 3;
        b[p] = (x * 255 / w + seed * 9) & 255; b[p + 1] = (y * 255 / h) & 255; b[p + 2] = edge * 60 + (seed * 7 & 31); b[p + 3] = 255;
    }
    return b;
}
/** A bundle of the pictures `pics` ([{ name, w, h }]), in the order given. */
function makeBundle(pics) {
    pics = pics || KEYS.map((k) => ({ name: 'MyVehicle_Avatar_Icon_V001_' + k + '.png', w: W.SIZE, h: W.SIZE }));
    const n = pics.length;
    const head = Buffer.from('[RamsesVersion:19.0.14]\n[GitHash:test]\n', 'latin1');
    const idsLines = [], tabA = [], tabB = [], blobs = [];
    pics.forEach((pc, i) => {
        const content = crypto.randomBytes(16), idHex = crypto.randomBytes(16).toString('hex'), raw = pc.w * pc.h * 4;
        const idb = Buffer.concat([Buffer.from(idHex.slice(0, 16), 'hex').reverse(), Buffer.from(idHex.slice(16), 'hex').reverse()]);
        idsLines.push('0x' + idHex + ' ' + pc.name);
        const pre = Buffer.alloc(8); pre.writeUInt32LE(i + 1, 0);
        const tail = Buffer.alloc(12); tail.writeUInt32LE(pc.w, 0); tail.writeUInt32LE(pc.h, 4); tail.writeUInt32LE(5, 8);
        tabA.push(Buffer.concat([pre, content, idb, tail]));
        const z = W.lz4Compress(picture(i, pc.w, pc.h));
        const h = Buffer.alloc(45); h.writeUInt32LE(3, 0); h.writeUInt32LE(1, 8); h.writeUInt32LE(z.length, 12); h.writeUInt32LE(raw, 16);
        h.writeInt32LE(-1, 20); h.writeUInt32LE(pc.w, 24); h.writeUInt32LE(pc.h, 28); h.writeUInt32LE(9, 32); h.writeUInt32LE(1, 36); h.writeUInt32LE(raw, 40);
        blobs.push(Buffer.concat([h, z])); tabB.push({ content, raw });
    });
    const offA = head.length + 16, offB = offA + 16 + 52 * n;
    const pre = Buffer.alloc(16); pre.writeUInt32LE(offA, 0); pre.writeUInt32LE(offB, 8);
    const hA = Buffer.alloc(16); hA.writeUInt32LE(n, 0); hA.writeUInt32LE(1, 4); hA.writeUInt32LE(55, 8); hA.writeUInt32LE(n, 12);
    let off = offB + 4 + 36 * n;
    const rowsB = tabB.map((t, i) => {
        const r = Buffer.alloc(36); r.writeUInt32LE(3, 0); t.content.copy(r, 4); r.writeUInt32LE(t.raw, 20); r.writeUInt32LE(blobs[i].length - 45, 24);
        r.writeUInt32LE(off, 28); r.writeUInt32LE(blobs[i].length, 32); off += blobs[i].length; return r;
    });
    const c1 = Buffer.alloc(4); c1.writeUInt32LE(n, 0);
    return { data: Buffer.concat([head, pre, hA, Buffer.concat(tabA), c1, Buffer.concat(rowsB), Buffer.concat(blobs)]), ids: idsLines.join('\n') + '\n' };
}
const iconPics = (w, h) => KEYS.map((k) => ({ name: 'MyVehicle_Avatar_Icon_V001_' + k + '.png', w, h }));
const fourSizes = () => { const out = []; [1008, 1305, 570, 735].forEach((sz) => ['blue', 'red'].forEach((c) => out.push({ name: sz + '_' + c + '.png', w: sz, h: sz }))); return out; };

/* ---------- wbm ---------- */
const mk = makeBundle();
{
    const b = W.selfTest(mk.data, mk.ids);
    assert.strictEqual(b.entries.length, 21);
    ok('a bundle in the car\'s layout parses, rebuilds byte for byte, and a picture survives');
    for (let i = 0; i < 5; i++) {
        const src = crypto.randomBytes(40000 + i * 1111); src.fill(7, 100, 5000);
        assert.strictEqual(Buffer.compare(W.lz4Decompress(W.lz4Compress(src), src.length), src), 0);
    }
    assert.strictEqual(Buffer.compare(W.lz4Decompress(W.lz4Compress(Buffer.alloc(100000, 9)), 100000), Buffer.alloc(100000, 9)), 0);
    ok('LZ4 round trips noise, runs and short input');
    const pic = picture(99), nb = new W.Bundle(b.build({ S05: pic }), mk.ids);
    assert.strictEqual(Buffer.compare(nb.rgba('S05'), pic), 0);
    assert.strictEqual(Buffer.compare(nb.rgba('S06'), b.rgba('S06')), 0);
    assert.strictEqual(Buffer.compare(nb.blob('S06'), b.blob('S06')), 0);
    ok('replacing one picture leaves the others\' bytes alone');
    const back = new W.Bundle(nb.build({ S05: b.blob('S05') }), mk.ids);
    assert.strictEqual(Buffer.compare(back.build({}), mk.data), 0);
    ok('putting a picture\'s own blob back restores the original file');
    assert.throws(() => new W.Bundle(Buffer.concat([mk.data, Buffer.from([1])]), mk.ids), /data after the last picture/);
    assert.throws(() => new W.Bundle(mk.data.slice(0, mk.data.length - 10), mk.ids));
    ok('a bundle of another layout is refused');
    const img = Buffer.alloc(4 * 4 * 4); for (let i = 0; i < img.length; i++) img[i] = i;
    const f = W.flipRows(img, 4, 4);
    assert.strictEqual(f.slice(0, 16).toString('hex'), img.slice(48, 64).toString('hex'));
    assert.strictEqual(Buffer.compare(W.flipRows(f, 4, 4), img), 0);
    const s = W.shrink(Buffer.alloc(8 * 8 * 4, 200), 8, 8, 2);
    assert.strictEqual(s.length, 16); assert.strictEqual(s[0], 200);
    const ramp = Buffer.alloc(10 * 1 * 4); for (let x = 0; x < 10; x++) ramp.fill(x * 10, x * 4, x * 4 + 4);
    const r4 = W.resize(ramp, 10, 1, 4, 1);                   // 2.5 old pixels each: 0,10,(20) -> 8; (20),30,40 -> 32; ...
    assert.deepStrictEqual([r4[0], r4[4], r4[8], r4[12]], [8, 32, 58, 82]);
    assert.strictEqual(Buffer.compare(W.resize(ramp, 10, 1, 10, 1), ramp), 0);
    const sq = picture(4, 100), pl = W.place(sq, 100, 84, 72, [1, 1, 82, 70]);
    assert.strictEqual(pl.length, 84 * 72 * 4);
    assert.strictEqual(pl[3], 0); assert.strictEqual(pl[(1 * 84 + 1) * 4 + 3], 255); assert.strictEqual(pl[(70 * 84 + 82) * 4 + 3], 255); assert.strictEqual(pl[(71 * 84 + 83) * 4 + 3], 0);
    const mid = (36 * 84 + 42) * 4, src = (50 * 100 + 50) * 4;       // the middle stays the middle
    assert.ok(Math.abs(pl[mid] - sq[src]) < 12 && Math.abs(pl[mid + 1] - sq[src + 1]) < 12);
    const p = W.png(Buffer.alloc(3 * 2 * 4, 255), 3, 2);
    assert.strictEqual(p.slice(1, 4).toString(), 'PNG'); assert.strictEqual(p.readUInt32BE(16), 3); assert.strictEqual(p.readUInt32BE(20), 2);
    assert.strictEqual(W.crc32(Buffer.from('123456789')), 0xcbf43926);
    ok('flip, resize, fitting into a frame, PNG and CRC');
    {
        const B = require(path.join(ROOT, 'tools', 'anh-dai-dien', 'boot.js'));
        const pic = picture(5, 100, 52);                       // not whole macroblocks: 112 x 64 with cropping
        const v = B.stillVideo(pic, 100, 52, { frames: 5 });
        assert.deepStrictEqual(B.h264Info(v), { w: 100, h: 52, level: 31, profile: 66, frames: 5 });
        const list = B.nals(v); assert.deepStrictEqual(list.map((x) => x.type), [7, 8, 5, 1, 1, 1, 1]);
        assert.strictEqual(list[2].end - list[2].start, 4 + 28 * 384 + 27 * 2 + 1);    // the header with the first type, 28 macroblocks of 384 bytes, 27 more types, the stop bit
        list.forEach((x) => { for (let i = x.start; i + 2 < x.end; i++) assert.ok(!(v[i] === 0 && v[i + 1] === 0 && v[i + 2] <= 2), 'a start code inside a unit at ' + i); });
        assert.strictEqual(B.h264Info(B.stillVideo(picture(1, 1920, 720), 1920, 720, { frames: 2, level: 31 })).level, 40);
        // the moving one: black first, every macroblock of the picture sent once in its turn, nothing in the still end
        const mv = B.openingVideo(pic, 100, 52, { frames: 30 }), mi = B.h264Info(mv), ml = B.nals(mv).filter((n) => n.type === 1 || n.type === 5);
        assert.strictEqual(mi.frames, 30); assert.strictEqual(mi.w, 100); assert.strictEqual(mi.h, 52);
        const size = (n) => n.end - n.start, mbs = 7 * 4;
        assert.ok(size(ml[0]) >= mbs * 384 && size(ml[0]) < mbs * 384 + 64);
        const sent = ml.slice(1).reduce((t, n) => t + Math.floor(size(n) / 384), 0); assert.strictEqual(sent, mbs);
        assert.ok(size(ml[1]) > 384 && size(ml[29]) < 16 && size(ml[26]) < 16);
        const bye = B.openingVideo(pic, 100, 52, { frames: 30, out: true }), bl = B.nals(bye).filter((n) => n.type === 1 || n.type === 5);
        assert.strictEqual(bl.slice(1).reduce((t, n) => t + Math.floor(size(n) / 384), 0), mbs); assert.ok(size(bl[29]) < 16);   // too many macroblocks for 3.1
        const png = W.png(pic, 100, 52), back = B.pngDecode(png);
        assert.strictEqual(back.w, 100); assert.strictEqual(Buffer.compare(back.rgba, pic), 0);
        assert.throws(() => B.pngInfo(Buffer.from('nope, not a picture at all, not a picture')), /not a PNG/);
        assert.throws(() => B.h264Info(Buffer.alloc(100)), /no SPS/);
        ok('the still video (headers, uncompressed macroblocks, skipped pictures) and the PNG reader');
    }
    if (process.env.AVATAR_REAL_RES) {
        const real = W.selfTest(fs.readFileSync(process.env.AVATAR_REAL_RES), fs.readFileSync(process.env.AVATAR_REAL_IDS, 'utf8'));
        assert.strictEqual(real.entries.length, 21);
        ok('the car\'s real bundle parses and rebuilds byte for byte');
    }
    if (process.env.AVATAR_REAL_TREE) {       // a folder of bundles copied from a car: every one this takes rebuilds byte for byte
        let seen = 0;
        const walk = (d) => fs.readdirSync(d).forEach((f) => {
            const p = path.join(d, f);
            if (fs.statSync(p).isDirectory()) return walk(p);
            if (f !== 'wbitmaps.res') return;
            let b = null;
            try { b = new W.Bundle(fs.readFileSync(p), fs.readFileSync(p + '.ids', 'utf8')); } catch (e) { return; }
            W.selfTest(b.data, fs.readFileSync(p + '.ids', 'utf8')); seen++;
        });
        walk(process.env.AVATAR_REAL_TREE);
        assert.ok(seen > 0);
        ok(seen + ' real bundles of other pictures parse and rebuild byte for byte');
    }
}

/* ---------- the service ---------- */
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'anh-'));
const root = path.join(tmp, 'assetDB'), state = path.join(tmp, 'state'), run = path.join(tmp, 'run'), legacy = path.join(tmp, 'legacy'), oap = path.join(tmp, 'oap');
const mkdirs = (d) => { if (!fs.existsSync(d)) { mkdirs(path.dirname(d)); fs.mkdirSync(d); } };
const put = (rel, b) => { const d = path.join(root, rel); mkdirs(d); fs.writeFileSync(path.join(d, 'wbitmaps.res'), b.data); fs.writeFileSync(path.join(d, 'wbitmaps.res.ids'), b.ids); return d; };
const AV = 'High/2D/Baukasten/ContentElements/illustrations/Static/Avatar/MyVehicle_Avatar';
const REPL = 'High/2D/Baukasten/ContentElements/illustrations/Replacement/4_sizes/';
const REG = 'icons/Class_regular/MyVehicle_Avatar', STA = 'icons/Class_status/MyVehicle_Avatar';
const mkReg = makeBundle(iconPics(84, 72)), mkSta = makeBundle(iconPics(72, 72)), mkBt = makeBundle(fourSizes());
const mkOdd = makeBundle(fourSizes().slice(0, 6));                 // a placeholder bundle with pictures missing: not offered
const dir = put(AV, mk); put(REG, mkReg); put(STA, mkSta);
put(REPL + 'replacement_media_wireless_bluetooth', mkBt); put(REPL + 'replacement_media_plug_usb', mkOdd);
mkdirs(legacy);
// the car's 2D pictures: per trim a picture and a paint mask (numbered one after the other), a big and a small bundle
const carPics = (w, h) => [7, 9].map((k) => ({ name: 'tex_vehicle_welcome_g05_trimA' + k + '_bitmap', w, h })).concat([8, 10].map((k) => ({ name: 'tex_vehicle_welcome_g05_trimA_mask' + k + '_bitmap', w, h })));
const mkBig = makeBundle(carPics(672, 336)), mkSmall = makeBundle(carPics(440, 222));
const vehicles = path.join(tmp, 'vehicles');
const putCar = (sub, b) => { const d = path.join(vehicles, 'G20', sub); mkdirs(d); fs.writeFileSync(path.join(d, 'bitmaps.res'), b.data); fs.writeFileSync(path.join(d, 'bitmaps.res.ids'), b.ids); };
putCar('vehicle2D_big', mkBig); putCar('vehicle2D_small', mkSmall); mkdirs(path.join(vehicles, 'G20', 'vehicle'));
// the start-up screen: a still picture and the two videos per size, for this head unit's generation and for another
const BOOT = require(path.join(ROOT, 'tools', 'anh-dai-dien', 'boot.js'));
const bootDir = path.join(tmp, 'animationplayer'), startFiles = {};
[['mgu18', 1280, 480, '0x02'], ['mgu18', 1440, 540, '0x03'], ['mgu21', 1920, 720, '0x06']].forEach((d) => {
    mkdirs(path.join(bootDir, d[0]));
    const pic = picture(d[1] & 31, d[1], d[2]);
    const put1 = (name, buf) => { fs.writeFileSync(path.join(bootDir, d[0], name), buf); startFiles[d[0] + '/' + name] = buf; };
    put1('eva_splash_0x00_0x0_' + d[3] + '_noloop.png', W.png(pic, d[1], d[2]));
    put1('eva_hi_0x00_0x0_' + d[3] + '_noloop.h264', BOOT.stillVideo(pic, d[1], d[2], { frames: 6 }));
    put1('eva_hi_0x00_0x0_' + d[3] + '_loop.h264', BOOT.stillVideo(pic, d[1], d[2], { frames: 6 }));
    put1('eva_bye_0x00_0x0_' + d[3] + '_noloop.h264', BOOT.stillVideo(pic, d[1], d[2], { frames: 4 }));
});
fs.writeFileSync(path.join(bootDir, 'mgu18', 'notes.txt'), 'x'); fs.writeFileSync(path.join(tmp, 'variant.env'), 'MGUVAR=high\nHWGEN=18\n');
const startFile = (rel) => fs.readFileSync(path.join(bootDir, rel));
// the 3D vehicle: effects (plain shader text) and textures in resource files of mixed kinds, as on the head unit
const { Res } = require(path.join(ROOT, 'tools', 'anh-dai-dien', 'res.js'));
const CAR3D = require(path.join(ROOT, 'tools', 'anh-dai-dien', 'car3d.js'));
function makeRes(list) {                       // [{ name, type, header, payload, dec, comp }]
    const head = Buffer.from('[RamsesVersion:19.0.14]\n[GitHash:test]\n', 'latin1'), n = list.length;
    const ids = [], tabA = [], hashes = [];
    list.forEach((x) => {
        const content = crypto.randomBytes(16), idHex = crypto.randomBytes(16).toString('hex');
        ids.push('0x' + idHex + ' ' + x.name); hashes.push(content);
        tabA.push(Buffer.concat([crypto.randomBytes(5 + (x.name.length % 7)), content, Buffer.from(idHex.slice(0, 16), 'hex').reverse(), Buffer.from(idHex.slice(16), 'hex').reverse(), crypto.randomBytes(9)]));
    });
    const A = Buffer.concat([Buffer.alloc(16)].concat(tabA)), offA = head.length + 16, offB = offA + A.length;
    const pre = Buffer.alloc(16); pre.writeUInt32LE(offA, 0); pre.writeUInt32LE(offB, 8);
    let off = offB + 4 + 36 * n;
    const rows = list.map((x, i) => {
        const blob = Buffer.concat([x.header, x.payload]), r = Buffer.alloc(36);
        r.writeUInt32LE(x.type, 0); hashes[i].copy(r, 4); r.writeUInt32LE(x.dec, 20); r.writeUInt32LE(x.comp, 24); r.writeUInt32LE(off, 28); r.writeUInt32LE(blob.length, 32); off += blob.length; return r;
    });
    const c = Buffer.alloc(4); c.writeUInt32LE(n, 0);
    return { data: Buffer.concat([head, pre, A, c].concat(rows, list.map((x) => Buffer.concat([x.header, x.payload])))), ids: ids.join('\n') + '\n' };
}
function effect(name, vertex, fragment) {
    const v = Buffer.from(vertex + '\0', 'latin1'), f = Buffer.from(fragment + '\0', 'latin1'), meta = crypto.randomBytes(40 + name.length);
    const h = Buffer.alloc(11 + 16 + meta.length + 4); h.writeUInt32LE(6, 0); h.writeUInt32LE(3, 4); h.write('shd', 8, 'latin1');
    h.writeUInt32LE(v.length + f.length, 19); h.writeInt32LE(-1, 23); meta.copy(h, 27); h.writeUInt32LE(v.length, h.length - 4);
    return { name, type: 6, header: h, payload: Buffer.concat([v, f]), dec: v.length + f.length, comp: 0 };
}
function texture(name, w, h, bpp, seed) {
    const raw = bpp === 4 ? picture(seed, w, h) : crypto.randomBytes(w * h * bpp), z = W.lz4Compress(raw);
    const hd = Buffer.alloc(45); hd.writeUInt32LE(3, 0); hd.writeUInt32LE(1, 8); hd.writeUInt32LE(z.length, 12); hd.writeUInt32LE(raw.length, 16); hd.writeInt32LE(-1, 20);
    hd.writeUInt32LE(w, 24); hd.writeUInt32LE(h, 28); hd.writeUInt32LE(bpp === 4 ? 9 : 1, 32); hd.writeUInt32LE(1, 36); hd.writeUInt32LE(raw.length, 40);
    return { name, type: 3, header: hd, payload: z, dec: raw.length, comp: z.length };
}
const VS = '#version 300 es\nin vec3 a_Position;\nin vec2 a_TextureCoordinate;\nuniform mat4 u_MVPMatrix;\nuniform vec3 u_CameraWorldPosition;\nout mediump vec2 uv;\nvoid main(void) {\n\tuv = a_TextureCoordinate + u_CameraWorldPosition.xy;\n\tgl_Position = u_MVPMatrix * vec4(a_Position, 1.);\n}';
const FS = '#version 300 es\nout mediump vec4 FragData[ 2 ];\nprecision mediump float;\nuniform lowp sampler2D DiffuseTex;\nuniform lowp float u_fadeToBlack;\nin mediump vec2 uv;\nvoid main(void) {\n\tFragData[0] = texture(DiffuseTex, uv) * u_fadeToBlack;\n\tFragData[1] = vec4(0.);\n}';
const QUAD = '#version 100\nattribute vec2 a_TextureCoordinate;\nvoid main(void) {\n\tgl_Position = vec4(sign(a_TextureCoordinate - vec2(0.5)), 0.0, 1.0);\n}';
const mkFx = makeRes([effect('M_CAR_MCP1_CARPAINT1', VS, FS), effect('M_CAR_MGRO_GROUND', VS, FS), effect('M_CAR_Quad_RL0', QUAD, FS.replace('300 es', '100')), effect('M_CAR_MWRM_WHEELRIM', VS, FS), effect('M_HMI_SAFEAREA', VS, FS)]);
const mkTx = makeRes([texture('TEX_MCP1_CARPAINT1_bitmap', 1024, 1024, 1, 0), texture('TEX_MGRO_GROUND_bitmap', 96, 32, 4, 9), texture('TEX_MLID_LIGHTDOOR_bitmap', 32, 32, 4, 2)]);
// the meshes: arrays of numbers; the body (the largest mesh painted MCP1) is known by its first eight vertices
function array(name, floats) { const p = Buffer.alloc(floats.length * 4); floats.forEach((v, i) => p.writeFloatLE(v, i * 4)); return { name, type: 1, header: crypto.randomBytes(32), payload: p, dec: p.length, comp: 0 }; }
const bodyAt = []; for (let i = 0; i < 30; i++) bodyAt.push(200 + i * 1.5, i % 3, 100 + (i % 5));
const mkMesh = makeRes([array('door', [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27]), array('body', bodyAt), array('wheel', [9, 9, 9, 8, 8, 8, 7, 7, 7])]);
const meshId = (name) => mkMesh.ids.split('\n').filter((l) => l.split(' ')[1] === name)[0].split(' ')[0];
const mkAttrs = JSON.stringify([{ mesh: 'meshes/AAL1DOOR__MCP1_1Shape.ctm', type: 'Vector3fArray', name: 'a_Position', count: '9', id: meshId('door') }, { mesh: 'meshes/BBBODY__MCP1_1Shape.ctm', type: 'Vector3fArray', name: 'a_Position', count: '10', id: meshId('body') },
    { mesh: 'meshes/BBBODY__MCP1_1Shape.ctm', type: 'UInt16Array', name: 'indexArray', count: '99', id: meshId('wheel') }, { mesh: 'meshes/CCWHEEL__MWRM_1Shape.ctm', type: 'Vector3fArray', name: 'a_Position', count: '300', id: meshId('wheel') }]);
const car3dDir = path.join(vehicles, 'G20', 'vehicle');
[['effects.res', mkFx], ['bitmaps.res', mkTx], ['meshes.res', mkMesh]].forEach((d) => { fs.writeFileSync(path.join(car3dDir, d[0]), d[1].data); fs.writeFileSync(path.join(car3dDir, d[0] + '.ids'), d[1].ids); });
fs.writeFileSync(path.join(car3dDir, 'meshes.res.attributes'), mkAttrs);
const shaderDir = path.join(tmp, 'shader-cache'); mkdirs(shaderDir);
const cached = CAR3D.cacheNames(new Res(mkFx.data, mkFx.ids)).concat(['00112233445566778899aabbccddeeff.bin']);
const fillCache = () => cached.forEach((f) => fs.writeFileSync(path.join(shaderDir, f), 'compiled'));
mkdirs(path.join(vehicles, 'F40', 'vehicle')); fs.writeFileSync(path.join(vehicles, 'F40', 'vehicle', 'effects.res'), 'not one');      // a model this does not know: left alone
const car3dFile = (name) => fs.readFileSync(path.join(car3dDir, name));
const carFile = (sub) => fs.readFileSync(path.join(vehicles, 'G20', sub, 'bitmaps.res'));
Object.assign(process.env, { AVATAR_NFT: path.join(tmp, 'no-nft'), AVATAR_FW_MS: '0', AVATAR_BOOT: bootDir, AVATAR_VARIANT: path.join(tmp, 'variant.env'), AVATAR_VEHICLES: vehicles, AVATAR_SHADERS: shaderDir, AVATAR_ROOT: root, AVATAR_MOUNT: '', AVATAR_STATE: state, AVATAR_RUN: run, AVATAR_LEGACY: legacy, AVATAR_OAP: oap, AVATAR_PORT: '0', AVATAR_IPS: '192.168.7.9', AVATAR_SCAN_MS: '0' });
const svc = require(path.join(ROOT, 'tools', 'anh-dai-dien', 'anh-dai-dien.js'));
const fileOf = (rel) => fs.readFileSync(path.join(root, rel, 'wbitmaps.res'));
const BT = svc.MORE0, USB = svc.MORE0 + 1;

function call(method, p, body) {
    return new Promise((resolve, reject) => {
        const r = http.request({ host: '127.0.0.1', port: svc.S.port, method, path: p, headers: body ? { 'Content-Length': body.length } : {} }, (res) => {
            const parts = []; res.on('data', (c) => parts.push(c)); res.on('end', () => {
                const b = Buffer.concat(parts); let j = null;
                if (/json/.test(res.headers['content-type'] || '')) j = JSON.parse(b.toString());
                resolve({ code: res.statusCode, json: j, body: b, type: res.headers['content-type'] });
            });
        });
        r.on('error', reject); r.end(body);
    });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const flip = (p, w) => W.flipRows(p, w || W.SIZE, w || W.SIZE);

(async () => {
    const server = svc.start();
    await sleep(300);
    const pin = svc.S.pin, q = '?pin=' + pin;
    assert.ok(svc.S.compatible, svc.S.error); assert.ok(svc.S.port > 0); assert.ok(svc.S.smallIcons);
    assert.strictEqual(Buffer.compare(fs.readFileSync(path.join(state, 'backup', 'wbitmaps.res.orig')), mk.data), 0);
    assert.strictEqual(Buffer.compare(fs.readFileSync(path.join(state, 'backup', 'avatar-status.res.orig')), mkSta.data), 0);
    assert.strictEqual(Buffer.compare(fs.readFileSync(path.join(state, 'backup', 'replacement_media_wireless_bluetooth.res.orig')), mkBt.data), 0);
    const st0 = JSON.parse(fs.readFileSync(path.join(run, 'status.json'), 'utf8'));
    assert.strictEqual(st0.url, 'http://192.168.7.9:' + svc.S.port + '/?pin=' + pin);
    assert.strictEqual(st0.slots.length, 15); assert.ok(!st0.slots.some((s) => s.changed)); assert.strictEqual(st0.anyChanged, false);
    assert.deepStrictEqual(st0.more, [{ n: svc.CAR, changed: false, label: 'Hình xe' }, { n: svc.START, changed: false, label: 'Khởi động' }, { n: BT, changed: false, label: 'Nhạc Bluetooth' }]);     // the USB bundle is not what is expected, the others are not on this car
    assert.strictEqual(fs.statSync(path.join(run, 't01.rgba')).size, 96 * 96 * 4);
    assert.ok(!fs.existsSync(path.join(state, 'backup', 'replacement_media_plug_usb.res.orig')));
    ok('starts, keeps every bundle\'s original, tells the app the address, the PIN, 15 pictures and the placeholders this car has');

    let r = await call('GET', '/');
    assert.strictEqual(r.code, 200); assert.ok(/<title>/.test(r.body.toString()));
    r = await call('GET', '/api/state'); assert.strictEqual(r.code, 401);
    r = await call('GET', '/api/state?pin=' + (pin === '1234' ? '4321' : '1234')); assert.strictEqual(r.code, 401);
    r = await call('GET', '/api/state' + q); assert.strictEqual(r.code, 200); assert.strictEqual(r.json.slots.length, 15);
    assert.strictEqual(r.json.slots[0].size, 570); assert.strictEqual(r.json.more[0].size, 1305); assert.ok(r.json.more[0].where);
    assert.strictEqual(r.json.more.length, 1); assert.strictEqual(r.json.car.length, 1); assert.ok(r.json.car[0].alpha); assert.strictEqual(r.json.car[0].w, 1920); assert.strictEqual(r.json.car[0].h, 960);
    r = await call('GET', '/api/thumb/' + svc.CAR + q); assert.strictEqual(r.body.readUInt32BE(20), 256);
    r = await call('GET', '/api/thumb/4' + q); assert.strictEqual(r.code, 200); assert.strictEqual(r.type, 'image/png'); assert.strictEqual(r.body.readUInt32BE(16), 256);
    r = await call('GET', '/api/thumb/' + BT + q); assert.strictEqual(r.code, 200); assert.strictEqual(r.body.readUInt32BE(16), 256);
    r = await call('GET', '/api/thumb/16' + q); assert.strictEqual(r.code, 404);
    ok('the page is open; the API needs the PIN; thumbnails are PNG');

    const up = picture(50);        // top-down, as the phone sends
    r = await call('POST', '/api/picture/3' + q, up); assert.strictEqual(r.code, 200, JSON.stringify(r.json));
    let now = new W.Bundle(fileOf(AV), mk.ids);
    assert.strictEqual(Buffer.compare(now.rgba('S03'), flip(up)), 0);
    assert.strictEqual(Buffer.compare(now.blob('S04'), new W.Bundle(mk.data, mk.ids).blob('S04')), 0);
    assert.ok(!fs.existsSync(path.join(dir, 'wbitmaps.res.new')));
    // the two icons of the same picture: the photo inside the frame the car's own icons have, nothing else touched
    const reg = new W.Bundle(fileOf(REG), mkReg.ids), sta = new W.Bundle(fileOf(STA), mkSta.ids);
    assert.strictEqual(Buffer.compare(reg.rgba('S03'), W.flipRows(W.place(up, 570, 84, 72, [1, 1, 82, 70]), 84, 72)), 0);
    assert.strictEqual(Buffer.compare(sta.rgba('S03'), W.flipRows(W.place(up, 570, 72, 72, [9, 9, 54, 54]), 72, 72)), 0);
    const staTop = W.flipRows(sta.rgba('S03'), 72, 72);
    assert.strictEqual(staTop[3], 0); assert.strictEqual(staTop[(9 * 72 + 9) * 4 + 3], 255); assert.strictEqual(staTop[(63 * 72 + 63) * 4 + 3], 0);
    assert.strictEqual(Buffer.compare(reg.blob('S04'), new W.Bundle(mkReg.data, mkReg.ids).blob('S04')), 0);
    assert.strictEqual(Buffer.compare(fileOf(REPL + 'replacement_media_wireless_bluetooth'), mkBt.data), 0);
    r = await call('GET', '/api/state' + q);
    assert.deepStrictEqual(r.json.slots.filter((s) => s.changed).map((s) => s.n), [3]); assert.ok(r.json.needsRestart); assert.ok(r.json.anyChanged);
    ok('a profile picture goes into the picker\'s bundle and both icon bundles, nothing else moves, no temp file is left');

    r = await call('POST', '/api/picture/16' + q, up); assert.strictEqual(r.code, 400);
    r = await call('POST', '/api/picture/0' + q, up); assert.strictEqual(r.code, 400);
    r = await call('POST', '/api/picture/' + USB + q, up); assert.strictEqual(r.code, 400);
    r = await call('POST', '/api/picture/3' + q, up.slice(0, 1000)); assert.strictEqual(r.code, 400);
    r = await call('POST', '/api/picture/' + BT + q, up); assert.strictEqual(r.code, 400);            // a placeholder wants 1305x1305
    r = await call('POST', '/api/picture/3' + q, Buffer.concat([up, Buffer.alloc(8)])); assert.strictEqual(r.code, 413);
    assert.strictEqual(Buffer.compare(fileOf(AV), now.data), 0);
    ok('wrong slot, wrong size and oversized uploads are refused without touching the files');

    // two at once are done one after the other
    const two = await Promise.all([call('POST', '/api/picture/5' + q, picture(61)), call('POST', '/api/picture/6' + q, picture(62))]);
    assert.ok(two.every((x) => x.code === 200));
    now = new W.Bundle(fileOf(AV), mk.ids);
    assert.strictEqual(Buffer.compare(now.rgba('S05'), flip(picture(61))), 0);
    assert.strictEqual(Buffer.compare(now.rgba('S06'), flip(picture(62))), 0);
    assert.strictEqual(Buffer.compare(now.rgba('S03'), flip(up)), 0);
    ok('two uploads at once both land');

    // a placeholder: one photo into the four sizes, both colours
    const cover = picture(77, 1305);
    r = await call('POST', '/api/picture/' + BT + q, cover); assert.strictEqual(r.code, 200, JSON.stringify(r.json));
    const bt = new W.Bundle(fileOf(REPL + 'replacement_media_wireless_bluetooth'), mkBt.ids);
    assert.strictEqual(Buffer.compare(bt.rgba('1305_blue'), flip(cover, 1305)), 0);
    assert.strictEqual(Buffer.compare(bt.rgba('1305_red'), flip(cover, 1305)), 0);
    [570, 735, 1008].forEach((sz) => ['blue', 'red'].forEach((c) => assert.strictEqual(Buffer.compare(bt.rgba(sz + '_' + c), flip(W.resize(cover, 1305, 1305, sz, sz), sz)), 0, sz + c)));
    r = await call('GET', '/api/state' + q); assert.ok(r.json.more[0].changed);
    ok('a placeholder picture goes into all four sizes and both colours of its bundle');

    // the car: the 3D model's materials hidden and its body a picture facing the camera, the photo packed into the
    // body's one-channel texture; the 2D pictures the photo too; the head unit's compiled shaders for the model removed
    const CW = svc.CAR_W, CH = 960, cut = picture(31, CW, CH);
    for (let y = 0; y < CH; y++) for (let x = 0; x < CW; x++) { const d = Math.hypot((x - CW / 2) / (CW / 2), (y - CH / 2) / (CH / 2)); cut[(y * CW + x) * 4 + 3] = d < 0.7 ? 255 : d < 0.9 ? 128 : 0; }
    r = await call('GET', '/api/state' + q); assert.strictEqual(r.json.car[0].h, 960); assert.ok(/màn hình chính và trong menu/.test(r.json.car[0].where));
    fillCache();
    r = await call('POST', '/api/picture/' + svc.CAR + q, cut); assert.strictEqual(r.code, 200, JSON.stringify(r.json));
    let fx = new Res(car3dFile('effects.res'), mkFx.ids), tx = new Res(car3dFile('bitmaps.res'), mkTx.ids);
    assert.ok(/gl_Position = vec4\(2\., 2\., 2\., 1\.\);\n\}$/.test(fx.shaders('M_CAR_MGRO_GROUND').vertex) && /vec4\(2\., 2\./.test(fx.shaders('M_CAR_MWRM_WHEELRIM').vertex));
    assert.strictEqual(fx.shaders('M_CAR_MGRO_GROUND').fragment, FS);
    assert.strictEqual(fx.shaders('M_CAR_Quad_RL0').vertex, QUAD); assert.strictEqual(fx.shaders('M_HMI_SAFEAREA').vertex, VS);
    const body = fx.shaders('M_CAR_MCP1_CARPAINT1');
    assert.ok(/out mediump vec2 pc_uv;\nvoid main/.test(body.vertex) && /vec3 pc_m = vec3\(150\., 0\., 51\.5\);/.test(body.vertex) && /vec2\(200\., 100\.\)/.test(body.vertex) && /u_CameraWorldPosition\.z < 0\.\) pc_i = -1;/.test(body.vertex));
    assert.strictEqual(body.vertex.split('distance(a_Position, vec3(').length, 9);                       // the body mesh's first eight vertices, not the door's or the wheel's
    assert.ok(/vec3\(200\., 0\., 100\.\)\) < 0\.03\) pc_i = 0;/.test(body.vertex) && /vec3\(210\.5, 1\., 102\.\)\) < 0\.03\) pc_i = 2;/.test(body.vertex));
    assert.ok(/in mediump vec2 pc_uv;\nvoid main/.test(body.fragment) && /discard;/.test(body.fragment) && /if \(u_fadeToBlack < 2\.\) FragData\[0\] = vec4\(pc_o, 1\.\);\n\}$/.test(body.fragment));
    const photo = W.fit(svc.feather(cut, CW, CH), CW, CH, CAR3D.PW, CAR3D.PH), packed = tx.payload('TEX_MCP1_CARPAINT1_bitmap');
    assert.strictEqual(Buffer.compare(packed, CAR3D.pack(photo)), 0);
    {   // what the shader reads back is the photo: brightness in the upper half, colour differences and transparency below
        const at = (x, y) => (y * CAR3D.PW + x) * 4, x = 512, y = 256, i = at(x, y);
        const L = packed[(1023 - y) * 1024 + x], cb = packed[(255 - (y >> 1)) * 1024 + (x >> 1)] - 128, cr = packed[(255 - (y >> 1)) * 1024 + 512 + (x >> 1)] - 128, al = packed[(511 - (y >> 1)) * 1024 + (x >> 1)];
        assert.ok(Math.abs(L + 1.402 * cr - photo[i]) < 40 && Math.abs(L - 0.344136 * cb - 0.714136 * cr - photo[i + 1]) < 40 && Math.abs(L + 1.772 * cb - photo[i + 2]) < 40);
        assert.strictEqual(al, 255); assert.strictEqual(packed[511 * 1024], 0);                           // opaque in the middle, nothing in the corner
    }
    const tx0 = new Res(mkTx.data, mkTx.ids);
    ['TEX_MGRO_GROUND_bitmap', 'TEX_MLID_LIGHTDOOR_bitmap'].forEach((k) => assert.strictEqual(Buffer.compare(tx.blob(k), tx0.blob(k)), 0, k));
    assert.strictEqual(Buffer.compare(car3dFile('meshes.res'), mkMesh.data), 0);
    assert.strictEqual(fs.readFileSync(path.join(vehicles, 'F40', 'vehicle', 'effects.res'), 'utf8'), 'not one');
    assert.deepStrictEqual(fs.readdirSync(shaderDir), ['00112233445566778899aabbccddeeff.bin']);          // the model's compiled shaders are gone, others stay
    {   // the 2D pictures: every trim the photo, every paint mask empty
        const big = new W.Bundle(carFile('vehicle2D_big'), mkBig.ids), small = new W.Bundle(carFile('vehicle2D_small'), mkSmall.ids);
        const want = W.flipRows(svc.premultiply(W.fit(svc.feather(cut, CW, CH), CW, CH, 672, 336)), 672, 336);
        [7, 9].forEach((k) => assert.strictEqual(Buffer.compare(big.rgba('tex_vehicle_welcome_g05_trimA' + k + '_bitmap'), want), 0));
        [8, 10].forEach((k) => assert.ok(big.rgba('tex_vehicle_welcome_g05_trimA_mask' + k + '_bitmap').every((v) => v === 0)));
        assert.ok(small.rgba('tex_vehicle_welcome_g05_trimA_mask8_bitmap').every((v) => v === 0) && !small.rgba('tex_vehicle_welcome_g05_trimA7_bitmap').every((v) => v === 0));
    }
    r = await call('GET', '/api/state' + q); assert.ok(r.json.car[0].changed && r.json.anyChanged);
    r = await call('GET', '/api/thumb/' + svc.CAR + q); assert.strictEqual(r.code, 200);
    // a second photo starts from the originals again, not from the changed files
    r = await call('POST', '/api/picture/' + svc.CAR + q, picture(32, CW, CH)); assert.strictEqual(r.code, 200);
    fx = new Res(car3dFile('effects.res'), mkFx.ids);
    assert.strictEqual(fx.shaders('M_CAR_MGRO_GROUND').vertex.split('vec4(2., 2.').length, 2); assert.strictEqual(fx.shaders('M_CAR_MCP1_CARPAINT1').vertex.split('pc_m =').length, 2);
    fillCache();
    r = await call('POST', '/api/restore/' + svc.CAR + q); assert.strictEqual(r.code, 200);
    assert.strictEqual(Buffer.compare(car3dFile('effects.res'), mkFx.data), 0); assert.strictEqual(Buffer.compare(car3dFile('bitmaps.res'), mkTx.data), 0);
    assert.strictEqual(Buffer.compare(carFile('vehicle2D_big'), mkBig.data), 0); assert.strictEqual(Buffer.compare(carFile('vehicle2D_small'), mkSmall.data), 0);
    assert.deepStrictEqual(fs.readdirSync(shaderDir), ['00112233445566778899aabbccddeeff.bin']);
    r = await call('GET', '/api/state' + q); assert.ok(!r.json.car[0].changed);
    await call('POST', '/api/picture/' + svc.CAR + q, cut);
    ok('the car: the 3D model hidden and its body a picture of the photo, the 2D pictures the photo, compiled shaders removed, all restored byte for byte');

    // the start-up screen: the picture and a still video at every size of this generation, the other generation untouched
    const sp = picture(41, 1920, 720);
    r = await call('GET', '/api/state' + q); assert.strictEqual(r.json.start.length, 1); assert.strictEqual(r.json.start[0].w, 1920); assert.ok(!r.json.start[0].changed);
    r = await call('POST', '/api/picture/' + svc.START + q, sp); assert.strictEqual(r.code, 200, JSON.stringify(r.json));
    [[1280, 480, '0x02'], [1440, 540, '0x03']].forEach((d) => {
        const want = W.fit(sp, 1920, 720, d[0], d[1]);
        const png = BOOT.pngDecode(startFile('mgu18/eva_splash_0x00_0x0_' + d[2] + '_noloop.png'));
        assert.strictEqual(png.w, d[0]); assert.strictEqual(Buffer.compare(png.rgba, want), 0);
        const hi = startFile('mgu18/eva_hi_0x00_0x0_' + d[2] + '_noloop.h264');
        assert.deepStrictEqual(BOOT.h264Info(hi), { w: d[0], h: d[1], level: 31, profile: 66, frames: 6 });
        assert.strictEqual(Buffer.compare(hi, BOOT.stillVideo(want, d[0], d[1], { frames: 6, level: 31 })), 0);
        assert.strictEqual(BOOT.h264Info(startFile('mgu18/eva_bye_0x00_0x0_' + d[2] + '_noloop.h264')).frames, 4);
        // the loop and the no-loop video are the same bytes: one file on the disk
        assert.strictEqual(fs.statSync(path.join(bootDir, 'mgu18', 'eva_hi_0x00_0x0_' + d[2] + '_loop.h264')).ino, fs.statSync(path.join(bootDir, 'mgu18', 'eva_hi_0x00_0x0_' + d[2] + '_noloop.h264')).ino);
    });
    Object.keys(startFiles).filter((k) => /^mgu21/.test(k)).forEach((k) => assert.strictEqual(Buffer.compare(startFile(k), startFiles[k]), 0, k));
    assert.strictEqual(fs.readFileSync(path.join(bootDir, 'mgu18', 'notes.txt'), 'utf8'), 'x');
    assert.ok(!fs.readdirSync(path.join(bootDir, 'mgu18')).some((f) => /\.new$/.test(f)));
    r = await call('GET', '/api/state' + q); assert.ok(r.json.start[0].changed && r.json.anyChanged);
    r = await call('POST', '/api/picture/' + svc.START + q, picture(42, 1920, 720)); assert.strictEqual(r.code, 200);   // a second time: over the links
    r = await call('POST', '/api/restore/' + svc.START + q); assert.strictEqual(r.code, 200);
    Object.keys(startFiles).forEach((k) => assert.strictEqual(Buffer.compare(startFile(k), startFiles[k]), 0, k));
    r = await call('GET', '/api/state' + q); assert.ok(!r.json.start[0].changed);
    await call('POST', '/api/picture/' + svc.START + q, sp);
    ok('the start-up screen: the picture and a still video at every size, same bytes linked, another generation untouched, restored byte for byte');

    r = await call('POST', '/api/restore/3' + q); assert.strictEqual(r.code, 200);
    now = new W.Bundle(fileOf(AV), mk.ids);
    assert.strictEqual(Buffer.compare(now.blob('S03'), new W.Bundle(mk.data, mk.ids).blob('S03')), 0);
    assert.strictEqual(Buffer.compare(now.rgba('S05'), flip(picture(61))), 0);
    assert.strictEqual(Buffer.compare(new W.Bundle(fileOf(STA), mkSta.ids).blob('S03'), new W.Bundle(mkSta.data, mkSta.ids).blob('S03')), 0);
    r = await call('GET', '/api/state' + q); assert.deepStrictEqual(r.json.slots.filter((s) => s.changed).map((s) => s.n), [5, 6]);
    r = await call('POST', '/api/restore/' + BT + q); assert.strictEqual(r.code, 200);
    assert.strictEqual(Buffer.compare(fileOf(REPL + 'replacement_media_wireless_bluetooth'), mkBt.data), 0);
    await call('POST', '/api/picture/' + BT + q, cover);
    r = await call('POST', '/api/restore/all' + q); assert.strictEqual(r.code, 200);
    assert.strictEqual(Buffer.compare(fileOf(AV), mk.data), 0); assert.strictEqual(Buffer.compare(fileOf(REG), mkReg.data), 0);
    assert.strictEqual(Buffer.compare(fileOf(STA), mkSta.data), 0); assert.strictEqual(Buffer.compare(fileOf(REPL + 'replacement_media_wireless_bluetooth'), mkBt.data), 0);
    assert.strictEqual(Buffer.compare(carFile('vehicle2D_big'), mkBig.data), 0); assert.strictEqual(Buffer.compare(carFile('vehicle2D_small'), mkSmall.data), 0);
    Object.keys(startFiles).forEach((k) => assert.strictEqual(Buffer.compare(startFile(k), startFiles[k]), 0, k));
    r = await call('GET', '/api/state' + q); assert.ok(!r.json.slots.some((s) => s.changed) && !r.json.more.some((s) => s.changed) && !r.json.car[0].changed && !r.json.start[0].changed && !r.json.anyChanged);
    ok('restoring one picture, then all, brings back every original file byte for byte');

    // the app's commands: only what was written after the start counts
    const app = path.join(oap, 'oap_77'); fs.mkdirSync(path.join(app, 'source', 'javascript', 'kit'), { recursive: true }); fs.mkdirSync(path.join(app, 'data'));
    fs.writeFileSync(path.join(app, 'source', 'javascript', 'kit', 'app-spec.json'), JSON.stringify({ id: 'anh_dai_dien' }));
    fs.writeFileSync(path.join(app, 'data', 'command.json'), JSON.stringify({ id: 5, cmd: 'new_pin' }));
    svc.pollCommands(); const pin0 = svc.S.pin; svc.pollCommands();
    assert.strictEqual(svc.S.pin, pin0);                      // the first look only learns the old command
    await call('POST', '/api/picture/9?pin=' + svc.S.pin, picture(70));
    fs.writeFileSync(path.join(app, 'data', 'command.json'), JSON.stringify({ id: 6, cmd: 'new_pin' }));
    svc.pollCommands(); assert.notStrictEqual(svc.S.pin, pin0); assert.ok(/^\d{4}$/.test(svc.S.pin));
    fs.writeFileSync(path.join(app, 'data', 'command.json'), JSON.stringify({ id: 7, cmd: 'restore_all' }));
    svc.pollCommands(); await sleep(400);
    assert.strictEqual(Buffer.compare(fileOf(AV), mk.data), 0); assert.strictEqual(Buffer.compare(fileOf(REG), mkReg.data), 0);
    ok('the app\'s commands: an old one is ignored, a new PIN, restore all');

    // the address for the QR code: the default route's interface first; the app can ask for the next one
    {
        const os2 = require('os'), real = os2.networkInterfaces, ips0 = svc.CFG.ips, rt = path.join(tmp, 'route');
        os2.networkInterfaces = () => ({ lo: [{ address: '127.0.0.1', family: 'IPv4', internal: true }], vlan73: [{ address: '192.168.73.1', family: 'IPv4', internal: false }],
            usb0: [{ address: '169.254.213.49', family: 'IPv4', internal: false }], wlan0: [{ address: '172.16.222.97', family: 'IPv4', internal: false }], eth9: [{ address: '10.1.2.3', family: 'IPv4', internal: false }] });
        fs.writeFileSync(rt, 'Iface\tDestination\tGateway \tFlags\tRefCnt\tUse\tMetric\tMask\t\tMTU\tWindow\tIRTT\nvlan73\t0049A8C0\t00000000\t0001\t0\t0\t0\t00FFFFFF\t0\t0\t0\neth9\t00000000\t0102010A\t0003\t0\t0\t600\t00000000\t0\t0\t0\nwlan0\t00000000\t01DE10AC\t0003\t0\t0\t300\t00000000\t0\t0\t0\n');
        svc.CFG.ips = ''; svc.CFG.route = rt;
        assert.deepStrictEqual(svc.addresses(), ['172.16.222.97', '192.168.73.1', '10.1.2.3']);
        svc.CFG.route = path.join(tmp, 'no-route');
        assert.deepStrictEqual(svc.addresses(), ['172.16.222.97', '192.168.73.1', '10.1.2.3']);      // no route table: Wi-Fi first
        assert.ok(/172\.16\.222\.97/.test(svc.writeStatus().url));
        fs.writeFileSync(path.join(app, 'data', 'command.json'), JSON.stringify({ id: 8, cmd: 'next_ip' })); svc.pollCommands();
        const st3 = svc.writeStatus(); assert.ok(/192\.168\.73\.1/.test(st3.url)); assert.strictEqual(st3.ipIndex, 1);
        os2.networkInterfaces = real; svc.CFG.ips = ips0; svc.S.ipIndex = 0;
        ok('the QR code\'s address: the default route\'s interface first, then Wi-Fi; the app can step to the next');
    }

    // the firewall: one tagged rule at the top of the head unit's input chain, replaced when it is not the one wanted, removed at the end
    {
        let rules = ['ct state established,related accept', 'iifname "lo" accept'], handle = 10, calls = [];
        const hs = {}; rules.forEach((r) => { hs[r] = ++handle; });
        const nft = async (args) => {
            calls.push(args.join(' '));
            if (args[1] === 'list') return 'table ip filter {\n\tchain input { # handle 1\n\t\ttype filter hook input priority 0; policy drop;\n' + rules.map((r) => '\t\t' + r + ' # handle ' + hs[r]).join('\n') + '\n\t}\n}\n';
            if (args[0] === 'insert') { const r = args.slice(5).join(' '); hs[r] = ++handle; rules.unshift(r); return ''; }
            if (args[0] === 'delete') { rules = rules.filter((r) => String(hs[r]) !== args[6]); return ''; }
            throw new Error('unexpected ' + args.join(' '));
        };
        assert.strictEqual(await svc.fwEnsure(8137, 'wlan_bridge', nft), 'added');
        assert.strictEqual(rules[0], 'iifname "wlan_bridge" tcp dport 8137 accept comment "id-studio"'); assert.strictEqual(rules.length, 3);
        assert.strictEqual(await svc.fwEnsure(8137, 'wlan_bridge', nft), 'kept');
        rules.push(rules.shift());                                   // a ruleset change put another rule before it
        assert.strictEqual(await svc.fwEnsure(8137, 'wlan_bridge', nft), 'added'); assert.strictEqual(rules.length, 3); assert.ok(/id-studio/.test(rules[0]));
        assert.strictEqual(await svc.fwEnsure(8137, 'wlan0', nft), 'added'); assert.strictEqual(rules.filter((r) => /id-studio/.test(r)).length, 1); assert.ok(/"wlan0"/.test(rules[0]));
        assert.strictEqual(await svc.fwEnsure(8138, '', nft), 'added'); assert.strictEqual(rules[0], 'tcp dport 8138 accept comment "id-studio"');
        assert.strictEqual(await svc.fwClose(nft), 'closed'); assert.deepStrictEqual(rules, ['ct state established,related accept', 'iifname "lo" accept']);
        const none = async () => { const e = new Error('no chain'); e.absent = true; throw e; };
        assert.strictEqual(await svc.fwEnsure(8137, 'x', none), 'absent'); assert.strictEqual(await svc.fwClose(none), 'absent');
        assert.strictEqual(await svc.fwEnsure(8137, 'x'), 'absent');       // no nft program at all (this machine)
        ok('the firewall rule: added at the top, kept, put back, moved to another interface, removed; nothing without nftables');
    }

    // five wrong PINs lock the address
    const wrong = svc.S.pin === '1111' ? '2222' : '1111';
    for (let i = 0; i < 5; i++) await call('GET', '/api/state?pin=' + wrong);
    r = await call('GET', '/api/state?pin=' + svc.S.pin); assert.strictEqual(r.code, 429);
    ok('five wrong PINs lock the address for a minute');

    server.close();
    ok('the server stops');

    // a profile bundle of another layout is reported and never written
    const odd = fs.mkdtempSync(path.join(os.tmpdir(), 'anh-odd-'));
    fs.writeFileSync(path.join(odd, 'wbitmaps.res'), Buffer.concat([mk.data, Buffer.from('x')])); fs.writeFileSync(path.join(odd, 'wbitmaps.res.ids'), mk.ids);
    Object.assign(svc.CFG, { dir: odd, state: path.join(odd, 'st'), root: path.join(odd, 'none'), vehicles: path.join(odd, 'none'), boot: path.join(odd, 'none') });
    assert.strictEqual(svc.load(), false); assert.ok(/cấu trúc lạ/.test(svc.S.error)); assert.strictEqual(svc.S.compatible, false);
    await assert.rejects(() => svc.setPicture(1, picture(1)), /cấu trúc lạ|không dùng được/);
    assert.strictEqual(fs.readFileSync(path.join(odd, 'wbitmaps.res')).length, mk.data.length + 1);
    ok('a bundle of another layout is reported and never written');

    // the car as it is today: the picker's bundle changed by hand, the owner's own copy of the original beside it, no icon bundles
    const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'anh-leg-')), leg2 = fs.mkdtempSync(path.join(os.tmpdir(), 'anh-leg2-'));
    const mod = makeBundle();
    const orig = new W.Bundle(mod.data, mod.ids);
    fs.writeFileSync(path.join(dir2, 'wbitmaps.res'), orig.build({ S01: picture(3) })); fs.writeFileSync(path.join(dir2, 'wbitmaps.res.ids'), mod.ids);
    fs.writeFileSync(path.join(leg2, 'wbitmaps.res.orig'), mod.data);
    Object.assign(svc.CFG, { dir: dir2, state: path.join(dir2, 'st'), legacy: leg2 });
    assert.ok(svc.load()); assert.strictEqual(svc.S.smallIcons, false);
    assert.strictEqual(Buffer.compare(fs.readFileSync(path.join(dir2, 'st', 'backup', 'wbitmaps.res.orig')), mod.data), 0);
    assert.ok(/tay/.test(svc.S.backupNote));
    const st2 = svc.writeStatus(); assert.deepStrictEqual(st2.slots.filter((s) => s.changed).map((s) => s.n), [1]); assert.deepStrictEqual(st2.more, []);
    await svc.setPicture(2, picture(8));                     // without the icon bundles the picker's picture still changes
    await svc.restore('all');
    assert.strictEqual(Buffer.compare(fs.readFileSync(path.join(dir2, 'wbitmaps.res')), mod.data), 0);
    ok('the owner\'s hand-made backup is the original, even when the bundle now on the car is changed');

    // a head unit with the 2D pictures only: the car's slot still sets those
    {
        const veh2 = fs.mkdtempSync(path.join(os.tmpdir(), 'anh-2d-')), st2d = path.join(veh2, 'st');
        const put2 = (sub, b) => { const d = path.join(veh2, 'G20', sub); mkdirs(d); fs.writeFileSync(path.join(d, 'bitmaps.res'), b.data); fs.writeFileSync(path.join(d, 'bitmaps.res.ids'), b.ids); };
        put2('vehicle2D_big', mkBig); put2('vehicle2D_small', mkSmall);
        Object.assign(svc.CFG, { vehicles: veh2, state: st2d, boot: path.join(veh2, 'none') });
        assert.ok(svc.load());
        const slot = svc.S.slots[svc.CAR]; assert.ok(slot && slot.models.length === 0 && /^ở ô xe ngoài màn hình chính$/.test(slot.where));
        await svc.setPicture(svc.CAR, picture(77, svc.CAR_W, 960));
        assert.notStrictEqual(Buffer.compare(fs.readFileSync(path.join(veh2, 'G20', 'vehicle2D_big', 'bitmaps.res')), mkBig.data), 0);
        assert.ok(svc.writeStatus().anyChanged); assert.ok(svc.load()); assert.ok(svc.writeStatus().anyChanged);      // and it stays after a restart
        await svc.restore(svc.CAR);
        assert.strictEqual(Buffer.compare(fs.readFileSync(path.join(veh2, 'G20', 'vehicle2D_big', 'bitmaps.res')), mkBig.data), 0);
        assert.strictEqual(Buffer.compare(fs.readFileSync(path.join(veh2, 'G20', 'vehicle2D_small', 'bitmaps.res')), mkSmall.data), 0);
        assert.ok(!svc.writeStatus().anyChanged);
        ok('without a 3D model the car\'s slot sets the 2D pictures, and they stay');
    }

    /* ---------- the car screen ---------- */
    const load = Module._load;       // the app finds the kit as ./kit/...: here it is the repository's
    Module._load = function (request, parent, isMain) { return load.call(this, /^\.\/kit\//.test(request) ? path.join(ROOT, 'kit', 'runtime', request.slice(6)) : request, parent, isMain); };
    const UI = require(path.join(ROOT, 'apps', 'anh_dai_dien', 'ui.js'));
    const G = require(path.join(ROOT, 'kit', 'runtime', 'gauges.js'));
    const { Canvas } = require(path.join(ROOT, 'kit', 'runtime', 'canvas.js'));
    const { Recorder, play } = require(path.join(ROOT, 'kit', 'runtime', 'record.js'));
    const themes = require(path.join(ROOT, 'kit', 'runtime', 'themes.js'));
    const theme = themes.theme(themes.ids ? (Array.isArray(themes.ids) ? themes.ids[0] : themes.ids()[0]) : undefined);
    const thumbs = {}; for (let i = 1; i <= 15; i++) thumbs[i] = Buffer.alloc(UI.SMALL * UI.SMALL * 4, 40 + i * 10);
    const slots = Array.from({ length: 15 }, (_, i) => ({ n: i + 1, changed: i === 2 }));
    const more = [{ n: 21, label: 'Nhạc Bluetooth', changed: true }, { n: 22, label: 'Nhạc USB', changed: false }];
    const base = { state: 'ok', ipCount: 2, ipIndex: 1, url: 'http://192.168.7.9:8137/?pin=4821', host: '192.168.7.9:8137', pin: '4821', slots, more, thumbs, anyChanged: true };
    const draws = [base, Object.assign({}, base, { busy: true }), Object.assign({}, base, { url: '' }), { state: 'down', slots: [], thumbs: {} }, { state: 'bad', error: 'x', slots: [], thumbs: {} }];
    draws.forEach((v) => {
        const rec = new Recorder(UI.W, UI.H, { textScale: 1 }); rec.own = true;
        UI.draw(rec, G, theme, v, {});
        const cv = new Canvas(UI.W, UI.H); play(rec.words(), cv);
    });
    const rec = new Recorder(UI.W, UI.H, { textScale: 1 }); rec.own = true; UI.draw(rec, G, theme, base, {});
    assert.ok(rec.targets.some((t) => t.key === 'adRestore') && rec.targets.some((t) => t.key === 'adPin') && rec.targets.some((t) => t.key === 'adIp'));
    const none = new Recorder(UI.W, UI.H, { textScale: 1 }); none.own = true; UI.draw(none, G, theme, Object.assign({}, base, { anyChanged: false }), {});
    assert.ok(!none.targets.some((t) => t.key === 'adRestore'));
    ok('the car screen draws in every state; "restore all" is a button only when something changed');

    console.log('\nall ' + n + ' passed');
    process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
