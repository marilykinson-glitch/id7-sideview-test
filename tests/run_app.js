'use strict';
/**
 * run_app.js - runs the app (apps/xinhan_cam/main.js, as it is) on the PC against a stand-in for the
 * app kit and the car, for tests/system_test.py:
 *
 *   node tests/run_app.js <data dir>      (XINHAN_STATUS: the helper's status file)
 *
 * stdin, one JSON object a line:
 *   {"light":[0,{...}]}      an indicator event (0: StatusFunctionsIndicators, 1: ...2)
 *   {"speed":1920}           statusCarSpeed2's raw value
 *   {"click":"BTN_LEFT"}     a button of the page
 *   {"set":["mode","single"]} a setting
 *   {"ecu":{...}}            the camera unit's state from now on (as CurrentState reports it)
 *   {"visible":true}         the page opened / closed
 *   {"shutdown":true}        MainApp stops the app
 * stdout: {"ui":[name,text]}, {"log":[level,text]}, {"ecu":[call,...]} lines.
 * The stand-in camera unit: ECU_NAMES=0 refuses enum names (numbers only), ECU_DELAY ms before a
 * requested view is on, ECU_OBEYS=0 never follows.
 */
const fs = require('fs');
const path = require('path');
const Module = require('module');
const EventEmitter = require('events');

const APP = path.join(__dirname, '..', 'apps', 'xinhan_cam');
const dataDir = path.resolve(process.argv[2]);
const spec = JSON.parse(fs.readFileSync(path.join(APP, 'app.json'), 'utf8'));
const out = (o) => process.stdout.write(JSON.stringify(o) + '\n');

/* ---- the camera unit ---- */
const NAMES = process.env.ECU_NAMES !== '0', DELAY = Number(process.env.ECU_DELAY || 150), OBEYS = process.env.ECU_OBEYS !== '0';
let ecu = { application: 'OFF', mode: 'MODE_NONE', perspective: 0 };
let cookies = 100;
const isNum = (v) => typeof v === 'number';
const icam = {
    getValue: (f) => (f === 'currentState' ? Promise.resolve(ecu) : Promise.reject(new Error('no field ' + f))),
    callMethod: (method, a) => {
        out({ ecu: [method, a] });
        if (method === 'clientAttach') {
            if (!NAMES && !isNum(a.type)) return Promise.reject(new Error('cannot serialize enum'));
            if (a.type !== 'CLIENT_INDIRECT' && a.type !== 1) return Promise.reject(new Error('bad client type'));
            return Promise.resolve({ cookie: cookies++ });
        }
        if (method === 'changeState') {
            const d = a.desiredState;
            if (!NAMES && !isNum(d.application)) return Promise.reject(new Error('cannot serialize enum'));
            const ok = (d.application === 'DR_ACTIVE' || d.application === 51) && (d.mode === 'MODE_MOSAIK' || d.mode === 50);
            if (!ok || a.cookie < 100) return Promise.reject(new Error('bad request'));
            if (OBEYS && !/^(RFK|TOPREARVIEW)$/.test(String(ecu.application))) {
                const p = d.perspective === 7 ? 9 : d.perspective;
                setTimeout(() => { ecu = { application: 'DR_ACTIVE', mode: 'MODE_MOSAIK', perspective: p }; }, DELAY);
            }
            return Promise.resolve({});
        }
        if (method === 'clientDetach') return Promise.resolve({});
        return Promise.reject(new Error('no method ' + method));
    },
};
const xv = { getValue: (f) => (f === 'CurrentState' ? Promise.resolve(ecu) : Promise.reject(new Error('no field ' + f))) };

/* ---- the kit ---- */
const watchers = {};
const signals = {
    watch(iface, instance, handlers) { watchers[iface] = handlers; return Promise.resolve({ iface, available: true, error: null }); },
    proxy(iface) {
        if (/ICAM2Proxy$/.test(iface)) return Promise.resolve(icam);
        if (/XView3D$/.test(iface)) return Promise.resolve(xv);
        return Promise.reject(new Error('no SOME/IP config for ' + iface));
    },
    call(p, method, params) { return p.callMethod(method, params || {}); },
};
const values = {}, listeners = [];
spec.settings.forEach((s) => { values[s.key] = s.default; });
const settings = {
    schema: spec.settings,
    get: (k) => values[k],
    set(k, v) { values[k] = v; listeners.forEach((fn) => fn(k, v)); },
    onChange(fn) { listeners.push(fn); },
};
const clicks = {}, vis = [];
let visible = false;
const ui = {
    text(name, text) { out({ ui: [name, text] }); return Promise.resolve(); },
    onClick(name, fn) { clicks[name] = fn; },
    onVisible(fn) { vis.push(fn); },
    isVisible: () => visible,
};
const log = {};
['info', 'warn', 'error', 'debug'].forEach((l) => { log[l] = function () { out({ log: [l, Array.prototype.slice.call(arguments).join(' ')] }); }; });
const app = new EventEmitter();
const ctx = { ui, settings, log, signals, dataDir, app, spec };
const mgu = { run(impl) { return Promise.resolve().then(() => impl.start(ctx)).catch((e) => { out({ log: ['error', 'start: ' + (e && e.stack || e)] }); process.exit(1); }); } };

const load = Module._load;
Module._load = function (request, parent) {
    if (request === './kit/mgu' && parent && parent.filename === path.join(APP, 'main.js')) return mgu;
    return load.apply(this, arguments);
};
require(path.join(APP, 'main.js'));

let buf = '';
process.stdin.on('data', (d) => {
    buf += d;
    for (let n; (n = buf.indexOf('\n')) >= 0; buf = buf.slice(n + 1)) {
        let c;
        try { c = JSON.parse(buf.slice(0, n)); } catch (e) { continue; }
        if (c.light) { const h = watchers['de.bmw.body.Light']; h[c.light[0] ? 'StatusFunctionsIndicators2' : 'StatusFunctionsIndicators'](c.light[1]); }
        if (c.speed !== undefined) watchers['de.bmw.infotainment.vehicle.Vehicle2'].statusCarSpeed2({ speedVehicleCentreOfGravity: c.speed });
        if (c.click) Promise.resolve().then(() => clicks[c.click]({}));
        if (c.set) settings.set(c.set[0], c.set[1]);
        if (c.ecu) ecu = c.ecu;
        if (c.visible !== undefined) { visible = !!c.visible; vis.forEach((fn) => fn('MAIN', visible)); }
        if (c.shutdown) { app.emit('shutdown'); setTimeout(() => process.exit(0), 200); }
    }
});
process.stdin.on('end', () => process.exit(0));
