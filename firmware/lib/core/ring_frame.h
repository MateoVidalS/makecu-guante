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
  // Bars show pull (how much the glove is opening each finger).
  // 20 bar pixels + four gaps fill 24 LEDs; no trailing gap after pinky.
  static_assert(config::RING_PIXELS == config::FINGERS * 4 + config::FINGERS - 1);
  for (std::size_t i = 0; i < config::FINGERS; ++i) {
    const auto count = static_cast<int>(std::lround(calib::clampClosure(t.a[i]) * 4));
    for (int pixel = 0; pixel < count; ++pixel) pixels[i * 5 + pixel] = color;
  }
  return pixels;
}
}  // namespace rehab
