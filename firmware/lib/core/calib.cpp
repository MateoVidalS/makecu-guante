#include "calib.h"

#include <algorithm>
#include <cmath>

namespace rehab::calib {
float clampClosure(float value) {
  return std::isfinite(value) ? std::clamp(value, 0.0F, 1.0F) : 0.0F;
}
float clampAngle(float degrees) {
  return std::isfinite(degrees) ? std::clamp(degrees, config::HARD_MIN, config::HARD_MAX)
                                : config::HARD_MIN;
}
bool valid(float min, float max) {
  return std::isfinite(min) && std::isfinite(max) && min >= config::HARD_MIN &&
         min <= config::HARD_MAX && max >= config::HARD_MIN && max <= config::HARD_MAX &&
         std::fabs(max - min) >= 20.0F;
}
float toAngle(float pull, const Calibration& calibration) {
  if (!calibration.valid || !valid(calibration.min, calibration.max)) return config::HARD_MIN;
  return clampAngle(calibration.min + clampClosure(pull) * (calibration.max - calibration.min));
}
float toClosure(float angle, const Calibration& calibration) {
  if (!calibration.valid || !valid(calibration.min, calibration.max)) return 0;
  return clampClosure((angle - calibration.min) / (calibration.max - calibration.min));
}
}  // namespace rehab::calib
