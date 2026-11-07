#pragma once

#include "protocol.h"

namespace rehab {
class SafetyController {
 public:
  using EventSink = void (*)(void*, const Event&);
  explicit SafetyController(EventSink sink = nullptr, void* context = nullptr)
      : sink_(sink), context_(context) {}
  void begin(bool sensorAvailable, uint32_t now);
  ErrorCode handle(const Command& command, uint32_t now);
  void stopPressed(uint32_t now);
  void stopReleased();
  void sensorMissing(uint32_t now);
  void current(float ma, uint32_t now);
  // Called after current(), before the outputs are applied.
  void tick(uint32_t now);
  Telemetry telemetry(uint32_t now) const;
  Info info() const { return {limit_, calibration_}; }
  State state() const { return state_; }
  Mode mode() const { return mode_; }
  bool calibrated() const;
  bool attached(std::size_t i) const { return i < 3 && attached_[i]; }
  float angle(std::size_t i) const;
  float goal(std::size_t i) const { return i < 3 ? goals_[i] : 0; }
  bool stopHeld() const { return stopHeld_; }

 private:
  void emit(EventKind event, float ma = 0);
  void release(uint32_t now);
  void fault(EventKind reason, uint32_t now, float ma = 0);
  void startMove(uint32_t now);
  EventSink sink_;
  void* context_;
  State state_ = State::Idle;
  Mode mode_ = Mode::None;
  std::array<Calibration, 3> calibration_{};
  Triple angles_{{90, 90, 90}};
  Triple goals_{};
  std::array<bool, 3> attached_{};
  float speed_ = 0;
  float ma_ = 0;
  float limit_ = config::LIMIT_DEFAULT_MA;
  float peak_ = 0;
  uint32_t lastMessage_ = 0;
  uint32_t lastRamp_ = 0;
  uint32_t overSince_ = 0;
  uint32_t releasedAt_ = 0;
  bool sensorAvailable_ = false;
  bool stopHeld_ = false;
  bool over_ = false;
  bool releasing_ = false;
  bool releaseComplete_ = false;
};
}  // namespace rehab
