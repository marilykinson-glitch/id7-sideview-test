'use strict';
/**
 * anh-dai-dien: swaps pictures of the head unit's screens for photos the owner sends from a phone, and puts the
 * originals back. The pictures live in bundles (wbitmaps.res, see wbm.js) under assetDB:
 *
 *   the fifteen profile pictures   three bundles: 570x570 (the picker), 84x72 and 72x72 icons (lists, the status bar)
 *   the car's picture              the 2D picture of the vehicle on the main menu's tile and in the My Vehicle menu:
 *                                  per model a big and a small bundle, each a picture and a paint mask per trim
 *   placeholder pictures           one bundle each, 4 sizes x 2 colours: what a media source shows without a cover
 *                                  (Bluetooth, USB, music, radio), the caller without a photo
 *
 *   the phone   -> http://<head unit>:8137/?pin=NNNN   a page (page.html) to pick a photo, crop it, send it
 *   the app     -> <its folder>/data/command.json       { id, cmd: 'restore_all' | 'new_pin' }
 *   this        -> /run/anh-dai-dien/status.json        what the app shows: address, PIN, pictures, messages
 *                  /run/anh-dai-dien/t01.rgba..t15.rgba the fifteen profile pictures at 96x96 for the app (top-down RGBA)
 *
 * The bundles sit on a read-only partition: a write remounts it read-write for a moment, writes a new file next
 * to the old one, flips it in with one rename and mounts it read-only again. Each bundle's original is copied to
 * /var/opt/anh-dai-dien/backup once, before its first change (the profile pictures' from /var/opt/avatar_backup if
 * the owner made a copy by hand), and is what "restore" puts back. A bundle whose layout is not the one known is
 * left alone. The head unit reads the pictures at start-up: a restart of the screen shows the change.
 *
 * The phone page needs the PIN the app shows (4 digits; five wrong guesses lock an address for a minute).
 *
 *   node anh-dai-dien.js run       the service (anh-dai-dien.service)
 *   node anh-dai-dien.js status    print the status file
 * Node 8 (the head unit's), no dependencies.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const url = require('url');
const crypto = require('crypto');
const cp = require('child_process');
const W = require('./wbm');

const VERSION = '0.3.0';
const env = (k, d) => (process.env[k] !== undefined && process.env[k] !== '' ? process.env[k] : d);
const AVATAR_REL = 'High/2D/Baukasten/ContentElements/illustrations/Static/Avatar/MyVehicle_Avatar';
const REPL_REL = 'High/2D/Baukasten/ContentElements/illustrations/Replacement/4_sizes/';
const CFG = {
    root: env('AVATAR_ROOT', '/mnt/dataro/dataro1/hmi/bmw/id7/assetDB'),
    vehicles: env('AVATAR_VEHICLES', '/mnt/dataro/dataro1/hmi/bmw/widgetasset/vehicles'),   // <model>/vehicle2D_big, vehicle2D_small
    dir: env('AVATAR_DIR', ''),                         // the profile pictures' bundle, if not under the root (tests)
    mount: process.env.AVATAR_MOUNT !== undefined ? process.env.AVATAR_MOUNT : '/mnt/dataro',   // '' = nothing to remount (tests)
    state: env('AVATAR_STATE', '/var/opt/anh-dai-dien'),
    legacy: env('AVATAR_LEGACY', '/var/opt/avatar_backup'),
    run: env('AVATAR_RUN', '/run/anh-dai-dien'),
    oap: env('AVATAR_OAP', '/var/opt/public/oap'),
    port: Number(env('AVATAR_PORT', 8137)),
    ips: env('AVATAR_IPS', ''),                         // tests: 'a,b'
    scanMs: Number(env('AVATAR_SCAN_MS', 5000)),        // how often the app is looked for while it is missing
};
const APP = /^anh_dai_dien\d*$/;
const SLOTS = 15, THUMB = 256, SMALL = 96, MORE0 = 21, CAR = 41, CAR_W = 1344, CAR_H = 672;
const key = (n) => 'S' + (n < 10 ? '0' : '') + n;
const two = (n) => (n < 10 ? '0' : '') + n;
const mkdirp = (d) => { if (fs.existsSync(d)) return; mkdirp(path.dirname(d)); try { fs.mkdirSync(d); } catch (e) { if (e.code !== 'EEXIST') throw e; } };
const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return null; } };

/* The placeholder pictures: [bundle folder under Replacement/4_sizes, what the phone page calls it, where the car shows it]. */
const MORE = [
    ['replacement_media_wireless_bluetooth', 'Nhạc Bluetooth', 'khi phát nhạc Bluetooth không có ảnh bìa'],
    ['replacement_media_plug_usb', 'Nhạc USB', 'khi phát nhạc USB không có ảnh bìa'],
    ['replacement_media_musiccontent_music', 'Nhạc', 'bài hát không có ảnh bìa'],
    ['replacement_media_radio_fm', 'Radio FM', 'đài FM không có logo'],
    ['replacement_media_radio_am', 'Radio AM', 'đài AM không có logo'],
    ['replacement_media_radio', 'Radio', 'đài không có logo'],
    ['replacement_communication_call_anonymous', 'Người gọi', 'cuộc gọi của người không có ảnh'],
];
const SIZES4 = [570, 735, 1008, 1305], COLOURS = ['blue', 'red'];

