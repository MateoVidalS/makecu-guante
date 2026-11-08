#include <ArduinoJson.h>
#include <unity.h>

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <fstream>
#include <limits>
#include <string>

#include "boot_event.h"
#include "calib.h"
#include "current_filter.h"
#include "pwm_plan.h"
#include "ramp.h"
#include "ring_frame.h"
#include "safety.h"
#include "serial_buffer.h"
#include "stop_debounce.h"

using namespace rehab;

void setUp() {}
void tearDown() {}

namespace {
Command command(const char* text) {
  const auto result = protocol::parse(text, std::strlen(text));
  TEST_ASSERT_EQUAL_INT(static_cast<int>(ErrorCode::None), static_cast<int>(result.error));
  return result.command;
}
struct Harness {
  Event events[128]{};
  std::size_t count = 0;
  uint32_t now = 0;
  SafetyController safety{record, this};
  static void record(void* context, const Event& event) {
    auto& h = *static_cast<Harness*>(context);
    TEST_ASSERT_LESS_THAN(128, h.count);
    h.events[h.count++] = event;
  }
  explicit Harness(bool sensor = true, uint32_t start = 0) : now(start) {
    safety.begin(sensor, now);
  }
  void calibrate(bool alternateMirrors = false) {
    for (std::size_t i = 0; i < config::FINGERS; ++i) {
      Command c;
      c.type = CommandType::Calib;
      c.i = i;
      c.min = alternateMirrors && i % 2 ? 150 : 20;
      c.max = alternateMirrors && i % 2 ? 20 : 150;
      TEST_ASSERT_EQUAL_INT(0, static_cast<int>(safety.handle(c, now)));
    }
  }
  ErrorCode send(const char* text) { return safety.handle(command(text), now); }
  void advance(uint32_t duration, float ma = 0, bool keepalive = true) {
    for (uint32_t i = 0; i < duration; i += 5) {
      now += 5;
      if (keepalive && i % 300 == 0) send("{\"t\":\"ping\"}");
      safety.current(ma, now);
      safety.tick(now);
    }
  }
  bool saw(EventKind kind) const {
    for (std::size_t i = 0; i < count; ++i)
      if (events[i].kind == kind) return true;
    return false;
  }
};
void errorIs(const char* json, ErrorCode error) {
  const auto decoded = protocol::parse(json, std::strlen(json));
  TEST_ASSERT_EQUAL_STRING(protocol::name(error), protocol::name(decoded.error));
}

void parses_every_command_and_ignores_unknown_fields() {
  const char* vectors[] = {
      "{\"t\":\"target\",\"f\":[0.8,0.6,0,0.3,0.2],\"v\":0.5,\"extra\":{\"x\":[1,true,null]}}",
      "{\"t\":\"follow\",\"f\":[0.3,0.4,0.1,0.3,0.2]}",
      "{\"t\":\"release\"}",
      "{\"t\":\"calib\",\"i\":1,\"min\":150,\"max\":20}",
      "{\"t\":\"limit\",\"ma\":900}",
      "{\"t\":\"ping\"}",
      "{\"t\":\"jog\",\"i\":1,\"deg\":95}",
      "{\"t\":\"hello\"}"};
  const CommandType types[] = {CommandType::Target, CommandType::Follow, CommandType::Release,
                               CommandType::Calib,  CommandType::Limit,  CommandType::Ping,
                               CommandType::Jog,    CommandType::Hello};
  for (std::size_t i = 0; i < 8; ++i)
    TEST_ASSERT_EQUAL_INT(static_cast<int>(types[i]), static_cast<int>(command(vectors[i]).type));
}
void rejects_invalid_json_and_extensions() {
  for (const char* json : {"", "{", "[]", "null", "{'t':'ping'}", "{t:\"ping\"}",
                           "{\"t\":\"ping\"}junk", "{\"t\":\"ping\"}{}", "{\"t\":\"ping\",}",
                           "{\"t\":\"limit\",\"ma\":NaN}", "{\"t\":\"limit\",\"ma\":01}",
                           "{\"t\":\"limit\",\"ma\":.1}", "{\"t\":\"ping\",\"x\":\"\\q\"}"})
    errorIs(json, ErrorCode::BadJson);
  errorIs("{\"t\":\"unknown\"}", ErrorCode::UnknownType);
  errorIs("{\"t\":false}", ErrorCode::BadArgs);
  errorIs("{\"t\":\"ping\\u0000x\"}", ErrorCode::UnknownType);
}
void rejects_bad_args_and_non_finite_values() {
  for (const char* json :
       {"{\"t\":\"target\",\"f\":[0,1],\"v\":1}",
        "{\"t\":\"target\",\"f\":[0,true,1,0.3,0.2],\"v\":1}",
        "{\"t\":\"target\",\"f\":[0,1,1,0.3,0.2],\"v\":0}",
        "{\"t\":\"target\",\"f\":[0,1,1,0.3,0.2],\"v\":-1}",
        "{\"t\":\"follow\",\"f\":[0,1e999,1,0.3,0.2]}",
        "{\"t\":\"calib\",\"i\":5,\"min\":20,\"max\":150}",
        "{\"t\":\"calib\",\"i\":1.5,\"min\":20,\"max\":150}",
        "{\"t\":\"calib\",\"i\":1,\"min\":4,\"max\":150}",
        "{\"t\":\"calib\",\"i\":1,\"min\":20,\"max\":176}",
        "{\"t\":\"calib\",\"i\":1,\"min\":20,\"max\":39}", "{\"t\":\"jog\",\"i\":1,\"deg\":180}",
        "{\"t\":\"jog\",\"i\":-1,\"deg\":90}", "{\"t\":\"limit\",\"ma\":\"900\"}"})
    errorIs(json, ErrorCode::BadArgs);
}
void codec_storage_survives_repeated_maximum_lines() {
  char line[201];
  std::memset(line, ' ', 200);
  const char* payload =
      "{\"t\":\"ping\",\"x\":[1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20]}";
  std::memcpy(line, payload, std::strlen(payload));
  for (int i = 0; i < 2000; ++i) TEST_ASSERT_TRUE(static_cast<bool>(protocol::parse(line, 200)));
  TEST_ASSERT_EQUAL_INT(static_cast<int>(ErrorCode::BadJson),
                        static_cast<int>(protocol::parse(line, 201).error));
}
void telemetry_is_bounded_and_rounds_to_two_decimals() {
  Telemetry t{UINT32_MAX,   {{0.1234F, 0.9999F, 0.555F, 0.346F, 0.875F}},
              32767,        State::Fault,
              Mode::Target, {{1, 0.5F, 0, 0.95F, 0.25F}}};
  char line[202];
  const auto size = protocol::format(t, line, sizeof(line));
  TEST_ASSERT_GREATER_THAN(0, size);
  TEST_ASSERT_LESS_THAN(200, size);
  TEST_ASSERT_EQUAL_CHAR('\n', line[size - 1]);
  JsonDocument doc;
  TEST_ASSERT_FALSE(deserializeJson(doc, line));
  TEST_ASSERT_FLOAT_WITHIN(0.0001F, 0.12F, doc["a"][0].as<float>());
  TEST_ASSERT_FLOAT_WITHIN(0.0001F, 1, doc["a"][1].as<float>());
  TEST_ASSERT_FLOAT_WITHIN(0.0001F, 0.56F, doc["a"][2].as<float>());
  TEST_ASSERT_EQUAL_UINT(config::FINGERS, doc["a"].size());
  TEST_ASSERT_EQUAL_UINT(config::FINGERS, doc["tg"].size());
  TEST_ASSERT_FLOAT_WITHIN(0.0001F, 0.35F, doc["a"][3].as<float>());
  TEST_ASSERT_FLOAT_WITHIN(0.0001F, 0.88F, doc["a"][4].as<float>());
  TEST_ASSERT_EQUAL_UINT32(UINT32_MAX, doc["ms"].as<uint32_t>());
  TEST_ASSERT_EQUAL_INT(0, protocol::format(t, line, 20));
  t.ma = std::numeric_limits<float>::quiet_NaN();
  TEST_ASSERT_EQUAL_INT(0, protocol::format(t, line, sizeof(line)));
}
void boot_reset_reason_is_bounded_and_distinguishes_brownout() {
  // esp_reset_reason_t values in the pinned Arduino-ESP32 SDK: power-on=1,
  // software reset=3, brown-out=9. Keep future numeric reasons representable.
  for (const auto reason : {1U, 3U, 9U, UINT32_MAX}) {
    char line[202];
    const auto size = protocol::formatBoot(reason, line, sizeof(line));
    TEST_ASSERT_GREATER_THAN(0, size);
    TEST_ASSERT_LESS_THAN(200, size);
    TEST_ASSERT_EQUAL_CHAR('\n', line[size - 1]);
    JsonDocument doc;
    TEST_ASSERT_FALSE(deserializeJson(doc, line));
    TEST_ASSERT_EQUAL_STRING("evt", doc["t"].as<const char*>());
    TEST_ASSERT_EQUAL_STRING("boot", doc["e"].as<const char*>());
    TEST_ASSERT_EQUAL_UINT32(reason, doc["reset_reason"].as<uint32_t>());
    TxQueue queue;
    TEST_ASSERT_TRUE(queue.enqueue(line, size));
    TEST_ASSERT_EQUAL_MEMORY(line, queue.data(), size);
    // Check every short capacity, including the missing-NUL boundary.
    for (std::size_t capacity = 0; capacity <= size + 1; ++capacity) {
      char bytes[204];
      std::memset(bytes, 'Z', sizeof(bytes));
      const auto written = protocol::formatBoot(reason, bytes + 1, capacity);
      TEST_ASSERT_EQUAL_UINT(capacity > size ? size : 0, written);
      TEST_ASSERT_EQUAL_CHAR('Z', bytes[0]);
      TEST_ASSERT_EQUAL_CHAR('Z', bytes[capacity + 1]);
    }
  }
  TEST_ASSERT_EQUAL_UINT(0, protocol::formatBoot(9, nullptr, 202));
}
void info_reports_five_channels_and_no_calibration_after_reboot() {
  Harness h;
  h.calibrate();
  h.send("{\"t\":\"target\",\"f\":[1,1,1,1,1],\"v\":1}");
  h.advance(300);
  h.safety.begin(true, h.now);
  char line[202];
  TEST_ASSERT_GREATER_THAN(0, protocol::format(h.safety.info(), line, sizeof(line)));
  JsonDocument info;
  TEST_ASSERT_FALSE(deserializeJson(info, line));
  TEST_ASSERT_EQUAL_UINT(5, info["fingers"].as<unsigned>());
  TEST_ASSERT_EQUAL_UINT(5, info["calib"].size());
  TEST_ASSERT_EQUAL_FLOAT(config::LIMIT_DEFAULT_MA, info["limit"].as<float>());
  for (std::size_t i = 0; i < config::FINGERS; ++i) {
    TEST_ASSERT_TRUE(info["calib"][i].isNull());
    TEST_ASSERT_FALSE(h.safety.attached(i));
  }
}
void boot_detaches_and_never_reuses_calibration() {
  Harness h;
  TEST_ASSERT_EQUAL_INT(static_cast<int>(State::Idle), static_cast<int>(h.safety.state()));
  TEST_ASSERT_TRUE(h.saw(EventKind::Boot));
  for (std::size_t i = 0; i < config::FINGERS; ++i) TEST_ASSERT_FALSE(h.safety.attached(i));
  h.calibrate();
  TEST_ASSERT_TRUE(h.safety.calibrated());
  h.safety.begin(true, 50);
  TEST_ASSERT_FALSE(h.safety.calibrated());
}
void moves_need_all_five_calibrations() {
  Harness h;
  TEST_ASSERT_EQUAL_INT(
      static_cast<int>(ErrorCode::NoCalib),
      static_cast<int>(h.send("{\"t\":\"target\",\"f\":[1,1,1,0.3,0.2],\"v\":1}")));
  TEST_ASSERT_EQUAL_INT(static_cast<int>(ErrorCode::NoCalib),
                        static_cast<int>(h.send("{\"t\":\"follow\",\"f\":[1,1,1,0.3,0.2]}")));
  h.calibrate();
  TEST_ASSERT_TRUE(h.saw(EventKind::CalibOk));
  h.send("{\"t\":\"calib\",\"i\":0,\"min\":30,\"max\":160}");
  TEST_ASSERT_FALSE(h.safety.calibrated());
  TEST_ASSERT_FALSE(h.safety.info().calib[1].valid);
}
void ring_and_pinky_require_calibration_move_and_release_with_the_other_fingers() {
  Harness h;
  for (int i = 0; i < 4; ++i) {
    Command c;
    c.type = CommandType::Calib;
    c.i = i;
    c.min = 20;
    c.max = 150;
    TEST_ASSERT_EQUAL_INT(0, static_cast<int>(h.safety.handle(c, 0)));
    TEST_ASSERT_FALSE(h.safety.calibrated());
  }
  TEST_ASSERT_EQUAL_INT(
      static_cast<int>(ErrorCode::NoCalib),
      static_cast<int>(h.send("{\"t\":\"target\",\"f\":[0,0,0,0.8,0.6],\"v\":1}")));
  h.send("{\"t\":\"calib\",\"i\":4,\"min\":150,\"max\":20}");
  TEST_ASSERT_TRUE(h.safety.calibrated());
  h.send("{\"t\":\"target\",\"f\":[0,0,0,0.8,0.6],\"v\":1}");
  h.advance(800);
  const auto t = h.safety.telemetry(h.now);
  TEST_ASSERT_FLOAT_WITHIN(0.001F, 0.8F, t.a[3]);
  TEST_ASSERT_FLOAT_WITHIN(0.001F, 0.6F, t.a[4]);
  TEST_ASSERT_FLOAT_WITHIN(0.01F, 72, h.safety.angle(4));
  h.safety.stopPressed(h.now);
  h.advance(1000);
  for (std::size_t i = 0; i < config::FINGERS; ++i) {
    TEST_ASSERT_FALSE(h.safety.attached(i));
    TEST_ASSERT_FLOAT_WITHIN(0.001F, 0, h.safety.telemetry(h.now).a[i]);
  }
}
void target_speed_cap_and_position_clamps() {
  Harness h;
  h.calibrate();
  h.send("{\"t\":\"target\",\"f\":[5,-2,0.5,0.3,0.2],\"v\":5}");
  h.advance(500);
  auto t = h.safety.telemetry(h.now);
  TEST_ASSERT_FLOAT_WITHIN(0.0001F, 0.5F, t.a[0]);
  TEST_ASSERT_FLOAT_WITHIN(0.0001F, 0, t.a[1]);
  TEST_ASSERT_FLOAT_WITHIN(0.0001F, 0.5F, t.a[2]);
  h.advance(1000);
  t = h.safety.telemetry(h.now);
  TEST_ASSERT_FLOAT_WITHIN(0.0001F, 1, t.a[0]);
  TEST_ASSERT_FLOAT_WITHIN(0.0001F, 150, h.safety.angle(0));
}
void requested_slow_speed_and_no_catchup_jump() {
  Harness h;
  h.calibrate();
  h.send("{\"t\":\"target\",\"f\":[1,1,1,0.3,0.2],\"v\":0.2}");
  h.advance(500);
  TEST_ASSERT_FLOAT_WITHIN(0.0001F, 0.1F, h.safety.telemetry(h.now).a[0]);
  h.safety.tick(h.now + 100);
  TEST_ASSERT_FLOAT_WITHIN(0.0001F, 0.101F, h.safety.telemetry(h.now).a[0]);
  auto c = command("{\"t\":\"target\",\"f\":[1,1,1,0.3,0.2],\"v\":1}");
  c.v = -1;
  TEST_ASSERT_EQUAL_INT(static_cast<int>(ErrorCode::BadArgs),
                        static_cast<int>(h.safety.handle(c, h.now)));
}
void follow_unwinds_at_release_rate_and_winds_at_follow_rate() {
  Harness h;
  h.calibrate(true);
  h.send("{\"t\":\"target\",\"f\":[0.9,0.9,0.9,0.9,0.9],\"v\":1}");
  h.advance(900);
  h.send("{\"t\":\"follow\",\"f\":[0.28,0.28,0.28,0.28,0.28]}");
  for (std::size_t i = 0; i < config::FINGERS; ++i) {
    TEST_ASSERT_FLOAT_WITHIN(0.0001F, 0.2F, h.safety.goal(i));
    TEST_ASSERT_FLOAT_WITHIN(0.0002F, 0.9F, h.safety.telemetry(h.now).a[i]);
  }
  h.advance(100);
  for (float pull : h.safety.telemetry(h.now).a)
    TEST_ASSERT_FLOAT_WITHIN(0.0002F, 0.6F, pull);  // 3.0/s unwinding
  h.advance(135);
  for (float pull : h.safety.telemetry(h.now).a)
    TEST_ASSERT_FLOAT_WITHIN(0.0002F, 0.2F, pull);  // Clamp at the goal.

  h.send("{\"t\":\"follow\",\"f\":[0.98,0.98,0.98,0.98,0.98]}");
  h.advance(100);
  for (float pull : h.safety.telemetry(h.now).a)
    TEST_ASSERT_FLOAT_WITHIN(0.0002F, 0.35F, pull);  // 1.5/s winding
  h.advance(370);
  for (float pull : h.safety.telemetry(h.now).a) TEST_ASSERT_FLOAT_WITHIN(0.0002F, 0.9F, pull);
}
void target_unwinds_at_release_rate_and_caps_only_winding() {
  for (float speed : {0.2F, 5.0F}) {
    Harness h;
    h.calibrate(true);
    h.send("{\"t\":\"target\",\"f\":[0.9,0.2,0.9,0.2,0.9],\"v\":1}");
    h.advance(900);
    Command c;
    c.type = CommandType::Target;
    c.f = {0.2F, 0.9F, 0.2F, 0.9F, 0.2F};
    c.v = speed;
    TEST_ASSERT_EQUAL_INT(0, static_cast<int>(h.safety.handle(c, h.now)));
    h.advance(100);
    for (std::size_t i = 0; i < config::FINGERS; ++i) {
      const float expected = i % 2 ? (speed == 0.2F ? 0.22F : 0.3F) : 0.6F;
      TEST_ASSERT_FLOAT_WITHIN(0.0002F, expected, h.safety.telemetry(h.now).a[i]);
    }
    h.advance(135);
    for (std::size_t i = 0; i < config::FINGERS; ++i) {
      const float expected = i % 2 ? (speed == 0.2F ? 0.247F : 0.435F) : 0.2F;
      TEST_ASSERT_FLOAT_WITHIN(0.0002F, expected, h.safety.telemetry(h.now).a[i]);
    }
    h.advance(3500);
    for (std::size_t i = 0; i < config::FINGERS; ++i)
      TEST_ASSERT_FLOAT_WITHIN(0.0002F, c.f[i], h.safety.telemetry(h.now).a[i]);
  }
}
void fast_fist_follow_pays_out_to_each_goal_without_overshoot() {
  Harness h;
  h.calibrate(true);
  h.send("{\"t\":\"target\",\"f\":[0.9,0.9,0.9,0.9,0.9],\"v\":1}");
  h.advance(900);
  Command c;
  c.type = CommandType::Follow;
  // A 300 ms fist drops the pull goal every camera frame (20 ms).
  for (int frame = 1; frame <= 15; ++frame) {
    c.f.fill(frame == 15 ? 0 : 0.98F - 0.06F * frame);
    TEST_ASSERT_EQUAL_INT(0, static_cast<int>(h.safety.handle(c, h.now)));
    const float goal = frame == 15 ? 0 : 0.9F - 0.06F * frame;
    for (int tick = 0; tick < 4; ++tick) {
      const auto before = h.safety.telemetry(h.now).a;
      h.advance(5);
      for (std::size_t i = 0; i < config::FINGERS; ++i) {
        const float expected = std::max(goal, before[i] - 0.015F);
        TEST_ASSERT_FLOAT_WITHIN(0.0002F, expected, h.safety.telemetry(h.now).a[i]);
      }
    }
    for (float pull : h.safety.telemetry(h.now).a) {
      TEST_ASSERT_FLOAT_WITHIN(0.0002F, goal, pull);
      TEST_ASSERT_TRUE(pull <= goal + 0.0002F);
    }
  }
}
void run_unwinding_never_catches_up_after_a_missed_tick() {
  for (const char* next : {"{\"t\":\"follow\",\"f\":[0.28,0.28,0.28,0.28,0.28]}",
                           "{\"t\":\"target\",\"f\":[0.2,0.2,0.2,0.2,0.2],\"v\":0.2}"}) {
    Harness h;
    h.calibrate(true);
    h.send("{\"t\":\"target\",\"f\":[0.9,0.9,0.9,0.9,0.9],\"v\":1}");
    h.advance(900);
    TEST_ASSERT_EQUAL_INT(0, static_cast<int>(h.send(next)));
    h.now += 100;
    h.safety.tick(h.now);
    for (float pull : h.safety.telemetry(h.now).a)
      TEST_ASSERT_FLOAT_WITHIN(0.0002F, 0.885F, pull);  // One 5 ms step, not 100 ms.
  }
}
void follow_target_follow_and_target_release_transitions_never_jump() {
  Harness h;
  h.calibrate(true);
  h.send("{\"t\":\"follow\",\"f\":[0.68,0.68,0.68,0.68,0.68]}");
  for (float pull : h.safety.telemetry(h.now).a) TEST_ASSERT_EQUAL_FLOAT(0, pull);
  h.advance(200);
  const char* transitions[] = {"{\"t\":\"target\",\"f\":[0.1,0.9,0.1,0.9,0.1],\"v\":0.2}",
                               "{\"t\":\"follow\",\"f\":[0.28,0.98,0.28,0.98,0.28]}",
                               "{\"t\":\"target\",\"f\":[0.1,0.9,0.1,0.9,0.1],\"v\":0.2}",
                               "{\"t\":\"release\"}"};
  const float unwinding[] = {0.285F, 0.27F, 0.255F, 0.24F};
  const float winding[] = {0.301F, 0.3085F, 0.3095F, 0.2945F};
  for (std::size_t step = 0; step < 4; ++step) {
    const auto before = h.safety.telemetry(h.now).a;
    TEST_ASSERT_EQUAL_INT(0, static_cast<int>(h.send(transitions[step])));
    for (std::size_t i = 0; i < config::FINGERS; ++i)
      TEST_ASSERT_EQUAL_FLOAT(before[i], h.safety.telemetry(h.now).a[i]);
    h.advance(5);
    for (std::size_t i = 0; i < config::FINGERS; ++i)
      TEST_ASSERT_FLOAT_WITHIN(0.0002F, i % 2 ? winding[step] : unwinding[step],
                               h.safety.telemetry(h.now).a[i]);
  }
}
void overcurrent_trips_at_100_ms_with_peak() {
  Harness h;
  h.calibrate();
  h.send("{\"t\":\"target\",\"f\":[1,1,1,0.3,0.2],\"v\":1}");
  h.safety.current(1550, 5);
  h.safety.current(1700, 55);
  h.safety.current(1560, 104);
  TEST_ASSERT_EQUAL_INT(static_cast<int>(State::Run), static_cast<int>(h.safety.state()));
  h.safety.current(1560, 105);
  TEST_ASSERT_EQUAL_INT(static_cast<int>(State::Fault), static_cast<int>(h.safety.state()));
  TEST_ASSERT_EQUAL_INT(static_cast<int>(EventKind::Overcurrent),
                        static_cast<int>(h.events[h.count - 1].kind));
  TEST_ASSERT_FLOAT_WITHIN(0.01F, 1700, h.events[h.count - 1].ma);
}
void overcurrent_101_ms_and_spikes_reset_timer() {
  Harness h;
  h.calibrate();
  h.send("{\"t\":\"target\",\"f\":[1,1,1,0.3,0.2],\"v\":1}");
  h.safety.current(1600, 0);
  h.safety.current(1600, 99);
  h.safety.current(1500, 100);
  h.safety.current(1600, 200);
  h.safety.current(1600, 299);
  TEST_ASSERT_FALSE(h.saw(EventKind::Overcurrent));
  h.safety.current(1600, 301);
  TEST_ASSERT_TRUE(h.saw(EventKind::Overcurrent));
}
void watchdog_boundary_idle_and_valid_message_refresh() {
  Harness h;
  h.calibrate();
  h.safety.tick(2000);
  TEST_ASSERT_FALSE(h.saw(EventKind::Watchdog));
  h.now = 2000;
  h.send("{\"t\":\"target\",\"f\":[1,1,1,0.3,0.2],\"v\":1}");
  h.safety.tick(2999);
  TEST_ASSERT_EQUAL_INT(static_cast<int>(State::Run), static_cast<int>(h.safety.state()));
  h.safety.tick(3000);
  TEST_ASSERT_EQUAL_INT(static_cast<int>(State::Run), static_cast<int>(h.safety.state()));
  h.safety.tick(3005);
  TEST_ASSERT_EQUAL_INT(static_cast<int>(State::Fault), static_cast<int>(h.safety.state()));
  TEST_ASSERT_TRUE(h.saw(EventKind::Watchdog));
  Harness j;
  j.send("{\"t\":\"jog\",\"i\":1,\"deg\":95}");
  j.safety.tick(900);
  j.now = 900;
  j.send("{\"t\":\"hello\"}");
  j.safety.tick(1800);
  TEST_ASSERT_EQUAL_INT(static_cast<int>(State::Calib), static_cast<int>(j.safety.state()));
  j.safety.tick(1900);
  TEST_ASSERT_FALSE(j.saw(EventKind::Watchdog));
  j.safety.tick(1905);
  TEST_ASSERT_TRUE(j.saw(EventKind::Watchdog));
}
void invalid_messages_do_not_feed_watchdog() {
  Harness h;
  h.calibrate();
  h.send("{\"t\":\"target\",\"f\":[1,1,1,0.3,0.2],\"v\":1}");
  Command bad;
  bad.type = CommandType::Target;
  bad.v = 0;
  TEST_ASSERT_EQUAL_INT(static_cast<int>(ErrorCode::BadArgs),
                        static_cast<int>(h.safety.handle(bad, 999)));
  h.safety.tick(1000);
  TEST_ASSERT_FALSE(h.saw(EventKind::Watchdog));
  h.safety.tick(1005);
  TEST_ASSERT_TRUE(h.saw(EventKind::Watchdog));
}
void stop_latches_rejects_moves_and_needs_explicit_release() {
  Harness h;
  h.calibrate();
  h.send("{\"t\":\"target\",\"f\":[1,1,1,0.3,0.2],\"v\":1}");
  h.advance(500);
  h.safety.stopPressed(h.now);
  TEST_ASSERT_TRUE(h.saw(EventKind::StopButton));
  TEST_ASSERT_EQUAL_INT(static_cast<int>(ErrorCode::Fault),
                        static_cast<int>(h.send("{\"t\":\"release\"}")));
  h.safety.stopReleased();
  TEST_ASSERT_TRUE(h.saw(EventKind::StopReleased));
  for (const auto* json :
       {"{\"t\":\"target\",\"f\":[1,1,1,0.3,0.2],\"v\":1}",
        "{\"t\":\"follow\",\"f\":[1,1,1,0.3,0.2]}", "{\"t\":\"jog\",\"i\":1,\"deg\":90}"})
    TEST_ASSERT_EQUAL_INT(static_cast<int>(ErrorCode::Fault), static_cast<int>(h.send(json)));
  h.advance(1000);
  TEST_ASSERT_FALSE(h.safety.attached(0));
  TEST_ASSERT_EQUAL_INT(0, static_cast<int>(h.send("{\"t\":\"release\"}")));
  TEST_ASSERT_EQUAL_INT(static_cast<int>(State::Idle), static_cast<int>(h.safety.state()));
  TEST_ASSERT_EQUAL_INT(
      0, static_cast<int>(h.send("{\"t\":\"target\",\"f\":[0.1,0,0,0.3,0.2],\"v\":1}")));
  TEST_ASSERT_TRUE(h.safety.attached(0));
}
void stop_works_from_idle_calibration_and_fault() {
  Harness idle;
  idle.safety.stopPressed(0);
  TEST_ASSERT_EQUAL_INT(static_cast<int>(State::Fault), static_cast<int>(idle.safety.state()));
  Harness jog;
  jog.send("{\"t\":\"jog\",\"i\":1,\"deg\":95}");
  jog.safety.stopPressed(10);
  TEST_ASSERT_FALSE(jog.safety.attached(1));
  const auto count = jog.count;
  jog.safety.stopPressed(15);
  TEST_ASSERT_EQUAL_UINT(count, jog.count);
}
void release_ramps_then_waits_500_ms_before_detach() {
  Harness h;
  h.calibrate();
  h.send("{\"t\":\"target\",\"f\":[0.6,0.6,0.6,0.3,0.2],\"v\":1}");
  h.advance(600);
  h.send("{\"t\":\"release\"}");
  h.advance(100);
  TEST_ASSERT_FLOAT_WITHIN(0.0002F, 0.3F, h.safety.telemetry(h.now).a[0]);
  h.advance(100);
  TEST_ASSERT_FLOAT_WITHIN(0.0002F, 0, h.safety.telemetry(h.now).a[0]);
  TEST_ASSERT_TRUE(h.safety.attached(0));
  h.advance(495);
  TEST_ASSERT_TRUE(h.safety.attached(0));
  h.advance(10);
  TEST_ASSERT_FALSE(h.safety.attached(0));
}
void follow_replaces_target_and_keeps_slack() {
  Harness h;
  h.calibrate();
  h.send("{\"t\":\"target\",\"f\":[1,1,1,0.3,0.2],\"v\":1}");
  h.advance(100);
  h.send("{\"t\":\"follow\",\"f\":[0.3,0.02,1.2,0.3,0.2]}");
  TEST_ASSERT_EQUAL_INT(static_cast<int>(Mode::Follow), static_cast<int>(h.safety.mode()));
  TEST_ASSERT_FLOAT_WITHIN(0.0001F, 0.22F, h.safety.goal(0));
  TEST_ASSERT_FLOAT_WITHIN(0.0001F, 0, h.safety.goal(1));
  TEST_ASSERT_FLOAT_WITHIN(0.0001F, 1, h.safety.goal(2));
  h.advance(100);
  TEST_ASSERT_FLOAT_WITHIN(0.0002F, 0.22F, h.safety.telemetry(h.now).a[0]);
  h.advance(1000);
  TEST_ASSERT_FLOAT_WITHIN(0.0001F, 0.22F, h.safety.telemetry(h.now).a[0]);
}
void mirrored_calibration_and_hard_angle_clamps() {
  Calibration c{160, 20, true};
  TEST_ASSERT_TRUE(calib::valid(c.min, c.max));
  TEST_ASSERT_FLOAT_WITHIN(0.0001F, 160, calib::toAngle(-1, c));
  TEST_ASSERT_FLOAT_WITHIN(0.0001F, 20, calib::toAngle(5, c));
  TEST_ASSERT_FLOAT_WITHIN(0.0001F, 0.5F, calib::toClosure(90, c));
  TEST_ASSERT_FLOAT_WITHIN(0.0001F, 5, calib::clampAngle(-100));
  TEST_ASSERT_FLOAT_WITHIN(0.0001F, 175, calib::clampAngle(1000));
  Harness h;
  for (std::size_t i = 0; i < config::FINGERS; ++i) {
    Command x;
    x.type = CommandType::Calib;
    x.i = i;
    x.min = 160;
    x.max = 20;
    h.safety.handle(x, 0);
  }
  h.send("{\"t\":\"target\",\"f\":[1,1,1,0.3,0.2],\"v\":1}");
  h.advance(500);
  TEST_ASSERT_FLOAT_WITHIN(0.001F, 90, h.safety.angle(0));
  h.send("{\"t\":\"release\"}");
  h.advance(170);
  TEST_ASSERT_FLOAT_WITHIN(0.001F, 160, h.safety.angle(0));
}
void jog_speed_bounds_and_state_guards() {
  Harness h;
  h.send("{\"t\":\"jog\",\"i\":1,\"deg\":175}");
  h.advance(500);
  TEST_ASSERT_FLOAT_WITHIN(0.001F, 120, h.safety.angle(1));
  h.advance(1000);
  TEST_ASSERT_FLOAT_WITHIN(0.001F, 175, h.safety.angle(1));
  TEST_ASSERT_EQUAL_INT(
      static_cast<int>(ErrorCode::State),
      static_cast<int>(h.send("{\"t\":\"calib\",\"i\":1,\"min\":20,\"max\":150}")));
  TEST_ASSERT_EQUAL_INT(
      static_cast<int>(ErrorCode::State),
      static_cast<int>(h.send("{\"t\":\"target\",\"f\":[1,1,1,0.3,0.2],\"v\":1}")));
  h.send("{\"t\":\"release\"}");
  TEST_ASSERT_FALSE(h.safety.attached(1));
  h.calibrate();
  h.send("{\"t\":\"target\",\"f\":[1,1,1,0.3,0.2],\"v\":1}");
  TEST_ASSERT_EQUAL_INT(static_cast<int>(ErrorCode::State),
                        static_cast<int>(h.send("{\"t\":\"jog\",\"i\":1,\"deg\":90}")));
}
void jog_holds_other_channels_after_release() {
  Harness h;
  h.calibrate();
  h.send("{\"t\":\"target\",\"f\":[0.5,0.5,0.5,0.3,0.2],\"v\":1}");
  h.advance(500);
  h.send("{\"t\":\"release\"}");
  h.advance(20);
  const float thumb = h.safety.angle(0);
  h.send("{\"t\":\"jog\",\"i\":1,\"deg\":95}");
  h.advance(100);
  TEST_ASSERT_FLOAT_WITHIN(0.001F, thumb, h.safety.angle(0));
}
void missing_sensor_refuses_assistance_but_allows_jog() {
  Harness h(false);
  h.calibrate();
  TEST_ASSERT_TRUE(h.saw(EventKind::InaMissing));
  TEST_ASSERT_EQUAL_INT(
      static_cast<int>(ErrorCode::State),
      static_cast<int>(h.send("{\"t\":\"target\",\"f\":[1,1,1,0.3,0.2],\"v\":1}")));
  TEST_ASSERT_EQUAL_INT(static_cast<int>(ErrorCode::State),
                        static_cast<int>(h.send("{\"t\":\"follow\",\"f\":[1,1,1,0.3,0.2]}")));
  TEST_ASSERT_EQUAL_INT(0, static_cast<int>(h.send("{\"t\":\"jog\",\"i\":1,\"deg\":95}")));
  h.send("{\"t\":\"release\"}");
  Harness live;
  live.calibrate();
  live.send("{\"t\":\"target\",\"f\":[1,1,1,0.3,0.2],\"v\":1}");
  live.safety.current(std::numeric_limits<float>::quiet_NaN(), 5);
  TEST_ASSERT_EQUAL_INT(static_cast<int>(State::Fault), static_cast<int>(live.safety.state()));
}
void current_limit_is_clamped_in_any_state() {
  Harness h;
  TEST_ASSERT_EQUAL_FLOAT(1500, h.safety.info().limit);
  h.send("{\"t\":\"limit\",\"ma\":-10}");
  TEST_ASSERT_EQUAL_FLOAT(100, h.safety.info().limit);
  h.safety.stopPressed(0);
  h.send("{\"t\":\"limit\",\"ma\":10000}");
  TEST_ASSERT_EQUAL_FLOAT(2200, h.safety.info().limit);
}
void maximum_total_limit_keeps_the_100_ms_trip_rule() {
  Harness h;
  h.calibrate();
  h.send("{\"t\":\"target\",\"f\":[1,1,1,1,1],\"v\":1}");
  h.send("{\"t\":\"limit\",\"ma\":10000}");
  h.safety.current(2200, 0);
  h.safety.current(2200, 200);
  TEST_ASSERT_FALSE(h.saw(EventKind::Overcurrent));
  h.safety.current(2201, 205);
  h.safety.current(2400, 304);
  TEST_ASSERT_FALSE(h.saw(EventKind::Overcurrent));
  h.safety.current(2201, 305);
  TEST_ASSERT_TRUE(h.saw(EventKind::Overcurrent));
  TEST_ASSERT_EQUAL_FLOAT(2400, h.events[h.count - 1].ma);
}
void timers_survive_millis_wrap() {
  Harness h(true, UINT32_MAX - 500);
  h.calibrate();
  h.send("{\"t\":\"target\",\"f\":[1,1,1,0.3,0.2],\"v\":1}");
  h.advance(995, 0, false);
  TEST_ASSERT_EQUAL_INT(static_cast<int>(State::Run), static_cast<int>(h.safety.state()));
  h.advance(5, 0, false);
  TEST_ASSERT_FALSE(h.saw(EventKind::Watchdog));
  h.advance(5, 0, false);
  TEST_ASSERT_TRUE(h.saw(EventKind::Watchdog));
  Harness c(true, UINT32_MAX - 50);
  c.calibrate();
  c.send("{\"t\":\"target\",\"f\":[1,1,1,0.3,0.2],\"v\":1}");
  c.safety.current(1600, UINT32_MAX - 50);
  c.safety.current(1600, 49);
  TEST_ASSERT_TRUE(c.saw(EventKind::Overcurrent));
}
void filtered_spike_is_rejected_and_sustained_load_trips() {
  CurrentFilter f;
  TEST_ASSERT_EQUAL_FLOAT(0, f.update(0));
  TEST_ASSERT_EQUAL_FLOAT(1000, f.update(4000));
  TEST_ASSERT_EQUAL_FLOAT(1500, f.update(0));
  Harness h;
  h.calibrate();
  h.send("{\"t\":\"target\",\"f\":[1,1,1,0.3,0.2],\"v\":1}");
  CurrentFilter spike;
  spike.update(0);
  for (uint32_t time = 5; time <= 300; time += 5)
    h.safety.current(spike.update(time == 5 ? 4000 : 0), time);
  TEST_ASSERT_FALSE(h.saw(EventKind::Overcurrent));
  CurrentFilter sustained;
  sustained.update(0);
  for (uint32_t time = 400; time <= 550; time += 5) h.safety.current(sustained.update(1800), time);
  TEST_ASSERT_TRUE(h.saw(EventKind::Overcurrent));
}
void stop_debounce_latches_pulses_and_requires_stable_release() {
  StopDebounce d;
  TEST_ASSERT_TRUE(d.update(false, true, 0).pressed);
  TEST_ASSERT_FALSE(d.update(true, true, 5).pressed);
  TEST_ASSERT_FALSE(d.update(false, false, 10).released);
  TEST_ASSERT_FALSE(d.update(true, false, 15).released);
  TEST_ASSERT_FALSE(d.update(false, false, 20).released);
  TEST_ASSERT_FALSE(d.update(false, false, 39).released);
  TEST_ASSERT_TRUE(d.update(false, false, 40).released);
  TEST_ASSERT_TRUE(d.update(true, false, 45).pressed);
}
void serial_overflow_recovers_and_queue_handles_partial_writes() {
  LineReader reader;
  for (int i = 0; i < 600; ++i) TEST_ASSERT_EQUAL_INT(0, static_cast<int>(reader.feed('x')));
  TEST_ASSERT_EQUAL_INT(static_cast<int>(LineReader::Result::TooLong),
                        static_cast<int>(reader.feed('\n')));
  for (const char c : std::string("{\"t\":\"ping\"}\r\n")) {
    const auto result = reader.feed(c);
    if (result == LineReader::Result::Line)
      TEST_ASSERT_TRUE(static_cast<bool>(protocol::parse(reader.data(), reader.size())));
  }
  TxQueue q;
  for (std::size_t i = 0; i < TxQueue::CAPACITY; ++i) TEST_ASSERT_TRUE(q.enqueue("hello\n", 6));
  TEST_ASSERT_FALSE(q.enqueue("full\n", 5));
  q.consume(2);
  TEST_ASSERT_EQUAL_UINT(4, q.size());
  TEST_ASSERT_EQUAL_CHAR('l', *q.data());
  q.consume(4);
  TEST_ASSERT_EQUAL_UINT(1, q.free());
  TEST_ASSERT_TRUE(q.enqueue("new\n", 4));
  while (!q.empty()) q.consume(q.size());
  TEST_ASSERT_EQUAL_UINT(TxQueue::CAPACITY, q.free());
}
void ring_segments_colors_and_blink_are_deterministic() {
  Telemetry t{0, {{0, 0.25F, 0.5F, 0.75F, 1}}, 0, State::Run, Mode::Follow, {}};
  const auto follow = ringFrame(t);
  for (std::size_t finger = 0; finger < config::FINGERS; ++finger) {
    for (std::size_t pixel = 0; pixel < 4; ++pixel)
      TEST_ASSERT_EQUAL_HEX32(pixel < finger ? 0x2F6FEB : 0, follow[finger * 5 + pixel]);
    if (finger + 1 < config::FINGERS) TEST_ASSERT_EQUAL_HEX32(0, follow[finger * 5 + 4]);
  }
  t.a = {{1, 1, 1, 1, 1}};
  for (auto state : {State::Run, State::Calib, State::Idle}) {
    t.st = state;
    t.md = Mode::Target;
    const auto frame = ringFrame(t);
    const uint32_t color = state == State::Run     ? 0xE8890C
                           : state == State::Calib ? 0xFFBF00
                                                   : 0x202020;
    for (std::size_t pixel = 0; pixel < frame.size(); ++pixel)
      TEST_ASSERT_EQUAL_HEX32(pixel % 5 == 4 ? 0 : color, frame[pixel]);
  }
  t.st = State::Run;
  t.a = {{-1, 2, 0, 0, 0}};
  TEST_ASSERT_EQUAL_HEX32(0, ringFrame(t)[0]);
  TEST_ASSERT_EQUAL_HEX32(0xE8890C, ringFrame(t)[8]);
  TEST_ASSERT_EQUAL_HEX32(0, ringFrame(t)[9]);
  t.st = State::Fault;
  for (auto time : {0U, 249U, 250U, 499U, 500U, 749U, 750U, 999U}) {
    t.ms = time;
    for (auto color : ringFrame(t))
      TEST_ASSERT_EQUAL_HEX32((time / 250) % 2 == 0 ? 0xC62828 : 0, color);
  }
}
void every_fault_unwinds_and_detaches_all_five_channels() {
  for (auto reason : {EventKind::StopButton, EventKind::Overcurrent, EventKind::Watchdog,
                      EventKind::InaMissing}) {
    Harness h;
    for (std::size_t i = 0; i < config::FINGERS; ++i) {
      Command c;
      c.type = CommandType::Calib;
      c.i = i;
      c.min = i % 2 ? 150 : 20;
      c.max = i % 2 ? 20 : 150;
      TEST_ASSERT_EQUAL_INT(0, static_cast<int>(h.safety.handle(c, h.now)));
    }
    h.send("{\"t\":\"target\",\"f\":[1,1,1,1,1],\"v\":5}");
    h.advance(500);
    for (std::size_t i = 0; i < config::FINGERS; ++i) {
      TEST_ASSERT_TRUE(h.safety.attached(i));
      TEST_ASSERT_FLOAT_WITHIN(0.001F, 0.5F, h.safety.telemetry(h.now).a[i]);
    }
    if (reason == EventKind::StopButton) h.safety.stopPressed(h.now);
    if (reason == EventKind::InaMissing)
      h.safety.current(std::numeric_limits<float>::quiet_NaN(), h.now);
    if (reason == EventKind::Overcurrent) {
      h.safety.current(1600, h.now);
      h.safety.current(1600, h.now + 99);
      TEST_ASSERT_FALSE(h.saw(reason));
      h.now += 100;
      h.safety.current(1600, h.now);
    }
    if (reason == EventKind::Watchdog) {
      h.now += config::WATCHDOG_MS + 1;
      h.safety.tick(h.now);
    }
    TEST_ASSERT_TRUE(h.saw(reason));
    TEST_ASSERT_EQUAL_INT(static_cast<int>(State::Fault), static_cast<int>(h.safety.state()));
    for (const auto type : {CommandType::Target, CommandType::Follow, CommandType::Jog}) {
      Command c;
      c.type = type;
      c.f.fill(1);
      c.v = 1;
      c.i = 4;
      c.deg = 90;
      TEST_ASSERT_EQUAL_INT(static_cast<int>(ErrorCode::Fault),
                            static_cast<int>(h.safety.handle(c, h.now)));
    }
    const auto before = h.safety.telemetry(h.now);
    h.advance(5);
    for (std::size_t i = 0; i < config::FINGERS; ++i)
      TEST_ASSERT_FLOAT_WITHIN(0.001F, before.a[i] - 0.015F, h.safety.telemetry(h.now).a[i]);
    h.advance(800);
    for (std::size_t i = 0; i < config::FINGERS; ++i) {
      TEST_ASSERT_FALSE(h.safety.attached(i));
      TEST_ASSERT_FLOAT_WITHIN(0.001F, 0, h.safety.telemetry(h.now).a[i]);
      TEST_ASSERT_EQUAL_FLOAT(h.safety.info().calib[i].min, h.safety.angle(i));
    }
    if (reason == EventKind::StopButton) {
      TEST_ASSERT_EQUAL_INT(static_cast<int>(ErrorCode::Fault),
                            static_cast<int>(h.send("{\"t\":\"release\"}")));
      h.safety.stopReleased();
    }
    TEST_ASSERT_EQUAL_INT(0, static_cast<int>(h.send("{\"t\":\"release\"}")));
    TEST_ASSERT_EQUAL_INT(static_cast<int>(State::Idle), static_cast<int>(h.safety.state()));
  }
}
void every_channel_jogs_without_sensor_and_detaches_on_release() {
  for (std::size_t i = 0; i < config::FINGERS; ++i) {
    Harness h(false);
    Command c;
    c.type = CommandType::Jog;
    c.i = i;
    c.deg = config::HARD_MAX;
    TEST_ASSERT_EQUAL_INT(0, static_cast<int>(h.safety.handle(c, h.now)));
    h.advance(500);
    TEST_ASSERT_FLOAT_WITHIN(0.001F, 120, h.safety.angle(i));
    for (std::size_t j = 0; j < config::FINGERS; ++j)
      TEST_ASSERT_EQUAL(i == j, h.safety.attached(j));
    h.advance(1000);
    TEST_ASSERT_EQUAL_FLOAT(config::HARD_MAX, h.safety.angle(i));
    h.send("{\"t\":\"release\"}");
    TEST_ASSERT_FALSE(h.safety.attached(i));
  }
}
void all_five_follow_goals_keep_slack_and_respect_the_speed_cap() {
  Harness h;
  h.calibrate();
  h.send("{\"t\":\"target\",\"f\":[1,1,1,1,1],\"v\":1}");
  h.advance(100);
  h.send("{\"t\":\"follow\",\"f\":[0.3,0.02,1.2,0.7,0.8]}");
  const Quint expected{{0.22F, 0, 1, 0.62F, 0.72F}};
  for (std::size_t i = 0; i < config::FINGERS; ++i)
    TEST_ASSERT_FLOAT_WITHIN(0.0001F, expected[i], h.safety.goal(i));
  h.advance(5);
  const Quint next{{0.1075F, 0.085F, 0.1075F, 0.1075F, 0.1075F}};
  for (std::size_t i = 0; i < config::FINGERS; ++i)
    TEST_ASSERT_FLOAT_WITHIN(0.0002F, next[i], h.safety.telemetry(h.now).a[i]);
}
void event_backpressure_preserves_safety_reserve() {
  TxQueue q;
  for (std::size_t i = 0; i < TxQueue::CAPACITY - TxQueue::SAFETY_RESERVE; ++i)
    TEST_ASSERT_TRUE(q.enqueue("reply\n", 6));
  TEST_ASSERT_EQUAL_UINT(TxQueue::SAFETY_RESERVE, q.free());
  // Once commands and STOP-release notifications are backpressured, a latched
  // STOP and a one-time missing-sensor event fit without discarding either.
  TEST_ASSERT_TRUE(q.enqueue("stop_button\n", 12));
  TEST_ASSERT_TRUE(q.enqueue("ina_missing\n", 12));
  TEST_ASSERT_GREATER_OR_EQUAL(2, q.free());
}
void rejected_calibration_invalidates_that_finger_without_keepalive() {
  Harness h;
  h.calibrate();
  const char* rejected = "{\"t\":\"calib\",\"i\":1,\"min\":20,\"max\":25}";
  const auto bad = protocol::parse(rejected, std::strlen(rejected));
  TEST_ASSERT_EQUAL_INT(static_cast<int>(ErrorCode::BadArgs), static_cast<int>(bad.error));
  TEST_ASSERT_EQUAL_INT(static_cast<int>(ErrorCode::BadArgs),
                        static_cast<int>(h.safety.handle(bad.command, 900)));
  TEST_ASSERT_FALSE(h.safety.info().calib[1].valid);
  TEST_ASSERT_EQUAL_INT(
      static_cast<int>(ErrorCode::NoCalib),
      static_cast<int>(h.send("{\"t\":\"target\",\"f\":[1,1,1,0.3,0.2],\"v\":1}")));
}
void assistance_waits_for_out_of_range_jog_to_unwind() {
  Harness h;
  h.calibrate();
  h.send("{\"t\":\"jog\",\"i\":0,\"deg\":175}");
  h.advance(3000);
  TEST_ASSERT_EQUAL_FLOAT(175, h.safety.angle(0));
  h.send("{\"t\":\"release\"}");
  TEST_ASSERT_EQUAL_INT(
      static_cast<int>(ErrorCode::State),
      static_cast<int>(h.send("{\"t\":\"target\",\"f\":[0,0,0,0.3,0.2],\"v\":1}")));
  h.advance(100);
  TEST_ASSERT_EQUAL_INT(
      0, static_cast<int>(h.send("{\"t\":\"target\",\"f\":[0,0,0,0.3,0.2],\"v\":1}")));
  const float angle = h.safety.angle(0);
  h.advance(5);
  TEST_ASSERT_FLOAT_WITHIN(0.001F, angle - 1.95F, h.safety.angle(0));  // Run unwinds at 3.0/s.
}
void decimal_writer_never_overruns_and_parser_survives_noise() {
  Telemetry t{UINT32_MAX, {{1, 0.25F, 0}}, 3276, State::Fault, Mode::Target, {{0, 1, 0.5F}}};
  for (std::size_t capacity = 0; capacity <= 202; ++capacity) {
    char bytes[204];
    std::memset(bytes, 'Z', sizeof(bytes));
    protocol::format(t, bytes + 1, capacity);
    TEST_ASSERT_EQUAL_CHAR('Z', bytes[0]);
    TEST_ASSERT_EQUAL_CHAR('Z', bytes[capacity + 1]);
  }
  uint32_t seed = 12345;
  char noise[200];
  for (int iteration = 0; iteration < 5000; ++iteration) {
    for (char& byte : noise) {
      seed ^= seed << 13;
      seed ^= seed >> 17;
      seed ^= seed << 5;
      byte = static_cast<char>(seed);
    }
    const auto parsed = protocol::parse(noise, seed % 201);
    TEST_ASSERT_FALSE(static_cast<bool>(parsed));
  }
}

// App command patterns: runtime, engine and calibration wizard.
// Replay Web Serial commands at the host cadence through the safety controller.
// Every command must be accepted and no safety event may fire on a healthy run.
struct AppLink {
  Harness& h;
  uint32_t lastSent = 0;
  ErrorCode send(const char* json) {
    lastSent = h.now;
    return h.send(json);
  }
  void sendOk(const char* json) {
    TEST_ASSERT_EQUAL_STRING_MESSAGE("", protocol::name(send(json)), json);
  }
  void sendFingers(const char* type, const Quint& f, float v = 0) {
    char json[160];
    if (v > 0)
      std::snprintf(json, sizeof(json),
                    "{\"t\":\"%s\",\"f\":[%.2f,%.2f,%.2f,%.2f,%.2f],\"v\":%.2f}", type, f[0], f[1],
                    f[2], f[3], f[4], v);
    else
      std::snprintf(json, sizeof(json), "{\"t\":\"%s\",\"f\":[%.2f,%.2f,%.2f,%.2f,%.2f]}", type,
                    f[0], f[1], f[2], f[3], f[4]);
    sendOk(json);
  }
  // One 5 ms control tick; the client pings only after 300 ms without any other write.
  void tick(float ma = 300) {
    h.now += 5;
    if (h.now - lastSent >= 300) sendOk("{\"t\":\"ping\"}");
    h.safety.current(ma, h.now);
    h.safety.tick(h.now);
  }
  void connect() {
    // runtime.sendToGlove(): release, then calib for all five fingers, then the limit.
    sendOk("{\"t\":\"hello\"}");
    sendOk("{\"t\":\"release\"}");
    const char* ranges[] = {"{\"t\":\"calib\",\"i\":0,\"min\":20,\"max\":150}",
                            "{\"t\":\"calib\",\"i\":1,\"min\":25,\"max\":155}",
                            "{\"t\":\"calib\",\"i\":2,\"min\":150,\"max\":30}",
                            "{\"t\":\"calib\",\"i\":3,\"min\":30,\"max\":150}",
                            "{\"t\":\"calib\",\"i\":4,\"min\":30,\"max\":150}"};
    for (const char* json : ranges) sendOk(json);
    sendOk("{\"t\":\"limit\",\"ma\":1500}");
  }
};
void no_safety_event(const Harness& h) {
  for (auto kind :
       {EventKind::Overcurrent, EventKind::StopButton, EventKind::Watchdog, EventKind::InaMissing})
    TEST_ASSERT_FALSE_MESSAGE(h.saw(kind), protocol::name(kind));
}
void app_practice_sequence_is_accepted_end_to_end() {
  Harness h;
  AppLink app{h};
  app.connect();
  TEST_ASSERT_TRUE(h.saw(EventKind::CalibOk));
  TEST_ASSERT_EQUAL_FLOAT(1500, h.safety.info().limit);
  // ATTEMPT: follow at 30 Hz while the patient opens to 40% pull. Follow feeds the watchdog.
  Quint pull{};
  for (int frame = 0; frame < 90; ++frame) {
    pull.fill(0.4F * frame / 89);
    app.sendFingers("follow", pull);
    for (int t = 0; t < 7; ++t) app.tick();  // ~33 ms between follow lines
  }
  auto tel = h.safety.telemetry(h.now);
  TEST_ASSERT_EQUAL_INT(static_cast<int>(Mode::Follow), static_cast<int>(tel.md));
  for (std::size_t i = 0; i < config::FINGERS; ++i)
    TEST_ASSERT_FLOAT_WITHIN(0.02F, 0.32F, tel.a[i]);  // slack: never past input pull - 0.08
  // ASSIST: the engine staggers fingers 150 ms apart; waiting fingers hold their position.
  const Quint goal{0.7F, 0.95F, 0.95F, 0.95F, 0.95F};
  for (std::size_t released = 1; released <= config::FINGERS; ++released) {
    Quint f = tel.a;
    for (std::size_t i = 0; i < released; ++i) f[i] = goal[i];
    app.sendFingers("target", f, 0.3F);
    for (int t = 0; t < 30; ++t) app.tick(900);
  }
  for (int t = 0; t < 600; ++t) app.tick(900);  // 3 s at 0.3 range/s reaches every goal
  tel = h.safety.telemetry(h.now);
  TEST_ASSERT_EQUAL_INT(static_cast<int>(Mode::Target), static_cast<int>(tel.md));
  for (std::size_t i = 0; i < config::FINGERS; ++i) {
    TEST_ASSERT_FLOAT_WITHIN(0.001F, goal[i], tel.a[i]);
    TEST_ASSERT_TRUE(h.safety.attached(i));
  }
  // RELEASE: unwind at 3 ranges/s, then detach 500 ms after reaching slack.
  app.sendOk("{\"t\":\"release\"}");
  for (int t = 0; t < 200; ++t) app.tick(100);
  for (std::size_t i = 0; i < config::FINGERS; ++i) TEST_ASSERT_FALSE(h.safety.attached(i));
  TEST_ASSERT_EQUAL_INT(static_cast<int>(State::Idle), static_cast<int>(h.safety.state()));
  no_safety_event(h);
}
void app_calibration_wizard_sequence_is_accepted() {
  Harness h;
  AppLink app{h};
  // Calibrate page: a low limit while jogging each finger, then release before the ranges.
  for (int finger = 0; finger < static_cast<int>(config::FINGERS); ++finger) {
    char json[48];
    app.sendOk("{\"t\":\"limit\",\"ma\":400}");
    std::snprintf(json, sizeof(json), "{\"t\":\"jog\",\"i\":%d,\"deg\":95}", finger);
    app.sendOk(json);
    for (int t = 0; t < 40; ++t) app.tick(150);
    TEST_ASSERT_TRUE(h.safety.attached(finger));
  }
  TEST_ASSERT_EQUAL_FLOAT(400, h.safety.info().limit);
  TEST_ASSERT_EQUAL_INT(static_cast<int>(State::Calib), static_cast<int>(h.safety.state()));
  // Ranges are rejected until release; uncalibrated jogs then go limp at once.
  TEST_ASSERT_EQUAL_STRING(
      "state", protocol::name(app.send("{\"t\":\"calib\",\"i\":0,\"min\":20,\"max\":150}")));
  app.connect();
  for (std::size_t i = 0; i < config::FINGERS; ++i) TEST_ASSERT_FALSE(h.safety.attached(i));
  // "Glove opens the hand": limit min(1500, draft) and a slow pull target on all five.
  app.sendOk("{\"t\":\"limit\",\"ma\":1500}");
  app.sendFingers("target", Quint{1, 1, 1, 1, 1}, 0.3F);
  for (int t = 0; t < 800; ++t) app.tick(900);
  for (std::size_t i = 0; i < config::FINGERS; ++i)
    TEST_ASSERT_FLOAT_WITHIN(0.001F, 1, h.safety.telemetry(h.now).a[i]);
  app.sendOk("{\"t\":\"release\"}");
  no_safety_event(h);
}
void app_silence_still_trips_the_watchdog() {
  // If the browser stops writing (tab hung, cable out), the board releases on its own.
  Harness h;
  AppLink app{h};
  app.connect();
  app.sendFingers("target", Quint{0.5F, 0.5F, 0.5F, 0.5F, 0.5F}, 0.3F);
  auto silent = [&](int ticks) {
    for (int t = 0; t < ticks; ++t) {
      h.now += 5;
      h.safety.current(300, h.now);
      h.safety.tick(h.now);
    }
  };
  silent(200);  // exactly 1000 ms: not yet (strictly greater than WATCHDOG_MS)
  TEST_ASSERT_FALSE(h.saw(EventKind::Watchdog));
  silent(1);  // 1005 ms: the next tick releases
  TEST_ASSERT_TRUE(h.saw(EventKind::Watchdog));
  TEST_ASSERT_EQUAL_INT(static_cast<int>(State::Fault), static_cast<int>(h.safety.state()));
}

bool sameJson(JsonVariantConst a, JsonVariantConst b) {
  if (a.is<double>() && b.is<double>())
    return std::fabs(a.as<double>() - b.as<double>()) < 0.000001;
  if (a.is<JsonArrayConst>() && b.is<JsonArrayConst>()) {
    if (a.size() != b.size()) return false;
    for (std::size_t i = 0; i < a.size(); ++i)
      if (!sameJson(a[i], b[i])) return false;
    return true;
  }
  if (a.is<JsonObjectConst>() && b.is<JsonObjectConst>()) {
    if (a.size() != b.size()) return false;
    for (auto pair : a.as<JsonObjectConst>())
      if (!sameJson(pair.value(), b[pair.key()])) return false;
    return true;
  }
  return a == b;
}

// Firmware receives host commands only. Device fixture lines are independently
// decoded, reconstructed through the firmware encoders, and compared by value.
void checkDeviceFixture(JsonDocument& input, char* output, std::size_t capacity) {
  const char* type = input["t"];
  std::size_t size = 0;
  if (std::strcmp(type, "tel") == 0) {
    Telemetry t;
    t.ms = input["ms"];
    t.ma = input["ma"];
    for (std::size_t i = 0; i < config::FINGERS; ++i) {
      t.a[i] = input["a"][i];
      t.tg[i] = input["tg"][i];
    }
    for (auto st : {State::Boot, State::Idle, State::Run, State::Calib, State::Fault})
      if (input["st"] == protocol::name(st)) t.st = st;
    for (auto md : {Mode::None, Mode::Follow, Mode::Target, Mode::Jog})
      if (input["md"] == protocol::name(md)) t.md = md;
    size = protocol::format(t, output, capacity);
  } else if (std::strcmp(type, "evt") == 0) {
    Event e;
    for (auto kind :
         {EventKind::Boot, EventKind::Overcurrent, EventKind::StopButton, EventKind::Watchdog,
          EventKind::StopReleased, EventKind::InaMissing, EventKind::CalibOk})
      if (input["e"] == protocol::name(kind)) e.kind = kind;
    e.ma = input["ma"] | 0.0F;
    size = protocol::format(e, output, capacity);
  } else if (std::strcmp(type, "info") == 0) {
    Info info;
    info.limit = input["limit"];
    for (std::size_t i = 0; i < config::FINGERS; ++i)
      if (!input["calib"][i].isNull())
        info.calib[i] = {input["calib"][i][0], input["calib"][i][1], true};
    size = protocol::format(info, output, capacity);
  } else if (std::strcmp(type, "err") == 0) {
    ErrorCode error = ErrorCode::None;
    for (auto why : {ErrorCode::BadJson, ErrorCode::UnknownType, ErrorCode::BadArgs,
                     ErrorCode::NoCalib, ErrorCode::Fault, ErrorCode::State})
      if (input["why"] == protocol::name(why)) error = why;
    size = protocol::formatError(input["c"], error, output, capacity);
  }
  TEST_ASSERT_GREATER_THAN(0, size);
  JsonDocument formatted;
  TEST_ASSERT_FALSE(deserializeJson(formatted, output));
  TEST_ASSERT_TRUE_MESSAGE(sameJson(input.as<JsonVariantConst>(), formatted.as<JsonVariantConst>()),
                           output);
}
void servo_timers_cover_every_finger() {
  // Four channels per LEDC timer: five fingers need two timers, never one.
  TEST_ASSERT_EQUAL_UINT(1, pwm::timersFor(1));
  TEST_ASSERT_EQUAL_UINT(1, pwm::timersFor(4));
  TEST_ASSERT_EQUAL_UINT(2, pwm::timersFor(5));
  TEST_ASSERT_EQUAL_UINT(2, pwm::timersFor(8));
  TEST_ASSERT_EQUAL_UINT(2, pwm::SERVO_TIMERS);
  TEST_ASSERT_GREATER_OR_EQUAL(config::FINGERS, pwm::SERVO_TIMERS * pwm::CHANNELS_PER_TIMER);
}
void shared_serial_fixtures_match_expected() {
  std::ifstream lines("../contracts/fixtures/serial_lines.txt");
  std::ifstream expectedFile("../contracts/fixtures/serial_lines.expected.json");
  if (!lines.is_open())
    TEST_IGNORE_MESSAGE("WP0 serial fixtures not present; inline vectors still run");
  TEST_ASSERT_TRUE_MESSAGE(expectedFile.is_open(), "Serial fixture expectations are missing");
  JsonDocument expected;
  TEST_ASSERT_FALSE(deserializeJson(expected, expectedFile));
  std::string line;
  std::size_t index = 0;
  while (std::getline(lines, line)) {
    TEST_ASSERT_LESS_THAN(expected.size(), index);
    const auto expectation = expected[index].as<JsonObjectConst>();
    TEST_ASSERT_EQUAL_UINT(index + 1, expectation["line"].as<unsigned>());
    if (expectation["direction"] == "host_to_device") {
      const auto parsed = protocol::parse(line.data(), line.size());
      TEST_ASSERT_EQUAL_MESSAGE(expectation["valid"].as<bool>(), static_cast<bool>(parsed),
                                line.c_str());
      if (!expectation["why"].isNull())
        TEST_ASSERT_EQUAL_STRING(expectation["why"].as<const char*>(),
                                 protocol::name(parsed.error));
      if (!expectation["type"].isNull())
        TEST_ASSERT_EQUAL_STRING(expectation["type"].as<const char*>(), parsed.type);
      if (parsed) {
        JsonDocument original;
        TEST_ASSERT_FALSE(deserializeJson(original, line));
        const auto& c = parsed.command;
        TEST_ASSERT_EQUAL_STRING(original["t"].as<const char*>(), protocol::name(c.type));
        if (c.type == CommandType::Target || c.type == CommandType::Follow)
          for (std::size_t i = 0; i < config::FINGERS; ++i)
            TEST_ASSERT_EQUAL_FLOAT(original["f"][i].as<float>(), c.f[i]);
        if (c.type == CommandType::Target) TEST_ASSERT_EQUAL_FLOAT(original["v"].as<float>(), c.v);
        if (c.type == CommandType::Calib || c.type == CommandType::Jog)
          TEST_ASSERT_EQUAL_INT(original["i"].as<int>(), c.i);
        if (c.type == CommandType::Calib) {
          TEST_ASSERT_EQUAL_FLOAT(original["min"].as<float>(), c.min);
          TEST_ASSERT_EQUAL_FLOAT(original["max"].as<float>(), c.max);
        }
        if (c.type == CommandType::Jog) TEST_ASSERT_EQUAL_FLOAT(original["deg"].as<float>(), c.deg);
        if (c.type == CommandType::Limit) TEST_ASSERT_EQUAL_FLOAT(original["ma"].as<float>(), c.ma);
      }
    } else {
      JsonDocument input;
      TEST_ASSERT_FALSE(deserializeJson(input, line));
      TEST_ASSERT_TRUE(expectation["valid"].as<bool>());
      TEST_ASSERT_EQUAL_STRING(expectation["type"].as<const char*>(), input["t"].as<const char*>());
      char formatted[202];
      checkDeviceFixture(input, formatted, sizeof(formatted));
    }
    ++index;
  }
  TEST_ASSERT_EQUAL_UINT(expected.size(), index);
}
}  // namespace

