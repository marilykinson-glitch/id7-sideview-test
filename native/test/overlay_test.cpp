/* SPDX-License-Identifier: GPL-3.0-or-later */
/* overlay.cpp: the road's projection and that each mode draws (or leaves the picture alone). */
#include <stdio.h>
#include <string.h>

#include <memory>
#include <vector>

#include "overlay.h"

using namespace sidecam;

static int fails = 0;
static void check(bool ok, const char *what)
{
    printf("  %s %s\n", ok ? "ok  " : "FAIL", what);
    if (!ok)
        fails++;
}
static size_t changed(const Overlay &o, int64_t t, std::vector<uint8_t> *keep = nullptr)
{
    const int w = 512, h = 384;
    std::vector<uint8_t> a((size_t)w * h * 3 / 2, 100), b;
    b = a;
    draw_overlay(a.data(), w, h, o, t);
    size_t n = 0;
    for (size_t i = 0; i < a.size(); i++)
        n += a[i] != b[i];
    if (keep)
        *keep = a;
    return n;
}

int main()
{
    Calib c;
    double x5, y5, x20, y20, xr, yr, xb, yb;
    check(project(c, 512, 384, 0, 0, 5, &x5, &y5) && project(c, 512, 384, 0, 0, 20, &x20, &y20), "points 5 and 20 m ahead are in the picture");
    check(y20 < y5 && y5 > 150 && y5 < 384 && x5 > 250 && x5 < 262, "the farther one is higher up, both on the centre line");
    check(project(c, 512, 384, 1.5, 0, 5, &xr, &yr) && xr > x5 + 20, "a point to the right is to the right");
    check(!project(c, 512, 384, 0, 0, -3, &xb, &yb), "a point behind the camera is not in the picture");
    Calib up = c;
    up.pitch = 20;
    double xu, yu;
    check(project(up, 512, 384, 0, 0, 5, &xu, &yu) && yu < y5, "tilting the camera down moves the road up in the picture");
    Calib fish = c;
    fish.curve = 100;
    fish.fov = 180;
    double xf, yf;
    check(project(fish, 512, 384, 3, 0, 4, &xf, &yf) && xf < 512, "a fisheye of 180 degrees still has the point");

    Overlay o;
    check(changed(o, 0) == 0, "off: the picture is left alone");
    o.mode = kArMarks;
    check(changed(o, 0) > 1500, "marks: drawn");
    o.mode = kArRoute;
    o.angle = 90;
    o.meters = 25;
    std::vector<uint8_t> a, b;
    check(changed(o, 1000, &a) > 2000, "route: chevrons and the card drawn");
    changed(o, 1250, &b);
    check(a != b, "the chevrons move with time");
    o.card = false;
    const size_t no_card = changed(o, 1000);
    o.card = true;
    check(no_card + 1000 < changed(o, 1000), "without the card less is drawn");
    {
        auto lab = std::make_shared<std::vector<uint8_t>>(200 * 30, 255);
        const size_t before = changed(o, 1000);
        o.label = lab;
        o.label_w = 200;
        o.label_h = 30;
        check(changed(o, 1000) > before + 3000, "the road's name under the card: drawn");
        o.label_w = 4000;
        check(changed(o, 1000) == before, "a label wider than the picture is left out");
        o.label.reset();
        o.label_w = o.label_h = 0;
    }
    o.meters = -1;
    o.kind = kRoundabout;
    check(changed(o, 0) > 500, "a roundabout without a distance: drawn");
    o.kind = kDestination;
    o.meters = 1500;
    check(changed(o, 0) > 500, "the destination 1,5 km ahead: drawn");
    /* nothing may be written outside the atlas, whatever the numbers */
    o.kind = kTurn;
    for (int i = 0; i < 400; i++) {
        o.angle = (i * 37) % 360 - 180;
        o.meters = (i * 13) % 80;
        o.calib.pitch = (i * 7) % 60 - 10;
        o.calib.fov = 40 + (i * 11) % 150;
        o.calib.curve = (i * 3) % 101;
        o.calib.yaw = (i % 41) - 20;
        std::vector<uint8_t> g(512 * 384 * 3 / 2 + 64, 7);
        draw_overlay(g.data(), 512, 384, o, i * 100);
        for (int k = 0; k < 64; k++)
            if (g[512 * 384 * 3 / 2 + k] != 7) {
                check(false, "wrote past the atlas");
                return 1;
            }
    }
    check(true, "400 odd settings: nothing written past the atlas");
    printf(fails ? "overlay_test: %d FAILED\n" : "overlay_test: all ok\n", fails);
    return fails ? 1 : 0;
}
