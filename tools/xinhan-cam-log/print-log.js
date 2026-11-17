'use strict';
/**
 * print-log.js - prints what the Camera xi nhan helper knows about the navigation, for the MGU Store's log
 * (the Store runs this once when the tool is installed; its phone page shows it under Logs: updater).
 * Read only. Lines are cut into pieces of 700 characters, repeated values are left out. Node 8.
 */
const fs = require('fs');
const DIR = process.env.XINHAN_LOG_DIR || '/var/opt/xinhan-cam';
const STATUS = process.env.XINHAN_STATUS || '/run/xinhan-cam/status.json';
const PIECE = 700;
let n = 0;
const out = (tag, text) => {
    text = String(text);
    for (let i = 0; i < text.length || i === 0; i += PIECE) {
        console.log('XNC ' + tag + (text.length > PIECE ? ' [' + (Math.floor(i / PIECE) + 1) + '/' + Math.ceil(text.length / PIECE) + '] ' : ' ') + text.slice(i, i + PIECE));
        n++;
    }
};
const lines = (f) => { try { return fs.readFileSync(f, 'utf8').split('\n').filter(Boolean); } catch (e) { return null; } };

out('==', 'Camera xi nhan: nhat ky dan duong, ' + new Date().toISOString());
try {
    const st = JSON.parse(fs.readFileSync(STATUS, 'utf8'));
    out('status', JSON.stringify({ version: st.version, app: st.app, view: st.view, nav: st.nav }));
} catch (e) { out('status', 'khong doc duoc ' + STATUS + ': ' + e.message); }

// nav.log (and the one before it): the catalogue and proxy lines once each, every different value, newest last
const nav = (lines(DIR + '/nav.log.1') || []).concat(lines(DIR + '/nav.log') || []);
if (!nav.length) out('nav', 'chua co nav.log: bat muc "Mui ten dan duong" trong app, chay dan duong roi cai lai cong cu nay');
const seen = new Set(), keep = [];
nav.forEach((l) => {
    const body = l.replace(/^\S+ /, '');            // without the time
    let key = body;
    try { const j = JSON.parse(body); if (j.ev === 'nav') key = 'nav' + JSON.stringify(Object.assign({}, j.nav, { meters: 0 })); } catch (e) { /* a plain line */ }
    if (seen.has(key)) return;
    seen.add(key);
    keep.push(l);
});
// at most 400 pieces: the first 40 lines (what the unit has) and the newest of the rest
const head = keep.slice(0, 40), tail = keep.slice(40);
let budget = 400;
const show = [];
for (let i = tail.length - 1; i >= 0 && budget > 0; i--) { budget -= Math.ceil(tail[i].length / PIECE); show.unshift(tail[i]); }
head.concat(show).forEach((l) => out('nav', l));

const h = lines(DIR + '/xinhan-cam.log') || [];
h.slice(-60).forEach((l) => out('helper', l));
out('==', 'het (' + n + ' dong)');
