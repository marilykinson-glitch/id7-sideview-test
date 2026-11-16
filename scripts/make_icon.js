'use strict';
/**
 * make_icon.js - the app's tile icon (apps/xinhan_cam/icon.png, 140x140): a door mirror with a camera
 * in it and an amber turn-signal arrow, white line art on transparent like the HMI's own icons.
 *   node scripts/make_icon.js
 */
const fs = require('fs');
const path = require('path');
const { Canvas } = require(path.join(__dirname, '..', 'kit', 'runtime', 'canvas'));

const W = '#ffffff', A = '#ffb000';
const c = new Canvas(140, 140);
// the mirror housing, its stalk to the door
c.strokeRoundRect(46, 34, 80, 60, 16, 7, W);
c.line(46, 78, 22, 98, 8, W);
c.line(22, 98, 22, 116, 8, W);
// the camera under it
c.arc(86, 64, 11, 17, 0, 360, W);
c.circle(86, 64, 6, W);
// the turn signal: an arrow pointing out, left
c.triangle([[8, 40], [34, 20], [34, 60]], A);
c.fillRect(34, 32, 12, 16, A);
// its light rays
c.line(60, 108, 52, 124, 6, A);
c.line(86, 108, 86, 126, 6, A);
c.line(112, 108, 120, 124, 6, A);
fs.writeFileSync(path.join(__dirname, '..', 'apps', 'xinhan_cam', 'icon.png'), c.png());
console.log('apps/xinhan_cam/icon.png written');
