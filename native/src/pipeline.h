// SPDX-License-Identifier: GPL-3.0-or-later
/* The camera stream from the head unit's media bus to atlases for the
 * cluster renderer.
 *
 *   the bus's thread / a feeder   each packet copied into a bounded queue
 *   the decode thread             RTP -> access units -> libavcodec -> the
 *                                 view's part of the newest picture, turned
 *                                 and scaled into an atlas
 *   the main thread               take(): the newest atlas not yet taken
 *
 * Every picture is decoded whether or not a view is wanted: the stream's
 * pictures build on each other, so a decoder that slept would have nothing
 * to show when the turn signal comes on. Only a wanted view is cut out and
 * scaled, at most `fps` times a second; the first picture after the view or
 * the output changes always is. */
#ifndef SIDECAM_PIPELINE_H
#define SIDECAM_PIPELINE_H

#include <atomic>
#include <mutex>
#include <string>
#include <thread>
#include <vector>

#include "avb_source.h"
#include "decoder.h"
#include "packet_queue.h"
#include "pair_tag.h"
#include "resample.h"
#include "rtp_h264.h"

namespace sidecam {

enum View { kNone = 0, kLeft = 1, kRight = 2, kAll = 3, kViews = 4 };
const char *view_name(View v);
View view_from(const std::string &name);

struct Output {
    int w = 512, h = 384;
    unsigned fps = 12;
    ViewSpec views[kViews];   /* by View; kNone's is unused */
    /* The camera unit sends two wide pictures by turns, two cameras in each (pair_tag.h): they are put
     * one above the other into one picture, the lower-tagged on top (pair_swap: below), and the views
     * are parts of that. Only for pictures at least 2.5 times as wide as high. */
    bool pair = false, pair_swap = false;
};

struct Stats {
    uint64_t packets = 0, bytes = 0;       /* received */
    uint64_t lost = 0;                     /* RTP packets missing */
    uint64_t dropped = 0;                  /* packets the queue dropped (decode too slow) */
    uint64_t access_units = 0;
    uint64_t pictures = 0;                 /* decoded */
    uint64_t corrupt = 0;                  /* of them, with concealed errors */
    uint64_t keyframes = 0;
    uint64_t decode_errors = 0, restarts = 0;
    uint64_t atlases = 0;                  /* views made */
    int w = 0, h = 0;                      /* the last picture's size */
    bool full_range = false;
    int64_t picture_ms = -1;               /* when the last picture was decoded (cld::now_ms), -1: none */
    int decode_us = 0, view_us = 0;        /* the last picture's decode, the last view's making */
    std::string sei;                       /* the last picture's user-data SEI, hex */
    std::string avb;                       /* the bus receiver: "", "ok" or why not */
    std::string pair;                      /* "off", or how the alternating pictures are told apart (PairTagger::mode) */
    std::string sei_prev;                  /* the SEI of the picture before the last */
};

struct AtlasMeta {
    View view = kNone;
    uint64_t id = 0;
    int w = 0, h = 0;          /* the output it was made for */
    uint32_t gen = 0;          /* the output setting's generation */
    int64_t ms = 0;            /* when its picture was decoded */
};

class Pipeline {
public:
    Pipeline();
    ~Pipeline();

    /* wake_fd: written (one byte) each time an atlas is ready; -1: none. */
    bool start(int wake_fd, std::string *err);
    void stop();

    /* Joins the media-bus stream; false with *err when the bridge refuses
     * (the caller tries again later). */
    bool join(const std::string &stream, std::string *err);
    bool joined() const { return joined_; }
    /* One RTP datagram, from any thread (a test feeder). */
    void push(const uint8_t *pkt, size_t len);

    /* Returns the setting's generation; atlases made for an older one are
     * not handed out. */
    uint32_t set_output(const Output &o);
    void set_view(View v);

    bool take(std::vector<uint8_t> *atlas, AtlasMeta *meta);
    Stats stats();

private:
    void loop();
    void on_picture(const DecodedFrame &f);

    woc::AvbSource avb_;
    woc::PacketQueue queue_;
    woc::RtpH264 rtp_;
    H264Decoder dec_;
    Resampler resampler_;
    std::thread thread_;
    std::atomic<bool> running_{false};
    bool joined_ = false;
    int wake_fd_ = -1;
    std::vector<uint8_t> au_;

    std::mutex mutex_;             /* everything below */
    Output out_;
    uint32_t gen_ = 1;
    View view_ = kNone;
    bool fresh_view_ = false;      /* the view or output changed: the next picture gets an atlas at once */
    std::vector<uint8_t> ready_;
    AtlasMeta ready_meta_;
    bool have_ready_ = false;
    Stats stats_;
    std::string avb_state_;

    /* decode thread only */
    PairTagger tagger_;
    std::vector<uint8_t> pair_y_, pair_u_, pair_v_;   /* the two pictures, one above the other */
    int pair_w_ = 0, pair_h_ = 0;                     /* one picture's size */
    bool pair_have_[2] = {false, false};
    int64_t pair_ms_[2] = {0, 0};
    std::vector<uint8_t> work_;
    int64_t next_due_ms_ = 0;      /* when the next view is due (pacing) */
    uint64_t next_id_ = 1;
};

}  // namespace sidecam

#endif
