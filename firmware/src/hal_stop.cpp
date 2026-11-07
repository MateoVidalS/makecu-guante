#include "hal_stop.h"

#include <Arduino.h>

namespace rehab::hal {
namespace {
volatile bool pressed = false;
portMUX_TYPE stopMux = portMUX_INITIALIZER_UNLOCKED;
void IRAM_ATTR onStop() {
  portENTER_CRITICAL_ISR(&stopMux);
  pressed = true;
  portEXIT_CRITICAL_ISR(&stopMux);
}
}  // namespace
void StopButton::begin() {
  pinMode(config::STOP_PIN, INPUT_PULLUP);
  attachInterrupt(digitalPinToInterrupt(config::STOP_PIN), onStop, FALLING);
}
bool StopButton::low() const { return digitalRead(config::STOP_PIN) == LOW; }
StopDebounce::Edges StopButton::poll(uint32_t now) {
  portENTER_CRITICAL(&stopMux);
  const bool edge = pressed;
  pressed = false;
  portEXIT_CRITICAL(&stopMux);
  return debounce_.update(low(), edge, now);
}
}  // namespace rehab::hal
