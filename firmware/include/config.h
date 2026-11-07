#pragma once

#include <cstddef>
#include <cstdint>

#ifndef REHAB_LIMIT_DEFAULT_MA
#define REHAB_LIMIT_DEFAULT_MA 1500
#endif
#ifndef REHAB_LIMIT_MAX_MA
#define REHAB_LIMIT_MAX_MA 2200
#endif

namespace rehab::config {
inline constexpr char FW_VERSION[] = "0.1.0";
inline constexpr std::size_t FINGERS = 5;
inline constexpr float HARD_MIN = 5.0F;
inline constexpr float HARD_MAX = 175.0F;
inline constexpr float V_MAX = 1.0F;
inline constexpr float V_FOLLOW = 1.5F;
inline constexpr float V_RELEASE = 3.0F;
inline constexpr float V_JOG_DEG = 60.0F;
inline constexpr float FOLLOW_SLACK = 0.05F;
inline constexpr float LIMIT_MIN_MA = 100.0F;
inline constexpr float LIMIT_DEFAULT_MA = REHAB_LIMIT_DEFAULT_MA;
inline constexpr float LIMIT_MAX_MA = REHAB_LIMIT_MAX_MA;
static_assert(LIMIT_MIN_MA <= LIMIT_DEFAULT_MA && LIMIT_DEFAULT_MA <= LIMIT_MAX_MA &&
                  LIMIT_MAX_MA <= 2200.0F,
              "Current overrides must stay within 100..2200 mA and default <= max");

struct ServoProfile {
  const char* model;
  float idle_ma;
  float moving_ma;
  float stall_ma;
  float max_speed_deg_s;
};
// ALL values are placeholders, TO BE MEASURED on the team's actual servos at 5 V.
// Order: thumb, index, middle, ring, pinky. Speeds are unloaded mechanical rates,
// not motion permissions: V_MAX/V_FOLLOW/V_RELEASE/V_JOG_DEG still govern ramps.
// One INA219 measures only the total; these estimates must never bypass its limit.
inline constexpr ServoProfile SERVO_PROFILES[FINGERS] = {
    {"Unknown thumb (identify on bench)", 20, 250, 650, 300},
    {"TowerPro SG92R", 20, 300, 800, 600},
    {"MG90S", 20, 250, 750, 500},
    {"Smraza S51", 15, 200, 650, 500},
    {"Smraza S51", 15, 200, 650, 500},
};
inline constexpr uint32_t OVERCURRENT_MS = 100;
inline constexpr uint32_t WATCHDOG_MS = 1000;
inline constexpr uint32_t TEL_HZ = 50;
inline constexpr uint32_t CONTROL_HZ = 200;
inline constexpr uint32_t CONTROL_MS = 1000 / CONTROL_HZ;
inline constexpr uint32_t DETACH_MS = 500;
inline constexpr uint32_t STOP_DEBOUNCE_MS = 20;
inline constexpr std::size_t MAX_LINE_BYTES = 200;
inline constexpr std::size_t LINE_BUFFER_BYTES = 256;
inline constexpr int SERVO_PINS[FINGERS] = {25, 26, 27, 13, 4};
inline constexpr int RING_PIN = 33;
inline constexpr int INA_SDA = 21;
inline constexpr int INA_SCL = 22;
inline constexpr uint8_t INA_ADDRESS = 0x40;
inline constexpr int STOP_PIN = 32;
inline constexpr int RING_PIXELS = 24;
inline constexpr uint32_t RING_MS = 34;  // <= 30 Hz
inline constexpr uint32_t BAUD = 115200;
}  // namespace rehab::config

#ifdef REHAB_TIMING_PIN
// Free output pins on this WROOM-32 pin map. In particular, GPIO4 is now pinky.
static_assert(REHAB_TIMING_PIN == 16 || REHAB_TIMING_PIN == 17 || REHAB_TIMING_PIN == 18 ||
                  REHAB_TIMING_PIN == 19 || REHAB_TIMING_PIN == 23,
              "Timing probe must use an unused output pin (16/17/18/19/23)");
#endif
