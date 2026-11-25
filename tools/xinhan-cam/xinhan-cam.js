'use strict';
/**
 * xinhan-cam.js - the root helper of the Camera xi nhan app (apps/xinhan_cam): keeps the decoder
 * (mgu-sidecam, beside this file) running and passes on what the app wants.
 *
 *   the app   -> /run/xinhan-cam/app/control.json  { at, seq, view, config, ar, aux }  (RAM: a folder this makes and
 *                gives the app; an app older than 0.7.0 writes <its folder>/data/control.json, read too: the newer counts)
 *   nav.js (a child, only while the app wants the navigation's turns: ar.nav) -> the next turn, which goes
 *                                                  to the decoder as {"op":"ar",...} with the app's calibration,
 *                                                  counted nearer by the car's speed between two messages
 *   this      -> mgu-sidecam's stdin               {"op":"config",...} when it changes,
 *                                                  {"op":"view","side":...} on change and once a second
 *   mgu-sidecam's stdout (its status lines) -> /run/xinhan-cam/status.json (0644), which the app shows:
 *       { at, version, app, control, fps, native: {...the decoder's status...}, note }
 *
 * A view counts only while the app confirms it: control.json older than STALE_MS means the app is gone
 * (stopped, updated, crashed), and the view goes. Without the app nothing is ever shown. The decoder is
 * started again when it ends, a little later each time while it keeps ending young.
 *
 * Root because the head unit's camera stream (the AVB bridge) is root's; it reads the app's control
 * file and writes only its own status file. No network, nothing written to the car.
 *
 *   node xinhan-cam.js run       the service (xinhan-cam.service)
 *   node xinhan-cam.js status    print the status file
 * Node 8 (the head unit's), no dependencies.
 */
const fs = require('fs');
const path = require('path');
const cp = require('child_process');

const VERSION = '0.8.1';
const env = (k, d) => (process.env[k] !== undefined && process.env[k] !== '' ? process.env[k] : d);
const CFG = {
    oap: env('XINHAN_OAP', '/var/opt/public/oap'),
    proc: env('XINHAN_PROC', '/proc'),
    run: env('XINHAN_RUN', '/run/xinhan-cam'),
    bin: env('XINHAN_BIN', path.join(__dirname, 'mgu-sidecam')),
    args: env('XINHAN_ARGS', '').split(' ').filter(Boolean),
    pollMs: Number(env('XINHAN_POLL_MS', 50)),
    staleMs: Number(env('XINHAN_STALE_MS', 2000)),
    log: env('XINHAN_LOG', '/var/opt/xinhan-cam/xinhan-cam.log'),
    nav: env('XINHAN_NAV', path.join(__dirname, 'nav.js')),
    navArgs: env('XINHAN_NAV_ARGS', 'read').split(' ').filter(Boolean),
};
const APP = /^xinhan_cam\d*$/;      // the app's id (the Store may install it as xinhan_cam2)
const VIEWS = ['none', 'left', 'right', 'all', 'front'];
const RESTART_MS = 2000, RESTART_MAX_MS = 60000, YOUNG_MS = 10000, LOG_MAX = 512 * 1024;
const STATUS_FILE = () => path.join(CFG.run, 'status.json');

const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return null; } };

function log(m) {
    const line = new Date().toISOString() + ' ' + m;
    process.stdout.write(m + '\n');
    try { if (fs.statSync(CFG.log).size > LOG_MAX) fs.renameSync(CFG.log, CFG.log + '.1'); } catch (e) { /* no file yet */ }
    try { fs.appendFileSync(CFG.log, line + '\n'); } catch (e) { /* no folder (tests), or read-only */ }
}

/* ---------------- the app ---------------- */

