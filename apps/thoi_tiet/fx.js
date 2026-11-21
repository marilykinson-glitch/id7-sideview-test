
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

/** The sky behind: a soft vertical tint for the condition, darker at night. */
function sky(cv, G, kind, day, x, y, w, h) {
    const rain = /rain|drizzle|showers|storm|sleet/.test(kind);
    const top = !day ? '#0a1430' : rain ? '#2b3446' : kind === 'clear' || kind === 'mostly-clear' ? '#1d4f8f' : kind === 'fog' ? '#4a525f' : kind === 'snow' ? '#3a4a66' : '#33507a';
    const bot = !day ? '#111113' : rain ? '#17191f' : '#111113';
    cv.gradientRect(x, y, w, h, [[0, A(G, top, 0.75)], [1, A(G, bot, 0.0)]]);
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
    cv.circle(x + 150, y + 120, 130, A(G, '#bcd0ff', 0.05));          // the moon's halo
    cv.circle(x + 150, y + 120, 90, A(G, '#bcd0ff', 0.05));
}
function clouds(cv, G, x, y, w, h, time, n, dark) {
    for (let i = 0; i < n; i++) {
        const sp = 6 + rnd(i, 5) * 10, cw = 150 + rnd(i, 6) * 130, cx = x + ((rnd(i, 7) * (w + cw) + time * sp) % (w + cw)) - cw / 2, cy = y + 34 + rnd(i, 8) * 130, ch = cw * 0.28;
        const c = A(G, dark ? '#8d98ab' : '#dfe6f2', dark ? 0.1 : 0.09);
        cv.roundRect(cx - cw / 2, cy, cw, ch, ch / 2, c); cv.circle(cx - cw * 0.12, cy, ch * 0.7, c); cv.circle(cx + cw * 0.12, cy - ch * 0.12, ch * 0.85, c);
    }
}
function rain(cv, G, x, y, w, h, time, n, wind, heavy) {
    const slant = Math.min(0.5, 0.12 + wind / 120), len = heavy ? 30 : 22;
    for (let i = 0; i < n; i++) {
        const sp = (heavy ? 520 : 380) + rnd(i, 1) * 160, ph = (rnd(i, 2) * (h + 60) + time * sp) % (h + 60), px = x + rnd(i, 3) * (w + 80) - ph * slant;
        const yy = y + ph - 30, xx = px;
        if (xx < x || xx > x + w || yy < y || yy + len > y + h) continue;
        cv.line(xx, yy, xx - len * slant, yy + len, 2, A(G, '#7cc0ff', 0.55));
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
    if (flash > 0) cv.fillRect(x, y, w, h, A(G, '#dfe8ff', 0.14 * flash));
    if (ph < 0.12) {                                               // the bolt
        const bx = x + 90 + rnd(Math.floor(time / 6.5), 9) * (w - 180);
        cv.polyline([[bx, y], [bx - 18, y + 70], [bx + 8, y + 74], [bx - 24, y + 160], [bx + 4, y + 170], [bx - 12, y + 230]], 4, A(G, '#fff3b0', 0.9));
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
    if (kind === 'mostly-clear') clouds(cv, G, x, y, w, h, time, 2, false);
    else if (kind === 'partly') clouds(cv, G, x, y, w, h, time, 3, false);
    else if (kind === 'cloudy' || kind === 'fog') clouds(cv, G, x, y, w, h, time, 5, true);
    if (kind === 'fog') fog(cv, G, x, y, w, h, time);
    if (kind === 'drizzle') { clouds(cv, G, x, y, w, h, time, 4, true); rain(cv, G, x, y, w, h, time, 16, wind, false); }
    if (kind === 'rain' || kind === 'showers') { clouds(cv, G, x, y, w, h, time, 4, true); rain(cv, G, x, y, w, h, time, 28, wind, false); }
    if (kind === 'heavy-rain') { clouds(cv, G, x, y, w, h, time, 5, true); rain(cv, G, x, y, w, h, time, 44, wind, true); }
    if (kind === 'sleet') { clouds(cv, G, x, y, w, h, time, 4, true); rain(cv, G, x, y, w, h, time, 14, wind, false); snow(cv, G, x, y, w, h, time, 12); }
    if (kind === 'snow') { clouds(cv, G, x, y, w, h, time, 3, true); snow(cv, G, x, y, w, h, time, 34); }
    if (kind === 'storm') { clouds(cv, G, x, y, w, h, time, 5, true); rain(cv, G, x, y, w, h, time, 40, Math.max(wind, 25), true); lightning(cv, G, x, y, w, h, time); }
    if (wind >= 20) windy(cv, G, x, y, w, h, time, wind);
    if (cv.noclip) cv.noclip();
}

module.exports = { draw, sky };
