'use strict';
/**
 * anh-dai-dien: swaps the pictures of the profile picker (the avatar bundle wbitmaps.res of assetDB, see wbm.js)
 * for photos the owner sends from a phone, and puts the originals back.
 *
 *   the phone   -> http://<head unit>:8137/?pin=NNNN   a page (page.html) to pick a photo, crop it, send it
 *   the app     -> <its folder>/data/command.json       { id, cmd: 'restore_all' | 'new_pin' }
 *   this        -> /run/anh-dai-dien/status.json        what the app shows: address, PIN, pictures, messages
 *                  /run/anh-dai-dien/t01.rgba..t15.rgba the fifteen pictures at 96x96 for the app (top-down RGBA)
 *
 * The bundle sits on a read-only partition: a write remounts it read-write for a moment, writes a new file next
 * to the old one, flips it in with one rename and mounts it read-only again. The original bundle is copied to
 * /var/opt/anh-dai-dien/backup once, before the first change (from /var/opt/avatar_backup if the owner made a
 * copy by hand), and is what "restore" puts back. The head unit reads the pictures at start-up: a restart of the
 * screen shows the change.
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

const VERSION = '0.1.0';
const env = (k, d) => (process.env[k] !== undefined && process.env[k] !== '' ? process.env[k] : d);
const CFG = {
    dir: env('AVATAR_DIR', '/mnt/dataro/dataro1/hmi/bmw/id7/assetDB/High/2D/Baukasten/ContentElements/illustrations/Static/Avatar/MyVehicle_Avatar'),
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
const SLOTS = 15, THUMB = 256, SMALL = 96;
const RES = () => path.join(CFG.dir, 'wbitmaps.res');
const IDS = () => path.join(CFG.dir, 'wbitmaps.res.ids');
const BK = () => path.join(CFG.state, 'backup', 'wbitmaps.res.orig');
const key = (n) => 'S' + (n < 10 ? '0' : '') + n;
const two = (n) => (n < 10 ? '0' : '') + n;
const mkdirp = (d) => { if (fs.existsSync(d)) return; mkdirp(path.dirname(d)); try { fs.mkdirSync(d); } catch (e) { if (e.code !== 'EEXIST') throw e; } };
const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return null; } };

function log(m) {
    process.stdout.write(m + '\n');
    try {
        const f = path.join(CFG.state, 'anh-dai-dien.log');
        try { if (fs.statSync(f).size > 256 * 1024) fs.renameSync(f, f + '.1'); } catch (e) { /* none yet */ }
        fs.appendFileSync(f, new Date().toISOString() + ' ' + m + '\n');
    } catch (e) { /* no folder (tests) */ }
}

/* ---------------- state ---------------- */
const S = {
    bundle: null, ids: '', backup: null, backupNote: '', compatible: false, error: '',
    thumbs: {}, rev: 0, busy: false, message: '', messageKind: 'dim', needsRestart: false, pin: '', port: 0, startedAt: Date.now(),
};
let queue = Promise.resolve();
const bad = (m) => { const e = new Error(m); e.bad = true; return e; };
const exclusive = (fn) => { const p = queue.then(fn, fn); queue = p.then(() => {}, () => {}); return p; };

const newPin = () => String(1000 + crypto.randomBytes(2).readUInt16BE(0) % 9000);

function say(kind, text) { S.messageKind = kind; S.message = text; S.rev++; writeStatus(); }

/** Reads the bundle and decides whether it is the layout this knows. */
function load() {
    S.compatible = false; S.error = '';
    let data, ids;
    try { data = fs.readFileSync(RES()); ids = fs.readFileSync(IDS(), 'utf8'); } catch (e) { S.error = 'không đọc được gói ảnh: ' + e.message; return false; }
    try { S.bundle = W.selfTest(data, ids); S.ids = ids; } catch (e) { S.error = 'gói ảnh có cấu trúc lạ (' + e.message + ')'; S.bundle = null; return false; }
    for (let n = 1; n <= SLOTS; n++) if (!S.bundle.byKey[key(n)]) { S.error = 'thiếu hình ' + key(n); S.bundle = null; return false; }
    S.compatible = true;
    return true;
}

