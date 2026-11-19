// SPDX-License-Identifier: GPL-3.0-or-later
/* Which of the two alternating pictures a decoded picture is.
 *
 * In its four-camera mode the camera unit of some cars (seen on a G30: 1280x480 at 30 a second) sends
 * two pictures by turns, each holding two cameras side by side, instead of one picture with all four.
 * Each picture carries a user-data SEI; a byte of it that takes exactly two values, by turns, names the
 * kind of picture. PairTagger finds such a byte from the last pictures' SEIs and answers 0 for the
 * lower value and 1 for the higher, the same after every start. Once found, the byte and its two values
 * are kept: each picture is then told by its own value, so a lost picture (two of a kind in a row, which
 * the window search cannot accept for a while) changes nothing. Without one (no SEI, or none that
 * alternates) it answers by counting on from the last answer: 0, 1, 0, 1 ..., which is right only until
 * a picture is lost. */
#ifndef SIDECAM_PAIR_TAG_H
#define SIDECAM_PAIR_TAG_H

#include <deque>
#include <string>

namespace sidecam {

class PairTagger {
public:
    /* sei: the picture's SEI as hex (two characters a byte), or empty. */
    int classify(const std::string &sei)
    {
        count_++;
        hist_.push_back(sei);
        if (hist_.size() > kWindow)
            hist_.pop_front();
        int pos = find();
        if (pos >= 0) {
            /* learnt (again): the byte and its two values */
            const std::string &a = hist_[hist_.size() - 1], &b = hist_[hist_.size() - 2];
            const std::string va = a.substr((size_t)pos * 2, 2), vb = b.substr((size_t)pos * 2, 2);
            pos_ = pos;
            lo_ = va < vb ? va : vb;
            hi_ = va < vb ? vb : va;
            known_ = true;
        }
        /* the byte known: this picture's own value says which it is */
        if (known_ && sei.size() >= (size_t)pos_ * 2 + 2) {
            const std::string v = sei.substr((size_t)pos_ * 2, 2);
            if (v == lo_ || v == hi_) {
                by_sei_ = true;
                last_ = v == hi_ ? 1 : 0;
                return last_;
            }
        }
        by_sei_ = false;
        last_ = count_ == 1 ? 0 : last_ ^ 1;   /* the first picture is 0, then by turns */
        return last_;
    }
    void reset()
    {
        hist_.clear();
        count_ = 0;
        by_sei_ = false;
        known_ = false;
        last_ = 0;
    }
    /* "sei@N" (the byte it goes by) or "count". */
    std::string mode() const { return by_sei_ ? "sei@" + std::to_string(pos_) : "count"; }

private:
    static const size_t kWindow = 6;
    /* The first byte that alternates between two values over the whole window; -1: none. */
    int find() const
    {
        if (hist_.size() < kWindow)
            return -1;
        const size_t len = hist_[0].size();
        if (len < 2)
            return -1;
        for (size_t i = 1; i < hist_.size(); i++)
            if (hist_[i].size() != len)
                return -1;
        for (size_t p = 0; p + 1 < len; p += 2) {
            bool ok = true;
            for (size_t i = 1; ok && i < hist_.size(); i++) {
                if (hist_[i].compare(p, 2, hist_[i - 1], p, 2) == 0)
                    ok = false;
                if (i >= 2 && hist_[i].compare(p, 2, hist_[i - 2], p, 2) != 0)
                    ok = false;
            }
            if (ok)
                return (int)(p / 2);
        }
        return -1;
    }

    std::deque<std::string> hist_;
    unsigned long long count_ = 0;
    int pos_ = 0, last_ = 0;
    bool by_sei_ = false, known_ = false;
    std::string lo_, hi_;
};

}  // namespace sidecam

#endif
