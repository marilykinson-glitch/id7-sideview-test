
'use strict';
/**
 * fx.js - the moving weather behind the numbers: sun with turning rays, drifting clouds, falling rain, snow, fog,
 * lightning, stars, and wind streaks when it blows. One function, a pure draw of the picture at time `time` (seconds):
 *   draw(cv, G, kind, day, wind, x, y, w, h, time)
 * kind: an icon name from weather.describe(); wind: km/h. Everything stays inside the box (it is clipped when the
 * canvas can). The shapes are few on purpose (the car draws this about eight times a second).
 */
const rnd = (i, k) => { const s = Math.sin(i * 127.1 + k * 311.7) * 43758.5453; return s - Math.floor(s); };
const A = (G, c, a) => G.withAlpha(c, Math.max(0, Math.min(1, a)));

/** The sky behind: a soft vertical tint for the condition and the hour (dawn and dusk warm, noon bright, night dark). */
function sky(cv, G, kind, day, x, y, w, h, hour) {
    const hr = typeof hour === 'number' ? hour : new Date().getHours() + new Date().getMinutes() / 60;
    const rain = /rain|drizzle|showers|storm|sleet/.test(kind), clear = kind === 'clear' || kind === 'mostly-clear';
    let top = !day ? '#0a1430' : rain ? '#2b3446' : clear ? '#1d4f8f' : kind === 'fog' ? '#4a525f' : kind === 'snow' ? '#3a4a66' : '#33507a';
    const bot = !day ? '#111113' : rain ? '#17191f' : '#111113';
    // the warm band at sunrise and sunset (not under rain or fog, where the sky is closed)
    const warm = day && !rain && kind !== 'fog' ? Math.max(0, 1 - Math.abs(hr - 6.2) / 1.4, 1 - Math.abs(hr - 17.6) / 1.6) : 0;
    cv.gradientRect(x, y, w, h, [[0, A(G, top, 0.75)], [1, A(G, bot, 0.0)]]);
    if (warm > 0) cv.gradientRect(x, y, w, h * 0.85, [[0, A(G, '#ff8a3d', 0)], [1, A(G, '#ff8a3d', 0.16 * warm)]]);
    if (day && !rain && kind !== 'fog' && hr >= 10 && hr <= 15) cv.gradientRect(x, y, w, h * 0.5, [[0, A(G, '#7fc2ff', 0.10)], [1, A(G, '#7fc2ff', 0)]]);   // noon
}

