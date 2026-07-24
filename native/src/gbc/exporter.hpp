#pragma once

#include "runtime/core.hpp"

#include <filesystem>

namespace puzzlescript::gbc {

struct ExportOptions {
    std::filesystem::path sourcePath;
    std::filesystem::path outputDirectory;
    bool cullOversizeLevels = false;
};

struct ExportResult {
    std::filesystem::path manifestPath;
    std::filesystem::path generatedHeaderPath;
    std::filesystem::path generatedSourcePath;
    std::filesystem::path generatedSpecializedTurnPath;
};

struct SpecializedTurnExportInfo {
    bool supported = false;
    std::filesystem::path generatedPath;
};

SpecializedTurnExportInfo writeSpecializedTurnArtifacts(
    const Game& game,
    const std::filesystem::path& outputDirectory);

ExportResult exportGame(const ExportOptions& options);

} // namespace puzzlescript::gbc
