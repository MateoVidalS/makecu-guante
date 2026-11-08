#pragma once
#include "protocol.h"

namespace rehab::calib {
// Legacy name: clamps normalized tendon pull (0 = slack, 1 = full pull).
float clampClosure(float value);
float clampAngle(float degrees);
bool valid(float min, float max);
// Maps normalized pull to an angle; calibration.min is slack, max is full pull.
float toAngle(float pull, const Calibration& calibration);
// Legacy name: returns normalized tendon pull, not anatomical finger closure.
float toClosure(float angle, const Calibration& calibration);
}  // namespace rehab::calib
