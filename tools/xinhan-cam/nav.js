'use strict';
/**
 * nav.js - the navigation's next turn, read from the head unit's own guidance service.
 *
 * BMW's navigation, and the phone's (CarPlay, Android Auto) where the head unit takes its turns, publish
 * the next manoeuvre on the unit's SOME/IP bus: an interface named ...Guidance with the fields
 * conclusiveDart (the next manoeuvre), a guidance state and the guiding provider. Which names and ids this
 * unit has is in its catalogue (/etc/oap/someip/someip-interfaces.json), so nothing is fixed here: the
 * interface is looked for by name, described by the unit's own generator (oapgen-gen.js) and asked through
 * the unit's own binding (/usr/lib/someip.node), read only. No setter and no method is called.
 *
 * A phone's guidance (CarPlay, Android Auto) leaves that field on a placeholder and the state inactive: its
 * turns are in a second interface, ...GuidanceEventList, which has no field to watch. It is asked once a
 * second with its query method (queryContent: "the next four manoeuvres ahead of the car", which changes
 * nothing: no view of the HMI's is touched), and the first way-ahead event of the reply is the turn.
 *
 * Run as a child of xinhan-cam.js (a crash of the native binding then never takes the camera down):
 *   node nav.js read      prints one JSON line per event:
 *     {"ev":"catalog","ifaces":[{name,fields,broadcasts,methods}]}      what the catalogue has
 *     {"ev":"proxy","iface","inst","ok","note"}
 *     {"ev":"value","iface","name","value":<the decoded value, cut>}     every change of a watched field
 *     {"ev":"nav","nav":{active,kind,angle,meters,exit,provider,state}}  what it means (maneuver())
 *     {"ev":"note","text"}
 * Also the pure parts, for the tests: findInterfaces, enumTables, maneuver, navOf.
 * Node 8.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');

const CATALOG = process.env.XINHAN_CATALOG || '/etc/oap/someip/someip-interfaces.json';
const SOMEIP = process.env.XINHAN_SOMEIP || '/usr/lib/someip.node';
const GEN = process.env.XINHAN_GEN || path.join(__dirname, 'oapgen-gen.js');

/* ---------------- the catalogue ---------------- */

/** The guidance interfaces of a catalogue: [{ name, fields: [..], broadcasts: [..], methods: [..] }]. */
function findInterfaces(db) {
    const all = (db && db.interfaces) || {};
    return Object.keys(all).filter((n) => /(^|\.)Guidance[A-Za-z0-9]*$/.test(n) || /guiding/i.test(n)).map((name) => {
        const i = all[name] || {};
        return { name, fields: Object.keys(i.fields || {}), broadcasts: Object.keys(i.broadcasts || i.events || {}), methods: Object.keys(i.methods || {}) };
    });
}

/** Which of an interface's fields to watch: the next manoeuvre, the state, the provider. */
function pickFields(iface) {
    const f = iface.fields || [];
    const first = (re) => f.filter((n) => re.test(n))[0];
    const out = {};
    const dart = first(/^conclusiveDart$/i) || first(/conclusive/i) || first(/dart/i) || first(/maneuver|manoeuvre/i);
    const state = first(/^guidanceStateWithReason$/i) || first(/^guidanceState$/i) || first(/guidanceState/i);
    const provider = first(/guidingProvider/i) || first(/provider/i);
    if (dart) out.dart = dart;
    if (state) out.state = state;
    if (provider) out.provider = provider;
    return out;
}

/**
 * Number -> name tables of the catalogue's enums that say which way a turn goes, which unit a distance
 * has and so on, for bindings that hand enums over as numbers: { direction: {2: 'LEFT', ..}, unit: {..} }.
 */
function enumTables(db) {
    const types = (db && db.datatypes) || {};
    const out = { direction: {}, unit: {}, any: {} };
    Object.keys(types).forEach((k) => {
        const d = types[k];
        if (!d || d.type !== 'enum' || !d.items) return;
        const names = Object.keys(d.items);
        const table = {};
        names.forEach((n) => { const v = d.items[n]; table[typeof v === 'object' && v ? v.value : v] = n; });
        if (names.indexOf('SLIGHT_LEFT') >= 0 && names.indexOf('UTURN_LEFT') >= 0 && !Object.keys(out.direction).length) out.direction = table;
        if (names.indexOf('METER') >= 0 && names.indexOf('KM') >= 0 && !Object.keys(out.unit).length) out.unit = table;
    });
    return out;
}

