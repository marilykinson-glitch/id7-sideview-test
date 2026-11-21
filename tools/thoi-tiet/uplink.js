'use strict';
/**
 * uplink.js - how this tool reaches the internet on the car. The Store's uplink (mgu-uplink) lets out only the uids it
 * lists, never root, and the system resolver (127.0.0.1) answers no internet names: the uplink's own DNS servers are in
 * /run/mgu-uplink/lease.json. So every request runs in a child as a uid of ours (this file with --fetch; the request
 * on its stdin, {status, body} or {error} on its stdout), and the uid is written where the uplink looks
 * (/var/opt/mgu-uplink/uids.d/thoi-tiet, and state/internet-uids for the deploy tool). The way of picking the uid is
 * the one the Store's updater and RideTube use: the lowest free number above MainApp's app uid ranges.
 * Node 8, no dependencies.
 */
const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const https = require('https');
const url = require('url');

const SELF = 'thoi-tiet';
const MAX_UID = 60000;
const MAINAPPS = [{ root: '/usr/lib/oap-mainapp', hmi: 'HmiMain3D' }, { root: '/usr/lib/oap-mainapp21', hmi: 'Hmi8' }];
const lines = (f) => { try { return fs.readFileSync(f, 'utf8').split('\n'); } catch (e) { return []; } };
const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return null; } };
const list = (d) => { try { return fs.readdirSync(d); } catch (e) { return []; } };
const isId = (n) => n > 0 && n === Math.floor(n);
const mkdirp = (d) => { if (fs.existsSync(d)) return; mkdirp(path.dirname(d)); try { fs.mkdirSync(d); } catch (e) { if (e.code !== 'EEXIST') throw e; } };

/** Where things are on the car (tests point them elsewhere). */
function options(over) {
    return Object.assign({
        stateDir: '/var/opt/thoi-tiet/state', etcDir: '/etc', oapRoot: '/var/opt/public/oap', toolRoot: '/var/opt', procDir: '/proc', mainapps: MAINAPPS,
        lease: '/run/mgu-uplink/lease.json', fetchCmd: [process.execPath, __filename, '--fetch'], noSetuid: false, log: () => {},
    }, over || {});
}

// MainApp's app uid ranges [{min,max}] and own uids, from the config of the MainApp the unit runs; null unknown
function mainappRanges(o) {
    const have = o.mainapps.filter((m) => fs.existsSync(path.join(m.root, 'config', 'base.json')));
    let m = have.length === 1 ? have[0] : null;
    if (have.length > 1) {
        const running = list(o.procDir).filter((n) => /^\d+$/.test(n)).map((n) => (lines(path.join(o.procDir, n, 'comm'))[0] || '').trim());
        const which = have.filter((x) => running.indexOf(x.hmi) >= 0);
        m = which.length === 1 ? which[0] : null;
    }
    const c = m && readJson(path.join(m.root, 'config', 'base.json'));
    if (!c) return null;
    const rse = c.usableUidsAndGidsRse || {};
    const ranges = [c.usableUidsAndGids].concat(Object.keys(rse).map((k) => rse[k]))
        .filter((r) => r && isId(Number(r.min)) && Number(r.max) >= Number(r.min)).map((r) => ({ min: Number(r.min), max: Number(r.max) }));
    return ranges.length ? { ranges, own: (Array.isArray(c.mainAppUids) ? c.mainAppUids : []).map(Number).filter(isId) } : null;
}
// every uid and gid in use: /etc/passwd and group, OAP apps, other components' uplink drop-ins, the updater's, MainApp's own; procs: running ones
function takenIds(o, cfg, procs) {
    const ids = {};
    const add = (v) => { const n = Number(v); if (String(v).trim() !== '' && isId(n)) ids[n] = true; };
    lines(path.join(o.etcDir, 'passwd')).forEach((l) => { const f = l.split(':'); add(f[2] || ''); add(f[3] || ''); });
    lines(path.join(o.etcDir, 'group')).forEach((l) => add(l.split(':')[2] || ''));
    list(o.oapRoot).forEach((n) => { const m = /^oap_(\d+)$/.exec(n); if (m) add(m[1]); });
    const mgr = path.join(o.oapRoot, 'oap_12201');
    list(path.join(mgr, 'data', 'apps')).forEach((n) => { const e = readJson(path.join(mgr, 'data', 'apps', n)); add(e && e.userId !== undefined ? e.userId : ''); });
    lines(path.join(mgr, 'security', 'uids.txt')).forEach((l) => add(l.split('=')[0]));
    const dropins = path.join(o.toolRoot, 'mgu-uplink', 'uids.d');
    list(dropins).filter((n) => n !== SELF && !/^\./.test(n)).forEach((n) => lines(path.join(dropins, n)).forEach((l) => l.split('#')[0].split(/[\s,]+/).forEach(add)));
    const upd = readJson(path.join(o.toolRoot, 'mgu-updater', 'state', 'uids.json')) || {};
    Object.keys(upd).forEach((k) => add(upd[k]));
    (cfg ? cfg.own : []).forEach(add);
    if (procs) {
        list(o.procDir).filter((n) => /^\d+$/.test(n)).forEach((pid) => lines(path.join(o.procDir, pid, 'status')).forEach((l) => {
            const m = /^[UG]id:\s+(.*)$/.exec(l);
            if (m) m[1].split(/\s+/).forEach(add);
        }));
    }
    return ids;
}
function writeIfChanged(file, text, mode) {
    try { if (fs.readFileSync(file, 'utf8') === text) return; } catch (e) { /* not there yet */ }
    fs.writeFileSync(file + '.tmp', text, { mode });
    fs.renameSync(file + '.tmp', file);
}
/** The kept uid while nothing else holds it, else a new pick; written for the uplink. null: none (the log says why). */
function pickUid(o) {
    const kept = Number((readJson(path.join(o.stateDir, 'uids.json')) || {}).fetch);
    const cfg = mainappRanges(o);
    const inRange = (u) => !!cfg && cfg.ranges.some((r) => u >= r.min && u <= r.max);
    let uid = null;
    if (isId(kept) && !takenIds(o, cfg, false)[kept] && !inRange(kept)) uid = kept;
    else if (cfg) {
        const all = takenIds(o, cfg, true);
        let u = Math.max.apply(null, cfg.ranges.map((r) => r.max)) + 1;
        while (u <= MAX_UID && (all[u] || inRange(u))) u++;
        if (u <= MAX_UID) { uid = u; o.log('internet uid: ' + u + (isId(kept) ? ' (' + kept + ' is taken)' : '')); }
    }
    if (uid === null) { o.log('internet uid: none: ' + (cfg ? 'no free uid below ' + MAX_UID : "MainApp's config/base.json (its app uid ranges) cannot be read")); return null; }
    if (!fs.existsSync(o.stateDir)) { mkdirp(path.dirname(o.stateDir)); fs.mkdirSync(o.stateDir, 0o700); }
    writeIfChanged(path.join(o.stateDir, 'uids.json'), JSON.stringify({ fetch: uid }) + '\n', 0o644);
    writeIfChanged(path.join(o.stateDir, 'internet-uids'), uid + '\n', 0o644);
    const uplink = path.join(o.toolRoot, 'mgu-uplink');
    if (fs.existsSync(path.join(uplink, 'current')) || fs.existsSync(path.join(uplink, 'uids.d'))) {
        try { mkdirp(path.join(uplink, 'uids.d')); writeIfChanged(path.join(uplink, 'uids.d', SELF), uid + '\n', 0o644); } catch (e) { o.log('internet uid: uplink drop-in: ' + e.message); }
    }
    return uid;
}

