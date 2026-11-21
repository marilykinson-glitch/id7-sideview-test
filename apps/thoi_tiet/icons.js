'use strict';
/**
 * icons.js - the weather icons, drawn with the canvas's own shapes (the Store's renderer takes no pictures):
 *   draw(cv, icon, day, cx, cy, size)    icon: a name from weather.describe(); day: false draws the moon for clear skies;
 *                                         (cx, cy) the centre, size the icon's width in pixels
 */
const SUN = '#ffc933', SUN_HI = '#ffe28a', MOON = '#dfe7f5', CLOUD = '#eef2f8', CLOUD_BACK = '#aeb9cb', CLOUD_DARK = '#8794aa', RAIN = '#4da3ff', SNOW = '#ffffff', BOLT = '#ffd23f', FOG = '#b9c3d3';

function sun(cv, cx, cy, s) {
    cv.circle(cx, cy, s * 0.2, SUN);
    cv.circle(cx - s * 0.04, cy - s * 0.05, s * 0.12, SUN_HI);
    for (let i = 0; i < 8; i++) {
        const a = i * Math.PI / 4, r0 = s * 0.29, r1 = s * 0.41;
        cv.line(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0, cx + Math.cos(a) * r1, cy + Math.sin(a) * r1, Math.max(2, s * 0.045), SUN);
    }
}
function moon(cv, cx, cy, s) {
    cv.circle(cx, cy, s * 0.28, MOON);
    cv.circle(cx + s * 0.13, cy - s * 0.08, s * 0.25, '#0c0f14');      // the bite (the screen is dark)
    cv.circle(cx - s * 0.2, cy + s * 0.2, s * 0.025, '#ffffffcc'); cv.circle(cx + s * 0.28, cy + s * 0.18, s * 0.02, '#ffffffaa');
}
/** A cloud whose body is centred at (cx, cy), width s*k. */
function cloud(cv, cx, cy, s, c) {
    const w = s * 0.74, h = s * 0.3, x0 = cx - w / 2, y0 = cy - h / 2;
    cv.roundRect(x0, y0 + h * 0.3, w, h * 0.7, h * 0.35, c);
    cv.circle(x0 + w * 0.3, y0 + h * 0.42, h * 0.52, c);
    cv.circle(x0 + w * 0.58, y0 + h * 0.3, h * 0.68, c);
    cv.circle(x0 + w * 0.78, y0 + h * 0.58, h * 0.4, c);
}
function drops(cv, cx, y, s, n, c, len) {
    for (let i = 0; i < n; i++) {
        const x = cx + (i - (n - 1) / 2) * s * 0.17;
        cv.line(x + s * 0.03, y + (i % 2) * s * 0.05, x - s * 0.03, y + (i % 2) * s * 0.05 + len, Math.max(2, s * 0.04), c);
    }
}
function flakes(cv, cx, y, s, n) {
    for (let i = 0; i < n; i++) { const x = cx + (i - (n - 1) / 2) * s * 0.18; cv.circle(x, y + (i % 2) * s * 0.07, Math.max(2, s * 0.03), SNOW); }
}
function bolt(cv, cx, y, s) {
    // two quads (the recorder takes four points): the upper slant and the lower point
    cv.quad([[cx + s * 0.05, y], [cx - s * 0.08, y + s * 0.17], [cx + s * 0.02, y + s * 0.17], [cx + s * 0.09, y + s * 0.05]], BOLT);
    cv.quad([[cx + s * 0.09, y + s * 0.1], [cx - s * 0.06, y + s * 0.31], [cx - s * 0.02, y + s * 0.17], [cx - s * 0.04, y + s * 0.13]], BOLT);
}

function draw(cv, icon, day, cx, cy, s) {
    const night = day === false;
    switch (icon) {
    case 'clear': night ? moon(cv, cx, cy, s) : sun(cv, cx, cy, s); break;
    case 'mostly-clear': case 'partly':
        night ? moon(cv, cx - s * 0.12, cy - s * 0.1, s * 0.85) : sun(cv, cx - s * 0.12, cy - s * 0.1, s * 0.85);
        cloud(cv, cx + s * 0.04, cy + s * 0.12, s * (icon === 'partly' ? 0.9 : 0.72), CLOUD); break;
    case 'cloudy': cloud(cv, cx + s * 0.1, cy - s * 0.1, s * 0.78, CLOUD_BACK); cloud(cv, cx - s * 0.04, cy + s * 0.08, s * 0.95, CLOUD); break;
    case 'fog':
        cloud(cv, cx, cy - s * 0.12, s * 0.9, CLOUD_BACK);
        [0.14, 0.26, 0.38].forEach((k, i) => cv.line(cx - s * (0.3 - i * 0.04), cy + s * k, cx + s * (0.3 - (i % 2) * 0.1), cy + s * k, Math.max(2, s * 0.045), FOG)); break;
    case 'drizzle': cloud(cv, cx, cy - s * 0.1, s * 0.95, CLOUD); drops(cv, cx, cy + s * 0.2, s, 3, RAIN, s * 0.1); break;
    case 'rain': cloud(cv, cx, cy - s * 0.12, s * 0.95, CLOUD_BACK); drops(cv, cx, cy + s * 0.14, s, 4, RAIN, s * 0.2); break;
    case 'heavy-rain': cloud(cv, cx, cy - s * 0.14, s * 0.95, CLOUD_DARK); drops(cv, cx, cy + s * 0.12, s, 5, RAIN, s * 0.26); break;
    case 'showers':
        night ? moon(cv, cx - s * 0.16, cy - s * 0.2, s * 0.7) : sun(cv, cx - s * 0.16, cy - s * 0.2, s * 0.7);
        cloud(cv, cx + s * 0.04, cy - s * 0.02, s * 0.85, CLOUD_BACK); drops(cv, cx + s * 0.04, cy + s * 0.2, s, 3, RAIN, s * 0.18); break;
    case 'sleet': cloud(cv, cx, cy - s * 0.12, s * 0.95, CLOUD_BACK); drops(cv, cx - s * 0.1, cy + s * 0.14, s, 2, RAIN, s * 0.18); flakes(cv, cx + s * 0.14, cy + s * 0.22, s, 2); break;
    case 'snow': cloud(cv, cx, cy - s * 0.12, s * 0.95, CLOUD); flakes(cv, cx, cy + s * 0.2, s, 4); flakes(cv, cx + s * 0.08, cy + s * 0.34, s, 3); break;
    case 'storm': cloud(cv, cx, cy - s * 0.16, s * 0.95, CLOUD_DARK); bolt(cv, cx, cy + s * 0.02, s); drops(cv, cx - s * 0.24, cy + s * 0.14, s, 2, RAIN, s * 0.16); break;
    default: cloud(cv, cx, cy, s * 0.95, CLOUD);
    }
}

module.exports = { draw };