/* ---------------- what a value means ---------------- */

const DIR = {
    NONE: 0, STRAIGHT_ON: 0, STRAIGHT: 0, SLIGHT_LEFT: -30, LEFT: -90, HARD_LEFT: -135, SHARP_LEFT: -135, UTURN_LEFT: -180,
    SLIGHT_RIGHT: 30, RIGHT: 90, HARD_RIGHT: 135, SHARP_RIGHT: 135, UTURN_RIGHT: 180, UTURN: -180,
};
const TO_M = { METER: 1, M: 1, KM: 1000, KILOMETER: 1000, FEET: 0.3048, FT: 0.3048, YARD: 0.9144, YD: 0.9144, MILE_UK: 1609.344, MILE_US: 1609.344, MILE: 1609.344 };
// union members that are the way ahead; every other one (speed cameras, traffic, lane hints, placeholders) is not a turn
const KINDS = { intersection: 'turn', branch: 'turn', roundabout: 'roundabout', destinationManeuver: 'destination', alongMainRoad: 'straight', tunnel: 'straight' };

const enumName = (v, table) => {
    if (typeof v === 'string') return v.toUpperCase();
    if (v && typeof v === 'object') {
        if (typeof v.name === 'string') return v.name.toUpperCase();
        if (typeof v.value === 'string') return v.value.toUpperCase();
        if (typeof v.value === 'number') v = v.value;
    }
    if (typeof v === 'number' && table && table[v] !== undefined) return String(table[v]).toUpperCase();
    return null;
};

/** The object inside v (a decoded dart, however the binding shapes unions) that is the manoeuvre: { tag, body }. */
function findBody(v, depth, tag) {
    if (!v || typeof v !== 'object' || depth > 6) return null;
    if (!Array.isArray(v) && (v.formattedDistance !== undefined || v.rawDistance !== undefined || v.distanceToDestination !== undefined) &&
        (v.direction !== undefined || v.branchType !== undefined || v.exitNumber !== undefined || v.isCheckeredFlag !== undefined ||
            v.mainRoadDirection !== undefined || v.guidingStep !== undefined)) {
        return { tag: tag || null, body: v };
    }
    // a union as { type: 'intersection', value: {...} } or { intersection: {...} }
    const named = typeof v.type === 'string' ? v.type : typeof v.member === 'string' ? v.member : typeof v.selected === 'string' ? v.selected : null;
    const keys = Array.isArray(v) ? v.map((x, i) => i) : Object.keys(v);
    for (let i = 0; i < keys.length; i++) {
        const k = keys[i];
        const child = v[k];
        if (!child || typeof child !== 'object') continue;
        const t = KINDS[k] ? k : named && (k === 'value' || k === 'data') ? named : tag;
        const hit = findBody(child, depth + 1, t);
        if (hit) return hit;
    }
    return null;
}

/**
 * A decoded conclusiveDart -> { kind: 'turn' | 'roundabout' | 'destination' | 'straight' | null, angle, meters, exit }.
 * kind null: not a way-ahead manoeuvre (nothing, a placeholder, a speed camera, ...). angle: degrees, negative
 * left; meters: to it, or -1.
 */
