#include "compiler/static_analysis.hpp"

#include <algorithm>
#include <cstdlib>
#include <iostream>

namespace puzzlescript::compiler {
namespace {

const MaskWord* maskPtr(const Game& game, MaskOffset offset) {
    if (offset == kNullMaskOffset || static_cast<size_t>(offset) >= game.maskArena.size()) {
        return nullptr;
    }
    return &game.maskArena[static_cast<size_t>(offset)];
}

bool hasBits(const MaskWord* mask, uint32_t wordCount) {
    if (mask == nullptr) {
        return false;
    }
    for (uint32_t word = 0; word < wordCount; ++word) {
        if (mask[word] != 0) {
            return true;
        }
    }
    return false;
}

bool maskHasObject(const Game& game, const MaskWord* mask, int32_t objectId) {
    if (mask == nullptr || objectId < 0) {
        return false;
    }
    const uint32_t word = maskWordIndex(static_cast<uint32_t>(objectId));
    if (word >= game.wordCount) {
        return false;
    }
    return (mask[word] & maskBit(static_cast<uint32_t>(objectId))) != 0;
}

void traceWrittenObject(const Game& game, int32_t objectId, const char* reason) {
    const char* traceName = std::getenv("PS_TRACE_STATIC_WRITTEN_OBJECT");
    if (traceName == nullptr
        || objectId < 0
        || objectId >= game.objectCount
        || game.objectsById[static_cast<size_t>(objectId)].name != traceName) {
        return;
    }
    std::cerr << "static-write object="
              << game.objectsById[static_cast<size_t>(objectId)].name
              << " id=" << objectId
              << " layer=" << game.objectsById[static_cast<size_t>(objectId)].layer
              << " reason=" << reason << "\n";
}

int32_t canonicalObjectIdByName(const Game& game, const std::string& name) {
    for (int32_t objectId = 0; objectId < game.objectCount; ++objectId) {
        const auto& object = game.objectsById[static_cast<size_t>(objectId)];
        if (object.name == name && object.layer >= 0) {
            return objectId;
        }
    }
    return -1;
}

int32_t movementLayerBits(const Game& game, const MaskWord* mask, int32_t layer) {
    if (mask == nullptr || layer < 0) {
        return 0;
    }
    const int32_t shift = 5 * layer;
    const int32_t word = shift / static_cast<int32_t>(kMaskWordBits);
    const int32_t bit = shift & static_cast<int32_t>(kMaskWordBitMask);
    MaskWordUnsigned result = 0;
    if (word < static_cast<int32_t>(game.movementWordCount)) {
        result = static_cast<MaskWordUnsigned>(mask[static_cast<size_t>(word)]) >> bit;
    }
    if (bit > static_cast<int32_t>(kMaskWordBits - 5U)
        && word + 1 < static_cast<int32_t>(game.movementWordCount)) {
        result |= static_cast<MaskWordUnsigned>(mask[static_cast<size_t>(word + 1)])
            << (kMaskWordBits - bit);
    }
    return static_cast<int32_t>(result & 0x1f);
}

bool objectCanCoexistWithObject(const Game& game, int32_t objectId, int32_t candidateId) {
    if (objectId == candidateId) {
        return true;
    }
    if (objectId < 0
        || candidateId < 0
        || objectId >= game.objectCount
        || candidateId >= game.objectCount) {
        return true;
    }
    const int32_t objectLayer = game.objectsById[static_cast<size_t>(objectId)].layer;
    const int32_t candidateLayer = game.objectsById[static_cast<size_t>(candidateId)].layer;
    return objectLayer < 0 || candidateLayer < 0 || objectLayer != candidateLayer;
}

bool maskHasCoexistingObject(const Game& game, const MaskWord* mask, int32_t objectId) {
    if (mask == nullptr) {
        return false;
    }
    for (int32_t candidateId = 0; candidateId < game.objectCount; ++candidateId) {
        if (maskHasObject(game, mask, candidateId)
            && objectCanCoexistWithObject(game, objectId, candidateId)) {
            return true;
        }
    }
    return false;
}

bool patternAnyObjectMaskHasObject(const Game& game, const Pattern& pattern, int32_t objectId) {
    for (uint32_t entry = 0; entry < pattern.anyObjectsCount; ++entry) {
        const MaskWord* anyMask =
            maskPtr(game, game.anyObjectOffsets[pattern.anyObjectsFirst + entry]);
        if (maskHasObject(game, anyMask, objectId)) {
            return true;
        }
    }
    return false;
}

bool patternHasObjectTerms(const Pattern& pattern) {
    return pattern.kind == Pattern::Kind::CellPattern
        && (pattern.hasObjectsPresent || pattern.anyObjectsCount > 0);
}

bool patternCanContainObject(const Game& game, const Pattern& pattern, int32_t objectId) {
    if (pattern.kind == Pattern::Kind::Ellipsis || objectId < 0 || objectId >= game.objectCount) {
        return true;
    }
    const MaskWord* objectsMissing = maskPtr(game, pattern.objectsMissing);
    if (maskHasObject(game, objectsMissing, objectId)) {
        return false;
    }
    const MaskWord* objectsPresent = maskPtr(game, pattern.objectsPresent);
    for (int32_t presentId = 0; presentId < game.objectCount; ++presentId) {
        if (maskHasObject(game, objectsPresent, presentId)
            && !objectCanCoexistWithObject(game, objectId, presentId)) {
            return false;
        }
    }
    for (uint32_t entry = 0; entry < pattern.anyObjectsCount; ++entry) {
        const MaskWord* anyMask =
            maskPtr(game, game.anyObjectOffsets[pattern.anyObjectsFirst + entry]);
        if (!maskHasCoexistingObject(game, anyMask, objectId)) {
            return false;
        }
    }
    return true;
}

void observeMaskObjectsOnLayer(
    const Game& game,
    const MaskWord* mask,
    int32_t layer,
    int32_t objectId,
    bool& hasPresentOnLayer,
    bool& includesObject) {
    if (mask == nullptr || layer < 0) {
        return;
    }
    for (int32_t candidateId = 0; candidateId < game.objectCount; ++candidateId) {
        if (!maskHasObject(game, mask, candidateId)
            || game.objectsById[static_cast<size_t>(candidateId)].layer != layer) {
            continue;
        }
        hasPresentOnLayer = true;
        if (candidateId == objectId) {
            includesObject = true;
        }
    }
}

bool patternCouldContainObjectBeforeJsFlow(
    const Game& game,
    const Pattern& pattern,
    int32_t objectId) {
    if (pattern.kind == Pattern::Kind::Ellipsis || objectId < 0 || objectId >= game.objectCount) {
        return true;
    }
    const MaskWord* objectsMissing = maskPtr(game, pattern.objectsMissing);
    if (maskHasObject(game, objectsMissing, objectId)) {
        return false;
    }
    const int32_t layer = game.objectsById[static_cast<size_t>(objectId)].layer;
    bool hasPresentOnLayer = false;
    bool includesObject = false;
    observeMaskObjectsOnLayer(
        game,
        maskPtr(game, pattern.objectsPresent),
        layer,
        objectId,
        hasPresentOnLayer,
        includesObject);
    for (uint32_t entry = 0; entry < pattern.anyObjectsCount; ++entry) {
        observeMaskObjectsOnLayer(
            game,
            maskPtr(game, game.anyObjectOffsets[pattern.anyObjectsFirst + entry]),
            layer,
            objectId,
            hasPresentOnLayer,
            includesObject);
    }
    return !hasPresentOnLayer || includesObject;
}

bool patternAnyObjectTermAllowsObjectIgnoringMissing(
    const Game& game,
    const Pattern& pattern,
    int32_t objectId) {
    if (pattern.kind == Pattern::Kind::Ellipsis
        || objectId < 0
        || objectId >= game.objectCount
        || !patternAnyObjectMaskHasObject(game, pattern, objectId)) {
        return false;
    }
    const MaskWord* objectsPresent = maskPtr(game, pattern.objectsPresent);
    for (int32_t presentId = 0; presentId < game.objectCount; ++presentId) {
        if (maskHasObject(game, objectsPresent, presentId)
            && !objectCanCoexistWithObject(game, objectId, presentId)) {
            return false;
        }
    }
    for (uint32_t entry = 0; entry < pattern.anyObjectsCount; ++entry) {
        const MaskWord* anyMask =
            maskPtr(game, game.anyObjectOffsets[pattern.anyObjectsFirst + entry]);
        if (!maskHasCoexistingObject(game, anyMask, objectId)) {
            return false;
        }
    }
    return true;
}

void addPossibleSetsToWrittenObjects(
    const Game& game,
    const Pattern& pattern,
    const MaskWord* objectsSet,
    MaskVector& writtenObjects,
    bool randomSet) {
    if (objectsSet == nullptr) {
        return;
    }
    for (int32_t objectId = 0; objectId < game.objectCount; ++objectId) {
        if (!maskHasObject(game, objectsSet, objectId)) {
            continue;
        }
        const uint32_t word = maskWordIndex(static_cast<uint32_t>(objectId));
        if (word >= game.wordCount) {
            continue;
        }
        if (!randomSet && maskHasObject(game, maskPtr(game, pattern.objectsPresent), objectId)) {
            continue;
        }
        traceWrittenObject(game, objectId, randomSet ? "random-set" : "set");
        writtenObjects[word] |= maskBit(static_cast<uint32_t>(objectId));
    }
}

void addLayerOverwriteClearsToWrittenObjects(
    const Game& game,
    const Pattern& pattern,
    const MaskWord* objectsSet,
    MaskVector& writtenObjects,
    int32_t lineNumber) {
    if (objectsSet == nullptr) {
        return;
    }
    for (int32_t createdId = 0; createdId < game.objectCount; ++createdId) {
        if (!maskHasObject(game, objectsSet, createdId)) {
            continue;
        }
        const int32_t layer = game.objectsById[static_cast<size_t>(createdId)].layer;
        if (layer < 0) {
            continue;
        }
        std::vector<int32_t> layerObjectIds;
        if (static_cast<size_t>(layer) < game.collisionLayers.size()) {
            for (const auto& name : game.collisionLayers[static_cast<size_t>(layer)]) {
                const int32_t objectId = canonicalObjectIdByName(game, name);
                if (objectId >= 0
                    && game.objectsById[static_cast<size_t>(objectId)].layer == layer
                    && std::find(layerObjectIds.begin(), layerObjectIds.end(), objectId)
                        == layerObjectIds.end()) {
                    layerObjectIds.push_back(objectId);
                }
            }
        }
        if (layerObjectIds.empty()) {
            for (int32_t objectId = 0; objectId < game.objectCount; ++objectId) {
                if (game.objectsById[static_cast<size_t>(objectId)].layer == layer) {
                    layerObjectIds.push_back(objectId);
                }
            }
        }
        for (const int32_t objectId : layerObjectIds) {
            if (objectId == createdId
                || maskHasObject(game, objectsSet, objectId)
                || patternAnyObjectMaskHasObject(game, pattern, objectId)
                || !patternCouldContainObjectBeforeJsFlow(game, pattern, objectId)) {
                continue;
            }
            const uint32_t word = maskWordIndex(static_cast<uint32_t>(objectId));
            if (word < game.wordCount) {
                const std::string reason = "layer-overwrite created="
                    + game.objectsById[static_cast<size_t>(createdId)].name
                    + " line=" + std::to_string(lineNumber);
                traceWrittenObject(game, objectId, reason.c_str());
                writtenObjects[word] |= maskBit(static_cast<uint32_t>(objectId));
            }
        }
    }
}

void addPossibleClearsToWrittenObjects(
    const Game& game,
    const Pattern& pattern,
    const MaskWord* objectsClear,
    const MaskWord* objectsSet,
    const MaskWord* rhsPropertyPreserveMask,
    MaskVector& writtenObjects) {
    if (objectsClear == nullptr) {
        return;
    }
    const MaskWord* objectsMissing = maskPtr(game, pattern.objectsMissing);
    for (int32_t objectId = 0; objectId < game.objectCount; ++objectId) {
        if (!maskHasObject(game, objectsClear, objectId)
            || maskHasObject(game, objectsSet, objectId)
            || maskHasObject(game, objectsMissing, objectId)
            || maskHasObject(game, rhsPropertyPreserveMask, objectId)) {
            continue;
        }
        const bool explicitlyPresent =
            maskHasObject(game, maskPtr(game, pattern.objectsPresent), objectId);
        if (!explicitlyPresent
            && !patternCouldContainObjectBeforeJsFlow(game, pattern, objectId)
            && !patternAnyObjectTermAllowsObjectIgnoringMissing(game, pattern, objectId)) {
            continue;
        }
        const uint32_t word = maskWordIndex(static_cast<uint32_t>(objectId));
        if (word < game.wordCount) {
            traceWrittenObject(game, objectId, "clear");
            writtenObjects[word] |= maskBit(static_cast<uint32_t>(objectId));
        }
    }
}

void addPossibleMovementLayerMentionToObjects(
    const Game& game,
    const Pattern& pattern,
    int32_t layer,
    MaskVector& movementMentionedObjects,
    const MaskWord* rhsPropertyPreserveMask = nullptr) {
    if (layer < 0) {
        return;
    }
    for (int32_t objectId = 0; objectId < game.objectCount; ++objectId) {
        if (game.objectsById[static_cast<size_t>(objectId)].layer != layer
            || maskHasObject(game, rhsPropertyPreserveMask, objectId)
            || !patternCanContainObject(game, pattern, objectId)) {
            continue;
        }
        const uint32_t word = maskWordIndex(static_cast<uint32_t>(objectId));
        if (word < game.wordCount) {
            movementMentionedObjects[word] |= maskBit(static_cast<uint32_t>(objectId));
        }
    }
}

void addPossibleMovementMentionToObjects(
    const Game& game,
    const Pattern& pattern,
    const MaskWord* movements,
    MaskVector& movementMentionedObjects,
    const MaskWord* rhsPropertyPreserveMask = nullptr) {
    if (movements == nullptr) {
        return;
    }
    for (int32_t layer = 0; layer < game.layerCount; ++layer) {
        if (movementLayerBits(game, movements, layer) == 0) {
            continue;
        }
        addPossibleMovementLayerMentionToObjects(
            game,
            pattern,
            layer,
            movementMentionedObjects,
            rhsPropertyPreserveMask);
    }
}

void addMovementLayerMentionForObjectMask(
    const Game& game,
    const MaskWord* objects,
    const MaskWord* movements,
    MaskVector& movementMentionedObjects) {
    if (objects == nullptr || movements == nullptr) {
        return;
    }
    for (int32_t objectId = 0; objectId < game.objectCount; ++objectId) {
        if (!maskHasObject(game, objects, objectId)) {
            continue;
        }
        const int32_t layer = game.objectsById[static_cast<size_t>(objectId)].layer;
        if (layer < 0 || movementLayerBits(game, movements, layer) == 0) {
            continue;
        }
        const uint32_t word = maskWordIndex(static_cast<uint32_t>(objectId));
        if (word < game.wordCount) {
            movementMentionedObjects[word] |= maskBit(static_cast<uint32_t>(objectId));
        }
    }
}

bool replacementPreservesMovementForObject(
    const Game& game,
    const Pattern& pattern,
    const MaskWord* objectsSet,
    const MaskWord* movementsTouched,
    const MaskWord* movementsSet,
    const MaskWord* movementsClear,
    const MaskWord* movementsLayerMask,
    int32_t objectId) {
    if (objectsSet == nullptr
        || !maskHasObject(game, objectsSet, objectId)
        || !maskHasObject(game, maskPtr(game, pattern.objectsPresent), objectId)) {
        return false;
    }
    const int32_t layer = game.objectsById[static_cast<size_t>(objectId)].layer;
    if (layer < 0) {
        return false;
    }
    const int32_t presentBits = movementLayerBits(game, maskPtr(game, pattern.movementsPresent), layer);
    const int32_t setBits = movementLayerBits(game, movementsSet, layer);
    const int32_t clearBits =
        movementLayerBits(game, movementsClear, layer)
        | movementLayerBits(game, movementsLayerMask, layer);
    if (presentBits == 0) {
        constexpr int32_t kAllMovementBits = 0x1f;
        const int32_t touchedBits = movementLayerBits(game, movementsTouched, layer);
        const int32_t missingBits =
            movementLayerBits(game, maskPtr(game, pattern.movementsMissing), layer);
        return (touchedBits & kAllMovementBits) == kAllMovementBits
            && (missingBits & kAllMovementBits) == kAllMovementBits
            && setBits == 0
            && (clearBits & kAllMovementBits) == kAllMovementBits;
    }
    return setBits == presentBits && (clearBits & presentBits) == presentBits;
}

bool replacementPreservesMovementForLayer(
    const Game& game,
    const Pattern& pattern,
    const MaskWord* movementsTouched,
    const MaskWord* movementsSet,
    const MaskWord* movementsClear,
    const MaskWord* movementsLayerMask,
    int32_t layer) {
    if (layer < 0) {
        return false;
    }
    const int32_t presentBits = movementLayerBits(game, maskPtr(game, pattern.movementsPresent), layer);
    const int32_t touchedBits = movementLayerBits(game, movementsTouched, layer);
    const int32_t setBits = movementLayerBits(game, movementsSet, layer);
    const int32_t clearBits =
        movementLayerBits(game, movementsClear, layer)
        | movementLayerBits(game, movementsLayerMask, layer);
    return touchedBits != 0
        && presentBits != 0
        && setBits == presentBits
        && (clearBits & presentBits) == presentBits;
}

bool layerCoupledReplacementPreservesPositiveMovement(
    const Game& game,
    const LayerCoupledMovementReplacement& coupled,
    const LayerCoupledMovementLayerTerm& layerTerm) {
    if (!coupled.hasReplacementMovementMask) {
        return false;
    }
    const int32_t replacementBits = coupled.replacementMovementMask & 0x0f;
    if (replacementBits == 0) {
        return false;
    }
    const int32_t presentBits =
        movementLayerBits(game, maskPtr(game, layerTerm.movementsPresent), layerTerm.layerIndex) & 0x0f;
    return presentBits == replacementBits;
}

bool patternHasConflictingPresentObjectsOnLayer(
    const Game& game,
    const Pattern& pattern,
    int32_t layer);

void addMovementLayerMentionForObjectMaskRespectingPreservedMovement(
    const Game& game,
    const Pattern& pattern,
    const MaskWord* objects,
    const MaskWord* movements,
    const MaskWord* movementsSet,
    const MaskWord* movementsClear,
    const MaskWord* movementsLayerMask,
    MaskVector& movementMentionedObjects,
    const MaskWord* rhsPropertyPreserveMask = nullptr) {
    if (objects == nullptr || movements == nullptr) {
        return;
    }
    for (int32_t objectId = 0; objectId < game.objectCount; ++objectId) {
        if (!maskHasObject(game, objects, objectId)) {
            continue;
        }
        if (maskHasObject(game, rhsPropertyPreserveMask, objectId)) {
            continue;
        }
        const int32_t layer = game.objectsById[static_cast<size_t>(objectId)].layer;
        if (layer < 0 || movementLayerBits(game, movements, layer) == 0) {
            continue;
        }
        constexpr int32_t kActionMovementBit = 0x10;
        if ((movementLayerBits(game, movementsSet, layer) & kActionMovementBit) != 0
            && patternHasConflictingPresentObjectsOnLayer(game, pattern, layer)) {
            continue;
        }
        if (replacementPreservesMovementForObject(
                game,
                pattern,
                objects,
                movements,
                movementsSet,
                movementsClear,
                movementsLayerMask,
                objectId)) {
            continue;
        }
        const uint32_t word = maskWordIndex(static_cast<uint32_t>(objectId));
        if (word < game.wordCount) {
            movementMentionedObjects[word] |= maskBit(static_cast<uint32_t>(objectId));
        }
    }
}

bool objectMaskTouchesLayer(const Game& game, const MaskWord* objects, int32_t layer) {
    if (objects == nullptr || layer < 0) {
        return false;
    }
    for (int32_t objectId = 0; objectId < game.objectCount; ++objectId) {
        if (game.objectsById[static_cast<size_t>(objectId)].layer == layer
            && maskHasObject(game, objects, objectId)) {
            return true;
        }
    }
    return false;
}

bool patternHasConflictingPresentObjectsOnLayer(
    const Game& game,
    const Pattern& pattern,
    int32_t layer) {
    if (pattern.kind != Pattern::Kind::CellPattern || layer < 0) {
        return false;
    }
    const MaskWord* objectsPresent = maskPtr(game, pattern.objectsPresent);
    bool seen = false;
    for (int32_t objectId = 0; objectId < game.objectCount; ++objectId) {
        if (!maskHasObject(game, objectsPresent, objectId)
            || game.objectsById[static_cast<size_t>(objectId)].layer != layer) {
            continue;
        }
        if (seen) {
            return true;
        }
        seen = true;
    }
    return false;
}

MaskVector positiveMovementMask(const Game& game, const MaskWord* movements) {
    MaskVector positive(static_cast<size_t>(game.movementWordCount), 0);
    if (movements == nullptr) {
        return positive;
    }
    constexpr int32_t kCardinalMovementBits = 0x0f;
    for (int32_t layer = 0; layer < game.layerCount; ++layer) {
        const int32_t bits = movementLayerBits(game, movements, layer) & kCardinalMovementBits;
        if (bits == 0) {
            continue;
        }
        const int32_t shift = 5 * layer;
        const int32_t word = shift / static_cast<int32_t>(kMaskWordBits);
        const int32_t bit = shift & static_cast<int32_t>(kMaskWordBitMask);
        if (word < static_cast<int32_t>(positive.size())) {
            positive[static_cast<size_t>(word)] |=
                static_cast<MaskWord>(static_cast<MaskWordUnsigned>(bits) << bit);
        }
        if (bit > static_cast<int32_t>(kMaskWordBits - 5U)
            && word + 1 < static_cast<int32_t>(positive.size())) {
            positive[static_cast<size_t>(word + 1)] |=
                static_cast<MaskWord>(
                    static_cast<MaskWordUnsigned>(bits) >> (kMaskWordBits - bit));
        }
    }
    return positive;
}

void addReplacementMovementMentionToObjects(
    const Game& game,
    const Pattern& pattern,
    const MaskWord* objectsSet,
    const MaskWord* objectsClear,
    const MaskWord* movements,
    const MaskWord* movementsSet,
    const MaskWord* movementsClear,
    const MaskWord* movementsLayerMask,
    MaskVector& movementMentionedObjects,
    const MaskWord* rhsPropertyPreserveMask = nullptr) {
    if (movements == nullptr) {
        return;
    }
    if (hasBits(objectsSet, game.wordCount)) {
        addMovementLayerMentionForObjectMaskRespectingPreservedMovement(
            game,
            pattern,
            objectsSet,
            movements,
            movementsSet,
            movementsClear,
            movementsLayerMask,
            movementMentionedObjects,
            rhsPropertyPreserveMask);
    }
    if (hasBits(objectsClear, game.wordCount)) {
        for (int32_t objectId = 0; objectId < game.objectCount; ++objectId) {
            if (!maskHasObject(game, objectsClear, objectId)
                || maskHasObject(game, rhsPropertyPreserveMask, objectId)
                || !patternCanContainObject(game, pattern, objectId)) {
                continue;
            }
            const int32_t layer = game.objectsById[static_cast<size_t>(objectId)].layer;
            if (layer < 0
                || movementLayerBits(game, movements, layer) == 0
                || objectMaskTouchesLayer(game, objectsSet, layer)) {
                continue;
            }
            const uint32_t word = maskWordIndex(static_cast<uint32_t>(objectId));
            if (word < game.wordCount) {
                movementMentionedObjects[word] |= maskBit(static_cast<uint32_t>(objectId));
            }
        }
    }
    if (patternHasObjectTerms(pattern)) {
        for (int32_t layer = 0; layer < game.layerCount; ++layer) {
            if (movementLayerBits(game, movements, layer) == 0
                || objectMaskTouchesLayer(game, objectsSet, layer)
                || objectMaskTouchesLayer(game, objectsClear, layer)) {
                continue;
            }
            if (replacementPreservesMovementForLayer(
                    game,
                    pattern,
                    movements,
                    movementsSet,
                    movementsClear,
                    movementsLayerMask,
                    layer)) {
                continue;
            }
            addPossibleMovementLayerMentionToObjects(
                game,
                pattern,
                layer,
                movementMentionedObjects,
                rhsPropertyPreserveMask);
        }
    }
}

void addObjectMaskToMovementMentions(
    const Game& game,
    const MaskWord* objects,
    MaskVector& movementMentionedObjects) {
    if (objects == nullptr) {
        return;
    }
    for (int32_t objectId = 0; objectId < game.objectCount; ++objectId) {
        if (!maskHasObject(game, objects, objectId)) {
            continue;
        }
        const uint32_t word = maskWordIndex(static_cast<uint32_t>(objectId));
        if (word < game.wordCount) {
            movementMentionedObjects[word] |= maskBit(static_cast<uint32_t>(objectId));
        }
    }
}

void addObjectToWrittenObjects(
    const Game& game,
    int32_t objectId,
    MaskVector& writtenObjects,
    const char* reason = "object-helper") {
    if (objectId < 0 || objectId >= game.objectCount) {
        return;
    }
    const uint32_t word = maskWordIndex(static_cast<uint32_t>(objectId));
    if (word < game.wordCount) {
        traceWrittenObject(game, objectId, reason);
        writtenObjects[word] |= maskBit(static_cast<uint32_t>(objectId));
    }
}

void addObjectToMovementMentions(
    const Game& game,
    int32_t objectId,
    MaskVector& movementMentionedObjects) {
    if (objectId < 0 || objectId >= game.objectCount) {
        return;
    }
    const uint32_t word = maskWordIndex(static_cast<uint32_t>(objectId));
    if (word < game.wordCount) {
        movementMentionedObjects[word] |= maskBit(static_cast<uint32_t>(objectId));
    }
}

void orMaskInto(MaskVector& dest, const MaskVector& src) {
    const size_t n = std::min(dest.size(), src.size());
    for (size_t word = 0; word < n; ++word) {
        dest[word] |= src[word];
    }
}

void orMaskPtrInto(MaskVector& dest, const MaskWord* src, uint32_t wordCount) {
    if (src == nullptr) {
        return;
    }
    const size_t n = std::min(dest.size(), static_cast<size_t>(wordCount));
    for (size_t word = 0; word < n; ++word) {
        dest[word] |= src[word];
    }
}

void andMaskInto(MaskVector& dest, const MaskVector& src) {
    const size_t n = dest.size();
    for (size_t word = 0; word < n; ++word) {
        dest[word] &= (word < src.size()) ? src[word] : MaskWord{0};
    }
}

MaskVector inferredPropertyAliasMask(
    const Game& game,
    const Rule& rule,
    const std::string& propertyName) {
    MaskVector aliases(game.wordCount, 0);
    for (const PropertyBinding& binding : rule.propertyBindings) {
        if (binding.propertyName != propertyName) {
            continue;
        }
        for (const PropertyAlias& alias : binding.aliases) {
            if (alias.objectId < 0) {
                continue;
            }
            const uint32_t word = maskWordIndex(static_cast<uint32_t>(alias.objectId));
            if (word < aliases.size()) {
                aliases[word] |= maskBit(static_cast<uint32_t>(alias.objectId));
            }
        }
    }
    return aliases;
}

MaskVector propertyBindingAliasMask(const Game& game, const PropertyBinding& binding) {
    MaskVector aliases(game.wordCount, 0);
    for (const PropertyAlias& alias : binding.aliases) {
        if (alias.objectId < 0) {
            continue;
        }
        const uint32_t word = maskWordIndex(static_cast<uint32_t>(alias.objectId));
        if (word < aliases.size()) {
            aliases[word] |= maskBit(static_cast<uint32_t>(alias.objectId));
        }
    }
    return aliases;
}

bool patternPreservesPropertyBindingAliases(
    const Game& game,
    const Pattern& pattern,
    const PropertyBinding& binding) {
    if (!pattern.replacement.has_value() || pattern.replacement->dynamic == nullptr) {
        return false;
    }
    const MaskWord* preserveMask =
        maskPtr(game, pattern.replacement->dynamic->rhsPropertyPreserveMask);
    if (preserveMask == nullptr) {
        return false;
    }
    for (const PropertyAlias& alias : binding.aliases) {
        if (!maskHasObject(game, preserveMask, alias.objectId)) {
            return false;
        }
    }
    return !binding.aliases.empty();
}

bool propertyBindingAliasesPreservedAt(
    const Game& game,
    const Rule& rule,
    const PropertyBinding& binding,
    int32_t row,
    int32_t cell) {
    if (row < 0
        || cell < 0
        || static_cast<size_t>(row) >= rule.patterns.size()
        || static_cast<size_t>(cell) >= rule.patterns[static_cast<size_t>(row)].size()) {
        return false;
    }
    return patternPreservesPropertyBindingAliases(
        game,
        rule.patterns[static_cast<size_t>(row)][static_cast<size_t>(cell)],
        binding);
}

bool propertyBindingAliasesAreLocallyPreserved(
    const Game& game,
    const Rule& rule,
    const PropertyBinding& binding) {
    if (!propertyBindingAliasesPreservedAt(
            game,
            rule,
            binding,
            binding.sourceRow,
            binding.sourceCell)) {
        return false;
    }
    for (const PropertySink& sink : binding.sinks) {
        if (!propertyBindingAliasesPreservedAt(game, rule, binding, sink.row, sink.cell)) {
            return false;
        }
    }
    return true;
}

bool propertyBindingSourceHasReplacement(const Rule& rule, const PropertyBinding& binding) {
    if (binding.sourceRow < 0
        || binding.sourceCell < 0
        || static_cast<size_t>(binding.sourceRow) >= rule.patterns.size()
        || static_cast<size_t>(binding.sourceCell)
            >= rule.patterns[static_cast<size_t>(binding.sourceRow)].size()) {
        return false;
    }
    return rule.patterns[static_cast<size_t>(binding.sourceRow)]
        [static_cast<size_t>(binding.sourceCell)]
            .replacement.has_value();
}

bool propertyBindingAliasWritesAreCoveredByCardinalMovement(const PropertyBinding& binding) {
    constexpr int32_t kCardinalMovementBits = 0x0f;
    constexpr int32_t kActionMovementBit = 0x10;
    if (binding.sourceMovementMode == 2) {
        return (binding.sourceMovementMask & kCardinalMovementBits) != 0
            && (binding.sourceMovementMask & kActionMovementBit) == 0;
    }
    if (binding.sourceMovementMode == 3) {
        return (binding.sourceMovementMask & kCardinalMovementBits) != 0
            && (binding.sourceMovementMask & kActionMovementBit) == 0;
    }
    return false;
}

void addPropertyBindingSinkLayerOverwrites(
    const Game& game,
    const Rule& rule,
    const PropertyBinding& binding,
    const MaskVector& objectsOriginatingMovement,
    MaskVector& writtenObjects) {
    if (binding.sinks.empty()) {
        return;
    }
    MaskVector aliases = propertyBindingAliasMask(game, binding);
    // When the binding delivers its aliases into the sink purely by cardinal
    // movement (source `> prop`), only aliases that can actually be in a moving
    // state can ever land there. An alias that no rule ever sets in motion (e.g.
    // `wall` in `wallAndPlayer = wall or Enemy`, where only Enemy receives
    // movement) can never be the matched member, so it never overwrites a
    // same-layer occupant of the sink. Restrict to movement-originating aliases.
    if (propertyBindingAliasWritesAreCoveredByCardinalMovement(binding)) {
        andMaskInto(aliases, objectsOriginatingMovement);
    }
    if (!hasBits(aliases.data(), game.wordCount)) {
        return;
    }
    for (const PropertySink& sink : binding.sinks) {
        if (sink.row < 0
            || sink.cell < 0
            || static_cast<size_t>(sink.row) >= rule.patterns.size()
            || static_cast<size_t>(sink.cell) >= rule.patterns[static_cast<size_t>(sink.row)].size()) {
            continue;
        }
        addLayerOverwriteClearsToWrittenObjects(
            game,
            rule.patterns[static_cast<size_t>(sink.row)][static_cast<size_t>(sink.cell)],
            aliases.data(),
            writtenObjects,
            rule.lineNumber);
    }
}

void addPatternMovementMentionsToObjects(
    const Game& game,
    const Pattern& pattern,
    MaskVector& movementMentionedObjects) {
    if (!patternHasObjectTerms(pattern)) {
        return;
    }
    addPossibleMovementMentionToObjects(
        game,
        pattern,
        maskPtr(game, pattern.movementsPresent),
        movementMentionedObjects);
    addPossibleMovementMentionToObjects(
        game,
        pattern,
        maskPtr(game, pattern.movementsMissing),
        movementMentionedObjects);
    for (uint32_t entry = 0; entry < pattern.anyMovementsCount; ++entry) {
        addPossibleMovementMentionToObjects(
            game,
            pattern,
            maskPtr(game, game.anyMovementOffsets[pattern.anyMovementsFirst + entry]),
            movementMentionedObjects);
    }
    for (const LayerCoupledMovementReplacement& coupled : pattern.layerCoupledMovementMasks) {
        for (const LayerCoupledMovementLayerTerm& layerTerm : coupled.layers) {
            const MaskWord* objectMask = maskPtr(game, layerTerm.objectMask);
            addMovementLayerMentionForObjectMask(
                game,
                objectMask,
                maskPtr(game, layerTerm.movementsAny),
                movementMentionedObjects);
            addMovementLayerMentionForObjectMask(
                game,
                objectMask,
                maskPtr(game, layerTerm.movementsPresent),
                movementMentionedObjects);
            addMovementLayerMentionForObjectMask(
                game,
                objectMask,
                maskPtr(game, layerTerm.movementsMissing),
                movementMentionedObjects);
        }
    }
}

void maskDifferenceInto(
    MaskVector& dest,
    const MaskWord* lhs,
    const MaskWord* rhs,
    uint32_t wordCount) {
    dest.assign(wordCount, 0);
    if (lhs == nullptr) {
        return;
    }
    for (uint32_t word = 0; word < wordCount; ++word) {
        dest[static_cast<size_t>(word)] =
            lhs[word] & ~(rhs == nullptr ? MaskWord{0} : rhs[word]);
    }
}

void addImplicitTwoRowRewriteWrites(
    const Game& game,
    const Rule& rule,
    MaskVector& ruleWrittenObjects,
    MaskVector& ruleLayerOverwriteObjects) {
    if (rule.hasReplacements || !rule.commands.empty() || rule.patterns.size() != 2) {
        return;
    }
    const std::vector<Pattern>& lhsRow = rule.patterns[0];
    const std::vector<Pattern>& rhsRow = rule.patterns[1];
    if (lhsRow.size() != rhsRow.size()) {
        return;
    }
    bool hasEllipsis = false;
    for (size_t cell = 0; cell < lhsRow.size(); ++cell) {
        const bool lhsEllipsis = lhsRow[cell].kind == Pattern::Kind::Ellipsis;
        const bool rhsEllipsis = rhsRow[cell].kind == Pattern::Kind::Ellipsis;
        if (lhsEllipsis || rhsEllipsis) {
            if (lhsEllipsis != rhsEllipsis) {
                return;
            }
            hasEllipsis = true;
        }
    }
    if (!hasEllipsis) {
        return;
    }
    MaskVector rhsOnly(game.wordCount, 0);
    MaskVector lhsOnly(game.wordCount, 0);
    for (size_t cell = 0; cell < lhsRow.size(); ++cell) {
        const Pattern& lhsPattern = lhsRow[cell];
        const Pattern& rhsPattern = rhsRow[cell];
        if (lhsPattern.kind == Pattern::Kind::Ellipsis) {
            continue;
        }
        if (lhsPattern.kind != Pattern::Kind::CellPattern
            || rhsPattern.kind != Pattern::Kind::CellPattern) {
            return;
        }
        const MaskWord* lhsPresent = maskPtr(game, lhsPattern.objectsPresent);
        const MaskWord* rhsPresent = maskPtr(game, rhsPattern.objectsPresent);
        maskDifferenceInto(rhsOnly, rhsPresent, lhsPresent, game.wordCount);
        maskDifferenceInto(lhsOnly, lhsPresent, rhsPresent, game.wordCount);
        addPossibleSetsToWrittenObjects(
            game,
            lhsPattern,
            rhsOnly.data(),
            ruleWrittenObjects,
            false);
        addLayerOverwriteClearsToWrittenObjects(
            game,
            lhsPattern,
            rhsPresent,
            ruleLayerOverwriteObjects,
            rule.lineNumber);
        addPossibleClearsToWrittenObjects(
            game,
            lhsPattern,
            lhsOnly.data(),
            rhsPresent,
            nullptr,
            ruleWrittenObjects);
    }
}

bool commandAffectsSolverStateForStaticObjects(const RuleCommand& command) {
    return command.name != "message" && command.name.rfind("sfx", 0) != 0;
}

bool hasStaticObjectRelevantCommand(const Rule& rule) {
    return std::any_of(
        rule.commands.begin(),
        rule.commands.end(),
        commandAffectsSolverStateForStaticObjects);
}

void accumulateWrittenObjects(
    const Game& game,
    const Rule& rule,
    const MaskVector& objectsOriginatingMovement,
    MaskVector& writtenObjects,
    MaskVector& movementMentionedObjects) {
    MaskVector ruleWrittenObjects(game.wordCount, 0);
    MaskVector ruleLayerOverwriteObjects(game.wordCount, 0);
    // Same-layer erasures caused by a property binding's aliases landing in a
    // sink cell. Unlike the gated ruleLayerOverwriteObjects, these are real even
    // when the rule performs no *direct* object write: the aliased object may be
    // delivered into the cell purely by movement (e.g.
    // [ > move | menu | no object ] -> [ | menu | move ]), which erases any
    // same-layer occupant of that cell that the LHS did not exclude.
    MaskVector rulePropertyBindingOverwriteObjects(game.wordCount, 0);
    MaskVector ruleReplacementMovementObjects(game.wordCount, 0);
    for (const std::vector<Pattern>& row : rule.patterns) {
        for (const Pattern& pattern : row) {
            if (!pattern.replacement.has_value()) {
                continue;
            }
            const Replacement& replacement = *pattern.replacement;
            const MaskWord* rhsPropertyPreserveMask = replacement.dynamic != nullptr
                ? maskPtr(game, replacement.dynamic->rhsPropertyPreserveMask)
                : nullptr;
            const MaskWord* objectsSet = maskPtr(game, replacement.objectsSet);
            const MaskWord* movementsSet = maskPtr(game, replacement.movementsSet);
            const MaskWord* movementsClear = maskPtr(game, replacement.movementsClear);
            const MaskWord* movementsLayerMask = maskPtr(game, replacement.movementsLayerMask);
            const MaskVector positiveMovementsSet = positiveMovementMask(game, movementsSet);
            addPossibleSetsToWrittenObjects(game, pattern, objectsSet, ruleWrittenObjects, false);
            addLayerOverwriteClearsToWrittenObjects(
                game,
                pattern,
                objectsSet,
                ruleLayerOverwriteObjects,
                rule.lineNumber);
            if (replacement.hasRandomEntityMask) {
                const MaskWord* randomEntityMask = maskPtr(game, replacement.randomEntityMask);
                addPossibleSetsToWrittenObjects(game, pattern, randomEntityMask, ruleWrittenObjects, true);
                MaskVector randomEntityRhsPresent(game.wordCount, 0);
                orMaskPtrInto(randomEntityRhsPresent, objectsSet, game.wordCount);
                orMaskPtrInto(randomEntityRhsPresent, randomEntityMask, game.wordCount);
                addLayerOverwriteClearsToWrittenObjects(
                    game,
                    pattern,
                    randomEntityRhsPresent.data(),
                    ruleLayerOverwriteObjects,
                    rule.lineNumber);
            }
            addPossibleClearsToWrittenObjects(
                game,
                pattern,
                maskPtr(game, replacement.objectsClear),
                objectsSet,
                rhsPropertyPreserveMask,
                ruleWrittenObjects);
            addReplacementMovementMentionToObjects(
                game,
                pattern,
                objectsSet,
                nullptr,
                positiveMovementsSet.data(),
                movementsSet,
                movementsClear,
                movementsLayerMask,
                ruleReplacementMovementObjects,
                rhsPropertyPreserveMask);
            if (replacement.hasRandomDirMask) {
                addReplacementMovementMentionToObjects(
                    game,
                    pattern,
                    objectsSet,
                    nullptr,
                    maskPtr(game, replacement.randomDirMask),
                    movementsSet,
                    movementsClear,
                    movementsLayerMask,
                    ruleReplacementMovementObjects,
                    rhsPropertyPreserveMask);
            }
            if (replacement.dynamic != nullptr) {
                for (const InferredAggregateBinding& binding :
                     replacement.dynamic->inferredAggregateBindings) {
                    if (binding.layerIndex.has_value()) {
                        addPossibleMovementLayerMentionToObjects(
                            game,
                            pattern,
                            *binding.layerIndex,
                            ruleReplacementMovementObjects);
                    }
                }
                for (const InferredPropertyBinding& binding :
                     replacement.dynamic->inferredPropertyBindings) {
                    MaskVector inferredAliases =
                        inferredPropertyAliasMask(game, rule, binding.propertyName);
                    addLayerOverwriteClearsToWrittenObjects(
                        game,
                        pattern,
                        inferredAliases.data(),
                        ruleLayerOverwriteObjects,
                        rule.lineNumber);
                }
                for (const LayerCoupledMovementReplacement& coupled :
                     replacement.dynamic->layerCoupledMovementReplacements) {
                    for (const LayerCoupledMovementLayerTerm& layerTerm : coupled.layers) {
                        const bool writesPositiveReplacementMovement =
                            coupled.hasReplacementMovementMask
                            && ((coupled.replacementMovementMask & 0x0f) != 0)
                            && !layerCoupledReplacementPreservesPositiveMovement(
                                game,
                                coupled,
                                layerTerm);
                        if (!writesPositiveReplacementMovement) {
                            continue;
                        }
                        addObjectMaskToMovementMentions(
                            game,
                            maskPtr(game, layerTerm.objectMask),
                            ruleReplacementMovementObjects);
                    }
                }
            }
        }
    }
    addImplicitTwoRowRewriteWrites(
        game,
        rule,
        ruleWrittenObjects,
        ruleLayerOverwriteObjects);
    for (const PropertyBinding& binding : rule.propertyBindings) {
        const bool aliasWritesCoveredByCardinalMovement =
            propertyBindingAliasWritesAreCoveredByCardinalMovement(binding);
        const bool aliasesLocallyPreserved =
            propertyBindingAliasesAreLocallyPreserved(game, rule, binding);
        if (aliasWritesCoveredByCardinalMovement
            && !aliasesLocallyPreserved
            && !propertyBindingSourceHasReplacement(rule, binding)) {
            for (const PropertyAlias& alias : binding.aliases) {
                addObjectToMovementMentions(game, alias.objectId, ruleReplacementMovementObjects);
            }
        }
        if (!binding.sinks.empty()
            && !aliasWritesCoveredByCardinalMovement
            && !aliasesLocallyPreserved) {
            for (const PropertyAlias& alias : binding.aliases) {
                addObjectToWrittenObjects(game, alias.objectId, ruleWrittenObjects, "property-binding-alias");
            }
        }
        addPropertyBindingSinkLayerOverwrites(
            game, rule, binding, objectsOriginatingMovement, rulePropertyBindingOverwriteObjects);
    }
    if (hasBits(ruleWrittenObjects.data(), game.wordCount)) {
        orMaskInto(ruleWrittenObjects, ruleLayerOverwriteObjects);
    }
    orMaskInto(writtenObjects, ruleWrittenObjects);
    orMaskInto(writtenObjects, rulePropertyBindingOverwriteObjects);
    orMaskInto(movementMentionedObjects, ruleReplacementMovementObjects);
}

// Objects that some rule can put into a cardinal-moving state, i.e. that can
// *originate* movement. This is intentionally narrower than the general
// "may receive movement" mention used for static-object blocking: it considers
// only movement *written* by a replacement (RHS `>`, `randomdir`, layer-coupled
// movement), never movement merely *read* on a LHS (`[ > prop | ... ]`). A
// property member that only ever appears under a LHS movement read but is never
// itself set in motion (e.g. `wall` in `wallAndPlayer`) is correctly excluded.
//
// Soundness: this must over-approximate the true set of movers — missing a real
// mover could wrongly keep an erasable object static. Players are added by the
// caller (they move from input). All PuzzleScript movement originates from a
// rule writing it, so enumerating replacement movement writes is sufficient.
void addReplacementOriginatedMovement(
    const Game& game,
    const Pattern& pattern,
    MaskVector& originatesMovement) {
    if (!pattern.replacement.has_value()) {
        return;
    }
    const Replacement& replacement = *pattern.replacement;
    constexpr int32_t kCardinalMovementBits = 0x0f;
    const MaskWord* movementsSet = maskPtr(game, replacement.movementsSet);
    const MaskWord* randomDirMask =
        replacement.hasRandomDirMask ? maskPtr(game, replacement.randomDirMask) : nullptr;
    const MaskWord* objectsSet = maskPtr(game, replacement.objectsSet);
    const MaskWord* objectsPresent = maskPtr(game, pattern.objectsPresent);
    for (int32_t objectId = 0; objectId < game.objectCount; ++objectId) {
        const int32_t layer = game.objectsById[static_cast<size_t>(objectId)].layer;
        if (layer < 0) {
            continue;
        }
        int32_t bits = movementLayerBits(game, movementsSet, layer) & kCardinalMovementBits;
        if (randomDirMask != nullptr) {
            bits |= movementLayerBits(game, randomDirMask, layer) & kCardinalMovementBits;
        }
        if (bits == 0) {
            continue;
        }
        // The object receiving that movement is whatever the replacement writes
        // or preserves on the moving layer.
        if (!maskHasObject(game, objectsSet, objectId)
            && !maskHasObject(game, objectsPresent, objectId)) {
            continue;
        }
        const uint32_t word = maskWordIndex(static_cast<uint32_t>(objectId));
        if (word < game.wordCount) {
            originatesMovement[word] |= maskBit(static_cast<uint32_t>(objectId));
        }
    }
    // Layer-coupled movement (e.g. `[ > A | B ] -> [ > A | > B ]`): the coupled
    // object masks receive positive replacement movement.
    if (replacement.dynamic != nullptr) {
        for (const LayerCoupledMovementReplacement& coupled :
             replacement.dynamic->layerCoupledMovementReplacements) {
            if (!coupled.hasReplacementMovementMask
                || (coupled.replacementMovementMask & kCardinalMovementBits) == 0) {
                continue;
            }
            for (const LayerCoupledMovementLayerTerm& layerTerm : coupled.layers) {
                if (layerCoupledReplacementPreservesPositiveMovement(game, coupled, layerTerm)) {
                    continue;
                }
                const MaskWord* objectMask = maskPtr(game, layerTerm.objectMask);
                if (objectMask == nullptr) {
                    continue;
                }
                for (int32_t objectId = 0; objectId < game.objectCount; ++objectId) {
                    if (!maskHasObject(game, objectMask, objectId)) {
                        continue;
                    }
                    const uint32_t word = maskWordIndex(static_cast<uint32_t>(objectId));
                    if (word < game.wordCount) {
                        originatesMovement[word] |= maskBit(static_cast<uint32_t>(objectId));
                    }
                }
            }
        }
    }
}

MaskVector computeObjectsOriginatingMovement(const Game& game) {
    MaskVector originatesMovement(game.wordCount, 0);
    auto visit = [&](const std::vector<std::vector<Rule>>& groups) {
        for (const std::vector<Rule>& group : groups) {
            for (const Rule& rule : group) {
                for (const std::vector<Pattern>& row : rule.patterns) {
                    for (const Pattern& pattern : row) {
                        addReplacementOriginatedMovement(game, pattern, originatesMovement);
                    }
                }
            }
        }
    };
    visit(game.rules);
    visit(game.lateRules);
    // Players move from input, not from a rule writing movement.
    orMaskPtrInto(originatesMovement, maskPtr(game, game.playerMask), game.wordCount);
    return originatesMovement;
}

} // namespace

StaticObjectAnalysis analyzeStaticObjects(const Game& game) {
    StaticObjectAnalysis analysis;
    analysis.staticObjects.assign(game.wordCount, 0);
    analysis.writtenObjects.assign(game.wordCount, 0);
    analysis.movementMentionedObjects.assign(game.wordCount, 0);

    const MaskVector objectsOriginatingMovement = computeObjectsOriginatingMovement(game);

    auto visitGroups = [&](const std::vector<std::vector<Rule>>& groups) {
        for (const std::vector<Rule>& group : groups) {
            for (const Rule& rule : group) {
                accumulateWrittenObjects(
                    game,
                    rule,
                    objectsOriginatingMovement,
                    analysis.writtenObjects,
                    analysis.movementMentionedObjects);
            }
        }
    };
    visitGroups(game.rules);
    visitGroups(game.lateRules);

    const MaskWord* playerMask = maskPtr(game, game.playerMask);
    for (int32_t objectId = 0; objectId < game.objectCount; ++objectId) {
        if (game.objectsById[static_cast<size_t>(objectId)].layer < 0) {
            continue;
        }
        const uint32_t word = maskWordIndex(static_cast<uint32_t>(objectId));
        const MaskWord bit = maskBit(static_cast<uint32_t>(objectId));
        if (word >= analysis.staticObjects.size()) {
            continue;
        }
        if ((analysis.writtenObjects[static_cast<size_t>(word)] & bit) != 0) {
            continue;
        }
        if (playerMask != nullptr && (playerMask[word] & bit) != 0) {
            continue;
        }
        if ((analysis.movementMentionedObjects[static_cast<size_t>(word)] & bit) != 0) {
            continue;
        }
        analysis.staticObjects[static_cast<size_t>(word)] |= bit;
    }
    return analysis;
}

std::vector<std::string> staticObjectNames(
    const Game& game,
    const MaskVector& staticObjects) {
    std::vector<std::string> names;
    for (int32_t objectId = 0; objectId < game.objectCount; ++objectId) {
        if (game.objectsById[static_cast<size_t>(objectId)].layer < 0) {
            continue;
        }
        const uint32_t word = maskWordIndex(static_cast<uint32_t>(objectId));
        const MaskWord bit = maskBit(static_cast<uint32_t>(objectId));
        if (word < staticObjects.size() && (staticObjects[word] & bit) != 0) {
            names.push_back(game.objectsById[static_cast<size_t>(objectId)].name);
        }
    }
    std::sort(names.begin(), names.end());
    names.erase(std::unique(names.begin(), names.end()), names.end());
    return names;
}

std::vector<std::pair<std::string, std::vector<std::string>>> staticObjectBlockers(
    const Game& game,
    const MaskVector& staticObjects,
    const MaskVector& writtenObjects,
    const MaskVector& movementMentionedObjects) {
    std::vector<std::pair<std::string, std::vector<std::string>>> blockersByObject;
    const MaskWord* playerMask = maskPtr(game, game.playerMask);
    for (int32_t objectId = 0; objectId < game.objectCount; ++objectId) {
        if (game.objectsById[static_cast<size_t>(objectId)].layer < 0) {
            continue;
        }
        const uint32_t word = maskWordIndex(static_cast<uint32_t>(objectId));
        const MaskWord bit = maskBit(static_cast<uint32_t>(objectId));
        if (word >= staticObjects.size()) {
            continue;
        }
        std::vector<std::string> blockers;
        if (word < writtenObjects.size()
            && (writtenObjects[static_cast<size_t>(word)] & bit) != 0) {
            blockers.push_back("written");
        }
        if (playerMask != nullptr && (playerMask[word] & bit) != 0) {
            blockers.push_back("player");
        }
        if (word < movementMentionedObjects.size()
            && (movementMentionedObjects[static_cast<size_t>(word)] & bit) != 0) {
            blockers.push_back("movement");
        }
        if (!blockers.empty()) {
            blockersByObject.emplace_back(
                game.objectsById[static_cast<size_t>(objectId)].name,
                std::move(blockers));
        }
    }
    return blockersByObject;
}

} // namespace puzzlescript::compiler
