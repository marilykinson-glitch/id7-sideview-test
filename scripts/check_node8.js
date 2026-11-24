'use strict';
/**
 * check_node8.js - the head unit runs Node 8.16: every script that runs there must parse as ES2017
 * and use nothing newer from the library.  node scripts/check_node8.js   (needs acorn: NODE_PATH)
 */
const fs = require('fs');
const path = require('path');
const acorn = require('acorn');

const ROOT = path.join(__dirname, '..');
const FILES = ['apps/xinhan_cam/main.js', 'apps/xinhan_cam/logic.js', 'apps/xinhan_cam/camera.js', 'apps/xinhan_cam/ui.js', 'tools/xinhan-cam/xinhan-cam.js', 'tools/xinhan-cam/nav.js', 'tools/xinhan-cam-log/print-log.js', 'tools/xinhan-cam/oapgen-gen.js',
    'apps/anh_dai_dien/main.js', 'apps/anh_dai_dien/ui.js', 'apps/anh_dai_dien/preview.js', 'tools/anh-dai-dien/anh-dai-dien.js', 'tools/anh-dai-dien/wbm.js', 'tools/anh-dai-dien/boot.js', 'tools/anh-dai-dien/res.js', 'tools/anh-dai-dien/car3d.js', 'tools/anh-dai-dien/carpaint.js',
    'apps/thoi_tiet/main.js', 'apps/thoi_tiet/ui.js', 'apps/thoi_tiet/weather.js', 'apps/thoi_tiet/icons.js', 'apps/thoi_tiet/icons3d.js', 'apps/thoi_tiet/fx.js', 'tools/thoi-tiet/thoi-tiet.js', 'tools/thoi-tiet/pos.js', 'tools/thoi-tiet/uplink.js'];
// newer than Node 8: optional catch binding and spread are syntax (the parser finds them); these are library
const NEWER = [/\.finally\(/, /\.flat\(/, /\.flatMap\(/, /Object\.fromEntries/, /recursive:\s*true/, /\.matchAll\(/, /\.trimStart\(|\.trimEnd\(/,
    /globalThis/, /\bBigInt\b/, /\.allSettled\(/, /\.replaceAll\(/, /\.at\(-?\d/, /fs\.promises|require\('fs\/promises'\)/, /\.rmSync\(/, /queueMicrotask/,
    /TextDecoder|TextEncoder/, /new URL\(/, /worker_threads/, /\.description\b/];
let bad = 0;
FILES.forEach((f) => {
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
    try { acorn.parse(src, { ecmaVersion: 2017, sourceType: 'script' }); } catch (e) { console.log(f + ': not ES2017: ' + e.message); bad++; }
    src.split('\n').forEach((line, i) => NEWER.forEach((re) => {
        if (re.test(line.replace(/\/\/.*$/, ''))) { console.log(f + ':' + (i + 1) + ': newer than Node 8: ' + line.trim().slice(0, 100)); bad++; }
    }));
});
console.log(bad ? 'check_node8: ' + bad + ' problem(s)' : 'check_node8: ' + FILES.length + ' files ok for Node 8');
process.exit(bad ? 1 : 0);
