#pragma once
#include <cmath>

namespace rehab {
class CurrentFilter {
 public:
  float update(float sample) {
    if (!std::isfinite(sample)) return sample;
    if (sample < 0) sample = 0;
    if (!ready_) { previous_ = filtered_ = sample; ready_ = true; return sample; }
    // The median of two values is their midpoint; EMA alpha = 0.5.
    const float median = (previous_ + sample) * 0.5F;
    previous_ = sample;
    filtered_ += 0.5F * (median - filtered_);
    return filtered_;
  }
 private:
  float previous_ = 0;
  float filtered_ = 0;
  bool ready_ = false;
};
}  // namespace rehab