function parsesWithCurrentIds(file) {
    try { return new W.Bundle(fs.readFileSync(file), S.ids); } catch (e) { return null; }
}

/** The original bundle, copied once; S.backup is the parsed copy. */
function ensureBackup() {
    if (!S.compatible) return;
    let b = parsesWithCurrentIds(BK());
    if (b) { S.backup = b; S.backupNote = 'đã có bản gốc'; return; }
    const legacy = path.join(CFG.legacy, 'wbitmaps.res.orig');
    let from = legacy, note = 'bản gốc do chủ xe sao lưu tay';
    b = parsesWithCurrentIds(legacy);
    if (!b) { from = RES(); note = 'bản gốc lấy từ gói hiện tại'; b = S.bundle; }
    try {
        mkdirp(path.dirname(BK()));
        const tmp = BK() + '.tmp';
        fs.writeFileSync(tmp, fs.readFileSync(from));
        fs.renameSync(tmp, BK());
        S.backup = b; S.backupNote = note;
        log('backup: ' + note + ' (' + from + ')');
    } catch (e) { S.backup = null; S.error = 'không sao lưu được: ' + e.message; S.compatible = false; log('backup failed: ' + e.message); }
}

const changed = (n) => !!(S.backup && Buffer.compare(S.bundle.blob(key(n)), S.backup.blob(key(n))) !== 0);

function topDown(n) { return W.flipRows(S.bundle.rgba(key(n)), W.SIZE, W.SIZE); }

function makeThumb(n) {
    const full = topDown(n);
    S.thumbs[n] = { png: W.png(W.shrink(full, W.SIZE, W.SIZE, THUMB), THUMB, THUMB), changed: changed(n) };
    try { writeAtomic(path.join(CFG.run, 't' + two(n) + '.rgba'), W.shrink(full, W.SIZE, W.SIZE, SMALL)); } catch (e) { /* no RAM folder (tests) */ }
}
function makeThumbs() { for (let n = 1; n <= SLOTS; n++) makeThumb(n); S.rev++; }

function writeAtomic(file, data) {
    mkdirp(path.dirname(file));
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, data, { mode: 0o644 });
    fs.renameSync(tmp, file);
}

/* ---------------- writing the bundle ---------------- */
function run(cmd, args) {
    return new Promise((resolve, reject) => cp.execFile(cmd, args, { timeout: 20000 }, (e, so, se) => (e ? reject(new Error(cmd + ' ' + args.join(' ') + ': ' + (String(se).trim() || e.message))) : resolve(so))));
}

