'use strict';
/**
 * make_icon_avatar.js - the tile icon of Ảnh đại diện (apps/anh_dai_dien/icon.png, 140x140): a picture frame
 * with a head and shoulders in it and an amber plus, white line art on transparent like the HMI's own icons.
 *   node scripts/make_icon_avatar.js
 */
const fs = require('fs');
const path = require('path');
const { Canvas } = require(path.join(__dirname, '..', 'kit', 'runtime', 'canvas'));

const W = '#ffffff', A = '#ffb000';
const c = new Canvas(140, 140);
c.strokeRoundRect(18, 20, 104, 104, 24, 7, W);          // the picture frame
c.circle(70, 62, 16, W);                                // the head
c.arc(70, 124, 26, 44, 205, 335, W);                    // the shoulders (the frame cuts them off at the bottom)
c.circle(112, 112, 21, '#000000');                      // room around the plus
c.circle(112, 112, 17, A);
c.fillRect(105, 109, 14, 6, '#000000');
c.fillRect(109, 105, 6, 14, '#000000');
fs.writeFileSync(path.join(__dirname, '..', 'apps', 'anh_dai_dien', 'icon.png'), c.png());
console.log('apps/anh_dai_dien/icon.png written');
