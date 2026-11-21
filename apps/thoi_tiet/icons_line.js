'use strict';
/**
 * icons_line.js - the weather icons of the home-screen widget, in the car's own icon language: thin white outlines,
 * a little colour (the sun, the rain). Pictures (kit Canvas, transparent around), not Store drawing commands:
 *   make(icon, day, w, h, size) -> Canvas     icon: a name from weather.describe(); day === false draws the moon;
 *                                             the icon is `size` wide, centred in a w x h picture
 */
const { Canvas } = require('./kit/canvas');
const WHITE = '#ffffff', SUN = '#ffc933', MOON = '#e8eefb', RAIN = '#5aaeff', BOLT = '#ffd23f', FOG = '#c9d2e0';

/** a.alpha *= 1 - b.alpha: what b covers is cut out of a. */
function cut(a, b) {
    const da = a.d, db = b.d;
    for (let i = 3; i < da.length; i += 4) if (db[i]) da[i] = Math.round(da[i] * (255 - db[i]) / 255);
    return a;
}
/** The cloud's body around (cx, cy), `s` wide in all; `inset` shrinks it evenly (the hole of the outline). */
function body(cv, cx, cy, s, c, inset) {
    const i = inset || 0, w = s * 0.78, x0 = cx - w / 2, base = cy + s * 0.17, h = s * 0.24;
    cv.roundRect(x0 + i, base - h + i, w - 2 * i, h - 2 * i, Math.max(1, h / 2 - i), c);
    cv.circle(x0 + w * 0.3, base - h * 0.95, Math.max(1, s * 0.15 - i), c);
    cv.circle(x0 + w * 0.57, base - h * 1.12, Math.max(1, s * 0.215 - i), c);
    // the inside of the outline is one piece: fill between the two bumps and the base
    if (i > 0) cv.fillRect(x0 + w * 0.3, base - h * 1.05, w * 0.27, h * 0.7, c);
}
function sun(cv, cx, cy, s, t) {
    cv.arc(cx, cy, s * 0.17 - t, s * 0.17, 0, 360, SUN);
    for (let i = 0; i < 8; i++) {
        const a = i * Math.PI / 4, r0 = s * 0.26, r1 = s * 0.36;
        cv.line(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0, cx + Math.cos(a) * r1, cy + Math.sin(a) * r1, t, SUN);
    }
}
function moon(W, H, cx, cy, s, t) {
    const a = new Canvas(W, H), b = new Canvas(W, H), hole = new Canvas(W, H), bite = new Canvas(W, H);
    a.circle(cx, cy, s * 0.26, MOON);
    bite.circle(cx + s * 0.15, cy - s * 0.1, s * 0.25, MOON);
    cut(a, bite);                                               // the crescent, filled
    hole.circle(cx, cy, s * 0.26 - t, MOON);
    b.circle(cx + s * 0.15, cy - s * 0.1, s * 0.25 + t, MOON);
    cut(hole, b);                                               // the crescent's inside
    return cut(a, hole);
}
function drops(cv, cx, y, s, n, len, t) {
    for (let i = 0; i < n; i++) {
        const x = cx + (i - (n - 1) / 2) * s * 0.18, yy = y + (i % 2) * s * 0.05;
        cv.line(x + s * 0.035, yy, x - s * 0.035, yy + len, t, RAIN);
    }
}
function flakes(cv, cx, y, s, n, t) {
    for (let i = 0; i < n; i++) {
        const x = cx + (i - (n - 1) / 2) * s * 0.2, yy = y + (i % 2) * s * 0.09, r = s * 0.045;
        for (let k = 0; k < 3; k++) { const a = k * Math.PI / 3; cv.line(x - Math.cos(a) * r, yy - Math.sin(a) * r, x + Math.cos(a) * r, yy + Math.sin(a) * r, Math.max(1.5, t * 0.6), WHITE); }
    }
}
function bolt(cv, cx, y, s) {
    cv.quad([[cx + s * 0.05, y], [cx - s * 0.08, y + s * 0.17], [cx + s * 0.02, y + s * 0.17], [cx + s * 0.09, y + s * 0.05]], BOLT);
    cv.quad([[cx + s * 0.09, y + s * 0.1], [cx - s * 0.06, y + s * 0.31], [cx - s * 0.02, y + s * 0.17], [cx - s * 0.04, y + s * 0.13]], BOLT);
}

