'use strict';
/**
 * Tests of Ảnh đại diện: the bundle reader/writer (tools/anh-dai-dien/wbm.js) on a bundle made here in the
 * layout of the car's wbitmaps.res, the service end to end over HTTP (PIN, upload, restore, backup, the app's
 * commands, a bundle it does not know), and the car screen's drawing.
 *   node tests/anh_dai_dien_test.js          (with AVATAR_REAL_RES + AVATAR_REAL_IDS: also the car's real bundle)
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

/* ---------- a bundle like the car's, made here ---------- */
const KEYS = []; for (let i = 0; i <= 20; i++) KEYS.push('S' + (i < 10 ? '0' : '') + i);
function picture(seed) {                      // 570x570 RGBA: smooth, with edges, so LZ4 finds matches and literals
    const b = Buffer.alloc(W.RAW);
    for (let y = 0; y < W.SIZE; y++) for (let x = 0; x < W.SIZE; x++) {
        const p = (y * W.SIZE + x) * 4, edge = ((x >> 5) + (y >> 6) + seed) & 3;
        b[p] = (x * 255 / W.SIZE + seed * 9) & 255; b[p + 1] = (y * 255 / W.SIZE) & 255; b[p + 2] = edge * 60 + (seed * 7 & 31); b[p + 3] = 255;
    }
    return b;
}
function makeBundle() {
    const head = Buffer.from('[RamsesVersion:19.0.14]\n[GitHash:test]\n', 'latin1');
    const idsLines = [], tabA = [], tabB = [], blobs = [];
    KEYS.forEach((k, i) => {
        const content = crypto.randomBytes(16), idHex = crypto.randomBytes(16).toString('hex');
        const idb = Buffer.concat([Buffer.from(idHex.slice(0, 16), 'hex').reverse(), Buffer.from(idHex.slice(16), 'hex').reverse()]);
        idsLines.push('0x' + idHex + ' MyVehicle_Avatar_Icon_V001_' + k + '.png');
        const tail = Buffer.alloc(20); tail.writeUInt32LE(570, 0); tail.writeUInt32LE(570, 4); tail.writeUInt32LE(5, 8); tail.writeUInt32LE(i + 1, 12);
        tabA.push(Buffer.concat([content, idb, tail]));
        const z = W.lz4Compress(picture(i));
        const h = Buffer.alloc(45); h.writeUInt32LE(3, 0); h.writeUInt32LE(1, 8); h.writeUInt32LE(z.length, 12); h.writeUInt32LE(W.RAW, 16);
        h.writeInt32LE(-1, 20); h.writeUInt32LE(570, 24); h.writeUInt32LE(570, 28); h.writeUInt32LE(9, 32); h.writeUInt32LE(1, 36); h.writeUInt32LE(W.RAW, 40);
        blobs.push(Buffer.concat([h, z])); tabB.push(content);
    });
    const pre = Buffer.concat([head, Buffer.alloc(16)]);
    const tableLen = 4 + 52 * 21 + 4 + 36 * 21;
    let off = pre.length + tableLen;
    const rowsB = tabB.map((c, i) => {
        const r = Buffer.alloc(36); r.writeUInt32LE(3, 0); c.copy(r, 4); r.writeUInt32LE(W.RAW, 20); r.writeUInt32LE(blobs[i].length - 45, 24);
        r.writeUInt32LE(off, 28); r.writeUInt32LE(blobs[i].length, 32); off += blobs[i].length; return r;
    });
    const c1 = Buffer.alloc(4); c1.writeUInt32LE(21, 0);
    return { data: Buffer.concat([pre, c1, Buffer.concat(tabA), c1, Buffer.concat(rowsB), Buffer.concat(blobs)]), ids: idsLines.join('\n') + '\n' };
}

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
    assert.throws(() => new W.Bundle(mk.data, mk.ids.split('\n').slice(0, 5).join('\n')), /only 5 pictures/);
    ok('a bundle of another layout is refused');
    const img = Buffer.alloc(4 * 4 * 4); for (let i = 0; i < img.length; i++) img[i] = i;
    const f = W.flipRows(img, 4, 4);
    assert.strictEqual(f.slice(0, 16).toString('hex'), img.slice(48, 64).toString('hex'));
    assert.strictEqual(Buffer.compare(W.flipRows(f, 4, 4), img), 0);
    const s = W.shrink(Buffer.alloc(8 * 8 * 4, 200), 8, 8, 2);
    assert.strictEqual(s.length, 16); assert.strictEqual(s[0], 200);
    const p = W.png(Buffer.alloc(3 * 2 * 4, 255), 3, 2);
    assert.strictEqual(p.slice(1, 4).toString(), 'PNG'); assert.strictEqual(p.readUInt32BE(16), 3); assert.strictEqual(p.readUInt32BE(20), 2);
    assert.strictEqual(W.crc32(Buffer.from('123456789')), 0xcbf43926);
    ok('flip, shrink, PNG and CRC');
    if (process.env.AVATAR_REAL_RES) {
        const real = W.selfTest(fs.readFileSync(process.env.AVATAR_REAL_RES), fs.readFileSync(process.env.AVATAR_REAL_IDS, 'utf8'));
        assert.strictEqual(real.entries.length, 21);
        ok('the car\'s real bundle parses and rebuilds byte for byte');
    }
}

