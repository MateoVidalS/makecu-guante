#include "ramp.h"

#include <algorithm>
#include <cmath>

namespace rehab::ramp {
float advance(float position, float goal, float unitsPerSecond, float seconds) {
  if (!std::isfinite(position) || !std::isfinite(goal) || !std::isfinite(unitsPerSecond) ||
      !std::isfinite(seconds) || unitsPerSecond <= 0 || seconds <= 0) return position;
  const float step = unitsPerSecond * seconds;
  if (goal >= position) return std::min(goal, position + step);
  return std::max(goal, position - step);
}
}  // namespace rehab::ramp
