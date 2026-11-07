#pragma once

#include <array>
#include <cstring>

#include "config.h"

namespace rehab {
class LineReader {
 public:
  enum class Result { None, Line, TooLong };
  Result feed(char byte) {
    if (byte != '\n') {
      if (used_ < config::MAX_LINE_BYTES + 1)
        buffer_[used_++] = byte;
      else
        overflow_ = true;
      return Result::None;
    }
    if (used_ && buffer_[used_ - 1] == '\r') --used_;
    size_ = used_;
    buffer_[used_] = '\0';
    const bool bad = overflow_ || used_ > config::MAX_LINE_BYTES;
    used_ = 0;
    overflow_ = false;
    return bad ? Result::TooLong : Result::Line;
  }
  const char* data() const { return buffer_.data(); }
  std::size_t size() const { return size_; }

 private:
  std::array<char, config::LINE_BUFFER_BYTES> buffer_{};
  std::size_t used_ = 0;
  std::size_t size_ = 0;
  bool overflow_ = false;
};

class TxQueue {
 public:
  static constexpr std::size_t CAPACITY = 16;
  static constexpr std::size_t SAFETY_RESERVE = 4;
  bool enqueue(const char* data, std::size_t size) {
    if (!data || !size || size > config::MAX_LINE_BYTES + 1 || free() == 0) return false;
    auto& line = lines_[(head_ + count_) % CAPACITY];
    std::memcpy(line.data.data(), data, size);
    line.size = size;
    ++count_;
    return true;
  }
  std::size_t free() const { return CAPACITY - count_; }
  bool empty() const { return count_ == 0; }
  const char* data() const { return empty() ? nullptr : lines_[head_].data.data() + offset_; }
  std::size_t size() const { return empty() ? 0 : lines_[head_].size - offset_; }
  void consume(std::size_t size) {
    if (size > this->size() || empty()) return;
    offset_ += size;
    if (offset_ == lines_[head_].size) {
      head_ = (head_ + 1) % CAPACITY;
      --count_;
      offset_ = 0;
    }
  }

 private:
  struct Line {
    std::array<char, config::MAX_LINE_BYTES + 2> data{};
    std::size_t size = 0;
  };
  std::array<Line, CAPACITY> lines_{};
  std::size_t head_ = 0;
  std::size_t count_ = 0;
  std::size_t offset_ = 0;
};
}  // namespace rehab
