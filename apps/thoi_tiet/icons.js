'use strict';
/**
 * icons.js - the weather icons, drawn with the canvas's own shapes (the Store's renderer takes no pictures):
 *   draw(cv, icon, day, cx, cy, size)    icon: a name from weather.describe(); day: false draws the moon for clear skies;
 *                                         (cx, cy) the centre, size the icon's width in pixels
 */
const SUN = '#ffb81f', SUN_MID = '#ffc933', SUN_HI = '#ffeaa6', MOON = '#f6dc84', RAIN = '#4da6ff', RAIN_HI = '#bfe0ff', SNOW = '#ffffff', BOLT = '#ffc933', BOLT_HI = '#ffe9a0', FOG = '#b9c3d3';
// clouds: shade (underside), mid (body) and highlight (the lit top)
const CL_LIGHT = ['#8ea2c4', '#d4e0f3', '#ffffff'], CL_GREY = ['#7a8bab', '#b4c2da', '#e6edf8'], CL_DARK = ['#2f3b54', '#5d6e8c', '#8d9cb8'];

function sun(cv, cx, cy, s) {
    // glow, rays, then a ball lit from the upper left
    cv.circle(cx, cy, s * 0.34, '#ffb02e14');
    for (let i = 0; i < 8; i++) {
        const a = i * Math.PI / 4, r0 = s * 0.27, r1 = s * (i % 2 ? 0.37 : 0.42);
        cv.line(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0, cx + Math.cos(a) * r1, cy + Math.sin(a) * r1, Math.max(2, s * 0.045), '#ffb02e');
    }
    cv.circle(cx, cy, s * 0.21, SUN);
    cv.circle(cx - s * 0.02, cy - s * 0.025, s * 0.17, SUN_MID);
    cv.circle(cx - s * 0.06, cy - s * 0.07, s * 0.09, SUN_HI + 'cc');
}
function moon(cv, cx, cy, s) {
    cv.circle(cx, cy, s * 0.28, MOON);
    cv.circle(cx - s * 0.03, cy - s * 0.03, s * 0.24, '#fff0b0aa');
    cv.circle(cx + s * 0.13, cy - s * 0.08, s * 0.25, '#111113');      // the bite (the screen is dark)
    cv.circle(cx - s * 0.2, cy + s * 0.2, s * 0.025, '#ffffffcc'); cv.circle(cx + s * 0.28, cy + s * 0.18, s * 0.02, '#ffffffaa');
}
/** the cloud's outline pieces for a body centred at (cx, cy), width s*0.74; k shrinks it about the centre, (dx, dy) shifts it */
function shape(cv, cx, cy, s, c, k, dx, dy) {
    const w = s * 0.74 * k, h = s * 0.3 * k, x0 = cx - w / 2 + dx, y0 = cy - h / 2 + dy;
    cv.roundRect(x0, y0 + h * 0.3, w, h * 0.7, h * 0.35, c);
    cv.circle(x0 + w * 0.3, y0 + h * 0.42, h * 0.52, c);
    cv.circle(x0 + w * 0.58, y0 + h * 0.3, h * 0.68, c);
    cv.circle(x0 + w * 0.78, y0 + h * 0.58, h * 0.4, c);
}
/** A soft, puffy cloud whose body is centred at (cx, cy), width s*0.74: dark underside, lit top. pal: [shade, mid, highlight] */
function cloud(cv, cx, cy, s, pal) {
    const w = s * 0.74, h = s * 0.3, x0 = cx - w / 2, y0 = cy - h / 2;
    shape(cv, cx, cy, s, pal[0], 1, 0, 0);
    shape(cv, cx, cy, s, pal[1], 0.94, -s * 0.004, -s * 0.014);
    // the lit tops of the two big puffs
    cv.circle(x0 + w * 0.56, y0 + h * 0.24, h * 0.46, pal[2] + '78');
    cv.circle(x0 + w * 0.3, y0 + h * 0.36, h * 0.3, pal[2] + '50');
    cv.circle(x0 + w * 0.77, y0 + h * 0.5, h * 0.2, pal[2] + '38');
}
function drop(cv, x, y, r, len) {
    // a tear: a point on top, a round bottom, a glint
    cv.quad([[x + len * 0.18, y - len], [x - r * 0.95, y - r * 0.25], [x + r * 0.95, y - r * 0.25], [x + len * 0.18, y - len]], RAIN);
    cv.circle(x, y, r, RAIN);
    cv.circle(x - r * 0.3, y - r * 0.25, r * 0.38, RAIN_HI + 'dd');
}
function drops(cv, cx, y, s, n, len) {
    for (let i = 0; i < n; i++) {
        const x = cx + (i - (n - 1) / 2) * s * 0.17 - s * 0.02, yy = y + len + (i % 2) * s * 0.06;
        drop(cv, x, yy, Math.max(2, s * 0.035), Math.max(4, len * 0.9));
    }
}
function flakes(cv, cx, y, s, n) {
    for (let i = 0; i < n; i++) {
        const x = cx + (i - (n - 1) / 2) * s * 0.18, yy = y + (i % 2) * s * 0.07, r = Math.max(2, s * 0.04);
        cv.circle(x, yy, r * 1.7, '#ffffff22');
        for (let k = 0; k < 3; k++) { const a = k * Math.PI / 3; cv.line(x - Math.cos(a) * r * 1.3, yy - Math.sin(a) * r * 1.3, x + Math.cos(a) * r * 1.3, yy + Math.sin(a) * r * 1.3, Math.max(1.5, s * 0.014), SNOW); }
    }
}
function bolt(cv, cx, y, s) {
    // two quads (the recorder takes four points): the upper slant and the lower point
    cv.quad([[cx + s * 0.05, y], [cx - s * 0.08, y + s * 0.17], [cx + s * 0.02, y + s * 0.17], [cx + s * 0.09, y + s * 0.05]], BOLT);
    cv.quad([[cx + s * 0.09, y + s * 0.1], [cx - s * 0.06, y + s * 0.31], [cx - s * 0.02, y + s * 0.17], [cx - s * 0.04, y + s * 0.13]], BOLT);
    cv.line(cx + s * 0.04, y + s * 0.02, cx - s * 0.04, y + s * 0.15, Math.max(1.5, s * 0.012), BOLT_HI);
}

