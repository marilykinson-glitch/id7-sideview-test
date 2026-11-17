'use strict';
/** A stand-in for the head unit's interface generator: writes a config naming what the manifest asks for. */
const fs = require('fs'), path = require('path');
const [, manifest, , out] = process.argv.slice(2);
const m = JSON.parse(fs.readFileSync(manifest, 'utf8'));
fs.mkdirSync(out);
Object.keys(m.proxies).forEach((id) => {
    const methods = {};
    (m.proxies[id].methods || []).forEach((k) => { methods[k] = { id: 4 }; });
    fs.writeFileSync(path.join(out, id.replace(/\./g, '_') + '.json'), JSON.stringify({ name: id, instances: { 128: {} }, fields: m.proxies[id].attributes || {}, methods }));
});
