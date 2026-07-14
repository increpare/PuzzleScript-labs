#pragma once

#include <cstddef>
#include <cstdint>

namespace pocket_card {
inline constexpr const char* kBoardName = "ES3C28P";
inline constexpr int kDisplayWidth = 320;
inline constexpr int kDisplayHeight = 240;
} // namespace pocket_card

namespace ps_probe {

inline constexpr int kNativeWidth = pocket_card::kDisplayWidth;
inline constexpr int kNativeHeight = pocket_card::kDisplayHeight;
inline constexpr int kTargetWidth = kNativeWidth;
inline constexpr int kTargetHeight = kNativeHeight;
inline constexpr int kRgb565BytesPerPixel = 2;
inline constexpr std::size_t kTargetFramebufferBytes =
    static_cast<std::size_t>(kTargetWidth) * kTargetHeight * kRgb565BytesPerPixel;
inline constexpr std::size_t kNativeFramebufferBytes =
    static_cast<std::size_t>(kNativeWidth) * kNativeHeight * kRgb565BytesPerPixel;

} // namespace ps_probe
