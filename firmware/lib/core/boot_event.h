#pragma once

#include <cstddef>
#include <cstdint>

namespace rehab::protocol {
// Local additive boot-event extension; the frozen Event struct is unchanged.
// resetReason is the numeric esp_reset_reason_t returned by esp_reset_reason().
// Same newline, capacity and length rules as the ordinary protocol encoders.
std::size_t formatBoot(uint32_t resetReason, char* out, std::size_t capacity);
}  // namespace rehab::protocol
