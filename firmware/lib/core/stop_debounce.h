#pragma once
#include "config.h"

namespace rehab {
// Presses latch on the first sampled edge, including a pulse already released.
// Only a continuously high input for 20 ms re-arms the button. Debounce must
// never delay STOP or allow a bouncing release to clear a fault.
class StopDebounce {
 public:
  struct Edges { bool pressed = false; bool released = false; };
  Edges update(bool low, bool interruptSeen, uint32_t now) {
    Edges edges;
    if (low || interruptSeen) {
      high_ = false;
      if (!held_) { held_ = true; edges.pressed = true; }
    } else if (held_) {
      if (!high_) { high_ = true; highSince_ = now; }
      else if (static_cast<uint32_t>(now - highSince_) >= config::STOP_DEBOUNCE_MS) {
        held_ = false;
        high_ = false;
        edges.released = true;
      }
    }
    return edges;
  }
 private:
  uint32_t highSince_ = 0;
  bool held_ = false;
  bool high_ = false;
};
}  // namespace rehab
