'use strict';
const assert = require('assert'), fs = require('fs'), path = require('path'), vm = require('vm'), Module = require('module');
const ROOT = path.join(__dirname, '..'), K = path.join(ROOT, 'kit/runtime');
const load = Module._load;
Module._load = function (r, p, m) { return load.call(this, /^\.\/kit\//.test(r) ? path.join(K, r.slice(6)) : r, p, m); };
const Icons = require('../apps/thoi_tiet/icons3d'), { Canvas } = require(path.join(K, 'canvas'));
Module._load = load;
const sun = Icons.make('clear', true, 160, 160, 160);
assert.strictEqual(sun.d[(20 * 160 + 80) * 4 + 3], 0, 'remove opaque brown matte');
assert.strictEqual(sun.d[(80 * 160 + 80) * 4 + 3], 255, 'preserve sun body');
let start, tick, snapshot, render, view, actions, command, rejectTemp = false, now = Date.now();
const cells = {}, assets = {}, Wx = require('../apps/thoi_tiet/weather');
class Clock extends Date { static now() { return now; } }
vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'apps/thoi_tiet/main.js'), 'utf8'), {
    require: (r) => {
        if (r === 'fs') return { readFileSync: (f) => { if (/weather.json$/.test(f)) return JSON.stringify(snapshot); throw new Error('missing'); }, writeFileSync: (f, value) => { if (/command.json.tmp$/.test(f)) command = JSON.parse(value); }, renameSync: () => {} };
        if (r === './kit/mgu') return { run: (app) => { start = app.start; } };
        if (r === './kit/gauges') return {};
        if (r === './kit/canvas') return { Canvas };
        if (r === './ui') return { W: 1, H: 1, draw: (cv, g, t, v, a) => { view = v; actions = a; } };
        if (r === './weather') return Wx;
        if (r === './icons3d') return Icons;
        return require(r);
    }, process: { env: {} }, Date: Clock,
});
const day = { dow: 1, code: 0, hi: 30, lo: 20, pop: 10 }, sunDay = { dow: 0, code: 0, hi: 31, lo: 21, pop: 10 };
const data = { key: 'here', here: true, name: 'HCM', current: { code: 0, t: 28, day: true }, daily: [day, day, day, sunDay] };
(async () => {
    snapshot = { at: now, places: [data] };
    await start({ dataDir: '/tmp/fake-weather', log: { info: () => {}, warn: () => {}, error: () => {} },
        ui: { isVisible: () => true, image: async () => {} }, theme: () => ({}), canvas: () => new Canvas(1, 1), loop: (_, fps, fn) => { render = fn; return { kick: fn }; },
        widget: { loop: (_, fn) => { tick = fn; }, set: (_, cell, value) => { if (cell === 'TextTemp' && rejectTemp) { rejectTemp = false; return Promise.reject(new Error('transient')); } cells[cell] = value; }, asset: (_, cell, cv) => { assets[cell] = cv; } },
    });
    await tick({ spawnId: 1 });
    assert.strictEqual(cells.TextDayliDetail1, 'Mai · 20°');
    assert.strictEqual(cells.TextDayliDetail2, 'T2 · 20°');
    assert.strictEqual(cells.TextDayliDetail3, 'CN · 21°');
    assert.strictEqual(cells.TextTempDayDetail3, '31°');
    actions.setUnit('F');
    await tick({ spawnId: 1 });
    assert.strictEqual(cells.TextDayliDetail1, 'Mai · 68°');
    assert.strictEqual(cells.TextTempDayDetail1, '86°');
    actions.setUnit('C');
    await tick({ spawnId: 1 });
    now += 1000; data.daily = [day, day]; snapshot.at = now;
    await tick({ spawnId: 1 });
    assert.strictEqual(cells.TextDayliDetail3, ''); assert.strictEqual(cells.TextTempDayDetail3, '');
    assert.ok(assets.IconDayliDetail3.d.every((v) => v === 0), 'clear old icon when forecast is missing');
    now += 9000;
    await tick({ spawnId: 1 });
    assert.strictEqual(cells.TextTemp, ''); assert.strictEqual(cells.TextRainProbability, '');
    assert.ok(assets.IllustrationActualWeather.d.every((v) => v === 0), 'stopped helper clears weather image');
    snapshot.at = now; data.daily = [day, Object.assign({}, day, { hi: null, lo: null })];
    now += 1000; snapshot.at = now; await tick({ spawnId: 1 });
    assert.strictEqual(cells.TextTemp, '28'); assert.strictEqual(cells.TextDayliDetail1, 'Mai'); assert.strictEqual(cells.TextTempDayDetail1, '–');
    snapshot.places = [null]; now += 1000; snapshot.at = now; await tick({ spawnId: 1 });
    assert.strictEqual(cells.TextTemp, '');
    // A failed write is retried on the next tick; it must never enter the sent cache.
    snapshot.places = [data]; now += 1000; snapshot.at = now; rejectTemp = true;
    await assert.rejects(tick({ spawnId: 1 }), /transient/);
    await tick({ spawnId: 1 }); assert.strictEqual(cells.TextTemp, '28');
    const a = { key: 'c1_2', name: 'Custom A', lat: 1, lon: 2 }, b = { key: 'c3_4', name: 'Custom B', lat: 3, lon: 4 };
    snapshot.custom = [a, b]; snapshot.seq = 1; now += 1000; snapshot.at = now; await render();
    actions.togglePlace(a.key); actions.closePick(); await render();
    assert.ok(view.places.some((p) => p.key === a.key));
    snapshot.custom = [b]; snapshot.seq = 2; snapshot.lastAdded = ''; now += 1000; snapshot.at = now; await render();
    assert.ok(!view.places.some((p) => p.key === a.key), 'phone deletion removes selected custom place');
    actions.refresh(); await render();
    assert.strictEqual(command.cmd, 'refresh');
    assert.ok(command.places.every((p) => p.key !== a.key), 'refresh carries the latest selection even before places command is polled');
    console.log('widget: matte, missing days/data, helper recovery, invalid values, write retry, custom deletion and latest refresh selection passed');
})().catch((e) => { console.error(e); process.exitCode = 1; });