function log(m) {
    process.stdout.write(m + '\n');
    try {
        const f = path.join(CFG.state, 'anh-dai-dien.log');
        try { if (fs.statSync(f).size > 256 * 1024) fs.renameSync(f, f + '.1'); } catch (e) { /* none yet */ }
        fs.appendFileSync(f, new Date().toISOString() + ' ' + m + '\n');
    } catch (e) { /* no folder (tests) */ }
}

/* ---------------- state ---------------- */
// A bundle: { id, dir, bk (its original's copy), usable, error, changed: { key: true } }. Its bytes are read when needed, not kept.
// A slot (one picture the owner sets): { n, label, where, w, h (what the phone sends), alpha (its transparency is kept),
//   targets: [{ b, key, w, h, box, zero (this picture is emptied: a paint mask) }] }.
const S = {
    bundles: {}, slots: {}, compatible: false, error: '', backupNote: '', smallIcons: false,
    thumbs: {}, rev: 0, busy: false, message: '', messageKind: 'dim', needsRestart: false, pin: '', port: 0, startedAt: Date.now(),
};
let queue = Promise.resolve();
const bad = (m) => { const e = new Error(m); e.bad = true; return e; };
const exclusive = (fn) => { const p = queue.then(fn, fn); queue = p.then(() => {}, () => {}); return p; };

const newPin = () => String(1000 + crypto.randomBytes(2).readUInt16BE(0) % 9000);

function say(kind, text) { S.messageKind = kind; S.message = text; S.rev++; writeStatus(); }

const RES = (b) => path.join(b.dir, b.file);
const readBundle = (b) => new W.Bundle(fs.readFileSync(RES(b)), b.ids);
const readOriginal = (b) => new W.Bundle(fs.readFileSync(b.bk), b.ids);

function bundle(id, dir, bkName, file) {
    const b = { id, dir, file: file || 'wbitmaps.res', bk: path.join(CFG.state, 'backup', bkName), ids: '', usable: false, error: '', changed: {}, note: '' };
    S.bundles[id] = b;
    return b;
}

/** Reads a bundle, checks it is the layout this knows and has the pictures `want` ([{ key, w, h }]) at those sizes. */
function check(b, want) {
    let data;
    try { data = fs.readFileSync(RES(b)); b.ids = fs.readFileSync(RES(b) + '.ids', 'utf8'); } catch (e) { b.error = 'không đọc được gói ảnh: ' + e.message; b.missing = e.code === 'ENOENT'; return null; }
    let parsed;
    try { parsed = W.selfTest(data, b.ids); } catch (e) { b.error = 'gói ảnh có cấu trúc lạ (' + e.message + ')'; return null; }
    for (let i = 0; i < want.length; i++) {
        const e = parsed.byKey[want[i].key];
        if (!e) { b.error = 'thiếu hình ' + want[i].key; return null; }
        if (e.w !== want[i].w || e.h !== want[i].h) { b.error = 'hình ' + want[i].key + ' có cỡ lạ ' + e.w + 'x' + e.h; return null; }
    }
    return parsed;
}

