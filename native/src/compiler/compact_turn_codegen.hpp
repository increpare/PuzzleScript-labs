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

struct GbcSpecializedLayerCoupledLayerEmit {
    uint32_t objectMask = 0;
    uint32_t movementsAny = 0;
    uint32_t movementsPresent = 0;
    uint32_t movementsMissing = 0;
    int8_t layerIndex = 0;
};

struct GbcSpecializedLayerCoupledTermEmit {
    std::vector<GbcSpecializedLayerCoupledLayerEmit> layers;
    // Apply-side fields when packing from replacement.dynamic:
    uint32_t replacementMovementMask = 0;
    bool hasReplacementMovementMask = false;
    int8_t aggregateCaptureIndex = -1;
};

struct GbcSpecializedPropertyAliasEmit {
    uint32_t objectMask = 0;
    int8_t layerIndex = -1;
};

struct GbcSpecializedPropertyBindingEmit {
    int8_t sourceCell = 0;
    int8_t sourceMovementMode = 0;
    uint32_t sourceMovementMask = 0;
    std::vector<GbcSpecializedPropertyAliasEmit> aliases;
};

struct GbcSpecializedAggregateBindingEmit {
    int8_t sourceCell = 0;
    int8_t sourceLayer = -1;
    uint8_t aggregateMask = 0x1F;
    int8_t propertyBindingIndex = -1;
};

struct GbcSpecializedInferredAggregateEmit {
    int8_t layerIndex = -1;
    int8_t aggregateCaptureIndex = -1;
};

struct GbcSpecializedInferredPropertyEmit {
    int8_t propertyBindingIndex = -1;
    int8_t dirMode = 0;
    uint32_t dirMask = 0;
};

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
    std::vector<uint32_t> anyObjectMasks;
    std::vector<uint32_t> anyMovementMasks;
    std::vector<GbcSpecializedLayerCoupledTermEmit> layerCoupledMatchTerms;
    std::vector<GbcSpecializedLayerCoupledTermEmit> layerCoupledReplacementTerms;
    std::vector<GbcSpecializedInferredAggregateEmit> inferredAggregateBindings;
    std::vector<GbcSpecializedInferredPropertyEmit> inferredPropertyBindings;
    uint32_t rhsPropertyPreserveObjects = 0;
    bool hasRhsPropertyPreserveObjects = false;
};

struct GbcSpecializedRuleEmit {
    uint16_t firstPattern = 0;
    uint8_t patternCount = 0;
    uint8_t rowCount = 1;
    uint8_t rowPatternCounts[2] = {0, 0};
    uint8_t direction = 0;
    uint8_t commands = 0;
    std::vector<GbcSpecializedPropertyBindingEmit> propertyBindings;
    std::vector<GbcSpecializedAggregateBindingEmit> aggregateBindings;
};

struct GbcSpecializedGroupEmit {
    uint16_t firstRule = 0;
    uint16_t ruleCount = 0;
    uint16_t inputLayout = 0;
    bool singlePass = false;
    int16_t loopTarget = -1;
};

struct GbcSpecializedTurnSourceFile {
    std::string relativePath;
    std::string contents;
};

struct GbcSpecializedTurnEmitResult {
    std::vector<GbcSpecializedTurnSourceFile> files;
};

struct GbcSpecializedTurnEmitOptions {
    // Soft target for each rules bank when splitting is required.
    size_t rulePackSourceByteThreshold = 45000U;
    // Keep a single bank-3 TU (static rules, no BANKED stubs) when total rule
    // source stays under this. ~60KiB C ≈ ~10KiB ROM; above this, split.
    size_t singleFileMaxRuleSourceBytes = 60000U;
    unsigned mainBank = 3U;
    unsigned firstRulesBank = 4U;
};

GbcSpecializedTurnEmitResult emitGbcSpecializedTurnFiles(
    const Game& game,
    bool singlePlayerCellCertified,
    const std::vector<GbcSpecializedPatternEmit>& patterns,
    const std::vector<GbcSpecializedRuleEmit>& rules,
    const std::vector<GbcSpecializedGroupEmit>& earlyGroups,
    const std::vector<GbcSpecializedGroupEmit>& lateGroups,
    const GbcSpecializedTurnEmitOptions& options = {});

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
