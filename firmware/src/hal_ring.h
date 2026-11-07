#pragma once
#include <Adafruit_NeoPixel.h>
#include <driver/rmt.h>

#include "protocol.h"

namespace rehab::hal {
class Ring {
 public:
  void begin();
  void update(const Telemetry& telemetry);

 private:
  static constexpr rmt_channel_t CHANNEL = RMT_CHANNEL_4;
  Adafruit_NeoPixel pixels_{config::RING_PIXELS, config::RING_PIN, NEO_GRB + NEO_KHZ800};
  rmt_item32_t items_[config::RING_PIXELS * 24 + 1]{};
  uint32_t last_ = 0;
  bool ready_ = false;
};
}  // namespace rehab::hal