/** The bundle's original, copied once (from `legacy` if that is a copy the owner made); then which pictures differ from it. */
function backup(b, current, legacy) {
    let orig = null;
    try { orig = readOriginal(b); b.note = 'đã có bản gốc'; } catch (e) { orig = null; }
    if (!orig) {
        let from = RES(b); orig = current; b.note = 'bản gốc lấy từ gói hiện tại';
        if (legacy) { try { orig = new W.Bundle(fs.readFileSync(legacy), b.ids); from = legacy; b.note = 'bản gốc do chủ xe sao lưu tay'; } catch (e) { orig = current; } }
        try {
            mkdirp(path.dirname(b.bk));
            fs.writeFileSync(b.bk + '.tmp', fs.readFileSync(from));
            fs.renameSync(b.bk + '.tmp', b.bk);
            log('backup ' + b.id + ': ' + b.note + ' (' + from + ')');
        } catch (e) { b.error = 'không sao lưu được: ' + e.message; log('backup ' + b.id + ' failed: ' + e.message); return false; }
    }
    b.changed = {};
    current.entries.forEach((e) => { if (!orig.byKey[e.key] || Buffer.compare(current.blob(e.key), orig.blob(e.key)) !== 0) b.changed[e.key] = true; });
    return true;
}

function writeAtomic(file, data) {
    mkdirp(path.dirname(file));
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, data, { mode: 0o644 });
    fs.renameSync(tmp, file);
}

function thumb(n, topDown, w, h) {
    const tw = h >= w ? THUMB : Math.round(THUMB * w / h);
    S.thumbs[n] = W.png(W.resize(topDown, w, h, tw, h >= w ? Math.round(THUMB * h / w) : THUMB), tw, h >= w ? Math.round(THUMB * h / w) : THUMB);
    if (n <= SLOTS) { try { writeAtomic(path.join(CFG.run, 't' + two(n) + '.rgba'), W.shrink(topDown, w, h, SMALL)); } catch (e) { /* no RAM folder (tests) */ } }
}

/* The car's picture is stored with its colours multiplied by its transparency, and painted by the head unit:
   shown = sqrt(picture^2 * (1 - mask.a) + paint(mask) * mask.a). With an empty mask the picture is shown as it is. */
function premultiply(rgba) {
    const out = Buffer.from(rgba);
    for (let i = 0; i < out.length; i += 4) { const a = out[i + 3]; if (a < 255) { out[i] = out[i] * a / 255; out[i + 1] = out[i + 1] * a / 255; out[i + 2] = out[i + 2] * a / 255; } }
    return out;
}
/** The car as the head unit would paint it in white (the phone page's look at the original), not multiplied. */
function painted(pic, mask) {
    const out = Buffer.alloc(pic.length);
    for (let i = 0; i < pic.length; i += 4) {
        const ma = mask[i + 3] / 255, r = mask[i] / 255, g = mask[i + 1] / 255, b = mask[i + 2] / 255;
        const paint = 0.85 * r + 0.35 * Math.pow(g, 16 / 12.5) + 0.25 * b * b, a = pic[i + 3];
        for (let c = 0; c < 3; c++) {
            const v = Math.sqrt(Math.min(1, (pic[i + c] / 255) * (pic[i + c] / 255) * (1 - ma) + paint * ma)) * 255;
            out[i + c] = a ? Math.min(255, v * 255 / a) : 0;
        }
        out[i + 3] = a;
    }
    return out;
}
/** An opaque photo gets soft edges, so that it does not sit on the menu as a hard rectangle. */
function feather(rgba, w, h) {
    for (let i = 3; i < rgba.length; i += 4) if (rgba[i] !== 255) return rgba;
    const m = Math.round(h * 0.09), out = Buffer.from(rgba);
    const ramp = (d) => { if (d >= m) return 1; const t = d / m; return t * t * (3 - 2 * t); };
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const k = ramp(Math.min(x, w - 1 - x)) * ramp(Math.min(y, h - 1 - y));
        if (k < 1) out[(y * w + x) * 4 + 3] = Math.round(255 * k);
    }
    return out;
}

/** A slot's picture as the car has it now: from its first target (the largest the page shows well). */
function thumbFrom(slot, parsed) {
    const t = slot.targets[0];
    let pic = parsed.rgba(t.key);
    if (slot.alpha) {
        const mk = slot.targets.filter((x) => x.b === t.b && x.zero && x.pair === t.key)[0];
        const mask = mk ? parsed.rgba(mk.key) : Buffer.alloc(pic.length);
        pic = painted(pic, mask);
    }
    thumb(slot.n, W.flipRows(pic, t.w, t.h), t.w, t.h);
}