function maneuver(dart, tables, textOnly) {
    const t = tables || {};
    const hit = findBody(dart, 0, null);
    if (!hit) return { kind: null, angle: 0, meters: -1, exit: 0 };
    const b = hit.body;
    let kind = hit.tag ? KINDS[hit.tag] || null : null;
    if (!hit.tag) {
        kind = b.direction !== undefined || b.branchType !== undefined ? 'turn' : b.exitNumber !== undefined ? 'roundabout'
            : b.isCheckeredFlag !== undefined ? 'destination' : b.mainRoadDirection !== undefined ? 'straight' : null;
    }
    if (!kind) return { kind: null, angle: 0, meters: -1, exit: 0 };
    let angle = 0, exit = 0;
    if (kind === 'turn') {
        const d = enumName(b.direction !== undefined ? b.direction : b.branchType, t.direction);
        if (d && DIR[d] !== undefined) angle = DIR[d];
        else if (d && /LEFT/.test(d)) angle = /SLIGHT|KEEP|BEAR/.test(d) ? -30 : -90;
        else if (d && /RIGHT/.test(d)) angle = /SLIGHT|KEEP|BEAR/.test(d) ? 30 : 90;
        if (!angle) kind = 'straight';
    } else if (kind === 'roundabout') {
        exit = Number(b.exitNumber) || 0;
    }
    let meters = -1;
    const fd = b.formattedDistance;
    if (fd && typeof fd === 'object') {
        // a phone's rawDistance is not the distance (textOnly): its text and unit are
        if (!textOnly && typeof fd.rawDistance === 'number' && fd.rawDistance >= 0 && fd.rawDistance < 1e7) meters = fd.rawDistance;
        else {
            const n = parseFloat(String(fd.distance || '').replace(',', '.'));
            const u = enumName(fd.unit, t.unit);
            if (Number.isFinite(n) && u && TO_M[u]) meters = n * TO_M[u];
        }
    }
    if (meters < 0 && !textOnly && typeof b.rawDistance === 'number' && b.rawDistance >= 0) meters = b.rawDistance;
    const out = { kind, angle, meters: meters < 0 ? -1 : Math.round(meters), exit };
    // the road's name, where the unit gives one: the description's text elements
    const desc = b['description'];
    const els = desc && Array.isArray(desc.elements) ? desc.elements : [];
    const street = els.map((e) => (e && typeof e.text === 'string' ? e.text : e && typeof e.value === 'string' && (e.type === undefined || e.type === 'text') ? e.value : '')).filter(Boolean).join(' ').trim().slice(0, 60);
    if (street) out.street = street;
    return out;
}

/** The events of a queryContent reply, wherever the binding puts them: the first array named eventsInView. */
function eventsOf(reply, depth) {
    if (!reply || typeof reply !== 'object' || (depth || 0) > 5) return [];
    if (Array.isArray(reply.eventsInView)) return reply.eventsInView;
    const keys = Object.keys(reply);
    for (let i = 0; i < keys.length; i++) {
        const v = reply[keys[i]];
        if (v && typeof v === 'object') { const e = eventsOf(v, (depth || 0) + 1); if (e.length) return e; }
    }
    return [];
}
/** The phone's next turn from a queryContent reply: the first way-ahead event that has a distance; kind null: none. */
function eventManeuver(reply, tables) {
    const list = eventsOf(reply, 0);
    for (let i = 0; i < list.length; i++) {
        const m = maneuver({ maneuver: list[i] }, tables, true);
        if (m.kind && m.meters >= 0) return m;
    }
    return { kind: null, angle: 0, meters: -1, exit: 0 };
}

/**
 * The request of queryContent: the next manoeuvres ahead of the car's position. shape: how this binding
 * writes a union ('keyed': { member: value }, 'typed': { type, value }); numeric: enums as numbers.
 */
function queryRequest(shape, numeric) {
    const E = numeric ? { CCP: 0, INCLUDE_ACTIVE_MANEUVERS: 1, INCLUDE_DESTINATIONS: 2, INCLUDE_TUNNELS: 7, INCLUDE_ALONG_MAIN_ROAD: 18 } : null;
    const e = (n) => (E ? E[n] : n);
    const anchor = shape === 'typed' ? { type: 'standardReferencePoint', value: e('CCP') } : { standardReferencePoint: e('CCP') };
    return { viewConfigs: [{
        viewport: { startPoint: { anchorPoint: anchor, offsets: [] }, maxElementCount: 4, endPoints: [],
            includedTypes: ['INCLUDE_ACTIVE_MANEUVERS', 'INCLUDE_DESTINATIONS', 'INCLUDE_TUNNELS', 'INCLUDE_ALONG_MAIN_ROAD'].map(e) },
        options: [], minimumUpdateIntervalMs: 0, segmentItemRasterLength: 0,
    }] };
}

/** The guidance's whole state from the last values of its fields: { active, kind, angle, meters, exit, provider, state }. */
function navOf(values, tables) {
    let m = maneuver(values.dart, tables);
    // nothing from the car's own guidance: the phone's, from the event list
    if (!m.kind && values.events) m = eventManeuver(values.events, tables);
    const state = enumName(values.state && typeof values.state === 'object' && values.state.state !== undefined ? values.state.state : values.state, null);
    const provider = enumName(values.provider, null);
    const off = state && /INACTIVE|NOT_ACTIVE|OFF|STOPPED|NONE/.test(state);
    // a phone's guidance leaves the car's own state inactive: a real manoeuvre with a distance counts by itself
    const active = !!m.kind && (m.meters >= 0 || !off);
    return Object.assign({ active, kind: m.kind, angle: m.angle, meters: m.meters, exit: m.exit, provider: provider || '', state: state || '' }, m.street ? { street: m.street } : {});
}

