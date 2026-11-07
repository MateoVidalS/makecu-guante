#pragma once

#include <cstddef>
#include <cstdint>

namespace rehab::config {
inline constexpr char FW_VERSION[] = "0.1.0";
inline constexpr std::size_t FINGERS = 3;
inline constexpr float HARD_MIN = 5.0F;
inline constexpr float HARD_MAX = 175.0F;
inline constexpr float V_MAX = 1.0F;
inline constexpr float V_FOLLOW = 1.5F;
inline constexpr float V_RELEASE = 3.0F;
inline constexpr float V_JOG_DEG = 60.0F;
inline constexpr float FOLLOW_SLACK = 0.05F;
inline constexpr float LIMIT_MIN_MA = 100.0F;
inline constexpr float LIMIT_DEFAULT_MA = 900.0F;
inline constexpr float LIMIT_MAX_MA = 1400.0F;
inline constexpr uint32_t OVERCURRENT_MS = 100;
inline constexpr uint32_t WATCHDOG_MS = 1000;
inline constexpr uint32_t TEL_HZ = 50;
inline constexpr uint32_t CONTROL_HZ = 200;
inline constexpr uint32_t CONTROL_MS = 1000 / CONTROL_HZ;
inline constexpr uint32_t DETACH_MS = 500;
inline constexpr uint32_t STOP_DEBOUNCE_MS = 20;
inline constexpr std::size_t MAX_LINE_BYTES = 200;
inline constexpr std::size_t LINE_BUFFER_BYTES = 256;
inline constexpr int SERVO_PINS[FINGERS] = {25, 26, 27};
inline constexpr int RING_PIN = 33;
inline constexpr int INA_SDA = 21;
inline constexpr int INA_SCL = 22;
inline constexpr uint8_t INA_ADDRESS = 0x40;
inline constexpr int STOP_PIN = 32;
inline constexpr int RING_PIXELS = 24;
inline constexpr uint32_t RING_MS = 34;  // <= 30 Hz
inline constexpr uint32_t BAUD = 115200;
}  // namespace rehab::config