/** The 2D pictures of the vehicle: under <vehicles>/<model>/vehicle2D_big and _small, a picture and a paint mask per trim. */
function loadCar() {
    let models = [];
    try { models = fs.readdirSync(CFG.vehicles).sort(); } catch (e) { return; }
    const targets = [];
    let first = null;
    models.forEach((model) => ['vehicle2D_big', 'vehicle2D_small'].forEach((sub) => {
        const dir = path.join(CFG.vehicles, model, sub);
        if (!fs.existsSync(path.join(dir, 'bitmaps.res'))) return;
        const id = 'car-' + model + '-' + sub.slice(10);
        const b = bundle(id, dir, id + '.res.orig', 'bitmaps.res');
        const p = check(b, []);
        const num = (k) => { const m = /(\d+)_bitmap$/.exec(k); return m ? Number(m[1]) : -1; };
        let okay = !!p;
        if (p) {
            const masks = p.entries.filter((e) => /_mask\d+_bitmap$/.test(e.key)), pics = p.entries.filter((e) => !/_mask\d+_bitmap$/.test(e.key));
            const e0 = p.entries[0];
            if (!pics.length || masks.length !== pics.length || p.entries.some((e) => e.w !== e0.w || e.h !== e0.h || num(e.key) < 0)) { okay = false; b.error = 'other pictures than a picture and a mask per trim'; }
            else if (backup(b, p)) {
                pics.sort((x, y) => num(x.key) - num(y.key));
                pics.forEach((e) => targets.push({ b, key: e.key, w: e.w, h: e.h }));
                masks.forEach((e) => { const pr = pics.filter((x) => num(x.key) === num(e.key) - 1)[0]; targets.push({ b, key: e.key, w: e.w, h: e.h, zero: true, pair: pr ? pr.key : '' }); });
                if (!first) first = p;
            } else okay = false;
        }
        b.usable = okay;
        if (!okay) log(id + ' not usable: ' + b.error);
    }));
    if (!first) return;
    S.slots[CAR] = { n: CAR, label: 'Hình chiếc xe', where: 'ở ô xe ngoài màn hình chính và trong menu Xe của tôi', w: CAR_W, h: CAR_H, alpha: true, targets };
    thumbFrom(S.slots[CAR], first);
}

/** Looks at every bundle and makes the list of pictures that can be set. False if the profile pictures cannot. */
function load() {
    S.bundles = {}; S.slots = {}; S.thumbs = {}; S.compatible = false; S.error = ''; S.smallIcons = false; S.backupNote = '';
    const keys = []; for (let n = 1; n <= SLOTS; n++) keys.push(key(n));
    const big = bundle('avatar', CFG.dir || path.join(CFG.root, AVATAR_REL), 'wbitmaps.res.orig');
    const parsed = check(big, keys.map((k) => ({ key: k, w: W.SIZE, h: W.SIZE })));
    if (!parsed) { S.error = big.error; return false; }
    if (!backup(big, parsed, path.join(CFG.legacy, 'wbitmaps.res.orig'))) { S.error = big.error; return false; }
    big.usable = true; S.backupNote = big.note;
    // the two icon bundles: optional, the picker works without them
    const icons = [['avatar-regular', 'icons/Class_regular/MyVehicle_Avatar', 84, 72, [1, 1, 82, 70]], ['avatar-status', 'icons/Class_status/MyVehicle_Avatar', 72, 72, [9, 9, 54, 54]]].map((d) => {
        const b = bundle(d[0], path.join(CFG.root, d[1]), d[0] + '.res.orig');
        const p = check(b, keys.map((k) => ({ key: k, w: d[2], h: d[3] })));
        b.usable = !!(p && backup(b, p));
        if (!b.usable && !b.missing) log(b.id + ' not usable: ' + b.error);
        return { b, w: d[2], h: d[3], box: d[4] };
    });
    S.smallIcons = icons.every((i) => i.b.usable);
    for (let n = 1; n <= SLOTS; n++) {
        const targets = [{ b: big, key: key(n), w: W.SIZE, h: W.SIZE }];
        icons.forEach((i) => { if (i.b.usable) targets.push({ b: i.b, key: key(n), w: i.w, h: i.h, box: i.box }); });
        S.slots[n] = { n, label: 'Hình số ' + n, where: '', w: W.SIZE, h: W.SIZE, targets };
        thumbFrom(S.slots[n], parsed);
    }
    // the placeholder pictures: each only if its bundle is on this car and is what is expected
    MORE.forEach((d, i) => {
        const b = bundle(d[0], path.join(CFG.root, REPL_REL + d[0]), d[0] + '.res.orig');
        const want = [];
        SIZES4.slice().reverse().forEach((sz) => COLOURS.forEach((c) => want.push({ key: sz + '_' + c, w: sz, h: sz })));
        const p = check(b, want);
        b.usable = !!(p && p.entries.length === want.length && backup(b, p));
        if (!b.usable) { if (!b.missing) log(b.id + ' not usable: ' + (b.error || 'other pictures than expected')); return; }
        const n = MORE0 + i;
        S.slots[n] = { n, label: d[1], where: d[2], w: 1305, h: 1305, targets: want.map((w) => ({ b, key: w.key, w: w.w, h: w.h })) };
        thumbFrom(S.slots[n], p);
    });
    try { loadCar(); } catch (e) { log('car pictures: ' + e.message); delete S.slots[CAR]; }
    S.compatible = true; S.rev++;
    return true;
}

