#include "protocol.h"

#include <ArduinoJson.h>

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <new>

#include "calib.h"

namespace rehab::protocol {
namespace {
// ArduinoJson 7 accepts an allocator; this bounded arena replaces its heap.
// Documents die before the next reset. Codec calls must never overlap.
class Arena final : public ArduinoJson::Allocator {
 public:
  void reset() { used_ = 0; }
  void* allocate(std::size_t size) override {
    constexpr auto alignment = alignof(std::max_align_t);
    const auto total = (size + sizeof(Header) + alignment - 1) / alignment * alignment;
    if (total > sizeof(data_) - used_) return nullptr;
    auto* header = new (data_ + used_) Header{size};
    used_ += total;
    return header + 1;
  }
  void deallocate(void*) override {}
  void* reallocate(void* pointer, std::size_t size) override {
    if (!pointer) return allocate(size);
    const auto previous = (static_cast<Header*>(pointer) - 1)->size;
    if (size <= previous) return pointer;
    void* next = allocate(size);
    if (next) std::memcpy(next, pointer, previous);
    return next;
  }

 private:
  struct alignas(std::max_align_t) Header {
    std::size_t size;
  };
  alignas(std::max_align_t) unsigned char data_[8192]{};
  std::size_t used_ = 0;
} arena;

// Reject extensions accepted by ArduinoJson (single quotes, bare keys, trailing
// data, non-JSON numbers). This is a bounded lexer; ArduinoJson decodes the data.
class JsonSyntax {
 public:
  JsonSyntax(const char* data, std::size_t length) : p_(data), end_(data + length) {}
  bool objectLine() {
    space();
    if (p_ == end_ || *p_ != '{' || !value(0)) return false;
    space();
    return p_ == end_;
  }

