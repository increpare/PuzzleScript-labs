#pragma once

#include "runtime/core.hpp"
#include "compiler/compact_turn_codegen.hpp"

#include <cstdint>
#include <filesystem>
#include <string>
#include <vector>

namespace puzzlescript::gbc {

struct ExportOptions {
    std::filesystem::path sourcePath;
    std::filesystem::path outputDirectory;
    bool cullOversizeLevels = false;
    bool emitSpecializedTurn = true;
    // Prefix applied to every per-game entry point so several games can be
    // linked into one cartridge without symbol collisions. Empty means the
    // export is standalone and no renaming happens.
    std::string symbolPrefix;
    uint8_t bankBase = 2U;
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
    unsigned highestBank = 0U;
    std::filesystem::path generatedPath;
    std::vector<std::filesystem::path> generatedSourcePaths;
};

SpecializedTurnExportInfo writeSpecializedTurnArtifacts(
    const Game& game,
    const std::filesystem::path& outputDirectory,
    bool singlePlayerCellCertified = false,
    const std::vector<compiler::GbcSpecializedPatternEmit>& patterns = {},
    const std::vector<compiler::GbcSpecializedRuleEmit>& rules = {},
    const std::vector<compiler::GbcSpecializedGroupEmit>& earlyGroups = {},
    const std::vector<compiler::GbcSpecializedGroupEmit>& lateGroups = {},
    const compiler::GbcSpecializedTurnEmitOptions& emitOptions = {});

ExportResult exportGame(const ExportOptions& options);

} // namespace puzzlescript::gbc