const slotChanged = (slot) => slot.targets.some((t) => !!t.b.changed[t.key]);
const anyChanged = () => Object.keys(S.bundles).some((id) => Object.keys(S.bundles[id].changed).length > 0);

/* ---------------- writing the bundles ---------------- */
function run(cmd, args) {
    return new Promise((resolve, reject) => cp.execFile(cmd, args, { timeout: 20000 }, (e, so, se) => (e ? reject(new Error(cmd + ' ' + args.join(' ') + ': ' + (String(se).trim() || e.message))) : resolve(so))));
}

/** Runs `fn` with the partition writable; read-only again whatever happens. */
async function writable(fn) {
    if (CFG.mount) await run('mount', ['-o', 'remount,rw', CFG.mount]);
    try { return await fn(); } finally {
        if (CFG.mount) { try { await run('mount', ['-o', 'remount,ro', CFG.mount]); } catch (e) { log('remount ro failed: ' + e.message); } }
    }
}

/** Puts `buf` in place of a bundle: checks it first, a new file next to the old one, one rename. Inside writable(). */
function commit(b, buf) {
    const parsed = new W.Bundle(buf, b.ids);                        // throws if it is not a bundle of this layout
    parsed.entries.forEach((e) => parsed.rgba(e.key));              // every picture decodes
    const st = fs.statSync(RES(b));
    const tmp = RES(b) + '.new';
    try {
        const fd = fs.openSync(tmp, 'w', 0o644);
        try { fs.writeSync(fd, buf, 0, buf.length, 0); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
        try { fs.chownSync(tmp, st.uid, st.gid); } catch (e) { /* not root (tests) */ }
        fs.chmodSync(tmp, st.mode & 0o7777);
        if (fs.statSync(tmp).size !== buf.length) throw new Error('the copy has the wrong size');
        fs.renameSync(tmp, RES(b));
        try { const d = fs.openSync(b.dir, 'r'); try { fs.fsyncSync(d); } finally { fs.closeSync(d); } } catch (e) { /* a folder cannot be synced everywhere */ }
    } catch (e) {
        try { fs.unlinkSync(tmp); } catch (e2) { /* nothing to remove */ }
        throw e;
    }
    S.needsRestart = true;
    return parsed;
}

/** The slot's targets, bundle by bundle: [{ b, targets }]. */
function byBundle(slot) {
    const out = [];
    slot.targets.forEach((t) => { let g = out.filter((x) => x.b === t.b)[0]; if (!g) { g = { b: t.b, targets: [] }; out.push(g); } g.targets.push(t); });
    return out;
}

async function setPicture(n, topDownRgba) {
    return exclusive(async () => {
        if (!S.compatible) throw new Error(S.error || 'gói ảnh không dùng được');
        const slot = S.slots[n];
        if (!slot) throw bad('số hình không đúng');
        if (topDownRgba.length !== slot.w * slot.h * 4) throw bad('ảnh không đúng cỡ ' + slot.w + 'x' + slot.h);
        S.busy = true; writeStatus();
        try {
            let rgba = Buffer.from(topDownRgba);
            if (slot.alpha) rgba = feather(rgba, slot.w, slot.h);     // the car's picture keeps its transparency (a cut-out car)
            else for (let i = 3; i < rgba.length; i += 4) rgba[i] = 255;   // opaque: a transparent corner would show the screen behind
            // every new file first (nothing is written if one cannot be made), then all of them in one writable moment
            const files = byBundle(slot).map((g) => {
                const cur = readBundle(g.b), replace = {}, made = {};
                g.targets.forEach((t) => {
                    const id = t.w + 'x' + t.h + (t.zero ? 'z' : '');   // pictures of one size get the same bytes: made once
                    if (!made[id]) {
                        let pic = t.zero ? Buffer.alloc(t.w * t.h * 4) : W.fit(rgba, slot.w, slot.h, t.w, t.h, t.box);
                        if (slot.alpha && !t.zero) pic = premultiply(pic);
                        made[id] = { blob: cur.encode(t.key, W.flipRows(pic, t.w, t.h)) };
                    }
                    replace[t.key] = made[id];
                });
                return { g, buf: cur.build(replace) };
            });
            await writable(async () => files.forEach((f) => { commit(f.g.b, f.buf); f.g.targets.forEach((t) => { f.g.b.changed[t.key] = true; }); }));
            thumb(n, rgba, slot.w, slot.h); S.rev++;
            log('picture ' + n + ' replaced (' + files.map((f) => f.g.b.id).join(', ') + ')');
            say('go', 'Đã đổi ' + (n <= SLOTS ? 'hình số ' + n : n === CAR ? 'hình chiếc xe' : 'hình "' + slot.label + '"') + '. Khởi động lại màn hình xe để thấy.');
        } finally { S.busy = false; writeStatus(); }
    });
}

async function restore(which) {          // a slot's number, or 'all'
    return exclusive(async () => {
        if (!S.compatible) throw bad('chưa có bản gốc để khôi phục');
        const slot = which === 'all' ? null : S.slots[which];
        if (which !== 'all' && !slot) throw bad('số hình không đúng');
        S.busy = true; writeStatus();
        try {
            if (!slot) {
                const todo = Object.keys(S.bundles).map((id) => S.bundles[id]).filter((b) => b.usable && Object.keys(b.changed).length);
                const files = todo.map((b) => ({ b, buf: fs.readFileSync(b.bk) }));
                await writable(async () => files.forEach((f) => { commit(f.b, f.buf); f.b.changed = {}; }));
                Object.keys(S.slots).forEach((k) => { const s = S.slots[k]; if (todo.indexOf(s.targets[0].b) >= 0) thumbFrom(s, readOriginal(s.targets[0].b)); });
            } else {
                const files = byBundle(slot).map((g) => {
                    const orig = readOriginal(g.b), replace = {};
                    g.targets.forEach((t) => { replace[t.key] = { blob: orig.blob(t.key) }; });
                    return { g, buf: readBundle(g.b).build(replace), orig };
                });
                await writable(async () => files.forEach((f) => { commit(f.g.b, f.buf); f.g.targets.forEach((t) => { delete f.g.b.changed[t.key]; }); }));
                thumbFrom(slot, files[0].orig);
            }
            S.rev++;
            log('restored ' + which);
            say('go', (!slot ? 'Đã khôi phục tất cả hình gốc.' : which <= SLOTS ? 'Đã khôi phục hình số ' + which + '.' : 'Đã khôi phục hình "' + slot.label + '".') + ' Khởi động lại màn hình xe để thấy.');
        } finally { S.busy = false; writeStatus(); }
    });
}

/* ---------------- the address the phone opens ---------------- */
function addresses() {
    if (CFG.ips) return CFG.ips.split(',');
    const out = [];
    const nets = os.networkInterfaces();
    Object.keys(nets).forEach((name) => (nets[name] || []).forEach((a) => {
        if (a.internal || (a.family !== 'IPv4' && a.family !== 4) || /^169\.254\./.test(a.address)) return;
        out.push(a.address);
    }));
    const rank = (ip) => (/^192\.168\./.test(ip) ? 0 : /^172\.(1[6-9]|2\d|3[01])\./.test(ip) ? 1 : /^10\./.test(ip) ? 2 : 3);
    return out.sort((a, b) => rank(a) - rank(b));
}

/* ---------------- status for the app ---------------- */
function slotList(from, to) {
    return Object.keys(S.slots).map(Number).filter((n) => n >= from && n <= to).sort((x, y) => x - y)
        .map((n) => ({ n, changed: slotChanged(S.slots[n]), label: S.slots[n].label, where: S.slots[n].where, size: S.slots[n].w, w: S.slots[n].w, h: S.slots[n].h, alpha: !!S.slots[n].alpha }));
}

function writeStatus() {
    const ips = addresses();
    const st = {
        at: Date.now(), version: VERSION, rev: S.rev, up: Math.round((Date.now() - S.startedAt) / 1000),
        compatible: S.compatible, error: S.error, busy: S.busy,
        port: S.port, pin: S.pin, ips, url: ips.length && S.port ? 'http://' + ips[0] + ':' + S.port + '/?pin=' + S.pin : '',
        message: S.message, messageKind: S.messageKind, needsRestart: S.needsRestart,
        backup: S.compatible ? S.backupNote : '', smallIcons: S.smallIcons, anyChanged: S.compatible && anyChanged(),
        slots: S.compatible ? slotList(1, SLOTS).map((s) => ({ n: s.n, changed: s.changed })) : [],
        more: S.compatible ? slotList(CAR, CAR).concat(slotList(MORE0, CAR - 1)).map((s) => ({ n: s.n, changed: s.changed, label: s.n === CAR ? 'Hình xe' : s.label })) : [],
    };
    try { writeAtomic(path.join(CFG.run, 'status.json'), JSON.stringify(st)); } catch (e) { /* no RAM folder (tests) */ }
    return st;
}

/* ---------------- the phone's side ---------------- */
const fails = {};
function pinOk(req, q, res) {
    const ip = req.socket.remoteAddress || '?';
    const f = fails[ip];
    if (f && f.n >= 5 && Date.now() - f.at < 60000) { json(res, 429, { ok: false, error: 'Nhập sai quá nhiều lần. Chờ 1 phút rồi thử lại.' }); return false; }
    const given = String(q.pin || req.headers['x-pin'] || '');
    if (given === S.pin) { delete fails[ip]; return true; }
    fails[ip] = { n: (f && Date.now() - f.at < 60000 ? f.n : 0) + 1, at: Date.now() };
    json(res, 401, { ok: false, error: given ? 'Mã PIN chưa đúng.' : 'Cần mã PIN.' });
    return false;
}

function json(res, code, obj) {
    const b = Buffer.from(JSON.stringify(obj));
    res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': b.length, 'Cache-Control': 'no-store', 'Connection': code === 413 ? 'close' : 'keep-alive' });
    res.end(b);
}

function fail(res, e, what) {
    if (e.bad) return json(res, 400, { ok: false, error: e.message });
    log(what + ' failed: ' + e.message); say('crit', 'Lỗi: ' + e.message);
    return json(res, 500, { ok: false, error: e.message });
}

function body(req, max) {
    return new Promise((resolve, reject) => {
        const parts = []; let len = 0, over = false;
        req.on('data', (c) => {
            if (over) return;                                        // what comes after the limit is read and dropped
            len += c.length;
            if (len > max) { over = true; parts.length = 0; reject(new Error('quá lớn')); } else parts.push(c);
        });
        req.on('end', () => { if (!over) resolve(Buffer.concat(parts, len)); });
        req.on('error', reject);
    });
}

let pageHtml = null;
function page() {
    if (!pageHtml) pageHtml = fs.readFileSync(path.join(__dirname, 'page.html'));
    return pageHtml;
}

async function handle(req, res) {
    const u = url.parse(req.url, true), q = u.query, p = u.pathname;
    if (req.method === 'GET' && (p === '/' || p === '/index.html')) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
        return res.end(page());
    }
    if (p === '/favicon.ico') { res.writeHead(204); return res.end(); }
    if (p.indexOf('/api/') !== 0) { res.writeHead(404); return res.end(); }
    if (!pinOk(req, q, res)) return;
    if (req.method === 'GET' && p === '/api/state') {
        const st = writeStatus();
        return json(res, 200, { ok: true, version: VERSION, compatible: st.compatible, error: st.error, busy: st.busy, message: st.message,
            messageKind: st.messageKind, needsRestart: st.needsRestart, rev: S.rev, size: W.SIZE, backup: st.compatible, smallIcons: st.smallIcons,
            anyChanged: st.anyChanged, slots: slotList(1, SLOTS), more: slotList(MORE0, CAR - 1), car: slotList(CAR, CAR) });
    }
    let m = /^\/api\/thumb\/(\d+)$/.exec(p);
    if (req.method === 'GET' && m) {
        const t = S.thumbs[Number(m[1])];
        if (!t) { res.writeHead(404); return res.end(); }
        res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': t.length, 'Cache-Control': 'no-store' });
        return res.end(t);
    }
    m = /^\/api\/picture\/(\d+)$/.exec(p);
    if (req.method === 'POST' && m) {
        const slot = S.slots[Number(m[1])];
        let b;
        try { b = await body(req, (slot ? slot.w * slot.h * 4 : W.RAW) + 1); } catch (e) { return json(res, 413, { ok: false, error: 'Ảnh quá lớn.' }); }
        try { await setPicture(Number(m[1]), b); return json(res, 200, { ok: true, message: S.message }); } catch (e) { return fail(res, e, 'picture'); }
    }
    m = /^\/api\/restore\/(all|\d+)$/.exec(p);
    if (req.method === 'POST' && m) {
        try { await restore(m[1] === 'all' ? 'all' : Number(m[1])); return json(res, 200, { ok: true, message: S.message }); } catch (e) { return fail(res, e, 'restore'); }
    }
    json(res, 404, { ok: false, error: 'không có' });
}

