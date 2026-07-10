#pragma once

#include <cstddef>
#include <cstdint>

namespace ps_probe {

inline constexpr int kNativeWidth = 1024;
inline constexpr int kNativeHeight = 600;
inline constexpr int kTargetWidth = 800;
inline constexpr int kTargetHeight = 480;
inline constexpr int kRgb565BytesPerPixel = 2;
inline constexpr std::size_t kNativeFramebufferBytes =
    static_cast<std::size_t>(kNativeWidth) * kNativeHeight * kRgb565BytesPerPixel;
inline constexpr std::size_t kTargetFramebufferBytes =
    static_cast<std::size_t>(kTargetWidth) * kTargetHeight * kRgb565BytesPerPixel;
inline constexpr const char* kSdMountPoint = "/sdcard";
inline constexpr const char* kSdGamesDir = "/sdcard/games";
inline constexpr const char* kSdCorpusDir = "/sdcard/corpus";
inline constexpr const char* kSdSimulationCorpusBundle = "/sdcard/corpus/CORPUS.NDJ";
inline constexpr const char* kFlashStorageMount = "/storage";
inline constexpr const char* kFlashSimulationCorpusBundle = "/storage/CORPUS.NDJ";
inline constexpr const char* kFlashGamesDir = "/storage/GAMES";
inline constexpr std::size_t kMaxSourceBytes = 1024 * 1024;

} // namespace ps_probe
