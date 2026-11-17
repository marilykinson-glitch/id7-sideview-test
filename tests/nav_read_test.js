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
    console.log(fail.length ? 'nav_read_test: ' + fail.length + ' FAILED' : 'nav_read_test: all ok');
    process.exit(fail.length ? 1 : 0);
}, 7000);