/* ---------------- the app's commands ---------------- */
let appCache = null, appScanAt = 0, lastCmd = null;
function findApp(now) {
    if (appCache && fs.existsSync(appCache.spec)) return appCache;
    if (now - appScanAt < CFG.scanMs && now >= appScanAt) return null;
    appScanAt = now; appCache = null;
    let dirs = [];
    try { dirs = fs.readdirSync(CFG.oap).filter((d) => /^oap_\d+$/.test(d)); } catch (e) { return null; }
    for (let i = 0; i < dirs.length; i++) {
        const rels = ['source/javascript/kit/app-spec.json', 'javascript/kit/app-spec.json'];
        for (let k = 0; k < rels.length; k++) {
            const spec = path.join(CFG.oap, dirs[i], rels[k]), s = readJson(spec);
            if (s && typeof s.id === 'string' && APP.test(s.id)) { appCache = { id: s.id, root: path.join(CFG.oap, dirs[i]), spec }; return appCache; }
        }
    }
    return null;
}

function pollCommands() {
    const app = findApp(Date.now());
    if (!app) return;
    const c = readJson(path.join(app.root, 'data', 'command.json'));
    if (!c || typeof c.id !== 'number') return;
    if (lastCmd === null) { lastCmd = c.id; return; }              // what was there before this start is old
    if (c.id === lastCmd) return;
    lastCmd = c.id;
    log('command ' + c.cmd);
    if (c.cmd === 'restore_all') restore('all').catch((e) => { log('restore failed: ' + e.message); say('crit', 'Lỗi: ' + e.message); });
    else if (c.cmd === 'new_pin') { S.pin = newPin(); say('dim', 'Đã đổi mã PIN.'); }
}

