#pragma once

#include <cstddef>
#include <cstdint>
#include <iosfwd>
#include <string>
#include <string_view>
#include <vector>

#include "runtime/core.hpp"

namespace puzzlescript::compiler {

enum class CompactCodegenTarget {
    NativeCpp,
    GbdC,
};

struct CompactCodegenOptions {
    CompactCodegenTarget target = CompactCodegenTarget::NativeCpp;
    bool interpreterMode = false;
    bool externalBoardStorage = false;
    bool externalSnapshotStorage = false;
    bool externalObjectCellIndexStorage = false;
    bool enableObjectCellIndex = true;
    bool enableMovementCellIndex = true;
};

enum class CompactTurnBackendKind {
    Unsupported,
    NativeKernel,
    InterpreterBridge,
};

struct CompactTurnSupport {
    CompactTurnBackendKind backendKind = CompactTurnBackendKind::Unsupported;
    std::string statusReason = "native_compact_generator_rebuild";
    std::string nativeKernelStatusReason = "native_compact_generator_rebuild";

    bool supported() const {
        return backendKind != CompactTurnBackendKind::Unsupported;
    }

    bool nativeKernel() const {
        return backendKind == CompactTurnBackendKind::NativeKernel;
    }

    bool usesInterpreterBridge() const {
        return backendKind == CompactTurnBackendKind::InterpreterBridge;
    }
};

CompactTurnSupport compactNativeTurnSupportForGame(const Game& game);
CompactTurnSupport compactTurnSupportForGame(const Game& game, const CompactCodegenOptions& options);
CompactTurnSupport compactTurnSupportForGame(const Game& game);

void emitCompactTurnBackend(
    std::ostream& out,
    const Game& game,
    std::string_view sourcePath,
    uint64_t sourceHash,
    size_t sourceIndex,
    CompactCodegenOptions options);

struct GbcSpecializedPatternEmit {
    uint32_t objectsPresent = 0;
    uint32_t objectsMissing = 0;
    uint32_t movementsPresent = 0;
    uint32_t movementsMissing = 0;
    uint32_t objectsClear = 0;
    uint32_t objectsSet = 0;
    uint32_t movementsClear = 0;
    uint32_t movementsSet = 0;
    uint32_t movementLayerMask = 0;
    uint8_t flags = 0;
};

struct GbcSpecializedRuleEmit {
    uint16_t firstPattern = 0;
    uint8_t patternCount = 0;
    uint8_t direction = 0;
    uint8_t commands = 0;
};

struct GbcSpecializedGroupEmit {
    uint16_t firstRule = 0;
    uint16_t ruleCount = 0;
    uint16_t inputLayout = 0;
    bool singlePass = false;
    int16_t loopTarget = -1;
};

void emitGbcSpecializedTurn(
    std::ostream& out,
    const Game& game,
    bool singlePlayerCellCertified,
    const std::vector<GbcSpecializedPatternEmit>& patterns,
    const std::vector<GbcSpecializedRuleEmit>& rules,
    const std::vector<GbcSpecializedGroupEmit>& earlyGroups,
    const std::vector<GbcSpecializedGroupEmit>& lateGroups);

bool gbcSpecializedResolveEligibleForGame(const Game& game);
bool gbcSpecializedWonEligibleForGame(const Game& game);

// Legacy entry used when packed tables are unavailable; emits walker fallback.
void emitGbcSpecializedTurn(
    std::ostream& out,
    const Game& game,
    bool singlePlayerCellCertified = false);

} // namespace puzzlescript::compiler