/** Puts `buf` in place of the bundle: checks it first, remounts only for the copy, one rename. */
async function commit(buf) {
    const check = new W.Bundle(buf, S.ids);                         // throws if it is not a bundle of this layout
    for (let n = 1; n <= SLOTS; n++) check.rgba(key(n));            // every picture decodes
    const st = fs.statSync(RES());
    if (CFG.mount) await run('mount', ['-o', 'remount,rw', CFG.mount]);
    const tmp = RES() + '.new';
    try {
        const fd = fs.openSync(tmp, 'w', 0o644);
        try { fs.writeSync(fd, buf, 0, buf.length, 0); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
        try { fs.chownSync(tmp, st.uid, st.gid); } catch (e) { /* not root (tests) */ }
        fs.chmodSync(tmp, st.mode & 0o7777);
        if (fs.statSync(tmp).size !== buf.length) throw new Error('the copy has the wrong size');
        fs.renameSync(tmp, RES());
        try { const d = fs.openSync(CFG.dir, 'r'); try { fs.fsyncSync(d); } finally { fs.closeSync(d); } } catch (e) { /* a folder cannot be synced everywhere */ }
    } catch (e) {
        try { fs.unlinkSync(tmp); } catch (e2) { /* nothing to remove */ }
        throw e;
    } finally {
        if (CFG.mount) { try { await run('mount', ['-o', 'remount,ro', CFG.mount]); } catch (e) { log('remount ro failed: ' + e.message); } }
    }
    S.bundle = check;
    S.needsRestart = true;
}

async function setPicture(n, topDownRgba) {
    return exclusive(async () => {
        if (!S.compatible) throw new Error(S.error || 'gói ảnh không dùng được');
        if (!(n >= 1 && n <= SLOTS)) throw bad('số hình không đúng');
        if (topDownRgba.length !== W.RAW) throw bad('ảnh không đúng cỡ ' + W.SIZE + 'x' + W.SIZE);
        S.busy = true; writeStatus();
        try {
            const rgba = Buffer.from(topDownRgba);
            for (let i = 3; i < rgba.length; i += 4) rgba[i] = 255;   // opaque: a transparent corner would show the screen behind
            await commit(S.bundle.build({ [key(n)]: W.flipRows(rgba, W.SIZE, W.SIZE) }));
            makeThumb(n); S.rev++;
            log('picture ' + n + ' replaced');
            say('go', 'Đã đổi hình số ' + n + '. Khởi động lại màn hình xe để thấy.');
        } finally { S.busy = false; writeStatus(); }
    });
}

async function restore(which) {          // a number, or 'all'
    return exclusive(async () => {
        if (!S.backup) throw bad('chưa có bản gốc để khôi phục');
        S.busy = true; writeStatus();
        try {
            if (which === 'all') await commit(fs.readFileSync(BK()));
            else {
                if (!(which >= 1 && which <= SLOTS)) throw bad('số hình không đúng');
                await commit(S.bundle.build({ [key(which)]: S.backup.blob(key(which)) }));
            }
            S.bundle = new W.Bundle(fs.readFileSync(RES()), S.ids);
            if (which === 'all') makeThumbs(); else { makeThumb(which); S.rev++; }
            log('restored ' + which);
            say('go', which === 'all' ? 'Đã khôi phục tất cả hình gốc. Khởi động lại màn hình xe để thấy.' : 'Đã khôi phục hình số ' + which + '. Khởi động lại màn hình xe để thấy.');
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
function writeStatus() {
    const ips = addresses();
    const st = {
        at: Date.now(), version: VERSION, rev: S.rev, up: Math.round((Date.now() - S.startedAt) / 1000),
        compatible: S.compatible, error: S.error, busy: S.busy,
        port: S.port, pin: S.pin, ips, url: ips.length && S.port ? 'http://' + ips[0] + ':' + S.port + '/?pin=' + S.pin : '',
        message: S.message, messageKind: S.messageKind, needsRestart: S.needsRestart,
        backup: S.backup ? S.backupNote : '', slots: [],
    };
    if (S.compatible) for (let n = 1; n <= SLOTS; n++) st.slots.push({ n, changed: !!(S.thumbs[n] && S.thumbs[n].changed) });
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
            messageKind: st.messageKind, needsRestart: st.needsRestart, rev: S.rev, size: W.SIZE, backup: !!S.backup, slots: st.slots });
    }
    let m = /^\/api\/thumb\/(\d+)$/.exec(p);
    if (req.method === 'GET' && m) {
        const t = S.thumbs[Number(m[1])];
        if (!t) { res.writeHead(404); return res.end(); }
        res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': t.png.length, 'Cache-Control': 'no-store' });
        return res.end(t.png);
    }
    m = /^\/api\/picture\/(\d+)$/.exec(p);
    if (req.method === 'POST' && m) {
        let b;
        try { b = await body(req, W.RAW + 1); } catch (e) { return json(res, 413, { ok: false, error: 'Ảnh quá lớn.' }); }
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
    if (load()) { ensureBackup(); if (S.compatible) makeThumbs(); }
    if (!S.compatible) log('not usable: ' + S.error);
    else say('dim', 'Sẵn sàng.');
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

module.exports = { CFG, S, load, ensureBackup, makeThumbs, setPicture, restore, start, handle, pollCommands, writeStatus, key };
