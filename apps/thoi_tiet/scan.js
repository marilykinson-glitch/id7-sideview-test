'use strict';
/**
 * scan.js - finds how the car's own apps fill their home-screen widgets (the names of the layout and its cells), to show on the
 * screen: the car has no log we can read. Looks in the OAP apps' JavaScript (setValue calls beside "widget") and in every
 * rhmiDataStartWidget uiDescription on the car. Read only; stops after a few seconds. Node 8.
 */
const fs = require('fs');
const path = require('path');

const OAP = process.env.TT_OAP || '/var/opt/public/oap', MAINAPPS = process.env.TT_OAP ? [] : ['/usr/lib/oap-mainapp', '/usr/lib/oap-mainapp21'];
const ls = (d) => { try { return fs.readdirSync(d); } catch (e) { return []; } };
const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch (e) { return false; } };
const read = (f, max) => { try { const st = fs.statSync(f); if (!st.isFile() || st.size > (max || 3e6)) return null; return fs.readFileSync(f, 'utf8'); } catch (e) { return null; } };

/** Every .js under dir (depth <= 6, no node_modules/kit), as paths. */
function jsFiles(dir, depth, out) {
    ls(dir).forEach((n) => {
        if (n === 'node_modules' || n === 'kit') return;
        const p = path.join(dir, n);
        if (/\.js$/.test(n)) out.push(p); else if (depth > 0 && isDir(p)) jsFiles(p, depth - 1, out);
    });
    return out;
}
/** The uiDescription.json of every start widget folder under root (depth <= 3): [{ where, widgets: [{ name, cells }] }]. */
function widgetDescs(root, depth, out) {
    ls(root).forEach((n) => {
        const p = path.join(root, n);
        if (!isDir(p)) return;
        if (/StartWidget/i.test(n)) {
            const t = read(path.join(p, 'uiDescription', 'uiDescription.json'), 1e6) || read(path.join(p, 'uiDescription.json'), 1e6);
            if (t) { try { out.push({ where: p, ui: JSON.parse(t) }); } catch (e) { /* not JSON */ } }
        } else if (depth > 0) widgetDescs(p, depth - 1, out);
    });
    return out;
}

/** Runs the scan; done(lines) gets at most `max` text lines. */
function run(done, max) {
    const lines = [], t0 = Date.now(), seen = {};
    const add = (s) => { if (!seen[s] && lines.length < (max || 14)) { seen[s] = 1; lines.push(s); } };
    // 1. the widget folders of the car's apps: their layout and cells
    const descs = [];
    ls(OAP).filter((n) => /^oap_/.test(n)).forEach((n) => widgetDescs(path.join(OAP, n), 2, descs));
    MAINAPPS.forEach((m) => widgetDescs(m, 3, descs));
    descs.forEach((d) => {
        const comps = [];
        const walk = (o) => { if (o && typeof o === 'object') { if (o.type === 'startWidget' && o.cells) comps.push(o); Object.keys(o).forEach((k) => walk(o[k])); } };
        walk(d.ui);
        comps.forEach((c) => {
            const cells = Object.keys(c.cells).map((k) => k + '=' + String((c.cells[k] && c.cells[k].value) !== undefined ? c.cells[k].value : '').slice(0, 40)).join(' ');
            add('uiDescription ' + d.where.replace(/^\/(var\/opt\/public|usr\/lib)\//, '').slice(-46) + ': ' + cells);
        });
    });
    if (!descs.length) add('không thấy thư mục rhmiDataStartWidget nào của xe');
    // 2. the JavaScript of the OAP apps: setValue(spawn, 'Cell', ...) in a file about widgets
    const files = [];
    ls(OAP).filter((n) => /^oap_/.test(n)).forEach((n) => jsFiles(path.join(OAP, n, 'source', 'javascript'), 5, files));
    let i = 0;
    const step = () => {
        const until = Date.now() + 40;
        while (i < files.length && Date.now() < until) {
            const f = files[i++], t = /thoi_tiet/.test(f) ? null : read(f, 3e6);
            if (!t || !/idget/.test(t)) continue;
            const names = {};
            t.replace(/setValue\([^;]{0,120}?['"]([A-Za-z][A-Za-z0-9_]{2,40})['"]/g, (m, a) => { names[a] = 1; return m; });
            t.replace(/['"](BackgroundImage\d*|Widget\w*Image\w*|\w*Image\d*|Text\d\w*|Header\w*|Title\w*)['"]/g, (m, a) => { if (/idget|Background|Image|Text\d|Header|Title/.test(a)) names[a] = 1; return m; });
            const k = Object.keys(names).slice(0, 8);
            if (k.length) add(f.replace(OAP + '/', '').replace('/source/javascript', '').slice(-40) + ': ' + k.join(' '));
        }
        if (i < files.length && Date.now() - t0 < 12000) return setTimeout(step, 5);
        add('(đã xem ' + i + '/' + files.length + ' tệp JavaScript trong ' + Math.round((Date.now() - t0) / 100) / 10 + ' giây)');
        return done(lines);
    };
    setTimeout(step, 0);
}

module.exports = { run, widgetDescs, jsFiles };
