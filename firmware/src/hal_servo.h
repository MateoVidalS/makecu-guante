#pragma once
#include <ESP32Servo.h>

#include "safety.h"

namespace rehab::hal {
class ServoOut {
 public:
  void begin();
  void apply(const SafetyController& safety);

 private:
  Servo servos_[3];
  int channels_[3] = {-1, -1, -1};
};
}  // namespace rehab::hal