/** One GET in a child as `uid`: {status, body}. Killed past the timeout. */
function fetchRequest(o, uid, req) {
    return new Promise((resolve, reject) => {
        let child;
        try {
            const ids = o.noSetuid ? {} : { uid, gid: uid };
            child = cp.spawn(o.fetchCmd[0], o.fetchCmd.slice(1), Object.assign(ids, { cwd: '/', env: {}, stdio: ['pipe', 'pipe', 'ignore'] }));
        } catch (e) { return reject(e); }
        const chunks = []; let size = 0, done = false;
        const finish = (e, v) => { if (done) return; done = true; clearTimeout(timer); if (e) { try { child.kill('SIGKILL'); } catch (x) { /* gone */ } reject(e); } else resolve(v); };
        const timer = setTimeout(() => finish(new Error('timeout')), (req.timeoutMs || 15000) + 1000);
        child.on('error', finish);
        child.stdin.on('error', () => { /* it died: close says */ });
        child.stdout.on('data', (c) => { size += c.length; if (size > 6e6) return finish(new Error('answer too big')); chunks.push(c); return undefined; });
        child.on('close', () => {
            let r = null;
            try { r = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch (e) { /* none */ }
            if (!r) return finish(new Error('fetch helper gave no answer'));
            if (r.error) return finish(new Error(r.error));
            return finish(null, { status: r.status, body: String(r.body) });
        });
        child.stdin.end(JSON.stringify(req));
    });
}

/** The uplink's DNS servers (its lease): the system resolver answers no internet names. No lease: the system resolver. */
function uplinkLookup(leaseFile) {
    const servers = ((readJson(leaseFile || '/run/mgu-uplink/lease.json') || {}).dns || []).filter((x) => typeof x === 'string');
    if (!servers.length) return undefined;
    const r = new (require('dns').Resolver)();
    r.setServers(servers);
    return function (host, opts, cb) {
        if (typeof opts === 'function') cb = opts;
        r.resolve4(host, (e, a) => (e ? cb(e) : cb(null, a[0], 4)));
    };
}

/** The helper itself (as the uid): { host, path, timeoutMs } -> an HTTPS GET, certificate checked. */
function get(q, lookup) {
    return new Promise((resolve, reject) => {
        let done = false, size = 0;
        const fail = (e) => { if (!done) { done = true; clearTimeout(timer); reject(e); } };
        const req = https.request({ host: String(q.host), path: String(q.path), method: 'GET', headers: { 'User-Agent': 'thoi-tiet/1', Accept: 'application/json' }, lookup }, (res) => {
            const chunks = [];
            res.on('data', (c) => { size += c.length; if (size > 2e6) { fail(new Error('answer too large')); req.abort(); return; } chunks.push(c); });
            res.on('end', () => { if (done) return; done = true; clearTimeout(timer); resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }); });
            res.on('error', fail);
        });
        const timer = setTimeout(() => { fail(new Error('timeout')); req.abort(); }, q.timeoutMs || 15000);
        req.on('error', fail);
        req.end();
    });
}

if (require.main === module && process.argv[2] === '--fetch') {
    let input = '';
    const out = (o) => process.stdout.write(JSON.stringify(o), () => process.exit(0));
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (d) => { input += d; });
    process.stdin.on('end', () => {
        let q;
        try { q = JSON.parse(input); } catch (e) { return out({ error: 'bad request' }); }
        if (!/^[a-z0-9.-]+$/i.test(String(q.host)) || String(q.path).charAt(0) !== '/') return out({ error: 'bad request' });
        return get(q, uplinkLookup(q.lease)).then(out, (e) => out({ error: e.code ? e.code + ' ' + e.message : e.message }));
    });
}

module.exports = { options, pickUid, fetchRequest, uplinkLookup, get, mainappRanges, takenIds, SELF };
