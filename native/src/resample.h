// SPDX-License-Identifier: GPL-3.0-or-later
/* One camera's part of a decoded 4:2:0 picture, turned, mirrored and scaled
 * into the cluster renderer's 4:2:0 atlas (Y, then U and V side by side at
 * half size), letterboxed in the output when the shapes differ.
 *
 * The camera unit sends its cameras as one picture (four of them as a 2x2
 * mosaic); a view is a rectangle of it, in thousandths of the picture so the
 * same setting holds for any picture size. The sampling tables are built
 * once per (picture size, view, output size) and reused for every frame. */
#ifndef SIDECAM_RESAMPLE_H
#define SIDECAM_RESAMPLE_H

#include <stddef.h>
#include <stdint.h>
#include <string>
#include <vector>

namespace sidecam {

struct ViewSpec {
    int x = 0, y = 0, w = 1000, h = 1000;   /* the part of the picture, in 1/1000 of its size */
    int rot = 0;                            /* degrees clockwise: 0, 90, 180, 270 */
    bool flip = false;                      /* mirrored left to right, after the turn */
    int sar = 100;                          /* how wide a sample is shown, in % of its height: 200 for a
                                             * picture the camera unit squeezed to half its width */

    bool operator==(const ViewSpec &o) const
    {
        return x == o.x && y == o.y && w == o.w && h == o.h && rot == o.rot && flip == o.flip && sar == o.sar;
    }
    bool operator!=(const ViewSpec &o) const { return !(*this == o); }
};

/* "x,y,w,h" in 1/1000; false when it is not four numbers describing a part
 * of at least a 20th of the picture each way, inside it. */
bool parse_crop(const std::string &text, ViewSpec *v);

/* A picture's planes (8-bit 4:2:0, chroma at half size both ways). */
struct Planes {
    const uint8_t *y = nullptr, *u = nullptr, *v = nullptr;
    int y_stride = 0, c_stride = 0;
    int w = 0, h = 0;
    bool full_range = false;   /* else studio levels (16-235), stretched to full for the atlas */
};

inline size_t atlas_bytes(int w, int h) { return (size_t)w * h * 3 / 2; }

class Resampler {
public:
    /* Whether the tables are for this picture size, view and output. */
    bool matches(int src_w, int src_h, const ViewSpec &v, int out_w, int out_h) const
    {
        return src_w == src_w_ && src_h == src_h_ && v == view_ && out_w == out_w_ && out_h == out_h_;
    }
    /* out_w a multiple of 4, out_h even; src at least 32x32. False for
     * sizes it cannot do. */
    bool build(int src_w, int src_h, const ViewSpec &v, int out_w, int out_h);
    /* Fills atlas (atlas_bytes(out_w, out_h)) from a picture of the size it
     * was built for. */
    void run(const Planes &p, uint8_t *atlas) const;

    /* Where the picture lands in the output (the rest is black). */
    int content_x() const { return ox_; }
    int content_y() const { return oy_; }
    int content_w() const { return dw_; }
    int content_h() const { return dh_; }

private:
    struct Tap {
        uint16_t x, y;     /* the top-left source sample in its plane */
        uint8_t fx, fy;    /* weights of the right and lower neighbours, 0-255 */
    };
    void plane_taps(std::vector<Tap> *taps, int px0, int py0, int psw, int psh, int dw, int dh) const;

    int src_w_ = 0, src_h_ = 0, out_w_ = 0, out_h_ = 0;
    ViewSpec view_;
    int ox_ = 0, oy_ = 0, dw_ = 0, dh_ = 0;
    std::vector<Tap> y_taps_, c_taps_;     /* one per content pixel, row by row */
};

/* The whole atlas black (Y 0, chroma neutral). */
void black_atlas(uint8_t *atlas, int w, int h);

}  // namespace sidecam

#endif