let appCache = null, appScanAt = 0;
/** { id, root } of the installed app, or null. Looked for again every 5 s while missing. */
function findApp(now) {
    if (appCache && fs.existsSync(appCache.spec)) return appCache;
    if (appCache === null && appScanAt && now - appScanAt < 5000 && now >= appScanAt) return null;
    appScanAt = now;
    appCache = null;
    let dirs = [];
    try { dirs = fs.readdirSync(CFG.oap).filter((d) => /^oap_\d+$/.test(d)); } catch (e) { return null; }
    for (let i = 0; i < dirs.length; i++) {
        const rels = ['source/javascript/kit/app-spec.json', 'javascript/kit/app-spec.json'];
        for (let k = 0; k < rels.length; k++) {
            const spec = path.join(CFG.oap, dirs[i], rels[k]);
            const s = readJson(spec);
            if (s && typeof s.id === 'string' && APP.test(s.id)) {
                appCache = { id: s.id, root: path.join(CFG.oap, dirs[i]), spec };
                return appCache;
            }
        }
    }
    return null;
}

/**
 * What the app wants now: { view, config, why }. view is 'none' unless the control file is fresh (its
 * own "at" within staleMs of now, by this clock: both run on the head unit) and names a view.
 */
/** The app's folder in RAM (its control file and the road's name): made for the app's user, checked every 10 s. */
const APP_RUN = () => path.join(CFG.run, 'app');
let appRunFor = null, appRunAt = 0;
let procOf = null, procAt = 0;
/**
 * The user and group the app's program runs as: a process whose command line or working folder is in
 * the app's folder (/proc). Its data folder's owner need not be that user (on the car the VietMap app
 * could not read a folder given to its data folder's owner). null when not found.
 */
function appProcess(app, now) {
    if (procOf && procOf.root === app.root && now - procAt < 30000 && now >= procAt &&
        (!procOf.who || fs.existsSync(path.join(CFG.proc, String(procOf.who.pid))))) return procOf.who;
    procAt = now;
    let who = null, pids = [];
    try { pids = fs.readdirSync(CFG.proc).filter((d) => /^\d+$/.test(d) && Number(d) !== process.pid); } catch (e) { pids = []; }
    const inApp = (s) => !!s && (s === app.root || s.indexOf(app.root + '/') >= 0 || s.indexOf(app.root + '\0') >= 0);
    for (const pid of pids) {
        const base = path.join(CFG.proc, pid);
        let cmd = null, cwd = null;
        try { cmd = fs.readFileSync(path.join(base, 'cmdline'), 'latin1'); } catch (e) { continue; }
        try { cwd = fs.readlinkSync(path.join(base, 'cwd')); } catch (e) { /* not ours to see */ }
        if (!inApp(cmd) && !inApp(cwd)) continue;
        let st = '';
        try { st = fs.readFileSync(path.join(base, 'status'), 'utf8'); } catch (e) { continue; }
        const u = /^Uid:\s+(\d+)/m.exec(st), g = /^Gid:\s+(\d+)/m.exec(st);
        if (!u || !g || Number(u[1]) === 0) continue;
        who = { uid: Number(u[1]), gid: Number(g[1]), pid: Number(pid) };
        break;
    }
    procOf = { root: app.root, who };
    return who;
}

function appRunDir(app, now) {
    if (!app) return;
    let st;
    try { st = fs.statSync(path.join(app.root, 'data')); } catch (e) { return; }
    const who = appProcess(app, now);
    if (who) st = { uid: who.uid, gid: who.gid };
    const key = st.uid + ':' + st.gid;
    if (key === appRunFor && now - appRunAt < 10000) return;
    appRunAt = now;
    try {
        try { fs.mkdirSync(APP_RUN(), 0o770); } catch (e) { if (e.code !== 'EEXIST') throw e; }
        if (!fs.lstatSync(APP_RUN()).isDirectory()) { fs.unlinkSync(APP_RUN()); fs.mkdirSync(APP_RUN(), 0o770); }
        fs.chownSync(APP_RUN(), st.uid, st.gid);
        fs.chmodSync(APP_RUN(), 0o770);
        if (key !== appRunFor) log('the app\'s folder in RAM: ' + APP_RUN() + ' (' + key + (who ? ', the app\'s program' : ', its data folder') + ')');
        appRunFor = key;
    } catch (e) { if (key !== appRunFor) { appRunFor = key; log('the app\'s folder in RAM: ' + e.message); } }
}