function sun(cv, G, x, y, w, h, time) {
    const cx = x + 150, cy = y + 120, pulse = 0.5 + 0.5 * Math.sin(time * 1.4);
    for (let i = 5; i >= 1; i--) cv.circle(cx, cy, 40 + i * 24 + pulse * 6, A(G, '#ffcf4a', 0.045));
    for (let i = 0; i < 12; i++) {                                  // long soft rays, slowly turning
        const a = time * 0.18 + i * Math.PI / 6, r0 = 70, r1 = 150 + 30 * Math.sin(time * 1.1 + i * 1.7);
        cv.line(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0, cx + Math.cos(a) * r1, cy + Math.sin(a) * r1, 7, A(G, '#ffd978', 0.1));
    }
}
function stars(cv, G, x, y, w, h, time) {
    for (let i = 0; i < 26; i++) {
        const sx = x + rnd(i, 1) * w, sy = y + rnd(i, 2) * h * 0.7, tw = 0.5 + 0.5 * Math.sin(time * (1 + rnd(i, 3) * 2) + i * 2.1);
        cv.circle(sx, sy, 1 + rnd(i, 4) * 1.4, A(G, '#ffffff', 0.15 + 0.6 * tw));
    }
}
function clouds(cv, G, x, y, w, h, time, n, dark, day) {
    // solid, low-contrast colours: see-through discs would show their seams where they overlap
    const pal = !day ? ['#0d1630', '#101a38', '#131f41'] : dark ? ['#262d3b', '#2b3342', '#303949'] : ['#23406a', '#294874', '#2f507d'];
    for (let i = 0; i < n; i++) {
        const sp = 6 + rnd(i, 5) * 10, cw0 = 150 + rnd(i, 6) * 130, cx = x + ((rnd(i, 7) * (w + cw0) + time * sp) % (w + cw0)) - cw0 / 2, cy0 = y + 34 + rnd(i, 8) * 130;
        // a cloud shrinks away towards the edges of the box instead of being cut by them
        const k = Math.max(0, Math.min(1, Math.min(cx - x, x + w - cx) / (cw0 * 0.7)));
        if (k < 0.08) continue;
        const cw = cw0 * k, ch = cw * 0.28, cy = cy0 + (cw0 * 0.28 - ch) / 2;
        const body = (dx, dy, kk, c) => { const ww = cw * kk; cv.roundRect(cx - ww / 2 + dx, cy + dy, ww, ch * kk, ch * kk / 2, c); cv.circle(cx - cw * 0.12 + dx, cy + dy, ch * 0.7 * kk, c); cv.circle(cx + cw * 0.12 + dx, cy - ch * 0.12 + dy, ch * 0.85 * kk, c); };
        body(0, 0, 1, pal[0]); body(-cw * 0.006, -ch * 0.06, 0.93, pal[1]); body(-cw * 0.01, -ch * 0.14, 0.76, pal[2]);
    }
}
function rain(cv, G, x, y, w, h, time, n, wind, heavy) {
    const slant = Math.min(0.5, 0.12 + wind / 120);
    for (let i = 0; i < n; i++) {
        const z = rnd(i, 6), len = (heavy ? 30 : 22) * (0.6 + 0.6 * z);       // z: 0 far, 1 near - near drops are longer, faster, brighter
        const sp = ((heavy ? 520 : 380) + rnd(i, 1) * 160) * (0.7 + 0.5 * z), ph = (rnd(i, 2) * (h + 60) + time * sp) % (h + 60), px = x + rnd(i, 3) * (w + 80) - ph * slant;
        const yy = y + ph - 30, xx = px;
        if (xx < x || xx > x + w || yy < y || yy + len > y + h) continue;
        cv.line(xx, yy, xx - len * slant, yy + len, 1.4 + 1.4 * z, A(G, '#7cc0ff', 0.22 + 0.42 * z));
    }
    // rings where the rain lands, along the bottom
    for (let i = 0; i < Math.ceil(n / 4); i++) {
        const t = (time * (heavy ? 2.2 : 1.6) + rnd(i, 11)) % 1, r = 2 + t * (heavy ? 12 : 9);
        cv.arc(x + rnd(i, 12) * w, y + h - 6 - rnd(i, 13) * 14, r - 1.2, r, 0, 360, A(G, '#a9d4ff', 0.4 * (1 - t)));
    }
}
function snow(cv, G, x, y, w, h, time, n) {
    for (let i = 0; i < n; i++) {
        const sp = 30 + rnd(i, 1) * 40, ph = (rnd(i, 2) * h + time * sp) % h, sx = x + rnd(i, 3) * w + Math.sin(time * 1.2 + i) * 14;
        if (sx < x || sx > x + w) continue;
        cv.circle(sx, y + ph, 2 + rnd(i, 4) * 2.5, A(G, '#ffffff', 0.75));
    }
}
function fog(cv, G, x, y, w, h, time) {
    for (let i = 0; i < 5; i++) {
        const bw = w * 0.8, bx = x + ((time * (10 + i * 4) + i * 120) % (w + bw)) - bw, by = y + 60 + i * 70;
        const l = Math.max(bx, x), r = Math.min(bx + bw, x + w);
        if (r > l) cv.roundRect(l, by, r - l, 26, 13, A(G, '#c4ccd8', 0.07));
    }
}
function lightning(cv, G, x, y, w, h, time) {
    const ph = time % 6.5, flash = ph < 0.12 ? 1 - ph / 0.12 : (ph > 0.28 && ph < 0.4 ? 0.6 * (1 - (ph - 0.28) / 0.12) : 0);
    if (flash > 0) cv.fillRect(x, y, w, h, A(G, '#dfe8ff', 0.16 * flash));
    if (ph < 0.12 || (ph > 0.28 && ph < 0.34)) {                  // the bolt: a glow, the stroke, two forks
        const bx = x + 90 + rnd(Math.floor(time / 6.5), 9) * (w - 180), f = ph < 0.12 ? 1 : 0.6;
        const main = [[bx, y], [bx - 18, y + 70], [bx + 8, y + 74], [bx - 24, y + 160], [bx + 4, y + 170], [bx - 12, y + 230]];
        cv.polyline(main, 12, A(G, '#bcd0ff', 0.16 * f));
        cv.polyline(main, 4, A(G, '#fff3b0', 0.9 * f));
        cv.polyline([[bx - 18, y + 70], [bx - 52, y + 110], [bx - 60, y + 150]], 2.4, A(G, '#fff3b0', 0.7 * f));
        cv.polyline([[bx - 24, y + 160], [bx + 14, y + 195], [bx + 26, y + 232]], 2.4, A(G, '#fff3b0', 0.7 * f));
    }
}
/** Wind: long thin streaks that cross the box, faster and more of them as it gets stronger (from about 20 km/h). */
function windy(cv, G, x, y, w, h, time, wind) {
    const n = Math.min(9, Math.floor((wind - 15) / 4)), sp = 120 + wind * 9;
    for (let i = 0; i < n; i++) {
        const len = 60 + rnd(i, 1) * 120, ph = (rnd(i, 2) * (w + len) + time * sp * (0.7 + rnd(i, 3) * 0.6)) % (w + len), sx = x + ph - len, sy = y + 20 + rnd(i, 4) * (h - 40);
        const l = Math.max(sx, x), r = Math.min(sx + len, x + w);
        if (r > l) cv.line(l, sy + Math.sin(time * 2 + i) * 3, r, sy + Math.sin(time * 2 + i + 1) * 3, 2, A(G, '#ffffff', 0.22));
    }
}