int main() {
  UNITY_BEGIN();
  RUN_TEST(parses_every_command_and_ignores_unknown_fields);
  RUN_TEST(rejects_invalid_json_and_extensions);
  RUN_TEST(rejects_bad_args_and_non_finite_values);
  RUN_TEST(codec_storage_survives_repeated_maximum_lines);
  RUN_TEST(telemetry_is_bounded_and_rounds_to_two_decimals);
  RUN_TEST(boot_reset_reason_is_bounded_and_distinguishes_brownout);
  RUN_TEST(info_reports_five_channels_and_no_calibration_after_reboot);
  RUN_TEST(boot_detaches_and_never_reuses_calibration);
  RUN_TEST(moves_need_all_five_calibrations);
  RUN_TEST(ring_and_pinky_require_calibration_move_and_release_with_the_other_fingers);
  RUN_TEST(target_speed_cap_and_position_clamps);
  RUN_TEST(requested_slow_speed_and_no_catchup_jump);
  RUN_TEST(follow_unwinds_at_release_rate_and_winds_at_follow_rate);
  RUN_TEST(target_unwinds_at_release_rate_and_caps_only_winding);
  RUN_TEST(fast_fist_follow_pays_out_to_each_goal_without_overshoot);
  RUN_TEST(run_unwinding_never_catches_up_after_a_missed_tick);
  RUN_TEST(follow_target_follow_and_target_release_transitions_never_jump);
  RUN_TEST(overcurrent_trips_at_100_ms_with_peak);
  RUN_TEST(overcurrent_101_ms_and_spikes_reset_timer);
  RUN_TEST(watchdog_boundary_idle_and_valid_message_refresh);
  RUN_TEST(invalid_messages_do_not_feed_watchdog);
  RUN_TEST(stop_latches_rejects_moves_and_needs_explicit_release);
  RUN_TEST(stop_works_from_idle_calibration_and_fault);
  RUN_TEST(release_ramps_then_waits_500_ms_before_detach);
  RUN_TEST(follow_replaces_target_and_keeps_slack);
  RUN_TEST(mirrored_calibration_and_hard_angle_clamps);
  RUN_TEST(jog_speed_bounds_and_state_guards);
  RUN_TEST(jog_holds_other_channels_after_release);
  RUN_TEST(missing_sensor_refuses_assistance_but_allows_jog);
  RUN_TEST(current_limit_is_clamped_in_any_state);
  RUN_TEST(maximum_total_limit_keeps_the_100_ms_trip_rule);
  RUN_TEST(timers_survive_millis_wrap);
  RUN_TEST(filtered_spike_is_rejected_and_sustained_load_trips);
  RUN_TEST(stop_debounce_latches_pulses_and_requires_stable_release);
  RUN_TEST(serial_overflow_recovers_and_queue_handles_partial_writes);
  RUN_TEST(ring_segments_colors_and_blink_are_deterministic);
  RUN_TEST(every_fault_unwinds_and_detaches_all_five_channels);
  RUN_TEST(every_channel_jogs_without_sensor_and_detaches_on_release);
  RUN_TEST(all_five_follow_goals_keep_slack_and_respect_the_speed_cap);
  RUN_TEST(event_backpressure_preserves_safety_reserve);
  RUN_TEST(rejected_calibration_invalidates_that_finger_without_keepalive);
  RUN_TEST(assistance_waits_for_out_of_range_jog_to_unwind);
  RUN_TEST(decimal_writer_never_overruns_and_parser_survives_noise);
  RUN_TEST(servo_timers_cover_every_finger);
  RUN_TEST(app_practice_sequence_is_accepted_end_to_end);
  RUN_TEST(app_calibration_wizard_sequence_is_accepted);
  RUN_TEST(app_silence_still_trips_the_watchdog);
  RUN_TEST(shared_serial_fixtures_match_expected);
  return UNITY_END();
}