/** The app's control file and its folder: the newer of the one in RAM and the one in its data folder. */
function controlOf(app) {
    const a = readJson(path.join(APP_RUN(), 'control.json')), b = readJson(path.join(app.root, 'data', 'control.json'));
    const at = (c) => (c && typeof c === 'object' ? Date.parse(c.at) || 0 : -1);
    return a && at(a) >= at(b) ? { c: a, dir: APP_RUN() } : { c: b, dir: path.join(app.root, 'data') };
}

function wanted(app, now) {
    if (!app) return { view: 'none', config: null, why: 'the app is not installed' };
    const got = controlOf(app), c = got.c;
    if (!c || typeof c !== 'object') return { view: 'none', config: null, why: 'the app has not started yet' };
    const config = c.config && typeof c.config === 'object' ? c.config : null;
    const ar = c.ar && typeof c.ar === 'object' ? c.ar : null;
    const aux = c.aux && typeof c.aux === 'object' ? c.aux : null;
    const view = VIEWS.indexOf(c.view) >= 0 ? c.view : 'none';
    if (view === 'none') return { view, config, ar, aux, dir: got.dir, why: '' };
    const age = now - Date.parse(c.at);
    if (!(age >= -staleSlack() && age <= CFG.staleMs)) return { view: 'none', config, ar, aux, dir: got.dir, why: 'the app stopped confirming the view' };
    return { view, config, ar, aux, dir: got.dir, why: '' };
}
// the head unit sets its clock a while after it starts: a control file "from the future" by less than
// this is still the app's (the jump is seen by both at once; the next write is in step again)
function staleSlack() { return 1000; }

/** The config line for the decoder: only what it knows, numbers and short strings. */
function configLine(config) {
    if (!config) return null;
    const out = { op: 'config' };
    const str = ['target', 'klass', 'left', 'right', 'all', 'front'];
    const num = ['w', 'h', 'x', 'y', 'fps', 'exclusive', 'contend', 'persist', 'left_rot', 'right_rot', 'all_rot',
        'left_flip', 'right_flip', 'all_flip', 'left_sar', 'right_sar', 'all_sar', 'pair', 'pair_swap', 'left_round', 'right_round', 'left_rim', 'right_rim', 'front_rot', 'front_flip', 'front_sar', 'front_round'];
    str.forEach((k) => { if (typeof config[k] === 'string' && /^[a-z0-9_,]{1,40}$/i.test(config[k])) out[k] = config[k]; });
    num.forEach((k) => { if (Number.isFinite(config[k])) out[k] = Math.round(config[k]); });
    return JSON.stringify(out);
}

/** The decoder's "aux" line: the second view (a mirror camera on its own layer beside the front camera), or none. */
function auxLine(aux) {
    const out = { op: 'aux', side: 'none' };
    if (!aux || (aux.side !== 'left' && aux.side !== 'right')) return JSON.stringify(out);
    out.side = aux.side;
    if (typeof aux.target === 'string' && /^[a-z]{1,12}$/.test(aux.target)) out.target = aux.target;
    if (typeof aux.crop === 'string' && /^[0-9,]{7,24}$/.test(aux.crop)) out.crop = aux.crop;
    ['w', 'h', 'x', 'y', 'fps', 'rot', 'flip', 'sar', 'round', 'rim'].forEach((k) => { if (Number.isFinite(aux[k])) out[k] = Math.round(aux[k]); });
    return JSON.stringify(out);
}

