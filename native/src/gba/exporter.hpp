#pragma once

#include <filesystem>
#include <string>

namespace puzzlescript::gba {

struct ExportOptions {
    std::filesystem::path sourcePath;
    std::filesystem::path outputDirectory;
    std::filesystem::path titleImagePath;
    std::string mmutilExecutable = "mmutil";
    bool runMmutil = true;
    // When true (default), apply the unlit-LCD contrast path (white clear, lifts, etc.).
    bool lcdContrast = true;
};

struct ExportResult {
    std::filesystem::path manifestPath;
    std::filesystem::path generatedHeaderPath;
    std::filesystem::path generatedSourcePath;
    std::filesystem::path generatedRulesPath;
    std::filesystem::path soundbankPath;
    bool soundbankGenerated = false;
};

ExportResult exportGame(const ExportOptions& options);

} // namespace puzzlescript::gba