/* ---------- the service ---------- */
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'anh-'));
const dir = path.join(tmp, 'bundle'), state = path.join(tmp, 'state'), run = path.join(tmp, 'run'), legacy = path.join(tmp, 'legacy'), oap = path.join(tmp, 'oap');
[dir, legacy].forEach((d) => fs.mkdirSync(d));
fs.writeFileSync(path.join(dir, 'wbitmaps.res'), mk.data);
fs.writeFileSync(path.join(dir, 'wbitmaps.res.ids'), mk.ids);
Object.assign(process.env, { AVATAR_DIR: dir, AVATAR_MOUNT: '', AVATAR_STATE: state, AVATAR_RUN: run, AVATAR_LEGACY: legacy, AVATAR_OAP: oap, AVATAR_PORT: '0', AVATAR_IPS: '192.168.7.9', AVATAR_SCAN_MS: '0' });
const svc = require(path.join(ROOT, 'tools', 'anh-dai-dien', 'anh-dai-dien.js'));

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

(async () => {
    const server = svc.start();
    await sleep(300);
    const pin = svc.S.pin, q = '?pin=' + pin;
    assert.ok(svc.S.compatible, svc.S.error); assert.ok(svc.S.port > 0);
    assert.strictEqual(Buffer.compare(fs.readFileSync(path.join(state, 'backup', 'wbitmaps.res.orig')), mk.data), 0);
    const st0 = JSON.parse(fs.readFileSync(path.join(run, 'status.json'), 'utf8'));
    assert.strictEqual(st0.url, 'http://192.168.7.9:' + svc.S.port + '/?pin=' + pin);
    assert.strictEqual(st0.slots.length, 15); assert.ok(!st0.slots.some((s) => s.changed));
    assert.strictEqual(fs.statSync(path.join(run, 't01.rgba')).size, 96 * 96 * 4);
    ok('starts, takes the original as the backup, tells the app the address, the PIN and 15 thumbnails');

    let r = await call('GET', '/');
    assert.strictEqual(r.code, 200); assert.ok(/<title>/.test(r.body.toString()));
    r = await call('GET', '/api/state'); assert.strictEqual(r.code, 401);
    r = await call('GET', '/api/state?pin=' + (pin === '1234' ? '4321' : '1234')); assert.strictEqual(r.code, 401);
    r = await call('GET', '/api/state' + q); assert.strictEqual(r.code, 200); assert.strictEqual(r.json.slots.length, 15);
    r = await call('GET', '/api/thumb/4' + q); assert.strictEqual(r.code, 200); assert.strictEqual(r.type, 'image/png'); assert.strictEqual(r.body.readUInt32BE(16), 256);
    r = await call('GET', '/api/thumb/16' + q); assert.strictEqual(r.code, 404);
    ok('the page is open; the API needs the PIN; thumbnails are PNG');

    const up = picture(50);        // top-down, as the phone sends
    r = await call('POST', '/api/picture/3' + q, up); assert.strictEqual(r.code, 200, JSON.stringify(r.json));
    let now = new W.Bundle(fs.readFileSync(path.join(dir, 'wbitmaps.res')), mk.ids);
    assert.strictEqual(Buffer.compare(now.rgba('S03'), W.flipRows(up, W.SIZE, W.SIZE)), 0);
    assert.strictEqual(Buffer.compare(now.blob('S04'), new W.Bundle(mk.data, mk.ids).blob('S04')), 0);
    assert.ok(!fs.existsSync(path.join(dir, 'wbitmaps.res.new')));
    r = await call('GET', '/api/state' + q);
    assert.deepStrictEqual(r.json.slots.filter((s) => s.changed).map((s) => s.n), [3]); assert.ok(r.json.needsRestart);
    ok('a picture goes in (flipped to the file\'s row order), nothing else moves, no temp file is left');

    r = await call('POST', '/api/picture/16' + q, up); assert.strictEqual(r.code, 400);
    r = await call('POST', '/api/picture/0' + q, up); assert.strictEqual(r.code, 400);
    r = await call('POST', '/api/picture/3' + q, up.slice(0, 1000)); assert.strictEqual(r.code, 400);
    r = await call('POST', '/api/picture/3' + q, Buffer.concat([up, Buffer.alloc(8)])); assert.strictEqual(r.code, 413);
    assert.strictEqual(Buffer.compare(fs.readFileSync(path.join(dir, 'wbitmaps.res')).slice(0, 100), now.data.slice(0, 100)), 0);
    ok('wrong slot, wrong size and oversized uploads are refused without touching the file');

    // two at once are done one after the other
    const two = await Promise.all([call('POST', '/api/picture/5' + q, picture(61)), call('POST', '/api/picture/6' + q, picture(62))]);
    assert.ok(two.every((x) => x.code === 200));
    now = new W.Bundle(fs.readFileSync(path.join(dir, 'wbitmaps.res')), mk.ids);
    assert.strictEqual(Buffer.compare(now.rgba('S05'), W.flipRows(picture(61), W.SIZE, W.SIZE)), 0);
    assert.strictEqual(Buffer.compare(now.rgba('S06'), W.flipRows(picture(62), W.SIZE, W.SIZE)), 0);
    assert.strictEqual(Buffer.compare(now.rgba('S03'), W.flipRows(up, W.SIZE, W.SIZE)), 0);
    ok('two uploads at once both land');

    r = await call('POST', '/api/restore/3' + q); assert.strictEqual(r.code, 200);
    now = new W.Bundle(fs.readFileSync(path.join(dir, 'wbitmaps.res')), mk.ids);
    assert.strictEqual(Buffer.compare(now.blob('S03'), new W.Bundle(mk.data, mk.ids).blob('S03')), 0);
    assert.strictEqual(Buffer.compare(now.rgba('S05'), W.flipRows(picture(61), W.SIZE, W.SIZE)), 0);
    r = await call('POST', '/api/restore/all' + q); assert.strictEqual(r.code, 200);
    assert.strictEqual(Buffer.compare(fs.readFileSync(path.join(dir, 'wbitmaps.res')), mk.data), 0);
    r = await call('GET', '/api/state' + q); assert.ok(!r.json.slots.some((s) => s.changed));
    ok('restoring one picture, then all, brings back the original file byte for byte');

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
    assert.strictEqual(Buffer.compare(fs.readFileSync(path.join(dir, 'wbitmaps.res')), mk.data), 0);
    ok('the app\'s commands: an old one is ignored, a new PIN, restore all');

    // five wrong PINs lock the address
    const bad = svc.S.pin === '1111' ? '2222' : '1111';
    for (let i = 0; i < 5; i++) await call('GET', '/api/state?pin=' + bad);
    r = await call('GET', '/api/state?pin=' + svc.S.pin); assert.strictEqual(r.code, 429);
    ok('five wrong PINs lock the address for a minute');

    // a legacy hand-made backup is the original when there is none yet; a bundle of another layout is not touched
    server.close();
    ok('the server stops');

    const odd = fs.mkdtempSync(path.join(os.tmpdir(), 'anh-odd-'));
    fs.writeFileSync(path.join(odd, 'wbitmaps.res'), Buffer.concat([mk.data, Buffer.from('x')])); fs.writeFileSync(path.join(odd, 'wbitmaps.res.ids'), mk.ids);
    svc.CFG.dir = odd; svc.CFG.state = path.join(odd, 'st');
    assert.strictEqual(svc.load(), false); assert.ok(/cấu trúc lạ/.test(svc.S.error)); assert.strictEqual(svc.S.compatible, false);
    await assert.rejects(() => svc.setPicture(1, picture(1)), /cấu trúc lạ|không dùng được/);
    assert.strictEqual(fs.readFileSync(path.join(odd, 'wbitmaps.res')).length, mk.data.length + 1);
    ok('a bundle of another layout is reported and never written');

    const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'anh-leg-')), leg2 = fs.mkdtempSync(path.join(os.tmpdir(), 'anh-leg2-'));
    const mod = makeBundle();       // "the test bundle on the car now" and the owner's own copy of the original
    const orig = new W.Bundle(mod.data, mod.ids);
    const current = orig.build({ S01: picture(3) });
    fs.writeFileSync(path.join(dir2, 'wbitmaps.res'), current); fs.writeFileSync(path.join(dir2, 'wbitmaps.res.ids'), mod.ids);
    fs.writeFileSync(path.join(leg2, 'wbitmaps.res.orig'), mod.data);
    Object.assign(svc.CFG, { dir: dir2, state: path.join(dir2, 'st'), legacy: leg2 });
    assert.ok(svc.load()); svc.ensureBackup(); svc.makeThumbs();
    assert.strictEqual(Buffer.compare(fs.readFileSync(path.join(dir2, 'st', 'backup', 'wbitmaps.res.orig')), mod.data), 0);
    assert.ok(/tay/.test(svc.S.backupNote));
    await svc.restore('all');
    assert.strictEqual(Buffer.compare(fs.readFileSync(path.join(dir2, 'wbitmaps.res')), mod.data), 0);
    ok('the owner\'s hand-made backup is the original, even when the bundle now on the car is changed');

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
    const base = { state: 'ok', url: 'http://192.168.7.9:8137/?pin=4821', host: '192.168.7.9:8137', pin: '4821', slots, thumbs, anyChanged: true };
    const draws = [base, Object.assign({}, base, { busy: true }), Object.assign({}, base, { url: '' }), { state: 'down', slots: [], thumbs: {} }, { state: 'bad', error: 'x', slots: [], thumbs: {} }];
    draws.forEach((v) => {
        const rec = new Recorder(UI.W, UI.H, { textScale: 1 }); rec.own = true;
        UI.draw(rec, G, theme, v, {});
        const cv = new Canvas(UI.W, UI.H); play(rec.words(), cv);
    });
    const rec = new Recorder(UI.W, UI.H, { textScale: 1 }); rec.own = true; UI.draw(rec, G, theme, base, {});
    assert.ok(rec.targets.some((t) => t.key === 'adRestore') && rec.targets.some((t) => t.key === 'adPin'));
    const none = new Recorder(UI.W, UI.H, { textScale: 1 }); none.own = true; UI.draw(none, G, theme, Object.assign({}, base, { anyChanged: false }), {});
    assert.ok(!none.targets.some((t) => t.key === 'adRestore'));
    ok('the car screen draws in every state; "restore all" is a button only when something changed');

    console.log('\nall ' + n + ' passed');
    process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
