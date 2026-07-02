#pragma once

#include "generator/keeper.hpp"
#include "generator/level_rows.hpp"
#include "runtime/core.hpp"

#include <chrono>
#include <filesystem>
#include <mutex>
#include <optional>
#include <string>
#include <vector>

namespace puzzlescript::generator {

std::string replaceLevelsSection(const std::string& source, const std::string& levelBody);

std::string appendLegendEntries(const std::string& source, const std::vector<SupplementalGlyph>& glyphs);

std::string renderGameWithLevels(
    const std::string& gameSource,
    const Game& game,
    const std::vector<Keeper>& keepersInOrder);

void writeGameAtomically(const std::filesystem::path& path, const std::string& content);

class OutputCoordinator {
public:
    explicit OutputCoordinator(
        std::filesystem::path outPath,
        std::string gameSource,
        const Game& game);

    void notifyImprovement(const std::vector<Keeper>& keepersInOrder);
    void flush();

private:
    using Clock = std::chrono::steady_clock;
    using TimePoint = Clock::time_point;

    void maybeWriteLocked(TimePoint now, bool force);

    std::filesystem::path outPath_;
    std::string gameSource_;
    const Game& game_;
    std::mutex writeMutex_;
    std::optional<std::string> pendingContent_;
    TimePoint lastWrite_{};
    static constexpr int64_t kDebounceMs = 500;
};

} // namespace puzzlescript::generator
