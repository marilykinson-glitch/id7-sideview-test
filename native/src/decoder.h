// SPDX-License-Identifier: GPL-3.0-or-later
/* Software H.264 decoder (FFmpeg's libavcodec): one access unit of Annex-B
 * bytes in, decoded 4:2:0 pictures out, each as soon as it is decoded.
 *
 * Software on purpose: the camera unit's stream is not what the head unit's
 * hardware decoder is used to (it may carry no IDR pictures at all, only a
 * rolling intra refresh), and a decoder that never starts shows nothing.
 * libavcodec starts at the first parameter sets and shows pictures from
 * there, also before the first keyframe (they clear up as the refresh goes
 * round). 1280x960 at 15 pictures a second is a small part of one core.
 *
 * Not thread-safe: one thread calls it. */
#ifndef SIDECAM_DECODER_H
#define SIDECAM_DECODER_H

#include <stddef.h>
#include <stdint.h>
#include <functional>
#include <string>
#include <vector>

#include "resample.h"

namespace sidecam {

struct DecodedFrame {
    Planes planes;
    bool key = false;        /* a keyframe */
    bool corrupt = false;    /* decoded with concealed errors */
    std::string sei;         /* the picture's first unregistered user-data SEI, hex, at most 40 bytes */
};

class H264Decoder {
public:
    using Sink = std::function<void(const DecodedFrame &)>;
    /* Access units that fail in a row before the decoder is made again. */
    static const int kFailLimit = 30;

    H264Decoder();
    ~H264Decoder();
    H264Decoder(const H264Decoder &) = delete;
    H264Decoder &operator=(const H264Decoder &) = delete;

    bool open(std::string *err);
    void close();
    /* One whole access unit, every NAL unit behind a start code. Returns the
     * pictures it gave, or -1 when the access unit failed to decode. */
    int decode(const uint8_t *data, size_t len, const Sink &sink);

    uint64_t errors() const { return errors_; }
    uint64_t restarts() const { return restarts_; }
    /* libavcodec's name and version, for the log. */
    static std::string version();

private:
    struct State;
    State *s_ = nullptr;
    std::vector<uint8_t> buf_;
    int fails_ = 0;
    uint64_t errors_ = 0, restarts_ = 0;
};

}  // namespace sidecam

#endif