function make(icon, day, w, h, size) {
    const W = Math.round(w), H = Math.round(h), s = size, cx = W / 2, cy = H / 2, t = Math.max(2, s * 0.05), night = day === false;
    const out = new Canvas(W, H);
    /** The sky body behind (sun or moon at (bx, by), `bs` big), then a cloud outline in front that hides what it covers. */
    const scene = (sky, clouds, under) => {
        let back = new Canvas(W, H);
        if (sky) { if (night) back = moon(W, H, sky[0], sky[1], sky[2], t); else sun(back, sky[0], sky[1], sky[2], t); }
        clouds.forEach((c) => {
            const outer = new Canvas(W, H), gap = new Canvas(W, H), inner = new Canvas(W, H);
            body(outer, c[0], c[1], c[2], c[3] || WHITE, 0);
            const ct = Math.min(t, c[2] * 0.075);                // a small cloud takes a thinner line
            body(gap, c[0], c[1], c[2], WHITE, -ct * 0.7);       // a little air between the cloud and what is behind it
            body(inner, c[0], c[1], c[2], WHITE, ct);
            cut(back, gap);
            back.blit(cut(outer, inner), 0, 0);
        });
        out.blit(back, 0, 0);
        if (under) under(out);
    };
    switch (icon) {
    case 'clear': scene([cx, cy, s * 1.15], []); break;
    case 'mostly-clear': scene([cx - s * 0.12, cy - s * 0.1, s * 0.95], [[cx + s * 0.15, cy + s * 0.14, s * 0.66]]); break;
    case 'partly': scene([cx - s * 0.16, cy - s * 0.14, s * 0.85], [[cx + s * 0.06, cy + s * 0.1, s * 0.86]]); break;
    case 'cloudy': scene(null, [[cx + s * 0.14, cy - s * 0.12, s * 0.66, FOG], [cx - s * 0.04, cy + s * 0.08, s * 0.9]]); break;
    case 'fog': scene(null, [[cx, cy - s * 0.14, s * 0.86]], (c) => [0.2, 0.33].forEach((k, i) => c.line(cx - s * (0.3 - i * 0.06), cy + s * k, cx + s * (0.3 - i * 0.02), cy + s * k, t, FOG))); break;
    case 'drizzle': scene(null, [[cx, cy - s * 0.12, s * 0.9]], (c) => drops(c, cx, cy + s * 0.2, s, 3, s * 0.1, t)); break;
    case 'rain': scene(null, [[cx, cy - s * 0.14, s * 0.9]], (c) => drops(c, cx, cy + s * 0.17, s, 3, s * 0.2, t)); break;
    case 'heavy-rain': scene(null, [[cx, cy - s * 0.15, s * 0.9]], (c) => drops(c, cx, cy + s * 0.15, s, 4, s * 0.22, t)); break;
    case 'showers': scene([cx - s * 0.18, cy - s * 0.22, s * 0.74], [[cx + s * 0.05, cy - s * 0.06, s * 0.82]], (c) => drops(c, cx + s * 0.05, cy + s * 0.22, s, 3, s * 0.18, t)); break;
    case 'sleet': scene(null, [[cx, cy - s * 0.14, s * 0.9]], (c) => { drops(c, cx - s * 0.12, cy + s * 0.17, s, 2, s * 0.18, t); flakes(c, cx + s * 0.16, cy + s * 0.24, s, 2, t); }); break;
    case 'snow': scene(null, [[cx, cy - s * 0.14, s * 0.9]], (c) => flakes(c, cx, cy + s * 0.22, s, 3, t)); break;
    case 'storm': scene(null, [[cx, cy - s * 0.16, s * 0.9]], (c) => { bolt(c, cx + s * 0.04, cy + s * 0.08, s); drops(c, cx - s * 0.24, cy + s * 0.17, s, 2, s * 0.16, t); }); break;
    default: scene(null, [[cx, cy, s * 0.9]]);
    }
    return out;
}

module.exports = { make };
