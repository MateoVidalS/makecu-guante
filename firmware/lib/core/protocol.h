#pragma once

#include <array>
#include <cstddef>
#include <cstdint>

#include "config.h"

namespace rehab {
using Triple = std::array<float, config::FINGERS>;
enum class State { Boot, Idle, Run, Calib, Fault };
enum class Mode { None, Follow, Target, Jog };
enum class CommandType { Target, Follow, Release, Calib, Limit, Ping, Jog, Hello, Unknown };
enum class ErrorCode { None, BadJson, UnknownType, BadArgs, NoCalib, Fault, State };
enum class EventKind { Boot, Overcurrent, StopButton, Watchdog, StopReleased, InaMissing, CalibOk };

struct Calibration {
  float min = 0;
  float max = 0;
  bool valid = false;
};
struct Command {
  CommandType type = CommandType::Unknown;
  Triple f{};
  float v = 0;
  int i = -1;
  float min = 0;
  float max = 0;
  float deg = 0;
  float ma = 0;
};
struct Event {
  EventKind kind = EventKind::Boot;
  float ma = 0;
};
struct Telemetry {
  uint32_t ms = 0;
  Triple a{};
  float ma = 0;
  State st = State::Idle;
  Mode md = Mode::None;
  Triple tg{};
};
struct Info {
  float limit = config::LIMIT_DEFAULT_MA;
  std::array<Calibration, config::FINGERS> calib{};
};

namespace protocol {
struct ParseResult {
  Command command{};
  ErrorCode error = ErrorCode::None;
  char type[24]{};
  explicit operator bool() const { return error == ErrorCode::None; }
};

// Single-threaded codec. ArduinoJson storage is a fixed static arena, never the heap.
ParseResult parse(const char* line, std::size_t length);
bool validCommand(const Command& command);
const char* name(CommandType type);
const char* name(ErrorCode error);
const char* name(State state);
const char* name(Mode mode);
const char* name(EventKind event);
// Return bytes including '\n', excluding NUL; return 0 on invalid/insufficient output.
std::size_t format(const Telemetry& value, char* out, std::size_t capacity);
std::size_t format(const Event& value, char* out, std::size_t capacity);
std::size_t format(const Info& value, char* out, std::size_t capacity);
std::size_t formatError(const char* command, ErrorCode error, char* out, std::size_t capacity);
}  // namespace protocol
}  // namespace rehab
