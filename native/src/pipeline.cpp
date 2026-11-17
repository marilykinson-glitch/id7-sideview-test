// SPDX-License-Identifier: GPL-3.0-or-later
#include "pipeline.h"

#include <chrono>
#include <cstring>
#include <unistd.h>

#include "log.h"

namespace sidecam {

namespace {
int64_t now_us()
{
    return std::chrono::duration_cast<std::chrono::microseconds>(std::chrono::steady_clock::now().time_since_epoch())
        .count();
}
}  // namespace

const char *view_name(View v)
{
    switch (v) {
    case kLeft: return "left";
    case kRight: return "right";
    case kAll: return "all";
    case kFront: return "front";
    default: return "none";
    }
}

View view_from(const std::string &name)
{
    if (name == "left") return kLeft;
    if (name == "right") return kRight;
    if (name == "all") return kAll;
    if (name == "front") return kFront;
    return kNone;
}

/* About 4 s of a 5 Mbit/s stream, as the receive side of waze-on-cluster. */
Pipeline::Pipeline() : queue_(4096, 6 << 20) {}
Pipeline::~Pipeline() { stop(); }

bool Pipeline::start(int wake_fd, std::string *err)
{
    wake_fd_ = wake_fd;
    if (!dec_.open(err))
        return false;
    rtp_.on_gap = [this](const woc::RtpH264::Gap &g) {
        std::lock_guard<std::mutex> lock(mutex_);
        stats_.lost += g.lost;
    };
    running_ = true;
    thread_ = std::thread([this] { loop(); });
    return true;
}

void Pipeline::stop()
{
    avb_.stop();
    joined_ = false;
    if (running_.exchange(false)) {
        queue_.close();
        if (thread_.joinable())
            thread_.join();
    }
    dec_.close();
}

bool Pipeline::join(const std::string &stream, std::string *err)
{
    if (joined_)
        return true;
    joined_ = avb_.start(stream, [this](const uint8_t *d, size_t n) { push(d, n); }, err);
    std::lock_guard<std::mutex> lock(mutex_);
    avb_state_ = joined_ ? "ok" : *err;
    return joined_;
}

void Pipeline::push(const uint8_t *pkt, size_t len)
{
    if (!len || len > 65536)
        return;
    queue_.push(pkt, len, 0);
}

uint32_t Pipeline::set_output(const Output &o)
{
    std::lock_guard<std::mutex> lock(mutex_);
    out_ = o;
    fresh_view_ = true;
    have_ready_ = false;
    return ++gen_;
}

void Pipeline::set_view(View v)
{
    std::lock_guard<std::mutex> lock(mutex_);
    if (v == view_)
        return;
    view_ = v;
    fresh_view_ = true;
    have_ready_ = false;
}

void Pipeline::set_overlay(const Overlay &o)
{
    std::lock_guard<std::mutex> lock(mutex_);
    overlay_ = o;
}

bool Pipeline::take(std::vector<uint8_t> *atlas, AtlasMeta *meta)
{
    std::lock_guard<std::mutex> lock(mutex_);
    if (!have_ready_)
        return false;
    atlas->swap(ready_);
    *meta = ready_meta_;
    have_ready_ = false;
    return true;
}

Stats Pipeline::stats()
{
    Stats s;
    {
        std::lock_guard<std::mutex> lock(mutex_);
        s = stats_;
        s.avb = avb_state_;
    }
    s.dropped = queue_.overflows();
    return s;
}

void Pipeline::loop()
{
    woc::PacketQueue::Packet pkt;
    const woc::RtpH264::Sink sink = [this](const uint8_t *nal, size_t len, bool end_of_au) {
        if (len)
            au_.insert(au_.end(), nal, nal + len);
        if (!end_of_au || au_.empty())
            return;
        const int64_t t0 = now_us();
        const int r = dec_.decode(au_.data(), au_.size(), [this](const DecodedFrame &f) { on_picture(f); });
        const int64_t t1 = now_us();
        au_.clear();
        std::lock_guard<std::mutex> lock(mutex_);
        stats_.access_units++;
        stats_.decode_errors = dec_.errors();
        stats_.restarts = dec_.restarts();
        if (r > 0)
            stats_.decode_us = (int)(t1 - t0);
    };
    while (running_.load()) {
        if (!queue_.pop(&pkt, 200))
            continue;
        {
            std::lock_guard<std::mutex> lock(mutex_);
            stats_.packets++;
            stats_.bytes += pkt.data.size();
        }
        rtp_.push(pkt.data.data(), pkt.data.size(), sink);
        /* an access unit that never ends (a stream cut off mid-picture) must not grow for ever */
        if (au_.size() > (8u << 20))
            au_.clear();
    }
}

void Pipeline::on_picture(const DecodedFrame &f)
{
    const int64_t now = cld::now_ms();
    Output out;
    View view;
    uint32_t gen;
    bool fresh;
    {
        std::lock_guard<std::mutex> lock(mutex_);
        stats_.pictures++;
        stats_.corrupt += f.corrupt;
        stats_.keyframes += f.key;
        stats_.w = f.planes.w;
        stats_.h = f.planes.h;
        stats_.full_range = f.planes.full_range;
        stats_.picture_ms = now;
        if (!f.sei.empty()) {
            if (f.sei != stats_.sei)
                stats_.sei_prev = stats_.sei;
            stats_.sei = f.sei;
        }
        out = out_;
        view = view_;
        gen = gen_;
        fresh = fresh_view_;
    }
    /* Two pictures by turns: which one this is (always, so the tag is known when a view comes on) */
    const bool pairing = out.pair && (int64_t)f.planes.w * 2 >= (int64_t)f.planes.h * 5;
    int cls = 0;
    if (pairing)
        cls = tagger_.classify(f.sei) ^ (out.pair_swap ? 1 : 0);
    {
        std::lock_guard<std::mutex> lock(mutex_);
        stats_.pair = pairing ? tagger_.mode() : "off";
    }
    if (view == kNone) {
        pair_have_[0] = pair_have_[1] = false;
        return;
    }
    Planes src = f.planes;
    if (pairing) {
        const int w = f.planes.w, h = f.planes.h;
        if (w != pair_w_ || h != pair_h_) {
            pair_w_ = w;
            pair_h_ = h;
            pair_y_.assign((size_t)w * h * 2, 0);
            pair_u_.assign((size_t)(w / 2) * h, 128);
            pair_v_.assign((size_t)(w / 2) * h, 128);
            pair_have_[0] = pair_have_[1] = false;
        }
        for (int r = 0; r < h; r++)
            std::memcpy(&pair_y_[(size_t)(cls * h + r) * w], f.planes.y + (size_t)r * f.planes.y_stride, (size_t)w);
        for (int r = 0; r < h / 2; r++) {
            std::memcpy(&pair_u_[(size_t)(cls * (h / 2) + r) * (w / 2)], f.planes.u + (size_t)r * f.planes.c_stride, (size_t)(w / 2));
            std::memcpy(&pair_v_[(size_t)(cls * (h / 2) + r) * (w / 2)], f.planes.v + (size_t)r * f.planes.c_stride, (size_t)(w / 2));
        }
        pair_have_[cls] = true;
        pair_ms_[cls] = now;
        /* both halves, and neither left over from long ago (the other kind stopped coming) */
        if (!pair_have_[0] || !pair_have_[1] || now - pair_ms_[cls ^ 1] > 500)
            return;
        src.y = pair_y_.data();
        src.u = pair_u_.data();
        src.v = pair_v_.data();
        src.y_stride = w;
        src.c_stride = w / 2;
        src.h = h * 2;
    }
    /* At most fps views a second, evenly: each view is due one period after
     * the last was due (not after it was made), so 12 a second out of a
     * 15-a-second stream is four pictures of five, not every other one. */
    const int64_t period = out.fps ? 1000 / (int64_t)out.fps : 0;
    if (fresh || !period || now - next_due_ms_ > 4 * period)
        next_due_ms_ = now;
    if (now + period / 8 < next_due_ms_)
        return;
    next_due_ms_ += period;
    const int64_t t0 = now_us();
    const ViewSpec &vs = out.views[view];
    if (!resampler_.matches(src.w, src.h, vs, out.w, out.h) && !resampler_.build(src.w, src.h, vs, out.w, out.h)) {
        log_warn("view %s: a %dx%d picture cannot be made %dx%d", view_name(view), src.w, src.h, out.w, out.h);
        return;
    }
    work_.resize(atlas_bytes(out.w, out.h));
    resampler_.run(src, work_.data());
    if (view == kFront) {
        Overlay ov;
        {
            std::lock_guard<std::mutex> lock(mutex_);
            ov = overlay_;
        }
        draw_overlay(work_.data(), out.w, out.h, ov, now);
    }
    const int64_t t1 = now_us();
    {
        std::lock_guard<std::mutex> lock(mutex_);
        if (gen != gen_ || view != view_)
            return;   /* the setting changed while this one was made */
        ready_.swap(work_);
        ready_meta_.view = view;
        ready_meta_.id = next_id_++;
        ready_meta_.w = out.w;
        ready_meta_.h = out.h;
        ready_meta_.gen = gen;
        ready_meta_.ms = now;
        have_ready_ = true;
        fresh_view_ = false;
        stats_.atlases++;
        stats_.view_us = (int)(t1 - t0);
    }
    if (wake_fd_ >= 0) {
        const uint64_t one = 1;
        ssize_t n = ::write(wake_fd_, &one, sizeof one);
        (void)n;
    }
}

}  // namespace sidecam
