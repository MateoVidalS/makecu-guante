#pragma once
#include "stop_debounce.h"

namespace rehab::hal {
class StopButton {
 public:
  void begin();
  StopDebounce::Edges poll(uint32_t now);
  bool low() const;

 private:
  StopDebounce debounce_;
};
}  // namespace rehab::hal
