#include "hal_servo.h"

#include <cmath>

namespace rehab::hal {
void ServoOut::begin() {
  // Initialize LEDC resources before the control loop without routing any PWM
  // to the glove. ESP32Servo subsequently reuses these drivers and timers.
  for (uint8_t channel = 0; channel < 16; channel += 2) ledcSetup(channel, 50, 16);
  ESP32PWM::allocateTimer(0);
  for (std::size_t i = 0; i < config::FINGERS; ++i) {
    digitalWrite(config::SERVO_PINS[i], LOW);
    pinMode(config::SERVO_PINS[i], OUTPUT);
    servos_[i].setPeriodHertz(50);
  }
}
void ServoOut::apply(const SafetyController& safety) {
  for (std::size_t i = 0; i < config::FINGERS; ++i) {
    if (safety.attached(i)) {
      if (!servos_[i].attached())
        channels_[i] = servos_[i].attach(config::SERVO_PINS[i], 500, 2500);
      // All safety bounds live in the core. Preserve sub-degree ramp resolution.
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
