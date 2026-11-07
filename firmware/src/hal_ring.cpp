#include "hal_ring.h"

#include "ring_frame.h"

namespace rehab::hal {
void Ring::begin() {
  pixels_.begin();
  pixels_.setBrightness(51);  // 20% of 255; supply is shared with the servos.
  rmt_config_t config = RMT_DEFAULT_CONFIG_TX(static_cast<gpio_num_t>(config::RING_PIN), CHANNEL);
  config.clk_div = 2;  // 40 MHz, 25 ns/tick.
  // Adafruit's Arduino-ESP32 2.x show() reinstalls a driver each frame. Use its
  // color buffer with a persistent RMT driver and static transmission items.
  ready_ = rmt_config(&config) == ESP_OK && rmt_driver_install(CHANNEL, 0, 0) == ESP_OK;
}
void Ring::update(const Telemetry& telemetry) {
  if (!ready_ || static_cast<uint32_t>(telemetry.ms - last_) < config::RING_MS ||
      rmt_wait_tx_done(CHANNEL, 0) != ESP_OK)
    return;
  last_ = telemetry.ms;
  const auto frame = ringFrame(telemetry);
  for (std::size_t i = 0; i < frame.size(); ++i) pixels_.setPixelColor(i, frame[i]);
  const uint8_t* bytes = pixels_.getPixels();
  for (std::size_t bit = 0; bit < config::RING_PIXELS * 24; ++bit) {
    const bool one = (bytes[bit / 8] & (0x80 >> (bit % 8))) != 0;
    items_[bit].level0 = 1;
    items_[bit].duration0 = one ? 32 : 16;
    items_[bit].level1 = 0;
    items_[bit].duration1 = one ? 18 : 34;
  }
  auto& reset = items_[config::RING_PIXELS * 24];
  reset.level0 = reset.level1 = 0;
  reset.duration0 = reset.duration1 = 3200;  // 160 us low latch.
  rmt_write_items(CHANNEL, items_, config::RING_PIXELS * 24 + 1, false);
}
}  // namespace rehab::hal
