'use strict';
/**
 * anh-dai-dien: swaps pictures of the head unit's screens for photos the owner sends from a phone, and puts the
 * originals back. The pictures live in bundles (wbitmaps.res, see wbm.js) under assetDB:
 *
 *   the fifteen profile pictures   three bundles: 570x570 (the picker), 84x72 and 72x72 icons (lists, the status bar)
 *   the car                        the 3D vehicle of the My Vehicle menus, made to show a photo: its materials hidden
 *                                  and its body a picture facing the camera (car3d.js; the head unit's compiled shaders
 *                                  for it are removed so that it compiles the new ones); and the 2D pictures of the
 *                                  car, which the main menu's tile shows where it is not the 3D model
 *   the start-up screen            what animationplayer shows: eva_splash_*.png and the eva_hi_ / eva_bye_ videos
 *                                  (H.264), every variant and size, as one still picture (see boot.js)
 *   placeholder pictures           one bundle each, 4 sizes x 2 colours: what a media source shows without a cover
 *                                  (Bluetooth, USB, music, radio), the caller without a photo
 *
 *   the phone   -> http://<head unit>:8137/?pin=NNNN   a page (page.html) to pick a photo, crop it, send it
 *   the app     -> <its folder>/data/command.json       { id, cmd: 'restore_all' | 'new_pin' | 'next_ip' }
 *   this        -> /run/anh-dai-dien/status.json        what the app shows: address, PIN, pictures, messages
 *                  /run/anh-dai-dien/t01.rgba..t15.rgba the fifteen profile pictures at 96x96 for the app (top-down RGBA)
 *                  /run/anh-dai-dien/t41.rgba, t51.rgba the car and the start-up screen, 48 pixels wide, for the app
 *
 * The bundles sit on a read-only partition: a write remounts it read-write for a moment, writes a new file next
 * to the old one, flips it in with one rename and mounts it read-only again. Each bundle's original is copied to
 * /var/opt/anh-dai-dien/backup once, before its first change (the profile pictures' from /var/opt/avatar_backup if
 * the owner made a copy by hand), and is what "restore" puts back. A bundle whose layout is not the one known is
 * left alone. The head unit reads the pictures at start-up: a restart of the screen shows the change.
 *
 * The head unit's firewall (nftables: table ip filter, chain input) drops what it does not accept: while this runs it
 * keeps one rule that lets the page's port in on the interface of the address in the QR code (checked every 30 s, a
 * ruleset load drops it), and removes it when it stops.
 *
 * The phone page needs the PIN the app shows (4 digits; five wrong guesses lock an address for a minute).
 *
 *   node anh-dai-dien.js run       the service (anh-dai-dien.service)
 *   node anh-dai-dien.js status    print the status file
 *   node anh-dai-dien.js fwclose   remove the firewall rule (the unit's ExecStopPost)
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
const BOOT = require('./boot');
const { Res } = require('./res');
const CAR3D = require('./car3d');

const VERSION = '0.9.0';
const env = (k, d) => (process.env[k] !== undefined && process.env[k] !== '' ? process.env[k] : d);
const AVATAR_REL = 'High/2D/Baukasten/ContentElements/illustrations/Static/Avatar/MyVehicle_Avatar';
const REPL_REL = 'High/2D/Baukasten/ContentElements/illustrations/Replacement/4_sizes/';
const CFG = {
    root: env('AVATAR_ROOT', '/mnt/dataro/dataro1/hmi/bmw/id7/assetDB'),
    // <model>/vehicle (3D), vehicle2D_big, vehicle2D_small; one folder per brand (BMW, BMW M: an M5 is bmwm/.../F90LCI), ':' between them
    vehicles: env('AVATAR_VEHICLES', '/mnt/dataro/dataro1/hmi/bmw/widgetasset/vehicles:/mnt/dataro/dataro1/hmi/bmwm/widgetasset/vehicles:/mnt/dataro/dataro1/hmi/mini/widgetasset/vehicles'),
    boot: env('AVATAR_BOOT', '/mnt/dataro/dataro1/ent/animationplayer'),   // mgu<gen>/eva_splash_*.png, eva_hi_*.h264, eva_bye_*.h264
    route: env('AVATAR_ROUTE', '/proc/net/route'),
    nft: env('AVATAR_NFT', 'nft'),
    fwMs: Number(env('AVATAR_FW_MS', 30000)),
    variant: env('AVATAR_VARIANT', '/run/etc/variant.env'),             // HWGEN=18: which mgu<gen> folder this head unit plays
    dir: env('AVATAR_DIR', ''),                         // the profile pictures' bundle, if not under the root (tests)
    mount: process.env.AVATAR_MOUNT !== undefined ? process.env.AVATAR_MOUNT : '/mnt/dataro',   // '' = nothing to remount (tests)
    state: env('AVATAR_STATE', '/var/opt/anh-dai-dien'),
    shaders: env('AVATAR_SHADERS', '/var/opt/target/shader-cache'),
    // BMW's own way first (the node state manager, as the Store's tools ask for a restart), then systemd's
    reboot: env('AVATAR_REBOOT', 'sync; /usr/bin/nsm_control --requestRestart 7 --normal || systemctl reboot || /sbin/reboot || reboot'),
    proc: env('AVATAR_PROC', '/proc'),
    legacy: env('AVATAR_LEGACY', '/var/opt/avatar_backup'),
    run: env('AVATAR_RUN', '/run/anh-dai-dien'),
    oap: env('AVATAR_OAP', '/var/opt/public/oap'),
    port: Number(env('AVATAR_PORT', 8137)),
    ips: env('AVATAR_IPS', ''),                         // tests: 'a,b'
    scanMs: Number(env('AVATAR_SCAN_MS', 5000)),        // how often the app is looked for while it is missing
};
const APP = /^anh_dai_dien\d*$/;
/** Every vehicle folder: [{ model (its name; with the brand before it for all but the first folder), base }]. */
function vehicleDirs() {
    const out = [];
    String(CFG.vehicles).split(':').filter(Boolean).forEach((root, i) => {
        let names = [];
        try { names = fs.readdirSync(root).sort(); } catch (e) { return; }
        const brand = i ? path.basename(path.dirname(path.dirname(root))) + '-' : '';
        names.forEach((name) => out.push({ model: brand + name, base: path.join(root, name), root }));
    });
    return out;
}
const SLOTS = 15, THUMB = 256, SMALL = 96, MINI = 48, MORE0 = 21, CAR = 41, CAR_W = 1920, START = 51, START_W = 1920, START_H = 720;
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

