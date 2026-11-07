#include "hal_current.h"

#include <Wire.h>
#include <driver/i2c.h>

#include <limits>

namespace rehab::hal {
bool CurrentSensor::begin() {
  Wire.begin(config::INA_SDA, config::INA_SCL, 400000);
  Wire.setTimeOut(1);  // A wedged bus cannot block STOP/watchdog for the default 50 ms.
  available_ = sensor_.begin(&Wire);
  Wire.setClock(400000);
  if (available_) {
    sensor_.setCalibration_32V_2A();
    sensor_.getCurrent_mA();  // Warm/check the library path during setup only.
    available_ = sensor_.success();
  }
  return available_;
}
float CurrentSensor::read() {
  if (!available_) return std::numeric_limits<float>::quiet_NaN();
  // Same calibration/scaling as Adafruit getCurrent_mA(), combined into one
  // static IDF command with ONE 1 ms deadline. The library does two separate
  // transactions, each with its own timeout, which could exceed our tick budget.
  // Wire owns I2C0; no other task or device uses this bus after setup.
  uint8_t storage[I2C_LINK_RECOMMENDED_SIZE(3)]{};
  auto command = i2c_cmd_link_create_static(storage, sizeof(storage));
  const uint8_t calibration[] = {INA219_REG_CALIBRATION, 0x10, 0x00};  // 4096
  const uint8_t currentRegister = INA219_REG_CURRENT;
  uint8_t bytes[2]{};
  esp_err_t status = command ? ESP_OK : ESP_ERR_NO_MEM;
  auto step = [&status](esp_err_t result) {
    if (status == ESP_OK) status = result;
  };
  if (command) {
    step(i2c_master_start(command));
    step(i2c_master_write_byte(command, config::INA_ADDRESS << 1, true));
    step(i2c_master_write(command, calibration, sizeof(calibration), true));
    step(i2c_master_start(command));
    step(i2c_master_write_byte(command, config::INA_ADDRESS << 1, true));
    step(i2c_master_write(command, &currentRegister, 1, true));
    step(i2c_master_start(command));
    step(i2c_master_write_byte(command, (config::INA_ADDRESS << 1) | 1, true));
    step(i2c_master_read(command, bytes, sizeof(bytes), I2C_MASTER_LAST_NACK));
    step(i2c_master_stop(command));
    if (status == ESP_OK) status = i2c_master_cmd_begin(I2C_NUM_0, command, pdMS_TO_TICKS(1));
    i2c_cmd_link_delete_static(command);
  }
  if (status != ESP_OK) {
    available_ = false;  // Fail closed until reset, including runtime sensor loss.
    return std::numeric_limits<float>::quiet_NaN();
  }
  const auto raw = static_cast<int16_t>((static_cast<uint16_t>(bytes[0]) << 8) | bytes[1]);
  const float sample = static_cast<float>(raw) / 10.0F;  // 100 uA/LSB, signed mA.
  return filter_.update(sample);
}
}  // namespace rehab::hal
