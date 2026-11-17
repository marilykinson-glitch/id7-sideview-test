/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Drawings on the front camera's picture, straight into the 4:2:0 atlas:
 *
 *   marks   the calibration page: the lane's edges and lines across it at 5, 10 and 20 m,
 *           which lie on the road at those distances once the camera is calibrated
 *   route   navigation: chevrons on the road that run ahead and bend into the next turn,
 *           arrows standing at the turn, and a card with the turn's arrow and distance
 *
 * The camera is a point `height` above the road, looking ahead and down by `pitch`, turned
 * by `yaw`, `shift` to the side of the car's middle; its picture spans `fov` degrees. The
 * 360-degree cameras are fisheyes: `curve` goes from 0 (straight lines stay straight) to 100
 * (equal angles are equal distances in the picture). All of it is set by eye on the
 * calibration page, so the model only has to be able to match what the camera does. */
#ifndef SIDECAM_OVERLAY_H
#define SIDECAM_OVERLAY_H

#include <stdint.h>

#include <memory>
#include <vector>

namespace sidecam {

struct Calib {
    double height = 0.70;    /* m above the road */
    double pitch = 8;        /* degrees down */
    double fov = 100;        /* degrees across the picture */
    double yaw = 0;          /* degrees to the right */
    double shift = 0;        /* m to the right of the car's middle */
    double curve = 40;       /* 0..100 */
};

enum ArMode { kArOff = 0, kArMarks = 1, kArRoute = 2 };
enum ArKind { kTurn = 0, kRoundabout = 1, kDestination = 2, kStraight = 3 };

struct Overlay {
    int mode = kArOff;
    Calib calib;
    int kind = kTurn;
    double angle = 90;       /* the turn, degrees: negative left, positive right; 0 straight on */
    double meters = -1;      /* to the turn; negative: unknown (the card shows no distance) */
    int exit = 0;            /* roundabout: the exit's number, 0 unknown */
    bool card = true;
    bool white = true;       /* the arrows white (as BMW's), else blue */
    int style = 0;           /* 0: a band of chevrons at the turn, as BMW's Augmented View; 1: chevrons on the road */
    /* a line of text under the card (the road's name), drawn by the app: label_w x label_h bytes, 0 nothing
     * to 255 white */
    std::shared_ptr<const std::vector<uint8_t>> label;
    int label_w = 0, label_h = 0;
    bool fade = false;       /* the picture's left and right edges fade to black (also with mode off) */
};

/* Draws o into an atlas of w x h (Y, then U and V side by side at half size). t_ms: the
 * time, for the chevrons' motion. */
void draw_overlay(uint8_t *atlas, int w, int h, const Overlay &o, int64_t t_ms);

/* A road point (x m to the right, up m above the road, z m ahead) in the picture; false
 * when it is behind the camera or far outside the picture. For tests. */
bool project(const Calib &c, int w, int h, double x, double up, double z, double *px, double *py);

}  // namespace sidecam

#endif
