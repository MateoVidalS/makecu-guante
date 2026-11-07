#pragma once
#include "protocol.h"

namespace rehab::calib {
float clampClosure(float value);
float clampAngle(float degrees);
bool valid(float min, float max);
float toAngle(float closure, const Calibration& calibration);
float toClosure(float angle, const Calibration& calibration);
}  // namespace rehab::calib
