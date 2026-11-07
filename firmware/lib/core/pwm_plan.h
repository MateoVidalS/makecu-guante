#pragma once
#include <cstddef>

#include "config.h"

namespace rehab::pwm {
// ESP32Servo 1.2.1 (ESP32PWM::allocatenext) gives each of the four LEDC timers at
// most four channels. Once allocateTimer() is called, every timer that was not
// explicitly allocated counts as full, so with one timer the fifth Servo::attach()
// fails silently and that finger never moves. Reserve enough timers for every
// finger; all of them run at the same 50 Hz.
inline constexpr std::size_t CHANNELS_PER_TIMER = 4;
inline constexpr std::size_t MAX_TIMERS = 4;
inline constexpr std::size_t timersFor(std::size_t servos) {
  return (servos + CHANNELS_PER_TIMER - 1) / CHANNELS_PER_TIMER;
}
inline constexpr std::size_t SERVO_TIMERS = timersFor(config::FINGERS);
static_assert(SERVO_TIMERS >= 1 && SERVO_TIMERS <= MAX_TIMERS,
              "every servo needs an LEDC channel on an allocated timer");
static_assert(SERVO_TIMERS * CHANNELS_PER_TIMER >= config::FINGERS,
              "allocated timers must cover every finger");
}  // namespace rehab::pwm
