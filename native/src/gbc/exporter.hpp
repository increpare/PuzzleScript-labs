#pragma once

#include "runtime/core.hpp"
#include "compiler/compact_turn_codegen.hpp"

#include <filesystem>
#include <vector>

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
    bool singlePlayerCellCertified = false;
    std::filesystem::path generatedPath;
};

SpecializedTurnExportInfo writeSpecializedTurnArtifacts(
    const Game& game,
    const std::filesystem::path& outputDirectory,
    bool singlePlayerCellCertified = false,
    const std::vector<compiler::GbcSpecializedPatternEmit>& patterns = {},
    const std::vector<compiler::GbcSpecializedRuleEmit>& rules = {},
    const std::vector<compiler::GbcSpecializedGroupEmit>& earlyGroups = {},
    const std::vector<compiler::GbcSpecializedGroupEmit>& lateGroups = {});

ExportResult exportGame(const ExportOptions& options);

} // namespace puzzlescript::gbc