function draw(cv, icon, day, cx, cy, s) {
    const night = day === false;
    switch (icon) {
    case 'clear': night ? moon(cv, cx, cy, s) : sun(cv, cx, cy, s); break;
    case 'mostly-clear': case 'partly':
        night ? moon(cv, cx - s * 0.12, cy - s * 0.1, s * 0.85) : sun(cv, cx - s * 0.12, cy - s * 0.1, s * 0.85);
        cloud(cv, cx + s * 0.04, cy + s * 0.12, s * (icon === 'partly' ? 0.9 : 0.72), CL_LIGHT); break;
    case 'cloudy': cloud(cv, cx + s * 0.1, cy - s * 0.1, s * 0.78, CL_GREY); cloud(cv, cx - s * 0.04, cy + s * 0.08, s * 0.95, CL_LIGHT); break;
    case 'fog':
        cloud(cv, cx, cy - s * 0.12, s * 0.9, CL_GREY);
        [0.14, 0.26, 0.38].forEach((k, i) => cv.line(cx - s * (0.3 - i * 0.04), cy + s * k, cx + s * (0.3 - (i % 2) * 0.1), cy + s * k, Math.max(2, s * 0.045), FOG + (i === 1 ? 'cc' : 'ee'))); break;
    case 'drizzle': cloud(cv, cx, cy - s * 0.1, s * 0.95, CL_LIGHT); drops(cv, cx, cy + s * 0.14, s, 3, s * 0.08); break;
    case 'rain': cloud(cv, cx, cy - s * 0.12, s * 0.95, CL_LIGHT); drops(cv, cx, cy + s * 0.1, s, 4, s * 0.12); break;
    case 'heavy-rain': cloud(cv, cx, cy - s * 0.14, s * 0.95, CL_DARK); drops(cv, cx, cy + s * 0.08, s, 5, s * 0.15); break;
    case 'showers':
        night ? moon(cv, cx - s * 0.16, cy - s * 0.2, s * 0.7) : sun(cv, cx - s * 0.16, cy - s * 0.2, s * 0.7);
        cloud(cv, cx + s * 0.04, cy - s * 0.02, s * 0.85, CL_LIGHT); drops(cv, cx + s * 0.04, cy + s * 0.14, s, 3, s * 0.1); break;
    case 'sleet': cloud(cv, cx, cy - s * 0.12, s * 0.95, CL_LIGHT); drops(cv, cx - s * 0.1, cy + s * 0.1, s, 2, s * 0.1); flakes(cv, cx + s * 0.14, cy + s * 0.24, s, 2); break;
    case 'snow': cloud(cv, cx, cy - s * 0.12, s * 0.95, CL_LIGHT); flakes(cv, cx, cy + s * 0.2, s, 4); flakes(cv, cx + s * 0.08, cy + s * 0.34, s, 3); break;
    case 'storm': cloud(cv, cx, cy - s * 0.16, s * 0.95, CL_DARK); bolt(cv, cx, cy + s * 0.02, s); drops(cv, cx - s * 0.24, cy + s * 0.08, s, 2, s * 0.1); break;
    default: cloud(cv, cx, cy, s * 0.95, CL_LIGHT);
    }
}

module.exports = { draw };
