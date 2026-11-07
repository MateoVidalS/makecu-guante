#include <ArduinoJson.h>
#include <unity.h>

#include <cmath>
#include <cstring>
#include <fstream>
#include <limits>
#include <string>

#include "calib.h"
#include "current_filter.h"
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
  void calibrate() {
    for (int i = 0; i < 3; ++i) {
      Command c;
      c.type = CommandType::Calib;
      c.i = i;
      c.min = 20;
      c.max = 150;
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
      "{\"t\":\"target\",\"f\":[0.8,0.6,0],\"v\":0.5,\"extra\":{\"x\":[1,true,null]}}",
      "{\"t\":\"follow\",\"f\":[0.3,0.4,0.1]}",
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
       {"{\"t\":\"target\",\"f\":[0,1],\"v\":1}", "{\"t\":\"target\",\"f\":[0,true,1],\"v\":1}",
        "{\"t\":\"target\",\"f\":[0,1,1],\"v\":0}", "{\"t\":\"target\",\"f\":[0,1,1],\"v\":-1}",
        "{\"t\":\"follow\",\"f\":[0,1e999,1]}", "{\"t\":\"calib\",\"i\":3,\"min\":20,\"max\":150}",
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
  Telemetry t{UINT32_MAX,    {{0.1234F, 0.9999F, 0.555F}}, 32767, State::Fault, Mode::Target,
              {{1, 0.5F, 0}}};
  char line[202];
  const auto size = protocol::format(t, line, sizeof(line));
  TEST_ASSERT_GREATER_THAN(0, size);
  TEST_ASSERT_LESS_OR_EQUAL(201, size);
  TEST_ASSERT_EQUAL_CHAR('\n', line[size - 1]);
  JsonDocument doc;
  TEST_ASSERT_FALSE(deserializeJson(doc, line));
  TEST_ASSERT_FLOAT_WITHIN(0.0001F, 0.12F, doc["a"][0].as<float>());
  TEST_ASSERT_FLOAT_WITHIN(0.0001F, 1, doc["a"][1].as<float>());
  TEST_ASSERT_FLOAT_WITHIN(0.0001F, 0.56F, doc["a"][2].as<float>());
  TEST_ASSERT_EQUAL_UINT32(UINT32_MAX, doc["ms"].as<uint32_t>());
  TEST_ASSERT_EQUAL_INT(0, protocol::format(t, line, 20));
  t.ma = std::numeric_limits<float>::quiet_NaN();
  TEST_ASSERT_EQUAL_INT(0, protocol::format(t, line, sizeof(line)));
}
void boot_detaches_and_never_reuses_calibration() {
  Harness h;
  TEST_ASSERT_EQUAL_INT(static_cast<int>(State::Idle), static_cast<int>(h.safety.state()));
  TEST_ASSERT_TRUE(h.saw(EventKind::Boot));
  for (int i = 0; i < 3; ++i) TEST_ASSERT_FALSE(h.safety.attached(i));
  h.calibrate();
  TEST_ASSERT_TRUE(h.safety.calibrated());
  h.safety.begin(true, 50);
  TEST_ASSERT_FALSE(h.safety.calibrated());
}
void moves_need_all_three_calibrations() {
  Harness h;
  TEST_ASSERT_EQUAL_INT(static_cast<int>(ErrorCode::NoCalib),
                        static_cast<int>(h.send("{\"t\":\"target\",\"f\":[1,1,1],\"v\":1}")));
  TEST_ASSERT_EQUAL_INT(static_cast<int>(ErrorCode::NoCalib),
                        static_cast<int>(h.send("{\"t\":\"follow\",\"f\":[1,1,1]}")));
  h.calibrate();
  TEST_ASSERT_TRUE(h.saw(EventKind::CalibOk));
  h.send("{\"t\":\"calib\",\"i\":0,\"min\":30,\"max\":160}");
  TEST_ASSERT_FALSE(h.safety.calibrated());
  TEST_ASSERT_FALSE(h.safety.info().calib[1].valid);
}
void target_speed_cap_and_position_clamps() {
  Harness h;
  h.calibrate();
  h.send("{\"t\":\"target\",\"f\":[5,-2,0.5],\"v\":5}");
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
  h.send("{\"t\":\"target\",\"f\":[1,1,1],\"v\":0.2}");
  h.advance(500);
  TEST_ASSERT_FLOAT_WITHIN(0.0001F, 0.1F, h.safety.telemetry(h.now).a[0]);
  h.safety.tick(h.now + 100);
  TEST_ASSERT_FLOAT_WITHIN(0.0001F, 0.101F, h.safety.telemetry(h.now).a[0]);
  auto c = command("{\"t\":\"target\",\"f\":[1,1,1],\"v\":1}");
  c.v = -1;
  TEST_ASSERT_EQUAL_INT(static_cast<int>(ErrorCode::BadArgs),
                        static_cast<int>(h.safety.handle(c, h.now)));
}
void overcurrent_trips_at_100_ms_with_peak() {
  Harness h;
  h.calibrate();
  h.send("{\"t\":\"target\",\"f\":[1,1,1],\"v\":1}");
  h.safety.current(950, 5);
  h.safety.current(1100, 55);
  h.safety.current(960, 104);
  TEST_ASSERT_EQUAL_INT(static_cast<int>(State::Run), static_cast<int>(h.safety.state()));
  h.safety.current(960, 105);
  TEST_ASSERT_EQUAL_INT(static_cast<int>(State::Fault), static_cast<int>(h.safety.state()));
  TEST_ASSERT_EQUAL_INT(static_cast<int>(EventKind::Overcurrent),
                        static_cast<int>(h.events[h.count - 1].kind));
  TEST_ASSERT_FLOAT_WITHIN(0.01F, 1100, h.events[h.count - 1].ma);
}
void overcurrent_101_ms_and_spikes_reset_timer() {
  Harness h;
  h.calibrate();
  h.send("{\"t\":\"target\",\"f\":[1,1,1],\"v\":1}");
  h.safety.current(1000, 0);
  h.safety.current(1000, 99);
  h.safety.current(900, 100);
  h.safety.current(1000, 200);
  h.safety.current(1000, 299);
  TEST_ASSERT_FALSE(h.saw(EventKind::Overcurrent));
  h.safety.current(1000, 301);
  TEST_ASSERT_TRUE(h.saw(EventKind::Overcurrent));
}
void watchdog_boundary_idle_and_valid_message_refresh() {
  Harness h;
  h.calibrate();
  h.safety.tick(2000);
  TEST_ASSERT_FALSE(h.saw(EventKind::Watchdog));
  h.now = 2000;
  h.send("{\"t\":\"target\",\"f\":[1,1,1],\"v\":1}");
  h.safety.tick(2999);
  TEST_ASSERT_EQUAL_INT(static_cast<int>(State::Run), static_cast<int>(h.safety.state()));
  h.safety.tick(3000);
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
  TEST_ASSERT_TRUE(j.saw(EventKind::Watchdog));
}
void invalid_messages_do_not_feed_watchdog() {
  Harness h;
  h.calibrate();
  h.send("{\"t\":\"target\",\"f\":[1,1,1],\"v\":1}");
  Command bad;
  bad.type = CommandType::Target;
  bad.v = 0;
  TEST_ASSERT_EQUAL_INT(static_cast<int>(ErrorCode::BadArgs),
                        static_cast<int>(h.safety.handle(bad, 999)));
  h.safety.tick(1000);
  TEST_ASSERT_TRUE(h.saw(EventKind::Watchdog));
}
void stop_latches_rejects_moves_and_needs_explicit_release() {
  Harness h;
  h.calibrate();
  h.send("{\"t\":\"target\",\"f\":[1,1,1],\"v\":1}");
  h.advance(500);
  h.safety.stopPressed(h.now);
  TEST_ASSERT_TRUE(h.saw(EventKind::StopButton));
  TEST_ASSERT_EQUAL_INT(static_cast<int>(ErrorCode::Fault),
                        static_cast<int>(h.send("{\"t\":\"release\"}")));
  h.safety.stopReleased();
  TEST_ASSERT_TRUE(h.saw(EventKind::StopReleased));
  for (const auto* json :
       {"{\"t\":\"target\",\"f\":[1,1,1],\"v\":1}", "{\"t\":\"follow\",\"f\":[1,1,1]}",
        "{\"t\":\"jog\",\"i\":1,\"deg\":90}"})
    TEST_ASSERT_EQUAL_INT(static_cast<int>(ErrorCode::Fault), static_cast<int>(h.send(json)));
  h.advance(1000);
  TEST_ASSERT_FALSE(h.safety.attached(0));
  TEST_ASSERT_EQUAL_INT(0, static_cast<int>(h.send("{\"t\":\"release\"}")));
  TEST_ASSERT_EQUAL_INT(static_cast<int>(State::Idle), static_cast<int>(h.safety.state()));
  TEST_ASSERT_EQUAL_INT(0, static_cast<int>(h.send("{\"t\":\"target\",\"f\":[0.1,0,0],\"v\":1}")));
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
  h.send("{\"t\":\"target\",\"f\":[0.6,0.6,0.6],\"v\":1}");
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
  h.send("{\"t\":\"target\",\"f\":[1,1,1],\"v\":1}");
  h.advance(100);
  h.send("{\"t\":\"follow\",\"f\":[0.3,0.02,1.2]}");
  TEST_ASSERT_EQUAL_INT(static_cast<int>(Mode::Follow), static_cast<int>(h.safety.mode()));
  TEST_ASSERT_FLOAT_WITHIN(0.0001F, 0.25F, h.safety.goal(0));
  TEST_ASSERT_FLOAT_WITHIN(0.0001F, 0, h.safety.goal(1));
  TEST_ASSERT_FLOAT_WITHIN(0.0001F, 1, h.safety.goal(2));
  h.advance(100);
  TEST_ASSERT_FLOAT_WITHIN(0.0002F, 0.25F, h.safety.telemetry(h.now).a[0]);
  h.advance(1000);
  TEST_ASSERT_FLOAT_WITHIN(0.0001F, 0.25F, h.safety.telemetry(h.now).a[0]);
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
  for (int i = 0; i < 3; ++i) {
    Command x;
    x.type = CommandType::Calib;
    x.i = i;
    x.min = 160;
    x.max = 20;
    h.safety.handle(x, 0);
  }
  h.send("{\"t\":\"target\",\"f\":[1,1,1],\"v\":1}");
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
  TEST_ASSERT_EQUAL_INT(static_cast<int>(ErrorCode::State),
                        static_cast<int>(h.send("{\"t\":\"target\",\"f\":[1,1,1],\"v\":1}")));
  h.send("{\"t\":\"release\"}");
  TEST_ASSERT_FALSE(h.safety.attached(1));
  h.calibrate();
  h.send("{\"t\":\"target\",\"f\":[1,1,1],\"v\":1}");
  TEST_ASSERT_EQUAL_INT(static_cast<int>(ErrorCode::State),
                        static_cast<int>(h.send("{\"t\":\"jog\",\"i\":1,\"deg\":90}")));
}
void jog_holds_other_channels_after_release() {
  Harness h;
  h.calibrate();
  h.send("{\"t\":\"target\",\"f\":[0.5,0.5,0.5],\"v\":1}");
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
  TEST_ASSERT_EQUAL_INT(static_cast<int>(ErrorCode::State),
                        static_cast<int>(h.send("{\"t\":\"target\",\"f\":[1,1,1],\"v\":1}")));
  TEST_ASSERT_EQUAL_INT(static_cast<int>(ErrorCode::State),
                        static_cast<int>(h.send("{\"t\":\"follow\",\"f\":[1,1,1]}")));
  TEST_ASSERT_EQUAL_INT(0, static_cast<int>(h.send("{\"t\":\"jog\",\"i\":1,\"deg\":95}")));
  h.send("{\"t\":\"release\"}");
  Harness live;
  live.calibrate();
  live.send("{\"t\":\"target\",\"f\":[1,1,1],\"v\":1}");
  live.safety.current(std::numeric_limits<float>::quiet_NaN(), 5);
  TEST_ASSERT_EQUAL_INT(static_cast<int>(State::Fault), static_cast<int>(live.safety.state()));
}
void current_limit_is_clamped_in_any_state() {
  Harness h;
  h.send("{\"t\":\"limit\",\"ma\":-10}");
  TEST_ASSERT_EQUAL_FLOAT(100, h.safety.info().limit);
  h.safety.stopPressed(0);
  h.send("{\"t\":\"limit\",\"ma\":10000}");
  TEST_ASSERT_EQUAL_FLOAT(1400, h.safety.info().limit);
}
void timers_survive_millis_wrap() {
  Harness h(true, UINT32_MAX - 500);
  h.calibrate();
  h.send("{\"t\":\"target\",\"f\":[1,1,1],\"v\":1}");
  h.advance(995, 0, false);
  TEST_ASSERT_EQUAL_INT(static_cast<int>(State::Run), static_cast<int>(h.safety.state()));
  h.advance(5, 0, false);
  TEST_ASSERT_TRUE(h.saw(EventKind::Watchdog));
  Harness c(true, UINT32_MAX - 50);
  c.calibrate();
  c.send("{\"t\":\"target\",\"f\":[1,1,1],\"v\":1}");
  c.safety.current(1000, UINT32_MAX - 50);
  c.safety.current(1000, 49);
  TEST_ASSERT_TRUE(c.saw(EventKind::Overcurrent));
}
void filtered_spike_is_rejected_and_sustained_load_trips() {
  CurrentFilter f;
  TEST_ASSERT_EQUAL_FLOAT(0, f.update(0));
  TEST_ASSERT_EQUAL_FLOAT(1000, f.update(4000));
  TEST_ASSERT_EQUAL_FLOAT(1500, f.update(0));
  Harness h;
  h.calibrate();
  h.send("{\"t\":\"target\",\"f\":[1,1,1],\"v\":1}");
  CurrentFilter spike;
  spike.update(0);
  for (uint32_t time = 5; time <= 300; time += 5)
    h.safety.current(spike.update(time == 5 ? 4000 : 0), time);
  TEST_ASSERT_FALSE(h.saw(EventKind::Overcurrent));
  CurrentFilter sustained;
  sustained.update(0);
  for (uint32_t time = 400; time <= 550; time += 5) h.safety.current(sustained.update(1200), time);
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
  Telemetry t{0, {{0, 0.5F, 1}}, 0, State::Run, Mode::Follow, {}};
  const auto follow = ringFrame(t);
  TEST_ASSERT_EQUAL_HEX32(0, follow[0]);
  for (int i = 8; i < 12; ++i) TEST_ASSERT_EQUAL_HEX32(0x2F6FEB, follow[i]);
  for (int i = 12; i < 16; ++i) TEST_ASSERT_EQUAL_HEX32(0, follow[i]);
  for (int i = 16; i < 24; ++i) TEST_ASSERT_EQUAL_HEX32(0x2F6FEB, follow[i]);
  t.md = Mode::Target;
  TEST_ASSERT_EQUAL_HEX32(0xE8890C, ringFrame(t)[16]);
  t.st = State::Calib;
  TEST_ASSERT_EQUAL_HEX32(0xFFBF00, ringFrame(t)[16]);
  t.st = State::Idle;
  TEST_ASSERT_EQUAL_HEX32(0x202020, ringFrame(t)[16]);
  t.st = State::Fault;
  for (auto time : {0U, 249U, 500U, 999U}) {
    t.ms = time;
    for (auto color : ringFrame(t))
      TEST_ASSERT_EQUAL_HEX32((time / 250) % 2 == 0 ? 0xC62828 : 0, color);
  }
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

// Firmware receives host commands only. Device fixture lines are independently
// decoded, reconstructed through the firmware encoders, and compared by value.
void checkDeviceFixture(JsonDocument& input, char* output, std::size_t capacity) {
  const char* type = input["t"];
  std::size_t size = 0;
  if (std::strcmp(type, "tel") == 0) {
    Telemetry t;
    t.ms = input["ms"];
    t.ma = input["ma"];
    for (std::size_t i = 0; i < 3; ++i) {
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
    for (std::size_t i = 0; i < 3; ++i)
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
  TEST_ASSERT_TRUE(input.as<JsonVariantConst>() == formatted.as<JsonVariantConst>());
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
          for (std::size_t i = 0; i < 3; ++i)
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
  RUN_TEST(boot_detaches_and_never_reuses_calibration);
  RUN_TEST(moves_need_all_three_calibrations);
  RUN_TEST(target_speed_cap_and_position_clamps);
  RUN_TEST(requested_slow_speed_and_no_catchup_jump);
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
  RUN_TEST(timers_survive_millis_wrap);
  RUN_TEST(filtered_spike_is_rejected_and_sustained_load_trips);
  RUN_TEST(stop_debounce_latches_pulses_and_requires_stable_release);
  RUN_TEST(serial_overflow_recovers_and_queue_handles_partial_writes);
  RUN_TEST(ring_segments_colors_and_blink_are_deterministic);
  RUN_TEST(event_backpressure_preserves_safety_reserve);
  RUN_TEST(shared_serial_fixtures_match_expected);
  return UNITY_END();
}
