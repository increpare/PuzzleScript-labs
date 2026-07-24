#pragma once

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

ExportResult exportGame(const ExportOptions& options);

} // namespace puzzlescript::gbc