const LOGS = [];                        // the last lines, for the diagnostic file
function log(m) {
    LOGS.push(new Date().toISOString() + ' ' + m); if (LOGS.length > 400) LOGS.shift();
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
    ipIndex: 0, bundles: {}, slots: {}, startChanged: false, carChanged: false, hero: null, compatible: false, error: '', backupNote: '', smallIcons: false,
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
    // the car and the start-up screen for the app's cards: MINI pixels wide, as many rows as the shape gives
    if (n === CAR || n === START) { try { writeAtomic(path.join(CFG.run, 't' + n + '.rgba'), W.resize(topDown, w, h, MINI, Math.max(1, Math.round(MINI * h / w)))); } catch (e) { /* no RAM folder (tests) */ } }
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

/**
 * The 2D pictures of the vehicle (<vehicles>/<model>/vehicle2D_big and _small, a picture and a paint mask per trim):
 * what the main menu's tile shows where it is not the 3D model. They are part of the car's slot (loadCar3d, setCar).
 */
function loadCar() {
    let models = [];
    S.hero = null;
    models = vehicleDirs();
    const targets = [];
    let first = null;
    models.forEach((v) => ['vehicle2D_big', 'vehicle2D_small'].forEach((sub) => {
        const model = v.model, dir = path.join(v.base, sub);
        if (!fs.existsSync(path.join(dir, 'bitmaps.res'))) return;
        const id = 'car-' + model + '-' + sub.slice(10);
        const b = bundle(id, dir, id + '.res.orig', 'bitmaps.res');
        const p = check(b, []);
        // a mask is named after its picture: trimA / trimA_mask, or numbered one after it: trimA7 / trimA_mask8
        const isMask = (k) => /_mask\d*_bitmap$/.test(k);
        const num = (k) => { const m = /(\d+)_bitmap$/.exec(k); return m ? Number(m[1]) : -1; };
        const picOf = (mk, pics) => { const plain = mk.replace(/_mask(\d*)_bitmap$/, '_bitmap'); return pics.filter((x) => x.key === plain)[0] || pics.filter((x) => num(x.key) >= 0 && num(x.key) === num(mk) - 1 && x.key.replace(/\d+_bitmap$/, '') === mk.replace(/_mask\d+_bitmap$/, ''))[0]; };
        let okay = !!p;
        if (p) {
            const masks = p.entries.filter((e) => isMask(e.key)), pics = p.entries.filter((e) => !isMask(e.key));
            const e0 = p.entries[0];
            if (!pics.length || masks.length !== pics.length || p.entries.some((e) => e.w !== e0.w || e.h !== e0.h) || masks.some((e) => !picOf(e.key, pics))) { okay = false; b.error = 'other pictures than a picture and a mask per trim'; }
            else if (backup(b, p)) {
                pics.sort((x, y) => (num(x.key) - num(y.key)) || (x.key < y.key ? -1 : 1));
                pics.forEach((e) => targets.push({ b, key: e.key, w: e.w, h: e.h }));
                masks.forEach((e) => { const pr = picOf(e.key, pics); targets.push({ b, key: e.key, w: e.w, h: e.h, zero: true, pair: pr ? pr.key : '' }); });
                if (!first) first = p;
            } else okay = false;
        }
        b.usable = okay;
        if (!okay) log(id + ' not usable: ' + b.error);
    }));
    S.hero = first ? { parsed: first, targets } : null;
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
    try { loadCar(); } catch (e) { log('2D car pictures: ' + e.message); S.hero = null; }
    try { loadCar3d(); } catch (e) { log('3D car: ' + e.message); delete S.slots[CAR]; }
    try { loadStart(); } catch (e) { log('start-up screen: ' + e.message); delete S.slots[START]; }
    S.compatible = true; S.rev++;
    return true;
}

const slotChanged = (slot) => (slot.models ? S.carChanged || slot.targets.some((t) => !!t.b.changed[t.key]) : slot.files ? S.startChanged : slot.targets.some((t) => !!t.b.changed[t.key]));
const anyChanged = () => S.startChanged || S.carChanged || Object.keys(S.bundles).some((id) => Object.keys(S.bundles[id].changed).length > 0);

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

/** Writes a file in place of `dest`: a new file next to it (or a link to `same`, a file with these bytes), one rename. Inside writable(). */
function putFile(dest, buf, same) {
    let st = null;
    try { st = fs.statSync(dest); } catch (e) { st = null; }
    const tmp = dest + '.new';
    try {
        try { fs.unlinkSync(tmp); } catch (e) { /* none left over */ }
        let linked = false;
        if (same) { try { fs.linkSync(same, tmp); linked = true; } catch (e) { linked = false; } }
        if (!linked) {
            const fd = fs.openSync(tmp, 'w', 0o644);
            try { fs.writeSync(fd, buf, 0, buf.length, 0); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
            if (st) { try { fs.chownSync(tmp, st.uid, st.gid); } catch (e) { /* not root (tests) */ } fs.chmodSync(tmp, st.mode & 0o7777); }
        }
        if (fs.statSync(tmp).size !== buf.length) throw new Error('the copy has the wrong size');
        fs.renameSync(tmp, dest);
        try { const d = fs.openSync(path.dirname(dest), 'r'); try { fs.fsyncSync(d); } finally { fs.closeSync(d); } } catch (e) { /* a folder cannot be synced everywhere */ }
    } catch (e) {
        try { fs.unlinkSync(tmp); } catch (e2) { /* nothing to remove */ }
        throw e;
    }
}

/** Puts `buf` in place of a bundle: checks it first, a new file next to the old one, one rename. Inside writable(). */
function commit(b, buf) {
    const parsed = new W.Bundle(buf, b.ids);                        // throws if it is not a bundle of this layout
    parsed.entries.forEach((e) => parsed.rgba(e.key));              // every picture decodes
    putFile(RES(b), buf);
    S.needsRestart = true;
    return parsed;
}

/* ---------------- the car's picture ---------------- */
// Two places show the car: the 3D model (<vehicles>/<model>/vehicle, in the My Vehicle menus) and, where the tile of the
// main menu is not 3D, the 2D pictures (vehicle2D_big and _small). One slot sets both.
const carMark = () => path.join(CFG.state, 'car3d-changed');
const carPhoto = () => path.join(CFG.state, 'car-photo.rgba');
const carBackup = (m, name) => path.join(CFG.state, 'backup', 'car3d', m.model, name);
const CAR_FILES = ['effects.res', 'bitmaps.res'];
const CAR_NEEDS = CAR_FILES.concat(['effects.res.ids', 'bitmaps.res.ids', 'meshes.res', 'meshes.res.attributes']);

/** The 3D vehicles this can change: <vehicles>/<model>/vehicle with the body effect and texture known (car3d.js). */
function loadCar3d() {
    let models = [];
    models = vehicleDirs();
    S.carChanged = fs.existsSync(carMark());
    const found = [], old = [];              // old: changed by an earlier version of this, not a model this one changes: only put back
    models.forEach((v) => {
        const model = v.model, dir = path.join(v.base, 'vehicle');
        const m = { model, dir };
        const kept = () => { if (CAR_FILES.every((f) => fs.existsSync(carBackup(m, f)) && fs.existsSync(path.join(dir, f)))) old.push(m); };
        if (!CAR_NEEDS.every((f) => fs.existsSync(path.join(dir, f)))) return kept();
        try {
            // what the model is, is read from its originals: the files on the car may be this tool's
            const from = S.carChanged && CAR_FILES.every((f) => fs.existsSync(carBackup(m, f))) ? path.dirname(carBackup(m, 'effects.res')) : dir;
            const eff = new Res(fs.readFileSync(path.join(from, 'effects.res')), fs.readFileSync(path.join(dir, 'effects.res.ids'), 'utf8'));
            const bmp = new Res(fs.readFileSync(path.join(from, 'bitmaps.res')), fs.readFileSync(path.join(dir, 'bitmaps.res.ids'), 'utf8'));
            if (!CAR3D.check(eff, bmp)) { log('3D car ' + model + ' left alone: not the body effect and texture known'); return kept(); }
            if (!carMarks(m)) { log('3D car ' + model + ' left alone: no body mesh to carry the picture'); return kept(); }
            found.push(m);
        } catch (e) { log('3D car ' + model + ' left alone: ' + e.message); kept(); }
    });
    const flat = S.hero && S.hero.targets.length ? S.hero.targets : [];
    if (old.length) log('3D cars changed by an earlier version, to put back: ' + old.map((m) => m.model).join(', '));
    if (!found.length && !flat.length && !old.length) return;
    const where = found.length && flat.length ? 'ở ô xe ngoài màn hình chính và trong menu Xe của tôi' : found.length ? 'trong menu Xe của tôi (mô hình 3D)' : 'ở ô xe ngoài màn hình chính';
    S.slots[CAR] = { n: CAR, label: 'Hình chiếc xe', where, w: CAR_W, h: Math.round(CAR_W * CAR3D.PH / CAR3D.PW), alpha: true, models: found, old, targets: flat };
    carThumb();
}
/** What the model's meshes say about the picture: { at, box } (car3d.marks). */
function carMarks(m) {
    const data = fs.readFileSync(path.join(m.dir, 'meshes.res')), attrs = JSON.parse(fs.readFileSync(path.join(m.dir, 'meshes.res.attributes'), 'utf8'));
    return CAR3D.marks(attrs, (id) => new Res(data, id + ' X\n').payload('X'));
}
const flatChanged = () => Object.keys(S.bundles).some((id) => /^car-/.test(id) && Object.keys(S.bundles[id].changed).length > 0);
function carThumb(rgba) {
    const slot = S.slots[CAR];
    if (rgba) return thumb(CAR, rgba, slot.w, slot.h);
    try {
        if (S.carChanged || flatChanged()) {                         // the photo, as it was sent
            const pic = fs.readFileSync(carPhoto());
            if (pic.length === CAR3D.PW * CAR3D.PH * 4) return thumb(CAR, pic, CAR3D.PW, CAR3D.PH);
        }
        // the car's own look: the 2D picture of the model the central screen has open (any other model's would be another car)
        const open = openVehicles().filter((o) => o.by === 'HmiMain3D').map((o) => o.dir);
        const mine = S.hero ? S.hero.targets.filter((x) => !x.zero && open.indexOf(x.b.dir) >= 0).sort((x, y) => y.w - x.w) : [];
        if (mine.length) {
            const t = mine[0], mk = S.hero.targets.filter((x) => x.b === t.b && x.zero && x.pair === t.key)[0];
            const src = readOriginal(t.b);
            const pic = painted(src.rgba(t.key), mk ? src.rgba(mk.key) : Buffer.alloc(t.w * t.h * 4));
            return thumb(CAR, W.fit(W.flipRows(pic, t.w, t.h), t.w, t.h, slot.w >> 2, slot.h >> 2), slot.w >> 2, slot.h >> 2);
        }
    } catch (e) { /* the empty picture below */ }
    return thumb(CAR, Buffer.alloc(64 * 32 * 4), 64, 32);
}
/** Removes the compiled shaders the head unit keeps for these effects, so that it compiles the ones in the file. */
function dropShaders(names) {
    let n = 0;
    names.forEach((f) => { try { fs.unlinkSync(path.join(CFG.shaders, f)); n++; } catch (e) { /* not there */ } });
    return n;
}

/** Where the car's picture goes: 'both', 'tile' (the 2D pictures: the main menu's tile) or 'menu' (the 3D model: the My Vehicle menus). */
const carWhereFile = () => path.join(CFG.state, 'car-where');
function carWhere() { try { const w = fs.readFileSync(carWhereFile(), 'utf8').trim(); return /^(both|tile|menu)$/.test(w) ? w : 'both'; } catch (e) { return 'both'; } }

async function setCar(slot, rgba, where) {
    where = /^(tile|menu)$/.test(where) ? where : 'both';
    const in3d = where !== 'tile', in2d = where !== 'menu';
    slot.models.forEach((m) => CAR_FILES.forEach((f) => {             // the originals first, each copied once
        const bk = carBackup(m, f);
        if (fs.existsSync(bk)) return;                                // (a model without a copy was never changed: its files are the originals)
        mkdirp(path.dirname(bk));
        fs.writeFileSync(bk + '.tmp', fs.readFileSync(path.join(m.dir, f))); fs.renameSync(bk + '.tmp', bk);
    }));
    const jobs = [], photo = W.fit(rgba, slot.w, slot.h, CAR3D.PW, CAR3D.PH);
    let drop = [];
    const back = (m) => {                                             // a model's originals back (and its kept shaders gone)
        if (!CAR_FILES.every((f) => fs.existsSync(carBackup(m, f)))) return;
        CAR_FILES.forEach((f) => jobs.push({ file: path.join(m.dir, f), buf: fs.readFileSync(carBackup(m, f)) }));
        try { drop = drop.concat(CAR3D.cacheNames(new Res(fs.readFileSync(carBackup(m, 'effects.res')), fs.readFileSync(path.join(m.dir, 'effects.res.ids'), 'utf8')))); } catch (e) { /* nothing to remove */ }
    };
    if (!in3d && S.carChanged) slot.models.forEach(back);             // the picture only outside: the 3D model as it was
    if (in3d) slot.models.forEach((m) => {
        const ids = (f) => fs.readFileSync(path.join(m.dir, f + '.ids'), 'utf8');
        const eff = new Res(fs.readFileSync(carBackup(m, 'effects.res')), ids('effects.res')), bmp = new Res(fs.readFileSync(carBackup(m, 'bitmaps.res')), ids('bitmaps.res'));
        const mk = carMarks(m);
        if (!CAR3D.check(eff, bmp) || !mk) throw new Error('bản gốc của mô hình xe ' + m.model + ' không đúng');
        const effects = CAR3D.patchEffects(eff, mk.box, mk.at);          // the picture stands where the car does, as long as its body
        const bitmaps = CAR3D.patchBitmaps(bmp, photo);
        const e2 = new Res(effects, ids('effects.res')), b2 = new Res(bitmaps, ids('bitmaps.res'));      // both read back
        Object.keys(e2.byName).forEach((n) => e2.shaders(n));
        if (Buffer.compare(b2.payload(CAR3D.TEXTURE), CAR3D.pack(photo)) !== 0 || Object.keys(e2.byName).length !== Object.keys(eff.byName).length) throw new Error('mô hình xe ghi ra không đọc lại được');
        jobs.push({ file: path.join(m.dir, 'effects.res'), buf: effects }, { file: path.join(m.dir, 'bitmaps.res'), buf: bitmaps });
        drop = drop.concat(CAR3D.cacheNames(eff));
    });
    (slot.old || []).forEach(back);                                   // what an earlier version changed and this one does not
    // the 2D pictures: every trim's picture the photo, every paint mask empty
    const flat = !in2d ? [] : byBundle(slot).map((g) => {
        const cur = readBundle(g.b), replace = {}, made = {};
        g.targets.forEach((t) => {
            const id = t.w + 'x' + t.h + (t.zero ? 'z' : '');
            if (!made[id]) made[id] = { blob: cur.encode(t.key, W.flipRows(t.zero ? Buffer.alloc(t.w * t.h * 4) : premultiply(W.fit(rgba, slot.w, slot.h, t.w, t.h)), t.w, t.h)) };
            replace[t.key] = made[id];
        });
        return { g, buf: cur.build(replace) };
    });
    // the picture only inside: the 2D pictures as they were
    const flatBack = in2d ? [] : Object.keys(S.bundles).map((id) => S.bundles[id]).filter((b) => /^car-/.test(b.id) && b.usable && Object.keys(b.changed).length).map((b) => ({ b, buf: fs.readFileSync(b.bk) }));
    await writable(async () => {
        if (in3d && jobs.length) fs.writeFileSync(carMark(), String(Date.now()));
        jobs.forEach((j) => putFile(j.file, j.buf));
        flat.forEach((f) => { commit(f.g.b, f.buf); f.g.targets.forEach((t) => { f.g.b.changed[t.key] = true; }); });
        flatBack.forEach((f) => { commit(f.b, f.buf); f.b.changed = {}; });
    });
    const gone = dropShaders(drop);
    try { fs.writeFileSync(carPhoto(), photo); fs.writeFileSync(carWhereFile(), where); } catch (e) { /* the look on the phone page only */ }
    if (in3d && jobs.length) S.carChanged = true;
    if (!in3d) { S.carChanged = false; try { fs.unlinkSync(carMark()); } catch (e) { /* none */ } }
    S.needsRestart = true;
    carThumb(rgba);
    return where + ': ' + (in3d ? slot.models.map((m) => m.model) : []).concat(flat.length ? ['2D'] : []).join(', ') + (drop.length ? ', compiled shaders removed: ' + gone : '');
}

async function restoreCar() {
    const slot = S.slots[CAR];
    if (!slot) return;
    const jobs = [], flat = Object.keys(S.bundles).map((id) => S.bundles[id]).filter((b) => /^car-/.test(b.id) && b.usable && Object.keys(b.changed).length);
    let drop = [];
    if (S.carChanged) slot.models.concat(slot.old || []).forEach((m) => {
        if (!CAR_FILES.every((f) => fs.existsSync(carBackup(m, f)))) return;
        CAR_FILES.forEach((f) => jobs.push({ file: path.join(m.dir, f), buf: fs.readFileSync(carBackup(m, f)) }));
        try { drop = drop.concat(CAR3D.cacheNames(new Res(fs.readFileSync(carBackup(m, 'effects.res')), fs.readFileSync(path.join(m.dir, 'effects.res.ids'), 'utf8')))); } catch (e) { /* nothing to remove */ }
    });
    if (!jobs.length && !flat.length) return;
    const files = flat.map((b) => ({ b, buf: fs.readFileSync(b.bk) }));
    await writable(async () => {
        jobs.forEach((j) => putFile(j.file, j.buf));
        files.forEach((f) => { commit(f.b, f.buf); f.b.changed = {}; });
    });
    dropShaders(drop);
    try { fs.unlinkSync(carMark()); } catch (e) { /* gone */ }
    try { fs.unlinkSync(carPhoto()); } catch (e) { /* gone */ }
    try { fs.unlinkSync(carWhereFile()); } catch (e) { /* gone */ }
    S.carChanged = false; S.needsRestart = true;
    carThumb();
}

/* ---------------- the start-up screen ---------------- */
const startMark = () => path.join(CFG.state, 'start-changed');
const startBackup = (f) => path.join(CFG.state, 'backup', 'start', f.sub, f.name);

/** The start-up pictures and videos of this head unit's generation (all generations if it cannot be told). */
function loadStart() {
    let subs = [];
    try { subs = fs.readdirSync(CFG.boot).filter((d) => /^mgu\d+$/.test(d)).sort(); } catch (e) { return; }
    let gen = '';
    try { const m = /^HWGEN=(\d+)/m.exec(fs.readFileSync(CFG.variant, 'utf8')); gen = m ? 'mgu' + m[1] : ''; } catch (e) { gen = ''; }
    if (gen && subs.indexOf(gen) >= 0) subs = [gen];
    const files = [];
    subs.forEach((sub) => fs.readdirSync(path.join(CFG.boot, sub)).sort().forEach((name) => {
        const m = /^eva_(splash|hi|bye)_.*\.(png|h264)$/.exec(name);
        if (!m || (m[1] === 'splash') !== (m[2] === 'png')) return;
        const file = path.join(CFG.boot, sub, name);
        try {
            const head = fs.readFileSync(file);
            if (m[2] === 'png') { const i = BOOT.pngInfo(head); files.push({ sub, name, file, kind: 'png', w: i.w, h: i.h }); }
            else { const i = BOOT.h264Info(head); if (i.frames < 1) return; files.push({ sub, name, file, kind: 'h264', w: i.w, h: i.h, level: i.level, frames: i.frames }); }
        } catch (e) { log('start-up file ' + name + ' left alone: ' + e.message); }
    }));
    if (!files.some((f) => f.kind === 'png')) return;
    S.startChanged = fs.existsSync(startMark());
    S.slots[START] = { n: START, label: 'Màn hình khởi động', where: 'lúc màn hình khởi động, lúc chào khi lên xe và lúc tạm biệt', w: START_W, h: START_H, files, targets: [] };
    startThumb();
}
function startThumb() {
    const slot = S.slots[START];
    // the picture of this screen's shape (the others are other displays'), else the widest
    const best = slot.files.filter((f) => f.kind === 'png').sort((x, y) => ((y.w === START_W && y.h === START_H) - (x.w === START_W && x.h === START_H)) || (y.w - x.w))[0];
    try { const p = BOOT.pngDecode(fs.readFileSync(best.file)); thumb(START, p.rgba, p.w, p.h); } catch (e) { thumb(START, Buffer.alloc(64 * 24 * 4, 0), 64, 24); }
}

/** "x,y,w,h" as fractions of the picture -> the same as numbers, or null. */
function parseShine(s) {
    if (!s) return null;
    const v = String(s).split(',').map(Number);
    if (v.length !== 4 || v.some((x) => !isFinite(x) || x < 0 || x > 1) || v[2] < 0.02 || v[3] < 0.02) return null;
    return { x: v[0], y: v[1], w: Math.min(v[2], 1 - v[0]), h: Math.min(v[3], 1 - v[1]) };
}
async function setStart(slot, rgba, shine) {
    // the originals first, each copied once
    slot.files.forEach((f) => {
        const bk = startBackup(f);
        if (fs.existsSync(bk) || S.startChanged) return;
        mkdirp(path.dirname(bk));
        fs.writeFileSync(bk + '.tmp', fs.readFileSync(f.file)); fs.renameSync(bk + '.tmp', bk);
    });
    if (slot.files.some((f) => !fs.existsSync(startBackup(f)))) throw new Error('thiếu bản gốc của màn hình khởi động');
    const made = {};                                                // files of one kind and size are the same bytes: one file, the others links to it
    const jobs = slot.files.map((f) => {
        // the greeting (eva_hi_*_noloop) opens the picture out of black, the goodbye (eva_bye_*) closes it; anything
        // shorter than a third of a second, and what loops, is the still picture
        const move = f.kind !== 'h264' || f.frames < 20 ? '' : /^eva_hi_.*_noloop\./.test(f.name) ? 'in' : /^eva_bye_/.test(f.name) ? 'out' : '';
        const id = f.kind + f.w + 'x' + f.h + (f.kind === 'h264' ? '/' + f.level + '/' + f.frames + '/' + move : '');
        const lit = move === 'in' && shine ? { x: Math.round(shine.x * f.w), y: Math.round(shine.y * f.h), w: Math.round(shine.w * f.w), h: Math.round(shine.h * f.h) } : null;
        if (!made[id]) {
            const pic = W.fit(rgba, slot.w, slot.h, f.w, f.h), o = { level: f.level, frames: f.frames, out: move === 'out', shine: lit };
            made[id] = { buf: f.kind === 'png' ? W.png(pic, f.w, f.h) : move ? BOOT.openingVideo(pic, f.w, f.h, o) : BOOT.stillVideo(pic, f.w, f.h, o), first: '' };
            if (f.kind === 'h264') { const i = BOOT.h264Info(made[id].buf); if (i.w !== f.w || i.h !== f.h || i.frames !== f.frames) throw new Error('video made wrong'); }
        }
        return { f, m: made[id] };
    });
    await writable(async () => {
        fs.writeFileSync(startMark(), String(Date.now()));          // from here on the files are not the originals
        jobs.forEach((j) => { putFile(j.f.file, j.m.buf, j.m.first); if (!j.m.first) j.m.first = j.f.file; });
    });
    S.startChanged = true; S.needsRestart = true;
    thumb(START, rgba, slot.w, slot.h);
    return jobs.length;
}

async function restoreStart() {
    const slot = S.slots[START];
    if (!slot || !S.startChanged) return;
    const jobs = slot.files.map((f) => ({ f, buf: fs.readFileSync(startBackup(f)) }));
    await writable(async () => jobs.forEach((j) => putFile(j.f.file, j.buf)));
    try { fs.unlinkSync(startMark()); } catch (e) { /* gone */ }
    S.startChanged = false; S.needsRestart = true;
    startThumb();
}

/** The slot's targets, bundle by bundle: [{ b, targets }]. */
function byBundle(slot) {
    const out = [];
    slot.targets.forEach((t) => { let g = out.filter((x) => x.b === t.b)[0]; if (!g) { g = { b: t.b, targets: [] }; out.push(g); } g.targets.push(t); });
    return out;
}

async function setPicture(n, topDownRgba, opt) {
    return exclusive(async () => {
        if (!S.compatible) throw new Error(S.error || 'gói ảnh không dùng được');
        const slot = S.slots[n];
        if (!slot) throw bad('số hình không đúng');
        if (topDownRgba.length !== slot.w * slot.h * 4) throw bad('ảnh không đúng cỡ ' + slot.w + 'x' + slot.h);
        S.busy = true; writeStatus();
        try {
            let rgba = Buffer.from(topDownRgba);
            if (slot.files) {
                for (let i = 3; i < rgba.length; i += 4) rgba[i] = 255;
                const count = await setStart(slot, rgba, opt && opt.shine);
                S.rev++;
                log('start-up screen replaced (' + count + ' files)');
                say('go', 'Đã đổi màn hình khởi động. Khởi động lại màn hình xe để thấy.');
                return;
            }
            if (slot.alpha) rgba = feather(rgba, slot.w, slot.h);     // the car's picture keeps its transparency (a cut-out car)
            if (slot.models) {
                const which = await setCar(slot, rgba, opt && opt.where);
                S.rev++;
                log('the car replaced by a picture (' + which + ')');
                say('go', 'Đã đổi hình chiếc xe. Khởi động lại màn hình xe để thấy.');
                return;
            }
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
                Object.keys(S.slots).forEach((k) => { const s = S.slots[k]; if (!s.files && !s.models && todo.indexOf(s.targets[0].b) >= 0) thumbFrom(s, readOriginal(s.targets[0].b)); });
                await restoreStart();
                await restoreCar();
            } else if (slot.models) {
                await restoreCar();
            } else if (slot.files) {
                await restoreStart();
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
            say('go', (!slot ? 'Đã khôi phục tất cả hình gốc.' : slot.models ? 'Đã khôi phục chiếc xe gốc.' : slot.files ? 'Đã khôi phục màn hình khởi động gốc.' : which <= SLOTS ? 'Đã khôi phục hình số ' + which + '.' : 'Đã khôi phục hình "' + slot.label + '".') + ' Khởi động lại màn hình xe để thấy.');
        } finally { S.busy = false; writeStatus(); }
    });
}

/* ---------------- the address the phone opens ---------------- */
/** The interface the default route leaves by (what the head unit reaches the phone's network through), or ''. */
function defaultInterface() {
    try {
        const rows = fs.readFileSync(CFG.route, 'utf8').split('\n').slice(1).map((l) => l.trim().split(/\s+/)).filter((c) => c.length > 7 && c[1] === '00000000' && c[7] === '00000000');
        rows.sort((x, y) => Number(x[6]) - Number(y[6]));          // the lowest metric
        return rows.length ? rows[0][0] : '';
    } catch (e) { return ''; }
}

/** The head unit's addresses, the likeliest for a phone first: the default route's, then Wi-Fi's, then private ranges. */
function addresses() {
    if (CFG.ips) return CFG.ips.split(',');
    const out = [], via = defaultInterface();
    const nets = os.networkInterfaces();
    Object.keys(nets).forEach((name) => (nets[name] || []).forEach((a) => {
        if (a.internal || (a.family !== 'IPv4' && a.family !== 4) || /^169\.254\./.test(a.address)) return;
        const range = /^192\.168\./.test(a.address) ? 0 : /^172\.(1[6-9]|2\d|3[01])\./.test(a.address) ? 1 : /^10\./.test(a.address) ? 2 : 3;
        out.push({ ip: a.address, iface: name, rank: (name === via ? 0 : /^(wl|ml|uap|ap|wifi)/i.test(name) ? 10 : 20) + range });
    }));
    lastIfaces = {}; out.forEach((a) => { lastIfaces[a.ip] = a.iface; });
    return out.sort((a, b) => a.rank - b.rank).map((a) => a.ip);
}
let lastIfaces = {};

/* ---------------- the firewall ---------------- */
const FW_TAG = 'id-studio';
function execNft(args) {
    return new Promise((resolve, reject) => cp.execFile(CFG.nft, args, { timeout: 15000, maxBuffer: 4 << 20 }, (err, out, stderr) => {
        if (!err) return resolve(out);
        const e = new Error('nft ' + args.join(' ') + ': ' + (String(stderr || '').trim() || err.message));
        e.absent = err.code === 'ENOENT' || /No such file or directory/.test(String(stderr));      // no nft, or no such table or chain: nothing to open
        reject(e);
    }));
}
const fwRules = (out) => out.split('\n').filter((l) => /# handle \d+\s*$/.test(l) && !/^\s*(chain|table)\b/.test(l));
const fwMine = (rules) => rules.filter((l) => l.indexOf('comment "' + FW_TAG + '"') >= 0);

/** Removes this tool's rules. */
async function fwClose(nft) {
    nft = nft || execNft;
    let out;
    try { out = await nft(['-a', 'list', 'chain', 'ip', 'filter', 'input']); } catch (e) { if (e.absent) return 'absent'; throw e; }
    const mine = fwMine(fwRules(out));
    for (let i = 0; i < mine.length; i++) await nft(['delete', 'rule', 'ip', 'filter', 'input', 'handle', /# handle (\d+)\s*$/.exec(mine[i])[1]]);
    return 'closed';
}

/** Exactly one rule of this tool, at the top of ip filter input: the page's port, on `iface` when that is known. 'kept' | 'added' | 'absent'. */
async function fwEnsure(port, iface, nft) {
    nft = nft || execNft;
    let out;
    try { out = await nft(['-a', 'list', 'chain', 'ip', 'filter', 'input']); } catch (e) { if (e.absent) return 'absent'; throw e; }
    const rules = fwRules(out), mine = fwMine(rules);
    const want = (iface ? ['iifname', '"' + iface + '"'] : []).concat(['tcp', 'dport', String(port), 'accept', 'comment', '"' + FW_TAG + '"']);
    const same = (l) => l.indexOf('dport ' + port + ' ') >= 0 && (iface ? l.indexOf('iifname "' + iface + '"') >= 0 : l.indexOf('iifname') < 0);   // however nft spells the rest
    if (mine.length === 1 && rules[0] === mine[0] && same(mine[0])) return 'kept';
    await fwClose(nft);
    await nft(['insert', 'rule', 'ip', 'filter', 'input'].concat(want));
    return 'added';
}

let fwLast = '', fwBusy = false;
function fwCheck() {
    if (fwBusy || !S.port) return Promise.resolve();
    const ips = addresses(), ip = ips.length ? ips[S.ipIndex % ips.length] : '';
    fwBusy = true;
    return fwEnsure(S.port, ip ? (lastIfaces[ip] || '') : '').then((r) => {
        if (r !== 'kept' && r !== fwLast) log(r === 'added' ? 'firewall: port ' + S.port + ' open on ' + (lastIfaces[ip] || 'every interface') : 'firewall: no ip filter input chain, nothing to open');
        if (r !== 'kept') fwLast = r;
    }, (e) => { if (e.message !== fwLast) log('firewall: ' + e.message); fwLast = e.message; }).then(() => { fwBusy = false; });
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
        port: S.port, pin: S.pin, ips, ipIndex: ips.length ? S.ipIndex % ips.length : 0,
        url: ips.length && S.port ? 'http://' + ips[S.ipIndex % ips.length] + ':' + S.port + '/?pin=' + S.pin : '',
        message: S.message, messageKind: S.messageKind, needsRestart: S.needsRestart, carWhere: carWhere(),
        backup: S.compatible ? S.backupNote : '', smallIcons: S.smallIcons, anyChanged: S.compatible && anyChanged(),
        slots: S.compatible ? slotList(1, SLOTS).map((s) => ({ n: s.n, changed: s.changed })) : [],
        more: S.compatible ? slotList(CAR, CAR).concat(slotList(START, START), slotList(MORE0, CAR - 1)).map((s) => ({ n: s.n, changed: s.changed, label: s.n === CAR ? 'Hình xe' : s.n === START ? 'Khởi động' : s.label })) : [],
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
            messageKind: st.messageKind, needsRestart: st.needsRestart, carWhere: st.carWhere, rev: S.rev, size: W.SIZE, backup: st.compatible, smallIcons: st.smallIcons,
            anyChanged: st.anyChanged, slots: slotList(1, SLOTS), more: slotList(MORE0, CAR - 1), car: slotList(CAR, CAR), start: slotList(START, START) });
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
        try { await setPicture(Number(m[1]), b, { where: q.where, shine: parseShine(q.shine) }); return json(res, 200, { ok: true, message: S.message }); } catch (e) { return fail(res, e, 'picture'); }
    }
    m = /^\/api\/restore\/(all|\d+)$/.exec(p);
    if (req.method === 'POST' && m) {
        try { await restore(m[1] === 'all' ? 'all' : Number(m[1])); return json(res, 200, { ok: true, message: S.message }); } catch (e) { return fail(res, e, 'restore'); }
    }
    if (req.method === 'GET' && p === '/api/diag') {
        const list = diagFiles();
        res.writeHead(200, { 'Content-Type': 'application/x-tar', 'Content-Disposition': 'attachment; filename="mgu-studio-chan-doan.tar"', 'Cache-Control': 'no-store' });
        return tar(res, list);
    }
    if (req.method === 'POST' && p === '/api/reboot') { reboot(); return json(res, 200, { ok: true, message: S.message }); }
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

/* ---------------- the diagnostic file ---------------- */
/** The vehicle folders the HMI has open now (from /proc): what this car really shows. */
function openVehicles() {
    const out = {};
    let pids = [];
    try { pids = fs.readdirSync(CFG.proc).filter((d) => /^\d+$/.test(d)); } catch (e) { return []; }
    pids.forEach((pid) => {
        let comm = '';
        try { comm = fs.readFileSync(path.join(CFG.proc, pid, 'comm'), 'utf8').trim(); } catch (e) { return; }
        if (!/^Hmi/.test(comm)) return;
        let fds = [];
        try { fds = fs.readdirSync(path.join(CFG.proc, pid, 'fd')); } catch (e) { return; }
        fds.forEach((fd) => {
            let to = '';
            try { to = fs.readlinkSync(path.join(CFG.proc, pid, 'fd', fd)); } catch (e) { return; }
            String(CFG.vehicles).split(':').filter(Boolean).forEach((given) => {
                const real = (() => { try { return fs.realpathSync(given); } catch (e) { return given; } })();
                [given, real].forEach((root) => { if (to.indexOf(root + '/') === 0) out[path.join(given, path.dirname(to.slice(root.length + 1)))] = comm; });
            });
        });
    });
    return Object.keys(out).sort().map((dir) => ({ dir, by: out[dir] }));
}
/** What the diagnostic file holds: a report, and the files of the vehicle folders the HMI has open (originals too). */
function diagFiles() {
    const lines = ['MGU Studio ' + VERSION + '  ' + new Date().toISOString(), ''];
    const add = (t) => lines.push(t);
    const files = [], seen = {};
    const put = (name, file) => { if (seen[name]) return; try { const st = fs.statSync(file); if (!st.isFile() || st.size > (64 << 20)) return; seen[name] = 1; files.push({ name, file, size: st.size }); } catch (e) { /* not there */ } };
    try {
        add('== state'); add(JSON.stringify({ compatible: S.compatible, error: S.error, carChanged: !!S.carChanged, startChanged: !!S.startChanged, hero: !!S.hero, slots: Object.keys(S.slots).join(' ') }));
        const car = S.slots[CAR];
        add('car slot: ' + (car ? 'models ' + car.models.map((m) => m.model).join(',') + '; 2D targets ' + car.targets.length + '; where: ' + car.where : 'none'));
        add('bundles: ' + Object.keys(S.bundles).map((id) => id + (S.bundles[id].usable ? '' : ' (not usable: ' + S.bundles[id].error + ')') + (Object.keys(S.bundles[id].changed).length ? ' changed' : '')).join('; '));
        const start = S.slots[START];
        add('start-up files: ' + (start ? start.files.map((f) => f.sub + '/' + f.name + ' ' + f.w + 'x' + f.h + (f.frames ? ' ' + f.frames + 'f' : '')).join('; ') : 'none'));
    } catch (e) { add('state: ' + e.message); }
    let open = [];
    try { open = openVehicles(); } catch (e) { add('open: ' + e.message); }
    add(''); add('== vehicle folders the HMI has open'); open.forEach((o) => add(o.dir + '  (' + o.by + ')'));
    add(''); add('== vehicles');
    try {
        vehicleDirs().forEach((v) => {
            let subs = [];
            try { subs = fs.readdirSync(v.base).sort(); } catch (e) { add(v.model + ' (a file)'); return; }
            add(v.model + ': ' + subs.map((sub) => { let n = ''; try { n = fs.readdirSync(path.join(v.base, sub)).map((f) => f + ' ' + fs.statSync(path.join(v.base, sub, f)).size).join(', '); } catch (e) { n = '-'; } return sub + ' [' + n + ']'; }).join('  '));
        });
    } catch (e) { add('vehicles: ' + e.message); }
    add(''); add('== every file the central screen has open');
    try {
        fs.readdirSync(CFG.proc).filter((d) => /^\d+$/.test(d)).forEach((pid) => {
            let comm = ''; try { comm = fs.readFileSync(path.join(CFG.proc, pid, 'comm'), 'utf8').trim(); } catch (e) { return; }
            if (comm !== 'HmiMain3D') return;
            const seen2 = {};
            fs.readdirSync(path.join(CFG.proc, pid, 'fd')).forEach((fd) => { try { const to = fs.readlinkSync(path.join(CFG.proc, pid, 'fd', fd)); if (to[0] === '/' && !/^\/(dev|proc|sys|run\/dlt)/.test(to)) seen2[to] = 1; } catch (e) { /* closed */ } });
            Object.keys(seen2).sort().forEach((f) => add(f));
        });
    } catch (e) { add('open files: ' + e.message); }
    add(''); add('== compiled shaders, newest first');
    try { fs.readdirSync(CFG.shaders).map((f) => { const st = fs.statSync(path.join(CFG.shaders, f)); return { f, t: st.mtime, n: st.size }; }).sort((x, y) => y.t - x.t).slice(0, 120).forEach((x) => add(x.t.toISOString() + ' ' + x.n + ' ' + x.f)); } catch (e) { add('shaders: ' + e.message); }
    add(''); add('== compiled shaders kept: ' + (() => { try { return fs.readdirSync(CFG.shaders).length; } catch (e) { return e.message; } })());
    add(''); add('== log'); LOGS.forEach((l) => add(l));
    open.filter((o) => o.by === 'HmiMain3D').forEach((o) => {             // the central screen's only: the cluster keeps every model open
        const v = vehicleDirs().filter((x) => o.dir.indexOf(x.base + path.sep) === 0)[0];
        if (!v) return;
        const model = v.model, rel = model + path.sep + path.relative(v.base, o.dir);
        try { fs.readdirSync(o.dir).forEach((f) => put('vehicles/' + rel + '/' + f, path.join(o.dir, f))); } catch (e) { /* gone */ }
        if (path.basename(o.dir) === 'vehicle') CAR_FILES.forEach((f) => put('vehicles/' + rel + '.orig/' + f, carBackup({ model }, f)));
    });
    Object.keys(S.bundles).filter((id) => /^car-/.test(id)).forEach((id) => { const b = S.bundles[id]; put('2d/' + id + '/bitmaps.res', path.join(b.dir, b.file)); put('2d/' + id + '/bitmaps.res.ids', path.join(b.dir, b.file + '.ids')); put('2d/' + id + '/original.res', b.bk); });
    put('log/anh-dai-dien.log', path.join(CFG.state, 'anh-dai-dien.log')); put('log/anh-dai-dien.log.1', path.join(CFG.state, 'anh-dai-dien.log.1'));
    add(''); add('== files in this archive'); files.forEach((f) => add(f.name + ' ' + f.size));
    return [{ name: 'report.txt', buf: Buffer.from(lines.join('\n') + '\n', 'utf8') }].concat(files);
}
/** Writes the entries ({ name, buf } or { name, file, size }) as a tar archive to `out` and ends it. */
function tar(out, list) {
    const header = (name, size) => {
        const h = Buffer.alloc(512);
        h.write(name.slice(-99), 0, 'utf8'); h.write('0000644\0', 100); h.write('0000000\0', 108); h.write('0000000\0', 116);
        h.write(('00000000000' + size.toString(8)).slice(-11) + '\0', 124); h.write(('00000000000' + Math.floor(Date.now() / 1000).toString(8)).slice(-11) + '\0', 136);
        h.write('        ', 148); h[156] = 48; h.write('ustar\0' + '00', 257);
        let sum = 0; for (let i = 0; i < 512; i++) sum += h[i];
        h.write(('000000' + sum.toString(8)).slice(-6) + '\0 ', 148);
        return h;
    };
    let i = 0;
    const next = () => {
        if (i >= list.length) return out.end(Buffer.alloc(1024));
        const e = list[i++], size = e.buf ? e.buf.length : e.size, pad = Buffer.alloc((512 - (size % 512)) % 512);
        out.write(header(e.name, size));
        if (e.buf) { out.write(e.buf); out.write(pad); return next(); }
        let sent = 0;
        const rs = fs.createReadStream(e.file, { start: 0, end: Math.max(0, size - 1) });
        rs.on('data', (d) => { sent += d.length; if (!out.write(d)) { rs.pause(); out.once('drain', () => rs.resume()); } });
        rs.on('error', () => { out.write(Buffer.alloc(Math.max(0, size - sent))); out.write(pad); next(); });
        rs.on('end', () => { if (sent < size) out.write(Buffer.alloc(size - sent)); out.write(pad); next(); });
    };
    next();
}

/** Restarts the head unit (what shows new pictures), a moment after saying so. */
function reboot() {
    say('warn', 'Đang khởi động lại màn hình xe…'); writeStatus();
    log('restart asked for');
    if (!CFG.reboot) return;
    const t = setTimeout(() => cp.execFile('/bin/sh', ['-c', CFG.reboot], { timeout: 20000 }, (e) => { if (e) { log('restart: ' + e.message); say('crit', 'Không khởi động lại được: ' + e.message); } }), 700);
    if (t.unref) t.unref();
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
    else if (c.cmd === 'reboot') reboot();
    else if (c.cmd === 'next_ip') { S.ipIndex++; fwLast = ''; fwCheck(); say('dim', 'Đã đổi sang địa chỉ khác của xe. Quét lại mã QR.'); }
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
    server.on('listening', () => { S.port = server.address().port; log('page on port ' + S.port + ', PIN ' + S.pin); writeStatus(); fwCheck(); });
    server.listen(port, '0.0.0.0');
    setInterval(() => { pollCommands(); writeStatus(); }, 1500);
    if (CFG.fwMs > 0) setInterval(fwCheck, CFG.fwMs);
    process.on('SIGTERM', () => { server.close(); const bye = () => process.exit(0); setTimeout(bye, 3000); fwClose().then(bye, bye); });
    return server;
}

if (require.main === module) {
    const cmd = process.argv[2] || 'run';
    if (cmd === 'fwclose') fwClose().then(() => process.exit(0), (e) => { process.stderr.write(e.message + '\n'); process.exit(1); });
    else if (cmd === 'status') process.stdout.write(JSON.stringify(readJson(path.join(CFG.run, 'status.json')) || {}, null, 2) + '\n');
    else start();
}

module.exports = { CFG, S, reboot, openVehicles, diagFiles, tar, addresses, fwEnsure, fwClose, MORE, MORE0, START, CAR, CAR_W, premultiply, feather, load, setPicture, restore, start, handle, pollCommands, writeStatus, key };
