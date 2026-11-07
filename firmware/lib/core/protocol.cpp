#include "protocol.h"

#include <ArduinoJson.h>

#include <algorithm>
#include <cmath>
#include <cstring>
#include <new>

#include "boot_event.h"
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
// Avoid libc float printf/dtoa: some embedded libc implementations allocate.
class Writer {
 public:
  Writer(char* out, std::size_t capacity) : out_(out), capacity_(capacity) {}
  void byte(char value) {
    if (out_ && used_ + 1 < capacity_) out_[used_] = value;
    ++used_;
  }
  void text(const char* value) {
    while (*value) byte(*value++);
  }
  void integer(uint32_t value) {
    char digits[10];
    unsigned count = 0;
    do {
      digits[count++] = static_cast<char>('0' + value % 10);
      value /= 10;
    } while (value);
    while (count) byte(digits[--count]);
  }
  void number(float value, bool decimals = true) {
    const double scale = decimals ? 100.0 : 1.0;
    const double magnitude = std::fabs(static_cast<double>(value)) * scale;
    if (!std::isfinite(value) || magnitude > 4294967294.0) {
      valid_ = false;
      return;
    }
    const auto rounded = static_cast<uint32_t>(magnitude + 0.5);
    if (value < 0 && rounded) byte('-');
    if (!decimals) {
      integer(rounded);
      return;
    }
    integer(rounded / 100);
    byte('.');
    byte(static_cast<char>('0' + (rounded / 10) % 10));
    byte(static_cast<char>('0' + rounded % 10));
  }
  void quint(const Quint& values) {
    byte('[');
    for (std::size_t i = 0; i < config::FINGERS; ++i) {
      if (i) byte(',');
      number(values[i]);
    }
    byte(']');
  }
  std::size_t finish() {
    text("}\n");
    if (!out_ || !capacity_) return 0;
    if (!valid_ || used_ >= capacity_ || used_ > config::MAX_LINE_BYTES + 1) {
      out_[0] = '\0';
      return 0;
    }
    out_[used_] = '\0';
    return used_;
  }

 private:
  char* out_;
  std::size_t capacity_;
  std::size_t used_ = 0;
  bool valid_ = true;
};
bool finiteQuint(const Quint& values) {
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
      return finiteQuint(c.f) && std::isfinite(c.v) && c.v > 0;
    case CommandType::Follow:
      return finiteQuint(c.f);
    case CommandType::Calib:
      return c.i >= 0 && c.i < static_cast<int>(config::FINGERS) && calib::valid(c.min, c.max);
    case CommandType::Jog:
      return c.i >= 0 && c.i < static_cast<int>(config::FINGERS) && std::isfinite(c.deg) &&
             c.deg >= config::HARD_MIN && c.deg <= config::HARD_MAX;
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
    if (!doc["f"].is<JsonArrayConst>() || doc["f"].size() != config::FINGERS) return result;
    for (std::size_t i = 0; i < config::FINGERS; ++i)
      if (!numeric(doc["f"][i], c.f[i])) return result;
    if (c.type == CommandType::Target && !numeric(doc["v"], c.v)) return result;
  }
  if (c.type == CommandType::Calib || c.type == CommandType::Jog) {
    if (!doc["i"].is<double>()) return result;
    const double index = doc["i"].as<double>();
    if (!std::isfinite(index) || index < 0 || index >= config::FINGERS ||
        std::floor(index) != index)
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
  Writer writer(out, capacity);
  writer.text("{\"t\":\"tel\",\"ms\":");
  writer.integer(t.ms);
  writer.text(",\"a\":");
  writer.quint(t.a);
  writer.text(",\"ma\":");
  writer.number(t.ma, false);
  writer.text(",\"st\":\"");
  writer.text(name(t.st));
  writer.text("\",\"md\":\"");
  writer.text(name(t.md));
  writer.text("\",\"tg\":");
  writer.quint(t.tg);
  return writer.finish();
}
std::size_t format(const Event& e, char* out, std::size_t capacity) {
  Writer writer(out, capacity);
  writer.text("{\"t\":\"evt\",\"e\":\"");
  writer.text(name(e.kind));
  writer.byte('"');
  if (e.kind == EventKind::Overcurrent) {
    writer.text(",\"ma\":");
    writer.number(e.ma, false);
  }
  return writer.finish();
}
std::size_t formatBoot(uint32_t resetReason, char* out, std::size_t capacity) {
  Writer writer(out, capacity);
  writer.text("{\"t\":\"evt\",\"e\":\"boot\",\"reset_reason\":");
  writer.integer(resetReason);
  return writer.finish();
}
std::size_t format(const Info& info, char* out, std::size_t capacity) {
  Writer writer(out, capacity);
  writer.text("{\"t\":\"info\",\"fw\":\"");
  writer.text(config::FW_VERSION);
  writer.text("\",\"fingers\":");
  writer.integer(config::FINGERS);
  writer.text(",\"limit\":");
  writer.number(info.limit, false);
  writer.text(",\"calib\":[");
  for (std::size_t i = 0; i < config::FINGERS; ++i) {
    if (i) writer.byte(',');
    const auto& c = info.calib[i];
    if (!c.valid) {
      writer.text("null");
      continue;
    }
    if (!calib::valid(c.min, c.max)) {
      if (out && capacity) out[0] = '\0';
      return 0;
    }
    writer.byte('[');
    writer.number(c.min);
    writer.byte(',');
    writer.number(c.max);
    writer.byte(']');
  }
  writer.byte(']');
  return writer.finish();
}
std::size_t formatError(const char* command, ErrorCode error, char* out, std::size_t capacity) {
  if (!command || error == ErrorCode::None) return 0;
  Writer writer(out, capacity);
  writer.text("{\"t\":\"err\",\"c\":\"");
  for (std::size_t i = 0; i < 23 && command[i]; ++i) {
    const char c = command[i];
    writer.byte(
        ((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '_')
            ? c
            : '_');
  }
  writer.text("\",\"why\":\"");
  writer.text(name(error));
  writer.byte('"');
  return writer.finish();
}
}  // namespace rehab::protocol