/* ---------------- run ---------------- */
function start() {
    S.pin = newPin();
    try { mkdirp(CFG.state); } catch (e) { /* tests */ }
    try { load(); } catch (e) { S.compatible = false; S.error = 'lỗi khi đọc gói ảnh: ' + e.message; }
    if (!S.compatible) log('not usable: ' + S.error);
    else { log('pictures: ' + Object.keys(S.slots).length + ', small icons ' + (S.smallIcons ? 'yes' : 'no')); say('dim', 'Sẵn sàng.'); }
    const server = http.createServer((req, res) => handle(req, res).catch((e) => { log('request failed: ' + e.message); try { json(res, 500, { ok: false, error: e.message }); } catch (e2) { /* gone */ } }));
    let port = CFG.port;
    server.on('error', (e) => { if (e.code === 'EADDRINUSE' && port < CFG.port + 9) { port++; server.listen(port, '0.0.0.0'); } else { log('server: ' + e.message); setTimeout(() => process.exit(1), 100); } });
    server.on('listening', () => { S.port = server.address().port; log('page on port ' + S.port + ', PIN ' + S.pin); writeStatus(); });
    server.listen(port, '0.0.0.0');
    setInterval(() => { pollCommands(); writeStatus(); }, 1500);
    process.on('SIGTERM', () => { server.close(); setTimeout(() => process.exit(0), 200); });
    return server;
}

if (require.main === module) {
    const cmd = process.argv[2] || 'run';
    if (cmd === 'status') process.stdout.write(JSON.stringify(readJson(path.join(CFG.run, 'status.json')) || {}, null, 2) + '\n');
    else start();
}

module.exports = { CFG, S, MORE, MORE0, CAR, CAR_W, CAR_H, premultiply, feather, load, setPicture, restore, start, handle, pollCommands, writeStatus, key };