/* ---------------- reading it on the unit ---------------- */

const cut = (s, n) => { s = String(s); return s.length > n ? s.slice(0, n) + '…' : s; };
const say = (o) => { try { process.stdout.write(JSON.stringify(o) + '\n'); } catch (e) { /* the parent went */ } };
const within = (p, ms, what) => Promise.race([p, new Promise((r, j) => setTimeout(() => j(new Error(what + ': no answer in ' + ms + ' ms')), ms))]);

function describe(iface, attributes, tmp, n, methods) {
    const dir = path.join(tmp, String(n));
    fs.mkdirSync(dir);
    const proxies = {};
    proxies[iface] = { instances: '*' };
    if (attributes) proxies[iface].attributes = attributes;
    if (methods) proxies[iface].methods = methods;
    fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ proxies, services: {} }));
    cp.execFileSync(process.execPath, [GEN, CATALOG, path.join(dir, 'manifest.json'), '0', path.join(dir, 'out')], { stdio: ['ignore', 'pipe', 'pipe'], timeout: 30000 });
    return JSON.parse(fs.readFileSync(path.join(dir, 'out', iface.replace(/\./g, '_') + '.json'), 'utf8'));
}

async function read() {
    let db;
    try { db = JSON.parse(fs.readFileSync(CATALOG, 'utf8')); } catch (e) { say({ ev: 'note', text: 'no catalogue: ' + cut(e.message, 160) }); return; }
    const ifaces = findInterfaces(db);
    say({ ev: 'catalog', ifaces: ifaces.map((i) => ({ name: i.name, fields: i.fields.slice(0, 60), broadcasts: i.broadcasts.slice(0, 40), methods: i.methods.slice(0, 40) })) });
    const tables = enumTables(db);
    db = null;
    let someip;
    try { someip = require(SOMEIP); } catch (e) { say({ ev: 'note', text: 'no someip binding: ' + cut(e.message, 160) }); return; }
    let tmp;
    try { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'xinhan-nav-')); } catch (e) { tmp = fs.mkdtempSync('/run/xinhan-nav-'); }
    const values = {};
    let last = '';
    const changed = () => {
        const nav = navOf(values, tables);
        const s = JSON.stringify(nav);
        if (s !== last) { last = s; say({ ev: 'nav', nav }); }
    };
    let n = 0, up = 0;
    for (const iface of ifaces) {
        const pick = pickFields(iface);
        const names = Object.keys(pick);
        // the event list: no field, a query method
        const qm = /EventList/i.test(iface.name) ? (iface.methods || []).filter((x) => /^queryContent$/i.test(x))[0] || (iface.methods || []).filter((x) => /query/i.test(x))[0] : null;
        if (qm) {
            let cfg;
            try { cfg = describe(iface.name, null, tmp, n++, [qm]); } catch (e) {
                say({ ev: 'proxy', iface: iface.name, inst: '', ok: false, note: 'description: ' + cut(String(e.stderr || '') + e.message, 300) });
                continue;
            }
            say({ ev: 'note', text: 'event list ' + qm + ': ' + cut(JSON.stringify((cfg.methods || {})[qm] || Object.keys(cfg)), 600) });
            for (const inst of Object.keys(cfg.instances || { 1: 1 })) {
                let p;
                try {
                    p = await within(someip.buildProxy(cfg, String(inst)).then((px) => px.init().then(() => px)), 6000, 'proxy');
                } catch (e) { say({ ev: 'proxy', iface: iface.name, inst, ok: false, note: cut(e && e.message || e, 200) }); continue; }
                up++;
                say({ ev: 'proxy', iface: iface.name, inst, ok: true, note: 'method ' + qm });
                // the request's shape is tried out: as the unit's own values came in (a union keyed or typed), then the others
                const tries = [['keyed', false], ['typed', false], ['keyed', true], ['typed', true]];
                let good = -1, at = 0, busy = false, fails = 0, lastErr = '', lastReply = '';
                setInterval(() => {
                    if (busy) return;
                    // the car's own guidance is on: its field has the turn
                    if (maneuver(values.dart, tables).kind) return;
                    const d = values.dart && values.dart.maneuver;
                    const first = d && typeof d === 'object' && typeof d.type === 'string' ? 1 : 0;
                    const k = good >= 0 ? good : (at + first) % tries.length;
                    busy = true;
                    let done;
                    try { done = Promise.resolve(p.callMethod(qm, queryRequest(tries[k][0], tries[k][1]), 3000)); } catch (e) { done = Promise.reject(e); }
                    within(done, 4000, qm).then((r) => {
                        busy = false;
                        if (good < 0) { good = k; say({ ev: 'note', text: 'event list: request shape ' + tries[k].join(' ') + ' answered' }); }
                        values.events = r;
                        // (the unit numbers every answer anew, uid: an answer that differs in that alone is the same one)
                        const s = cut(JSON.stringify(r), 3000), same = s.replace(/"uid":"?\d+"?/g, '');
                        if (same !== lastReply) { lastReply = same; say({ ev: 'value', iface: iface.name, name: qm, value: s }); }
                        changed();
                    }, (e) => {
                        busy = false;
                        const msg = cut(e && e.message || e, 200);
                        if (good < 0) at++;
                        else if (++fails > 20) { good = -1; fails = 0; }
                        if (msg !== lastErr) { lastErr = msg; say({ ev: 'note', text: 'event list ' + tries[k].join(' ') + ': ' + msg }); }
                    });
                }, 1000);
            }
            continue;
        }
        if (!pick.dart) continue;
        const attributes = {};
        names.forEach((k) => { attributes[pick[k]] = 'rs'; });
        let cfg;
        try { cfg = describe(iface.name, attributes, tmp, n++); } catch (e) {
            say({ ev: 'proxy', iface: iface.name, inst: '', ok: false, note: 'description: ' + cut(String(e.stderr || '') + e.message, 300) });
            continue;
        }
        for (const inst of Object.keys(cfg.instances || { 1: 1 })) {
            let p;
            try {
                p = await within(someip.buildProxy(cfg, String(inst)).then((px) => px.init().then(() => px)), 6000, 'proxy');
            } catch (e) { say({ ev: 'proxy', iface: iface.name, inst, ok: false, note: cut(e && e.message || e, 200) }); continue; }
            up++;
            say({ ev: 'proxy', iface: iface.name, inst, ok: true, note: 'fields ' + names.map((k) => pick[k]).join(', ') });
            names.forEach((k) => {
                const got = (v) => {
                    values[k] = v;
                    say({ ev: 'value', iface: iface.name, name: pick[k], value: cut(JSON.stringify(v), 3000) });
                    changed();
                };
                try { Promise.resolve(p.subscribe({ name: pick[k], onReceive: got })).catch((e) => say({ ev: 'note', text: pick[k] + ' subscribe: ' + cut(e && e.message || e, 160) })); } catch (e) { say({ ev: 'note', text: pick[k] + ' subscribe: ' + cut(e.message, 160) }); }
                const get = () => { try { p.getValue(pick[k], 3000).then(got).catch(() => {}); } catch (e) { /* no getter */ } };
                setTimeout(get, 500);
                // asked again now and then: a missed event never leaves an old turn standing
                setInterval(get, 5000);
            });
        }
    }
    try { cp.execFileSync('rm', ['-rf', tmp]); } catch (e) { /* a temp folder */ }
    if (!up) { say({ ev: 'note', text: ifaces.length ? 'no guidance interface could be opened' : 'the catalogue has no guidance interface' }); setTimeout(() => process.exit(0), 200); }
}

if (require.main === module && process.argv[2] === 'read') {
    process.on('uncaughtException', (e) => { say({ ev: 'note', text: 'error: ' + cut(e && e.stack || e, 300) }); process.exit(1); });
    process.on('unhandledRejection', (e) => say({ ev: 'note', text: 'rejected: ' + cut(e && e.message || e, 200) }));
    read().catch((e) => { say({ ev: 'note', text: 'error: ' + cut(e && e.stack || e, 300) }); process.exit(1); });
}

module.exports = { findInterfaces, pickFields, enumTables, maneuver, navOf, eventManeuver, queryRequest };
