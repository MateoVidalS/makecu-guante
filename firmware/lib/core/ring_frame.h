#pragma once
#include <array>
#include <cmath>

#include "calib.h"

namespace rehab {
inline std::array<uint32_t, config::RING_PIXELS> ringFrame(const Telemetry& t) {
  std::array<uint32_t, config::RING_PIXELS> pixels{};
  if (t.st == State::Fault) {
    if ((t.ms / 250) % 2 == 0) pixels.fill(0xC62828);  // Two complete blinks per second.
    return pixels;
  }
  uint32_t color = 0x202020;  // Dim white, further limited to 20% in the HAL.
  if (t.st == State::Calib) color = 0xFFBF00;
  if (t.st == State::Run) color = t.md == Mode::Follow ? 0x2F6FEB : 0xE8890C;
  for (std::size_t i = 0; i < 3; ++i) {
    const auto count = static_cast<int>(std::lround(calib::clampClosure(t.a[i]) * 8));
    for (int pixel = 0; pixel < count; ++pixel) pixels[i * 8 + pixel] = color;
  }
  return pixels;
}
}  // namespace rehab
