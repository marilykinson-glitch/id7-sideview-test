'use strict';
/** A stand-in for tools/xinhan-cam/nav.js in the system test: prints the nav state found in a file whenever it changes. */
const fs = require('fs');
const file = process.argv[2];
let last = '';
process.stdout.write(JSON.stringify({ ev: 'catalog', ifaces: [{ name: 'de.bmw.test.Guidance', fields: ['conclusiveDart'], broadcasts: [], methods: [] }] }) + '\n');
process.stdout.write(JSON.stringify({ ev: 'proxy', iface: 'de.bmw.test.Guidance', inst: '1', ok: true, note: '' }) + '\n');
setInterval(() => {
    let s = '';
    try { s = fs.readFileSync(file, 'utf8').trim(); } catch (e) { return; }
    if (!s || s === last) return;
    last = s;
    process.stdout.write(JSON.stringify({ ev: 'value', iface: 'de.bmw.test.Guidance', name: 'conclusiveDart', value: s }) + '\n');
    process.stdout.write(JSON.stringify({ ev: 'nav', nav: JSON.parse(s) }) + '\n');
}, 50);
