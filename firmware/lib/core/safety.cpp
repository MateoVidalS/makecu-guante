#include "safety.h"

#include <algorithm>
#include <cmath>

#include "calib.h"
#include "ramp.h"

namespace rehab {
void SafetyController::emit(EventKind event, float ma) {
  if (sink_) sink_(context_, Event{event, ma});
}
void SafetyController::begin(bool sensorAvailable, uint32_t now) {
  // No NVS: calibration and outputs always start empty/detached.
  state_ = State::Idle;
  mode_ = Mode::None;
  calibration_ = {};
  angles_ = {{90, 90, 90}};
  attached_ = {};
  goals_ = {};
  sensorAvailable_ = sensorAvailable;
  stopHeld_ = over_ = releasing_ = releaseComplete_ = false;
  ma_ = peak_ = 0;
  limit_ = config::LIMIT_DEFAULT_MA;
  lastMessage_ = lastRamp_ = now;
  emit(EventKind::Boot);
  if (!sensorAvailable_) emit(EventKind::InaMissing);
}
bool SafetyController::calibrated() const {
  return std::all_of(calibration_.begin(), calibration_.end(), [](const Calibration& c) { return c.valid; });
}
float SafetyController::angle(std::size_t i) const {
  return i < 3 ? calib::clampAngle(angles_[i]) : config::HARD_MIN;
}
void SafetyController::startMove(uint32_t now) {
  if (state_ != State::Run && state_ != State::Calib) lastRamp_ = now;
  releasing_ = releaseComplete_ = false;
}
void SafetyController::release(uint32_t now) {
  mode_ = Mode::None;
  goals_ = {};
  if (releasing_) return;  // Keep repeated release commands idempotent.
  releasing_ = true;
  releaseComplete_ = false;
  lastRamp_ = now;
  for (std::size_t i = 0; i < 3; ++i) {
    // A pre-calibration jog has no known safe opening direction. Go limp rather
    // than invent an open angle (in particular for a mirrored mount).
    if (!calibration_[i].valid) attached_[i] = false;
  }
}
void SafetyController::fault(EventKind reason, uint32_t now, float ma) {
  state_ = State::Fault;
  release(now);
  emit(reason, ma);
}
void SafetyController::stopPressed(uint32_t now) {
  if (stopHeld_) return;
  stopHeld_ = true;
  fault(EventKind::StopButton, now);
}
void SafetyController::stopReleased() {
  if (!stopHeld_) return;
  stopHeld_ = false;
  emit(EventKind::StopReleased);
}
void SafetyController::sensorMissing(uint32_t now) {
  if (!sensorAvailable_) return;
  sensorAvailable_ = false;
  if (state_ == State::Run || state_ == State::Calib) fault(EventKind::InaMissing, now);
  else emit(EventKind::InaMissing);
}

ErrorCode SafetyController::handle(const Command& c, uint32_t now) {
  // Validate again so callers cannot bypass the wire decoder's checks.
  if (!protocol::validCommand(c)) return ErrorCode::BadArgs;
  lastMessage_ = now;  // Syntactically valid messages also feed the watchdog when refused.
  if ((state_ == State::Fault || stopHeld_) &&
      (c.type == CommandType::Target || c.type == CommandType::Follow ||
       c.type == CommandType::Jog || c.type == CommandType::Calib)) return ErrorCode::Fault;
  switch (c.type) {
    case CommandType::Target:
    case CommandType::Follow:
      if (state_ != State::Idle && state_ != State::Run) return ErrorCode::State;
      if (!calibrated()) return ErrorCode::NoCalib;
      if (!sensorAvailable_) return ErrorCode::State;
      startMove(now);
      state_ = State::Run;
      mode_ = c.type == CommandType::Follow ? Mode::Follow : Mode::Target;
      speed_ = mode_ == Mode::Follow ? config::V_FOLLOW : std::min(c.v, config::V_MAX);
      for (std::size_t i = 0; i < 3; ++i) {
        goals_[i] = calib::clampClosure(c.f[i] - (mode_ == Mode::Follow ? config::FOLLOW_SLACK : 0));
        // A detached actuator has no feedback; the first commanded position is open.
        if (!attached_[i]) angles_[i] = calib::toAngle(0, calibration_[i]);
        attached_[i] = true;
      }
      return ErrorCode::None;
    case CommandType::Release:
      release(now);
      if (stopHeld_) { state_ = State::Fault; return ErrorCode::Fault; }
      state_ = State::Idle;
      over_ = false;
      return ErrorCode::None;
    case CommandType::Calib: {
      if (state_ != State::Idle) return ErrorCode::State;
      // A new batch cannot combine a previous patient's ranges with new ranges.
      if (calibrated()) {
        for (auto& range : calibration_) range.valid = false;
        attached_ = {};
      }
      attached_[c.i] = false;  // Never remap a powered servo during calibration.
      calibration_[c.i] = {c.min, c.max, true};
      angles_[c.i] = calib::toAngle(0, calibration_[c.i]);
      goals_[c.i] = 0;
      if (calibrated()) emit(EventKind::CalibOk);
      return ErrorCode::None;
    }
    case CommandType::Jog:
      if (state_ != State::Idle && state_ != State::Calib) return ErrorCode::State;
      if (mode_ != Mode::Jog) {
        for (std::size_t i = 0; i < 3; ++i) goals_[i] = angle(i);
      }
      startMove(now);
      state_ = State::Calib;
      mode_ = Mode::Jog;
      // Each newly jogged channel starts at its last commanded angle, or neutral
      // on a fresh boot. Other channels hold their preceding jog goals.
      if (!attached_[c.i]) goals_[c.i] = angle(c.i);
      attached_[c.i] = true;
      goals_[c.i] = c.deg;
      return ErrorCode::None;
    case CommandType::Limit:
      limit_ = std::clamp(c.ma, config::LIMIT_MIN_MA, config::LIMIT_MAX_MA);
      return ErrorCode::None;
    case CommandType::Ping:
    case CommandType::Hello:
      return ErrorCode::None;
    default:
      return ErrorCode::UnknownType;
  }
}
void SafetyController::current(float ma, uint32_t now) {
  if (!std::isfinite(ma)) { sensorMissing(now); return; }
  ma_ = std::max(0.0F, ma);
  const bool powered = std::any_of(attached_.begin(), attached_.end(), [](bool value) { return value; });
  if (!powered || state_ == State::Fault || ma_ <= limit_) { over_ = false; peak_ = 0; return; }
  if (!over_) { over_ = true; overSince_ = now; peak_ = ma_; }
  peak_ = std::max(peak_, ma_);
  if (static_cast<uint32_t>(now - overSince_) >= config::OVERCURRENT_MS) {
    fault(EventKind::Overcurrent, now, peak_);
    over_ = false;
  }
}
void SafetyController::tick(uint32_t now) {
  if ((state_ == State::Run || state_ == State::Calib) &&
      static_cast<uint32_t>(now - lastMessage_) >= config::WATCHDOG_MS) fault(EventKind::Watchdog, now);
  // Missed deadlines never create a large catch-up jump.
  const auto elapsed = std::min(static_cast<uint32_t>(now - lastRamp_), config::CONTROL_MS);
  lastRamp_ = now;
  const float seconds = static_cast<float>(elapsed) / 1000.0F;
  bool opened = true;
  for (std::size_t i = 0; i < 3; ++i) {
    if (!attached_[i]) continue;
    const auto& c = calibration_[i];
    if (releasing_) {
      if (!c.valid) { attached_[i] = false; continue; }
      const float rate = config::V_RELEASE * std::fabs(c.max - c.min);
      angles_[i] = calib::clampAngle(ramp::advance(angle(i), c.min, rate, seconds));
      opened = opened && angles_[i] == c.min;
    } else if (mode_ == Mode::Jog) {
      angles_[i] = calib::clampAngle(ramp::advance(angle(i), goals_[i], config::V_JOG_DEG, seconds));
    } else if (state_ == State::Run && c.valid) {
      const float pos = ramp::advance(calib::toClosure(angle(i), c), goals_[i], speed_, seconds);
      angles_[i] = calib::toAngle(pos, c);
    }
  }
  if (releasing_ && opened) {
    if (!releaseComplete_) { releaseComplete_ = true; releasedAt_ = now; }
    if (static_cast<uint32_t>(now - releasedAt_) >= config::DETACH_MS) {
      attached_ = {};
      releasing_ = false;
    }
  }
}
Telemetry SafetyController::telemetry(uint32_t now) const {
  Telemetry t;
  t.ms = now;
  t.ma = ma_;
  t.st = state_;
  t.md = mode_;
  for (std::size_t i = 0; i < 3; ++i) {
    t.a[i] = calib::toClosure(angle(i), calibration_[i]);
    t.tg[i] = mode_ == Mode::Jog ? calib::toClosure(goals_[i], calibration_[i]) : goals_[i];
  }
  return t;
}
}  // namespace rehab