 private:
  void space() {
    while (p_ < end_ && (*p_ == ' ' || *p_ == '\t' || *p_ == '\r' || *p_ == '\n')) ++p_;
  }
  bool take(char c) {
    space();
    if (p_ == end_ || *p_ != c) return false;
    ++p_;
    return true;
  }
  bool literal(const char* text) {
    const auto n = std::strlen(text);
    if (static_cast<std::size_t>(end_ - p_) < n || std::memcmp(p_, text, n) != 0) return false;
    p_ += n;
    return true;
  }
  bool string() {
    if (!take('"')) return false;
    while (p_ < end_) {
      const auto c = static_cast<unsigned char>(*p_++);
      if (c == '"') return true;
      if (c < 0x20) return false;
      if (c != '\\') continue;
      if (p_ == end_) return false;
      const char escaped = *p_++;
      if (escaped == 'u') {
        for (int i = 0; i < 4; ++i) {
          if (p_ == end_) return false;
          const char h = *p_++;
          if (!((h >= '0' && h <= '9') || (h >= 'a' && h <= 'f') || (h >= 'A' && h <= 'F')))
            return false;
        }
      } else if (!std::strchr("\"\\/bfnrt", escaped))
        return false;
    }
    return false;
  }
  bool digits() {
    const char* first = p_;
    while (p_ < end_ && *p_ >= '0' && *p_ <= '9') ++p_;
    return p_ != first;
  }
  bool number() {
    if (p_ < end_ && *p_ == '-') ++p_;
    if (p_ == end_) return false;
    if (*p_ == '0')
      ++p_;
    else if (*p_ >= '1' && *p_ <= '9')
      digits();
    else
      return false;
    if (p_ < end_ && *p_ == '.') {
      ++p_;
      if (!digits()) return false;
    }
    if (p_ < end_ && (*p_ == 'e' || *p_ == 'E')) {
      ++p_;
      if (p_ < end_ && (*p_ == '+' || *p_ == '-')) ++p_;
      if (!digits()) return false;
    }
    return true;
  }
  bool value(unsigned depth) {
    space();
    if (p_ == end_ || depth > 8) return false;
    if (*p_ == '"') return string();
    if (*p_ == '{' || *p_ == '[') {
      const bool object = *p_++ == '{';
      const char close = object ? '}' : ']';
      if (take(close)) return true;
      do {
        if (object && (!string() || !take(':'))) return false;
        if (!value(depth + 1)) return false;
        if (take(close)) return true;
      } while (take(','));
      return false;
    }
    if (*p_ == 't') return literal("true");
    if (*p_ == 'f') return literal("false");
    if (*p_ == 'n') return literal("null");
    return number();
  }
  const char* p_;
  const char* end_;
};

bool numeric(JsonVariantConst value, float& out) {
  if (!value.is<float>()) return false;
  out = value.as<float>();
  return std::isfinite(out);
}
std::size_t finished(int count, char* out, std::size_t capacity) {
  if (count <= 0 || static_cast<std::size_t>(count) >= capacity ||
      static_cast<std::size_t>(count) > config::MAX_LINE_BYTES + 1) {
    if (capacity) out[0] = '\0';
    return 0;
  }
  return static_cast<std::size_t>(count);
}
bool finiteTriple(const Triple& values) {
  return std::all_of(values.begin(), values.end(), [](float f) { return std::isfinite(f); });
}
}  // namespace

const char* name(CommandType type) {
  switch (type) {
    case CommandType::Target:
      return "target";
    case CommandType::Follow:
      return "follow";
    case CommandType::Release:
      return "release";
    case CommandType::Calib:
      return "calib";
    case CommandType::Limit:
      return "limit";
    case CommandType::Ping:
      return "ping";
    case CommandType::Jog:
      return "jog";
    case CommandType::Hello:
      return "hello";
    default:
      return "unknown";
  }
}
const char* name(ErrorCode error) {
  switch (error) {
    case ErrorCode::BadJson:
      return "bad_json";
    case ErrorCode::UnknownType:
      return "unknown_type";
    case ErrorCode::BadArgs:
      return "bad_args";
    case ErrorCode::NoCalib:
      return "no_calib";
    case ErrorCode::Fault:
      return "fault";
    case ErrorCode::State:
      return "state";
    default:
      return "";
  }
}
const char* name(State state) {
  switch (state) {
    case State::Boot:
      return "boot";
    case State::Run:
      return "run";
    case State::Calib:
      return "calib";
    case State::Fault:
      return "fault";
    default:
      return "idle";
  }
}
const char* name(Mode mode) {
  switch (mode) {
    case Mode::Follow:
      return "follow";
    case Mode::Target:
      return "target";
    case Mode::Jog:
      return "jog";
    default:
      return "none";
  }
}
const char* name(EventKind event) {
  switch (event) {
    case EventKind::Overcurrent:
      return "overcurrent";
    case EventKind::StopButton:
      return "stop_button";
    case EventKind::Watchdog:
      return "watchdog";
    case EventKind::StopReleased:
      return "stop_released";
    case EventKind::InaMissing:
      return "ina_missing";
    case EventKind::CalibOk:
      return "calib_ok";
    default:
      return "boot";
  }
}

bool validCommand(const Command& c) {
  switch (c.type) {
    case CommandType::Target:
      return finiteTriple(c.f) && std::isfinite(c.v) && c.v > 0;
    case CommandType::Follow:
      return finiteTriple(c.f);
    case CommandType::Calib:
      return c.i >= 0 && c.i < 3 && calib::valid(c.min, c.max);
    case CommandType::Jog:
      return c.i >= 0 && c.i < 3 && std::isfinite(c.deg) && c.deg >= config::HARD_MIN &&
             c.deg <= config::HARD_MAX;
    case CommandType::Limit:
      return std::isfinite(c.ma);
    case CommandType::Release:
    case CommandType::Ping:
    case CommandType::Hello:
      return true;
    default:
      return false;
  }
}

ParseResult parse(const char* line, std::size_t length) {
  ParseResult result;
  result.error = ErrorCode::BadJson;
  if (!line || length > config::MAX_LINE_BYTES || !JsonSyntax(line, length).objectLine())
    return result;
  arena.reset();
  JsonDocument doc(&arena);
  if (deserializeJson(doc, line, length, DeserializationOption::NestingLimit(8))) return result;
  if (!doc["t"].is<const char*>()) {
    result.error = ErrorCode::BadArgs;
    return result;
  }
  const auto type = doc["t"].as<JsonString>();
  if (type.size() != std::strlen(type.c_str()) || type.size() >= sizeof(result.type)) {
    result.error = ErrorCode::UnknownType;
    return result;
  }
  std::memcpy(result.type, type.c_str(), type.size() + 1);
  for (auto t : {CommandType::Target, CommandType::Follow, CommandType::Release, CommandType::Calib,
                 CommandType::Limit, CommandType::Ping, CommandType::Jog, CommandType::Hello}) {
    if (std::strcmp(result.type, name(t)) == 0) result.command.type = t;
  }
  auto& c = result.command;
  if (c.type == CommandType::Unknown) {
    result.error = ErrorCode::UnknownType;
    return result;
  }
  result.error = ErrorCode::BadArgs;
  if (c.type == CommandType::Target || c.type == CommandType::Follow) {
    if (!doc["f"].is<JsonArrayConst>() || doc["f"].size() != 3) return result;
    for (std::size_t i = 0; i < 3; ++i)
      if (!numeric(doc["f"][i], c.f[i])) return result;
    if (c.type == CommandType::Target && !numeric(doc["v"], c.v)) return result;
  }
  if (c.type == CommandType::Calib || c.type == CommandType::Jog) {
    float index = 0;
    if (!numeric(doc["i"], index) || index < 0 || index > 2 || std::floor(index) != index)
      return result;
    c.i = static_cast<int>(index);
  }
  if (c.type == CommandType::Calib && (!numeric(doc["min"], c.min) || !numeric(doc["max"], c.max)))
    return result;
  if (c.type == CommandType::Jog && !numeric(doc["deg"], c.deg)) return result;
  if (c.type == CommandType::Limit && !numeric(doc["ma"], c.ma)) return result;
  if (validCommand(c)) result.error = ErrorCode::None;
  return result;
}

std::size_t format(const Telemetry& t, char* out, std::size_t capacity) {
  if (!out || !finiteTriple(t.a) || !finiteTriple(t.tg) || !std::isfinite(t.ma)) return 0;
  return finished(
      std::snprintf(out, capacity,
                    "{\"t\":\"tel\",\"ms\":%lu,\"a\":[%.2f,%.2f,%.2f],\"ma\":%.0f,\"st\":\"%s\","
                    "\"md\":\"%s\",\"tg\":[%.2f,%.2f,%.2f]}\n",
                    static_cast<unsigned long>(t.ms), static_cast<double>(t.a[0]),
                    static_cast<double>(t.a[1]), static_cast<double>(t.a[2]),
                    static_cast<double>(t.ma), name(t.st), name(t.md), static_cast<double>(t.tg[0]),
                    static_cast<double>(t.tg[1]), static_cast<double>(t.tg[2])),
      out, capacity);
}
std::size_t format(const Event& e, char* out, std::size_t capacity) {
  if (!out || !std::isfinite(e.ma)) return 0;
  if (e.kind == EventKind::Overcurrent)
    return finished(std::snprintf(out, capacity, "{\"t\":\"evt\",\"e\":\"%s\",\"ma\":%.0f}\n",
                                  name(e.kind), static_cast<double>(e.ma)),
                    out, capacity);
  return finished(std::snprintf(out, capacity, "{\"t\":\"evt\",\"e\":\"%s\"}\n", name(e.kind)), out,
                  capacity);
}
std::size_t format(const Info& info, char* out, std::size_t capacity) {
  if (!out || !std::isfinite(info.limit)) return 0;
  char ranges[3][40]{};
  for (std::size_t i = 0; i < 3; ++i) {
    const auto& c = info.calib[i];
    if (c.valid && !calib::valid(c.min, c.max)) return 0;
    if (c.valid)
      std::snprintf(ranges[i], sizeof(ranges[i]), "[%.2f,%.2f]", static_cast<double>(c.min),
                    static_cast<double>(c.max));
    else
      std::strcpy(ranges[i], "null");
  }
  return finished(
      std::snprintf(
          out, capacity,
          "{\"t\":\"info\",\"fw\":\"%s\",\"fingers\":3,\"limit\":%.0f,\"calib\":[%s,%s,%s]}\n",
          config::FW_VERSION, static_cast<double>(info.limit), ranges[0], ranges[1], ranges[2]),
      out, capacity);
}
std::size_t formatError(const char* command, ErrorCode error, char* out, std::size_t capacity) {
  if (!out || !command || error == ErrorCode::None) return 0;
  char safe[24]{};
  for (std::size_t i = 0; i < sizeof(safe) - 1 && command[i]; ++i) {
    const char c = command[i];
    safe[i] =
        ((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '_')
            ? c
            : '_';
  }
  return finished(std::snprintf(out, capacity, "{\"t\":\"err\",\"c\":\"%s\",\"why\":\"%s\"}\n",
                                safe, name(error)),
                  out, capacity);
}
}  // namespace rehab::protocol
