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
// The LEDC timers must be pre-configured at the width ESP32Servo really uses. Its
// Servo::attach() resets a fresh servo to DEFAULT_TIMER_WIDTH (10 bits), ignoring an
// earlier setTimerWidth(). If begin() leaves a timer running at another width, the
// first attach after boot reconfigures that running timer: the counter must first run
// out the old 16-bit period at the new 51.2 kHz clock (65536 / 51200 = 1.28 s), with
// no pulses, and the servo then jumps straight to its ramped position (bench, Nov 8).
// hal_servo.cpp static_asserts this against the library. At 10 bits one step is
// 20000 / 1024 = 19.5 us, about 1.76 degrees: the servo resolution of this firmware.
inline constexpr uint32_t SERVO_HZ = 50;
inline constexpr uint8_t SERVO_TIMER_BITS = 10;
static_assert(SERVO_TIMERS >= 1 && SERVO_TIMERS <= MAX_TIMERS,
              "every servo needs an LEDC channel on an allocated timer");
static_assert(SERVO_TIMERS * CHANNELS_PER_TIMER >= config::FINGERS,
              "allocated timers must cover every finger");
}  // namespace rehab::pwm