let labelSeq = null;
function copyLabel(from, bytes, seq) {
    if (seq === labelSeq) return true;
    let fd = -1;
    try {
        fd = fs.openSync(from, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
        const st = fs.fstatSync(fd);
        if (!st.isFile() || st.size !== bytes) return false;
        const buf = Buffer.alloc(bytes);
        if (fs.readSync(fd, buf, 0, bytes, 0) !== bytes) return false;
        const to = path.join(CFG.run, 'label.bin');
        fs.writeFileSync(to + '.tmp', buf);
        fs.renameSync(to + '.tmp', to);
        labelSeq = seq;
        return true;
    } catch (e) { return false; } finally { if (fd >= 0) try { fs.closeSync(fd); } catch (e) { /* closed */ } }
}

/**
 * The decoder's "ar" line: what it draws on the front camera now.
 * ar: the app's (mode 'off' | 'marks' | 'route' | 'demo', the calibration, speed in km/h or -1);
 * nav: the navigation's last word ({ active, kind, angle, meters, exit, at: when }), or null; now: ms.
 * Between two distances from the navigation the turn comes nearer by the car's speed.
 */
function arLine(ar, nav, now, dataDir) {
    const out = { op: 'ar', mode: 'off' };
    if (!ar || typeof ar !== 'object') return JSON.stringify(out);
    const n = (k, lo, hi, d) => (Number.isFinite(ar[k]) ? Math.max(lo, Math.min(hi, Math.round(ar[k]))) : d);
    out.height_cm = n('height_cm', 20, 200, 70);
    out.pitch_x10 = n('pitch_x10', -200, 600, 80);
    out.fov = n('fov', 30, 200, 100);
    out.yaw_x10 = n('yaw_x10', -300, 300, 0);
    out.shift_cm = n('shift_cm', -150, 150, 0);
    out.curve = n('curve', 0, 100, 40);
    out.card = ar.card === 0 ? 0 : 1;
    out.white = ar.white === 0 ? 0 : 1;
    out.style = ar.style === 1 ? 1 : 0;
    out.fade = ar.fade === 1 ? 1 : 0;
    if (ar.mode === 'marks') { out.mode = 'marks'; return JSON.stringify(out); }
    if (ar.mode === 'demo') {
        // a made-up turn 90 m ahead coming nearer at 30 km/h, then the next: right, left, a roundabout
        const T = 13000, k = Math.floor(now / T) % 3, t = (now % T) / 1000;
        out.mode = 'route';
        out.kind = k === 2 ? 'roundabout' : 'turn';
        out.angle = k === 0 ? 90 : k === 1 ? -90 : 45;
        out.exit = k === 2 ? 2 : 0;
        out.meters = Math.max(0, Math.round(90 - t * 8.3));
        return JSON.stringify(out);
    }
    if (ar.mode !== 'route' || !nav || !nav.active || !nav.kind) return JSON.stringify(out);
    out.mode = 'route';
    out.kind = nav.kind;
    out.angle = Math.round(Number(nav.angle) || 0);
    out.exit = Math.round(Number(nav.exit) || 0);
    let m = Number.isFinite(nav.meters) ? nav.meters : -1;
    if (m >= 0 && Number.isFinite(ar.speed) && ar.speed > 0 && Number.isFinite(nav.at)) {
        const dt = Math.max(0, Math.min(8000, now - nav.at));
        m = Math.max(0, m - ar.speed / 3.6 * dt / 1000);
    }
    out.meters = m < 0 ? -1 : Math.round(m);
    // the road's name, as a picture the app drew beside its control file (label.bin: w x h bytes), copied to
    // this helper's own folder first (a plain file of that size only: never a link the app put there)
    const l = ar.label;
    if (dataDir && l && typeof l === 'object' && Number.isFinite(l.w) && Number.isFinite(l.h) && Number.isFinite(l.seq) && l.street === nav.street &&
        l.w >= 8 && l.w <= 1920 && l.h >= 8 && l.h <= 96 && copyLabel(path.join(dataDir, 'label.bin'), Math.round(l.w) * Math.round(l.h), l.seq)) {
        out.label = path.join(CFG.run, 'label.bin');
        out.label_w = Math.round(l.w);
        out.label_h = Math.round(l.h);
        out.label_seq = Math.round(l.seq);
    }
    return JSON.stringify(out);
}

/* ---------------- the service ---------------- */

function run() {
    try { fs.mkdirSync(CFG.run); } catch (e) { /* there */ }
    try { fs.mkdirSync(path.dirname(CFG.log)); } catch (e) { /* there */ }
    log('xinhan-cam ' + VERSION + ' (node ' + process.version + ')');

    let child = null, out = '', startedAt = 0, delay = 0, restartTimer = null, quitting = false;
    let native = null, nativeAt = 0, note = 'starting the decoder';
    let sentConfig = null, sentView = null, sentViewAt = 0;
    let pictures = null, picturesAt = 0, fps = 0;
    let lastWhy = null, lastApp;
    // the navigation reader (nav.js): started when the app first wants it, again 30 s after it ends
    let navChild = null, navOut = '', navDue = 0, sentAr = null, sentArAt = 0, sentAux = null, sentAuxAt = 0;
    const nav = { wanted: false, state: 'not started', ifaces: [], proxies: [], note: '', last: null, raw: '', at: 0 };
    const navLog = (m) => {
        const f = path.join(CFG.run, 'nav.log');      // RAM: written every second or so while a route runs
        try { if (fs.statSync(f).size > LOG_MAX) fs.renameSync(f, f + '.1'); } catch (e) { /* no file yet */ }
        try { fs.appendFileSync(f, new Date().toISOString() + ' ' + m + '\n'); } catch (e) { /* no folder (tests) */ }
    };
    function navLine(line, now) {
        let j;
        try { j = JSON.parse(line); } catch (e) { return; }
        // a value asked again every few seconds is logged only when it differs from the last one of its name
        const same = j.ev === 'value' && navLine.last && navLine.last[j.name] === j.value;
        if (j.ev === 'value') { navLine.last = navLine.last || {}; navLine.last[j.name] = j.value; }
        if (!same) navLog(line.length > 6000 ? line.slice(0, 6000) + '…' : line);
        if (j.ev === 'catalog') { nav.ifaces = (j.ifaces || []).map((i) => i.name); nav.state = nav.ifaces.length ? 'found' : 'no interface'; }
        else if (j.ev === 'proxy') { nav.proxies.push((j.ok ? 'ok ' : 'failed ') + String(j.iface).split('.').pop() + '@' + j.inst + (j.ok ? '' : ': ' + j.note)); if (j.ok) nav.state = 'reading'; }
        else if (j.ev === 'value') { if (/dart|maneuver|query/i.test(j.name)) nav.raw = String(j.value).slice(0, 400); }
        else if (j.ev === 'nav' && j.nav) { nav.last = Object.assign({}, j.nav, { at: now }); nav.at = now; }
        else if (j.ev === 'note') { nav.note = String(j.text).slice(0, 200); log('nav: ' + nav.note); }
    }
    function startNav(now) {
        navDue = now + 30000;
        nav.proxies = [];
        try {
            navChild = cp.spawn(process.execPath, [CFG.nav].concat(CFG.navArgs), { stdio: ['ignore', 'pipe', 'pipe'] });
        } catch (e) { nav.state = 'failed to start'; nav.note = String(e.message).slice(0, 200); navChild = null; return; }
        nav.state = 'starting';
        log('nav reader started (pid ' + navChild.pid + ')');
        const me = navChild;
        me.stdout.on('data', (d) => {
            navOut += d.toString('utf8');
            let i;
            while ((i = navOut.indexOf('\n')) >= 0) { const l = navOut.slice(0, i); navOut = navOut.slice(i + 1); if (l) navLine(l, Date.now()); }
            if (navOut.length > 200000) navOut = '';
        });
        me.stderr.on('data', (d) => navLog('stderr ' + d.toString('utf8').slice(0, 2000)));
        const gone = (why) => { if (navChild !== me) return; navChild = null; navOut = ''; nav.last = null; if (nav.state === 'reading' || nav.state === 'starting') nav.state = 'ended'; navDue = Date.now() + 30000; log('nav reader ended (' + why + ')'); };
        me.on('error', (e) => gone(e.message));
        me.on('exit', (code, sig) => gone(sig || 'code ' + code));
    }

    function writeStatus(now) {
        const app = findApp(now);
        const body = {
            at: new Date(now).toISOString(), version: VERSION, app: app ? app.id : null,
            view: sentView || 'none', fps, note: child ? '' : note,
            native: child && native && now - nativeAt < 3000 ? native : null,
            nav: { wanted: nav.wanted, state: nav.state, ifaces: nav.ifaces.slice(0, 6), proxies: nav.proxies.slice(-4), note: nav.note, raw: nav.raw,
                last: nav.last, age: nav.last ? now - nav.last.at : -1 },
        };
        try {
            fs.writeFileSync(STATUS_FILE() + '.tmp', JSON.stringify(body));
            fs.chmodSync(STATUS_FILE() + '.tmp', 0o644);
            fs.renameSync(STATUS_FILE() + '.tmp', STATUS_FILE());
        } catch (e) { /* /run not there (tests without it) */ }
    }

    function onStatus(j, now) {
        native = j;
        nativeAt = now;
        if (typeof j.pictures === 'number') {
            if (pictures !== null && now - picturesAt >= 900) {
                fps = Math.round((j.pictures - pictures) * 1000 / (now - picturesAt));
                if (fps < 0) fps = 0;
                pictures = j.pictures;
                picturesAt = now;
            } else if (pictures === null) { pictures = j.pictures; picturesAt = now; }
        }
        writeStatus(now);
    }

    function start() {
        restartTimer = null;
        if (quitting || child) return;
        if (!fs.existsSync(CFG.bin)) {
            note = 'mgu-sidecam is missing (' + CFG.bin + ')';
            log(note);
            restartTimer = setTimeout(start, RESTART_MAX_MS);
            return;
        }
        startedAt = Date.now();
        sentConfig = null; sentView = null; sentAr = null; sentAux = null; native = null; pictures = null; fps = 0;
        // can it start here at all? (--version only loads it: a library or symbol the head unit lacks shows
        // up now, with the loader's own words, which the app's page then shows)
        if (!/\.js$/.test(CFG.bin)) {
            const probe = cp.spawnSync(CFG.bin, ['--version'], { timeout: 10000, encoding: 'utf8' });
            if (probe.error || probe.status !== 0) {
                const said = String((probe.stderr || '') + (probe.error ? probe.error.message : '')).split('\n').filter(Boolean)[0] || 'exit ' + probe.status;
                note = 'mgu-sidecam cannot start on this head unit: ' + said.slice(0, 200);
                log(note);
                writeStatus(Date.now());
                restartTimer = setTimeout(start, RESTART_MAX_MS);
                return;
            }
            if (!start.said) { start.said = true; log('mgu-sidecam ' + String(probe.stdout).trim()); }
        }
        let c;
        try {
            c = /\.js$/.test(CFG.bin) ? cp.spawn(process.execPath, [CFG.bin].concat(CFG.args), { stdio: ['pipe', 'pipe', 'inherit'] })
                : cp.spawn(CFG.bin, CFG.args, { stdio: ['pipe', 'pipe', 'inherit'] });
        } catch (e) { ended('spawn: ' + e.message); return; }
        child = c;
        log('mgu-sidecam started (pid ' + c.pid + ')');
        c.on('error', (e) => { if (child === c) ended('error: ' + e.message); });
        c.on('close', (code, sig) => { if (child === c) ended('exit ' + code + (sig ? ' ' + sig : '')); });
        c.stdin.on('error', () => { /* it ended with a line on its way */ });
        c.stdout.on('data', (d) => {
            out += d;
            if (out.length > 262144 && out.indexOf('\n') < 0) out = '';
            for (let n; (n = out.indexOf('\n')) >= 0; out = out.slice(n + 1)) {
                let j = null;
                try { j = JSON.parse(out.slice(0, n)); } catch (e) { continue; }
                if (j && j.ev === 'status') onStatus(j, Date.now());
            }
        });
    }

    function ended(why) {
        const now = Date.now();
        child = null; out = ''; native = null;
        delay = now - startedAt < YOUNG_MS ? Math.min(RESTART_MAX_MS, (delay || RESTART_MS / 2) * 2) : RESTART_MS;
        note = 'the decoder ended (' + why + '), again in ' + Math.round(delay / 1000) + ' s';
        log('mgu-sidecam ended (' + why + '): again in ' + delay + ' ms');
        writeStatus(now);
        if (!quitting) restartTimer = setTimeout(start, delay);
    }

    function send(line) {
        if (!child) return false;
        try { child.stdin.write(line + '\n'); return true; } catch (e) { return false; }
    }

    function tick() {
        const now = Date.now();
        const app = findApp(now);
        appRunDir(app, now);
        const w = wanted(app, now);
        if ((app ? app.id : null) !== lastApp) { lastApp = app ? app.id : null; log(app ? 'app ' + app.id + ' at ' + app.root : 'the app is not installed'); }
        if (w.why !== lastWhy) { lastWhy = w.why; if (w.why) log('no view: ' + w.why); }
        if (child) {
            const cl = configLine(w.config);
            if (cl && cl !== sentConfig && send(cl)) sentConfig = cl;
            // what is drawn on the front camera: when it changes, at most 5 times a second
            const al = arLine(w.view === 'front' ? w.ar : null, nav.last, now, w.dir || null);
            if (al !== sentAr && now - sentArAt >= 200 && send(al)) { sentAr = al; sentArAt = now; }
            // the second view: with the front camera only; when it changes, and once a second while on
            const xl = auxLine(w.view === 'front' ? w.aux : null);
            if (xl !== sentAux || (w.view === 'front' && w.aux && now - sentAuxAt >= 1000)) {
                if (send(xl)) { sentAux = xl; sentAuxAt = now; }
            }
            // the view: when it changes, and once a second while one is on (the decoder drops a view
            // nobody confirms for 3 s)
            if (w.view !== sentView || (w.view !== 'none' && now - sentViewAt >= 1000)) {
                if (send(JSON.stringify({ op: 'view', side: w.view }))) {
                    if (w.view !== sentView) log('view ' + w.view);
                    sentView = w.view;
                    sentViewAt = now;
                }
            }
        }
        nav.wanted = !!(w.ar && w.ar.nav);
        if (nav.wanted && !navChild && now >= navDue) startNav(now);
        if (!nav.wanted && navChild) { try { navChild.kill(); } catch (e) { /* gone */ } }
        // the decoder writes the status with each of its lines; without it, this does, every second
        if (!child || now - nativeAt > 1500) { if (now - (tick.wrote || 0) >= 1000) { tick.wrote = now; writeStatus(now); } }
    }

    const quit = () => {
        quitting = true;
        if (restartTimer) clearTimeout(restartTimer);
        if (child) { try { child.stdin.end(); } catch (e) { /* gone */ } }
        if (navChild) { try { navChild.kill(); } catch (e) { /* gone */ } }
        try { fs.unlinkSync(STATUS_FILE()); } catch (e) { /* none */ }
        setTimeout(() => process.exit(0), 300);
    };
    process.on('SIGTERM', quit);
    process.on('SIGINT', quit);

    start();
    const timer = setInterval(tick, CFG.pollMs);
    return { stop: () => { clearInterval(timer); quit(); } };
}

if (require.main === module) {
    const cmd = process.argv[2] || 'run';
    if (cmd === 'run') run();
    else if (cmd === 'status') process.stdout.write((() => { try { return fs.readFileSync(STATUS_FILE(), 'utf8') + '\n'; } catch (e) { return '{}\n'; } })());
    else { process.stderr.write('usage: node xinhan-cam.js run|status\n'); process.exit(2); }
}

module.exports = { VERSION, CFG, findApp, wanted, configLine, arLine, auxLine, appRunDir, run, _reset: () => { appCache = null; appScanAt = 0; appRunFor = null; labelSeq = null; procOf = null; procAt = 0; } };
