#include "hal_servo.h"

#include <cmath>

#include "pwm_plan.h"

static_assert(rehab::pwm::SERVO_TIMER_BITS == DEFAULT_TIMER_WIDTH,
              "LEDC timers must start at ESP32Servo's attach width, or the first attach "
              "after boot outputs no pulses for 1.28 s and then jumps (see pwm_plan.h)");

namespace rehab::hal {
void ServoOut::begin() {
  // Initialize LEDC resources before the control loop without routing any PWM
  // to the glove. ESP32Servo subsequently reuses these drivers and timers, so they
  // start at its own frequency and width: the first attach then changes nothing.
  for (uint8_t channel = 0; channel < 16; channel += 2)
    ledcSetup(channel, pwm::SERVO_HZ, pwm::SERVO_TIMER_BITS);
  // Five servos need two timers; see pwm_plan.h.
  for (std::size_t timer = 0; timer < pwm::SERVO_TIMERS; ++timer)
    ESP32PWM::allocateTimer(static_cast<int>(timer));
  for (std::size_t i = 0; i < config::FINGERS; ++i) {
    digitalWrite(config::SERVO_PINS[i], LOW);
    pinMode(config::SERVO_PINS[i], OUTPUT);
    servos_[i].setPeriodHertz(pwm::SERVO_HZ);
  }
}
void ServoOut::apply(const SafetyController& safety) {
  for (std::size_t i = 0; i < config::FINGERS; ++i) {
    if (safety.attached(i)) {
      if (!servos_[i].attached())
        channels_[i] = servos_[i].attach(config::SERVO_PINS[i], 500, 2500);
      // All safety bounds live in the core. Round to the microsecond; LEDC then
      // quantizes to 19.5 us steps (pwm_plan.h).
      const auto pulse =
          static_cast<int>(std::lround(500.0F + safety.angle(i) * (2000.0F / 180.0F)));
      servos_[i].writeMicroseconds(pulse);
    } else if (servos_[i].attached()) {
      ledcWrite(channels_[i], 0);  // Disable pulses; clear stale duty before reuse.
      servos_[i].detach();
      channels_[i] = -1;
      digitalWrite(config::SERVO_PINS[i], LOW);
    }
  }
}
}  // namespace rehab::hal
