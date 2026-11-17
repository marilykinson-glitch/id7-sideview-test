'use strict';
/**
 * xinhan-cam.js - the root helper of the Camera xi nhan app (apps/xinhan_cam): keeps the decoder
 * (mgu-sidecam, beside this file) running and passes on what the app wants.
 *
 *   the app   -> <its folder>/data/control.json   { at, seq, view, config }
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

const VERSION = '0.4.0';
const env = (k, d) => (process.env[k] !== undefined && process.env[k] !== '' ? process.env[k] : d);
const CFG = {
    oap: env('XINHAN_OAP', '/var/opt/public/oap'),
    run: env('XINHAN_RUN', '/run/xinhan-cam'),
    bin: env('XINHAN_BIN', path.join(__dirname, 'mgu-sidecam')),
    args: env('XINHAN_ARGS', '').split(' ').filter(Boolean),
    pollMs: Number(env('XINHAN_POLL_MS', 50)),
    staleMs: Number(env('XINHAN_STALE_MS', 2000)),
    log: env('XINHAN_LOG', '/var/opt/xinhan-cam/xinhan-cam.log'),
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
function wanted(app, now) {
    if (!app) return { view: 'none', config: null, why: 'the app is not installed' };
    const c = readJson(path.join(app.root, 'data', 'control.json'));
    if (!c || typeof c !== 'object') return { view: 'none', config: null, why: 'the app has not started yet' };
    const config = c.config && typeof c.config === 'object' ? c.config : null;
    const view = VIEWS.indexOf(c.view) >= 0 ? c.view : 'none';
    if (view === 'none') return { view, config, why: '' };
    const age = now - Date.parse(c.at);
    if (!(age >= -staleSlack() && age <= CFG.staleMs)) return { view: 'none', config, why: 'the app stopped confirming the view' };
    return { view, config, why: '' };
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
        'left_flip', 'right_flip', 'all_flip', 'left_sar', 'right_sar', 'all_sar', 'pair', 'pair_swap', 'left_round', 'right_round', 'front_rot', 'front_flip', 'front_sar', 'front_round'];
    str.forEach((k) => { if (typeof config[k] === 'string' && /^[a-z0-9_,]{1,40}$/i.test(config[k])) out[k] = config[k]; });
    num.forEach((k) => { if (Number.isFinite(config[k])) out[k] = Math.round(config[k]); });
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

    function writeStatus(now) {
        const app = findApp(now);
        const body = {
            at: new Date(now).toISOString(), version: VERSION, app: app ? app.id : null,
            view: sentView || 'none', fps, note: child ? '' : note,
            native: child && native && now - nativeAt < 3000 ? native : null,
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
        sentConfig = null; sentView = null; native = null; pictures = null; fps = 0;
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
        const w = wanted(app, now);
        if ((app ? app.id : null) !== lastApp) { lastApp = app ? app.id : null; log(app ? 'app ' + app.id + ' at ' + app.root : 'the app is not installed'); }
        if (w.why !== lastWhy) { lastWhy = w.why; if (w.why) log('no view: ' + w.why); }
        if (child) {
            const cl = configLine(w.config);
            if (cl && cl !== sentConfig && send(cl)) sentConfig = cl;
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
        // the decoder writes the status with each of its lines; without it, this does, every second
        if (!child || now - nativeAt > 1500) { if (now - (tick.wrote || 0) >= 1000) { tick.wrote = now; writeStatus(now); } }
    }

    const quit = () => {
        quitting = true;
        if (restartTimer) clearTimeout(restartTimer);
        if (child) { try { child.stdin.end(); } catch (e) { /* gone */ } }
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

module.exports = { VERSION, CFG, findApp, wanted, configLine, run, _reset: () => { appCache = null; appScanAt = 0; } };
