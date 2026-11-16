// SPDX-License-Identifier: GPL-3.0-or-later
#include "decoder.h"

#include <cstdio>
#include <cstring>

extern "C" {
#include <libavcodec/avcodec.h>
#include <libavutil/frame.h>
#include <libavutil/log.h>
#include <libavutil/pixfmt.h>
}

#include "log.h"

namespace sidecam {

struct H264Decoder::State {
    AVCodecContext *ctx = nullptr;
    AVPacket *pkt = nullptr;
    AVFrame *frame = nullptr;
};

namespace {

void quiet_log(void *, int level, const char *fmt, va_list ap)
{
    /* libavcodec reports every concealed picture; only with -v */
    if (level > AV_LOG_ERROR || !cld::log_verbose)
        return;
    char line[256];
    std::vsnprintf(line, sizeof line, fmt, ap);
    size_t n = std::strlen(line);
    while (n && (line[n - 1] == '\n' || line[n - 1] == '\r'))
        line[--n] = 0;
    if (n)
        log_debug("libavcodec: %s", line);
}

}  // namespace

H264Decoder::H264Decoder() {}
H264Decoder::~H264Decoder() { close(); }

std::string H264Decoder::version()
{
    char b[64];
    const unsigned v = avcodec_version();
    std::snprintf(b, sizeof b, "libavcodec %u.%u.%u", v >> 16, (v >> 8) & 255, v & 255);
    return b;
}

bool H264Decoder::open(std::string *err)
{
    close();
    av_log_set_callback(quiet_log);
    const AVCodec *codec = avcodec_find_decoder(AV_CODEC_ID_H264);
    if (!codec) {
        *err = "libavcodec has no H.264 decoder";
        return false;
    }
    s_ = new State();
    s_->ctx = avcodec_alloc_context3(codec);
    s_->pkt = av_packet_alloc();
    s_->frame = av_frame_alloc();
    if (!s_->ctx || !s_->pkt || !s_->frame) {
        *err = "out of memory";
        close();
        return false;
    }
    /* Every picture out as soon as it is decoded, damaged ones and the ones
     * before the first keyframe too: a camera view late or frozen is worse
     * than one with a blemish. */
    s_->ctx->flags |= AV_CODEC_FLAG_LOW_DELAY | AV_CODEC_FLAG_OUTPUT_CORRUPT;
    s_->ctx->flags2 |= AV_CODEC_FLAG2_SHOW_ALL | AV_CODEC_FLAG2_FAST;
    s_->ctx->thread_count = 2;
    s_->ctx->thread_type = FF_THREAD_SLICE;   /* frame threads would hold pictures back */
    s_->ctx->err_recognition = 0;
    int r = avcodec_open2(s_->ctx, codec, nullptr);
    if (r < 0) {
        char e[128];
        av_strerror(r, e, sizeof e);
        *err = std::string("avcodec_open2: ") + e;
        close();
        return false;
    }
    fails_ = 0;
    return true;
}

void H264Decoder::close()
{
    if (!s_)
        return;
    if (s_->frame)
        av_frame_free(&s_->frame);
    if (s_->pkt)
        av_packet_free(&s_->pkt);
    if (s_->ctx)
        avcodec_free_context(&s_->ctx);
    delete s_;
    s_ = nullptr;
}

int H264Decoder::decode(const uint8_t *data, size_t len, const Sink &sink)
{
    if (!s_ || !len)
        return -1;
    buf_.resize(len + AV_INPUT_BUFFER_PADDING_SIZE);
    std::memcpy(buf_.data(), data, len);
    std::memset(buf_.data() + len, 0, AV_INPUT_BUFFER_PADDING_SIZE);
    s_->pkt->data = buf_.data();
    s_->pkt->size = (int)len;
    int r = avcodec_send_packet(s_->ctx, s_->pkt);
    int pictures = 0;
    bool failed = r < 0 && r != AVERROR(EAGAIN);
    for (;;) {
        int g = avcodec_receive_frame(s_->ctx, s_->frame);
        if (g < 0)
            break;
        const AVFrame *f = s_->frame;
        if ((f->format == AV_PIX_FMT_YUV420P || f->format == AV_PIX_FMT_YUVJ420P) && f->width >= 32 && f->height >= 32 &&
            !(f->width & 1) && !(f->height & 1) && f->linesize[0] > 0 && f->linesize[1] > 0 &&
            f->linesize[1] == f->linesize[2]) {
            DecodedFrame d;
            d.planes.y = f->data[0];
            d.planes.u = f->data[1];
            d.planes.v = f->data[2];
            d.planes.y_stride = f->linesize[0];
            d.planes.c_stride = f->linesize[1];
            d.planes.w = f->width;
            d.planes.h = f->height;
            d.planes.full_range = f->format == AV_PIX_FMT_YUVJ420P || f->color_range == AVCOL_RANGE_JPEG;
            d.key = (f->flags & AV_FRAME_FLAG_KEY) != 0;
            d.corrupt = (f->flags & AV_FRAME_FLAG_CORRUPT) != 0 || f->decode_error_flags != 0;
            const AVFrameSideData *sd = av_frame_get_side_data(f, AV_FRAME_DATA_SEI_UNREGISTERED);
            if (sd && sd->data) {
                static const char hex[] = "0123456789abcdef";
                const size_t n = sd->size < 40 ? sd->size : 40;
                for (size_t i = 0; i < n; i++) {
                    d.sei.push_back(hex[sd->data[i] >> 4]);
                    d.sei.push_back(hex[sd->data[i] & 15]);
                }
            }
            sink(d);
            pictures++;
        } else {
            failed = true;   /* not 8-bit 4:2:0: nothing this program can show */
        }
        av_frame_unref(s_->frame);
    }
    if (failed) {
        errors_++;
        if (++fails_ >= kFailLimit) {
            /* a sequence it cannot follow: a new decoder, from the next parameter sets */
            std::string err;
            restarts_++;
            log_warn("decoder: %d access units failed in a row, starting again", fails_);
            if (!open(&err))
                log_error("decoder: %s", err.c_str());
        }
        return pictures ? pictures : -1;
    }
    if (pictures)
        fails_ = 0;
    return pictures;
}

}  // namespace sidecam