function draw(cv, G, kind, day, wind, x, y, w, h, time) {
    if (cv.clip) cv.clip(x, y, w, h);
    if (kind === 'clear') { if (day) sun(cv, G, x, y, w, h, time); else stars(cv, G, x, y, w, h, time); }
    if (kind === 'partly' || kind === 'mostly-clear') { if (day) sun(cv, G, x, y, w, h, time); else stars(cv, G, x, y, w, h, time); }
    if (kind === 'mostly-clear') clouds(cv, G, x, y, w, h, time, 2, false, day);
    else if (kind === 'partly') clouds(cv, G, x, y, w, h, time, 3, false, day);
    else if (kind === 'cloudy' || kind === 'fog') clouds(cv, G, x, y, w, h, time, 5, true, day);
    if (kind === 'fog') fog(cv, G, x, y, w, h, time);
    if (kind === 'drizzle') { clouds(cv, G, x, y, w, h, time, 4, true, day); rain(cv, G, x, y, w, h, time, 16, wind, false); }
    if (kind === 'rain' || kind === 'showers') { clouds(cv, G, x, y, w, h, time, 4, true, day); rain(cv, G, x, y, w, h, time, 28, wind, false); }
    if (kind === 'heavy-rain') { clouds(cv, G, x, y, w, h, time, 5, true, day); rain(cv, G, x, y, w, h, time, 44, wind, true); }
    if (kind === 'sleet') { clouds(cv, G, x, y, w, h, time, 4, true, day); rain(cv, G, x, y, w, h, time, 14, wind, false); snow(cv, G, x, y, w, h, time, 12); }
    if (kind === 'snow') { clouds(cv, G, x, y, w, h, time, 3, true, day); snow(cv, G, x, y, w, h, time, 34); }
    if (kind === 'storm') { clouds(cv, G, x, y, w, h, time, 5, true, day); rain(cv, G, x, y, w, h, time, 40, Math.max(wind, 25), true); lightning(cv, G, x, y, w, h, time); }
    if (wind >= 20) windy(cv, G, x, y, w, h, time, wind);
    if (cv.noclip) cv.noclip();
}

module.exports = { draw, sky };
