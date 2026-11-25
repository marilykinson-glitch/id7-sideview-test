'use strict';
/** tools/xinhan-cam/nav.js "read" against a made-up catalogue, generator and binding: node tests/nav_read_test.js */
const cp = require('child_process'), fs = require('fs'), os = require('os'), path = require('path');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'navread-'));
const N = 'de.bmw.infotainment.navigation.guiding.';
fs.writeFileSync(path.join(dir, 'catalog.json'), JSON.stringify({ interfaces: {
    [N + 'Guidance']: { fields: { conclusiveDart: {}, guidanceState: {}, guidingProvider: {} } },
    [N + 'GuidanceEventList']: { methods: { setViewConfig: {}, queryContent: {} } },
    'de.bmw.other.Vehicle': {} }, datatypes: {} }));
const env = Object.assign({}, process.env, { XINHAN_CATALOG: path.join(dir, 'catalog.json'), XINHAN_GEN: path.join(__dirname, 'fake', 'gen.js'), XINHAN_SOMEIP: path.join(__dirname, 'fake', 'someip.js') });
const p = cp.spawn(process.execPath, [path.join(__dirname, '..', 'tools', 'xinhan-cam', 'nav.js'), 'read'], { env, stdio: ['ignore', 'pipe', 'inherit'] });
let out = '';
p.stdout.on('data', (d) => { out += d; });
setTimeout(() => {
    p.kill();
    const ev = out.split('\n').filter(Boolean).map((l) => JSON.parse(l));
    const fail = [];
    const check = (ok, what) => { console.log((ok ? '  ok   ' : '  FAIL ') + what); if (!ok) fail.push(what); };
    check(ev.some((e) => e.ev === 'catalog' && e.ifaces.length === 2), 'both guidance interfaces are found in the catalogue');
    check(ev.filter((e) => e.ev === 'proxy' && e.ok).length === 2, 'both are opened');
    check(ev.some((e) => e.ev === 'note' && /request shape typed false answered/.test(e.text)), 'the event list is asked in each shape until one is answered');
    const navs = ev.filter((e) => e.ev === 'nav').map((e) => e.nav);
    const last = navs[navs.length - 1] || {};
    check(last.active === true && last.kind === 'turn' && last.angle === -90 && last.meters === 120 && last.provider === 'ANDROID_AUTO', 'the phone\'s turn: left in 120 m, from Android Auto: ' + JSON.stringify(last));
    check(ev.filter((e) => e.ev === 'value' && e.name === 'queryContent').length === 1, 'an unchanged reply is reported once');
    // second run: transient empty replies during CarPlay/Google Maps step refresh do NOT flap active false, then sustained errors clear
    const env2 = Object.assign({}, env, { FAKE_EMPTY_BLIP: '2', FAKE_STOP_AFTER: '4', XINHAN_NAV_ERR_LIMIT: '3', XINHAN_NAV_EMPTY_LIMIT: '4' });
    const p2 = cp.spawn(process.execPath, [path.join(__dirname, '..', 'tools', 'xinhan-cam', 'nav.js'), 'read'], { env: env2, stdio: ['ignore', 'pipe', 'inherit'] });
    let out2 = '';
    p2.stdout.on('data', (d) => { out2 += d; });
    setTimeout(() => {
        p2.kill();
        const ev2 = out2.split('\n').filter(Boolean).map((l) => JSON.parse(l));
        const navs2 = ev2.filter((e) => e.ev === 'nav').map((e) => e.nav);
        const sawTurn = navs2.some((n) => n.active === true && n.kind === 'turn');
        const turnIdx = navs2.findIndex((n) => n.active === true && n.kind === 'turn');
        const afterTurn = turnIdx >= 0 ? navs2.slice(turnIdx) : [];
        const noMidFlap = afterTurn.length === 2 && afterTurn[0].active === true && afterTurn[1].active === false;
        const cleared = (navs2[navs2.length - 1] || {}).active === false && (navs2[navs2.length - 1] || {}).kind === null;
        check(sawTurn && noMidFlap && cleared, 'transient empty CarPlay replies do not flap active false, and sustained errors clear stale turn: ' + JSON.stringify(afterTurn));
        console.log(fail.length ? 'nav_read_test: ' + fail.length + ' FAILED' : 'nav_read_test: all ok');
        process.exit(fail.length ? 1 : 0);
    }, 9500);
}, 7000);
