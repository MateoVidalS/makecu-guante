#pragma once
#include <Adafruit_INA219.h>

#include "config.h"
#include "current_filter.h"

namespace rehab::hal {
class CurrentSensor {
 public:
  bool begin();
  float read();

 private:
  Adafruit_INA219 sensor_{config::INA_ADDRESS};
  CurrentFilter filter_;
  bool available_ = false;
};
}  // namespace rehab::hal
