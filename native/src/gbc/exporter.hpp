#pragma once

#include <filesystem>

namespace puzzlescript::gbc {

struct ExportOptions {
    std::filesystem::path sourcePath;
    std::filesystem::path outputDirectory;
};

struct ExportResult {
    std::filesystem::path manifestPath;
    std::filesystem::path generatedHeaderPath;
    std::filesystem::path generatedSourcePath;
};

ExportResult exportGame(const ExportOptions& options);

} // namespace puzzlescript::gbc
