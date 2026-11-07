#include <Arduino.h>
#include <esp_log.h>

#include <algorithm>
#include <cassert>

#include "hal_current.h"
#include "hal_ring.h"
#include "hal_servo.h"
#include "hal_stop.h"
#include "serial_buffer.h"

using namespace rehab;

namespace {
TxQueue output;
LineReader input;
hal::ServoOut servos;
hal::CurrentSensor currentSensor;
hal::StopButton stop;
hal::Ring ring;
char line[config::MAX_LINE_BYTES + 2];
uint32_t lastControl = 0;
uint32_t lastTelemetry = 0;
bool releaseEdgePending = false;

void eventSink(void*, const Event& event) {
  const auto size = protocol::format(event, line, sizeof(line));
  // Commands leave four slots reserved. A held STOP cannot generate another
  // press; release edges wait for space. Sensor loss/watchdog each latch once.
  const bool queued = output.enqueue(line, size);
  assert(queued);  // Invariant: safety events are never discarded.
  (void)queued;
}
SafetyController safety{eventSink};

void flushOutput() {
  // One writer; write at most the UART driver's advertised free space, with a
  // bounded 402-byte budget. No flush(), blocking print(), String, or waits.
  std::size_t budget = 2 * (config::MAX_LINE_BYTES + 1);
  while (!output.empty() && budget) {
    const int available = Serial.availableForWrite();
    if (available <= 0) return;
    const auto count = std::min({output.size(), static_cast<std::size_t>(available), budget});
    const auto written = Serial.write(reinterpret_cast<const uint8_t*>(output.data()), count);
    if (!written) return;
    output.consume(written);
    budget -= written;
  }
}
void sendError(const char* command, ErrorCode why) {
  const auto size = protocol::formatError(command, why, line, sizeof(line));
  const bool queued = output.enqueue(line, size);
  assert(queued);
  (void)queued;
}
void sendInfo() {
  const auto size = protocol::format(safety.info(), line, sizeof(line));
  const bool queued = output.enqueue(line, size);
  assert(queued);
  (void)queued;
}
void readSerial(uint32_t now) {
  if (output.free() <= TxQueue::SAFETY_RESERVE) return;
  // At most 64 bytes and one parse per tick: bounded work under serial flooding.
  for (std::size_t bytes = 0; bytes < 64 && Serial.available(); ++bytes) {
    const auto result = input.feed(static_cast<char>(Serial.read()));
    if (result == LineReader::Result::None) continue;
    if (result == LineReader::Result::TooLong) {
      sendError("", ErrorCode::BadJson);
      return;
    }
    const auto parsed = protocol::parse(input.data(), input.size());
    if (!parsed) {
      if (parsed.error == ErrorCode::BadArgs && parsed.command.type == CommandType::Calib)
        safety.handle(parsed.command, now);  // Invalidate a rejected finger range; no keepalive.
      sendError(parsed.type, parsed.error);
      return;
    }
    const auto why = safety.handle(parsed.command, now);
    if (why != ErrorCode::None)
      sendError(parsed.type, why);
    else if (parsed.command.type == CommandType::Hello)
      sendInfo();
    return;
  }
}
void controlTick(uint32_t now) {
#ifdef REHAB_TIMING_PIN
  digitalWrite(REHAB_TIMING_PIN, HIGH);
#endif
  // 1. STOP precedes every command, even a release received in this tick.
  const auto edges = stop.poll(now);
  if (edges.pressed) {
    safety.stopPressed(now);
    releaseEdgePending = false;
  }
  if (edges.released) releaseEdgePending = true;
  if (stop.low()) releaseEdgePending = false;
  if (releaseEdgePending && output.free() > TxQueue::SAFETY_RESERVE) {
    safety.stopReleased();
    releaseEdgePending = false;
  }
  // 2. Serial. 3. Filtered current. 4. Watchdog. 5/6. Ramps and detach.
  readSerial(now);
  safety.current(currentSensor.read(), now);
  safety.tick(now);
  servos.apply(safety);
  // 7. Events/replies take priority; telemetry is expendable under backpressure.
  flushOutput();
  const auto telemetry = safety.telemetry(now);
  if (static_cast<uint32_t>(now - lastTelemetry) >= 1000 / config::TEL_HZ) {
    lastTelemetry = now;
    const auto size = protocol::format(telemetry, line, sizeof(line));
    if (size && output.empty() && Serial.availableForWrite() >= static_cast<int>(size))
      Serial.write(reinterpret_cast<const uint8_t*>(line), size);
  }
  // 8. RMT is asynchronous and limited to <=30 Hz.
  ring.update(telemetry);
#ifdef REHAB_TIMING_PIN
  digitalWrite(REHAB_TIMING_PIN, LOW);
#endif
}
}  // namespace

void setup() {
  // SDK diagnostic printf must not block the control task or interleave JSON.
  esp_log_level_set("*", ESP_LOG_NONE);
  // Every driver allocation and buffer reservation happens before control starts.
  Serial.setRxBufferSize(1024);
  Serial.setTxBufferSize(1024);
  Serial.begin(config::BAUD);
#ifdef REHAB_TIMING_PIN
  pinMode(REHAB_TIMING_PIN, OUTPUT);
  digitalWrite(REHAB_TIMING_PIN, LOW);
#endif
  servos.begin();  // GPIOs remain low and PWM is detached at boot.
  stop.begin();
  const bool sensorAvailable = currentSensor.begin();
  ring.begin();
  const auto now = millis();
  safety.begin(sensorAvailable, now);
  if (stop.low()) safety.stopPressed(now);
  sendInfo();
  flushOutput();
  lastControl = lastTelemetry = now;
}
void loop() {
  const auto now = millis();
  if (static_cast<uint32_t>(now - lastControl) < config::CONTROL_MS) return;
  lastControl = now;  // Never run catch-up ticks with stale sensor/time samples.
  controlTick(now);
}
