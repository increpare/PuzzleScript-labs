#include "compiler/compact_turn_codegen.hpp"

#include "compiler/compiled_rules_codegen.hpp"
#include "compiler/compact_turn_program.hpp"

#include <algorithm>
#include <map>
#include <ostream>
#include <sstream>
#include <stdexcept>
#include <utility>

namespace puzzlescript::compiler {

namespace {

size_t compactLayerCoupledMovementTermCount(const Replacement& replacement) {
    const ReplacementDynamic* dynamic = replacement.dynamic.get();
    if (dynamic == nullptr) {
        return 0;
    }
    size_t count = 0;
    for (const LayerCoupledMovementReplacement& coupled : dynamic->layerCoupledMovementReplacements) {
        count += coupled.layers.size();
    }
    return count;
}

size_t compactInferredAggregateTermCount(const Replacement& replacement) {
    const ReplacementDynamic* dynamic = replacement.dynamic.get();
    if (dynamic == nullptr) {
        return 0;
    }
    size_t count = 0;
    for (const InferredAggregateBinding& binding : dynamic->inferredAggregateBindings) {
        if (binding.layerIndex.has_value() && !binding.propertyName.has_value()) {
            ++count;
        }
    }
    return count;
}

int32_t compactAggregateBindingIndex(const Rule& rule, const std::string& aggregateName) {
    int32_t index = -1;
    for (size_t bindingIndex = 0; bindingIndex < rule.aggregateBindings.size(); ++bindingIndex) {
        if (rule.aggregateBindings[bindingIndex].aggregateName == aggregateName) {
            index = static_cast<int32_t>(bindingIndex);
        }
    }
    return index;
}

const PropertyBinding* compactPropertyBindingForName(const Rule& rule, const std::string& propertyName) {
    const PropertyBinding* result = nullptr;
    for (const PropertyBinding& binding : rule.propertyBindings) {
        if (binding.propertyName == propertyName) {
            result = &binding;
        }
    }
    return result;
}

int compactInputMaskBitCount(uint8_t mask) {
    int count = 0;
    while (mask != 0) {
        count += ((mask & 1u) != 0) ? 1 : 0;
        mask = static_cast<uint8_t>(mask >> 1u);
    }
    return count;
}

int compactInputSpecializationSkipOpportunity(const std::vector<Rule>& group) {
    int opportunity = 0;
    for (const Rule& rule : group) {
        const uint8_t activeMask = static_cast<uint8_t>(rule.activeInputsMask & 0x3f);
        if (activeMask != 0x3f) {
            opportunity += 6 - compactInputMaskBitCount(activeMask);
        }
    }
    return opportunity;
}

bool compactCompileTimeDirectionDelta(int32_t direction, int32_t& dx, int32_t& dy) {
    switch (direction) {
        case 1:
            dx = 0;
            dy = -1;
            return true;
        case 2:
            dx = 0;
            dy = 1;
            return true;
        case 4:
            dx = -1;
            dy = 0;
            return true;
        case 8:
            dx = 1;
            dy = 0;
            return true;
        case 16:
            dx = 0;
            dy = 0;
            return true;
        default:
            dx = 0;
            dy = 0;
            return false;
    }
}

size_t compactLayerCoupledMovementTermCount(const Pattern& pattern) {
    size_t count = 0;
    for (const LayerCoupledMovementReplacement& coupled : pattern.layerCoupledMovementMasks) {
        count += coupled.layers.size();
    }
    return count;
}

size_t compactLayerCoupledMovementGroupCount(const Pattern& pattern) {
    size_t count = 0;
    for (const LayerCoupledMovementReplacement& coupled : pattern.layerCoupledMovementMasks) {
        if (!coupled.layers.empty()) {
            ++count;
        }
    }
    return count;
}

std::string compactRulePatternUnsupportedReason(const Pattern& pattern) {
    if (pattern.kind == Pattern::Kind::Ellipsis) {
        return {};
    }
    return {};
}

std::string compactRuleCommandUnsupportedReason(const RuleCommand& command) {
    if (command.name == "again"
        || command.name == "message"
        || command.name == "cancel"
        || command.name == "checkpoint"
        || command.name == "restart"
        || command.name == "win"
        || command.name.rfind("sfx", 0) == 0) {
        return {};
    }
    return "command_" + command.name;
}

std::string compactRuleUnsupportedReason(const Rule& rule) {
    for (const RuleCommand& command : rule.commands) {
        const std::string reason = compactRuleCommandUnsupportedReason(command);
        if (!reason.empty()) {
            return reason;
        }
    }
    if (rule.patterns.empty()) {
        return "empty_rule";
    }
    if (rule.ellipsisCount.size() < rule.patterns.size()) {
        return "missing_ellipsis_metadata";
    }
    for (size_t rowIndex = 0; rowIndex < rule.patterns.size(); ++rowIndex) {
        const std::vector<Pattern>& row = rule.patterns[rowIndex];
        if (row.empty()) {
            return "empty_row";
        }
        for (const Pattern& pattern : row) {
            const std::string reason = compactRulePatternUnsupportedReason(pattern);
            if (!reason.empty()) {
                return reason;
            }
        }
    }
    for (const std::vector<Pattern>& row : rule.patterns) {
        for (const Pattern& pattern : row) {
            if (!pattern.replacement.has_value()) {
                continue;
            }
            const ReplacementDynamic* dynamic = pattern.replacement->dynamic.get();
            if (dynamic == nullptr) {
                continue;
            }
            for (const InferredAggregateBinding& binding : dynamic->inferredAggregateBindings) {
                if (binding.propertyName.has_value()) {
                    return "inferred_aggregate_property_bindings";
                }
            }
        }
    }
    return {};
}

bool isCompactRuleSupported(const Rule& rule) {
    return compactRuleUnsupportedReason(rule).empty();
}

bool hasAnyRulegroups(const std::vector<std::vector<Rule>>& groups) {
    return std::any_of(groups.begin(), groups.end(), [](const std::vector<Rule>& group) {
        return !group.empty();
    });
}

bool hasGameMetadata(const Game& game, std::string_view key) {
    return game.metadata.values.find(std::string(key)) != game.metadata.values.end();
}

bool hasRuleCommand(const Game& game, std::string_view commandName) {
    auto hasCommandInGroups = [&](const std::vector<std::vector<Rule>>& groups) {
        for (const std::vector<Rule>& group : groups) {
            for (const Rule& rule : group) {
                for (const RuleCommand& command : rule.commands) {
                    if (command.name == commandName) {
                        return true;
                    }
                }
            }
        }
        return false;
    };
    return hasCommandInGroups(game.rules) || hasCommandInGroups(game.lateRules);
}

std::string compactNativeTurnUnsupportedReasonForRule(const Rule& rule) {
    const std::string ruleReason = compactRuleUnsupportedReason(rule);
    if (!ruleReason.empty()) {
        return ruleReason;
    }
    return {};
}

std::string compactNativeTurnUnsupportedReasonForGroups(const std::vector<std::vector<Rule>>& groups) {
    for (const std::vector<Rule>& group : groups) {
        for (const Rule& rule : group) {
            const std::string reason = compactNativeTurnUnsupportedReasonForRule(rule);
            if (!reason.empty()) {
                return reason;
            }
        }
    }
    return {};
}

std::string compactNativeTurnUnsupportedReasonForGame(const Game& game) {
    if (const std::string earlyReason = compactNativeTurnUnsupportedReasonForGroups(game.rules); !earlyReason.empty()) {
        return earlyReason;
    }
    if (const std::string lateReason = compactNativeTurnUnsupportedReasonForGroups(game.lateRules); !lateReason.empty()) {
        return lateReason;
    }
    return {};
}

bool anyMaskWordSet(const std::vector<MaskWord>& words) {
    return std::any_of(words.begin(), words.end(), [](MaskWord word) {
        return word != 0;
    });
}

size_t compactMaskBitCount(const std::vector<MaskWord>& words) {
    size_t count = 0;
    for (const MaskWord word : words) {
        count += static_cast<size_t>(maskWordPopcount(static_cast<MaskWordUnsigned>(word)));
    }
    return count;
}

bool compactMaskHasBit(const std::vector<MaskWord>& words, int32_t objectId) {
    if (objectId < 0) {
        return false;
    }
    const uint32_t word = maskWordIndex(static_cast<uint32_t>(objectId));
    if (static_cast<size_t>(word) >= words.size()) {
        return false;
    }
    return (words[static_cast<size_t>(word)] & maskBit(static_cast<uint32_t>(objectId))) != 0;
}

std::vector<MaskWord> compactMaskWordIntersection(
    const std::vector<MaskWord>& lhs,
    const std::vector<MaskWord>& rhs
) {
    std::vector<MaskWord> result(lhs.size(), 0);
    const size_t count = std::min(lhs.size(), rhs.size());
    for (size_t word = 0; word < count; ++word) {
        result[word] = lhs[word] & rhs[word];
    }
    return result;
}

std::vector<int32_t> compactMaskObjectIds(const std::vector<MaskWord>& words) {
    std::vector<int32_t> ids;
    for (size_t word = 0; word < words.size(); ++word) {
        MaskWordUnsigned bits = static_cast<MaskWordUnsigned>(words[word]);
        while (bits != 0) {
            const int32_t bit = maskWordCountTrailingZeros(bits);
            bits &= bits - 1;
            ids.push_back(static_cast<int32_t>(word * static_cast<size_t>(kMaskWordBits)) + bit);
        }
    }
    return ids;
}

struct CompactReplacementGuaranteedChangeSides {
    bool objects = false;
    bool movements = false;
};

struct CompactReplacementGuaranteedNoopSides {
    bool objects = false;
    bool movements = false;
};

struct CompactRuleEffectiveWriteSummary {
    bool objects = false;
    bool movements = false;
};

CompactReplacementGuaranteedChangeSides compactReplacementGuaranteedChangeSidesOnMatchedCell(
    const Game& game,
    const Pattern& pattern,
    const Replacement& replacement
) {
    CompactReplacementGuaranteedChangeSides result;
    const std::vector<MaskWord> objectClearWords = compiledMaskWords(game, replacement.objectsClear, game.wordCount);
    const std::vector<MaskWord> objectSetWords = compiledMaskWords(game, replacement.objectsSet, game.wordCount);
    const std::vector<MaskWord> objectPresentWords = compiledMaskWords(game, pattern.objectsPresent, game.wordCount);
    const std::vector<MaskWord> objectMissingWords = compiledMaskWords(game, pattern.objectsMissing, game.wordCount);
    for (size_t word = 0; word < objectClearWords.size(); ++word) {
        const MaskWord objectClearOnly = objectClearWords[word] & ~objectSetWords[word];
        if ((objectClearOnly & objectPresentWords[word]) != 0) {
            result.objects = true;
            break;
        }
        if ((objectSetWords[word] & objectMissingWords[word]) != 0) {
            result.objects = true;
            break;
        }
    }

    const std::vector<MaskWord> movementClearWords = compiledMaskWords(game, replacement.movementsClear, game.movementWordCount);
    const std::vector<MaskWord> movementSetWords = compiledMaskWords(game, replacement.movementsSet, game.movementWordCount);
    const std::vector<MaskWord> movementLayerWords = compiledMaskWords(game, replacement.movementsLayerMask, game.movementWordCount);
    const std::vector<MaskWord> movementPresentWords = compiledMaskWords(game, pattern.movementsPresent, game.movementWordCount);
    const std::vector<MaskWord> movementMissingWords = compiledMaskWords(game, pattern.movementsMissing, game.movementWordCount);
    for (size_t word = 0; word < movementClearWords.size(); ++word) {
        const MaskWord movementClear = movementClearWords[word] | movementLayerWords[word];
        const MaskWord movementClearOnly = movementClear & ~movementSetWords[word];
        if ((movementClearOnly & movementPresentWords[word]) != 0) {
            result.movements = true;
            break;
        }
        if ((movementSetWords[word] & movementMissingWords[word]) != 0) {
            result.movements = true;
            break;
        }
    }
    return result;
}

bool compactReplacementGuaranteedChangesMatchedCell(
    const Game& game,
    const Pattern& pattern,
    const Replacement& replacement
) {
    const CompactReplacementGuaranteedChangeSides sides =
        compactReplacementGuaranteedChangeSidesOnMatchedCell(game, pattern, replacement);
    return sides.objects || sides.movements;
}

std::vector<MaskWord> compactObjectMissingWordsIncludingLayerExclusivity(
    const Game& game,
    const std::vector<MaskWord>& objectPresentWords,
    const std::vector<MaskWord>& explicitObjectMissingWords
) {
    std::vector<MaskWord> objectMissingWords = explicitObjectMissingWords;
    for (size_t objectId = 0; objectId < game.objectsById.size(); ++objectId) {
        const uint32_t word = maskWordIndex(static_cast<uint32_t>(objectId));
        if (static_cast<size_t>(word) >= objectPresentWords.size()) {
            continue;
        }
        const MaskWord bit = maskBit(static_cast<uint32_t>(objectId));
        if ((objectPresentWords[static_cast<size_t>(word)] & bit) == 0) {
            continue;
        }
        const int32_t layer = game.objectsById[objectId].layer;
        if (layer < 0 || static_cast<size_t>(layer) >= game.layerMaskOffsets.size()) {
            continue;
        }
        const MaskOffset layerMaskOffset = game.layerMaskOffsets[static_cast<size_t>(layer)];
        if (layerMaskOffset == kNullMaskOffset) {
            continue;
        }
        const std::vector<MaskWord> layerMaskWords = compiledMaskWords(game, layerMaskOffset, game.wordCount);
        for (size_t layerWord = 0; layerWord < objectMissingWords.size(); ++layerWord) {
            objectMissingWords[layerWord] |= layerMaskWords[layerWord] & ~objectPresentWords[layerWord];
        }
    }
    return objectMissingWords;
}

struct CompactSourceMaskNeeds {
    bool objectBoard = false;
    bool objectRows = false;
    bool objectColumns = false;
    bool objectRowAll = false;
    bool objectColumnAll = false;
    bool movementBoard = false;
    bool movementRows = false;
    bool movementColumns = false;
    bool movementRowAll = false;
    bool movementColumnAll = false;
};

void addCompactSourceMaskNeedsForGroups(
    const Game& game,
    const std::vector<std::vector<Rule>>& groups,
    CompactSourceMaskNeeds& needs
) {
    for (const std::vector<Rule>& group : groups) {
        for (const Rule& rule : group) {
            if (!isCompactRuleSupported(rule)) {
                continue;
            }
            if (anyMaskWordSet(compiledMaskWords(game, rule.ruleMask, game.wordCount))) {
                needs.objectBoard = true;
            }
            if (rule.hasRuleMovementMask
                && anyMaskWordSet(compiledMaskWords(game, rule.ruleMovementMask, game.movementWordCount))) {
                needs.movementBoard = true;
            }
            const bool horizontalScan = rule.direction > 2;
            for (size_t rowIndex = 0; rowIndex < rule.patterns.size(); ++rowIndex) {
                const MaskOffset rowObjectOffset = rowIndex < rule.cellRowMasksCount
                    ? game.cellRowMaskOffsets[rule.cellRowMasksFirst + rowIndex]
                    : rule.ruleMask;
                const MaskOffset rowMovementOffset = rowIndex < rule.cellRowMasksMovementsCount
                    ? game.cellRowMaskMovementsOffsets[rule.cellRowMasksMovementsFirst + rowIndex]
                    : kNullMaskOffset;
                const MaskOffset rowMissingObjectOffset = rowIndex < rule.cellRowMissingObjectMasksCount
                    ? game.cellRowMissingObjectMaskOffsets[rule.cellRowMissingObjectMasksFirst + rowIndex]
                    : kNullMaskOffset;
                const MaskOffset rowMissingMovementOffset = rowIndex < rule.cellRowMissingMovementMasksCount
                    ? game.cellRowMissingMovementMaskOffsets[rule.cellRowMissingMovementMasksFirst + rowIndex]
                    : kNullMaskOffset;
                const bool rowHasAnyObjects = rowIndex < rule.cellRowAnyObjectMasks.size()
                    && rule.cellRowAnyObjectMasks[rowIndex].count > 0;
                const bool rowHasAnyMovements = rowIndex < rule.cellRowAnyMovementMasks.size()
                    && rule.cellRowAnyMovementMasks[rowIndex].count > 0;
                if (anyMaskWordSet(compiledMaskWords(game, rowObjectOffset, game.wordCount))) {
                    needs.objectBoard = true;
                    if (horizontalScan) {
                        needs.objectRows = true;
                    } else {
                        needs.objectColumns = true;
                    }
                }
                if (anyMaskWordSet(compiledMaskWords(game, rowMovementOffset, game.movementWordCount))) {
                    needs.movementBoard = true;
                    if (horizontalScan) {
                        needs.movementRows = true;
                    } else {
                        needs.movementColumns = true;
                    }
                }
                if (rowHasAnyObjects) {
                    if (horizontalScan) {
                        needs.objectRows = true;
                    } else {
                        needs.objectColumns = true;
                    }
                }
                if (rowHasAnyMovements) {
                    if (horizontalScan) {
                        needs.movementRows = true;
                    } else {
                        needs.movementColumns = true;
                    }
                }
                if (anyMaskWordSet(compiledMaskWords(game, rowMissingObjectOffset, game.wordCount))) {
                    if (horizontalScan) {
                        needs.objectRowAll = true;
                    } else {
                        needs.objectColumnAll = true;
                    }
                }
                if (anyMaskWordSet(compiledMaskWords(game, rowMissingMovementOffset, game.movementWordCount))) {
                    if (horizontalScan) {
                        needs.movementRowAll = true;
                    } else {
                        needs.movementColumnAll = true;
                    }
                }
            }
        }
    }
}

CompactSourceMaskNeeds compactSourceMaskNeeds(const Game& game) {
    CompactSourceMaskNeeds needs;
    addCompactSourceMaskNeedsForGroups(game, game.rules, needs);
    addCompactSourceMaskNeedsForGroups(game, game.lateRules, needs);
    return needs;
}

constexpr size_t kCompactRulegroupApplyChunkSize = 64;

void emitMaskArray(
    std::ostream& out,
    const std::string& name,
    const std::vector<MaskWord>& words
) {
    out << "constexpr MaskWord " << name << "[] = {";
    for (size_t word = 0; word < words.size(); ++word) {
        if (word > 0) out << ", ";
        out << compiledMaskWordLiteral(words[word]);
    }
    out << "};\n";
}

std::string compactMaskArenaName(std::string_view suffix, std::string_view phase) {
    return "ctm_" + std::string(suffix) + "_" + (phase == "late" ? "l" : "e");
}

std::string compactPhaseTag(std::string_view phase) {
    return phase == "late" ? "l" : "e";
}

class CompactMaskConstantEmitter {
public:
    CompactMaskConstantEmitter(std::string_view suffix, std::string_view phase)
        : arenaName_(compactMaskArenaName(suffix, phase)) {}

    void emitName(const std::vector<MaskWord>& words) {
        (void)canonicalName(words);
    }

    std::string name(const std::vector<MaskWord>& words) const {
        const auto existing = names_.find(words);
        if (existing == names_.end()) {
            throw std::logic_error("compact mask constant was not emitted before use");
        }
        return existing->second;
    }

    void emitDefinitions(std::ostream& out) const {
        if (arena_.empty()) {
            return;
        }
        out << "constexpr MaskWord " << arenaName_ << "[] = {";
        for (size_t word = 0; word < arena_.size(); ++word) {
            if (word > 0) out << ", ";
            if (word > 0 && word % 8 == 0) out << "\n    ";
            out << compiledMaskWordLiteral(arena_[word]);
        }
        out << "};\n";
    }

private:
    const std::string& canonicalName(const std::vector<MaskWord>& words) {
        auto existing = names_.find(words);
        if (existing != names_.end()) {
            return existing->second;
        }

        const size_t offset = arena_.size();
        arena_.insert(arena_.end(), words.begin(), words.end());
        std::string name = arenaName_ + "+" + std::to_string(offset);
        auto inserted = names_.emplace(words, std::move(name));
        return inserted.first->second;
    }

    std::string arenaName_;
    std::vector<MaskWord> arena_;
    std::map<std::vector<MaskWord>, std::string> names_;
};

class CompactFunctionInterner {
public:
    std::string emitDefinition(std::ostream& out, const std::string& preferredName, const std::string& signatureAndBody) {
        return emitDefinition(out, "bool", preferredName, signatureAndBody);
    }

    std::string emitDefinition(std::ostream& out, std::string_view returnType, const std::string& preferredName, const std::string& signatureAndBody) {
        const std::string key = std::string{returnType} + "\n" + signatureAndBody;
        auto existing = names_.find(key);
        if (existing != names_.end()) {
            return existing->second;
        }

        names_.emplace(key, preferredName);
        out << returnType << " " << preferredName << signatureAndBody << "\n";
        return preferredName;
    }

private:
    std::map<std::string, std::string> names_;
};

std::string compactMaskName(
    const CompactMaskConstantEmitter& masks,
    const Game& game,
    MaskOffset offset,
    uint32_t wordCount
) {
    return masks.name(compiledMaskWords(game, offset, wordCount));
}

std::string compactRowPrefix(
    std::string_view suffix,
    std::string_view phase,
    size_t groupIndex,
    size_t ruleIndex,
    size_t rowIndex
);

struct CompactRowMaskInfo {
    std::string objectMaskName;
    std::string movementMaskName;
    std::string missingObjectMaskName;
    std::string missingMovementMaskName;
    std::string anyObjectMasksName = "nullptr";
    std::string anyMovementMasksName = "nullptr";
    std::vector<MaskWord> objectMaskWords;
    std::vector<MaskWord> movementMaskWords;
    std::vector<MaskWord> missingObjectMaskWords;
    std::vector<MaskWord> missingMovementMaskWords;
    uint32_t anyObjectMaskCount = 0;
    uint32_t anyMovementMaskCount = 0;
    bool hasAnyRequiredMask = false;
    bool hasAnyLinePrecondition = false;
};

CompactRowMaskInfo compactRuleMaskInfo(
    const Game& game,
    const CompactMaskConstantEmitter& masks,
    const Rule& rule
) {
    const std::vector<MaskWord> objectWords = compiledMaskWords(game, rule.ruleMask, game.wordCount);
    const std::vector<MaskWord> movementWords = compiledMaskWords(
        game,
        rule.hasRuleMovementMask ? rule.ruleMovementMask : kNullMaskOffset,
        game.movementWordCount
    );
    return CompactRowMaskInfo{
        masks.name(objectWords),
        masks.name(movementWords),
        masks.name(compiledMaskWords(game, kNullMaskOffset, game.wordCount)),
        masks.name(compiledMaskWords(game, kNullMaskOffset, game.movementWordCount)),
        "nullptr",
        "nullptr",
        objectWords,
        movementWords,
        {},
        {},
        0,
        0,
        anyMaskWordSet(objectWords) || anyMaskWordSet(movementWords),
        anyMaskWordSet(objectWords) || anyMaskWordSet(movementWords)
    };
}

CompactRowMaskInfo compactRowMaskInfo(
    const Game& game,
    const CompactMaskConstantEmitter& masks,
    const Rule& rule,
    size_t rowIndex,
    std::string_view suffix,
    std::string_view phase,
    size_t groupIndex,
    size_t ruleIndex
) {
    const MaskOffset rowObjectOffset = rowIndex < rule.cellRowMasksCount
        ? game.cellRowMaskOffsets[rule.cellRowMasksFirst + rowIndex]
        : rule.ruleMask;
    const MaskOffset rowMovementOffset = rowIndex < rule.cellRowMasksMovementsCount
        ? game.cellRowMaskMovementsOffsets[rule.cellRowMasksMovementsFirst + rowIndex]
        : kNullMaskOffset;
    const MaskOffset rowMissingObjectOffset = rowIndex < rule.cellRowMissingObjectMasksCount
        ? game.cellRowMissingObjectMaskOffsets[rule.cellRowMissingObjectMasksFirst + rowIndex]
        : kNullMaskOffset;
    const MaskOffset rowMissingMovementOffset = rowIndex < rule.cellRowMissingMovementMasksCount
        ? game.cellRowMissingMovementMaskOffsets[rule.cellRowMissingMovementMasksFirst + rowIndex]
        : kNullMaskOffset;
    const RowAnyMaskSpan anyObjectSpan = rowIndex < rule.cellRowAnyObjectMasks.size()
        ? rule.cellRowAnyObjectMasks[rowIndex]
        : RowAnyMaskSpan{};
    const RowAnyMaskSpan anyMovementSpan = rowIndex < rule.cellRowAnyMovementMasks.size()
        ? rule.cellRowAnyMovementMasks[rowIndex]
        : RowAnyMaskSpan{};
    const std::vector<MaskWord> objectWords = compiledMaskWords(game, rowObjectOffset, game.wordCount);
    const std::vector<MaskWord> movementWords = compiledMaskWords(game, rowMovementOffset, game.movementWordCount);
    const std::vector<MaskWord> missingObjectWords = compiledMaskWords(game, rowMissingObjectOffset, game.wordCount);
    const std::vector<MaskWord> missingMovementWords = compiledMaskWords(game, rowMissingMovementOffset, game.movementWordCount);
    const bool hasAnyObjects = anyObjectSpan.count > 0;
    const bool hasAnyMovements = anyMovementSpan.count > 0;
    const std::string rowPrefix = compactRowPrefix(suffix, phase, groupIndex, ruleIndex, rowIndex);
    return CompactRowMaskInfo{
        masks.name(objectWords),
        masks.name(movementWords),
        masks.name(missingObjectWords),
        masks.name(missingMovementWords),
        hasAnyObjects ? rowPrefix + "_any_object_masks" : "nullptr",
        hasAnyMovements ? rowPrefix + "_any_movement_masks" : "nullptr",
        objectWords,
        movementWords,
        missingObjectWords,
        missingMovementWords,
        anyObjectSpan.count,
        anyMovementSpan.count,
        anyMaskWordSet(objectWords) || anyMaskWordSet(movementWords),
        anyMaskWordSet(objectWords)
            || anyMaskWordSet(movementWords)
            || anyMaskWordSet(missingObjectWords)
            || anyMaskWordSet(missingMovementWords)
            || hasAnyObjects
            || hasAnyMovements
    };
}

std::string compactBoardRequiredMaskExpression(const CompactRowMaskInfo& mask) {
    std::vector<std::string> terms;
    for (size_t word = 0; word < mask.objectMaskWords.size(); ++word) {
        const MaskWord required = mask.objectMaskWords[word];
        if (required == 0) {
            continue;
        }
        const std::string literal = compiledMaskWordLiteral(required);
        std::ostringstream term;
        term << "((scratch.boardMask[" << word << "] & " << literal << ") == " << literal << ")";
        terms.push_back(term.str());
    }
    for (size_t word = 0; word < mask.movementMaskWords.size(); ++word) {
        const MaskWord required = mask.movementMaskWords[word];
        if (required == 0) {
            continue;
        }
        const std::string literal = compiledMaskWordLiteral(required);
        std::ostringstream term;
        term << "((scratch.boardMovementMask[" << word << "] & " << literal << ") == " << literal << ")";
        terms.push_back(term.str());
    }
    if (terms.empty()) {
        return "true";
    }
    std::ostringstream expression;
    for (size_t index = 0; index < terms.size(); ++index) {
        if (index > 0) {
            expression << " && ";
        }
        expression << terms[index];
    }
    return expression.str();
}

void emitCompactRuleMaskPrecheck(
    std::ostream& out,
    std::string_view indent,
    std::string_view suffix,
    const CompactRowMaskInfo& ruleMask,
    std::string_view failureReturnExpression = "false"
) {
    if (!ruleMask.hasAnyRequiredMask) {
        return;
    }
    out << indent << "if (!(" << compactBoardRequiredMaskExpression(ruleMask) << ")) {\n"
        << indent << "    compact_turn_count_rule_mask_precheck_failure_" << suffix << "();\n"
        << indent << "    compact_turn_count_rules_skipped_by_mask_" << suffix << "();\n"
        << indent << "    return " << failureReturnExpression << ";\n"
        << indent << "}\n"
        << indent << "compact_turn_count_rule_mask_precheck_pass_" << suffix << "();\n";
}

void emitCompactFixedRowScanBounds(
    std::ostream& out,
    const Rule& rule,
    size_t rowLength,
    std::string_view indent,
    std::string_view failureReturnExpression = "false"
) {
    const int32_t trailingCells = rowLength > 0 ? static_cast<int32_t>(rowLength - 1) : 0;
    int32_t secondaryStart = 0;
    int32_t secondaryEndTrim = 0;
    switch (rule.direction) {
        case 1:
            secondaryStart = trailingCells;
            break;
        case 2:
            secondaryEndTrim = trailingCells;
            break;
        case 4:
            secondaryStart = trailingCells;
            break;
        case 8:
            secondaryEndTrim = trailingCells;
            break;
        default:
            break;
    }
    out << indent << "const int32_t secondaryStart = " << secondaryStart << ";\n"
        << indent << "const int32_t secondaryEnd = secondaryLimit - " << secondaryEndTrim << ";\n"
        << indent << "if (secondaryStart >= secondaryEnd) return " << failureReturnExpression << ";\n"
        << indent << "const int32_t secondarySpan = secondaryEnd - secondaryStart;\n";
}

std::string compactPatternPrefix(
    std::string_view suffix,
    std::string_view phase,
    size_t groupIndex,
    size_t ruleIndex,
    size_t rowIndex,
    size_t patternIndex
) {
    return "ctp_" + std::string(suffix)
        + "_" + compactPhaseTag(phase)
        + "_" + std::to_string(groupIndex)
        + "_" + std::to_string(ruleIndex)
        + "_" + std::to_string(rowIndex)
        + "_" + std::to_string(patternIndex);
}

std::string compactRulePrefix(
    std::string_view suffix,
    std::string_view phase,
    size_t groupIndex,
    size_t ruleIndex
) {
    return "ctr_" + std::string(suffix)
        + "_" + compactPhaseTag(phase)
        + "_" + std::to_string(groupIndex)
        + "_" + std::to_string(ruleIndex);
}

std::string compactRowPrefix(
    std::string_view suffix,
    std::string_view phase,
    size_t groupIndex,
    size_t ruleIndex,
    size_t rowIndex
) {
    return compactRulePrefix(suffix, phase, groupIndex, ruleIndex)
        + "_r_" + std::to_string(rowIndex);
}

std::string compactGroupPrefix(
    std::string_view suffix,
    std::string_view phase,
    size_t groupIndex
) {
    return "ctg_" + std::string(suffix)
        + "_" + compactPhaseTag(phase)
        + "_" + std::to_string(groupIndex);
}

std::vector<MaskWord> compactMovementAnchorMaskForPattern(const Game& game, const Pattern& pattern);

void emitCompactRuleMaskData(
    std::ostream& out,
    const Game& game,
    std::string_view suffix,
    std::string_view phase,
    const std::vector<std::vector<Rule>>& groups,
    CompactMaskConstantEmitter& masks
) {
    masks.emitName(compiledMaskWords(game, kNullMaskOffset, game.wordCount));
    masks.emitName(compiledMaskWords(game, kNullMaskOffset, game.movementWordCount));
    for (size_t groupIndex = 0; groupIndex < groups.size(); ++groupIndex) {
        const std::vector<Rule>& group = groups[groupIndex];
        for (size_t ruleIndex = 0; ruleIndex < group.size(); ++ruleIndex) {
            const Rule& rule = group[ruleIndex];
            if (!isCompactRuleSupported(rule)) {
                continue;
            }
            masks.emitName(compiledMaskWords(game, rule.ruleMask, game.wordCount));
            masks.emitName(compiledMaskWords(
                game,
                rule.hasRuleMovementMask ? rule.ruleMovementMask : kNullMaskOffset,
                game.movementWordCount
            ));
            for (size_t rowIndex = 0; rowIndex < rule.patterns.size(); ++rowIndex) {
                const MaskOffset rowObjectOffset = rowIndex < rule.cellRowMasksCount
                    ? game.cellRowMaskOffsets[rule.cellRowMasksFirst + rowIndex]
                    : rule.ruleMask;
                const MaskOffset rowMovementOffset = rowIndex < rule.cellRowMasksMovementsCount
                    ? game.cellRowMaskMovementsOffsets[rule.cellRowMasksMovementsFirst + rowIndex]
                    : kNullMaskOffset;
                const MaskOffset rowMissingObjectOffset = rowIndex < rule.cellRowMissingObjectMasksCount
                    ? game.cellRowMissingObjectMaskOffsets[rule.cellRowMissingObjectMasksFirst + rowIndex]
                    : kNullMaskOffset;
                const MaskOffset rowMissingMovementOffset = rowIndex < rule.cellRowMissingMovementMasksCount
                    ? game.cellRowMissingMovementMaskOffsets[rule.cellRowMissingMovementMasksFirst + rowIndex]
                    : kNullMaskOffset;
                masks.emitName(compiledMaskWords(game, rowObjectOffset, game.wordCount));
                masks.emitName(compiledMaskWords(game, rowMovementOffset, game.movementWordCount));
                masks.emitName(compiledMaskWords(game, rowMissingObjectOffset, game.wordCount));
                masks.emitName(compiledMaskWords(game, rowMissingMovementOffset, game.movementWordCount));
                const RowAnyMaskSpan anyObjectSpan = rowIndex < rule.cellRowAnyObjectMasks.size()
                    ? rule.cellRowAnyObjectMasks[rowIndex]
                    : RowAnyMaskSpan{};
                const RowAnyMaskSpan anyMovementSpan = rowIndex < rule.cellRowAnyMovementMasks.size()
                    ? rule.cellRowAnyMovementMasks[rowIndex]
                    : RowAnyMaskSpan{};
                const std::string rowPrefix = compactRowPrefix(suffix, phase, groupIndex, ruleIndex, rowIndex);
                if (anyObjectSpan.count > 0) {
                    out << "constexpr const MaskWord* " << rowPrefix << "_any_object_masks[] = {";
                    for (uint32_t anyIndex = 0; anyIndex < anyObjectSpan.count; ++anyIndex) {
                        if (anyIndex > 0) out << ", ";
                        const size_t offsetIndex = static_cast<size_t>(anyObjectSpan.first + anyIndex);
                        const MaskOffset offset = offsetIndex < game.cellRowAnyObjectMaskOffsets.size()
                            ? game.cellRowAnyObjectMaskOffsets[offsetIndex]
                            : kNullMaskOffset;
                        masks.emitName(compiledMaskWords(game, offset, game.wordCount));
                        out << compactMaskName(masks, game, offset, game.wordCount);
                    }
                    out << "};\n";
                }
                if (anyMovementSpan.count > 0) {
                    out << "constexpr const MaskWord* " << rowPrefix << "_any_movement_masks[] = {";
                    for (uint32_t anyIndex = 0; anyIndex < anyMovementSpan.count; ++anyIndex) {
                        if (anyIndex > 0) out << ", ";
                        const size_t offsetIndex = static_cast<size_t>(anyMovementSpan.first + anyIndex);
                        const MaskOffset offset = offsetIndex < game.cellRowAnyMovementMaskOffsets.size()
                            ? game.cellRowAnyMovementMaskOffsets[offsetIndex]
                            : kNullMaskOffset;
                        masks.emitName(compiledMaskWords(game, offset, game.movementWordCount));
                        out << compactMaskName(masks, game, offset, game.movementWordCount);
                    }
                    out << "};\n";
                }
                const std::vector<Pattern>& row = rule.patterns[rowIndex];
                for (size_t patternIndex = 0; patternIndex < row.size(); ++patternIndex) {
                    const Pattern& pattern = row[patternIndex];
                    if (pattern.kind == Pattern::Kind::Ellipsis) {
                        continue;
                    }
                    masks.emitName(compiledMaskWords(game, pattern.objectsPresent, game.wordCount));
                    masks.emitName(compiledMaskWords(game, pattern.objectsMissing, game.wordCount));
                    masks.emitName(compiledMaskWords(game, pattern.movementsPresent, game.movementWordCount));
                    masks.emitName(compiledMaskWords(game, pattern.movementsMissing, game.movementWordCount));
                    const std::string prefix = compactPatternPrefix(suffix, phase, groupIndex, ruleIndex, rowIndex, patternIndex);
                    for (uint32_t anyIndex = 0; anyIndex < pattern.anyObjectsCount; ++anyIndex) {
                        const MaskOffset offset = game.anyObjectOffsets[pattern.anyObjectsFirst + anyIndex];
                        masks.emitName(compiledMaskWords(game, offset, game.wordCount));
                    }
                    for (uint32_t anyIndex = 0; anyIndex < pattern.anyMovementsCount; ++anyIndex) {
                        const MaskOffset offset = game.anyMovementOffsets[pattern.anyMovementsFirst + anyIndex];
                        masks.emitName(compiledMaskWords(game, offset, game.movementWordCount));
                    }
                    for (const LayerCoupledMovementReplacement& coupled : pattern.layerCoupledMovementMasks) {
                        for (const LayerCoupledMovementLayerTerm& layerTerm : coupled.layers) {
                            masks.emitName(compiledMaskWords(game, layerTerm.objectMask, game.wordCount));
                            masks.emitName(compiledMaskWords(game, layerTerm.movementsAny, game.movementWordCount));
                            masks.emitName(compiledMaskWords(game, layerTerm.movementsPresent, game.movementWordCount));
                            masks.emitName(compiledMaskWords(game, layerTerm.movementsMissing, game.movementWordCount));
                        }
                    }
                    const std::vector<MaskWord> movementAnchorMask = compactMovementAnchorMaskForPattern(game, pattern);
                    if (anyMaskWordSet(movementAnchorMask)) {
                        masks.emitName(movementAnchorMask);
                    }
                    if (pattern.anyObjectsCount > 0) {
                        out << "constexpr const MaskWord* " << prefix << "_any_object_masks[] = {";
                        for (uint32_t anyIndex = 0; anyIndex < pattern.anyObjectsCount; ++anyIndex) {
                            if (anyIndex > 0) out << ", ";
                            const MaskOffset offset = game.anyObjectOffsets[pattern.anyObjectsFirst + anyIndex];
                            out << compactMaskName(masks, game, offset, game.wordCount);
                        }
                        out << "};\n";
                    }
                    if (pattern.anyMovementsCount > 0) {
                        out << "constexpr const MaskWord* " << prefix << "_any_movement_masks[] = {";
                        for (uint32_t anyIndex = 0; anyIndex < pattern.anyMovementsCount; ++anyIndex) {
                            if (anyIndex > 0) out << ", ";
                            const MaskOffset offset = game.anyMovementOffsets[pattern.anyMovementsFirst + anyIndex];
                            out << compactMaskName(masks, game, offset, game.movementWordCount);
                        }
                        out << "};\n";
                    }
                    const size_t patternLayerCoupledMovementTermCount =
                        compactLayerCoupledMovementTermCount(pattern);
                    if (patternLayerCoupledMovementTermCount > 0) {
                        const size_t patternLayerCoupledMovementGroupCount =
                            compactLayerCoupledMovementGroupCount(pattern);
                        out << "constexpr CompactTurnLayerCoupledMovementTerm_" << suffix << " "
                            << prefix << "_layer_coupled_movement_match_terms[] = {\n";
                        for (const LayerCoupledMovementReplacement& coupled : pattern.layerCoupledMovementMasks) {
                            for (const LayerCoupledMovementLayerTerm& layerTerm : coupled.layers) {
                                out << "    {"
                                    << layerTerm.layerIndex << ", "
                                    << compactMaskName(masks, game, layerTerm.objectMask, game.wordCount) << ", "
                                    << compactMaskName(masks, game, layerTerm.movementsAny, game.movementWordCount) << ", "
                                    << compactMaskName(masks, game, layerTerm.movementsPresent, game.movementWordCount) << ", "
                                    << compactMaskName(masks, game, layerTerm.movementsMissing, game.movementWordCount) << ", "
                                    << coupled.replacementMovementMask << ", "
                                    << "-1},\n";
                            }
                        }
                        out << "};\n";
                        out << "constexpr size_t " << prefix << "_layer_coupled_movement_match_term_count = "
                            << patternLayerCoupledMovementTermCount << ";\n";
                        out << "constexpr int32_t " << prefix << "_layer_coupled_movement_match_group_firsts[] = {";
                        size_t first = 0;
                        bool wroteGroup = false;
                        for (const LayerCoupledMovementReplacement& coupled : pattern.layerCoupledMovementMasks) {
                            if (coupled.layers.empty()) {
                                continue;
                            }
                            if (wroteGroup) out << ", ";
                            out << first;
                            first += coupled.layers.size();
                            wroteGroup = true;
                        }
                        out << "};\n";
                        out << "constexpr int32_t " << prefix << "_layer_coupled_movement_match_group_counts[] = {";
                        wroteGroup = false;
                        for (const LayerCoupledMovementReplacement& coupled : pattern.layerCoupledMovementMasks) {
                            if (coupled.layers.empty()) {
                                continue;
                            }
                            if (wroteGroup) out << ", ";
                            out << coupled.layers.size();
                            wroteGroup = true;
                        }
                        out << "};\n";
                        out << "constexpr size_t " << prefix << "_layer_coupled_movement_match_group_count = "
                            << patternLayerCoupledMovementGroupCount << ";\n";
                    }
                    if (pattern.replacement.has_value()) {
                        const Replacement& replacement = *pattern.replacement;
                        masks.emitName(compiledMaskWords(game, replacement.objectsClear, game.wordCount));
                        masks.emitName(compiledMaskWords(game, replacement.objectsSet, game.wordCount));
                        masks.emitName(compiledMaskWords(game, replacement.movementsClear, game.movementWordCount));
                        masks.emitName(compiledMaskWords(game, replacement.movementsSet, game.movementWordCount));
                        masks.emitName(compiledMaskWords(game, replacement.movementsLayerMask, game.movementWordCount));
                        if (const ReplacementDynamic* dynamic = replacement.dynamic.get()) {
                            for (const LayerCoupledMovementReplacement& coupled : dynamic->layerCoupledMovementReplacements) {
                                for (const LayerCoupledMovementLayerTerm& layerTerm : coupled.layers) {
                                    masks.emitName(compiledMaskWords(game, layerTerm.objectMask, game.wordCount));
                                    masks.emitName(compiledMaskWords(game, layerTerm.movementsAny, game.movementWordCount));
                                    masks.emitName(compiledMaskWords(game, layerTerm.movementsPresent, game.movementWordCount));
                                    masks.emitName(compiledMaskWords(game, layerTerm.movementsMissing, game.movementWordCount));
                                }
                            }
                        }
                        if (replacement.hasRandomEntityMask) {
                            out << "constexpr int32_t " << prefix << "_random_entity_choices[] = {";
                            if (replacement.randomEntityChoices.empty()) {
                                out << "0";
                            } else {
                                for (size_t choiceIndex = 0; choiceIndex < replacement.randomEntityChoices.size(); ++choiceIndex) {
                                    if (choiceIndex > 0) out << ", ";
                                    out << replacement.randomEntityChoices[choiceIndex];
                                }
                            }
                            out << "};\n";
                            out << "constexpr size_t " << prefix << "_random_entity_choice_count = "
                                << replacement.randomEntityChoices.size() << ";\n";
                        }
                        if (replacement.hasRandomDirMask) {
                            out << "constexpr int32_t " << prefix << "_random_dir_layers[] = {";
                            if (replacement.randomDirLayers.empty()) {
                                out << "0";
                            } else {
                                for (size_t layerIndex = 0; layerIndex < replacement.randomDirLayers.size(); ++layerIndex) {
                                    if (layerIndex > 0) out << ", ";
                                    out << replacement.randomDirLayers[layerIndex];
                                }
                            }
                            out << "};\n";
                            out << "constexpr size_t " << prefix << "_random_dir_layer_count = "
                                << replacement.randomDirLayers.size() << ";\n";
                        }
                        const size_t layerCoupledMovementTermCount = compactLayerCoupledMovementTermCount(replacement);
                        if (layerCoupledMovementTermCount > 0) {
                            out << "constexpr CompactTurnLayerCoupledMovementTerm_" << suffix << " "
                                << prefix << "_layer_coupled_movement_terms[] = {\n";
                            const ReplacementDynamic* dynamic = replacement.dynamic.get();
                            for (const LayerCoupledMovementReplacement& coupled : dynamic->layerCoupledMovementReplacements) {
                                const int32_t aggregateCaptureIndex = coupled.replacementAggregateName.has_value()
                                    ? compactAggregateBindingIndex(rule, *coupled.replacementAggregateName)
                                    : -1;
                                for (const LayerCoupledMovementLayerTerm& layerTerm : coupled.layers) {
                                    out << "    {"
                                        << layerTerm.layerIndex << ", "
                                        << compactMaskName(masks, game, layerTerm.objectMask, game.wordCount) << ", "
                                        << compactMaskName(masks, game, layerTerm.movementsAny, game.movementWordCount) << ", "
                                        << compactMaskName(masks, game, layerTerm.movementsPresent, game.movementWordCount) << ", "
                                        << compactMaskName(masks, game, layerTerm.movementsMissing, game.movementWordCount) << ", "
                                        << coupled.replacementMovementMask << ", "
                                        << aggregateCaptureIndex << "},\n";
                                }
                            }
                            out << "};\n";
                            out << "constexpr size_t " << prefix << "_layer_coupled_movement_term_count = "
                                << layerCoupledMovementTermCount << ";\n";
                        }
                        const size_t inferredAggregateTermCount = compactInferredAggregateTermCount(replacement);
                        if (inferredAggregateTermCount > 0) {
                            out << "constexpr CompactTurnInferredAggregateTerm_" << suffix << " "
                                << prefix << "_inferred_aggregate_terms[] = {\n";
                            const ReplacementDynamic* dynamic = replacement.dynamic.get();
                            for (const InferredAggregateBinding& binding : dynamic->inferredAggregateBindings) {
                                if (!binding.layerIndex.has_value() || binding.propertyName.has_value()) {
                                    continue;
                                }
                                out << "    {"
                                    << *binding.layerIndex << ", "
                                    << compactAggregateBindingIndex(rule, binding.aggregateName)
                                    << "},\n";
                            }
                            out << "};\n";
                            out << "constexpr size_t " << prefix << "_inferred_aggregate_term_count = "
                                << inferredAggregateTermCount << ";\n";
                        }
                    }
                }
            }
        }
    }
}

std::string compactPatternMatchesCall(
    const Game& game,
    const CompactMaskConstantEmitter& masks,
    const Pattern& pattern,
    std::string_view suffix,
    std::string_view phase,
    size_t groupIndex,
    size_t ruleIndex,
    size_t rowIndex,
    size_t patternIndex,
    std::string_view tileIndexExpr
) {
    const std::string prefix = compactPatternPrefix(suffix, phase, groupIndex, ruleIndex, rowIndex, patternIndex);
    const bool hasLayerCoupledMovementTerms = compactLayerCoupledMovementTermCount(pattern) > 0;
    std::ostringstream call;
    call << "compact_turn_pattern_matches_" << suffix << "(levelState, scratch, " << tileIndexExpr
         << ", " << compactMaskName(masks, game, pattern.objectsPresent, game.wordCount)
         << ", " << compactMaskName(masks, game, pattern.objectsMissing, game.wordCount)
         << ", " << compactMaskName(masks, game, pattern.movementsPresent, game.movementWordCount)
         << ", " << compactMaskName(masks, game, pattern.movementsMissing, game.movementWordCount)
         << ", " << (pattern.anyObjectsCount > 0 ? prefix + "_any_object_masks" : "nullptr")
         << ", " << pattern.anyObjectsCount
         << ", " << (pattern.anyMovementsCount > 0 ? prefix + "_any_movement_masks" : "nullptr")
         << ", " << pattern.anyMovementsCount
         << ", "
         << (hasLayerCoupledMovementTerms ? prefix + "_layer_coupled_movement_match_terms" : "nullptr")
         << ", "
         << (hasLayerCoupledMovementTerms ? prefix + "_layer_coupled_movement_match_group_firsts" : "nullptr")
         << ", "
         << (hasLayerCoupledMovementTerms ? prefix + "_layer_coupled_movement_match_group_counts" : "nullptr")
         << ", "
         << (hasLayerCoupledMovementTerms ? prefix + "_layer_coupled_movement_match_group_count" : "0")
         << ")";
    return call.str();
}

bool compactPatternCanInlineMatch(const Pattern& pattern) {
    return pattern.kind == Pattern::Kind::CellPattern
        && pattern.anyObjectsCount == 0
        && pattern.anyMovementsCount == 0
        && compactLayerCoupledMovementGroupCount(pattern) == 0;
}

void emitCompactInlinePatternMatchTest(
    std::ostream& out,
    const Game& game,
    const Pattern& pattern,
    std::string_view suffix,
    std::string_view indent,
    std::string_view tileIndexExpr,
    std::string_view tileVariableName,
    std::string_view matchedFlagName
) {
    const std::vector<MaskWord> objectsPresent = compiledMaskWords(game, pattern.objectsPresent, game.wordCount);
    const std::vector<MaskWord> objectsMissing = compiledMaskWords(game, pattern.objectsMissing, game.wordCount);
    const std::vector<MaskWord> movementsPresent = compiledMaskWords(game, pattern.movementsPresent, game.movementWordCount);
    const std::vector<MaskWord> movementsMissing = compiledMaskWords(game, pattern.movementsMissing, game.movementWordCount);
    const bool needsObjects = anyMaskWordSet(objectsPresent) || anyMaskWordSet(objectsMissing);
    const bool needsMovements = anyMaskWordSet(movementsPresent) || anyMaskWordSet(movementsMissing);
    if (!needsObjects && !needsMovements) {
        return;
    }
    const std::string objectVar = std::string(tileVariableName) + "_objects";
    const std::string movementVar = std::string(tileVariableName) + "_movements";
    if (needsObjects) {
        out << indent << "if (" << matchedFlagName << ") {\n"
            << indent << "    const MaskWord* " << objectVar << " = compact_turn_cell_objects_" << suffix << "(levelState, " << tileIndexExpr << ");\n";
        for (size_t word = 0; word < objectsPresent.size(); ++word) {
            const MaskWord required = objectsPresent[word];
            const MaskWord forbidden = word < objectsMissing.size() ? objectsMissing[word] : 0;
            if (required == 0 && forbidden == 0) {
                continue;
            }
            const std::string requiredLiteral = compiledMaskWordLiteral(required);
            const std::string forbiddenLiteral = compiledMaskWordLiteral(forbidden);
            if (required != 0 && forbidden != 0) {
                const std::string wordVar = objectVar + "_word_" + std::to_string(word);
                out << indent << "    const MaskWord " << wordVar << " = " << objectVar << "[" << word << "];\n"
                    << indent << "    if (((" << wordVar << " & " << requiredLiteral << ") != " << requiredLiteral
                    << ") || ((" << wordVar << " & " << forbiddenLiteral << ") != 0)) " << matchedFlagName << " = false;\n";
            } else if (required != 0) {
                out << indent << "    if (((" << objectVar << "[" << word << "] & " << requiredLiteral << ") != "
                    << requiredLiteral << ")) " << matchedFlagName << " = false;\n";
            } else {
                out << indent << "    if (((" << objectVar << "[" << word << "] & "
                    << forbiddenLiteral << ") != 0)) " << matchedFlagName << " = false;\n";
            }
        }
        out << indent << "}\n";
    }
    if (needsMovements) {
        out << indent << "if (" << matchedFlagName << ") {\n"
            << indent << "    const MaskWord* " << movementVar << " = compact_turn_cell_movements_" << suffix << "(scratch, " << tileIndexExpr << ");\n";
        for (size_t word = 0; word < movementsPresent.size(); ++word) {
            const MaskWord required = movementsPresent[word];
            const MaskWord forbidden = word < movementsMissing.size() ? movementsMissing[word] : 0;
            if (required == 0 && forbidden == 0) {
                continue;
            }
            const std::string requiredLiteral = compiledMaskWordLiteral(required);
            const std::string forbiddenLiteral = compiledMaskWordLiteral(forbidden);
            if (required != 0 && forbidden != 0) {
                const std::string wordVar = movementVar + "_word_" + std::to_string(word);
                out << indent << "    const MaskWord " << wordVar << " = " << movementVar << "[" << word << "];\n"
                    << indent << "    if (((" << wordVar << " & " << requiredLiteral << ") != " << requiredLiteral
                    << ") || ((" << wordVar << " & " << forbiddenLiteral << ") != 0)) " << matchedFlagName << " = false;\n";
            } else if (required != 0) {
                out << indent << "    if (((" << movementVar << "[" << word << "] & " << requiredLiteral << ") != "
                    << requiredLiteral << ")) " << matchedFlagName << " = false;\n";
            } else {
                out << indent << "    if (((" << movementVar << "[" << word << "] & "
                    << forbiddenLiteral << ") != 0)) " << matchedFlagName << " = false;\n";
            }
        }
        out << indent << "}\n";
    }
}

void emitCompactFixedTileAtDirection(
    std::ostream& out,
    std::string_view indent,
    std::string_view suffix,
    std::string_view tileName,
    std::string_view originExpr,
    int32_t direction,
    int32_t distance,
    std::string_view invalidStatement
) {
    out << indent << "int32_t " << tileName << " = " << originExpr << ";\n";
    if (distance == 0 || direction == 16) {
        return;
    }

    switch (direction) {
        case 1:
            out << indent << "if ((" << originExpr << " % dimensions.height) < " << distance << ") " << invalidStatement << "\n"
                << indent << tileName << " = " << originExpr << " - " << distance << ";\n";
            return;
        case 2:
            out << indent << "if ((" << originExpr << " % dimensions.height) + " << distance << " >= dimensions.height) " << invalidStatement << "\n"
                << indent << tileName << " = " << originExpr << " + " << distance << ";\n";
            return;
        case 4:
            out << indent << "if ((" << originExpr << " / dimensions.height) < " << distance << ") " << invalidStatement << "\n"
                << indent << tileName << " = " << originExpr << " - " << distance << " * dimensions.height;\n";
            return;
        case 8:
            out << indent << "if ((" << originExpr << " / dimensions.height) + " << distance << " >= dimensions.width) " << invalidStatement << "\n"
                << indent << tileName << " = " << originExpr << " + " << distance << " * dimensions.height;\n";
            return;
        default:
            out << indent << "if (!compact_turn_cell_at_direction_" << suffix
                << "(dimensions, " << originExpr << ", " << direction << ", " << distance << ", " << tileName << ")) "
                << invalidStatement << "\n";
            return;
    }
}

struct CompactObjectAnchorGroup {
    int32_t patternIndex = -1;
    std::vector<int32_t> objectIds;
    bool requiresAll = false;
    bool coversPositiveLinePrecheck = false;
};

struct CompactMovementAnchorGroup {
    int32_t patternIndex = -1;
    std::vector<MaskWord> movements;
};

std::vector<int32_t> compactUniqueObjectIds(std::vector<int32_t> objectIds) {
    std::sort(objectIds.begin(), objectIds.end());
    objectIds.erase(std::unique(objectIds.begin(), objectIds.end()), objectIds.end());
    return objectIds;
}

void compactOrMaskWords(std::vector<MaskWord>& target, const std::vector<MaskWord>& source) {
    const size_t count = std::min(target.size(), source.size());
    for (size_t word = 0; word < count; ++word) {
        target[word] |= source[word];
    }
}

std::vector<MaskWord> compactObjectMaskForIds(const Game& game, const std::vector<int32_t>& objectIds) {
    std::vector<MaskWord> mask(static_cast<size_t>(game.wordCount), 0);
    for (const int32_t objectId : objectIds) {
        if (objectId < 0) {
            continue;
        }
        const uint32_t bitIndex = static_cast<uint32_t>(objectId);
        const uint32_t word = maskWordIndex(bitIndex);
        if (word >= mask.size()) {
            continue;
        }
        mask[static_cast<size_t>(word)] |= maskBit(bitIndex);
    }
    return mask;
}

bool compactMaskWordsCoverAll(const std::vector<MaskWord>& required, const std::vector<MaskWord>& available) {
    for (size_t word = 0; word < required.size(); ++word) {
        const MaskWord availableWord = word < available.size() ? available[word] : 0;
        if ((required[word] & ~availableWord) != 0) {
            return false;
        }
    }
    return true;
}

bool compactObjectAnchorCoversPositiveLinePrecheck(
    const Game& game,
    const CompactRowMaskInfo& rowMask,
    const CompactObjectAnchorGroup& group
) {
    if (anyMaskWordSet(rowMask.movementMaskWords)
        || anyMaskWordSet(rowMask.missingObjectMaskWords)
        || anyMaskWordSet(rowMask.missingMovementMaskWords)
        || rowMask.anyObjectMaskCount > 0
        || rowMask.anyMovementMaskCount > 0) {
        return false;
    }
    return compactMaskWordsCoverAll(
        rowMask.objectMaskWords,
        compactObjectMaskForIds(game, group.objectIds)
    );
}

std::vector<MaskWord> compactMovementAnchorMaskForPattern(const Game& game, const Pattern& pattern) {
    std::vector<MaskWord> movementMask(static_cast<size_t>(game.movementWordCount), 0);
    compactOrMaskWords(movementMask, compiledMaskWords(game, pattern.movementsPresent, game.movementWordCount));
    for (uint32_t anyIndex = 0; anyIndex < pattern.anyMovementsCount; ++anyIndex) {
        const size_t offsetIndex = static_cast<size_t>(pattern.anyMovementsFirst + anyIndex);
        const MaskOffset offset = offsetIndex < game.anyMovementOffsets.size()
            ? game.anyMovementOffsets[offsetIndex]
            : kNullMaskOffset;
        compactOrMaskWords(movementMask, compiledMaskWords(game, offset, game.movementWordCount));
    }
    for (const LayerCoupledMovementReplacement& coupled : pattern.layerCoupledMovementMasks) {
        for (const LayerCoupledMovementLayerTerm& layerTerm : coupled.layers) {
            compactOrMaskWords(movementMask, compiledMaskWords(game, layerTerm.movementsAny, game.movementWordCount));
            compactOrMaskWords(movementMask, compiledMaskWords(game, layerTerm.movementsPresent, game.movementWordCount));
        }
    }
    return movementMask;
}

std::vector<CompactObjectAnchorGroup> compactObjectAnchorGroupsForRow(const std::vector<Pattern>& row) {
    std::vector<CompactObjectAnchorGroup> groups;
    for (int32_t patternIndex = 0; patternIndex < static_cast<int32_t>(row.size()); ++patternIndex) {
        const Pattern& pattern = row[static_cast<size_t>(patternIndex)];
        if (pattern.kind != Pattern::Kind::CellPattern) {
            continue;
        }
        if (!pattern.objectAnchorIds.empty()) {
            groups.push_back(CompactObjectAnchorGroup{
                patternIndex,
                compactUniqueObjectIds(pattern.objectAnchorIds),
                true
            });
        }
        for (const std::vector<int32_t>& anyObjectIds : pattern.anyObjectAnchorIds) {
            if (!anyObjectIds.empty()) {
                groups.push_back(CompactObjectAnchorGroup{
                    patternIndex,
                    compactUniqueObjectIds(anyObjectIds),
                    false
                });
            }
        }
    }
    return groups;
}

std::vector<CompactMovementAnchorGroup> compactMovementAnchorGroupsForRow(const Game& game, const std::vector<Pattern>& row) {
    std::vector<CompactMovementAnchorGroup> groups;
    for (int32_t patternIndex = 0; patternIndex < static_cast<int32_t>(row.size()); ++patternIndex) {
        const Pattern& pattern = row[static_cast<size_t>(patternIndex)];
        if (pattern.kind != Pattern::Kind::CellPattern) {
            continue;
        }
        std::vector<MaskWord> movementMask = compactMovementAnchorMaskForPattern(game, pattern);
        if (anyMaskWordSet(movementMask)) {
            groups.push_back(CompactMovementAnchorGroup{
                patternIndex,
                std::move(movementMask)
            });
        }
    }
    return groups;
}

void emitCompactFixedRowMatchTests(
    std::ostream& out,
    const Game& game,
    const CompactMaskConstantEmitter& masks,
    const std::vector<Pattern>& row,
    std::string_view suffix,
    std::string_view phase,
    size_t groupIndex,
    size_t ruleIndex,
    size_t rowIndex,
    std::string_view indent,
    std::string_view startIndexExpr,
    int32_t direction,
    std::string_view tilePrefix,
    std::string_view matchedFlagName,
    std::string_view invalidStatement
) {
    for (size_t patternIndex = 0; patternIndex < row.size(); ++patternIndex) {
        const std::string tileName = std::string(tilePrefix) + std::to_string(patternIndex);
        emitCompactFixedTileAtDirection(
            out,
            indent,
            suffix,
            tileName,
            startIndexExpr,
            direction,
            static_cast<int32_t>(patternIndex),
            invalidStatement
        );
        if (compactPatternCanInlineMatch(row[patternIndex])) {
            emitCompactInlinePatternMatchTest(
                out,
                game,
                row[patternIndex],
                suffix,
                indent,
                tileName,
                tileName,
                matchedFlagName
            );
        } else {
            out << indent << "if (" << matchedFlagName << " && !"
                << compactPatternMatchesCall(game, masks, row[patternIndex], suffix, phase, groupIndex, ruleIndex, rowIndex, patternIndex, tileName)
                << ") " << matchedFlagName << " = false;\n";
        }
    }
}

void emitCompactFixedStartMatchCollection(
    std::ostream& out,
    const Game& game,
    const CompactMaskConstantEmitter& masks,
    const Rule& rule,
    const std::vector<Pattern>& row,
    const CompactRowMaskInfo& rowMask,
    std::string_view suffix,
    std::string_view phase,
    size_t groupIndex,
    size_t ruleIndex,
    size_t rowIndex,
    std::string_view indent,
    std::string_view matchVectorName,
    std::string_view tilePrefix,
    std::string_view failureReturnExpression = "false",
    bool callerAlreadyCheckedRuleBoardMask = false
) {
    emitCompactFixedRowScanBounds(out, rule, row.size(), indent, failureReturnExpression);
    if (rowMask.hasAnyRequiredMask && !callerAlreadyCheckedRuleBoardMask) {
        out << indent << "if (!(" << compactBoardRequiredMaskExpression(rowMask) << ")) return " << failureReturnExpression << ";\n";
    }

    const std::vector<CompactMovementAnchorGroup> movementAnchorGroups = compactMovementAnchorGroupsForRow(game, row);
    std::vector<CompactObjectAnchorGroup> objectAnchorGroups = compactObjectAnchorGroupsForRow(row);
    for (CompactObjectAnchorGroup& group : objectAnchorGroups) {
        group.coversPositiveLinePrecheck = compactObjectAnchorCoversPositiveLinePrecheck(game, rowMask, group);
    }
    const bool allObjectAnchorsCoverPositiveLinePrecheck = std::all_of(
        objectAnchorGroups.begin(),
        objectAnchorGroups.end(),
        [](const CompactObjectAnchorGroup& group) {
            return group.coversPositiveLinePrecheck;
        }
    );
    const bool anyObjectAnchorCoversPositiveLinePrecheck = std::any_of(
        objectAnchorGroups.begin(),
        objectAnchorGroups.end(),
        [](const CompactObjectAnchorGroup& group) {
            return group.coversPositiveLinePrecheck;
        }
    );
    const bool hasAnchorGroups = !movementAnchorGroups.empty() || !objectAnchorGroups.empty();
    auto emitIntArray = [&](std::string_view name, const std::vector<int32_t>& values) {
        out << indent << "constexpr int32_t " << name << "[] = {";
        for (size_t index = 0; index < values.size(); ++index) {
            if (index > 0) out << ", ";
            out << values[index];
        }
        out << "};\n";
    };
    if (hasAnchorGroups) {
        out << indent << "bool usedAnchorScan = false;\n";
    }
    std::string movementFallbackSource;
    if (!movementAnchorGroups.empty()) {
        const bool movementAnchorScansNeedSort = rule.direction > 2 || !std::all_of(
            movementAnchorGroups.begin(),
            movementAnchorGroups.end(),
            [](const CompactMovementAnchorGroup& group) {
                return compactMaskBitCount(group.movements) == 1;
            }
        );
        std::vector<int32_t> movementAnchorPatternIndexes;
        for (const CompactMovementAnchorGroup& group : movementAnchorGroups) {
            movementAnchorPatternIndexes.push_back(group.patternIndex);
        }
        emitIntArray("movementAnchorPatternIndexes", movementAnchorPatternIndexes);
        out << indent << "constexpr const MaskWord* movementAnchorMasks[] = {";
        for (size_t groupIndex = 0; groupIndex < movementAnchorGroups.size(); ++groupIndex) {
            if (groupIndex > 0) out << ", ";
            out << masks.name(movementAnchorGroups[groupIndex].movements);
        }
        out << "};\n"
            << indent << "if (!usedAnchorScan && compact_turn_prepare_movement_cell_index_" << suffix << "(dimensions, scratch)) {\n"
            << indent << "    const int32_t movementCellWordCount = compact_turn_movement_cell_word_count_" << suffix << "(dimensions);\n"
            << indent << "    const int32_t movementBitCount = compact_turn_movement_stride_" << suffix << " * static_cast<int32_t>(kMaskWordBits);\n"
            << indent << "    int32_t movementAnchorGroup = -1;\n"
            << indent << "    uint64_t movementAnchorCellCount = 0;\n"
            << indent << "    for (int32_t groupIndex = 0; groupIndex < " << movementAnchorGroups.size() << "; ++groupIndex) {\n"
            << indent << "        uint64_t groupCellCount = 0;\n"
            << indent << "        for (int32_t word = 0; word < compact_turn_movement_stride_" << suffix << "; ++word) {\n"
            << indent << "            MaskWordUnsigned movementBits = static_cast<MaskWordUnsigned>(movementAnchorMasks[groupIndex][word]);\n"
            << indent << "            while (movementBits != 0) {\n"
            << indent << "                const int32_t bit = maskWordCountTrailingZeros(movementBits);\n"
            << indent << "                movementBits &= movementBits - 1;\n"
            << indent << "                const int32_t movementBit = word * static_cast<int32_t>(kMaskWordBits) + bit;\n"
            << indent << "                if (movementBit >= 0 && movementBit < movementBitCount && static_cast<size_t>(movementBit) < scratch.movementCellCounts.size()) {\n"
            << indent << "                    groupCellCount += scratch.movementCellCounts[static_cast<size_t>(movementBit)];\n"
            << indent << "                }\n"
            << indent << "            }\n"
            << indent << "        }\n"
            << indent << "        if (movementAnchorGroup < 0 || groupCellCount < movementAnchorCellCount) {\n"
            << indent << "            movementAnchorGroup = groupIndex;\n"
            << indent << "            movementAnchorCellCount = groupCellCount;\n"
            << indent << "        }\n"
            << indent << "    }\n"
            << indent << "    const uint64_t validStartCount = static_cast<uint64_t>(primaryLimit) * static_cast<uint64_t>(secondarySpan);\n"
            << indent << "    if (movementAnchorGroup >= 0 && movementAnchorCellCount == 0) {\n"
            << indent << "        usedAnchorScan = true;\n"
            << indent << "    } else if (movementAnchorGroup >= 0 && movementAnchorCellCount < std::max<uint64_t>(8, validStartCount)) {\n"
            << indent << "        int32_t anchorDx = 0;\n"
            << indent << "        int32_t anchorDy = 0;\n"
            << indent << "        if (compact_turn_direction_delta_" << suffix << "(" << rule.direction << ", anchorDx, anchorDy)) {\n"
            << indent << "            usedAnchorScan = true;\n"
            << indent << "            const int32_t anchorPatternIndex = movementAnchorPatternIndexes[movementAnchorGroup];\n"
            << indent << "            for (int32_t word = 0; word < compact_turn_movement_stride_" << suffix << "; ++word) {\n"
            << indent << "                MaskWordUnsigned movementBits = static_cast<MaskWordUnsigned>(movementAnchorMasks[movementAnchorGroup][word]);\n"
            << indent << "                while (movementBits != 0) {\n"
            << indent << "                    const int32_t movementMaskBit = maskWordCountTrailingZeros(movementBits);\n"
            << indent << "                    movementBits &= movementBits - 1;\n"
            << indent << "                    const int32_t movementBit = word * static_cast<int32_t>(kMaskWordBits) + movementMaskBit;\n"
            << indent << "                    if (movementBit < 0 || movementBit >= movementBitCount) continue;\n"
            << indent << "                    const size_t movementBase = static_cast<size_t>(movementBit) * static_cast<size_t>(movementCellWordCount);\n"
            << indent << "                    if (movementBase + static_cast<size_t>(movementCellWordCount) > scratch.movementCellBits.size()) continue;\n"
            << indent << "                    for (int32_t cellWord = 0; cellWord < movementCellWordCount; ++cellWord) {\n"
            << indent << "                        MaskWordUnsigned cellBits = scratch.movementCellBits[movementBase + static_cast<size_t>(cellWord)];\n"
            << indent << "                        while (cellBits != 0) {\n"
            << indent << "                            const int32_t cellBit = maskWordCountTrailingZeros(cellBits);\n"
            << indent << "                            cellBits &= cellBits - 1;\n"
            << indent << "                            const int32_t anchorTile = cellWord * static_cast<int32_t>(kMaskWordBits) + cellBit;\n"
            << indent << "                            if (anchorTile >= tileCount) continue;\n"
            << indent << "                            const int32_t anchorX = anchorTile / dimensions.height;\n"
            << indent << "                            const int32_t anchorY = anchorTile % dimensions.height;\n"
            << indent << "                            const int32_t startX = anchorX - anchorPatternIndex * anchorDx;\n"
            << indent << "                            const int32_t startY = anchorY - anchorPatternIndex * anchorDy;\n"
            << indent << "                            if (!compact_turn_in_bounds_" << suffix << "(dimensions, startX, startY)) continue;\n"
            << indent << "                            const int32_t secondary = horizontalScan ? startX : startY;\n"
            << indent << "                            if (secondary < secondaryStart || secondary >= secondaryEnd) continue;\n"
            << indent << "                            const int32_t primary = horizontalScan ? startY : startX;\n";
        if (rowMask.hasAnyLinePrecondition) {
            out << indent << "                            if (!compact_turn_line_has_required_masks_" << suffix
                << "(dimensions, levelState, scratch, horizontalScan, primary, "
                << rowMask.objectMaskName << ", " << rowMask.movementMaskName << ", "
                << rowMask.missingObjectMaskName << ", " << rowMask.missingMovementMaskName << ", "
                << rowMask.anyObjectMasksName << ", " << rowMask.anyObjectMaskCount << ", "
                << rowMask.anyMovementMasksName << ", " << rowMask.anyMovementMaskCount << ")) continue;\n";
        }
        out << indent << "                            compact_turn_count_candidate_cells_tested_" << suffix << "();\n"
            << indent << "                            const int32_t startIndex = compact_turn_tile_index_" << suffix << "(dimensions, startX, startY);\n"
            << indent << "                            bool matched = true;\n";
        emitCompactFixedRowMatchTests(
            out,
            game,
            masks,
            row,
            suffix,
            phase,
            groupIndex,
            ruleIndex,
            rowIndex,
            std::string(indent) + "                            ",
            "startIndex",
            rule.direction,
            tilePrefix,
            "matched",
            "matched = false;"
        );
        out << indent << "                            if (matched) " << matchVectorName << ".push_back(startIndex);\n"
            << indent << "                        }\n"
            << indent << "                    }\n"
            << indent << "                }\n"
            << indent << "            }\n";
        if (movementAnchorScansNeedSort) {
            out << indent << "            compact_turn_sort_unique_start_matches_" << suffix << "(dimensions, horizontalScan, " << matchVectorName << ");\n";
        }
        out << indent << "        }\n"
            << indent << "    }\n"
            << indent << "}\n";

        // The full movement-bit-to-cell index is too large for some embedded games.
        // When it is disabled, scan the compact live movement board once to choose a
        // sparse anchor, then test only the cells containing that movement. This uses
        // no additional session memory and still leaves dense patterns to the object
        // anchor or ordinary row-scan fallbacks below.
        std::ostringstream movementFallbackOut;
        movementFallbackOut << indent << "if (!usedAnchorScan && !compact_turn_enable_movement_cell_index_" << suffix << ") {\n"
            << indent << "    int32_t movementAnchorGroup = -1;\n"
            << indent << "    uint64_t movementAnchorCellCount = 0;\n"
            << indent << "    for (int32_t groupIndex = 0; groupIndex < " << movementAnchorGroups.size() << "; ++groupIndex) {\n"
            << indent << "        uint64_t groupCellCount = 0;\n"
            << indent << "        for (int32_t anchorTile = 0; anchorTile < tileCount; ++anchorTile) {\n"
            << indent << "            const MaskWord* cellMovements = compact_turn_cell_movements_" << suffix << "(scratch, anchorTile);\n"
            << indent << "            bool hasMovementAnchor = false;\n"
            << indent << "            for (int32_t word = 0; word < compact_turn_movement_stride_" << suffix << "; ++word) {\n"
            << indent << "                if ((cellMovements[word] & movementAnchorMasks[groupIndex][word]) != 0) {\n"
            << indent << "                    hasMovementAnchor = true;\n"
            << indent << "                    break;\n"
            << indent << "                }\n"
            << indent << "            }\n"
            << indent << "            if (hasMovementAnchor) ++groupCellCount;\n"
            << indent << "        }\n"
            << indent << "        if (movementAnchorGroup < 0 || groupCellCount < movementAnchorCellCount) {\n"
            << indent << "            movementAnchorGroup = groupIndex;\n"
            << indent << "            movementAnchorCellCount = groupCellCount;\n"
            << indent << "        }\n"
            << indent << "    }\n"
            << indent << "    const uint64_t validStartCount = static_cast<uint64_t>(primaryLimit) * static_cast<uint64_t>(secondarySpan);\n"
            << indent << "    if (movementAnchorGroup >= 0 && movementAnchorCellCount == 0) {\n"
            << indent << "        usedAnchorScan = true;\n"
            << indent << "    } else if (movementAnchorGroup >= 0 && movementAnchorCellCount < std::max<uint64_t>(8, validStartCount)) {\n"
            << indent << "        int32_t anchorDx = 0;\n"
            << indent << "        int32_t anchorDy = 0;\n"
            << indent << "        if (compact_turn_direction_delta_" << suffix << "(" << rule.direction << ", anchorDx, anchorDy)) {\n"
            << indent << "            usedAnchorScan = true;\n"
            << indent << "            const int32_t anchorPatternIndex = movementAnchorPatternIndexes[movementAnchorGroup];\n"
            << indent << "            for (int32_t anchorTile = 0; anchorTile < tileCount; ++anchorTile) {\n"
            << indent << "                const MaskWord* cellMovements = compact_turn_cell_movements_" << suffix << "(scratch, anchorTile);\n"
            << indent << "                bool hasMovementAnchor = false;\n"
            << indent << "                for (int32_t word = 0; word < compact_turn_movement_stride_" << suffix << "; ++word) {\n"
            << indent << "                    if ((cellMovements[word] & movementAnchorMasks[movementAnchorGroup][word]) != 0) {\n"
            << indent << "                        hasMovementAnchor = true;\n"
            << indent << "                        break;\n"
            << indent << "                    }\n"
            << indent << "                }\n"
            << indent << "                if (!hasMovementAnchor) continue;\n"
            << indent << "                const int32_t anchorX = anchorTile / dimensions.height;\n"
            << indent << "                const int32_t anchorY = anchorTile % dimensions.height;\n"
            << indent << "                const int32_t startX = anchorX - anchorPatternIndex * anchorDx;\n"
            << indent << "                const int32_t startY = anchorY - anchorPatternIndex * anchorDy;\n"
            << indent << "                if (!compact_turn_in_bounds_" << suffix << "(dimensions, startX, startY)) continue;\n"
            << indent << "                const int32_t secondary = horizontalScan ? startX : startY;\n"
            << indent << "                if (secondary < secondaryStart || secondary >= secondaryEnd) continue;\n"
            << indent << "                const int32_t primary = horizontalScan ? startY : startX;\n";
        if (rowMask.hasAnyLinePrecondition) {
            movementFallbackOut << indent << "                if (!compact_turn_line_has_required_masks_" << suffix
                << "(dimensions, levelState, scratch, horizontalScan, primary, "
                << rowMask.objectMaskName << ", " << rowMask.movementMaskName << ", "
                << rowMask.missingObjectMaskName << ", " << rowMask.missingMovementMaskName << ", "
                << rowMask.anyObjectMasksName << ", " << rowMask.anyObjectMaskCount << ", "
                << rowMask.anyMovementMasksName << ", " << rowMask.anyMovementMaskCount << ")) continue;\n";
        }
        movementFallbackOut << indent << "                compact_turn_count_candidate_cells_tested_" << suffix << "();\n"
            << indent << "                const int32_t startIndex = compact_turn_tile_index_" << suffix << "(dimensions, startX, startY);\n"
            << indent << "                bool matched = true;\n";
        emitCompactFixedRowMatchTests(
            movementFallbackOut,
            game,
            masks,
            row,
            suffix,
            phase,
            groupIndex,
            ruleIndex,
            rowIndex,
            std::string(indent) + "                ",
            "startIndex",
            rule.direction,
            tilePrefix,
            "matched",
            "matched = false;"
        );
        movementFallbackOut << indent << "                if (matched) " << matchVectorName << ".push_back(startIndex);\n"
            << indent << "            }\n";
        if (movementAnchorScansNeedSort) {
            movementFallbackOut << indent << "            compact_turn_sort_unique_start_matches_" << suffix << "(dimensions, horizontalScan, " << matchVectorName << ");\n";
        }
        movementFallbackOut << indent << "        }\n"
            << indent << "    }\n"
            << indent << "}\n";
        movementFallbackSource = movementFallbackOut.str();
    }
    if (!objectAnchorGroups.empty()) {
        const bool objectAnchorScansNeedSort = rule.direction > 2 || !std::all_of(
            objectAnchorGroups.begin(),
            objectAnchorGroups.end(),
            [](const CompactObjectAnchorGroup& group) {
                return group.requiresAll;
            }
        );
        std::vector<int32_t> objectAnchorPatternIndexes;
        std::vector<int32_t> objectAnchorFirsts;
        std::vector<int32_t> objectAnchorCounts;
        std::vector<int32_t> objectAnchorObjectIds;
        std::vector<int32_t> objectAnchorRequiresAll;
        std::vector<int32_t> objectAnchorCoversPositiveLinePrecheck;
        const bool needsObjectAnchorLinePrecheckGuards = rowMask.hasAnyLinePrecondition
            && !allObjectAnchorsCoverPositiveLinePrecheck
            && anyObjectAnchorCoversPositiveLinePrecheck;
        for (const CompactObjectAnchorGroup& group : objectAnchorGroups) {
            objectAnchorPatternIndexes.push_back(group.patternIndex);
            objectAnchorFirsts.push_back(static_cast<int32_t>(objectAnchorObjectIds.size()));
            objectAnchorCounts.push_back(static_cast<int32_t>(group.objectIds.size()));
            objectAnchorRequiresAll.push_back(group.requiresAll ? 1 : 0);
            if (needsObjectAnchorLinePrecheckGuards) {
                objectAnchorCoversPositiveLinePrecheck.push_back(group.coversPositiveLinePrecheck ? 1 : 0);
            }
            objectAnchorObjectIds.insert(objectAnchorObjectIds.end(), group.objectIds.begin(), group.objectIds.end());
        }

        emitIntArray("objectAnchorPatternIndexes", objectAnchorPatternIndexes);
        emitIntArray("objectAnchorFirsts", objectAnchorFirsts);
        emitIntArray("objectAnchorCounts", objectAnchorCounts);
        emitIntArray("objectAnchorRequiresAll", objectAnchorRequiresAll);
        if (needsObjectAnchorLinePrecheckGuards) {
            emitIntArray("objectAnchorCoversPositiveLinePrecheck", objectAnchorCoversPositiveLinePrecheck);
        }
        emitIntArray("objectAnchorObjectIds", objectAnchorObjectIds);
        out << indent << "if (!usedAnchorScan && compact_turn_prepare_object_cell_index_" << suffix << "(dimensions, levelState, scratch)) {\n"
            << indent << "    const int32_t objectCellWordCount = compact_turn_object_cell_word_count_" << suffix << "(dimensions);\n"
            << indent << "    int32_t objectAnchorGroup = -1;\n"
            << indent << "    int32_t objectAnchorObjectOffset = -1;\n"
            << indent << "    uint64_t objectAnchorCellCount = 0;\n"
            << indent << "    for (int32_t groupIndex = 0; groupIndex < " << objectAnchorGroups.size() << "; ++groupIndex) {\n"
            << indent << "        uint64_t groupCellCount = 0;\n"
            << indent << "        int32_t groupObjectOffset = -1;\n"
            << indent << "        for (int32_t offset = 0; offset < objectAnchorCounts[groupIndex]; ++offset) {\n"
            << indent << "            const int32_t objectId = objectAnchorObjectIds[objectAnchorFirsts[groupIndex] + offset];\n"
            << indent << "            if (objectId >= 0 && objectId < compact_turn_object_count_" << suffix
            << " && static_cast<size_t>(objectId) < compact_turn_object_cell_counts_" << suffix << "(scratch).size()) {\n"
            << indent << "                const uint64_t objectCellCount = compact_turn_object_cell_counts_" << suffix << "(scratch)[static_cast<size_t>(objectId)];\n"
            << indent << "                if (objectAnchorRequiresAll[groupIndex] == 0) {\n"
            << indent << "                    groupCellCount += objectCellCount;\n"
            << indent << "                    groupObjectOffset = 0;\n"
            << indent << "                } else if (groupObjectOffset < 0 || objectCellCount < groupCellCount) {\n"
            << indent << "                    groupObjectOffset = offset;\n"
            << indent << "                    groupCellCount = objectCellCount;\n"
            << indent << "                }\n"
            << indent << "            }\n"
            << indent << "        }\n"
            << indent << "        if (groupObjectOffset >= 0 && (objectAnchorGroup < 0 || groupCellCount < objectAnchorCellCount)) {\n"
            << indent << "            objectAnchorGroup = groupIndex;\n"
            << indent << "            objectAnchorObjectOffset = groupObjectOffset;\n"
            << indent << "            objectAnchorCellCount = groupCellCount;\n"
            << indent << "        }\n"
            << indent << "    }\n"
            << indent << "    const uint64_t validStartCount = static_cast<uint64_t>(primaryLimit) * static_cast<uint64_t>(secondarySpan);\n"
            << indent << "    if (objectAnchorGroup >= 0 && objectAnchorCellCount == 0) {\n"
            << indent << "        usedAnchorScan = true;\n"
            << indent << "    } else if (objectAnchorGroup >= 0 && objectCellWordCount > 0 && objectAnchorCellCount < std::max<uint64_t>(8, validStartCount)) {\n"
            << indent << "        int32_t anchorDx = 0;\n"
            << indent << "        int32_t anchorDy = 0;\n"
            << indent << "        if (compact_turn_direction_delta_" << suffix << "(" << rule.direction << ", anchorDx, anchorDy)) {\n"
            << indent << "            usedAnchorScan = true;\n"
            << indent << "            const int32_t anchorPatternIndex = objectAnchorPatternIndexes[objectAnchorGroup];\n"
            << indent << "            const int32_t objectOffsetBegin = objectAnchorRequiresAll[objectAnchorGroup] != 0 ? objectAnchorObjectOffset : 0;\n"
            << indent << "            const int32_t objectOffsetEnd = objectAnchorRequiresAll[objectAnchorGroup] != 0 ? objectAnchorObjectOffset + 1 : objectAnchorCounts[objectAnchorGroup];\n"
            << indent << "            for (int32_t offset = objectOffsetBegin; offset < objectOffsetEnd; ++offset) {\n"
            << indent << "            const int32_t objectId = objectAnchorObjectIds[objectAnchorFirsts[objectAnchorGroup] + offset];\n"
            << indent << "            if (objectId >= 0 && objectId < compact_turn_object_count_" << suffix << ") {\n"
            << indent << "                const size_t objectBase = static_cast<size_t>(objectId) * static_cast<size_t>(objectCellWordCount);\n"
            << indent << "                if (objectBase + static_cast<size_t>(objectCellWordCount) <= compact_turn_object_cell_bits_" << suffix << "(scratch).size()) {\n"
            << indent << "                    for (int32_t wordIndex = 0; wordIndex < objectCellWordCount; ++wordIndex) {\n"
            << indent << "                        MaskWordUnsigned bits = compact_turn_object_cell_bits_" << suffix << "(scratch)[objectBase + static_cast<size_t>(wordIndex)];\n"
            << indent << "                        while (bits != 0) {\n"
            << indent << "                            const int32_t bit = maskWordCountTrailingZeros(bits);\n"
            << indent << "                            bits &= bits - 1;\n"
            << indent << "                            const int32_t anchorTile = wordIndex * static_cast<int32_t>(kMaskWordBits) + bit;\n"
            << indent << "                            if (anchorTile >= tileCount) continue;\n"
            << indent << "                            const int32_t anchorX = anchorTile / dimensions.height;\n"
            << indent << "                            const int32_t anchorY = anchorTile % dimensions.height;\n"
            << indent << "                            const int32_t startX = anchorX - anchorPatternIndex * anchorDx;\n"
            << indent << "                            const int32_t startY = anchorY - anchorPatternIndex * anchorDy;\n"
            << indent << "                            if (!compact_turn_in_bounds_" << suffix << "(dimensions, startX, startY)) continue;\n"
            << indent << "                            const int32_t secondary = horizontalScan ? startX : startY;\n"
            << indent << "                            if (secondary < secondaryStart || secondary >= secondaryEnd) continue;\n"
            << indent << "                            const int32_t primary = horizontalScan ? startY : startX;\n";
        if (rowMask.hasAnyLinePrecondition && !allObjectAnchorsCoverPositiveLinePrecheck) {
            out << indent << "                            if (";
            if (needsObjectAnchorLinePrecheckGuards) {
                out << "objectAnchorCoversPositiveLinePrecheck[objectAnchorGroup] == 0 && ";
            }
            out << "!compact_turn_line_has_required_masks_" << suffix
                << "(dimensions, levelState, scratch, horizontalScan, primary, "
                << rowMask.objectMaskName << ", " << rowMask.movementMaskName << ", "
                << rowMask.missingObjectMaskName << ", " << rowMask.missingMovementMaskName << ", "
                << rowMask.anyObjectMasksName << ", " << rowMask.anyObjectMaskCount << ", "
                << rowMask.anyMovementMasksName << ", " << rowMask.anyMovementMaskCount << ")) continue;\n";
        }
        out << indent << "                            compact_turn_count_candidate_cells_tested_" << suffix << "();\n"
            << indent << "                            const int32_t startIndex = compact_turn_tile_index_" << suffix << "(dimensions, startX, startY);\n"
            << indent << "                            bool matched = true;\n";
        emitCompactFixedRowMatchTests(
            out,
            game,
            masks,
            row,
            suffix,
            phase,
            groupIndex,
            ruleIndex,
            rowIndex,
            std::string(indent) + "                            ",
            "startIndex",
            rule.direction,
            tilePrefix,
            "matched",
            "matched = false;"
        );
        out << indent << "                            if (matched) " << matchVectorName << ".push_back(startIndex);\n"
            << indent << "                        }\n"
            << indent << "                    }\n"
            << indent << "                }\n"
            << indent << "            }\n"
            << indent << "            }\n";
        if (objectAnchorScansNeedSort) {
            out << indent << "            compact_turn_sort_unique_start_matches_" << suffix << "(dimensions, horizontalScan, " << matchVectorName << ");\n";
        }
        out << indent << "        }\n"
            << indent << "    }\n"
            << indent << "}\n";
    }

    out << movementFallbackSource;

    if (hasAnchorGroups) {
        out << indent << "if (!usedAnchorScan) {\n";
    }
    const std::string scanIndent = hasAnchorGroups ? std::string(indent) + "    " : std::string(indent);
    out << scanIndent << "for (int32_t primary = 0; primary < primaryLimit; ++primary) {\n"
        << scanIndent << "    compact_turn_count_row_scans_" << suffix << "();\n";
    if (rowMask.hasAnyLinePrecondition) {
        out << scanIndent << "    if (!compact_turn_line_has_required_masks_" << suffix
            << "(dimensions, levelState, scratch, horizontalScan, primary, "
            << rowMask.objectMaskName << ", " << rowMask.movementMaskName << ", "
            << rowMask.missingObjectMaskName << ", " << rowMask.missingMovementMaskName << ", "
            << rowMask.anyObjectMasksName << ", " << rowMask.anyObjectMaskCount << ", "
            << rowMask.anyMovementMasksName << ", " << rowMask.anyMovementMaskCount << ")) continue;\n";
    }
    out << scanIndent << "    compact_turn_count_candidate_cells_tested_" << suffix << "(static_cast<uint64_t>(secondarySpan));\n"
        << scanIndent << "    const int32_t scanStep = horizontalScan ? dimensions.height : 1;\n"
        << scanIndent << "    int32_t startIndex = horizontalScan\n"
        << scanIndent << "        ? secondaryStart * dimensions.height + primary\n"
        << scanIndent << "        : primary * dimensions.height + secondaryStart;\n"
        << scanIndent << "    for (int32_t secondary = secondaryStart; secondary < secondaryEnd; ++secondary, startIndex += scanStep) {\n"
        << scanIndent << "        bool matched = true;\n";
    emitCompactFixedRowMatchTests(
        out,
        game,
        masks,
        row,
        suffix,
        phase,
        groupIndex,
        ruleIndex,
        rowIndex,
        scanIndent + "        ",
        "startIndex",
        rule.direction,
        tilePrefix,
        "matched",
        "matched = false;"
    );
    out << scanIndent << "        if (matched) " << matchVectorName << ".push_back(startIndex);\n"
        << scanIndent << "    }\n"
        << scanIndent << "}\n";
    if (hasAnchorGroups) {
        out << indent << "}\n";
    }
}

std::string compactPatternApplyCall(
    const Game& game,
    const CompactMaskConstantEmitter& masks,
    const Pattern& pattern,
    std::string_view suffix,
    std::string_view phase,
    size_t groupIndex,
    size_t ruleIndex,
    size_t rowIndex,
    size_t patternIndex,
    std::string_view tileIndexExpr,
    std::string_view rigidGroupIndexExpr,
    std::string_view aggregateCapturesExpr,
    std::string_view aggregateCaptureCountExpr
) {
    const std::string prefix = compactPatternPrefix(suffix, phase, groupIndex, ruleIndex, rowIndex, patternIndex);
    const Replacement& replacement = *pattern.replacement;
    const size_t layerCoupledMovementTermCount = compactLayerCoupledMovementTermCount(replacement);
    const size_t inferredAggregateTermCount = compactInferredAggregateTermCount(replacement);
    std::ostringstream call;
    call << "compact_turn_pattern_apply_" << suffix << "(dimensions, levelState, scratch, " << tileIndexExpr
         << ", " << rigidGroupIndexExpr
         << ", " << compactMaskName(masks, game, replacement.objectsClear, game.wordCount)
         << ", " << compactMaskName(masks, game, replacement.objectsSet, game.wordCount)
         << ", " << compactMaskName(masks, game, replacement.movementsClear, game.movementWordCount)
         << ", " << compactMaskName(masks, game, replacement.movementsSet, game.movementWordCount)
         << ", " << compactMaskName(masks, game, replacement.movementsLayerMask, game.movementWordCount)
         << ", " << (replacement.hasRandomEntityMask ? prefix + "_random_entity_choices" : "nullptr")
         << ", " << (replacement.hasRandomEntityMask ? prefix + "_random_entity_choice_count" : "0")
         << ", " << (replacement.hasRandomDirMask ? prefix + "_random_dir_layers" : "nullptr")
         << ", " << (replacement.hasRandomDirMask ? prefix + "_random_dir_layer_count" : "0")
         << ", " << (layerCoupledMovementTermCount > 0 ? prefix + "_layer_coupled_movement_terms" : "nullptr")
         << ", " << layerCoupledMovementTermCount
         << ", " << (inferredAggregateTermCount > 0 ? prefix + "_inferred_aggregate_terms" : "nullptr")
         << ", " << inferredAggregateTermCount
         << ", " << aggregateCapturesExpr
         << ", " << aggregateCaptureCountExpr
         << ")";
    return call.str();
}

bool compactReplacementHasDynamicTerms(const Replacement& replacement) {
    if (replacement.hasRandomEntityMask || replacement.hasRandomDirMask) {
        return true;
    }
    const ReplacementDynamic* dynamic = replacement.dynamic.get();
    if (dynamic == nullptr) {
        return false;
    }
    return !dynamic->layerCoupledMovementReplacements.empty()
        || !dynamic->inferredAggregateBindings.empty()
        || !dynamic->inferredPropertyBindings.empty()
        || !dynamic->inferredPropertySources.empty()
        || dynamic->rhsPropertyPreserveMask != kNullMaskOffset;
}

std::vector<MaskWord> compactMovementMissingWordsIncludingSingleDirectionExclusivity(
    const Game& game,
    const std::vector<MaskWord>& movementPresentWords,
    const std::vector<MaskWord>& explicitMovementMissingWords
) {
    std::vector<MaskWord> movementMissingWords = explicitMovementMissingWords;
    for (int32_t layer = 0; layer < game.layerCount; ++layer) {
        const uint32_t firstBit = static_cast<uint32_t>(layer * 5);
        int32_t presentBits = 0;
        for (uint32_t directionBit = 0; directionBit < 5; ++directionBit) {
            const uint32_t bitIndex = firstBit + directionBit;
            const uint32_t word = maskWordIndex(bitIndex);
            if (static_cast<size_t>(word) < movementPresentWords.size()
                && (movementPresentWords[static_cast<size_t>(word)] & maskBit(bitIndex)) != 0) {
                presentBits |= 1 << directionBit;
            }
        }
        if (maskWordPopcount(static_cast<MaskWordUnsigned>(presentBits)) != 1) {
            continue;
        }
        // Static compact replacements clear a movement layer before setting
        // one concrete direction. Direction aggregates are specialized before
        // code generation, so a matched concrete direction excludes the other
        // four bits on that layer throughout this fast path.
        for (uint32_t directionBit = 0; directionBit < 5; ++directionBit) {
            if ((presentBits & (1 << directionBit)) != 0) continue;
            const uint32_t bitIndex = firstBit + directionBit;
            const uint32_t word = maskWordIndex(bitIndex);
            if (static_cast<size_t>(word) < movementMissingWords.size()) {
                movementMissingWords[static_cast<size_t>(word)] |= maskBit(bitIndex);
            }
        }
    }
    return movementMissingWords;
}

CompactReplacementGuaranteedNoopSides compactStaticReplacementGuaranteedNoopSidesOnMatchedCell(
    const Game& game,
    const Pattern& pattern,
    const Replacement& replacement,
    bool assumeSingleDirectionPerLayer
) {
    CompactReplacementGuaranteedNoopSides result;
    const std::vector<MaskWord> objectClearWords = compiledMaskWords(game, replacement.objectsClear, game.wordCount);
    const std::vector<MaskWord> objectSetWords = compiledMaskWords(game, replacement.objectsSet, game.wordCount);
    const std::vector<MaskWord> objectPresentWords = compiledMaskWords(game, pattern.objectsPresent, game.wordCount);
    const std::vector<MaskWord> objectMissingWords = compactObjectMissingWordsIncludingLayerExclusivity(
        game,
        objectPresentWords,
        compiledMaskWords(game, pattern.objectsMissing, game.wordCount)
    );
    result.objects = true;
    for (size_t word = 0; word < objectClearWords.size(); ++word) {
        const MaskWord objectSetNeeds = objectSetWords[word] & ~objectPresentWords[word];
        const MaskWord objectClearOnly = objectClearWords[word] & ~objectSetWords[word];
        const MaskWord objectClearNeeds = objectClearOnly & ~objectMissingWords[word];
        if (objectSetNeeds != 0 || objectClearNeeds != 0) {
            result.objects = false;
            break;
        }
    }

    const std::vector<MaskWord> movementClearWords = compiledMaskWords(game, replacement.movementsClear, game.movementWordCount);
    const std::vector<MaskWord> movementSetWords = compiledMaskWords(game, replacement.movementsSet, game.movementWordCount);
    const std::vector<MaskWord> movementLayerWords = compiledMaskWords(game, replacement.movementsLayerMask, game.movementWordCount);
    const std::vector<MaskWord> movementPresentWords = compiledMaskWords(game, pattern.movementsPresent, game.movementWordCount);
    std::vector<MaskWord> movementMissingWords = compiledMaskWords(game, pattern.movementsMissing, game.movementWordCount);
    if (assumeSingleDirectionPerLayer) {
        movementMissingWords = compactMovementMissingWordsIncludingSingleDirectionExclusivity(
            game,
            movementPresentWords,
            movementMissingWords
        );
    }
    result.movements = true;
    for (size_t word = 0; word < movementClearWords.size(); ++word) {
        const MaskWord movementClear = movementClearWords[word] | movementLayerWords[word];
        const MaskWord movementSetNeeds = movementSetWords[word] & ~movementPresentWords[word];
        const MaskWord movementClearOnly = movementClear & ~movementSetWords[word];
        const MaskWord movementClearNeeds = movementClearOnly & ~movementMissingWords[word];
        if (movementSetNeeds != 0 || movementClearNeeds != 0) {
            result.movements = false;
            break;
        }
    }
    return result;
}

CompactReplacementGuaranteedNoopSides compactReplacementGuaranteedNoopSidesOnMatchedCell(
    const Game& game,
    const Pattern& pattern,
    const Replacement& replacement
) {
    if (compactReplacementHasDynamicTerms(replacement)) {
        return {};
    }
    return compactStaticReplacementGuaranteedNoopSidesOnMatchedCell(
        game,
        pattern,
        replacement,
        false
    );
}

bool compactReplacementGuaranteedNoopOnMatchedCell(
    const Game& game,
    const Pattern& pattern,
    const Replacement& replacement
) {
    const CompactReplacementGuaranteedNoopSides sides =
        compactReplacementGuaranteedNoopSidesOnMatchedCell(game, pattern, replacement);
    return sides.objects && sides.movements;
}

bool compactPatternReplacementGuaranteedNoopOnMatch(const Game& game, const Pattern& pattern) {
    if (!pattern.replacement.has_value()) {
        return false;
    }
    return compactReplacementGuaranteedNoopOnMatchedCell(game, pattern, *pattern.replacement);
}

CompactRuleEffectiveWriteSummary compactRuleEffectiveWriteSummary(const Game& game, const Rule& rule) {
    CompactRuleEffectiveWriteSummary summary;
    if (!rule.hasWriteObjects && !rule.hasWriteMovements) {
        return summary;
    }
    for (const std::vector<Pattern>& row : rule.patterns) {
        for (const Pattern& pattern : row) {
            if (!pattern.replacement.has_value()) {
                continue;
            }
            const Replacement& replacement = *pattern.replacement;
            if (compactReplacementHasDynamicTerms(replacement)) {
                // Runtime write masks do not include every write performed by
                // captured property/aggregate replacements.  In particular,
                // `[ > property | ... ] -> [ | property ]` can move the
                // captured object while hasWriteObjects is false.  Treat the
                // dynamic terms themselves as writes so the generated kernel
                // refreshes its board masks and object-cell index before the
                // next rule group.
                const ReplacementDynamic* dynamic = replacement.dynamic.get();
                summary.objects = summary.objects
                    || replacement.hasRandomEntityMask
                    || (dynamic != nullptr
                        && (!dynamic->inferredAggregateBindings.empty()
                            || !dynamic->inferredPropertyBindings.empty()
                            || !dynamic->inferredPropertySources.empty()
                            || dynamic->rhsPropertyPreserveMask != kNullMaskOffset))
                    || anyMaskWordSet(compiledMaskWords(game, replacement.objectsClear, game.wordCount))
                    || anyMaskWordSet(compiledMaskWords(game, replacement.objectsSet, game.wordCount));
                summary.movements = summary.movements
                    || replacement.hasRandomDirMask
                    || (dynamic != nullptr && !dynamic->layerCoupledMovementReplacements.empty())
                    || anyMaskWordSet(compiledMaskWords(game, replacement.movementsClear, game.movementWordCount))
                    || anyMaskWordSet(compiledMaskWords(game, replacement.movementsSet, game.movementWordCount))
                    || anyMaskWordSet(compiledMaskWords(game, replacement.movementsLayerMask, game.movementWordCount));
            } else {
                const CompactReplacementGuaranteedNoopSides guaranteedNoop =
                    compactReplacementGuaranteedNoopSidesOnMatchedCell(game, pattern, replacement);
                if (!guaranteedNoop.objects) {
                    summary.objects = summary.objects
                        || anyMaskWordSet(compiledMaskWords(game, replacement.objectsClear, game.wordCount))
                        || anyMaskWordSet(compiledMaskWords(game, replacement.objectsSet, game.wordCount));
                }
                if (!guaranteedNoop.movements) {
                    summary.movements = summary.movements
                        || anyMaskWordSet(compiledMaskWords(game, replacement.movementsClear, game.movementWordCount))
                        || anyMaskWordSet(compiledMaskWords(game, replacement.movementsSet, game.movementWordCount))
                        || anyMaskWordSet(compiledMaskWords(game, replacement.movementsLayerMask, game.movementWordCount));
                }
            }
            if ((summary.objects || !rule.hasWriteObjects) && (summary.movements || !rule.hasWriteMovements)) {
                return summary;
            }
        }
    }
    return summary;
}

bool compactPatternSimpleReplacementFastPathSupported(
    const Rule& rule,
    const Pattern& pattern,
    size_t rowIndex,
    int32_t rigidGroupIndex
) {
    if (!pattern.replacement.has_value()) {
        return false;
    }
    if (rigidGroupIndex > 0) {
        return false;
    }
    if (rowIndex < rule.ellipsisCount.size() && rule.ellipsisCount[rowIndex] != 0) {
        return false;
    }
    const Replacement& replacement = *pattern.replacement;
    if (replacement.hasRandomEntityMask || replacement.hasRandomDirMask) {
        return false;
    }
    const ReplacementDynamic* dynamic = replacement.dynamic.get();
    if (dynamic == nullptr) {
        return true;
    }
    // Property aliases and RHS property preservation are already lowered into
    // this specialized pattern's static clear/set masks. The emitted generic
    // apply helper only performs runtime work for coupled movement and inferred
    // aggregate captures, so those are the only dynamic terms that block the
    // direct replacement helpers here.
    return dynamic->layerCoupledMovementReplacements.empty()
        && dynamic->inferredAggregateBindings.empty();
}

bool compactPatternGeneratedReplacementGuaranteedNoopOnMatch(
    const Game& game,
    const Rule& rule,
    const Pattern& pattern,
    size_t rowIndex,
    int32_t rigidGroupIndex
) {
    if (!pattern.replacement.has_value()) {
        return false;
    }
    if (compactPatternReplacementGuaranteedNoopOnMatch(game, pattern)) {
        return true;
    }
    if (!compactPatternSimpleReplacementFastPathSupported(rule, pattern, rowIndex, rigidGroupIndex)) {
        return false;
    }
    const CompactReplacementGuaranteedNoopSides staticNoop =
        compactStaticReplacementGuaranteedNoopSidesOnMatchedCell(
            game,
            pattern,
            *pattern.replacement,
            true
        );
    return staticNoop.objects && staticNoop.movements;
}

std::string compactPatternSimpleReplacementFastPathCall(
    const Game& game,
    const CompactMaskConstantEmitter& masks,
    const Pattern& pattern,
    std::string_view suffix,
    std::string_view tileIndexExpr
) {
    const Replacement& replacement = *pattern.replacement;
    const std::vector<MaskWord> objectClearWords = compiledMaskWords(game, replacement.objectsClear, game.wordCount);
    const std::vector<MaskWord> objectSetWords = compiledMaskWords(game, replacement.objectsSet, game.wordCount);
    const std::vector<MaskWord> movementClearWords = compiledMaskWords(game, replacement.movementsClear, game.movementWordCount);
    const std::vector<MaskWord> movementSetWords = compiledMaskWords(game, replacement.movementsSet, game.movementWordCount);
    const std::vector<MaskWord> movementLayerWords = compiledMaskWords(game, replacement.movementsLayerMask, game.movementWordCount);
    // compactPatternSimpleReplacementFastPathSupported has already rejected
    // random, rigid, coupled-movement, and aggregate-captured replacements.
    // Property aliases and RHS preservation are represented by these static
    // masks, so they must not hide sides that are provably unchanged.
    const CompactReplacementGuaranteedNoopSides guaranteedNoop =
        compactStaticReplacementGuaranteedNoopSidesOnMatchedCell(
            game,
            pattern,
            replacement,
            true
        );
    const bool writesObjects = !guaranteedNoop.objects
        && (anyMaskWordSet(objectClearWords) || anyMaskWordSet(objectSetWords));
    const bool writesMovements = !guaranteedNoop.movements
        && (anyMaskWordSet(movementClearWords)
        || anyMaskWordSet(movementSetWords)
        || anyMaskWordSet(movementLayerWords));
    const CompactReplacementGuaranteedChangeSides guaranteedChange =
        compactReplacementGuaranteedChangeSidesOnMatchedCell(game, pattern, replacement);
    const char* helperVariant = (guaranteedChange.objects || guaranteedChange.movements) ? "_eager" : "";
    std::ostringstream call;
    if (writesObjects && writesMovements) {
        const char* combinedHelperVariant = "";
        if (guaranteedChange.objects && guaranteedChange.movements) {
            combinedHelperVariant = "_eager_both";
        } else if (guaranteedChange.objects) {
            combinedHelperVariant = "_eager_objects";
        } else if (guaranteedChange.movements) {
            combinedHelperVariant = "_eager_movements";
        }
        call << "compact_turn_simple_replacement_fast_path_objects_movements" << combinedHelperVariant << "_" << suffix
             << "(dimensions, levelState, scratch, " << tileIndexExpr
             << ", " << masks.name(objectClearWords)
             << ", " << masks.name(objectSetWords)
             << ", " << masks.name(movementClearWords)
             << ", " << masks.name(movementSetWords)
             << ", " << masks.name(movementLayerWords)
             << ")";
        return call.str();
    }
    if (writesObjects) {
        call << "compact_turn_simple_replacement_fast_path_objects" << helperVariant << "_" << suffix
             << "(dimensions, levelState, scratch, " << tileIndexExpr
             << ", " << masks.name(objectClearWords)
             << ", " << masks.name(objectSetWords)
             << ")";
        return call.str();
    }
    if (writesMovements) {
        call << "compact_turn_simple_replacement_fast_path_movements" << helperVariant << "_" << suffix
             << "(dimensions, scratch, " << tileIndexExpr
             << ", " << masks.name(movementClearWords)
             << ", " << masks.name(movementSetWords)
             << ", " << masks.name(movementLayerWords)
             << ")";
        return call.str();
    }
    call << "false";
    return call.str();
}

std::string compactPatternApplyCall(
    const Game& game,
    const CompactMaskConstantEmitter& masks,
    const Rule& rule,
    const Pattern& pattern,
    std::string_view suffix,
    std::string_view phase,
    size_t groupIndex,
    size_t ruleIndex,
    size_t rowIndex,
    size_t patternIndex,
    std::string_view tileIndexExpr,
    std::string_view rigidGroupIndexExpr,
    int32_t rigidGroupIndex,
    std::string_view aggregateCapturesExpr,
    std::string_view aggregateCaptureCountExpr
) {
    if (compactPatternSimpleReplacementFastPathSupported(rule, pattern, rowIndex, rigidGroupIndex)) {
        return compactPatternSimpleReplacementFastPathCall(game, masks, pattern, suffix, tileIndexExpr);
    }
    return compactPatternApplyCall(
        game,
        masks,
        pattern,
        suffix,
        phase,
        groupIndex,
        ruleIndex,
        rowIndex,
        patternIndex,
        tileIndexExpr,
        rigidGroupIndexExpr,
        aggregateCapturesExpr,
        aggregateCaptureCountExpr
    );
}

void emitCompactRuleCommandQueue(
    std::ostream& out,
    std::string_view commandQueueName
) {
    if (commandQueueName.empty()) {
        return;
    }
    out << "    " << commandQueueName << "(commands);\n";
}

void emitCompactAggregateBindingComment(std::ostream& out, const Rule& rule) {
    if (!rule.aggregateBindings.empty()) {
        out << "    // compact aggregate bindings: " << rule.aggregateBindings.size() << "\n";
    }
}

std::string compactAggregateCapturesExpr(const Rule& rule) {
    return rule.aggregateBindings.empty() ? "nullptr" : "aggregateCaptures";
}

std::string compactAggregateCaptureCountExpr(const Rule& rule) {
    return std::to_string(rule.aggregateBindings.size());
}

void emitCompactAggregateCaptureCode(
    std::ostream& out,
    const Rule& rule,
    std::string_view suffix,
    const std::vector<std::string>& rowStartExprs,
    std::string_view indent
) {
    if (rule.aggregateBindings.empty()) {
        return;
    }
    out << indent << "int32_t aggregateCaptures[" << rule.aggregateBindings.size() << "] = {};\n";
    for (size_t bindingIndex = 0; bindingIndex < rule.aggregateBindings.size(); ++bindingIndex) {
        const AggregateBinding& binding = rule.aggregateBindings[bindingIndex];
        if (binding.sourceRow < 0 || static_cast<size_t>(binding.sourceRow) >= rowStartExprs.size()) {
            continue;
        }
        out << indent << "{\n"
            << indent << "    int32_t aggregateSourceLayer = " << binding.sourceLayer << ";\n"
            << indent << "    bool aggregateSourceLayerResolved = true;\n";
        if (binding.sourcePropertyName.has_value()) {
            const PropertyBinding* propertyBinding =
                compactPropertyBindingForName(rule, *binding.sourcePropertyName);
            out << indent << "    aggregateSourceLayerResolved = false;\n";
            if (propertyBinding != nullptr
                && propertyBinding->sourceRow >= 0
                && static_cast<size_t>(propertyBinding->sourceRow) < rowStartExprs.size()) {
                out << indent << "    {\n"
                    << indent << "        const int32_t propertyStart = "
                    << rowStartExprs[static_cast<size_t>(propertyBinding->sourceRow)] << ";\n"
                    << indent << "        int32_t propertyTile = -1;\n"
                    << indent << "        if (propertyStart >= 0 && compact_turn_cell_at_direction_" << suffix
                    << "(dimensions, propertyStart, " << rule.direction << ", "
                    << propertyBinding->sourceCell << ", propertyTile)) {\n"
                    << indent << "            const MaskWord* propertyMovements = compact_turn_cell_movements_"
                    << suffix << "(scratch, propertyTile);\n";
                for (const PropertyAlias& alias : propertyBinding->aliases) {
                    out << indent << "            if (!aggregateSourceLayerResolved && compact_turn_cell_has_object_"
                        << suffix << "(levelState, propertyTile, " << alias.objectId << ")) {\n"
                        << indent << "                const int32_t propertyMovementBits = compact_turn_layer_bits_"
                        << suffix << "(propertyMovements, " << alias.layerIndex << ");\n"
                        << indent << "                bool propertyMovementMatches = false;\n";
                    if (propertyBinding->sourceMovementMode == 0) {
                        out << indent << "                propertyMovementMatches = true;\n";
                    } else if (propertyBinding->sourceMovementMode == 1) {
                        out << indent << "                propertyMovementMatches = (propertyMovementBits & "
                            << propertyBinding->sourceMovementMask << ") == 0;\n";
                    } else if (propertyBinding->sourceMovementMode == 3) {
                        out << indent << "                propertyMovementMatches = (propertyMovementBits & "
                            << propertyBinding->sourceMovementMask << ") != 0;\n";
                    } else {
                        out << indent << "                propertyMovementMatches = (propertyMovementBits & "
                            << propertyBinding->sourceMovementMask << ") == "
                            << propertyBinding->sourceMovementMask << ";\n";
                    }
                    out << indent << "                if (propertyMovementMatches) {\n"
                        << indent << "                    aggregateSourceLayer = " << alias.layerIndex << ";\n"
                        << indent << "                    aggregateSourceLayerResolved = true;\n"
                        << indent << "                }\n"
                        << indent << "            }\n";
                }
                out << indent << "        }\n"
                    << indent << "    }\n";
            }
        }
        out << indent << "    const int32_t aggregateStart = " << rowStartExprs[static_cast<size_t>(binding.sourceRow)] << ";\n"
            << indent << "    int32_t aggregateTile = -1;\n"
            << indent << "    if (aggregateSourceLayerResolved && aggregateStart >= 0 && compact_turn_cell_at_direction_" << suffix
            << "(dimensions, aggregateStart, " << rule.direction << ", " << binding.sourceCell << ", aggregateTile)) {\n"
            << indent << "        aggregateCaptures[" << bindingIndex << "] = compact_turn_layer_bits_" << suffix
            << "(compact_turn_cell_movements_" << suffix << "(scratch, aggregateTile), aggregateSourceLayer) & "
            << (binding.aggregateMask & 0x1f) << ";\n"
            << indent << "    }\n"
            << indent << "}\n";
    }
}

std::string emitCompactRuleCommandFunction(
    std::ostream& out,
    CompactFunctionInterner& functions,
    const Rule& rule,
    const std::string& prefix,
    std::string_view suffix
) {
    if (rule.commands.empty()) {
        return {};
    }

    std::ostringstream body;
    body << "(CompactTurnCommands_" << suffix << "& commands) {\n";
    const bool currentRuleCancel = std::any_of(rule.commands.begin(), rule.commands.end(), [](const RuleCommand& command) {
        return command.name == "cancel";
    });
    const bool currentRuleRestart = std::any_of(rule.commands.begin(), rule.commands.end(), [](const RuleCommand& command) {
        return command.name == "restart";
    });

    body << "    if (commands.hasCancel) {\n"
         << "        return;\n"
         << "    }\n";
    if (!currentRuleCancel) {
        body << "    if (commands.hasRestart) {\n"
             << "        return;\n"
             << "    }\n";
    }
    if (currentRuleCancel || currentRuleRestart) {
        body << "    commands = CompactTurnCommands_" << suffix << "{};\n";
    }
    body << "    commands.any = true;\n";
    for (const RuleCommand& command : rule.commands) {
        if (command.name == "again") {
            body << "    if (!commands.hasAgain) ++commands.commandCount;\n"
                 << "    commands.hasAgain = true;\n";
        } else if (command.name == "cancel") {
            body << "    if (!commands.hasCancel) ++commands.commandCount;\n"
                 << "    commands.hasCancel = true;\n";
        } else if (command.name == "checkpoint") {
            body << "    if (!commands.hasCheckpoint) ++commands.commandCount;\n"
                 << "    commands.hasCheckpoint = true;\n";
        } else if (command.name == "restart") {
            body << "    if (!commands.hasRestart) ++commands.commandCount;\n"
                 << "    commands.hasRestart = true;\n";
        } else if (command.name == "win") {
            body << "    if (!commands.hasWin) ++commands.commandCount;\n"
                 << "    commands.hasWin = true;\n";
        } else if (command.name == "message") {
            if (command.argument.has_value()) {
                body << "    if (!commands.hasMessage) {\n"
                     << "        ++commands.commandCount;\n"
                     << "        commands.hasMessage = true;\n"
                     << "        commands.messageHasText = true;\n"
                     << "        // Solver policy treats this command as output-only; player policy handles visible effects outside compact solver search.\n"
                     << "        commands.messageText = " << cppStringLiteral(*command.argument) << ";\n"
                     << "    }\n";
            } else {
                body << "    if (!commands.hasMessage) ++commands.commandCount;\n"
                 << "    // Solver policy treats this command as output-only; player policy handles visible effects outside compact solver search.\n"
                 << "    commands.hasMessage = true;\n"
                 << "    commands.messageHasText = false;\n"
                 << "    commands.messageText = nullptr;\n";
            }
        } else if (command.name.rfind("sfx", 0) == 0) {
            body << "    {\n"
                 << "        bool soundAlreadyQueued = false;\n"
                 << "        for (uint8_t soundIndex = 0; soundIndex < commands.soundCount; ++soundIndex) {\n"
                 << "            if (std::string_view(commands.soundNames[soundIndex]) == std::string_view("
                 << cppStringLiteral(command.name) << ")) { soundAlreadyQueued = true; break; }\n"
                 << "        }\n"
                 << "    // Solver policy treats this command as output-only; player policy handles visible effects outside compact solver search.\n"
                 << "    // Sound effects are command output only; board/search state is unaffected.\n"
                 << "        if (!soundAlreadyQueued && commands.soundCount < 16) {\n"
                 << "            ++commands.commandCount;\n"
                 << "            commands.soundNames[commands.soundCount++] = " << cppStringLiteral(command.name) << ";\n"
                 << "        }\n"
                 << "    }\n";
        } else {
            body << "    static_assert(false, \"compact turn compiler command queue emitted unsupported command\");\n";
        }
    }
    body << "}\n";
    const std::string commandQueueName = functions.emitDefinition(out, "void", prefix + "_queue_commands", body.str());
    out << "\n";
    return commandQueueName;
}

struct CompactRuleGeneratedNames {
    std::string applyName;
    std::string commandQueueName;
    std::string precheckName;
    std::string precheckKey;
    std::string writesObjectsName;
    std::string writesMovementsName;
    bool hasMaskPrecheck = false;
    bool writesObjects = false;
    bool writesMovements = false;
};

CompactRuleGeneratedNames makeCompactRuleGeneratedNames(
    std::string applyName,
    std::string commandQueueName = {},
    std::string precheckName = {},
    std::string precheckKey = {},
    std::string writesObjectsName = {},
    std::string writesMovementsName = {},
    bool hasMaskPrecheck = false,
    bool writesObjects = false,
    bool writesMovements = false
) {
    return CompactRuleGeneratedNames{
        std::move(applyName),
        std::move(commandQueueName),
        std::move(precheckName),
        std::move(precheckKey),
        std::move(writesObjectsName),
        std::move(writesMovementsName),
        hasMaskPrecheck,
        writesObjects,
        writesMovements
    };
}

enum class CompactRulePrecheckMode {
    Internal,
    External
};

struct CompactSpreadGroupShape {
    bool supported = false;
    int32_t seedObjectId = -1;
};

bool compactRulePatternHasObjectBit(const Game& game, const Pattern& pattern, int32_t objectId) {
    return compactMaskHasBit(compiledMaskWords(game, pattern.objectsPresent, game.wordCount), objectId);
}

CompactSpreadGroupShape analyzeCompactSpreadGroupShape(const Game& game, const std::vector<Rule>& group) {
    CompactSpreadGroupShape result;
    // Small spread groups are already cheap and the worklist helper adds setup overhead.
    if (group.size() < 16) {
        return result;
    }
    const int32_t lineNumber = group.front().lineNumber;
    std::vector<MaskWord> commonSetWords(static_cast<size_t>(game.wordCount), ~MaskWordUnsigned{0});
    bool sawReplacement = false;
    for (const Rule& rule : group) {
        if (!isCompactRuleSupported(rule)
            || rule.isRandom
            || rule.rigid
            || !rule.commands.empty()
            || rule.lineNumber != lineNumber
            || rule.hasReadMovements
            || rule.hasWriteMovements
            || rule.patterns.size() != 1
            || rule.ellipsisCount.size() < 1
            || rule.ellipsisCount[0] != 0
            || rule.patterns[0].size() != 2
            || (rule.direction != 1 && rule.direction != 2 && rule.direction != 4 && rule.direction != 8)) {
            return result;
        }
        for (const Pattern& pattern : rule.patterns[0]) {
            if (pattern.kind != Pattern::Kind::CellPattern || !pattern.replacement.has_value()) {
                return result;
            }
            const Replacement& replacement = *pattern.replacement;
            if (anyMaskWordSet(compiledMaskWords(game, replacement.movementsClear, game.movementWordCount))
                || anyMaskWordSet(compiledMaskWords(game, replacement.movementsSet, game.movementWordCount))
                || anyMaskWordSet(compiledMaskWords(game, replacement.movementsLayerMask, game.movementWordCount))) {
                return result;
            }
            const std::vector<MaskWord> setWords = compiledMaskWords(game, replacement.objectsSet, game.wordCount);
            if (!anyMaskWordSet(setWords)) {
                return result;
            }
            commonSetWords = sawReplacement
                ? compactMaskWordIntersection(commonSetWords, setWords)
                : setWords;
            sawReplacement = true;
        }
    }
    if (!sawReplacement || !anyMaskWordSet(commonSetWords)) {
        return result;
    }
    for (const int32_t objectId : compactMaskObjectIds(commonSetWords)) {
        bool everyRuleHasSeedSource = true;
        for (const Rule& rule : group) {
            const std::vector<Pattern>& row = rule.patterns[0];
            if (!compactRulePatternHasObjectBit(game, row[0], objectId)
                && !compactRulePatternHasObjectBit(game, row[1], objectId)) {
                everyRuleHasSeedSource = false;
                break;
            }
        }
        if (everyRuleHasSeedSource) {
            result.supported = true;
            result.seedObjectId = objectId;
            return result;
        }
    }
    return result;
}

std::string compactSpreadGroupApplyName(std::string_view suffix, size_t groupIndex) {
    return "compact_turn_apply_spread_group_" + std::string(suffix) + "_" + std::to_string(groupIndex);
}

void emitCompactSpreadRuleAttempt(
    std::ostream& out,
    const Game& game,
    const CompactMaskConstantEmitter& masks,
    const Rule& rule,
    std::string_view suffix,
    std::string_view phase,
    size_t groupIndex,
    size_t ruleIndex,
    size_t sourcePatternIndex
) {
    const std::vector<Pattern>& row = rule.patterns[0];
    int32_t spreadDx = 0;
    int32_t spreadDy = 0;
    if (!compactCompileTimeDirectionDelta(rule.direction, spreadDx, spreadDy)) {
        throw std::logic_error("unsupported compact spread group direction");
    }
    out << "        {\n"
        << "            constexpr int32_t spreadDx = " << spreadDx << ";\n"
        << "            constexpr int32_t spreadDy = " << spreadDy << ";\n"
        << "            const int32_t startX = sourceX - " << sourcePatternIndex << " * spreadDx;\n"
        << "            const int32_t startY = sourceY - " << sourcePatternIndex << " * spreadDy;\n"
        << "            if (compact_turn_in_bounds_" << suffix << "(dimensions, startX, startY)) {\n"
        << "                const int32_t startIndex = compact_turn_tile_index_" << suffix << "(dimensions, startX, startY);\n"
        << "                bool matched = true;\n";
    for (size_t patternIndex = 0; patternIndex < row.size(); ++patternIndex) {
        const std::string tileName = "spreadTile_" + std::to_string(ruleIndex) + "_" + std::to_string(sourcePatternIndex) + "_" + std::to_string(patternIndex);
        emitCompactFixedTileAtDirection(
            out,
            "                    ",
            suffix,
            tileName,
            "startIndex",
            rule.direction,
            static_cast<int32_t>(patternIndex),
            "matched = false;"
        );
        if (compactPatternCanInlineMatch(row[patternIndex])) {
            emitCompactInlinePatternMatchTest(
                out,
                game,
                row[patternIndex],
                suffix,
                "                    ",
                tileName,
                tileName,
                "matched"
            );
        } else {
            out << "                    if (matched && !"
                << compactPatternMatchesCall(
                    game,
                    masks,
                    row[patternIndex],
                    suffix,
                    phase,
                    groupIndex,
                    ruleIndex,
                    0,
                    patternIndex,
                    tileName
                )
                << ") matched = false;\n";
        }
    }
    out << "                if (matched) {\n"
        << "                    bool ruleChanged = false;\n";
    for (size_t patternIndex = 0; patternIndex < row.size(); ++patternIndex) {
        const Pattern& pattern = row[patternIndex];
        if (!pattern.replacement.has_value()) {
            continue;
        }
        const std::string tileName = "spreadTile_" + std::to_string(ruleIndex) + "_" + std::to_string(sourcePatternIndex) + "_" + std::to_string(patternIndex);
        const std::string changedName = "spreadChanged_" + std::to_string(ruleIndex) + "_" + std::to_string(sourcePatternIndex) + "_" + std::to_string(patternIndex);
        out << "                    const bool " << changedName << " = " << compactPatternApplyCall(
                game,
                masks,
                rule,
                pattern,
                suffix,
                phase,
                groupIndex,
                ruleIndex,
                0,
                patternIndex,
                tileName,
                "0",
                0,
                compactAggregateCapturesExpr(rule),
                compactAggregateCaptureCountExpr(rule)
            ) << ";\n"
            << "                    if (" << changedName << ") {\n"
            << "                        ruleChanged = true;\n"
            << "                        pushTile(" << tileName << ");\n"
            << "                    }\n";
    }
    out << "                    if (ruleChanged) {\n"
        << "                        changed = true;\n"
        << "                        if (scratch.anyMasksDirty) (void)compact_turn_rebuild_rule_derived_state_" << suffix << "(dimensions, levelState, scratch, true, false);\n"
        << "                    }\n"
        << "                }\n"
        << "            }\n"
        << "        }\n";
}

std::string emitCompactSpreadGroupApplyFunction(
    std::ostream& out,
    const Game& game,
    const CompactMaskConstantEmitter& masks,
    const std::vector<Rule>& group,
    const CompactSpreadGroupShape& shape,
    std::string_view suffix,
    std::string_view phase,
    size_t groupIndex
) {
    const std::string functionName = compactSpreadGroupApplyName(suffix, groupIndex);
    out << "bool " << functionName << "(LevelDimensions dimensions, PersistentLevelState& levelState, Scratch& scratch, CompactTurnCommands_" << suffix << "& commands) {\n"
        << "    (void)commands;\n"
        << "    const int32_t tileCount = compact_turn_tile_count_" << suffix << "(dimensions);\n"
        << "    if (tileCount <= 0) return false;\n"
        << "    if (!compact_turn_prepare_object_cell_index_" << suffix << "(dimensions, levelState, scratch)) return false;\n"
        << "    const int32_t objectCellWordCount = compact_turn_object_cell_word_count_" << suffix << "(dimensions);\n"
        << "    if (objectCellWordCount <= 0) return false;\n"
        << "    std::vector<int32_t>& queue = scratch.singleRowMatchScratch;\n"
        << "    queue.clear();\n"
        << "    std::vector<uint8_t>& queued = scratch.queuedTileScratch;\n"
        << "    queued.assign(static_cast<size_t>(tileCount), 0);\n"
        << "    auto pushTile = [&](int32_t tileIndex) {\n"
        << "        if (tileIndex < 0 || tileIndex >= tileCount) return;\n"
        << "        uint8_t& queuedFlag = queued[static_cast<size_t>(tileIndex)];\n"
        << "        if (queuedFlag != 0) return;\n"
        << "        queuedFlag = 1;\n"
        << "        queue.push_back(tileIndex);\n"
        << "    };\n"
        << "    const int32_t seedObjectId = " << shape.seedObjectId << ";\n"
        << "    const size_t seedBase = static_cast<size_t>(seedObjectId) * static_cast<size_t>(objectCellWordCount);\n"
        << "    if (seedObjectId < 0 || seedObjectId >= compact_turn_object_count_" << suffix << "\n"
        << "        || seedBase + static_cast<size_t>(objectCellWordCount) > compact_turn_object_cell_bits_" << suffix << "(scratch).size()) return false;\n"
        << "    for (int32_t wordIndex = 0; wordIndex < objectCellWordCount; ++wordIndex) {\n"
        << "        MaskWordUnsigned bits = compact_turn_object_cell_bits_" << suffix << "(scratch)[seedBase + static_cast<size_t>(wordIndex)];\n"
        << "        while (bits != 0) {\n"
        << "            const int32_t bit = maskWordCountTrailingZeros(bits);\n"
        << "            bits &= bits - 1;\n"
        << "            const int32_t tileIndex = wordIndex * static_cast<int32_t>(kMaskWordBits) + bit;\n"
        << "            pushTile(tileIndex);\n"
        << "        }\n"
        << "    }\n"
        << "    bool changed = false;\n"
        << "    size_t queueIndex = 0;\n"
        << "    while (queueIndex < queue.size()) {\n"
        << "        const int32_t sourceTile = queue[queueIndex++];\n"
        << "        queued[static_cast<size_t>(sourceTile)] = 0;\n"
        << "        const int32_t sourceX = sourceTile / dimensions.height;\n"
        << "        const int32_t sourceY = sourceTile % dimensions.height;\n";
    for (size_t ruleIndex = 0; ruleIndex < group.size(); ++ruleIndex) {
        const Rule& rule = group[ruleIndex];
        for (size_t sourcePatternIndex = 0; sourcePatternIndex < rule.patterns[0].size(); ++sourcePatternIndex) {
            if (!compactRulePatternHasObjectBit(game, rule.patterns[0][sourcePatternIndex], shape.seedObjectId)) {
                continue;
            }
            emitCompactSpreadRuleAttempt(out, game, masks, rule, suffix, phase, groupIndex, ruleIndex, sourcePatternIndex);
        }
    }
    out << "    }\n"
        << "    return changed;\n"
        << "}\n\n";
    return functionName;
}

std::string emitCompactRulePrecheckFunction(
    std::ostream& out,
    std::string_view prefix,
    std::string_view suffix,
    const CompactRowMaskInfo& ruleMask
) {
    const std::string precheckName = std::string(prefix) + "_precheck";
    out << "bool " << precheckName << "(const Scratch& scratch) {\n";
    if (!ruleMask.hasAnyRequiredMask) {
        out << "    (void)scratch;\n"
            << "    return true;\n";
    } else {
        out << "    return " << compactBoardRequiredMaskExpression(ruleMask) << ";\n";
    }
    out << "}\n\n";
    return precheckName;
}

std::pair<std::string, std::string> emitCompactRuleWriteSummaryConstants(
    std::ostream& out,
    std::string_view prefix,
    const CompactRuleEffectiveWriteSummary& summary
) {
    const std::string writesObjectsName = std::string(prefix) + "_writes_objects";
    const std::string writesMovementsName = std::string(prefix) + "_writes_movements";
    out << "static constexpr bool " << writesObjectsName << " = "
        << (summary.objects ? "true" : "false") << ";\n"
        << "static constexpr bool " << writesMovementsName << " = "
        << (summary.movements ? "true" : "false") << ";\n\n";
    return {writesObjectsName, writesMovementsName};
}

CompactRuleGeneratedNames emitCompactRuleFunction(
    std::ostream& out,
    const Game& game,
    const CompactMaskConstantEmitter& masks,
    CompactFunctionInterner& functions,
    const Rule& rule,
    std::string_view suffix,
    std::string_view phase,
    size_t groupIndex,
    size_t ruleIndex,
    bool groupIsRandom,
    CompactRulePrecheckMode precheckMode
) {
    const std::string prefix = compactRulePrefix(suffix, phase, groupIndex, ruleIndex);
    out << "// source rule line " << rule.lineNumber << "\n";
    const int32_t rigidGroupIndex = (rule.rigid
        && rule.groupNumber >= 0
        && static_cast<size_t>(rule.groupNumber) < game.groupNumberToRigidGroupIndex.size())
        ? game.groupNumberToRigidGroupIndex[static_cast<size_t>(rule.groupNumber)] + 1
        : 0;
    if (!isCompactRuleSupported(rule)) {
        const std::string reason = "compact turn compiler TODO: "
            + compactRuleUnsupportedReason(rule)
            + " at source rule line "
            + std::to_string(rule.lineNumber);
        out << "bool " << prefix << "_apply(LevelDimensions dimensions, PersistentLevelState& levelState, Scratch& scratch, CompactTurnCommands_" << suffix << "& commands) {\n"
            << "    (void)dimensions;\n"
            << "    (void)levelState;\n"
            << "    (void)scratch;\n"
            << "    (void)commands;\n"
            << "    static_assert(false, " << cppStringLiteral(reason) << ");\n"
            << "    return false;\n"
            << "}\n\n"
            << "void " << prefix << "_queue_commands(CompactTurnCommands_" << suffix << "& commands) {\n"
            << "    (void)commands;\n"
            << "    static_assert(false, " << cppStringLiteral(reason) << ");\n"
            << "}\n\n"
            << "bool " << prefix << "_collect_matches(LevelDimensions dimensions, const PersistentLevelState& levelState, const Scratch& scratch, std::vector<std::vector<std::vector<int32_t>>>& matches) {\n"
            << "    (void)dimensions;\n"
            << "    (void)levelState;\n"
            << "    (void)scratch;\n"
            << "    (void)matches;\n"
            << "    static_assert(false, " << cppStringLiteral(reason) << ");\n"
            << "    return false;\n"
            << "}\n\n"
            << "bool " << prefix << "_apply_tuple(LevelDimensions dimensions, PersistentLevelState& levelState, Scratch& scratch, const std::vector<std::vector<std::vector<int32_t>>>& matches, const std::vector<size_t>& tupleIndex) {\n"
            << "    (void)dimensions;\n"
            << "    (void)levelState;\n"
            << "    (void)scratch;\n"
            << "    (void)matches;\n"
            << "    (void)tupleIndex;\n"
            << "    static_assert(false, " << cppStringLiteral(reason) << ");\n"
            << "    return false;\n"
            << "}\n\n";
        return makeCompactRuleGeneratedNames(prefix + "_apply", prefix + "_queue_commands");
    }

    const CompactRowMaskInfo ruleMask = compactRuleMaskInfo(game, masks, rule);
    const std::string precheckKey = ruleMask.hasAnyRequiredMask
        ? compactBoardRequiredMaskExpression(ruleMask)
        : std::string{};
    const std::string precheckName = emitCompactRulePrecheckFunction(out, prefix, suffix, ruleMask);
    const CompactRuleEffectiveWriteSummary effectiveWrites = compactRuleEffectiveWriteSummary(game, rule);
    const auto [writesObjectsName, writesMovementsName] = emitCompactRuleWriteSummaryConstants(out, prefix, effectiveWrites);
    const std::string ruleApplyNoMatchExpr = "compact_turn_count_rule_apply_result_" + std::string(suffix) + "(false)";
    const std::string ruleApplyChangedExpr = "compact_turn_count_rule_apply_result_" + std::string(suffix) + "(changed)";
    const bool useInternalRulePrecheck = precheckMode == CompactRulePrecheckMode::Internal;
    const bool inlineSingleRowHelpers = !groupIsRandom && rule.patterns.size() == 1;
    const bool inlineSingleRowStartMatches = inlineSingleRowHelpers
        && !rule.ellipsisCount.empty()
        && rule.ellipsisCount[0] == 0;
    if (inlineSingleRowStartMatches) {
        const size_t rowIndex = 0;
        const std::vector<Pattern>& row = rule.patterns[rowIndex];
        const CompactRowMaskInfo rowMask = compactRowMaskInfo(game, masks, rule, rowIndex, suffix, phase, groupIndex, ruleIndex);
        const std::string commandQueueName = emitCompactRuleCommandFunction(out, functions, rule, prefix, suffix);

        std::ostringstream applyBody;
        applyBody << "(LevelDimensions dimensions, PersistentLevelState& levelState, Scratch& scratch, CompactTurnCommands_" << suffix << "& commands) {\n";
        emitCompactAggregateBindingComment(applyBody, rule);
        applyBody << "    std::vector<int32_t>& matches = scratch.singleRowMatchScratch;\n"
                  << "    matches.clear();\n"
                  << "    const int32_t tileCount = compact_turn_tile_count_" << suffix << "(dimensions);\n"
                  << "    if (tileCount <= 0) return " << ruleApplyNoMatchExpr << ";\n"
                  << "    constexpr bool horizontalScan = " << (rule.direction > 2 ? "true" : "false") << ";\n"
                  << "    const int32_t primaryLimit = horizontalScan ? dimensions.height : dimensions.width;\n"
                  << "    const int32_t secondaryLimit = horizontalScan ? dimensions.width : dimensions.height;\n";
        if (useInternalRulePrecheck) {
            emitCompactRuleMaskPrecheck(applyBody, "    ", suffix, ruleMask, ruleApplyNoMatchExpr);
        }
        emitCompactFixedStartMatchCollection(
            applyBody,
            game,
            masks,
            rule,
            row,
            rowMask,
            suffix,
            phase,
            groupIndex,
            ruleIndex,
            rowIndex,
            "    ",
            "matches",
            "tile_",
            ruleApplyNoMatchExpr,
            !useInternalRulePrecheck
        );
        applyBody << "    if (matches.empty()) return " << ruleApplyNoMatchExpr << ";\n";
        emitCompactRuleCommandQueue(applyBody, commandQueueName);
        applyBody << "    bool changed = false;\n"
                  << "    for (size_t matchIndex = 0; matchIndex < matches.size(); ++matchIndex) {\n"
                  << "        const int32_t startIndex = matches[matchIndex];\n"
                  << "        bool stillMatches = true;\n"
                  << "        if (matchIndex != 0) {\n";
        for (size_t patternIndex = 0; patternIndex < row.size(); ++patternIndex) {
            emitCompactFixedTileAtDirection(
                applyBody,
                "            ",
                suffix,
                "tile_" + std::to_string(patternIndex),
                "startIndex",
                rule.direction,
                static_cast<int32_t>(patternIndex),
                "stillMatches = false;"
            );
            const std::string tileName = "tile_" + std::to_string(patternIndex);
            if (compactPatternCanInlineMatch(row[patternIndex])) {
                emitCompactInlinePatternMatchTest(
                    applyBody,
                    game,
                    row[patternIndex],
                    suffix,
                    "            ",
                    tileName,
                    tileName,
                    "stillMatches"
                );
            } else {
                applyBody << "            if (stillMatches && !"
                          << compactPatternMatchesCall(game, masks, row[patternIndex], suffix, phase, groupIndex, ruleIndex, rowIndex, patternIndex, tileName)
                          << ") stillMatches = false;\n";
            }
        }
        applyBody << "        }\n"
                  << "        if (stillMatches) {\n";
        emitCompactAggregateCaptureCode(
            applyBody,
            rule,
            suffix,
            std::vector<std::string>{"startIndex"},
            "            "
        );
        for (size_t patternIndex = 0; patternIndex < row.size(); ++patternIndex) {
            if (!row[patternIndex].replacement.has_value()
                || compactPatternGeneratedReplacementGuaranteedNoopOnMatch(
                    game, rule, row[patternIndex], rowIndex, rigidGroupIndex)) {
                continue;
            }
            emitCompactFixedTileAtDirection(
                applyBody,
                "            ",
                suffix,
                "applyTile_" + std::to_string(patternIndex),
                "startIndex",
                rule.direction,
                static_cast<int32_t>(patternIndex),
                "continue;"
            );
            applyBody << "            changed = "
                      << compactPatternApplyCall(
                          game,
                          masks,
                          rule,
                          row[patternIndex],
                          suffix,
                          phase,
                          groupIndex,
                          ruleIndex,
                          rowIndex,
                          patternIndex,
                          "applyTile_" + std::to_string(patternIndex),
                          std::to_string(rigidGroupIndex),
                          rigidGroupIndex,
                          compactAggregateCapturesExpr(rule),
                          compactAggregateCaptureCountExpr(rule)
                      )
                      << " || changed;\n";
        }
        applyBody << "        }\n"
                  << "    }\n"
                  << "    return " << ruleApplyChangedExpr << ";\n"
                  << "}\n";
        const std::string applyName = functions.emitDefinition(out, prefix + "_apply", applyBody.str());
        out << "\n";
        return makeCompactRuleGeneratedNames(
            applyName,
            commandQueueName,
            precheckName,
            precheckKey,
            writesObjectsName,
            writesMovementsName,
            ruleMask.hasAnyRequiredMask,
            effectiveWrites.objects,
            effectiveWrites.movements
        );
    }

    const bool inlineMultiRowStartMatches = !groupIsRandom
        && rule.patterns.size() > 1
        && rule.ellipsisCount.size() >= rule.patterns.size()
        && std::all_of(rule.ellipsisCount.begin(), rule.ellipsisCount.begin() + static_cast<std::ptrdiff_t>(rule.patterns.size()), [](int32_t count) {
            return count == 0;
        });
    if (inlineMultiRowStartMatches) {
        const std::string commandQueueName = emitCompactRuleCommandFunction(out, functions, rule, prefix, suffix);
        std::optional<std::pair<size_t, size_t>> staticChangeDriver;
        bool staticChangeGuardSupported = rule.commands.empty() && rigidGroupIndex == 0;
        if (staticChangeGuardSupported) {
            for (size_t rowIndex = 0; rowIndex < rule.patterns.size(); ++rowIndex) {
                const std::vector<Pattern>& row = rule.patterns[rowIndex];
                for (size_t patternIndex = 0; patternIndex < row.size(); ++patternIndex) {
                    const Pattern& pattern = row[patternIndex];
                    if (!pattern.replacement.has_value()
                        || compactPatternGeneratedReplacementGuaranteedNoopOnMatch(
                            game, rule, pattern, rowIndex, rigidGroupIndex)) {
                        continue;
                    }
                    if (staticChangeDriver.has_value()
                        || !compactPatternSimpleReplacementFastPathSupported(
                            rule, pattern, rowIndex, rigidGroupIndex)) {
                        staticChangeGuardSupported = false;
                        break;
                    }
                    staticChangeDriver = std::make_pair(rowIndex, patternIndex);
                }
                if (!staticChangeGuardSupported) break;
            }
        }
        if (!staticChangeGuardSupported) staticChangeDriver.reset();
        std::ostringstream applyBody;
        applyBody << "(LevelDimensions dimensions, PersistentLevelState& levelState, Scratch& scratch, CompactTurnCommands_" << suffix << "& commands) {\n";
        emitCompactAggregateBindingComment(applyBody, rule);
        applyBody << "    constexpr size_t rowCount = " << rule.patterns.size() << ";\n"
                  << "    std::vector<std::vector<int32_t>>& matches = scratch.multiRowMatchScratch;\n"
                  << "    matches.resize(rowCount);\n"
                  << "    const int32_t tileCount = compact_turn_tile_count_" << suffix << "(dimensions);\n"
                  << "    if (tileCount <= 0) return " << ruleApplyNoMatchExpr << ";\n"
                  << "    constexpr bool horizontalScan = " << (rule.direction > 2 ? "true" : "false") << ";\n"
                  << "    const int32_t primaryLimit = horizontalScan ? dimensions.height : dimensions.width;\n"
                  << "    const int32_t secondaryLimit = horizontalScan ? dimensions.width : dimensions.height;\n";
        if (useInternalRulePrecheck) {
            emitCompactRuleMaskPrecheck(applyBody, "    ", suffix, ruleMask, ruleApplyNoMatchExpr);
        }
        for (size_t rowIndex = 0; rowIndex < rule.patterns.size(); ++rowIndex) {
            const std::vector<Pattern>& row = rule.patterns[rowIndex];
            const CompactRowMaskInfo rowMask = compactRowMaskInfo(game, masks, rule, rowIndex, suffix, phase, groupIndex, ruleIndex);
            applyBody << "    {\n"
                      << "        std::vector<int32_t>& rowMatches = matches[" << rowIndex << "];\n"
                      << "        rowMatches.clear();\n";
            emitCompactFixedStartMatchCollection(
                applyBody,
                game,
                masks,
                rule,
                row,
                rowMask,
                suffix,
                phase,
                groupIndex,
                ruleIndex,
                rowIndex,
                "        ",
                "rowMatches",
                "tile_" + std::to_string(rowIndex) + "_",
                ruleApplyNoMatchExpr,
                false
            );
            applyBody << "        if (rowMatches.empty()) return " << ruleApplyNoMatchExpr << ";\n"
                      << "    }\n";
        }
        emitCompactRuleCommandQueue(applyBody, commandQueueName);
        applyBody << "    std::array<size_t, rowCount> tupleIndex{};\n"
                  << "    bool firstTuple = true;\n"
                  << "    bool changed = false;\n"
                  << "    while (true) {\n"
                  << "        bool stillMatches = true;\n"
                  << "        if (!firstTuple) {\n";
        for (size_t rowIndex = 0; rowIndex < rule.patterns.size(); ++rowIndex) {
            const std::vector<Pattern>& row = rule.patterns[rowIndex];
            applyBody << "            const int32_t startIndex_" << rowIndex << " = matches[" << rowIndex << "][tupleIndex[" << rowIndex << "]];\n";
            for (size_t patternIndex = 0; patternIndex < row.size(); ++patternIndex) {
                emitCompactFixedTileAtDirection(
                    applyBody,
                    "            ",
                    suffix,
                    "tile_" + std::to_string(rowIndex) + "_" + std::to_string(patternIndex),
                    "startIndex_" + std::to_string(rowIndex),
                    rule.direction,
                    static_cast<int32_t>(patternIndex),
                    "stillMatches = false;"
                );
                const std::string tileName = "tile_" + std::to_string(rowIndex) + "_" + std::to_string(patternIndex);
                if (compactPatternCanInlineMatch(row[patternIndex])) {
                    emitCompactInlinePatternMatchTest(
                        applyBody,
                        game,
                        row[patternIndex],
                        suffix,
                        "            ",
                        tileName,
                        tileName,
                        "stillMatches"
                    );
                } else {
                    applyBody << "            if (stillMatches && !"
                              << compactPatternMatchesCall(
                                  game,
                                  masks,
                                  row[patternIndex],
                                  suffix,
                                  phase,
                                  groupIndex,
                                  ruleIndex,
                                  rowIndex,
                                  patternIndex,
                                  tileName
                              )
                              << ") stillMatches = false;\n";
                }
            }
        }
        if (staticChangeDriver.has_value()) {
            const size_t driverRowIndex = staticChangeDriver->first;
            const size_t driverPatternIndex = staticChangeDriver->second;
            const Replacement& driverReplacement =
                *rule.patterns[driverRowIndex][driverPatternIndex].replacement;
            applyBody << "            if (stillMatches) {\n"
                      << "                const MaskWord* changeObjects = compact_turn_cell_objects_" << suffix
                      << "(levelState, tile_" << driverRowIndex << "_" << driverPatternIndex << ");\n"
                      << "                const MaskWord* changeMovements = compact_turn_cell_movements_" << suffix
                      << "(scratch, tile_" << driverRowIndex << "_" << driverPatternIndex << ");\n"
                      << "                bool replacementWouldChange = false;\n"
                      << "                for (int32_t word = 0; word < compact_turn_object_stride_" << suffix << "; ++word) {\n"
                      << "                    const MaskWord before = changeObjects[word];\n"
                      << "                    const MaskWord after = (before & ~("
                      << compactMaskName(masks, game, driverReplacement.objectsClear, game.wordCount)
                      << ")[word]) | ("
                      << compactMaskName(masks, game, driverReplacement.objectsSet, game.wordCount)
                      << ")[word];\n"
                      << "                    if (before != after) { replacementWouldChange = true; break; }\n"
                      << "                }\n"
                      << "                for (int32_t word = 0; !replacementWouldChange && word < compact_turn_movement_stride_" << suffix << "; ++word) {\n"
                      << "                    const MaskWord before = changeMovements[word];\n"
                      << "                    const MaskWord clear = ("
                      << compactMaskName(masks, game, driverReplacement.movementsClear, game.movementWordCount)
                      << ")[word] | ("
                      << compactMaskName(masks, game, driverReplacement.movementsLayerMask, game.movementWordCount)
                      << ")[word];\n"
                      << "                    const MaskWord after = (before & ~clear) | ("
                      << compactMaskName(masks, game, driverReplacement.movementsSet, game.movementWordCount)
                      << ")[word];\n"
                      << "                    if (before != after) replacementWouldChange = true;\n"
                      << "                }\n"
                      << "                if (!replacementWouldChange) stillMatches = false;\n"
                      << "            }\n";
        }
        applyBody << "        }\n"
                  << "        if (stillMatches) {\n";
        {
            std::vector<std::string> rowStartExprs;
            rowStartExprs.reserve(rule.patterns.size());
            for (size_t captureRowIndex = 0; captureRowIndex < rule.patterns.size(); ++captureRowIndex) {
                rowStartExprs.push_back(
                    "matches[" + std::to_string(captureRowIndex)
                    + "][tupleIndex[" + std::to_string(captureRowIndex) + "]]"
                );
            }
            emitCompactAggregateCaptureCode(applyBody, rule, suffix, rowStartExprs, "            ");
        }
        for (size_t rowIndex = 0; rowIndex < rule.patterns.size(); ++rowIndex) {
            const std::vector<Pattern>& row = rule.patterns[rowIndex];
            applyBody << "            const int32_t applyStartIndex_" << rowIndex << " = matches[" << rowIndex << "][tupleIndex[" << rowIndex << "]];\n";
            for (size_t patternIndex = 0; patternIndex < row.size(); ++patternIndex) {
                if (!row[patternIndex].replacement.has_value()
                    || compactPatternGeneratedReplacementGuaranteedNoopOnMatch(
                        game, rule, row[patternIndex], rowIndex, rigidGroupIndex)) {
                    continue;
                }
                emitCompactFixedTileAtDirection(
                    applyBody,
                    "            ",
                    suffix,
                        "applyTile_" + std::to_string(rowIndex) + "_" + std::to_string(patternIndex),
                        "applyStartIndex_" + std::to_string(rowIndex),
                        rule.direction,
                        static_cast<int32_t>(patternIndex),
                        "return " + ruleApplyChangedExpr + ";"
                    );
                applyBody << "            changed = "
                          << compactPatternApplyCall(
                              game,
                              masks,
                              rule,
                              row[patternIndex],
                              suffix,
                              phase,
                              groupIndex,
                              ruleIndex,
                              rowIndex,
                              patternIndex,
                              "applyTile_" + std::to_string(rowIndex) + "_" + std::to_string(patternIndex),
                              std::to_string(rigidGroupIndex),
                              rigidGroupIndex,
                              compactAggregateCapturesExpr(rule),
                              compactAggregateCaptureCountExpr(rule)
                          )
                          << " || changed;\n";
            }
        }
        applyBody << "        }\n"
                  << "        firstTuple = false;\n"
                  << "        size_t rowToIncrement = 0;\n"
                  << "        while (rowToIncrement < rowCount) {\n"
                  << "            ++tupleIndex[rowToIncrement];\n"
                  << "            if (tupleIndex[rowToIncrement] < matches[rowToIncrement].size()) break;\n"
                  << "            tupleIndex[rowToIncrement] = 0;\n"
                  << "            ++rowToIncrement;\n"
                  << "        }\n"
                  << "        if (rowToIncrement == rowCount) break;\n"
                  << "    }\n"
                  << "    return " << ruleApplyChangedExpr << ";\n"
                  << "}\n";
        const std::string applyName = functions.emitDefinition(out, prefix + "_apply", applyBody.str());
        out << "\n";
        return makeCompactRuleGeneratedNames(
            applyName,
            commandQueueName,
            precheckName,
            precheckKey,
            writesObjectsName,
            writesMovementsName,
            ruleMask.hasAnyRequiredMask,
            effectiveWrites.objects,
            effectiveWrites.movements
        );
    }

    std::vector<std::string> rowMatchNames(rule.patterns.size());
    std::vector<std::string> rowApplyNames(rule.patterns.size());
    std::vector<std::string> rowCollectNames(rule.patterns.size());
    for (size_t rowIndex = 0; rowIndex < rule.patterns.size(); ++rowIndex) {
        const std::vector<Pattern>& row = rule.patterns[rowIndex];
        const std::string rowPrefix = compactRowPrefix(suffix, phase, groupIndex, ruleIndex, rowIndex);
        if (!inlineSingleRowHelpers) {
            std::ostringstream body;
            body << "(const PersistentLevelState& levelState, const Scratch& scratch, const std::vector<int32_t>& match) {\n"
                 << "    size_t positionIndex = 0;\n";
            for (size_t patternIndex = 0; patternIndex < row.size(); ++patternIndex) {
                if (row[patternIndex].kind == Pattern::Kind::Ellipsis) {
                    continue;
                }
                body << "    if (positionIndex >= match.size()) return false;\n"
                     << "    bool matched_" << patternIndex << " = true;\n";
                if (compactPatternCanInlineMatch(row[patternIndex])) {
                    const std::string tileName = "tile_" + std::to_string(patternIndex);
                    body << "    const int32_t " << tileName << " = match[positionIndex];\n";
                    emitCompactInlinePatternMatchTest(
                        body,
                        game,
                        row[patternIndex],
                        suffix,
                        "    ",
                        tileName,
                        tileName,
                        "matched_" + std::to_string(patternIndex)
                    );
                } else {
                    body << "    if (!"
                         << compactPatternMatchesCall(game, masks, row[patternIndex], suffix, phase, groupIndex, ruleIndex, rowIndex, patternIndex, "match[positionIndex]")
                         << ") matched_" << patternIndex << " = false;\n";
                }
                body << "    if (!matched_" << patternIndex << ") return false;\n"
                     << "    ++positionIndex;\n";
            }
            body << "    return positionIndex == match.size();\n"
                 << "}\n";
            rowMatchNames[rowIndex] = functions.emitDefinition(out, rowPrefix + "_match_still_matches", body.str());
            out << "\n";
        }

        if (!inlineSingleRowHelpers) {
            std::ostringstream body;
            body << "(LevelDimensions dimensions, PersistentLevelState& levelState, Scratch& scratch, const std::vector<int32_t>& match, const int32_t* aggregateCaptures, size_t aggregateCaptureCount) {\n";
            emitCompactAggregateBindingComment(body, rule);
            body << "    bool changed = false;\n"
                 << "    size_t positionIndex = 0;\n";
            for (size_t patternIndex = 0; patternIndex < row.size(); ++patternIndex) {
                if (row[patternIndex].kind == Pattern::Kind::Ellipsis) {
                    continue;
                }
                body << "    if (positionIndex >= match.size()) return changed;\n";
                if (row[patternIndex].replacement.has_value()
                    && !compactPatternGeneratedReplacementGuaranteedNoopOnMatch(
                        game, rule, row[patternIndex], rowIndex, rigidGroupIndex)) {
                    body << "    changed = "
                         << compactPatternApplyCall(
                             game,
                             masks,
                             rule,
                             row[patternIndex],
                             suffix,
                             phase,
                             groupIndex,
                             ruleIndex,
                             rowIndex,
                             patternIndex,
                             "match[positionIndex]",
                             std::to_string(rigidGroupIndex),
                             rigidGroupIndex,
                             "aggregateCaptures",
                             "aggregateCaptureCount"
                         )
                         << " || changed;\n";
                }
                body << "    ++positionIndex;\n";
            }
            body << "    return changed;\n"
                 << "}\n";
            rowApplyNames[rowIndex] = functions.emitDefinition(out, rowPrefix + "_apply_replacements", body.str());
            out << "\n";
        }

        std::ostringstream collectBody;
        const CompactRowMaskInfo rowMask = compactRowMaskInfo(game, masks, rule, rowIndex, suffix, phase, groupIndex, ruleIndex);
        collectBody << "(LevelDimensions dimensions, const PersistentLevelState& levelState, const Scratch& scratch, std::vector<std::vector<int32_t>>& rowMatches) {\n"
                    << "    rowMatches.clear();\n"
                    << "    const int32_t tileCount = compact_turn_tile_count_" << suffix << "(dimensions);\n"
                    << "    if (tileCount <= 0) return false;\n"
                    << "    constexpr bool horizontalScan = " << (rule.direction > 2 ? "true" : "false") << ";\n"
                    << "    const int32_t primaryLimit = horizontalScan ? dimensions.height : dimensions.width;\n"
                    << "    const int32_t secondaryLimit = horizontalScan ? dimensions.width : dimensions.height;\n";
        if (rowMask.hasAnyRequiredMask) {
            collectBody << "    if (!(" << compactBoardRequiredMaskExpression(rowMask) << ")) return false;\n";
        }
        if (rule.ellipsisCount[rowIndex] == 0) {
            collectBody << "    std::vector<int32_t> positions;\n"
                        << "    positions.reserve(" << row.size() << ");\n";
            emitCompactFixedRowScanBounds(collectBody, rule, row.size(), "    ");
            collectBody << "    for (int32_t primary = 0; primary < primaryLimit; ++primary) {\n"
                        << "        compact_turn_count_row_scans_" << suffix << "();\n";
            if (rowMask.hasAnyLinePrecondition) {
                collectBody << "        if (!compact_turn_line_has_required_masks_" << suffix
                            << "(dimensions, levelState, scratch, horizontalScan, primary, "
                            << rowMask.objectMaskName << ", " << rowMask.movementMaskName << ", "
                            << rowMask.missingObjectMaskName << ", " << rowMask.missingMovementMaskName << ", "
                            << rowMask.anyObjectMasksName << ", " << rowMask.anyObjectMaskCount << ", "
                            << rowMask.anyMovementMasksName << ", " << rowMask.anyMovementMaskCount << ")) continue;\n";
            }
            collectBody << "        compact_turn_count_candidate_cells_tested_" << suffix << "(static_cast<uint64_t>(secondarySpan));\n"
                        << "        const int32_t scanStep = horizontalScan ? dimensions.height : 1;\n"
                        << "        int32_t startIndex = horizontalScan\n"
                        << "            ? secondaryStart * dimensions.height + primary\n"
                        << "            : primary * dimensions.height + secondaryStart;\n"
                        << "    for (int32_t secondary = secondaryStart; secondary < secondaryEnd; ++secondary, startIndex += scanStep) {\n"
                        << "        positions.clear();\n"
                        << "        bool matched = true;\n";
            for (size_t patternIndex = 0; patternIndex < row.size(); ++patternIndex) {
                emitCompactFixedTileAtDirection(
                    collectBody,
                    "        ",
                    suffix,
                    "tile_" + std::to_string(patternIndex),
                    "startIndex",
                rule.direction,
                static_cast<int32_t>(patternIndex),
                "matched = false;"
            );
                const std::string tileName = "tile_" + std::to_string(patternIndex);
                if (compactPatternCanInlineMatch(row[patternIndex])) {
                    emitCompactInlinePatternMatchTest(
                        collectBody,
                        game,
                        row[patternIndex],
                        suffix,
                        "        ",
                        tileName,
                        tileName,
                        "matched"
                    );
                } else {
                    collectBody << "        if (matched && !"
                                << compactPatternMatchesCall(game, masks, row[patternIndex], suffix, phase, groupIndex, ruleIndex, rowIndex, patternIndex, tileName)
                                << ") matched = false;\n";
                }
                collectBody << "        if (matched) positions.push_back(tile_" << patternIndex << ");\n";
            }
            collectBody << "        if (matched) rowMatches.push_back(positions);\n"
                        << "    }\n"
                        << "    }\n";
        } else {
            int32_t concreteCount = 0;
            std::vector<int32_t> concreteSuffix(row.size() + 1, 0);
            for (int32_t patternIndex = static_cast<int32_t>(row.size()) - 1; patternIndex >= 0; --patternIndex) {
                concreteSuffix[static_cast<size_t>(patternIndex)] = concreteSuffix[static_cast<size_t>(patternIndex + 1)]
                    + (row[static_cast<size_t>(patternIndex)].kind == Pattern::Kind::Ellipsis ? 0 : 1);
            }
            for (const Pattern& pattern : row) {
                if (pattern.kind != Pattern::Kind::Ellipsis) {
                    ++concreteCount;
                }
            }
            collectBody << "    std::vector<int32_t> positions;\n"
                        << "    positions.reserve(" << concreteCount << ");\n"
                        << "    for (int32_t primary = 0; primary < primaryLimit; ++primary) {\n"
                        << "        compact_turn_count_row_scans_" << suffix << "();\n";
            if (rowMask.hasAnyLinePrecondition) {
                collectBody << "        if (!compact_turn_line_has_required_masks_" << suffix
                            << "(dimensions, levelState, scratch, horizontalScan, primary, "
                            << rowMask.objectMaskName << ", " << rowMask.movementMaskName << ", "
                            << rowMask.missingObjectMaskName << ", " << rowMask.missingMovementMaskName << ", "
                            << rowMask.anyObjectMasksName << ", " << rowMask.anyObjectMaskCount << ", "
                            << rowMask.anyMovementMasksName << ", " << rowMask.anyMovementMaskCount << ")) continue;\n";
            }
            collectBody << "        compact_turn_count_ellipsis_scans_" << suffix << "(static_cast<uint64_t>(secondaryLimit));\n"
                        << "        const int32_t scanStep = horizontalScan ? dimensions.height : 1;\n"
                        << "        int32_t startIndex = horizontalScan ? primary : primary * dimensions.height;\n"
                        << "    for (int32_t secondary = 0; secondary < secondaryLimit; ++secondary, startIndex += scanStep) {\n"
                        << "        const int32_t available = compact_turn_available_at_direction_" << suffix
                        << "(dimensions, startIndex, " << rule.direction << ");\n"
                        << "        if (available < " << concreteCount << ") continue;\n"
                        << "        positions.clear();\n"
                        << "        auto search = [&](auto&& self, size_t patternIndex, int32_t offset) -> void {\n"
                        << "            if (patternIndex >= " << row.size() << ") {\n"
                        << "                rowMatches.push_back(positions);\n"
                        << "                return;\n"
                        << "            }\n"
                        << "            switch (patternIndex) {\n";
            for (size_t patternIndex = 0; patternIndex < row.size(); ++patternIndex) {
                collectBody << "                case " << patternIndex << ":\n";
                if (row[patternIndex].kind == Pattern::Kind::Ellipsis) {
                    collectBody << "                {\n"
                                << "                    const int32_t maxSkip = available - offset - " << concreteSuffix[patternIndex + 1] << ";\n"
                                << "                    for (int32_t skip = 0; skip <= maxSkip; ++skip) {\n"
                                << "                        self(self, patternIndex + 1, offset + skip);\n"
                                << "                    }\n"
                                << "                    return;\n"
                                << "                }\n";
                } else {
                    collectBody << "                {\n"
                                << "                    if (offset >= available) return;\n"
                                << "                    int32_t tileIndex = 0;\n"
                                << "                    if (!compact_turn_cell_at_direction_" << suffix
                                << "(dimensions, startIndex, " << rule.direction << ", offset, tileIndex)) return;\n"
                                << "                    bool matched = true;\n";
                    if (compactPatternCanInlineMatch(row[patternIndex])) {
                        emitCompactInlinePatternMatchTest(
                            collectBody,
                            game,
                            row[patternIndex],
                            suffix,
                            "                    ",
                            "tileIndex",
                            "tileIndex",
                            "matched"
                        );
                    } else {
                        collectBody << "                    if (!"
                                    << compactPatternMatchesCall(game, masks, row[patternIndex], suffix, phase, groupIndex, ruleIndex, rowIndex, patternIndex, "tileIndex")
                                    << ") matched = false;\n";
                    }
                    collectBody << "                    if (!matched) return;\n"
                                << "                    positions.push_back(tileIndex);\n"
                                << "                    self(self, patternIndex + 1, offset + 1);\n"
                                << "                    positions.pop_back();\n"
                                << "                    return;\n"
                                << "                }\n";
                }
            }
            collectBody << "                default:\n"
                        << "                    return;\n"
                        << "            }\n"
                        << "        };\n"
                        << "        search(search, 0, 0);\n"
                        << "    }\n"
                        << "    }\n";
        }
        collectBody << "    return !rowMatches.empty();\n"
                    << "}\n";
        rowCollectNames[rowIndex] = functions.emitDefinition(out, rowPrefix + "_collect_matches", collectBody.str());
        out << "\n";
    }
    const std::string commandQueueName = emitCompactRuleCommandFunction(out, functions, rule, prefix, suffix);

    if (!groupIsRandom && rule.patterns.size() == 1) {
        const size_t rowIndex = 0;
        const std::vector<Pattern>& row = rule.patterns[rowIndex];
        std::ostringstream applyBody;
        applyBody << "(LevelDimensions dimensions, PersistentLevelState& levelState, Scratch& scratch, CompactTurnCommands_" << suffix << "& commands) {\n";
        emitCompactAggregateBindingComment(applyBody, rule);
        applyBody << "    std::vector<std::vector<int32_t>> matches;\n";
        if (useInternalRulePrecheck) {
            emitCompactRuleMaskPrecheck(applyBody, "    ", suffix, ruleMask, ruleApplyNoMatchExpr);
        }
        applyBody << "    if (!" << rowCollectNames[rowIndex] << "(dimensions, levelState, scratch, matches)) return " << ruleApplyNoMatchExpr << ";\n";
        emitCompactRuleCommandQueue(applyBody, commandQueueName);
        applyBody << "    bool changed = false;\n"
                  << "    for (size_t matchIndex = 0; matchIndex < matches.size(); ++matchIndex) {\n"
                  << "        const std::vector<int32_t>& match = matches[matchIndex];\n"
                  << "        bool stillMatches = true;\n"
                  << "        if (matchIndex != 0) {\n"
                  << "            size_t positionIndex = 0;\n";
        for (size_t patternIndex = 0; patternIndex < row.size(); ++patternIndex) {
            if (row[patternIndex].kind == Pattern::Kind::Ellipsis) {
                continue;
            }
            applyBody << "            if (positionIndex >= match.size()) {\n"
                      << "                stillMatches = false;\n"
                      << "            } else {\n"
                      << "                bool matched_" << patternIndex << " = true;\n";
            if (compactPatternCanInlineMatch(row[patternIndex])) {
                const std::string tileName = "tile_" + std::to_string(patternIndex);
                applyBody << "                const int32_t " << tileName << " = match[positionIndex];\n";
                emitCompactInlinePatternMatchTest(
                    applyBody,
                    game,
                    row[patternIndex],
                    suffix,
                    "                ",
                    tileName,
                    tileName,
                    "matched_" + std::to_string(patternIndex)
                );
            } else {
                applyBody << "                if (!"
                          << compactPatternMatchesCall(game, masks, row[patternIndex], suffix, phase, groupIndex, ruleIndex, rowIndex, patternIndex, "match[positionIndex]")
                          << ") matched_" << patternIndex << " = false;\n";
            }
            applyBody << "                if (!matched_" << patternIndex << ") stillMatches = false;\n"
                      << "            }\n"
                      << "            ++positionIndex;\n";
        }
        applyBody << "            stillMatches = stillMatches && positionIndex == match.size();\n"
                  << "        }\n"
                  << "        if (stillMatches) {\n"
                  << "            size_t positionIndex = 0;\n";
        emitCompactAggregateCaptureCode(
            applyBody,
            rule,
            suffix,
            std::vector<std::string>{"match.empty() ? -1 : match.front()"},
            "            "
        );
        for (size_t patternIndex = 0; patternIndex < row.size(); ++patternIndex) {
            if (row[patternIndex].kind == Pattern::Kind::Ellipsis) {
                continue;
            }
            applyBody << "            if (positionIndex >= match.size()) break;\n";
            if (row[patternIndex].replacement.has_value()
                && !compactPatternGeneratedReplacementGuaranteedNoopOnMatch(
                    game, rule, row[patternIndex], rowIndex, rigidGroupIndex)) {
                applyBody << "            changed = "
                          << compactPatternApplyCall(
                              game,
                              masks,
                              rule,
                              row[patternIndex],
                              suffix,
                              phase,
                              groupIndex,
                              ruleIndex,
                              rowIndex,
                              patternIndex,
                              "match[positionIndex]",
                              std::to_string(rigidGroupIndex),
                              rigidGroupIndex,
                              compactAggregateCapturesExpr(rule),
                              compactAggregateCaptureCountExpr(rule)
                          )
                          << " || changed;\n";
            }
            applyBody << "            ++positionIndex;\n";
        }
        applyBody << "        }\n"
                  << "    }\n"
                  << "    return " << ruleApplyChangedExpr << ";\n"
                  << "}\n";
        const std::string applyName = functions.emitDefinition(out, prefix + "_apply", applyBody.str());
        out << "\n";
        return makeCompactRuleGeneratedNames(
            applyName,
            commandQueueName,
            precheckName,
            precheckKey,
            writesObjectsName,
            writesMovementsName,
            ruleMask.hasAnyRequiredMask,
            effectiveWrites.objects,
            effectiveWrites.movements
        );
    }

    if (!groupIsRandom && rule.patterns.size() > 1) {
        std::ostringstream applyBody;
        applyBody << "(LevelDimensions dimensions, PersistentLevelState& levelState, Scratch& scratch, CompactTurnCommands_" << suffix << "& commands) {\n";
        emitCompactAggregateBindingComment(applyBody, rule);
        applyBody << "    constexpr size_t rowCount = " << rule.patterns.size() << ";\n"
                  << "    const int32_t tileCount = compact_turn_tile_count_" << suffix << "(dimensions);\n"
                  << "    if (tileCount <= 0) return " << ruleApplyNoMatchExpr << ";\n"
                  << "    constexpr bool horizontalScan = " << (rule.direction > 2 ? "true" : "false") << ";\n"
                  << "    const int32_t primaryLimit = horizontalScan ? dimensions.height : dimensions.width;\n"
                  << "    const int32_t secondaryLimit = horizontalScan ? dimensions.width : dimensions.height;\n";
        if (useInternalRulePrecheck) {
            emitCompactRuleMaskPrecheck(applyBody, "    ", suffix, ruleMask, ruleApplyNoMatchExpr);
        }
        for (size_t rowIndex = 0; rowIndex < rule.patterns.size(); ++rowIndex) {
            const std::vector<Pattern>& row = rule.patterns[rowIndex];
            if (rule.ellipsisCount[rowIndex] == 0) {
                const CompactRowMaskInfo rowMask = compactRowMaskInfo(game, masks, rule, rowIndex, suffix, phase, groupIndex, ruleIndex);
                applyBody << "    std::vector<int32_t> matches_" << rowIndex << ";\n"
                          << "    for (int32_t primary = 0; primary < primaryLimit; ++primary) {\n"
                          << (rowMask.hasAnyLinePrecondition
                              ? "        if (!compact_turn_line_has_required_masks_" + std::string(suffix)
                                  + "(dimensions, levelState, scratch, horizontalScan, primary, "
                                  + rowMask.objectMaskName + ", " + rowMask.movementMaskName + ", "
                                  + rowMask.missingObjectMaskName + ", " + rowMask.missingMovementMaskName + ", "
                                  + rowMask.anyObjectMasksName + ", " + std::to_string(rowMask.anyObjectMaskCount) + ", "
                                  + rowMask.anyMovementMasksName + ", " + std::to_string(rowMask.anyMovementMaskCount) + ")) continue;\n"
                              : std::string{})
                          << "        const int32_t scanStep = horizontalScan ? dimensions.height : 1;\n"
                          << "        int32_t startIndex = horizontalScan ? primary : primary * dimensions.height;\n"
                          << "    for (int32_t secondary = 0; secondary < secondaryLimit; ++secondary, startIndex += scanStep) {\n"
                          << "        bool matched = true;\n";
                for (size_t patternIndex = 0; patternIndex < row.size(); ++patternIndex) {
                    emitCompactFixedTileAtDirection(
                        applyBody,
                        "        ",
                        suffix,
                        "tile_" + std::to_string(rowIndex) + "_" + std::to_string(patternIndex),
                        "startIndex",
                        rule.direction,
                        static_cast<int32_t>(patternIndex),
                        "matched = false;"
                    );
                    const std::string tileName = "tile_" + std::to_string(rowIndex) + "_" + std::to_string(patternIndex);
                    if (compactPatternCanInlineMatch(row[patternIndex])) {
                        emitCompactInlinePatternMatchTest(
                            applyBody,
                            game,
                            row[patternIndex],
                            suffix,
                            "        ",
                            tileName,
                            tileName,
                            "matched"
                        );
                    } else {
                        applyBody << "        if (matched && !"
                                  << compactPatternMatchesCall(
                                      game,
                                      masks,
                                      row[patternIndex],
                                      suffix,
                                      phase,
                                      groupIndex,
                                      ruleIndex,
                                      rowIndex,
                                      patternIndex,
                                      tileName
                                  )
                                  << ") matched = false;\n";
                    }
                }
                applyBody << "        if (matched) matches_" << rowIndex << ".push_back(startIndex);\n"
                          << "    }\n"
                          << "    }\n"
                          << "    if (matches_" << rowIndex << ".empty()) return " << ruleApplyNoMatchExpr << ";\n";
            } else {
                applyBody << "    std::vector<std::vector<int32_t>> matches_" << rowIndex << ";\n"
                          << "    if (!" << rowCollectNames[rowIndex] << "(dimensions, levelState, scratch, matches_" << rowIndex << ")) return " << ruleApplyNoMatchExpr << ";\n";
            }
        }
        emitCompactRuleCommandQueue(applyBody, commandQueueName);
        applyBody << "    std::array<size_t, rowCount> tupleIndex{};\n"
                  << "    bool firstTuple = true;\n"
                  << "    bool changed = false;\n"
                  << "    while (true) {\n"
                  << "        bool stillMatches = true;\n"
                  << "        if (!firstTuple) {\n";
        for (size_t rowIndex = 0; rowIndex < rule.patterns.size(); ++rowIndex) {
            const std::vector<Pattern>& row = rule.patterns[rowIndex];
            if (rule.ellipsisCount[rowIndex] == 0) {
                applyBody << "            const int32_t startIndex_" << rowIndex << " = matches_" << rowIndex << "[tupleIndex[" << rowIndex << "]];\n";
                for (size_t patternIndex = 0; patternIndex < row.size(); ++patternIndex) {
                    emitCompactFixedTileAtDirection(
                        applyBody,
                        "            ",
                        suffix,
                        "tile_" + std::to_string(rowIndex) + "_" + std::to_string(patternIndex),
                        "startIndex_" + std::to_string(rowIndex),
                        rule.direction,
                        static_cast<int32_t>(patternIndex),
                        "stillMatches = false;"
                    );
                    const std::string tileName = "tile_" + std::to_string(rowIndex) + "_" + std::to_string(patternIndex);
                    if (compactPatternCanInlineMatch(row[patternIndex])) {
                        emitCompactInlinePatternMatchTest(
                            applyBody,
                            game,
                            row[patternIndex],
                            suffix,
                            "            ",
                            tileName,
                            tileName,
                            "stillMatches"
                        );
                    } else {
                        applyBody << "            if (stillMatches && !"
                                  << compactPatternMatchesCall(
                                      game,
                                      masks,
                                      row[patternIndex],
                                      suffix,
                                      phase,
                                      groupIndex,
                                      ruleIndex,
                                      rowIndex,
                                      patternIndex,
                                      tileName
                                  )
                                  << ") stillMatches = false;\n";
                    }
                }
            } else {
                applyBody << "            if (!" << rowMatchNames[rowIndex]
                          << "(levelState, scratch, matches_" << rowIndex << "[tupleIndex[" << rowIndex << "]])) stillMatches = false;\n";
            }
        }
        applyBody << "        }\n"
                  << "        if (stillMatches) {\n";
        {
            std::vector<std::string> rowStartExprs;
            rowStartExprs.reserve(rule.patterns.size());
            for (size_t captureRowIndex = 0; captureRowIndex < rule.patterns.size(); ++captureRowIndex) {
                if (rule.ellipsisCount[captureRowIndex] == 0) {
                    rowStartExprs.push_back(
                        "matches_" + std::to_string(captureRowIndex)
                        + "[tupleIndex[" + std::to_string(captureRowIndex) + "]]"
                    );
                } else {
                    rowStartExprs.push_back(
                        "matches_" + std::to_string(captureRowIndex)
                        + "[tupleIndex[" + std::to_string(captureRowIndex) + "]].empty() ? -1 : matches_"
                        + std::to_string(captureRowIndex)
                        + "[tupleIndex[" + std::to_string(captureRowIndex) + "]].front()"
                    );
                }
            }
            emitCompactAggregateCaptureCode(applyBody, rule, suffix, rowStartExprs, "            ");
        }
        for (size_t rowIndex = 0; rowIndex < rule.patterns.size(); ++rowIndex) {
            const std::vector<Pattern>& row = rule.patterns[rowIndex];
            if (rule.ellipsisCount[rowIndex] == 0) {
                applyBody << "            const int32_t applyStartIndex_" << rowIndex << " = matches_" << rowIndex << "[tupleIndex[" << rowIndex << "]];\n";
                for (size_t patternIndex = 0; patternIndex < row.size(); ++patternIndex) {
                    if (!row[patternIndex].replacement.has_value()
                        || compactPatternGeneratedReplacementGuaranteedNoopOnMatch(
                            game, rule, row[patternIndex], rowIndex, rigidGroupIndex)) {
                        continue;
                    }
                    emitCompactFixedTileAtDirection(
                        applyBody,
                        "            ",
                        suffix,
                        "applyTile_" + std::to_string(rowIndex) + "_" + std::to_string(patternIndex),
                        "applyStartIndex_" + std::to_string(rowIndex),
                        rule.direction,
                        static_cast<int32_t>(patternIndex),
                        "return " + ruleApplyChangedExpr + ";"
                    );
                    applyBody << "            changed = "
                              << compactPatternApplyCall(
                                  game,
                                  masks,
                                  rule,
                                  row[patternIndex],
                                  suffix,
                                  phase,
                                  groupIndex,
                                  ruleIndex,
                                  rowIndex,
                                  patternIndex,
                                  "applyTile_" + std::to_string(rowIndex) + "_" + std::to_string(patternIndex),
                                  std::to_string(rigidGroupIndex),
                                  rigidGroupIndex,
                                  compactAggregateCapturesExpr(rule),
                                  compactAggregateCaptureCountExpr(rule)
                              )
                              << " || changed;\n";
                }
            } else {
                applyBody << "            changed = " << rowApplyNames[rowIndex]
                          << "(dimensions, levelState, scratch, matches_" << rowIndex << "[tupleIndex[" << rowIndex << "]], "
                          << compactAggregateCapturesExpr(rule) << ", "
                          << compactAggregateCaptureCountExpr(rule) << ") || changed;\n";
            }
        }
        applyBody << "        }\n"
                  << "        firstTuple = false;\n"
                  << "        size_t rowToIncrement = 0;\n"
                  << "        while (rowToIncrement < rowCount) {\n"
                  << "            ++tupleIndex[rowToIncrement];\n"
                  << "            bool rowHasMore = false;\n"
                  << "            switch (rowToIncrement) {\n";
        for (size_t rowIndex = 0; rowIndex < rule.patterns.size(); ++rowIndex) {
            applyBody << "                case " << rowIndex << ":\n"
                      << "                    rowHasMore = tupleIndex[rowToIncrement] < matches_" << rowIndex << ".size();\n"
                      << "                    break;\n";
        }
        applyBody << "                default:\n"
                  << "                    break;\n"
                  << "            }\n"
                  << "            if (rowHasMore) break;\n"
                  << "            tupleIndex[rowToIncrement] = 0;\n"
                  << "            ++rowToIncrement;\n"
                  << "        }\n"
                  << "        if (rowToIncrement == rowCount) break;\n"
                  << "    }\n"
                  << "    return " << ruleApplyChangedExpr << ";\n"
                  << "}\n";
        const std::string applyName = functions.emitDefinition(out, prefix + "_apply", applyBody.str());
        out << "\n";
        return makeCompactRuleGeneratedNames(
            applyName,
            commandQueueName,
            precheckName,
            precheckKey,
            writesObjectsName,
            writesMovementsName,
            ruleMask.hasAnyRequiredMask,
            effectiveWrites.objects,
            effectiveWrites.movements
        );
    }

    if (groupIsRandom) {
        out << "bool " << prefix << "_collect_matches(LevelDimensions dimensions, const PersistentLevelState& levelState, const Scratch& scratch, std::vector<std::vector<std::vector<int32_t>>>& matches) {\n"
            << "    constexpr size_t rowCount = " << rule.patterns.size() << ";\n";
        emitCompactRuleMaskPrecheck(out, "    ", suffix, ruleMask);
        out << "    matches.assign(rowCount, std::vector<std::vector<int32_t>>{});\n";
        for (size_t rowIndex = 0; rowIndex < rule.patterns.size(); ++rowIndex) {
            out << "    if (!" << rowCollectNames[rowIndex] << "(dimensions, levelState, scratch, matches[" << rowIndex << "])) return false;\n";
        }
        out << "    return true;\n"
            << "}\n\n";

        out << "bool " << prefix << "_tuple_still_matches(const PersistentLevelState& levelState, const Scratch& scratch, const std::vector<std::vector<std::vector<int32_t>>>& matches, const std::vector<size_t>& tupleIndex) {\n";
        for (size_t rowIndex = 0; rowIndex < rule.patterns.size(); ++rowIndex) {
            out << "    if (!" << rowMatchNames[rowIndex]
                << "(levelState, scratch, matches[" << rowIndex << "][tupleIndex[" << rowIndex << "]])) return false;\n";
        }
        out << "    return true;\n"
            << "}\n\n";

        out << "bool " << prefix << "_apply_tuple(LevelDimensions dimensions, PersistentLevelState& levelState, Scratch& scratch, const std::vector<std::vector<std::vector<int32_t>>>& matches, const std::vector<size_t>& tupleIndex) {\n";
        emitCompactAggregateBindingComment(out, rule);
        {
            std::vector<std::string> rowStartExprs;
            rowStartExprs.reserve(rule.patterns.size());
            for (size_t captureRowIndex = 0; captureRowIndex < rule.patterns.size(); ++captureRowIndex) {
                rowStartExprs.push_back(
                    "matches[" + std::to_string(captureRowIndex)
                    + "][tupleIndex[" + std::to_string(captureRowIndex) + "]].empty() ? -1 : matches["
                    + std::to_string(captureRowIndex)
                    + "][tupleIndex[" + std::to_string(captureRowIndex) + "]].front()"
                );
            }
            emitCompactAggregateCaptureCode(out, rule, suffix, rowStartExprs, "    ");
        }
        out << "    bool changed = false;\n";
        for (size_t rowIndex = 0; rowIndex < rule.patterns.size(); ++rowIndex) {
            out << "    changed = " << rowApplyNames[rowIndex]
                << "(dimensions, levelState, scratch, matches[" << rowIndex << "][tupleIndex[" << rowIndex << "]], "
                << compactAggregateCapturesExpr(rule) << ", "
                << compactAggregateCaptureCountExpr(rule) << ") || changed;\n";
        }
        out << "    return compact_turn_count_rule_apply_result_" << suffix << "(changed);\n"
            << "}\n\n";
    }

    std::ostringstream applyBody;
    applyBody << "(LevelDimensions dimensions, PersistentLevelState& levelState, Scratch& scratch, CompactTurnCommands_" << suffix << "& commands) {\n";
    emitCompactAggregateBindingComment(applyBody, rule);
    applyBody << "    constexpr size_t rowCount = " << rule.patterns.size() << ";\n"
              << "    std::vector<std::vector<std::vector<int32_t>>> matches;\n";
    if (useInternalRulePrecheck) {
        emitCompactRuleMaskPrecheck(applyBody, "    ", suffix, ruleMask, ruleApplyNoMatchExpr);
    }
    if (groupIsRandom) {
        applyBody << "    if (!" << prefix << "_collect_matches(dimensions, levelState, scratch, matches)) return " << ruleApplyNoMatchExpr << ";\n";
    } else {
        applyBody << "    matches.assign(rowCount, std::vector<std::vector<int32_t>>{});\n";
        for (size_t rowIndex = 0; rowIndex < rule.patterns.size(); ++rowIndex) {
            applyBody << "    if (!" << rowCollectNames[rowIndex] << "(dimensions, levelState, scratch, matches[" << rowIndex << "])) return " << ruleApplyNoMatchExpr << ";\n";
        }
    }
    emitCompactRuleCommandQueue(applyBody, commandQueueName);
    applyBody << "    std::vector<size_t> tupleIndex(rowCount, 0);\n"
              << "    bool firstTuple = true;\n"
              << "    bool changed = false;\n"
              << "    while (true) {\n"
              << "        bool stillMatches = true;\n"
              << "        if (!firstTuple) {\n";
    if (groupIsRandom) {
        applyBody << "            stillMatches = " << prefix << "_tuple_still_matches(levelState, scratch, matches, tupleIndex);\n";
    } else {
        for (size_t rowIndex = 0; rowIndex < rule.patterns.size(); ++rowIndex) {
            applyBody << "            if (!" << rowMatchNames[rowIndex]
                      << "(levelState, scratch, matches[" << rowIndex << "][tupleIndex[" << rowIndex << "]])) stillMatches = false;\n";
        }
    }
    applyBody << "        }\n"
              << "        if (stillMatches) {\n";
    if (groupIsRandom) {
        applyBody << "            compact_turn_count_rule_apply_call_" << suffix << "();\n";
        applyBody << "            changed = " << prefix << "_apply_tuple(dimensions, levelState, scratch, matches, tupleIndex) || changed;\n";
    } else {
        {
            std::vector<std::string> rowStartExprs;
            rowStartExprs.reserve(rule.patterns.size());
            for (size_t captureRowIndex = 0; captureRowIndex < rule.patterns.size(); ++captureRowIndex) {
                rowStartExprs.push_back(
                    "matches[" + std::to_string(captureRowIndex)
                    + "][tupleIndex[" + std::to_string(captureRowIndex) + "]].empty() ? -1 : matches["
                    + std::to_string(captureRowIndex)
                    + "][tupleIndex[" + std::to_string(captureRowIndex) + "]].front()"
                );
            }
            emitCompactAggregateCaptureCode(applyBody, rule, suffix, rowStartExprs, "            ");
        }
        for (size_t rowIndex = 0; rowIndex < rule.patterns.size(); ++rowIndex) {
            applyBody << "            changed = " << rowApplyNames[rowIndex]
                      << "(dimensions, levelState, scratch, matches[" << rowIndex << "][tupleIndex[" << rowIndex << "]], "
                      << compactAggregateCapturesExpr(rule) << ", "
                      << compactAggregateCaptureCountExpr(rule) << ") || changed;\n";
        }
    }
    applyBody << "        }\n"
              << "        firstTuple = false;\n"
              << "        size_t rowToIncrement = 0;\n"
              << "        while (rowToIncrement < rowCount) {\n"
              << "            ++tupleIndex[rowToIncrement];\n"
              << "            if (tupleIndex[rowToIncrement] < matches[rowToIncrement].size()) break;\n"
              << "            tupleIndex[rowToIncrement] = 0;\n"
              << "            ++rowToIncrement;\n"
              << "        }\n"
              << "        if (rowToIncrement == rowCount) break;\n"
              << "    }\n"
              << "    return " << ruleApplyChangedExpr << ";\n"
              << "}\n";
    const std::string applyName = functions.emitDefinition(out, prefix + "_apply", applyBody.str());
    out << "\n";
    return makeCompactRuleGeneratedNames(
        applyName,
        commandQueueName,
        precheckName,
        precheckKey,
        writesObjectsName,
        writesMovementsName,
        ruleMask.hasAnyRequiredMask,
        effectiveWrites.objects,
        effectiveWrites.movements
    );
}

void emitCompactRulegroupFunctions(
    std::ostream& out,
    const Game& game,
    const CompactMaskConstantEmitter& masks,
    CompactFunctionInterner& functions,
    const std::vector<std::vector<Rule>>& groups,
    const LoopPointTable& loopPoint,
    std::string_view suffix,
    std::string_view phase
) {
    for (size_t groupIndex = 0; groupIndex < groups.size(); ++groupIndex) {
        const std::vector<Rule>& group = groups[groupIndex];
        const bool groupIsRandom = !group.empty() && group[0].isRandom;
        std::vector<CompactRuleGeneratedNames> ruleNames(group.size());
        for (size_t ruleIndex = 0; ruleIndex < group.size(); ++ruleIndex) {
            ruleNames[ruleIndex] = emitCompactRuleFunction(
                out,
                game,
                masks,
                functions,
                group[ruleIndex],
                suffix,
                phase,
                groupIndex,
                ruleIndex,
                groupIsRandom,
                groupIsRandom ? CompactRulePrecheckMode::Internal : CompactRulePrecheckMode::External
            );
        }

        const std::string groupPrefix = compactGroupPrefix(suffix, phase, groupIndex);
        const uint8_t groupFirstActiveInputsMask = group.empty() ? 0x3f : group.front().activeInputsMask;
        const bool groupHasInputSpecialization = std::any_of(
            group.begin(),
            group.end(),
            [](const Rule& rule) {
                return rule.activeInputsMask != 0x3f;
            }
        );
        const bool groupUsesInputSpecialization =
            groupHasInputSpecialization
            && compactInputSpecializationSkipOpportunity(group) >= 3;
        const bool groupHasUniformActiveInputsMask = std::all_of(
            group.begin(),
            group.end(),
            [groupFirstActiveInputsMask](const Rule& rule) {
                return rule.activeInputsMask == groupFirstActiveInputsMask;
            }
        );
        const bool groupNeedsPerRuleInputGuard =
            groupUsesInputSpecialization && !groupHasUniformActiveInputsMask;
        const CompactSpreadGroupShape spreadGroupShape = analyzeCompactSpreadGroupShape(game, group);
        if (spreadGroupShape.supported) {
            const std::string spreadApplyName = emitCompactSpreadGroupApplyFunction(
                out,
                game,
                masks,
                group,
                spreadGroupShape,
                suffix,
                phase,
                groupIndex
            );
            out << "bool " << groupPrefix << "_apply(LevelDimensions dimensions, PersistentLevelState& levelState, Scratch& scratch, CompactTurnCommands_" << suffix << "& commands, std::vector<bool>* bannedGroups) {\n";
            out << "    if (bannedGroups != nullptr && " << groupIndex << " < bannedGroups->size() && (*bannedGroups)[" << groupIndex << "]) return false;\n"
                << "    const bool useInputSpecialization = " << (groupUsesInputSpecialization ? "inputSpecializationEnabled()" : "false") << ";\n";
            if (groupUsesInputSpecialization) {
                out << "    if (useInputSpecialization && (static_cast<uint8_t>(" << static_cast<int32_t>(groupFirstActiveInputsMask)
                    << ") & scratch.currentInputMask) == 0) {\n"
                    << "        compact_turn_count_rules_skipped_by_mask_" << suffix << "(" << group.size() << ");\n"
                    << "        return false;\n"
                    << "    }\n";
            }
            out << "    return " << spreadApplyName << "(dimensions, levelState, scratch, commands);\n"
                << "}\n\n";
            continue;
        }
        if (!group.empty() && !groupIsRandom) {
            const size_t chunkCount = (group.size() + kCompactRulegroupApplyChunkSize - 1) / kCompactRulegroupApplyChunkSize;
            for (size_t chunkIndex = 0; chunkIndex < chunkCount; ++chunkIndex) {
                out << "bool " << groupPrefix << "_apply_chunk_" << chunkIndex
                    << "(LevelDimensions dimensions, PersistentLevelState& levelState, Scratch& scratch, CompactTurnCommands_" << suffix
                    << "& commands, bool& madeChangeThisLoop, int32_t& consecutiveFailures, bool useInputSpecialization, size_t activeGroupLength);\n";
            }
            out << "\n";
        }
        out << "bool " << groupPrefix << "_apply(LevelDimensions dimensions, PersistentLevelState& levelState, Scratch& scratch, CompactTurnCommands_" << suffix << "& commands, std::vector<bool>* bannedGroups) {\n";
        if (group.empty()) {
            out << "    (void)dimensions;\n"
                << "    (void)levelState;\n"
                << "    (void)scratch;\n"
                << "    (void)commands;\n"
                << "    (void)bannedGroups;\n"
                << "    return false;\n"
                << "}\n\n";
            continue;
        }
        out << "    if (bannedGroups != nullptr && " << groupIndex << " < bannedGroups->size() && (*bannedGroups)[" << groupIndex << "]) return false;\n";
        if (!groupUsesInputSpecialization) {
            out << "    constexpr bool useInputSpecialization = false;\n"
                << "    constexpr size_t activeGroupLength = " << group.size() << ";\n";
        } else if (groupHasUniformActiveInputsMask) {
            out << "    const bool useInputSpecialization = inputSpecializationEnabled();\n"
                << "    constexpr size_t activeGroupLength = " << group.size() << ";\n"
                << "    if (useInputSpecialization && (static_cast<uint8_t>(" << static_cast<int32_t>(groupFirstActiveInputsMask)
                << ") & scratch.currentInputMask) == 0) {\n"
                << "        compact_turn_count_rules_skipped_by_mask_" << suffix << "(" << group.size() << ");\n"
                << "        return false;\n"
                << "    }\n";
        } else {
            out << "    const bool useInputSpecialization = inputSpecializationEnabled();\n"
                << "    const uint8_t currentInputMask = scratch.currentInputMask;\n"
                << "    size_t activeGroupLength = " << group.size() << ";\n"
                << "    if (useInputSpecialization) {\n"
                << "        activeGroupLength = 0;\n";
            for (size_t ruleIndex = 0; ruleIndex < group.size(); ++ruleIndex) {
                out << "        if ((static_cast<uint8_t>(" << static_cast<int32_t>(group[ruleIndex].activeInputsMask)
                    << ") & currentInputMask) != 0) ++activeGroupLength;\n";
            }
            out << "        if (activeGroupLength == 0) {\n"
                << "            compact_turn_count_rules_skipped_by_mask_" << suffix << "(" << group.size() << ");\n"
                << "            return false;\n"
                << "        }\n"
                << "    }\n";
        }
        const bool canEmitAllFailMaskPrecheck = !groupIsRandom
            && group.size() >= 4
            && std::all_of(
                ruleNames.begin(),
                ruleNames.end(),
                [](const CompactRuleGeneratedNames& names) {
                    return names.hasMaskPrecheck;
                }
            );
        if (canEmitAllFailMaskPrecheck) {
            std::vector<size_t> uniquePrecheckRuleIndices;
            for (size_t ruleIndex = 0; ruleIndex < ruleNames.size(); ++ruleIndex) {
                const std::string& precheckKey = ruleNames[ruleIndex].precheckKey;
                const bool alreadySeen = std::any_of(
                    uniquePrecheckRuleIndices.begin(),
                    uniquePrecheckRuleIndices.end(),
                    [&](size_t seenRuleIndex) {
                        return ruleNames[seenRuleIndex].precheckKey == precheckKey;
                    }
                );
                if (!alreadySeen) {
                    uniquePrecheckRuleIndices.push_back(ruleIndex);
                }
            }
            out << "    if (";
            for (size_t index = 0; index < uniquePrecheckRuleIndices.size(); ++index) {
                if (index > 0) {
                    out << " && ";
                }
                const size_t ruleIndex = uniquePrecheckRuleIndices[index];
                out << "!" << ruleNames[ruleIndex].precheckName << "(scratch)";
            }
            out << ") {\n"
                << "        compact_turn_count_rules_visited_" << suffix << "(" << group.size() << ");\n"
                << "        compact_turn_count_rule_mask_precheck_failure_" << suffix << "(" << group.size() << ");\n"
                << "        compact_turn_count_rules_skipped_by_mask_" << suffix << "(" << group.size() << ");\n"
                << "        return false;\n"
                << "    }\n";
        }
        if (groupIsRandom) {
            out << "    std::vector<std::vector<std::vector<std::vector<int32_t>>>> groupMatches(" << group.size() << ");\n"
                << "    std::array<uint64_t, " << group.size() << "> ruleCandidateCounts{};\n"
                << "    uint64_t totalCandidateCount = 0;\n"
                << "    constexpr uint64_t maxCandidateCount = static_cast<uint64_t>(~uint64_t{0});\n";
            for (size_t ruleIndex = 0; ruleIndex < group.size(); ++ruleIndex) {
                const std::string rulePrefix = compactRulePrefix(suffix, phase, groupIndex, ruleIndex);
                if (groupNeedsPerRuleInputGuard) {
                    out << "    if (useInputSpecialization && (static_cast<uint8_t>(" << static_cast<int32_t>(group[ruleIndex].activeInputsMask)
                        << ") & currentInputMask) == 0) {\n"
                        << "        compact_turn_count_rules_skipped_by_mask_" << suffix << "();\n"
                        << "    } else {\n";
                }
                const std::string ruleIndent = groupNeedsPerRuleInputGuard ? "    " : "";
                out << "#if defined(PS_GBA_PERF_TELEMETRY)\n"
                    << ruleIndent << "    ps_gba_perf_progress(" << (phase == "early" ? 2 : 4) << ", "
                    << ((static_cast<uint32_t>(groupIndex) << 16U) | static_cast<uint32_t>(ruleIndex)) << "U);\n"
                    << "#endif\n"
                    << ruleIndent << "    compact_turn_count_rules_visited_" << suffix << "();\n"
                    << ruleIndent << "    if (" << rulePrefix << "_collect_matches(dimensions, levelState, scratch, groupMatches[" << ruleIndex << "])) {\n"
                    << ruleIndent << "        bool hasMatchTuple = !groupMatches[" << ruleIndex << "].empty();\n"
                    << ruleIndent << "        for (const auto& rowMatches : groupMatches[" << ruleIndex << "]) {\n"
                    << ruleIndent << "            if (rowMatches.empty()) {\n"
                    << ruleIndent << "                hasMatchTuple = false;\n"
                    << ruleIndent << "                break;\n"
                    << ruleIndent << "            }\n"
                    << ruleIndent << "        }\n"
                    << ruleIndent << "        if (hasMatchTuple) {\n"
                    << ruleIndent << "            uint64_t candidateCount = 1;\n"
                    << ruleIndent << "            for (const auto& rowMatches : groupMatches[" << ruleIndex << "]) {\n"
                    << ruleIndent << "                const uint64_t rowCount = static_cast<uint64_t>(rowMatches.size());\n"
                    << ruleIndent << "                candidateCount = candidateCount > maxCandidateCount / rowCount\n"
                    << ruleIndent << "                    ? maxCandidateCount : candidateCount * rowCount;\n"
                    << ruleIndent << "            }\n"
                    << ruleIndent << "            ruleCandidateCounts[" << ruleIndex << "] = candidateCount;\n"
                    << ruleIndent << "            totalCandidateCount = totalCandidateCount > maxCandidateCount - candidateCount\n"
                    << ruleIndent << "                ? maxCandidateCount : totalCandidateCount + candidateCount;\n"
                    << ruleIndent << "        }\n"
                    << ruleIndent << "    }\n";
                if (groupNeedsPerRuleInputGuard) {
                    out << "    }\n";
                }
            }
            out << "    if (totalCandidateCount == 0) return false;\n"
                << "    const double randomValue = compact_turn_random_uniform_" << suffix << "(levelState.rng);\n"
                << "    uint64_t chosenTuple = std::min(totalCandidateCount - 1, static_cast<uint64_t>(randomValue * static_cast<double>(totalCandidateCount)));\n"
                << "    size_t chosenRuleIndex = 0;\n"
                << "    while (chosenRuleIndex < ruleCandidateCounts.size() && chosenTuple >= ruleCandidateCounts[chosenRuleIndex]) {\n"
                << "        chosenTuple -= ruleCandidateCounts[chosenRuleIndex];\n"
                << "        ++chosenRuleIndex;\n"
                << "    }\n"
                << "    if (chosenRuleIndex >= groupMatches.size()) return false;\n"
                << "    std::vector<size_t> chosenTupleIndex(groupMatches[chosenRuleIndex].size(), 0);\n"
                << "    for (size_t rowIndex = 0; rowIndex < chosenTupleIndex.size(); ++rowIndex) {\n"
                << "        const size_t rowCount = groupMatches[chosenRuleIndex][rowIndex].size();\n"
                << "        if (rowCount == 0) return false;\n"
                << "        chosenTupleIndex[rowIndex] = static_cast<size_t>(chosenTuple % rowCount);\n"
                << "        chosenTuple /= rowCount;\n"
                << "    }\n"
                << "    switch (chosenRuleIndex) {\n";
            for (size_t ruleIndex = 0; ruleIndex < group.size(); ++ruleIndex) {
                const std::string rulePrefix = compactRulePrefix(suffix, phase, groupIndex, ruleIndex);
                const CompactRuleGeneratedNames& names = ruleNames[ruleIndex];
                out << "        case " << ruleIndex << ":\n"
                    << (group[ruleIndex].commands.empty()
                        ? std::string{}
                        : "            " + ruleNames[ruleIndex].commandQueueName + "(commands);\n")
                    << "        {\n";
                if (names.writesObjects) {
                    out << "            scratch.dirtyObjectBoard = false;\n";
                }
                if (names.writesMovements) {
                    out << "            scratch.dirtyMovementBoard = false;\n";
                }
                out << "            compact_turn_count_rule_apply_call_" << suffix << "();\n"
                    << "            const bool changed = " << rulePrefix << "_apply_tuple(dimensions, levelState, scratch, groupMatches[" << ruleIndex << "], chosenTupleIndex);\n";
                if (names.writesObjects) {
                    out << "            const bool changedObjects = scratch.dirtyObjectBoard;\n";
                }
                if (names.writesMovements) {
                    out << "            const bool changedMovements = scratch.dirtyMovementBoard;\n";
                }
                if (names.writesObjects && names.writesMovements) {
                    out << "            if (changed && (changedObjects || changedMovements)) compact_turn_rebuild_rule_derived_state_" << suffix
                        << "(dimensions, levelState, scratch, changedObjects, changedMovements);\n";
                } else if (names.writesObjects) {
                    out << "            if (changed && changedObjects) compact_turn_rebuild_rule_derived_state_" << suffix
                        << "(dimensions, levelState, scratch, changedObjects, false);\n";
                } else if (names.writesMovements) {
                    out << "            if (changed && changedMovements) compact_turn_rebuild_rule_derived_state_" << suffix
                        << "(dimensions, levelState, scratch, false, changedMovements);\n";
                }
                out << "            return changed;\n"
                    << "        }\n";
            }
            out << "        default:\n"
                << "            return false;\n"
                << "    }\n"
                << "}\n\n";
            continue;
        }
        out << "    bool hasChanges = false;\n"
            << "    bool madeChangeThisLoop = true;\n"
            << "    int32_t loopCount = 0;\n"
            << "    while (madeChangeThisLoop && loopCount++ < 200) {\n"
            << "        madeChangeThisLoop = false;\n"
            << "        int32_t consecutiveFailures = 0;\n";
        const size_t chunkCount = (group.size() + kCompactRulegroupApplyChunkSize - 1) / kCompactRulegroupApplyChunkSize;
        for (size_t chunkIndex = 0; chunkIndex < chunkCount; ++chunkIndex) {
            out << "        if (" << groupPrefix << "_apply_chunk_" << chunkIndex
                << "(dimensions, levelState, scratch, commands, madeChangeThisLoop, consecutiveFailures, useInputSpecialization, activeGroupLength)) break;\n";
        }
        out << "        hasChanges = hasChanges || madeChangeThisLoop;\n"
            << "    }\n"
            << "    return hasChanges;\n"
            << "}\n\n";

        for (size_t chunkIndex = 0; chunkIndex < chunkCount; ++chunkIndex) {
            const size_t firstRuleIndex = chunkIndex * kCompactRulegroupApplyChunkSize;
            const size_t lastRuleIndex = std::min(group.size(), firstRuleIndex + kCompactRulegroupApplyChunkSize);
            out << "bool " << groupPrefix << "_apply_chunk_" << chunkIndex
                << "(LevelDimensions dimensions, PersistentLevelState& levelState, Scratch& scratch, CompactTurnCommands_" << suffix
                << "& commands, bool& madeChangeThisLoop, int32_t& consecutiveFailures, bool useInputSpecialization, size_t activeGroupLength) {\n";
            for (size_t ruleIndex = firstRuleIndex; ruleIndex < lastRuleIndex; ++ruleIndex) {
                const CompactRuleGeneratedNames& names = ruleNames[ruleIndex];
                const bool ruleCanCancel = std::any_of(
                    group[ruleIndex].commands.begin(), group[ruleIndex].commands.end(),
                    [](const RuleCommand& command) { return command.name == "cancel"; });
                const std::string ruleBaseIndent = groupNeedsPerRuleInputGuard ? "        " : "    ";
                std::string ruleIndent = ruleBaseIndent;
                if (groupNeedsPerRuleInputGuard) {
                    out << "    if (useInputSpecialization && (static_cast<uint8_t>(" << static_cast<int32_t>(group[ruleIndex].activeInputsMask)
                        << ") & scratch.currentInputMask) == 0) {\n"
                        << "        compact_turn_count_rules_skipped_by_mask_" << suffix << "();\n"
                        << "    } else {\n";
                }
                out << "#if defined(PS_GBA_PERF_TELEMETRY)\n"
                    << ruleBaseIndent << "ps_gba_perf_progress(" << (phase == "early" ? 2 : 4) << ", "
                    << ((static_cast<uint32_t>(groupIndex) << 16U) | static_cast<uint32_t>(ruleIndex)) << "U);\n"
                    << "#endif\n";
                out << ruleBaseIndent << "compact_turn_count_rules_visited_" << suffix << "();\n";
                if (names.hasMaskPrecheck) {
                    out << ruleBaseIndent << "if (!" << names.precheckName << "(scratch)) {\n"
                        << ruleBaseIndent << "    compact_turn_count_rule_mask_precheck_failure_" << suffix << "();\n"
                        << ruleBaseIndent << "    compact_turn_count_rules_skipped_by_mask_" << suffix << "();\n"
                        << ruleBaseIndent << "    ++consecutiveFailures;\n"
                        << ruleBaseIndent << "    if (static_cast<size_t>(consecutiveFailures) == activeGroupLength) return true;\n"
                        << ruleBaseIndent << "} else {\n"
                        << ruleBaseIndent << "    compact_turn_count_rule_mask_precheck_pass_" << suffix << "();\n";
                    ruleIndent = ruleBaseIndent + "    ";
                }
                if (names.writesObjects) {
                    out << ruleIndent << "scratch.dirtyObjectBoard = false;\n";
                }
                if (names.writesMovements) {
                    out << ruleIndent << "scratch.dirtyMovementBoard = false;\n";
                }
                if (ruleCanCancel) {
                    out << ruleIndent << "const bool hadCancel_" << ruleIndex << " = commands.hasCancel;\n";
                }
                out << "#if defined(PS_GBA_PERF_TELEMETRY)\n"
                    << ruleIndent << "const uint32_t perfRuleStart_" << ruleIndex << " = ps_gba_perf_group_begin();\n"
                    << "#endif\n"
                    << ruleIndent << "compact_turn_count_rule_apply_call_" << suffix << "();\n"
                    << ruleIndent << "const bool changed_" << ruleIndex << " = " << names.applyName
                    << "(dimensions, levelState, scratch, commands);\n";
                out << "#if defined(PS_GBA_PERF_TELEMETRY)\n"
                    << ruleIndent << "ps_gba_perf_group_end(" << (phase == "early" ? 3 : 5) << "U, "
                    << ((static_cast<uint32_t>(groupIndex) << 8U) | static_cast<uint32_t>(ruleIndex))
                    << "U, " << group[ruleIndex].lineNumber << "U, perfRuleStart_" << ruleIndex << ");\n"
                    << "#endif\n";
                if (names.writesObjects) {
                    out << ruleIndent << "const bool changedObjects_" << ruleIndex << " = scratch.dirtyObjectBoard;\n";
                }
                if (names.writesMovements) {
                    out << ruleIndent << "const bool changedMovements_" << ruleIndex << " = scratch.dirtyMovementBoard;\n";
                }
                out << ruleIndent << "if (changed_" << ruleIndex << ") {\n";
                if (names.writesObjects && names.writesMovements) {
                    out << ruleIndent << "    if (changedObjects_" << ruleIndex << " || changedMovements_" << ruleIndex << ") compact_turn_rebuild_rule_derived_state_" << suffix
                        << "(dimensions, levelState, scratch, changedObjects_" << ruleIndex << ", changedMovements_" << ruleIndex << ");\n";
                } else if (names.writesObjects) {
                    out << ruleIndent << "    if (changedObjects_" << ruleIndex << ") compact_turn_rebuild_rule_derived_state_" << suffix
                        << "(dimensions, levelState, scratch, changedObjects_" << ruleIndex << ", false);\n";
                } else if (names.writesMovements) {
                    out << ruleIndent << "    if (changedMovements_" << ruleIndex << ") compact_turn_rebuild_rule_derived_state_" << suffix
                        << "(dimensions, levelState, scratch, false, changedMovements_" << ruleIndex << ");\n";
                }
                out << ruleIndent << "    madeChangeThisLoop = true;\n"
                    << ruleIndent << "    consecutiveFailures = 0;\n"
                    << ruleIndent << "} else {\n"
                    << ruleIndent << "    ++consecutiveFailures;\n"
                    << ruleIndent << "    if (static_cast<size_t>(consecutiveFailures) == activeGroupLength) return true;\n"
                    << ruleIndent << "}\n";
                if (ruleCanCancel) {
                    out << ruleIndent << "if (!hadCancel_" << ruleIndex << " && commands.hasCancel) return true;\n";
                }
                if (names.hasMaskPrecheck) {
                    out << ruleBaseIndent << "}\n";
                }
                if (groupNeedsPerRuleInputGuard) {
                    out << "    }\n";
                }
            }
            out << "    return false;\n"
                << "}\n\n";
        }
    }

    out << "int32_t compact_turn_lookup_" << phase << "_loop_point_" << suffix << "(int32_t index) {\n"
        << "    switch (index) {\n";
    for (size_t index = 0; index < loopPoint.entries.size(); ++index) {
        if (loopPoint.entries[index].has_value()) {
            out << "        case " << index << ": return " << *loopPoint.entries[index] << ";\n";
        }
    }
    out << "        default: return -1;\n"
        << "    }\n"
        << "}\n\n";

    out << "bool compact_turn_apply_" << phase << "_rules_" << suffix << "(LevelDimensions dimensions, PersistentLevelState& levelState, Scratch& scratch, CompactTurnCommands_" << suffix << "& commands, std::vector<bool>* bannedGroups) {\n";
    if (groups.empty()) {
        out << "    (void)dimensions;\n"
            << "    (void)levelState;\n"
            << "    (void)scratch;\n"
            << "    (void)commands;\n"
            << "    (void)bannedGroups;\n"
            << "    return false;\n";
    } else {
        out << "    bool loopPropagated = false;\n"
            << "    bool changed = false;\n"
            << "    int32_t loopCount = 0;\n"
            << "    int32_t groupIndex = 0;\n"
            << "    constexpr int32_t groupCount = " << groups.size() << ";\n"
            << "    while (groupIndex < groupCount) {\n"
            << "#if defined(PS_GBA_PERF_TELEMETRY)\n"
            << "        ps_gba_perf_progress(" << (phase == "early" ? 2 : 4)
            << ", (static_cast<uint32_t>(groupIndex) << 16U) | 0xffffU);\n"
            << "#endif\n"
            << "        bool groupChanged = false;\n"
            << "        switch (groupIndex) {\n";
        for (size_t groupIndex = 0; groupIndex < groups.size(); ++groupIndex) {
            out << "            case " << groupIndex << ": {\n"
                << "#if defined(PS_GBA_PERF_TELEMETRY)\n"
                << "                const uint32_t perfGroupStart = ps_gba_perf_group_begin();\n"
                << "#endif\n"
                << "                groupChanged = " << compactGroupPrefix(suffix, phase, groupIndex)
                << "_apply(dimensions, levelState, scratch, commands, bannedGroups);\n"
                << "#if defined(PS_GBA_PERF_TELEMETRY)\n"
                << "                ps_gba_perf_group_end(" << (phase == "early" ? 2 : 4) << "U, "
                << groupIndex << "U, " << groups[groupIndex].front().lineNumber << "U, perfGroupStart);\n"
                << "#endif\n"
                << "                break;\n";
            out << "            }\n";
        }
        out << "            default:\n"
            << "                break;\n"
            << "        }\n"
            << "        loopPropagated = groupChanged || loopPropagated;\n"
            << "        changed = groupChanged || changed;\n"
            << "        if (loopPropagated) {\n"
            << "            const int32_t target = compact_turn_lookup_" << phase << "_loop_point_" << suffix << "(groupIndex);\n"
            << "            if (target >= 0) {\n"
            << "                groupIndex = target;\n"
            << "                loopPropagated = false;\n"
            << "                if (++loopCount > 200) break;\n"
            << "                continue;\n"
            << "            }\n"
            << "        }\n"
            << "        ++groupIndex;\n"
            << "        if (groupIndex == groupCount && loopPropagated) {\n"
            << "            const int32_t target = compact_turn_lookup_" << phase << "_loop_point_" << suffix << "(groupIndex);\n"
            << "            if (target >= 0) {\n"
            << "                groupIndex = target;\n"
            << "                loopPropagated = false;\n"
            << "                if (++loopCount > 200) break;\n"
            << "            }\n"
            << "        }\n"
            << "    }\n"
            << "    return changed;\n";
    }
    out << "}\n\n";
}

void emitCompactTurnUnsupportedBody(std::ostream& out) {
    out << "    (void)game;\n"
        << "    (void)levelState;\n"
        << "    (void)scratch;\n"
        << "    (void)context;\n"
        << "    (void)options;\n"
        << "    (void)input;\n"
        << "    return {false, {}};\n";
}

void emitCompactTurnCompilerSingleBody(
    std::ostream& out,
    std::string_view suffix,
    const CompactCodegenOptions& codegenOptions
) {
    out << "    if (outHasAgain != nullptr) {\n"
        << "        *outHasAgain = false;\n"
        << "    }\n"
        << "#if defined(PS_GBA_PERF_TELEMETRY)\n"
        << "    ps_gba_perf_set_probe(probeOnly);\n"
        << "    ps_gba_perf_progress(1, 0);\n"
        << "#endif\n"
        << "    const bool profileCompactTurn = !probeOnly && runtimeCountersEnabled();\n"
        << "    uint64_t profileMarkNs = profileCompactTurn ? runtimeCounterNowNs() : 0;\n"
        << "    auto addProfileNs = [&](RuntimeCounterId id) {\n"
        << "        if (!profileCompactTurn) {\n"
        << "            return;\n"
        << "        }\n"
        << "        const uint64_t nowNs = runtimeCounterNowNs();\n"
        << "        addRuntimeCounter(id, nowNs - profileMarkNs);\n"
        << "        profileMarkNs = nowNs;\n"
        << "    };\n"
        << "    CompactTurnRuntimeCounterScope_" << suffix << " runtimeCounterScope(profileCompactTurn);\n"
        << "    ps_step_result result{};\n"
        << "    if (!compact_turn_prepare_state_" << suffix << "(dimensions, levelState, scratch)) {\n"
        << "        addProfileNs(RuntimeCounterId::CompactTurnSetupNs);\n"
        << "        return {false, result};\n"
        << "    }\n"
        << "#if defined(PS_GBA_PERF_TELEMETRY)\n"
        << "    const uint32_t perfSetupProbeBit = probeOnly ? 0x80000000U : 0U;\n"
        << "    ps_gba_perf_progress(1, perfSetupProbeBit | 9U);\n"
        << "#endif\n"
        << "    const int32_t directionMask = compact_turn_input_direction_" << suffix << "(input);\n"
        << "    scratch.currentInputMask = inputSpecializationMaskForDirectionMask(directionMask);\n"
        << "    const bool needsTurnStartSnapshot = probeOnly\n"
        << "        || compact_turn_needs_unconditional_turn_start_snapshot_" << suffix << "\n"
        << "        || (!options.solverMode && compact_turn_needs_command_turn_start_snapshot_" << suffix << ");\n"
        << "    CompactTurnBoardSnapshot_" << suffix << " localTurnStartObjects;\n";
    if (codegenOptions.externalSnapshotStorage) {
        out << "    localTurnStartObjects.attach(\n"
            << "        probeOnly ? compact_turn_external_probe_snapshot_" << suffix << " : compact_turn_external_turn_snapshot_" << suffix << ",\n"
            << "        compact_turn_external_snapshot_capacity_" << suffix << ");\n"
            << "    CompactTurnBoardSnapshot_" << suffix << "* reusableTurnStartObjects = nullptr;\n";
    } else {
        out << "    CompactTurnBoardSnapshot_" << suffix << "* reusableTurnStartObjects = (!probeOnly && options.againPolicy == AgainPolicy::Drain) ? &scratch.turnStartObjectsScratch : nullptr;\n";
    }
    out << "    CompactTurnBoardSnapshot_" << suffix << "* turnStartObjects = nullptr;\n"
        << "    if (needsTurnStartSnapshot) {\n"
        << "        if (reusableTurnStartObjects != nullptr) {\n"
        << "            compact_turn_copy_board_objects_" << suffix << "(levelState, *reusableTurnStartObjects);\n"
        << "            turnStartObjects = reusableTurnStartObjects;\n"
        << "        } else {\n"
        << "            compact_turn_copy_board_objects_" << suffix << "(levelState, localTurnStartObjects);\n"
        << "            turnStartObjects = &localTurnStartObjects;\n"
        << "        }\n"
        << "    }\n"
        << "#if defined(PS_GBA_PERF_TELEMETRY)\n"
        << "    ps_gba_perf_progress(1, perfSetupProbeBit | 10U);\n"
        << "#endif\n"
        << "    std::vector<MaskWord> turnStartMovements;\n"
        << "    bool turnStartLiveMovementsClean = false;\n"
        << "    std::vector<MaskWord> turnStartRigidGroupIndexMasks;\n"
        << "    std::vector<MaskWord> turnStartRigidMovementAppliedMasks;\n"
        << "    if (probeOnly) {\n"
        << "        turnStartLiveMovementsClean = scratch.liveMovementsClean;\n"
        << "        if (!turnStartLiveMovementsClean) turnStartMovements = scratch.liveMovements;\n"
        << "        if (compact_turn_has_rigid_" << suffix << ") {\n"
        << "            turnStartRigidGroupIndexMasks = scratch.rigidGroupIndexMasks;\n"
        << "            turnStartRigidMovementAppliedMasks = scratch.rigidMovementAppliedMasks;\n"
        << "        }\n"
        << "    }\n"
        << "#if defined(PS_GBA_PERF_TELEMETRY)\n"
        << "    ps_gba_perf_progress(1, perfSetupProbeBit | 11U);\n"
        << "#endif\n"
        << "    std::vector<int32_t> startPlayerPositions;\n"
        << "    if (directionMask != 0 && compact_turn_requires_player_movement_" << suffix << ") {\n"
        << "        startPlayerPositions = compact_turn_collect_player_positions_" << suffix << "(dimensions, levelState);\n"
        << "    }\n"
        << "#if defined(PS_GBA_PERF_TELEMETRY)\n"
        << "    ps_gba_perf_progress(1, perfSetupProbeBit | 12U);\n"
        << "#endif\n"
        << "    addProfileNs(RuntimeCounterId::CompactTurnSetupNs);\n"
        << "    // Semantic compact turn compiler skeleton:\n"
        << "    // 1. validate level dimensions and persistent board storage\n"
        << "    // 2. decode input direction\n"
        << "    std::vector<bool> bannedGroups;\n"
        << "    CompactTurnCommands_" << suffix << " commands;\n"
        << "    bool seededInput = false;\n"
        << "    bool ruleChanged = false;\n"
        << "    bool moved = false;\n"
        << "    int32_t rigidLoopCount = 0;\n"
        << "    while (true) {\n"
        << "        commands = CompactTurnCommands_" << suffix << "{};\n"
        << "        if (rigidLoopCount > 0 && needsTurnStartSnapshot) {\n"
        << "            compact_turn_restore_board_objects_" << suffix << "(levelState, *turnStartObjects);\n"
        << "        }\n"
        << "        if (!scratch.liveMovementsClean) {\n"
        << "            std::fill(scratch.liveMovements.begin(), scratch.liveMovements.end(), 0);\n"
        << "            compact_turn_clear_movement_masks_" << suffix << "(scratch);\n"
        << "            scratch.liveMovementsClean = true;\n"
        << "        }\n"
        << "#if defined(PS_GBA_PERF_TELEMETRY)\n"
        << "        ps_gba_perf_progress(1, perfSetupProbeBit | 13U);\n"
        << "#endif\n"
        << "        if (compact_turn_has_rigid_" << suffix << ") {\n"
        << "            std::fill(scratch.rigidGroupIndexMasks.begin(), scratch.rigidGroupIndexMasks.end(), 0);\n"
        << "            std::fill(scratch.rigidMovementAppliedMasks.begin(), scratch.rigidMovementAppliedMasks.end(), 0);\n"
        << "        }\n"
        << "#if defined(PS_GBA_PERF_TELEMETRY)\n"
        << "        ps_gba_perf_progress(1, perfSetupProbeBit | 14U);\n"
        << "#endif\n"
        << "        seededInput = compact_turn_seed_player_movements_" << suffix << "(dimensions, levelState, scratch, directionMask);\n"
        << "#if defined(PS_GBA_PERF_TELEMETRY)\n"
        << "        ps_gba_perf_progress(1, perfSetupProbeBit | 15U);\n"
        << "#endif\n"
        << "        if (seededInput) (void)compact_turn_rebuild_movement_derived_state_" << suffix << "(dimensions, scratch);\n"
        << "#if defined(PS_GBA_PERF_TELEMETRY)\n"
        << "        ps_gba_perf_progress(2, (static_cast<uint32_t>(rigidLoopCount) << 16U) | 0xffffU);\n"
        << "#endif\n"
        << "        const bool ruleChangedThisPass = compact_turn_apply_early_rules_" << suffix << "(dimensions, levelState, scratch, commands, &bannedGroups);\n"
        << "        addProfileNs(RuntimeCounterId::CompactTurnEarlyRulesNs);\n"
        << "    // 4. apply early rulegroups\n"
        << "#if defined(PS_GBA_PERF_TELEMETRY)\n"
        << "        ps_gba_perf_progress(3, static_cast<uint32_t>(rigidLoopCount));\n"
        << "#endif\n"
        << "        const CompactTurnMovementOutcome_" << suffix << " movementOutcome = compact_turn_resolve_movements_" << suffix << "(dimensions, levelState, scratch, &bannedGroups);\n"
        << "        addProfileNs(RuntimeCounterId::CompactTurnMovementNs);\n"
        << "    // 5. resolve movement\n"
        << "        if (movementOutcome.shouldUndo && rigidLoopCount < 49) {\n"
        << "#if defined(PS_COMPACT_TURN_OUTPUT_HOOKS)\n"
        << "            compactTurnClearAudioKind(\"canmove\");\n"
        << "#endif\n"
        << "            ++rigidLoopCount;\n"
        << "            continue;\n"
        << "        }\n"
        << "        ruleChanged = ruleChangedThisPass;\n"
        << "        moved = movementOutcome.moved;\n"
        << "        if (moved) compact_turn_rebuild_rule_derived_state_" << suffix << "(dimensions, levelState, scratch, true, false);\n"
        << "        break;\n"
        << "    }\n"
        << "#if defined(PS_GBA_PERF_TELEMETRY)\n"
        << "    ps_gba_perf_progress(4, 0xffffU);\n"
        << "#endif\n"
        << "    const bool lateRuleChanged = compact_turn_apply_late_rules_" << suffix << "(dimensions, levelState, scratch, commands, nullptr);\n"
        << "    const bool modified = needsTurnStartSnapshot\n"
        << "        ? compact_turn_board_objects_differ_" << suffix << "(levelState, *turnStartObjects)\n"
        << "        : (ruleChanged || moved || lateRuleChanged);\n"
        << "    addProfileNs(RuntimeCounterId::CompactTurnLateRulesNs);\n"
        << "    // 6. apply late rulegroups\n"
        << "    // 7. process commands and again policy\n"
        << "    if (probeOnly) {\n"
        << "        result.changed = commands.hasCancel\n"
        << "            ? commands.commandCount > 1\n"
        << "            : (modified || commands.hasWin || commands.hasRestart);\n"
        << "        compact_turn_restore_board_objects_" << suffix << "(levelState, *turnStartObjects);\n"
        << "        if (turnStartLiveMovementsClean) {\n"
        << "            std::fill(scratch.liveMovements.begin(), scratch.liveMovements.end(), 0);\n"
        << "            compact_turn_clear_movement_masks_" << suffix << "(scratch);\n"
        << "        } else {\n"
        << "            scratch.liveMovements = turnStartMovements;\n"
        << "        }\n"
        << "        scratch.liveMovementsClean = turnStartLiveMovementsClean;\n"
        << "        if (compact_turn_has_rigid_" << suffix << ") {\n"
        << "            scratch.rigidGroupIndexMasks = turnStartRigidGroupIndexMasks;\n"
        << "            scratch.rigidMovementAppliedMasks = turnStartRigidMovementAppliedMasks;\n"
        << "        }\n"
        << "        (void)compact_turn_rebuild_object_derived_state_" << suffix << "(dimensions, levelState, scratch);\n"
        << "        (void)compact_turn_rebuild_movement_derived_state_" << suffix << "(dimensions, scratch);\n"
        << "        scratch.objectCellIndexDirty = true;\n"
        << "        scratch.movementCellIndexDirty = true;\n"
        << "        compact_turn_refresh_any_masks_dirty_" << suffix << "(scratch);\n"
        << "        addProfileNs(RuntimeCounterId::CompactTurnCanonicalizeNs);\n"
        << "        return {true, result};\n"
        << "    }\n"
        << "    if (!startPlayerPositions.empty() && !compact_turn_any_start_player_moved_" << suffix << "(levelState, startPlayerPositions)) {\n"
        << "        compact_turn_restore_board_objects_" << suffix << "(levelState, *turnStartObjects);\n"
        << "        std::fill(scratch.liveMovements.begin(), scratch.liveMovements.end(), 0);\n"
        << "        compact_turn_clear_movement_masks_" << suffix << "(scratch);\n"
        << "        scratch.liveMovementsClean = true;\n"
        << "#if defined(PS_COMPACT_TURN_OUTPUT_HOOKS)\n"
        << "        compactTurnDiscardGameplayAudio();\n"
        << "#endif\n"
        << "        addProfileNs(RuntimeCounterId::CompactTurnCanonicalizeNs);\n"
        << "        return {true, result, false, commands.hasCheckpoint};\n"
        << "    }\n"
        << "    if (options.solverMode && commands.hasCancel) {\n"
        << "        if (needsTurnStartSnapshot) {\n"
        << "            compact_turn_restore_board_objects_" << suffix << "(levelState, *turnStartObjects);\n"
        << "        }\n"
        << "        std::fill(scratch.liveMovements.begin(), scratch.liveMovements.end(), 0);\n"
        << "        compact_turn_clear_movement_masks_" << suffix << "(scratch);\n"
        << "        scratch.liveMovementsClean = true;\n"
        << "        if (compact_turn_has_rigid_" << suffix << ") {\n"
        << "            std::fill(scratch.rigidGroupIndexMasks.begin(), scratch.rigidGroupIndexMasks.end(), 0);\n"
        << "            std::fill(scratch.rigidMovementAppliedMasks.begin(), scratch.rigidMovementAppliedMasks.end(), 0);\n"
        << "        }\n"
        << "        scratch.objectCellIndexDirty = true;\n"
        << "        addProfileNs(RuntimeCounterId::CompactTurnCanonicalizeNs);\n"
        << "        return compact_turn_solver_discard_" << suffix << "(\"cancel\");\n"
        << "    }\n"
        << "    if (!options.ignoreRestartCommand && options.solverMode && commands.hasRestart) {\n"
        << "        if (needsTurnStartSnapshot) {\n"
        << "            compact_turn_restore_board_objects_" << suffix << "(levelState, *turnStartObjects);\n"
        << "        }\n"
        << "        std::fill(scratch.liveMovements.begin(), scratch.liveMovements.end(), 0);\n"
        << "        compact_turn_clear_movement_masks_" << suffix << "(scratch);\n"
        << "        scratch.liveMovementsClean = true;\n"
        << "        if (compact_turn_has_rigid_" << suffix << ") {\n"
        << "            std::fill(scratch.rigidGroupIndexMasks.begin(), scratch.rigidGroupIndexMasks.end(), 0);\n"
        << "            std::fill(scratch.rigidMovementAppliedMasks.begin(), scratch.rigidMovementAppliedMasks.end(), 0);\n"
        << "        }\n"
        << "        scratch.objectCellIndexDirty = true;\n"
        << "        addProfileNs(RuntimeCounterId::CompactTurnCanonicalizeNs);\n"
        << "        return compact_turn_solver_discard_" << suffix << "(\"restart\");\n"
        << "    }\n"
        << "    if (commands.hasCancel) {\n"
        << "        compact_turn_restore_board_objects_" << suffix << "(levelState, *turnStartObjects);\n"
        << "        (void)compact_turn_rebuild_object_derived_state_" << suffix << "(dimensions, levelState, scratch);\n"
        << "        scratch.objectCellIndexDirty = true;\n"
        << "        compact_turn_refresh_any_masks_dirty_" << suffix << "(scratch);\n"
        << "        std::fill(scratch.liveMovements.begin(), scratch.liveMovements.end(), 0);\n"
        << "        compact_turn_clear_movement_masks_" << suffix << "(scratch);\n"
        << "        scratch.liveMovementsClean = true;\n"
        << "        if (compact_turn_has_rigid_" << suffix << ") {\n"
        << "            std::fill(scratch.rigidGroupIndexMasks.begin(), scratch.rigidGroupIndexMasks.end(), 0);\n"
        << "            std::fill(scratch.rigidMovementAppliedMasks.begin(), scratch.rigidMovementAppliedMasks.end(), 0);\n"
        << "        }\n"
        << "        if (outHasAgain != nullptr) {\n"
        << "            *outHasAgain = false;\n"
        << "        }\n"
        << "#if defined(PS_COMPACT_TURN_OUTPUT_HOOKS)\n"
        << "        compactTurnDiscardGameplayAudio();\n"
        << "        compactTurnOutputSimpleSound(\"cancel\");\n"
        << "#endif\n"
        << "        result.changed = commands.any;\n"
        << "        addProfileNs(RuntimeCounterId::CompactTurnCanonicalizeNs);\n"
        << "        return {true, result, false, commands.hasCheckpoint};\n"
        << "    }\n"
        << "    if (!options.ignoreRestartCommand && commands.hasRestart) {\n"
        << "        compact_turn_restore_board_objects_" << suffix << "(levelState, *turnStartObjects);\n"
        << "        std::fill(scratch.liveMovements.begin(), scratch.liveMovements.end(), 0);\n"
        << "        compact_turn_clear_movement_masks_" << suffix << "(scratch);\n"
        << "        scratch.liveMovementsClean = true;\n"
        << "        if (compact_turn_has_rigid_" << suffix << ") {\n"
        << "            std::fill(scratch.rigidGroupIndexMasks.begin(), scratch.rigidGroupIndexMasks.end(), 0);\n"
        << "            std::fill(scratch.rigidMovementAppliedMasks.begin(), scratch.rigidMovementAppliedMasks.end(), 0);\n"
        << "        }\n"
        << "        if (outHasAgain != nullptr) {\n"
        << "            *outHasAgain = false;\n"
        << "        }\n"
        << "        result.changed = commands.any;\n"
        << "        result.restarted = true;\n"
        << "#if defined(PS_COMPACT_TURN_OUTPUT_HOOKS)\n"
        << "        compactTurnFlushMaskAudio();\n"
        << "#endif\n"
        << "        compact_turn_emit_outputs_" << suffix << "(commands, false);\n"
        << "#if defined(PS_COMPACT_TURN_OUTPUT_HOOKS)\n"
        << "        compactTurnOutputSimpleSound(\"restart\");\n"
        << "#endif\n"
        << "        addProfileNs(RuntimeCounterId::CompactTurnCanonicalizeNs);\n"
        << "        return {true, result, false, commands.hasCheckpoint};\n"
        << "    }\n"
        << "#if defined(PS_GBA_PERF_TELEMETRY)\n"
        << "    ps_gba_perf_progress(5, 0);\n"
        << "#endif\n"
        << "    const bool won = !options.ignoreWin && (commands.hasWin || compact_turn_evaluate_win_" << suffix << "(dimensions, levelState));\n"
        << "    const bool transitioned = won;\n"
        << "    addProfileNs(RuntimeCounterId::CompactTurnWinNs);\n"
        << "    // 8. evaluate win conditions\n"
        << "    // 9. canonicalize and return result\n"
        << "    result.changed = seededInput || ruleChanged || moved || lateRuleChanged || modified || transitioned || commands.any;\n"
        << "    result.transitioned = transitioned;\n"
        << "    result.won = won;\n"
        << "    if (outHasAgain != nullptr) {\n"
        << "        bool scheduleAgain = false;\n"
        << "        if (commands.hasAgain && modified && !won) {\n"
        << "            if (options.againPolicy != AgainPolicy::Yield) {\n"
        << "                scheduleAgain = true;\n"
        << "            } else {\n"
        << "                uint64_t againProbeStartNs = 0;\n"
        << "                if (profileCompactTurn) {\n"
        << "                    const uint64_t nowNs = runtimeCounterNowNs();\n"
        << "                    addRuntimeCounter(RuntimeCounterId::CompactTurnCanonicalizeNs, nowNs - profileMarkNs);\n"
        << "                    addRuntimeCounter(RuntimeCounterId::CompactTurnAgainProbeCalls);\n"
        << "                    againProbeStartNs = nowNs;\n"
        << "                }\n"
        << "#if defined(PS_COMPACT_TURN_OUTPUT_HOOKS)\n"
        << "                compactTurnPushAudioSuppression();\n"
        << "#endif\n"
        << "                const SpecializedCompactTurnOutcome probeOutcome = compact_turn_execute_program_" << suffix << "(\n"
        << "                    dimensions,\n"
        << "                    currentLevelIndex,\n"
        << "                    levelState,\n"
        << "                    scratch,\n"
        << "                    PS_INPUT_TICK,\n"
        << "                    options,\n"
        << "                    nullptr,\n"
        << "                    true\n"
        << "                );\n"
        << "#if defined(PS_COMPACT_TURN_OUTPUT_HOOKS)\n"
        << "                compactTurnPopAudioSuppression();\n"
        << "#endif\n"
        << "                if (profileCompactTurn) {\n"
        << "                    const uint64_t nowNs = runtimeCounterNowNs();\n"
        << "                    addRuntimeCounter(RuntimeCounterId::CompactTurnAgainProbeNs, nowNs - againProbeStartNs);\n"
        << "                    profileMarkNs = nowNs;\n"
        << "                }\n"
        << "                if (!probeOutcome.handled) {\n"
        << "                    return probeOutcome;\n"
        << "                }\n"
        << "                scheduleAgain = probeOutcome.result.changed || probeOutcome.result.transitioned || probeOutcome.result.won;\n"
        << "            }\n"
        << "        }\n"
        << "        *outHasAgain = scheduleAgain;\n"
        << "    }\n"
        << "#if defined(PS_COMPACT_TURN_OUTPUT_HOOKS)\n"
        << "    compactTurnFlushMaskAudio();\n"
        << "#endif\n"
        << "    compact_turn_emit_outputs_" << suffix << "(commands, true);\n"
        << "    addProfileNs(RuntimeCounterId::CompactTurnCanonicalizeNs);\n"
        << "#if defined(PS_GBA_PERF_TELEMETRY)\n"
        << "    ps_gba_perf_progress(6, 0);\n"
        << "#endif\n"
        << "    return {true, result, false, commands.hasCheckpoint};\n";
}

void emitCompactTurnCompilerDrainBody(std::ostream& out, std::string_view suffix) {
    out << "    bool hasAgain = false;\n"
        << "    SpecializedCompactTurnOutcome outcome = compact_turn_execute_program_" << suffix << "(\n"
        << "        dimensions,\n"
        << "        currentLevelIndex,\n"
        << "        levelState,\n"
        << "        scratch,\n"
        << "        input,\n"
        << "        options,\n"
        << "        &hasAgain,\n"
        << "        false\n"
        << "    );\n"
        << "    outcome.pendingAgain = hasAgain;\n"
        << "    if (!outcome.handled || options.againPolicy != AgainPolicy::Drain || outcome.discard) {\n"
        << "        return outcome;\n"
        << "    }\n"
        << "    constexpr int kMaxAgainIterations = 500;\n"
        << "    for (int iteration = 0; iteration < kMaxAgainIterations && hasAgain; ++iteration) {\n"
        << "        const bool terminal = outcome.result.won || outcome.result.restarted || outcome.result.transitioned;\n"
        << "        if (terminal || !outcome.result.changed) {\n"
        << "            break;\n"
        << "        }\n"
        << "        bool tickHasAgain = false;\n"
        << "        const SpecializedCompactTurnOutcome tickOutcome = compact_turn_execute_program_" << suffix << "(\n"
        << "            dimensions,\n"
        << "            currentLevelIndex,\n"
        << "            levelState,\n"
        << "            scratch,\n"
        << "            PS_INPUT_TICK,\n"
        << "            options,\n"
        << "            &tickHasAgain,\n"
        << "            false\n"
        << "        );\n"
        << "        if (!tickOutcome.handled) {\n"
        << "            return tickOutcome;\n"
        << "        }\n"
        << "        if (tickOutcome.discard) {\n"
        << "            hasAgain = false;\n"
        << "            outcome.pendingAgain = false;\n"
        << "            break;\n"
        << "        }\n"
        << "        outcome.result.changed = outcome.result.changed || tickOutcome.result.changed;\n"
        << "        outcome.result.won = outcome.result.won || tickOutcome.result.won;\n"
        << "        outcome.result.restarted = outcome.result.restarted || tickOutcome.result.restarted;\n"
        << "        outcome.result.transitioned = outcome.result.transitioned || tickOutcome.result.transitioned;\n"
        << "        outcome.hasCheckpoint = outcome.hasCheckpoint || tickOutcome.hasCheckpoint;\n"
        << "        hasAgain = tickHasAgain;\n"
        << "        outcome.pendingAgain = hasAgain;\n"
        << "        if (!tickOutcome.result.changed) {\n"
        << "            break;\n"
        << "        }\n"
        << "    }\n"
        << "    outcome.pendingAgain = false;\n"
        << "    return outcome;\n";
}

std::string sourceSuffix(size_t sourceIndex) {
    return std::to_string(sourceIndex);
}

void emitCompactTurnAccessLayer(
    std::ostream& out,
    const Game& game,
    size_t sourceIndex,
    const CompactCodegenOptions& options
) {
    const std::string suffix = sourceSuffix(sourceIndex);
    const CompactSourceMaskNeeds maskNeeds = compactSourceMaskNeeds(game);
    if (options.externalBoardStorage) {
        out << "MaskWord* compact_turn_external_board_objects_" << suffix << " = nullptr;\n"
            << "size_t compact_turn_external_board_object_count_" << suffix << " = 0;\n"
            << "void compact_turn_attach_external_board_" << suffix << "(MaskWord* objects, size_t count) {\n"
            << "    compact_turn_external_board_objects_" << suffix << " = objects;\n"
            << "    compact_turn_external_board_object_count_" << suffix << " = count;\n"
            << "}\n\n";
    }
    if (options.externalSnapshotStorage) {
        out << "MaskWord* compact_turn_external_turn_snapshot_" << suffix << " = nullptr;\n"
            << "MaskWord* compact_turn_external_probe_snapshot_" << suffix << " = nullptr;\n"
            << "size_t compact_turn_external_snapshot_capacity_" << suffix << " = 0;\n"
            << "void compact_turn_attach_external_snapshots_" << suffix << "(\n"
            << "    MaskWord* turnSnapshot, MaskWord* probeSnapshot, size_t capacity) {\n"
            << "    compact_turn_external_turn_snapshot_" << suffix << " = turnSnapshot;\n"
            << "    compact_turn_external_probe_snapshot_" << suffix << " = probeSnapshot;\n"
            << "    compact_turn_external_snapshot_capacity_" << suffix << " = capacity;\n"
            << "}\n\n"
            << "class CompactTurnBoardSnapshot_" << suffix << " {\n"
            << "public:\n"
            << "    void attach(MaskWord* storage, size_t capacity) {\n"
            << "        storage_ = storage; capacity_ = capacity; size_ = 0;\n"
            << "    }\n"
            << "    void clear() { size_ = 0; }\n"
            << "    void assign(const MaskWord* begin, const MaskWord* end) {\n"
            << "        const size_t count = static_cast<size_t>(end - begin);\n"
            << "        if (storage_ == nullptr || count > capacity_) { size_ = 0; return; }\n"
            << "        for (size_t index = 0; index < count; ++index) storage_[index] = begin[index];\n"
            << "        size_ = count;\n"
            << "    }\n"
            << "    size_t size() const { return size_; }\n"
            << "    const MaskWord& operator[](size_t index) const { return storage_[index]; }\n"
            << "private:\n"
            << "    MaskWord* storage_ = nullptr;\n"
            << "    size_t capacity_ = 0;\n"
            << "    size_t size_ = 0;\n"
            << "};\n\n";
    } else {
        out << "using CompactTurnBoardSnapshot_" << suffix << " = MaskVector;\n\n";
    }
    if (options.externalObjectCellIndexStorage) {
        out << "template <typename T> class CompactTurnExternalVector_" << suffix << " {\n"
            << "public:\n"
            << "    void attach(T* storage, size_t capacity) { storage_ = storage; capacity_ = capacity; if (size_ > capacity_) size_ = 0; }\n"
            << "    void assign(size_t count, T value) {\n"
            << "        if (storage_ == nullptr || count > capacity_) { size_ = 0; return; }\n"
            << "        for (size_t index = 0; index < count; ++index) storage_[index] = value;\n"
            << "        size_ = count;\n"
            << "    }\n"
            << "    size_t size() const { return size_; }\n"
            << "    T& operator[](size_t index) { return storage_[index]; }\n"
            << "    const T& operator[](size_t index) const { return storage_[index]; }\n"
            << "private:\n"
            << "    T* storage_ = nullptr;\n"
            << "    size_t capacity_ = 0;\n"
            << "    size_t size_ = 0;\n"
            << "};\n"
            << "CompactTurnExternalVector_" << suffix << "<MaskWordUnsigned> compact_turn_external_object_cell_bits_" << suffix << ";\n"
            << "CompactTurnExternalVector_" << suffix << "<uint32_t> compact_turn_external_object_cell_counts_" << suffix << ";\n"
            << "void compact_turn_attach_external_object_cell_index_" << suffix << "(uint32_t* storage, size_t capacity, size_t countCapacity) {\n"
            << "    if (storage == nullptr || capacity < countCapacity) {\n"
            << "        compact_turn_external_object_cell_bits_" << suffix << ".attach(nullptr, 0);\n"
            << "        compact_turn_external_object_cell_counts_" << suffix << ".attach(nullptr, 0);\n"
            << "        return;\n"
            << "    }\n"
            << "    const size_t bitCapacity = capacity - countCapacity;\n"
            << "    compact_turn_external_object_cell_bits_" << suffix << ".attach(reinterpret_cast<MaskWordUnsigned*>(storage), bitCapacity);\n"
            << "    compact_turn_external_object_cell_counts_" << suffix << ".attach(storage + bitCapacity, countCapacity);\n"
            << "}\n"
            << "auto& compact_turn_object_cell_bits_" << suffix << "(Scratch& scratch) { (void)scratch; return compact_turn_external_object_cell_bits_" << suffix << "; }\n"
            << "const auto& compact_turn_object_cell_bits_" << suffix << "(const Scratch& scratch) { (void)scratch; return compact_turn_external_object_cell_bits_" << suffix << "; }\n"
            << "auto& compact_turn_object_cell_counts_" << suffix << "(Scratch& scratch) { (void)scratch; return compact_turn_external_object_cell_counts_" << suffix << "; }\n"
            << "const auto& compact_turn_object_cell_counts_" << suffix << "(const Scratch& scratch) { (void)scratch; return compact_turn_external_object_cell_counts_" << suffix << "; }\n\n";
    } else {
        out << "auto& compact_turn_object_cell_bits_" << suffix << "(Scratch& scratch) { return scratch.objectCellBits; }\n"
            << "const auto& compact_turn_object_cell_bits_" << suffix << "(const Scratch& scratch) { return scratch.objectCellBits; }\n"
            << "auto& compact_turn_object_cell_counts_" << suffix << "(Scratch& scratch) { return scratch.objectCellCounts; }\n"
            << "const auto& compact_turn_object_cell_counts_" << suffix << "(const Scratch& scratch) { return scratch.objectCellCounts; }\n\n";
    }
    out << "MaskWord* compact_turn_board_objects_data_" << suffix << "(PersistentLevelState& levelState) {\n";
    if (options.externalBoardStorage) {
        out << "    (void)levelState;\n"
            << "    return compact_turn_external_board_objects_" << suffix << ";\n";
    } else {
        out << "    return levelState.board.objects.data();\n";
    }
    out << "}\n\n"
        << "const MaskWord* compact_turn_board_objects_data_" << suffix << "(const PersistentLevelState& levelState) {\n";
    if (options.externalBoardStorage) {
        out << "    (void)levelState;\n"
            << "    return compact_turn_external_board_objects_" << suffix << ";\n";
    } else {
        out << "    return levelState.board.objects.data();\n";
    }
    out << "}\n\n"
        << "size_t compact_turn_board_objects_size_" << suffix << "(const PersistentLevelState& levelState) {\n";
    if (options.externalBoardStorage) {
        out << "    (void)levelState;\n"
            << "    return compact_turn_external_board_object_count_" << suffix << ";\n";
    } else {
        out << "    return levelState.board.objects.size();\n";
    }
    out << "}\n\n"
        << "void compact_turn_copy_board_objects_" << suffix << "(const PersistentLevelState& levelState, CompactTurnBoardSnapshot_" << suffix << "& destination) {\n"
        << "    const size_t count = compact_turn_board_objects_size_" << suffix << "(levelState);\n"
        << "    if (count == 0) { destination.clear(); return; }\n"
        << "    const MaskWord* source = compact_turn_board_objects_data_" << suffix << "(levelState);\n"
        << "    destination.assign(source, source + count);\n"
        << "}\n\n"
        << "void compact_turn_restore_board_objects_" << suffix << "(PersistentLevelState& levelState, const CompactTurnBoardSnapshot_" << suffix << "& source) {\n"
        << "    const size_t count = compact_turn_board_objects_size_" << suffix << "(levelState);\n"
        << "    if (source.size() != count) return;\n"
        << "    MaskWord* destination = compact_turn_board_objects_data_" << suffix << "(levelState);\n"
        << "    for (size_t index = 0; index < count; ++index) destination[index] = source[index];\n"
        << "}\n\n"
        << "bool compact_turn_board_objects_differ_" << suffix << "(const PersistentLevelState& levelState, const CompactTurnBoardSnapshot_" << suffix << "& other) {\n"
        << "    const size_t count = compact_turn_board_objects_size_" << suffix << "(levelState);\n"
        << "    if (other.size() != count) return true;\n"
        << "    const MaskWord* objects = compact_turn_board_objects_data_" << suffix << "(levelState);\n"
        << "    for (size_t index = 0; index < count; ++index) if (objects[index] != other[index]) return true;\n"
        << "    return false;\n"
        << "}\n\n";
    out << "constexpr int32_t compact_turn_object_stride_" << suffix << " = " << game.strideObject << ";\n"
        << "constexpr int32_t compact_turn_movement_stride_" << suffix << " = " << game.strideMovement << ";\n"
        << "constexpr bool compact_turn_enable_object_cell_index_" << suffix << " = "
        << (options.enableObjectCellIndex ? "true" : "false") << ";\n"
        << "constexpr bool compact_turn_enable_movement_cell_index_" << suffix << " = "
        << (options.enableMovementCellIndex ? "true" : "false") << ";\n"
        << "constexpr int32_t compact_turn_object_count_" << suffix << " = " << game.objectCount << ";\n"
        << "constexpr int32_t compact_turn_layer_count_" << suffix << " = " << game.layerCount << ";\n"
        << "constexpr bool compact_turn_needs_object_board_mask_" << suffix << " = " << (maskNeeds.objectBoard ? "true" : "false") << ";\n"
        << "constexpr bool compact_turn_needs_object_row_masks_" << suffix << " = " << (maskNeeds.objectRows ? "true" : "false") << ";\n"
        << "constexpr bool compact_turn_needs_object_column_masks_" << suffix << " = " << (maskNeeds.objectColumns ? "true" : "false") << ";\n"
        << "constexpr bool compact_turn_needs_object_row_all_masks_" << suffix << " = " << (maskNeeds.objectRowAll ? "true" : "false") << ";\n"
        << "constexpr bool compact_turn_needs_object_column_all_masks_" << suffix << " = " << (maskNeeds.objectColumnAll ? "true" : "false") << ";\n"
        << "constexpr bool compact_turn_needs_movement_board_mask_" << suffix << " = " << (maskNeeds.movementBoard ? "true" : "false") << ";\n"
        << "constexpr bool compact_turn_needs_movement_row_masks_" << suffix << " = " << (maskNeeds.movementRows ? "true" : "false") << ";\n"
        << "constexpr bool compact_turn_needs_movement_column_masks_" << suffix << " = " << (maskNeeds.movementColumns ? "true" : "false") << ";\n"
        << "constexpr bool compact_turn_needs_movement_row_all_masks_" << suffix << " = " << (maskNeeds.movementRowAll ? "true" : "false") << ";\n"
        << "constexpr bool compact_turn_needs_movement_column_all_masks_" << suffix << " = " << (maskNeeds.movementColumnAll ? "true" : "false") << ";\n"
        << "constexpr bool compact_turn_has_rigid_" << suffix << " = " << (game.rigid ? "true" : "false") << ";\n"
        << "constexpr bool compact_turn_has_player_mask_" << suffix << " = " << (game.playerMask != kNullMaskOffset ? "true" : "false") << ";\n"
        << "constexpr bool compact_turn_player_mask_aggregate_" << suffix << " = " << (game.playerMaskAggregate ? "true" : "false") << ";\n"
        << "constexpr bool compact_turn_requires_player_movement_" << suffix << " = "
        << (game.metadata.values.find("require_player_movement") != game.metadata.values.end() ? "true" : "false") << ";\n"
        << "constexpr bool compact_turn_has_again_command_" << suffix << " = " << (hasRuleCommand(game, "again") ? "true" : "false") << ";\n"
        << "constexpr bool compact_turn_has_cancel_command_" << suffix << " = " << (hasRuleCommand(game, "cancel") ? "true" : "false") << ";\n"
        << "constexpr bool compact_turn_has_restart_command_" << suffix << " = " << (hasRuleCommand(game, "restart") ? "true" : "false") << ";\n"
        << "constexpr bool compact_turn_needs_unconditional_turn_start_snapshot_" << suffix << " = compact_turn_has_rigid_" << suffix
        << " || compact_turn_requires_player_movement_" << suffix
        << " || compact_turn_has_again_command_" << suffix << ";\n"
        << "constexpr bool compact_turn_needs_command_turn_start_snapshot_" << suffix << " = compact_turn_has_cancel_command_" << suffix
        << " || compact_turn_has_restart_command_" << suffix << ";\n"
        << "constexpr int32_t compact_turn_win_condition_count_" << suffix << " = " << game.winConditions.size() << ";\n\n";

    out << "struct CompactTurnRuntimeCounters_" << suffix << " {\n"
        << "    uint64_t rulesVisited = 0;\n"
        << "    uint64_t rulesSkippedByMask = 0;\n"
        << "    uint64_t candidateCellsTested = 0;\n"
        << "    uint64_t replacementsAttempted = 0;\n"
        << "    uint64_t replacementsApplied = 0;\n"
        << "    uint64_t rowScans = 0;\n"
        << "    uint64_t ellipsisScans = 0;\n"
        << "    uint64_t ruleMaskPrecheckPasses = 0;\n"
        << "    uint64_t ruleMaskPrecheckFailures = 0;\n"
        << "    uint64_t ruleApplyCalls = 0;\n"
        << "    uint64_t ruleApplyNoMatch = 0;\n"
        << "    uint64_t ruleApplyChanged = 0;\n"
        << "    uint64_t rebuildRuleDerivedStateCalls = 0;\n"
        << "    uint64_t rebuildRuleDerivedStateObjectsDirty = 0;\n"
        << "    uint64_t rebuildRuleDerivedStateMovementsDirty = 0;\n"
        << "    uint64_t simpleReplacementFastPathCalls = 0;\n"
        << "    uint64_t simpleReplacementFastPathNoops = 0;\n"
        << "    uint64_t simpleReplacementFastPathChanges = 0;\n"
        << "    void flush() const {\n"
        << "        addRuntimeCounter(RuntimeCounterId::RulesVisited, rulesVisited);\n"
        << "        addRuntimeCounter(RuntimeCounterId::RulesSkippedByMask, rulesSkippedByMask);\n"
        << "        addRuntimeCounter(RuntimeCounterId::CandidateCellsTested, candidateCellsTested);\n"
        << "        addRuntimeCounter(RuntimeCounterId::ReplacementsAttempted, replacementsAttempted);\n"
        << "        addRuntimeCounter(RuntimeCounterId::ReplacementsApplied, replacementsApplied);\n"
        << "        addRuntimeCounter(RuntimeCounterId::RowScans, rowScans);\n"
        << "        addRuntimeCounter(RuntimeCounterId::EllipsisScans, ellipsisScans);\n"
        << "        addRuntimeCounter(RuntimeCounterId::CompactTurnRuleMaskPrecheckPasses, ruleMaskPrecheckPasses);\n"
        << "        addRuntimeCounter(RuntimeCounterId::CompactTurnRuleMaskPrecheckFailures, ruleMaskPrecheckFailures);\n"
        << "        addRuntimeCounter(RuntimeCounterId::CompactTurnRuleApplyCalls, ruleApplyCalls);\n"
        << "        addRuntimeCounter(RuntimeCounterId::CompactTurnRuleApplyNoMatch, ruleApplyNoMatch);\n"
        << "        addRuntimeCounter(RuntimeCounterId::CompactTurnRuleApplyChanged, ruleApplyChanged);\n"
        << "        addRuntimeCounter(RuntimeCounterId::CompactTurnRebuildRuleDerivedStateCalls, rebuildRuleDerivedStateCalls);\n"
        << "        addRuntimeCounter(RuntimeCounterId::CompactTurnRebuildRuleDerivedStateObjectsDirty, rebuildRuleDerivedStateObjectsDirty);\n"
        << "        addRuntimeCounter(RuntimeCounterId::CompactTurnRebuildRuleDerivedStateMovementsDirty, rebuildRuleDerivedStateMovementsDirty);\n"
        << "        addRuntimeCounter(RuntimeCounterId::CompactTurnSimpleReplacementFastPathCalls, simpleReplacementFastPathCalls);\n"
        << "        addRuntimeCounter(RuntimeCounterId::CompactTurnSimpleReplacementFastPathNoops, simpleReplacementFastPathNoops);\n"
        << "        addRuntimeCounter(RuntimeCounterId::CompactTurnSimpleReplacementFastPathChanges, simpleReplacementFastPathChanges);\n"
        << "    }\n"
        << "};\n"
        << "thread_local CompactTurnRuntimeCounters_" << suffix << "* compact_turn_runtime_counters_" << suffix << " = nullptr;\n"
        << "struct CompactTurnRuntimeCounterScope_" << suffix << " {\n"
        << "    CompactTurnRuntimeCounters_" << suffix << " counters;\n"
        << "    CompactTurnRuntimeCounters_" << suffix << "* previous = nullptr;\n"
        << "    bool active = false;\n"
        << "    explicit CompactTurnRuntimeCounterScope_" << suffix << "(bool enabled)\n"
        << "        : previous(compact_turn_runtime_counters_" << suffix << "), active(enabled) {\n"
        << "        compact_turn_runtime_counters_" << suffix << " = active ? &counters : nullptr;\n"
        << "    }\n"
        << "    ~CompactTurnRuntimeCounterScope_" << suffix << "() {\n"
        << "        compact_turn_runtime_counters_" << suffix << " = previous;\n"
        << "        if (active) counters.flush();\n"
        << "    }\n"
        << "};\n"
        << "inline void compact_turn_count_rules_visited_" << suffix << "(uint64_t amount = 1) { if (compact_turn_runtime_counters_" << suffix << " != nullptr) compact_turn_runtime_counters_" << suffix << "->rulesVisited += amount; }\n"
        << "inline void compact_turn_count_rules_skipped_by_mask_" << suffix << "(uint64_t amount = 1) { if (compact_turn_runtime_counters_" << suffix << " != nullptr) compact_turn_runtime_counters_" << suffix << "->rulesSkippedByMask += amount; }\n"
        << "inline void compact_turn_count_candidate_cells_tested_" << suffix << "(uint64_t amount = 1) { if (compact_turn_runtime_counters_" << suffix << " != nullptr) compact_turn_runtime_counters_" << suffix << "->candidateCellsTested += amount; }\n"
        << "inline void compact_turn_count_replacements_attempted_" << suffix << "(uint64_t amount = 1) { if (compact_turn_runtime_counters_" << suffix << " != nullptr) compact_turn_runtime_counters_" << suffix << "->replacementsAttempted += amount; }\n"
        << "inline void compact_turn_count_replacements_applied_" << suffix << "(uint64_t amount = 1) { if (compact_turn_runtime_counters_" << suffix << " != nullptr) compact_turn_runtime_counters_" << suffix << "->replacementsApplied += amount; }\n"
        << "inline void compact_turn_count_row_scans_" << suffix << "(uint64_t amount = 1) { if (compact_turn_runtime_counters_" << suffix << " != nullptr) compact_turn_runtime_counters_" << suffix << "->rowScans += amount; }\n"
        << "inline void compact_turn_count_ellipsis_scans_" << suffix << "(uint64_t amount = 1) { if (compact_turn_runtime_counters_" << suffix << " != nullptr) compact_turn_runtime_counters_" << suffix << "->ellipsisScans += amount; }\n"
        << "inline void compact_turn_count_rule_mask_precheck_pass_" << suffix << "(uint64_t amount = 1) { if (compact_turn_runtime_counters_" << suffix << " != nullptr) compact_turn_runtime_counters_" << suffix << "->ruleMaskPrecheckPasses += amount; }\n"
        << "inline void compact_turn_count_rule_mask_precheck_failure_" << suffix << "(uint64_t amount = 1) { if (compact_turn_runtime_counters_" << suffix << " != nullptr) compact_turn_runtime_counters_" << suffix << "->ruleMaskPrecheckFailures += amount; }\n"
        << "inline void compact_turn_count_rule_apply_call_" << suffix << "(uint64_t amount = 1) { if (compact_turn_runtime_counters_" << suffix << " != nullptr) compact_turn_runtime_counters_" << suffix << "->ruleApplyCalls += amount; }\n"
        << "inline void compact_turn_count_rule_apply_no_match_" << suffix << "(uint64_t amount = 1) { if (compact_turn_runtime_counters_" << suffix << " != nullptr) compact_turn_runtime_counters_" << suffix << "->ruleApplyNoMatch += amount; }\n"
        << "inline void compact_turn_count_rule_apply_changed_" << suffix << "(uint64_t amount = 1) { if (compact_turn_runtime_counters_" << suffix << " != nullptr) compact_turn_runtime_counters_" << suffix << "->ruleApplyChanged += amount; }\n"
        << "inline bool compact_turn_count_rule_apply_result_" << suffix << "(bool changed) { if (changed) compact_turn_count_rule_apply_changed_" << suffix << "(); else compact_turn_count_rule_apply_no_match_" << suffix << "(); return changed; }\n"
        << "inline void compact_turn_count_rebuild_rule_derived_state_call_" << suffix << "(uint64_t amount = 1) { if (compact_turn_runtime_counters_" << suffix << " != nullptr) compact_turn_runtime_counters_" << suffix << "->rebuildRuleDerivedStateCalls += amount; }\n"
        << "inline void compact_turn_count_rebuild_rule_derived_state_objects_dirty_" << suffix << "(uint64_t amount = 1) { if (compact_turn_runtime_counters_" << suffix << " != nullptr) compact_turn_runtime_counters_" << suffix << "->rebuildRuleDerivedStateObjectsDirty += amount; }\n"
        << "inline void compact_turn_count_rebuild_rule_derived_state_movements_dirty_" << suffix << "(uint64_t amount = 1) { if (compact_turn_runtime_counters_" << suffix << " != nullptr) compact_turn_runtime_counters_" << suffix << "->rebuildRuleDerivedStateMovementsDirty += amount; }\n"
        << "inline void compact_turn_count_simple_replacement_fast_path_call_" << suffix << "(uint64_t amount = 1) { if (compact_turn_runtime_counters_" << suffix << " != nullptr) compact_turn_runtime_counters_" << suffix << "->simpleReplacementFastPathCalls += amount; }\n"
        << "inline void compact_turn_count_simple_replacement_fast_path_noop_" << suffix << "(uint64_t amount = 1) { if (compact_turn_runtime_counters_" << suffix << " != nullptr) compact_turn_runtime_counters_" << suffix << "->simpleReplacementFastPathNoops += amount; }\n"
        << "inline void compact_turn_count_simple_replacement_fast_path_change_" << suffix << "(uint64_t amount = 1) { if (compact_turn_runtime_counters_" << suffix << " != nullptr) compact_turn_runtime_counters_" << suffix << "->simpleReplacementFastPathChanges += amount; }\n\n"
        << "#ifndef PS_COMPACT_TURN_NOINLINE\n"
        << "#if defined(__GNUC__) || defined(__clang__)\n"
        << "#define PS_COMPACT_TURN_NOINLINE __attribute__((noinline))\n"
        << "#elif defined(_MSC_VER)\n"
        << "#define PS_COMPACT_TURN_NOINLINE __declspec(noinline)\n"
        << "#else\n"
        << "#define PS_COMPACT_TURN_NOINLINE\n"
        << "#endif\n"
        << "#endif\n\n";

    const std::vector<MaskWord> playerMask = compiledMaskWords(game, game.playerMask, game.wordCount);
    emitMaskArray(out, "compact_turn_player_mask_" + suffix, playerMask);

    out << "constexpr int32_t compact_turn_rigid_group_index_to_group_index_" << suffix << "[] = {";
    if (game.rigidGroupIndexToGroupIndex.empty()) {
        // Standard C++ forbids zero-length arrays (MSVC diagnoses the previous
        // `[] = {}` spelling). Keep the logical count at zero and emit an
        // unreachable sentinel so generated kernels remain cross-toolchain.
        out << "0";
    }
    for (size_t index = 0; index < game.rigidGroupIndexToGroupIndex.size(); ++index) {
        if (index > 0) out << ", ";
        out << game.rigidGroupIndexToGroupIndex[index];
    }
    out << "};\n";
    out << "constexpr int32_t compact_turn_rigid_group_index_to_group_index_count_" << suffix << " = "
        << game.rigidGroupIndexToGroupIndex.size() << ";\n";
    out << "constexpr int32_t compact_turn_object_layer_" << suffix << "[] = {";
    const int32_t emittedObjectLayerCount = std::max(game.objectCount, int32_t{1});
    for (int32_t objectId = 0; objectId < emittedObjectLayerCount; ++objectId) {
        if (objectId > 0) out << ", ";
        const int32_t layer = static_cast<size_t>(objectId) < game.objectsById.size()
            ? game.objectsById[static_cast<size_t>(objectId)].layer
            : -1;
        out << layer;
    }
    out << "};\n\n";

    for (int32_t layer = 0; layer < game.layerCount; ++layer) {
        const MaskOffset offset = static_cast<size_t>(layer) < game.layerMaskOffsets.size()
            ? game.layerMaskOffsets[static_cast<size_t>(layer)]
            : kNullMaskOffset;
        const std::vector<MaskWord> layerMask = compiledMaskWords(game, offset, game.wordCount);
        emitMaskArray(out, "compact_turn_layer_mask_" + suffix + "_" + std::to_string(layer), layerMask);
    }
    if (game.layerCount > 0) {
        out << "\n";
    }

    for (size_t conditionIndex = 0; conditionIndex < game.winConditions.size(); ++conditionIndex) {
        const WinCondition& condition = game.winConditions[conditionIndex];
        const std::vector<MaskWord> filter1 = compiledMaskWords(game, condition.filter1, game.wordCount);
        const std::vector<MaskWord> filter2 = compiledMaskWords(game, condition.filter2, game.wordCount);
        emitMaskArray(out, "compact_turn_win_filter1_" + suffix + "_" + std::to_string(conditionIndex), filter1);
        emitMaskArray(out, "compact_turn_win_filter2_" + suffix + "_" + std::to_string(conditionIndex), filter2);
    }
    if (!game.winConditions.empty()) {
        out << "\n";
    }
    out << "struct CompactTurnLayerCoupledMovementTerm_" << suffix << " {\n"
        << "    int32_t layerIndex = -1;\n"
        << "    const MaskWord* objectMask = nullptr;\n"
        << "    const MaskWord* movementsAny = nullptr;\n"
        << "    const MaskWord* movementsPresent = nullptr;\n"
        << "    const MaskWord* movementsMissing = nullptr;\n"
        << "    int32_t replacementMovementMask = 0;\n"
        << "    int32_t aggregateCaptureIndex = -1;\n"
        << "};\n\n";

    out << "struct CompactTurnInferredAggregateTerm_" << suffix << " {\n"
        << "    int32_t layerIndex = -1;\n"
        << "    int32_t aggregateCaptureIndex = -1;\n"
        << "};\n\n";

    CompactMaskConstantEmitter earlyMasks(suffix, "early");
    CompactMaskConstantEmitter lateMasks(suffix, "late");
    std::ostringstream ruleAuxiliaryData;
    emitCompactRuleMaskData(ruleAuxiliaryData, game, suffix, "early", game.rules, earlyMasks);
    emitCompactRuleMaskData(ruleAuxiliaryData, game, suffix, "late", game.lateRules, lateMasks);
    earlyMasks.emitDefinitions(out);
    lateMasks.emitDefinitions(out);
    out << ruleAuxiliaryData.str();
    if (hasAnyRulegroups(game.rules) || hasAnyRulegroups(game.lateRules)) {
        out << "\n";
    }

    out << "struct CompactTurnCommands_" << suffix << " {\n"
        << "    bool any = false;\n"
        << "    int32_t commandCount = 0;\n"
        << "    bool hasAgain = false;\n"
        << "    bool hasCancel = false;\n"
        << "    bool hasCheckpoint = false;\n"
        << "    bool hasRestart = false;\n"
        << "    bool hasWin = false;\n"
        << "    bool hasMessage = false;\n"
        << "    bool messageHasText = false;\n"
        << "    const char* messageText = nullptr;\n"
        << "    uint8_t soundCount = 0;\n"
        << "    const char* soundNames[16]{};\n"
        << "};\n\n";

    out << "void compact_turn_emit_outputs_" << suffix << "(const CompactTurnCommands_" << suffix
        << "& commands, bool allowMessage) {\n"
        << "#if defined(PS_COMPACT_TURN_OUTPUT_HOOKS)\n"
        << "    if (allowMessage && commands.hasMessage) {\n"
        << "        compactTurnOutputMessage(commands.messageHasText ? commands.messageText : nullptr);\n"
        << "    }\n"
        << "    for (uint8_t index = 0; index < commands.soundCount; ++index) {\n"
        << "        compactTurnOutputSound(commands.soundNames[index]);\n"
        << "    }\n"
        << "#else\n"
        << "    (void)commands;\n"
        << "    (void)allowMessage;\n"
        << "#endif\n"
        << "}\n\n";

    out << "SpecializedCompactTurnOutcome compact_turn_solver_discard_" << suffix << "(const char* reason) {\n"
        << "    SpecializedCompactTurnOutcome outcome;\n"
        << "    outcome.handled = true;\n"
        << "    outcome.discard = true;\n"
        << "    outcome.discardReason = reason;\n"
        << "    outcome.result.changed = false;\n"
        << "    outcome.pendingAgain = false;\n"
        << "    return outcome;\n"
        << "}\n\n";

    out << "struct CompactTurnMovementOutcome_" << suffix << " {\n"
        << "    bool moved = false;\n"
        << "    bool shouldUndo = false;\n"
        << "};\n\n";

    out << "uint8_t compact_turn_next_random_byte_" << suffix << "(RandomState& state) {\n"
        << "    state.i = static_cast<uint8_t>((state.i + 1) % 256);\n"
        << "    state.j = static_cast<uint8_t>((state.j + state.s[static_cast<size_t>(state.i)]) % 256);\n"
        << "    std::swap(state.s[static_cast<size_t>(state.i)], state.s[static_cast<size_t>(state.j)]);\n"
        << "    const uint8_t index = static_cast<uint8_t>((state.s[static_cast<size_t>(state.i)] + state.s[static_cast<size_t>(state.j)]) % 256);\n"
        << "    return state.s[static_cast<size_t>(index)];\n"
        << "}\n\n";

    out << "double compact_turn_random_uniform_" << suffix << "(RandomState& state) {\n"
        << "    double output = 0.0;\n"
        << "    for (int32_t index = 0; index < 7; ++index) {\n"
        << "        output *= 256.0;\n"
        << "        output += compact_turn_next_random_byte_" << suffix << "(state);\n"
        << "    }\n"
        << "    return output / 72057594037927935.0;\n"
        << "}\n\n";

    out << "int32_t compact_turn_tile_count_" << suffix << "(LevelDimensions dimensions) {\n"
        << "    if (dimensions.width <= 0 || dimensions.height <= 0) return 0;\n"
        << "    return dimensions.width * dimensions.height;\n"
        << "}\n\n";

    out << "int32_t compact_turn_object_cell_word_count_" << suffix << "(LevelDimensions dimensions) {\n"
        << "    const int32_t tileCount = compact_turn_tile_count_" << suffix << "(dimensions);\n"
        << "    if (tileCount <= 0) return 0;\n"
        << "    return (tileCount + static_cast<int32_t>(kMaskWordBits) - 1) / static_cast<int32_t>(kMaskWordBits);\n"
        << "}\n\n";

    out << "int32_t compact_turn_movement_cell_word_count_" << suffix << "(LevelDimensions dimensions) {\n"
        << "    const int32_t tileCount = compact_turn_tile_count_" << suffix << "(dimensions);\n"
        << "    if (tileCount <= 0) return 0;\n"
        << "    return (tileCount + static_cast<int32_t>(kMaskWordBits) - 1) / static_cast<int32_t>(kMaskWordBits);\n"
        << "}\n\n";

    out << "bool compact_turn_in_bounds_" << suffix << "(LevelDimensions dimensions, int32_t x, int32_t y) {\n"
        << "    return x >= 0 && y >= 0 && x < dimensions.width && y < dimensions.height;\n"
        << "}\n\n";

    out << "int32_t compact_turn_tile_index_" << suffix << "(LevelDimensions dimensions, int32_t x, int32_t y) {\n"
        << "    return x * dimensions.height + y;\n"
        << "}\n\n";

    out << "bool compact_turn_start_index_less_" << suffix << "(LevelDimensions dimensions, bool horizontalScan, int32_t lhs, int32_t rhs) {\n"
        << "    if (!horizontalScan) return lhs < rhs;\n"
        << "    const int32_t lhsX = lhs / dimensions.height;\n"
        << "    const int32_t lhsY = lhs % dimensions.height;\n"
        << "    const int32_t rhsX = rhs / dimensions.height;\n"
        << "    const int32_t rhsY = rhs % dimensions.height;\n"
        << "    return lhsY == rhsY ? lhsX < rhsX : lhsY < rhsY;\n"
        << "}\n\n";

    out << "void compact_turn_sort_unique_start_matches_" << suffix << "(LevelDimensions dimensions, bool horizontalScan, std::vector<int32_t>& matches) {\n"
        << "    if (matches.size() <= 1) return;\n"
        << "    std::sort(matches.begin(), matches.end(), [dimensions, horizontalScan](int32_t lhs, int32_t rhs) {\n"
        << "        return compact_turn_start_index_less_" << suffix << "(dimensions, horizontalScan, lhs, rhs);\n"
        << "    });\n"
        << "    matches.erase(std::unique(matches.begin(), matches.end()), matches.end());\n"
        << "}\n\n";

    out << "bool compact_turn_direction_delta_" << suffix << "(int32_t directionMask, int32_t& dx, int32_t& dy) {\n"
        << "    switch (directionMask) {\n"
        << "        case 1: dx = 0; dy = -1; return true;\n"
        << "        case 2: dx = 0; dy = 1; return true;\n"
        << "        case 4: dx = -1; dy = 0; return true;\n"
        << "        case 8: dx = 1; dy = 0; return true;\n"
        << "        case 16: dx = 0; dy = 0; return true;\n"
        << "        default: dx = 0; dy = 0; return false;\n"
        << "    }\n"
        << "}\n\n";

    out << "int32_t compact_turn_input_direction_" << suffix << "(ps_input input) {\n"
        << "    switch (input) {\n"
        << "        case PS_INPUT_UP: return 1;\n"
        << "        case PS_INPUT_DOWN: return 2;\n"
        << "        case PS_INPUT_LEFT: return 4;\n"
        << "        case PS_INPUT_RIGHT: return 8;\n"
        << "        case PS_INPUT_ACTION: return 16;\n"
        << "        default: return 0;\n"
        << "    }\n"
        << "}\n\n";

    out << "bool compact_turn_step_cell_" << suffix << "(LevelDimensions dimensions, int32_t& x, int32_t& y, int32_t directionMask) {\n"
        << "    int32_t dx = 0;\n"
        << "    int32_t dy = 0;\n"
        << "    if (!compact_turn_direction_delta_" << suffix << "(directionMask, dx, dy)) return false;\n"
        << "    const int32_t nextX = x + dx;\n"
        << "    const int32_t nextY = y + dy;\n"
        << "    if (!compact_turn_in_bounds_" << suffix << "(dimensions, nextX, nextY)) return false;\n"
        << "    x = nextX;\n"
        << "    y = nextY;\n"
        << "    return true;\n"
        << "}\n\n";

    out << "bool compact_turn_cell_at_direction_" << suffix << "(LevelDimensions dimensions, int32_t originTileIndex, int32_t directionMask, int32_t distance, int32_t& outTileIndex) {\n"
        << "    if (dimensions.width <= 0 || dimensions.height <= 0 || distance < 0 || originTileIndex < 0) return false;\n"
        << "    int32_t x = originTileIndex / dimensions.height;\n"
        << "    int32_t y = originTileIndex % dimensions.height;\n"
        << "    if (!compact_turn_in_bounds_" << suffix << "(dimensions, x, y)) return false;\n"
        << "    for (int32_t step = 0; step < distance; ++step) {\n"
        << "        if (!compact_turn_step_cell_" << suffix << "(dimensions, x, y, directionMask)) return false;\n"
        << "    }\n"
        << "    outTileIndex = compact_turn_tile_index_" << suffix << "(dimensions, x, y);\n"
        << "    return true;\n"
        << "}\n\n";

    out << "int32_t compact_turn_available_at_direction_" << suffix << "(LevelDimensions dimensions, int32_t originTileIndex, int32_t directionMask) {\n"
        << "    if (dimensions.width <= 0 || dimensions.height <= 0 || originTileIndex < 0) return 0;\n"
        << "    const int32_t x = originTileIndex / dimensions.height;\n"
        << "    const int32_t y = originTileIndex % dimensions.height;\n"
        << "    if (!compact_turn_in_bounds_" << suffix << "(dimensions, x, y)) return 0;\n"
        << "    switch (directionMask) {\n"
        << "        case 1: return y + 1;\n"
        << "        case 2: return dimensions.height - y;\n"
        << "        case 4: return x + 1;\n"
        << "        case 8: return dimensions.width - x;\n"
        << "        default: return 0;\n"
        << "    }\n"
        << "}\n\n";

    out << "bool compact_turn_rebuild_object_derived_state_" << suffix << "(LevelDimensions dimensions, const PersistentLevelState& levelState, Scratch& scratch) {\n"
        << "    const int32_t tileCount = compact_turn_tile_count_" << suffix << "(dimensions);\n"
        << "    if (tileCount <= 0) return false;\n"
        << "    const size_t objectWords = static_cast<size_t>(tileCount) * static_cast<size_t>(compact_turn_object_stride_" << suffix << ");\n"
        << "    if (compact_turn_board_objects_size_" << suffix << "(levelState) != objectWords) return false;\n"
        << "    const size_t rowObjectWords = static_cast<size_t>(dimensions.height) * static_cast<size_t>(compact_turn_object_stride_" << suffix << ");\n"
        << "    const size_t columnObjectWords = static_cast<size_t>(dimensions.width) * static_cast<size_t>(compact_turn_object_stride_" << suffix << ");\n"
        << "    const size_t objectCount = static_cast<size_t>(std::max(compact_turn_object_count_" << suffix << ", int32_t{0}));\n"
        << "    if constexpr (compact_turn_needs_object_row_masks_" << suffix << ") scratch.rowMasks.assign(rowObjectWords, 0); else scratch.rowMasks.clear();\n"
        << "    if constexpr (compact_turn_needs_object_column_masks_" << suffix << ") scratch.columnMasks.assign(columnObjectWords, 0); else scratch.columnMasks.clear();\n"
        << "    if constexpr (compact_turn_needs_object_row_all_masks_" << suffix << ") scratch.rowAllMasks.assign(rowObjectWords, static_cast<MaskWord>(~MaskWordUnsigned{0})); else scratch.rowAllMasks.clear();\n"
        << "    if constexpr (compact_turn_needs_object_column_all_masks_" << suffix << ") scratch.columnAllMasks.assign(columnObjectWords, static_cast<MaskWord>(~MaskWordUnsigned{0})); else scratch.columnAllMasks.clear();\n"
        << "    if constexpr (compact_turn_needs_object_board_mask_" << suffix << ") scratch.boardMask.assign(static_cast<size_t>(compact_turn_object_stride_" << suffix << "), 0); else scratch.boardMask.clear();\n"
        << "    scratch.objectRowCounts.assign(static_cast<size_t>(dimensions.height) * objectCount, 0);\n"
        << "    scratch.objectColumnCounts.assign(static_cast<size_t>(dimensions.width) * objectCount, 0);\n"
        << "    scratch.objectBoardCounts.assign(objectCount, 0);\n"
        << "    scratch.dirtyObjectRows.assign(static_cast<size_t>(dimensions.height), compact_turn_needs_object_row_masks_" << suffix << " ? 0 : 1);\n"
        << "    scratch.dirtyObjectColumns.assign(static_cast<size_t>(dimensions.width), compact_turn_needs_object_column_masks_" << suffix << " ? 0 : 1);\n"
        << "    scratch.dirtyObjectBoard = !compact_turn_needs_object_board_mask_" << suffix << ";\n"
        << "    for (int32_t tileIndex = 0; tileIndex < tileCount; ++tileIndex) {\n"
        << "        const int32_t x = tileIndex / dimensions.height;\n"
        << "        const int32_t y = tileIndex % dimensions.height;\n"
        << "        const MaskWord* objects = compact_turn_board_objects_data_" << suffix << "(levelState) + static_cast<size_t>(tileIndex) * static_cast<size_t>(compact_turn_object_stride_" << suffix << ");\n"
        << "        for (int32_t word = 0; word < compact_turn_object_stride_" << suffix << "; ++word) {\n"
        << "            const MaskWord value = objects[word];\n"
        << "            if constexpr (compact_turn_needs_object_row_masks_" << suffix << ") scratch.rowMasks[static_cast<size_t>(y * compact_turn_object_stride_" << suffix << " + word)] |= value;\n"
        << "            if constexpr (compact_turn_needs_object_column_masks_" << suffix << ") scratch.columnMasks[static_cast<size_t>(x * compact_turn_object_stride_" << suffix << " + word)] |= value;\n"
        << "            if constexpr (compact_turn_needs_object_row_all_masks_" << suffix << ") scratch.rowAllMasks[static_cast<size_t>(y * compact_turn_object_stride_" << suffix << " + word)] &= value;\n"
        << "            if constexpr (compact_turn_needs_object_column_all_masks_" << suffix << ") scratch.columnAllMasks[static_cast<size_t>(x * compact_turn_object_stride_" << suffix << " + word)] &= value;\n"
        << "            if constexpr (compact_turn_needs_object_board_mask_" << suffix << ") scratch.boardMask[static_cast<size_t>(word)] |= value;\n"
        << "            MaskWordUnsigned objectBits = static_cast<MaskWordUnsigned>(value);\n"
        << "            while (objectBits != 0) {\n"
        << "                const int32_t bit = maskWordCountTrailingZeros(objectBits);\n"
        << "                objectBits &= objectBits - 1;\n"
        << "                const int32_t objectId = word * static_cast<int32_t>(kMaskWordBits) + bit;\n"
        << "                if (objectId < 0 || objectId >= compact_turn_object_count_" << suffix << ") continue;\n"
        << "                const size_t objectIndex = static_cast<size_t>(objectId);\n"
        << "                ++scratch.objectRowCounts[static_cast<size_t>(y) * objectCount + objectIndex];\n"
        << "                ++scratch.objectColumnCounts[static_cast<size_t>(x) * objectCount + objectIndex];\n"
        << "                ++scratch.objectBoardCounts[objectIndex];\n"
        << "            }\n"
        << "        }\n"
        << "    }\n"
        << "    return true;\n"
        << "}\n\n";

    out << "bool compact_turn_rebuild_object_cell_index_" << suffix << "(LevelDimensions dimensions, const PersistentLevelState& levelState, Scratch& scratch) {\n"
        << "    const int32_t tileCount = compact_turn_tile_count_" << suffix << "(dimensions);\n"
        << "    if (tileCount <= 0) return false;\n"
        << "    const size_t objectWords = static_cast<size_t>(tileCount) * static_cast<size_t>(compact_turn_object_stride_" << suffix << ");\n"
        << "    if (compact_turn_board_objects_size_" << suffix << "(levelState) != objectWords) return false;\n"
        << "    const int32_t objectCellWordCount = compact_turn_object_cell_word_count_" << suffix << "(dimensions);\n"
        << "    scratch.objectCellBitTileCount = tileCount;\n"
        << "    compact_turn_object_cell_bits_" << suffix << "(scratch).assign(static_cast<size_t>(std::max(compact_turn_object_count_" << suffix << ", int32_t{0})) * static_cast<size_t>(objectCellWordCount), 0);\n"
        << "    compact_turn_object_cell_counts_" << suffix << "(scratch).assign(static_cast<size_t>(std::max(compact_turn_object_count_" << suffix << ", int32_t{0})), 0);\n"
        << "    for (int32_t tileIndex = 0; tileIndex < tileCount; ++tileIndex) {\n"
        << "        const int32_t cellWord = tileIndex >> static_cast<int32_t>(kMaskWordShift);\n"
        << "        const MaskWordUnsigned cellBit = static_cast<MaskWordUnsigned>(maskBit(static_cast<uint32_t>(tileIndex)));\n"
        << "        const MaskWord* objects = compact_turn_board_objects_data_" << suffix << "(levelState) + static_cast<size_t>(tileIndex) * static_cast<size_t>(compact_turn_object_stride_" << suffix << ");\n"
        << "        for (int32_t word = 0; word < compact_turn_object_stride_" << suffix << "; ++word) {\n"
        << "            const MaskWord value = objects[word];\n"
        << "            MaskWordUnsigned objectBits = static_cast<MaskWordUnsigned>(value);\n"
        << "            while (objectBits != 0) {\n"
        << "                const int32_t bit = maskWordCountTrailingZeros(objectBits);\n"
        << "                objectBits &= objectBits - 1;\n"
        << "                const int32_t objectId = word * static_cast<int32_t>(kMaskWordBits) + bit;\n"
        << "                if (objectId < 0 || objectId >= compact_turn_object_count_" << suffix << ") continue;\n"
        << "                const size_t objectCellIndex = static_cast<size_t>(objectId) * static_cast<size_t>(objectCellWordCount) + static_cast<size_t>(cellWord);\n"
        << "                if (objectCellIndex < compact_turn_object_cell_bits_" << suffix << "(scratch).size()) compact_turn_object_cell_bits_" << suffix << "(scratch)[objectCellIndex] |= cellBit;\n"
        << "                if (static_cast<size_t>(objectId) < compact_turn_object_cell_counts_" << suffix << "(scratch).size()) ++compact_turn_object_cell_counts_" << suffix << "(scratch)[static_cast<size_t>(objectId)];\n"
        << "            }\n"
        << "        }\n"
        << "    }\n"
        << "    scratch.objectCellIndexDirty = false;\n"
        << "    return true;\n"
        << "}\n\n";

    out << "bool compact_turn_rebuild_movement_cell_index_" << suffix << "(LevelDimensions dimensions, Scratch& scratch) {\n"
        << "    const int32_t tileCount = compact_turn_tile_count_" << suffix << "(dimensions);\n"
        << "    if (tileCount <= 0) return false;\n"
        << "    const size_t movementWords = static_cast<size_t>(tileCount) * static_cast<size_t>(compact_turn_movement_stride_" << suffix << ");\n"
        << "    if (scratch.liveMovements.size() != movementWords) return false;\n"
        << "    const int32_t movementCellWordCount = compact_turn_movement_cell_word_count_" << suffix << "(dimensions);\n"
        << "    const int32_t movementBitCount = compact_turn_movement_stride_" << suffix << " * static_cast<int32_t>(kMaskWordBits);\n"
        << "    scratch.movementCellBitTileCount = tileCount;\n"
        << "    scratch.movementCellBits.assign(static_cast<size_t>(std::max(movementBitCount, int32_t{0})) * static_cast<size_t>(movementCellWordCount), 0);\n"
        << "    scratch.movementCellCounts.assign(static_cast<size_t>(std::max(movementBitCount, int32_t{0})), 0);\n"
        << "    if (movementCellWordCount <= 0 || movementBitCount <= 0) {\n"
        << "        scratch.movementCellIndexDirty = false;\n"
        << "        return true;\n"
        << "    }\n"
        << "    for (int32_t tileIndex = 0; tileIndex < tileCount; ++tileIndex) {\n"
        << "        const int32_t cellWord = tileIndex >> static_cast<int32_t>(kMaskWordShift);\n"
        << "        const MaskWordUnsigned cellBit = static_cast<MaskWordUnsigned>(maskBit(static_cast<uint32_t>(tileIndex)));\n"
        << "        const MaskWord* movements = scratch.liveMovements.data() + static_cast<size_t>(tileIndex) * static_cast<size_t>(compact_turn_movement_stride_" << suffix << ");\n"
        << "        for (int32_t word = 0; word < compact_turn_movement_stride_" << suffix << "; ++word) {\n"
        << "            MaskWordUnsigned movementBits = static_cast<MaskWordUnsigned>(movements[word]);\n"
        << "            while (movementBits != 0) {\n"
        << "                const int32_t bit = maskWordCountTrailingZeros(movementBits);\n"
        << "                movementBits &= movementBits - 1;\n"
        << "                const int32_t movementBit = word * static_cast<int32_t>(kMaskWordBits) + bit;\n"
        << "                if (movementBit < 0 || movementBit >= movementBitCount) continue;\n"
        << "                const size_t movementCellIndex = static_cast<size_t>(movementBit) * static_cast<size_t>(movementCellWordCount) + static_cast<size_t>(cellWord);\n"
        << "                if (movementCellIndex < scratch.movementCellBits.size()) scratch.movementCellBits[movementCellIndex] |= cellBit;\n"
        << "                if (static_cast<size_t>(movementBit) < scratch.movementCellCounts.size()) ++scratch.movementCellCounts[static_cast<size_t>(movementBit)];\n"
        << "            }\n"
        << "        }\n"
        << "    }\n"
        << "    scratch.movementCellIndexDirty = false;\n"
        << "    return true;\n"
        << "}\n\n";

    out << "bool compact_turn_prepare_movement_cell_index_" << suffix << "(LevelDimensions dimensions, Scratch& scratch) {\n"
        << "    if constexpr (!compact_turn_enable_movement_cell_index_" << suffix << ") { (void)dimensions; (void)scratch; return false; }\n"
        << "    const int32_t tileCount = compact_turn_tile_count_" << suffix << "(dimensions);\n"
        << "    const int32_t movementCellWordCount = compact_turn_movement_cell_word_count_" << suffix << "(dimensions);\n"
        << "    const int32_t movementBitCount = compact_turn_movement_stride_" << suffix << " * static_cast<int32_t>(kMaskWordBits);\n"
        << "    const size_t expectedWords = static_cast<size_t>(std::max(movementBitCount, int32_t{0})) * static_cast<size_t>(movementCellWordCount);\n"
        << "    if (!scratch.movementCellIndexDirty\n"
        << "        && scratch.movementCellBitTileCount == tileCount\n"
        << "        && scratch.movementCellBits.size() == expectedWords\n"
        << "        && scratch.movementCellCounts.size() == static_cast<size_t>(std::max(movementBitCount, int32_t{0}))) {\n"
        << "        return true;\n"
        << "    }\n"
        << "    return compact_turn_rebuild_movement_cell_index_" << suffix << "(dimensions, scratch);\n"
        << "}\n\n";

    out << "void compact_turn_update_movement_cell_index_" << suffix << "(LevelDimensions dimensions, Scratch& scratch, int32_t tileIndex, const MaskWord* beforeMovements, const MaskWord* afterMovements) {\n"
        << "    const int32_t tileCount = compact_turn_tile_count_" << suffix << "(dimensions);\n"
        << "    const int32_t movementCellWordCount = compact_turn_movement_cell_word_count_" << suffix << "(dimensions);\n"
        << "    const int32_t movementBitCount = compact_turn_movement_stride_" << suffix << " * static_cast<int32_t>(kMaskWordBits);\n"
        << "    const size_t expectedWords = static_cast<size_t>(std::max(movementBitCount, int32_t{0})) * static_cast<size_t>(movementCellWordCount);\n"
        << "    if (tileIndex < 0 || tileIndex >= tileCount || beforeMovements == nullptr || afterMovements == nullptr\n"
        << "        || scratch.movementCellIndexDirty\n"
        << "        || scratch.movementCellBitTileCount != tileCount\n"
        << "        || scratch.movementCellBits.size() != expectedWords\n"
        << "        || scratch.movementCellCounts.size() != static_cast<size_t>(std::max(movementBitCount, int32_t{0}))\n"
        << "        || movementCellWordCount <= 0 || movementBitCount <= 0) {\n"
        << "        scratch.movementCellIndexDirty = true;\n"
        << "        return;\n"
        << "    }\n"
        << "    const int32_t cellWord = tileIndex >> static_cast<int32_t>(kMaskWordShift);\n"
        << "    const MaskWordUnsigned cellBit = static_cast<MaskWordUnsigned>(maskBit(static_cast<uint32_t>(tileIndex)));\n"
        << "    for (int32_t word = 0; word < compact_turn_movement_stride_" << suffix << "; ++word) {\n"
        << "        MaskWordUnsigned removedBits = static_cast<MaskWordUnsigned>(beforeMovements[word] & ~afterMovements[word]);\n"
        << "        while (removedBits != 0) {\n"
        << "            const int32_t bit = maskWordCountTrailingZeros(removedBits);\n"
        << "            removedBits &= removedBits - 1;\n"
        << "            const int32_t movementBit = word * static_cast<int32_t>(kMaskWordBits) + bit;\n"
        << "            if (movementBit < 0 || movementBit >= movementBitCount) continue;\n"
        << "            const size_t movementCellIndex = static_cast<size_t>(movementBit) * static_cast<size_t>(movementCellWordCount) + static_cast<size_t>(cellWord);\n"
        << "            if (movementCellIndex >= scratch.movementCellBits.size() || static_cast<size_t>(movementBit) >= scratch.movementCellCounts.size()) {\n"
        << "                scratch.movementCellIndexDirty = true;\n"
        << "                return;\n"
        << "            }\n"
        << "            scratch.movementCellBits[movementCellIndex] &= ~cellBit;\n"
        << "            if (scratch.movementCellCounts[static_cast<size_t>(movementBit)] > 0) --scratch.movementCellCounts[static_cast<size_t>(movementBit)];\n"
        << "            else {\n"
        << "                scratch.movementCellIndexDirty = true;\n"
        << "                return;\n"
        << "            }\n"
        << "        }\n"
        << "        MaskWordUnsigned addedBits = static_cast<MaskWordUnsigned>(afterMovements[word] & ~beforeMovements[word]);\n"
        << "        while (addedBits != 0) {\n"
        << "            const int32_t bit = maskWordCountTrailingZeros(addedBits);\n"
        << "            addedBits &= addedBits - 1;\n"
        << "            const int32_t movementBit = word * static_cast<int32_t>(kMaskWordBits) + bit;\n"
        << "            if (movementBit < 0 || movementBit >= movementBitCount) continue;\n"
        << "            const size_t movementCellIndex = static_cast<size_t>(movementBit) * static_cast<size_t>(movementCellWordCount) + static_cast<size_t>(cellWord);\n"
        << "            if (movementCellIndex >= scratch.movementCellBits.size() || static_cast<size_t>(movementBit) >= scratch.movementCellCounts.size()) {\n"
        << "                scratch.movementCellIndexDirty = true;\n"
        << "                return;\n"
        << "            }\n"
        << "            scratch.movementCellBits[movementCellIndex] |= cellBit;\n"
        << "            ++scratch.movementCellCounts[static_cast<size_t>(movementBit)];\n"
        << "        }\n"
        << "    }\n"
        << "}\n\n";

    out << "bool compact_turn_rebuild_movement_derived_state_" << suffix << "(LevelDimensions dimensions, Scratch& scratch) {\n"
        << "    const int32_t tileCount = compact_turn_tile_count_" << suffix << "(dimensions);\n"
        << "    if (tileCount <= 0) return false;\n"
        << "    const size_t movementWords = static_cast<size_t>(tileCount) * static_cast<size_t>(compact_turn_movement_stride_" << suffix << ");\n"
        << "    if (scratch.liveMovements.size() != movementWords) return false;\n"
        << "    const size_t rowMovementWords = static_cast<size_t>(dimensions.height) * static_cast<size_t>(compact_turn_movement_stride_" << suffix << ");\n"
        << "    const size_t columnMovementWords = static_cast<size_t>(dimensions.width) * static_cast<size_t>(compact_turn_movement_stride_" << suffix << ");\n"
        << "    if constexpr (compact_turn_needs_movement_row_masks_" << suffix << ") scratch.rowMovementMasks.assign(rowMovementWords, 0); else scratch.rowMovementMasks.clear();\n"
        << "    if constexpr (compact_turn_needs_movement_column_masks_" << suffix << ") scratch.columnMovementMasks.assign(columnMovementWords, 0); else scratch.columnMovementMasks.clear();\n"
        << "    if constexpr (compact_turn_needs_movement_row_all_masks_" << suffix << ") scratch.rowAllMovementMasks.assign(rowMovementWords, static_cast<MaskWord>(~MaskWordUnsigned{0})); else scratch.rowAllMovementMasks.clear();\n"
        << "    if constexpr (compact_turn_needs_movement_column_all_masks_" << suffix << ") scratch.columnAllMovementMasks.assign(columnMovementWords, static_cast<MaskWord>(~MaskWordUnsigned{0})); else scratch.columnAllMovementMasks.clear();\n"
        << "    if constexpr (compact_turn_needs_movement_board_mask_" << suffix << ") scratch.boardMovementMask.assign(static_cast<size_t>(compact_turn_movement_stride_" << suffix << "), 0); else scratch.boardMovementMask.clear();\n"
        << "    scratch.dirtyMovementRows.assign(static_cast<size_t>(dimensions.height), compact_turn_needs_movement_row_masks_" << suffix << " ? 0 : 1);\n"
        << "    scratch.dirtyMovementColumns.assign(static_cast<size_t>(dimensions.width), compact_turn_needs_movement_column_masks_" << suffix << " ? 0 : 1);\n"
        << "    scratch.dirtyMovementBoard = !compact_turn_needs_movement_board_mask_" << suffix << ";\n"
        << "    for (int32_t tileIndex = 0; tileIndex < tileCount; ++tileIndex) {\n"
        << "        const int32_t x = tileIndex / dimensions.height;\n"
        << "        const int32_t y = tileIndex % dimensions.height;\n"
        << "        const MaskWord* movements = scratch.liveMovements.data() + static_cast<size_t>(tileIndex) * static_cast<size_t>(compact_turn_movement_stride_" << suffix << ");\n"
        << "        for (int32_t word = 0; word < compact_turn_movement_stride_" << suffix << "; ++word) {\n"
        << "            const MaskWord value = movements[word];\n"
        << "            if constexpr (compact_turn_needs_movement_row_masks_" << suffix << ") scratch.rowMovementMasks[static_cast<size_t>(y * compact_turn_movement_stride_" << suffix << " + word)] |= value;\n"
        << "            if constexpr (compact_turn_needs_movement_column_masks_" << suffix << ") scratch.columnMovementMasks[static_cast<size_t>(x * compact_turn_movement_stride_" << suffix << " + word)] |= value;\n"
        << "            if constexpr (compact_turn_needs_movement_row_all_masks_" << suffix << ") scratch.rowAllMovementMasks[static_cast<size_t>(y * compact_turn_movement_stride_" << suffix << " + word)] &= value;\n"
        << "            if constexpr (compact_turn_needs_movement_column_all_masks_" << suffix << ") scratch.columnAllMovementMasks[static_cast<size_t>(x * compact_turn_movement_stride_" << suffix << " + word)] &= value;\n"
        << "            if constexpr (compact_turn_needs_movement_board_mask_" << suffix << ") scratch.boardMovementMask[static_cast<size_t>(word)] |= value;\n"
        << "        }\n"
        << "    }\n"
        << "    return true;\n"
        << "}\n\n";

    out << "void compact_turn_refresh_any_masks_dirty_" << suffix << "(Scratch& scratch) {\n"
        << "    const bool objectDirty = scratch.dirtyObjectBoard\n"
        << "        || std::any_of(scratch.dirtyObjectRows.begin(), scratch.dirtyObjectRows.end(), [](uint8_t value) { return value != 0; })\n"
        << "        || std::any_of(scratch.dirtyObjectColumns.begin(), scratch.dirtyObjectColumns.end(), [](uint8_t value) { return value != 0; });\n"
        << "    const bool movementDirty = scratch.dirtyMovementBoard\n"
        << "        || std::any_of(scratch.dirtyMovementRows.begin(), scratch.dirtyMovementRows.end(), [](uint8_t value) { return value != 0; })\n"
        << "        || std::any_of(scratch.dirtyMovementColumns.begin(), scratch.dirtyMovementColumns.end(), [](uint8_t value) { return value != 0; });\n"
        << "    scratch.anyMasksDirty = objectDirty || movementDirty;\n"
        << "}\n\n";

    out << "bool compact_turn_rebuild_dirty_object_derived_state_" << suffix << "(LevelDimensions dimensions, const PersistentLevelState& levelState, Scratch& scratch) {\n"
        << "    const int32_t tileCount = compact_turn_tile_count_" << suffix << "(dimensions);\n"
        << "    if (tileCount <= 0) return false;\n"
        << "    const size_t objectWords = static_cast<size_t>(tileCount) * static_cast<size_t>(compact_turn_object_stride_" << suffix << ");\n"
        << "    if (compact_turn_board_objects_size_" << suffix << "(levelState) != objectWords) return false;\n"
        << "    const size_t rowObjectWords = static_cast<size_t>(dimensions.height) * static_cast<size_t>(compact_turn_object_stride_" << suffix << ");\n"
        << "    const size_t columnObjectWords = static_cast<size_t>(dimensions.width) * static_cast<size_t>(compact_turn_object_stride_" << suffix << ");\n"
        << "    const size_t objectCount = static_cast<size_t>(std::max(compact_turn_object_count_" << suffix << ", int32_t{0}));\n"
        << "    const size_t rowObjectCountWords = static_cast<size_t>(dimensions.height) * objectCount;\n"
        << "    const size_t columnObjectCountWords = static_cast<size_t>(dimensions.width) * objectCount;\n"
        << "    const bool storageReady = (!compact_turn_needs_object_row_masks_" << suffix << " || scratch.rowMasks.size() == rowObjectWords)\n"
        << "        && (!compact_turn_needs_object_column_masks_" << suffix << " || scratch.columnMasks.size() == columnObjectWords)\n"
        << "        && (!compact_turn_needs_object_row_all_masks_" << suffix << " || scratch.rowAllMasks.size() == rowObjectWords)\n"
        << "        && (!compact_turn_needs_object_column_all_masks_" << suffix << " || scratch.columnAllMasks.size() == columnObjectWords)\n"
        << "        && (!compact_turn_needs_object_board_mask_" << suffix << " || scratch.boardMask.size() == static_cast<size_t>(compact_turn_object_stride_" << suffix << "))\n"
        << "        && scratch.objectRowCounts.size() == rowObjectCountWords\n"
        << "        && scratch.objectColumnCounts.size() == columnObjectCountWords\n"
        << "        && scratch.objectBoardCounts.size() == objectCount\n"
        << "        && scratch.dirtyObjectRows.size() == static_cast<size_t>(dimensions.height)\n"
        << "        && scratch.dirtyObjectColumns.size() == static_cast<size_t>(dimensions.width);\n"
        << "    if (!storageReady) {\n"
        << "        const bool rebuilt = compact_turn_rebuild_object_derived_state_" << suffix << "(dimensions, levelState, scratch);\n"
        << "        compact_turn_refresh_any_masks_dirty_" << suffix << "(scratch);\n"
        << "        return rebuilt;\n"
        << "    }\n"
        << "    if constexpr (compact_turn_needs_object_row_masks_" << suffix << " || compact_turn_needs_object_row_all_masks_" << suffix << ") {\n"
        << "        for (int32_t y = 0; y < dimensions.height; ++y) {\n"
        << "            if (!scratch.dirtyObjectRows[static_cast<size_t>(y)]) continue;\n"
        << "            MaskWord* rowStart = compact_turn_needs_object_row_masks_" << suffix << " ? scratch.rowMasks.data() + static_cast<size_t>(y * compact_turn_object_stride_" << suffix << ") : nullptr;\n"
        << "            if (rowStart != nullptr) std::fill(rowStart, rowStart + compact_turn_object_stride_" << suffix << ", 0);\n"
        << "            MaskWord* rowAllStart = compact_turn_needs_object_row_all_masks_" << suffix << " ? scratch.rowAllMasks.data() + static_cast<size_t>(y * compact_turn_object_stride_" << suffix << ") : nullptr;\n"
        << "            if (rowAllStart != nullptr) std::fill(rowAllStart, rowAllStart + compact_turn_object_stride_" << suffix << ", static_cast<MaskWord>(~MaskWordUnsigned{0}));\n"
        << "            for (int32_t x = 0; x < dimensions.width; ++x) {\n"
        << "                const int32_t tileIndex = compact_turn_tile_index_" << suffix << "(dimensions, x, y);\n"
        << "                const MaskWord* objects = compact_turn_board_objects_data_" << suffix << "(levelState) + static_cast<size_t>(tileIndex) * static_cast<size_t>(compact_turn_object_stride_" << suffix << ");\n"
        << "                for (int32_t word = 0; word < compact_turn_object_stride_" << suffix << "; ++word) {\n"
        << "                    if (rowStart != nullptr) rowStart[word] |= objects[word];\n"
        << "                    if (rowAllStart != nullptr) rowAllStart[word] &= objects[word];\n"
        << "                }\n"
        << "            }\n"
        << "            scratch.dirtyObjectRows[static_cast<size_t>(y)] = 0;\n"
        << "        }\n"
        << "    } else {\n"
        << "        std::fill(scratch.dirtyObjectRows.begin(), scratch.dirtyObjectRows.end(), 0);\n"
        << "    }\n"
        << "    if constexpr (compact_turn_needs_object_column_masks_" << suffix << " || compact_turn_needs_object_column_all_masks_" << suffix << ") {\n"
        << "        for (int32_t x = 0; x < dimensions.width; ++x) {\n"
        << "            if (!scratch.dirtyObjectColumns[static_cast<size_t>(x)]) continue;\n"
        << "            MaskWord* columnStart = compact_turn_needs_object_column_masks_" << suffix << " ? scratch.columnMasks.data() + static_cast<size_t>(x * compact_turn_object_stride_" << suffix << ") : nullptr;\n"
        << "            if (columnStart != nullptr) std::fill(columnStart, columnStart + compact_turn_object_stride_" << suffix << ", 0);\n"
        << "            MaskWord* columnAllStart = compact_turn_needs_object_column_all_masks_" << suffix << " ? scratch.columnAllMasks.data() + static_cast<size_t>(x * compact_turn_object_stride_" << suffix << ") : nullptr;\n"
        << "            if (columnAllStart != nullptr) std::fill(columnAllStart, columnAllStart + compact_turn_object_stride_" << suffix << ", static_cast<MaskWord>(~MaskWordUnsigned{0}));\n"
        << "            for (int32_t y = 0; y < dimensions.height; ++y) {\n"
        << "                const int32_t tileIndex = compact_turn_tile_index_" << suffix << "(dimensions, x, y);\n"
        << "                const MaskWord* objects = compact_turn_board_objects_data_" << suffix << "(levelState) + static_cast<size_t>(tileIndex) * static_cast<size_t>(compact_turn_object_stride_" << suffix << ");\n"
        << "                for (int32_t word = 0; word < compact_turn_object_stride_" << suffix << "; ++word) {\n"
        << "                    if (columnStart != nullptr) columnStart[word] |= objects[word];\n"
        << "                    if (columnAllStart != nullptr) columnAllStart[word] &= objects[word];\n"
        << "                }\n"
        << "            }\n"
        << "            scratch.dirtyObjectColumns[static_cast<size_t>(x)] = 0;\n"
        << "        }\n"
        << "    } else {\n"
        << "        std::fill(scratch.dirtyObjectColumns.begin(), scratch.dirtyObjectColumns.end(), 0);\n"
        << "    }\n"
        << "    if constexpr (compact_turn_needs_object_board_mask_" << suffix << ") {\n"
        << "        if (scratch.dirtyObjectBoard) {\n"
        << "            std::fill(scratch.boardMask.begin(), scratch.boardMask.end(), 0);\n"
        << "            if constexpr (compact_turn_needs_object_row_masks_" << suffix << ") {\n"
        << "                for (int32_t y = 0; y < dimensions.height; ++y) {\n"
        << "                    const MaskWord* rowStart = scratch.rowMasks.data() + static_cast<size_t>(y * compact_turn_object_stride_" << suffix << ");\n"
        << "                    for (int32_t word = 0; word < compact_turn_object_stride_" << suffix << "; ++word) scratch.boardMask[static_cast<size_t>(word)] |= rowStart[word];\n"
        << "                }\n"
        << "            } else {\n"
        << "                for (int32_t tileIndex = 0; tileIndex < tileCount; ++tileIndex) {\n"
        << "                    const MaskWord* objects = compact_turn_board_objects_data_" << suffix << "(levelState) + static_cast<size_t>(tileIndex) * static_cast<size_t>(compact_turn_object_stride_" << suffix << ");\n"
        << "                    for (int32_t word = 0; word < compact_turn_object_stride_" << suffix << "; ++word) scratch.boardMask[static_cast<size_t>(word)] |= objects[word];\n"
        << "                }\n"
        << "            }\n"
        << "        }\n"
        << "    }\n"
        << "    scratch.dirtyObjectBoard = false;\n"
        << "    compact_turn_refresh_any_masks_dirty_" << suffix << "(scratch);\n"
        << "    return true;\n"
        << "}\n\n";

    out << "bool compact_turn_rebuild_dirty_movement_derived_state_" << suffix << "(LevelDimensions dimensions, Scratch& scratch) {\n"
        << "    const int32_t tileCount = compact_turn_tile_count_" << suffix << "(dimensions);\n"
        << "    if (tileCount <= 0) return false;\n"
        << "    const size_t movementWords = static_cast<size_t>(tileCount) * static_cast<size_t>(compact_turn_movement_stride_" << suffix << ");\n"
        << "    if (scratch.liveMovements.size() != movementWords) return false;\n"
        << "    const size_t rowMovementWords = static_cast<size_t>(dimensions.height) * static_cast<size_t>(compact_turn_movement_stride_" << suffix << ");\n"
        << "    const size_t columnMovementWords = static_cast<size_t>(dimensions.width) * static_cast<size_t>(compact_turn_movement_stride_" << suffix << ");\n"
        << "    const bool storageReady = (!compact_turn_needs_movement_row_masks_" << suffix << " || scratch.rowMovementMasks.size() == rowMovementWords)\n"
        << "        && (!compact_turn_needs_movement_column_masks_" << suffix << " || scratch.columnMovementMasks.size() == columnMovementWords)\n"
        << "        && (!compact_turn_needs_movement_row_all_masks_" << suffix << " || scratch.rowAllMovementMasks.size() == rowMovementWords)\n"
        << "        && (!compact_turn_needs_movement_column_all_masks_" << suffix << " || scratch.columnAllMovementMasks.size() == columnMovementWords)\n"
        << "        && (!compact_turn_needs_movement_board_mask_" << suffix << " || scratch.boardMovementMask.size() == static_cast<size_t>(compact_turn_movement_stride_" << suffix << "))\n"
        << "        && scratch.dirtyMovementRows.size() == static_cast<size_t>(dimensions.height)\n"
        << "        && scratch.dirtyMovementColumns.size() == static_cast<size_t>(dimensions.width);\n"
        << "    if (!storageReady) {\n"
        << "        const bool rebuilt = compact_turn_rebuild_movement_derived_state_" << suffix << "(dimensions, scratch);\n"
        << "        compact_turn_refresh_any_masks_dirty_" << suffix << "(scratch);\n"
        << "        return rebuilt;\n"
        << "    }\n"
        << "    if constexpr (compact_turn_needs_movement_row_masks_" << suffix << " || compact_turn_needs_movement_row_all_masks_" << suffix << ") {\n"
        << "        for (int32_t y = 0; y < dimensions.height; ++y) {\n"
        << "            if (!scratch.dirtyMovementRows[static_cast<size_t>(y)]) continue;\n"
        << "            MaskWord* rowStart = compact_turn_needs_movement_row_masks_" << suffix << " ? scratch.rowMovementMasks.data() + static_cast<size_t>(y * compact_turn_movement_stride_" << suffix << ") : nullptr;\n"
        << "            if (rowStart != nullptr) std::fill(rowStart, rowStart + compact_turn_movement_stride_" << suffix << ", 0);\n"
        << "            MaskWord* rowAllStart = compact_turn_needs_movement_row_all_masks_" << suffix << " ? scratch.rowAllMovementMasks.data() + static_cast<size_t>(y * compact_turn_movement_stride_" << suffix << ") : nullptr;\n"
        << "            if (rowAllStart != nullptr) std::fill(rowAllStart, rowAllStart + compact_turn_movement_stride_" << suffix << ", static_cast<MaskWord>(~MaskWordUnsigned{0}));\n"
        << "            for (int32_t x = 0; x < dimensions.width; ++x) {\n"
        << "                const int32_t tileIndex = compact_turn_tile_index_" << suffix << "(dimensions, x, y);\n"
        << "                const MaskWord* movements = scratch.liveMovements.data() + static_cast<size_t>(tileIndex) * static_cast<size_t>(compact_turn_movement_stride_" << suffix << ");\n"
        << "                for (int32_t word = 0; word < compact_turn_movement_stride_" << suffix << "; ++word) {\n"
        << "                    if (rowStart != nullptr) rowStart[word] |= movements[word];\n"
        << "                    if (rowAllStart != nullptr) rowAllStart[word] &= movements[word];\n"
        << "                }\n"
        << "            }\n"
        << "            scratch.dirtyMovementRows[static_cast<size_t>(y)] = 0;\n"
        << "        }\n"
        << "    } else {\n"
        << "        std::fill(scratch.dirtyMovementRows.begin(), scratch.dirtyMovementRows.end(), 0);\n"
        << "    }\n"
        << "    if constexpr (compact_turn_needs_movement_column_masks_" << suffix << " || compact_turn_needs_movement_column_all_masks_" << suffix << ") {\n"
        << "        for (int32_t x = 0; x < dimensions.width; ++x) {\n"
        << "            if (!scratch.dirtyMovementColumns[static_cast<size_t>(x)]) continue;\n"
        << "            MaskWord* columnStart = compact_turn_needs_movement_column_masks_" << suffix << " ? scratch.columnMovementMasks.data() + static_cast<size_t>(x * compact_turn_movement_stride_" << suffix << ") : nullptr;\n"
        << "            if (columnStart != nullptr) std::fill(columnStart, columnStart + compact_turn_movement_stride_" << suffix << ", 0);\n"
        << "            MaskWord* columnAllStart = compact_turn_needs_movement_column_all_masks_" << suffix << " ? scratch.columnAllMovementMasks.data() + static_cast<size_t>(x * compact_turn_movement_stride_" << suffix << ") : nullptr;\n"
        << "            if (columnAllStart != nullptr) std::fill(columnAllStart, columnAllStart + compact_turn_movement_stride_" << suffix << ", static_cast<MaskWord>(~MaskWordUnsigned{0}));\n"
        << "            for (int32_t y = 0; y < dimensions.height; ++y) {\n"
        << "                const int32_t tileIndex = compact_turn_tile_index_" << suffix << "(dimensions, x, y);\n"
        << "                const MaskWord* movements = scratch.liveMovements.data() + static_cast<size_t>(tileIndex) * static_cast<size_t>(compact_turn_movement_stride_" << suffix << ");\n"
        << "                for (int32_t word = 0; word < compact_turn_movement_stride_" << suffix << "; ++word) {\n"
        << "                    if (columnStart != nullptr) columnStart[word] |= movements[word];\n"
        << "                    if (columnAllStart != nullptr) columnAllStart[word] &= movements[word];\n"
        << "                }\n"
        << "            }\n"
        << "            scratch.dirtyMovementColumns[static_cast<size_t>(x)] = 0;\n"
        << "        }\n"
        << "    } else {\n"
        << "        std::fill(scratch.dirtyMovementColumns.begin(), scratch.dirtyMovementColumns.end(), 0);\n"
        << "    }\n"
        << "    if constexpr (compact_turn_needs_movement_board_mask_" << suffix << ") {\n"
        << "        if (scratch.dirtyMovementBoard) {\n"
        << "            std::fill(scratch.boardMovementMask.begin(), scratch.boardMovementMask.end(), 0);\n"
        << "            if constexpr (compact_turn_needs_movement_row_masks_" << suffix << ") {\n"
        << "                for (int32_t y = 0; y < dimensions.height; ++y) {\n"
        << "                    const MaskWord* rowStart = scratch.rowMovementMasks.data() + static_cast<size_t>(y * compact_turn_movement_stride_" << suffix << ");\n"
        << "                    for (int32_t word = 0; word < compact_turn_movement_stride_" << suffix << "; ++word) scratch.boardMovementMask[static_cast<size_t>(word)] |= rowStart[word];\n"
        << "                }\n"
        << "            } else {\n"
        << "                for (int32_t tileIndex = 0; tileIndex < tileCount; ++tileIndex) {\n"
        << "                    const MaskWord* movements = scratch.liveMovements.data() + static_cast<size_t>(tileIndex) * static_cast<size_t>(compact_turn_movement_stride_" << suffix << ");\n"
        << "                    for (int32_t word = 0; word < compact_turn_movement_stride_" << suffix << "; ++word) scratch.boardMovementMask[static_cast<size_t>(word)] |= movements[word];\n"
        << "                }\n"
        << "            }\n"
        << "        }\n"
        << "    }\n"
        << "    scratch.dirtyMovementBoard = false;\n"
        << "    compact_turn_refresh_any_masks_dirty_" << suffix << "(scratch);\n"
        << "    return true;\n"
        << "}\n\n";

    out << "void compact_turn_rebuild_rule_derived_state_" << suffix << "(\n"
        << "    LevelDimensions dimensions,\n"
        << "    const PersistentLevelState& levelState,\n"
        << "    Scratch& scratch,\n"
        << "    bool writesObjects,\n"
        << "    bool writesMovements\n"
        << ") {\n"
        << "#if defined(PS_GBA_PERF_TELEMETRY)\n"
        << "    const uint32_t perfRebuildStart = ps_gba_perf_rebuild_begin();\n"
        << "#endif\n"
        << "    compact_turn_count_rebuild_rule_derived_state_call_" << suffix << "();\n"
        << "    if (writesObjects) compact_turn_count_rebuild_rule_derived_state_objects_dirty_" << suffix << "();\n"
        << "    if (writesMovements) compact_turn_count_rebuild_rule_derived_state_movements_dirty_" << suffix << "();\n"
        << "    if (writesObjects) (void)compact_turn_rebuild_dirty_object_derived_state_" << suffix << "(dimensions, levelState, scratch);\n"
        << "    if (writesMovements) (void)compact_turn_rebuild_dirty_movement_derived_state_" << suffix << "(dimensions, scratch);\n"
        << "#if defined(PS_GBA_PERF_TELEMETRY)\n"
        << "    ps_gba_perf_rebuild_end(perfRebuildStart);\n"
        << "#endif\n"
        << "}\n\n";

    out << "bool compact_turn_prepare_object_cell_index_" << suffix << "(LevelDimensions dimensions, const PersistentLevelState& levelState, Scratch& scratch) {\n"
        << "    if constexpr (!compact_turn_enable_object_cell_index_" << suffix << ") { (void)dimensions; (void)levelState; (void)scratch; return false; }\n"
        << "    const int32_t tileCount = compact_turn_tile_count_" << suffix << "(dimensions);\n"
        << "    const int32_t objectCellWordCount = compact_turn_object_cell_word_count_" << suffix << "(dimensions);\n"
        << "    const size_t expectedWords = static_cast<size_t>(std::max(compact_turn_object_count_" << suffix << ", int32_t{0})) * static_cast<size_t>(objectCellWordCount);\n"
        << "    if (!scratch.objectCellIndexDirty\n"
        << "        && scratch.objectCellBitTileCount == tileCount\n"
        << "        && compact_turn_object_cell_bits_" << suffix << "(scratch).size() == expectedWords\n"
        << "        && compact_turn_object_cell_counts_" << suffix << "(scratch).size() == static_cast<size_t>(std::max(compact_turn_object_count_" << suffix << ", int32_t{0}))) {\n"
        << "        return true;\n"
        << "    }\n"
        << "    return compact_turn_rebuild_object_cell_index_" << suffix << "(dimensions, levelState, scratch);\n"
        << "}\n\n";

    out << "void compact_turn_update_object_cell_index_" << suffix << "(LevelDimensions dimensions, Scratch& scratch, int32_t tileIndex, const MaskWord* beforeObjects, const MaskWord* afterObjects) {\n"
        << "    const int32_t tileCount = compact_turn_tile_count_" << suffix << "(dimensions);\n"
        << "    const int32_t objectCellWordCount = compact_turn_object_cell_word_count_" << suffix << "(dimensions);\n"
        << "    const size_t expectedWords = static_cast<size_t>(std::max(compact_turn_object_count_" << suffix << ", int32_t{0})) * static_cast<size_t>(objectCellWordCount);\n"
        << "    if (tileIndex < 0 || tileIndex >= tileCount || beforeObjects == nullptr || afterObjects == nullptr\n"
        << "        || scratch.objectCellIndexDirty\n"
        << "        || scratch.objectCellBitTileCount != tileCount\n"
        << "        || compact_turn_object_cell_bits_" << suffix << "(scratch).size() != expectedWords\n"
        << "        || compact_turn_object_cell_counts_" << suffix << "(scratch).size() != static_cast<size_t>(std::max(compact_turn_object_count_" << suffix << ", int32_t{0}))\n"
        << "        || objectCellWordCount <= 0) {\n"
        << "        scratch.objectCellIndexDirty = true;\n"
        << "        return;\n"
        << "    }\n"
        << "    const int32_t cellWord = tileIndex >> static_cast<int32_t>(kMaskWordShift);\n"
        << "    const MaskWordUnsigned cellBit = static_cast<MaskWordUnsigned>(maskBit(static_cast<uint32_t>(tileIndex)));\n"
        << "    for (int32_t word = 0; word < compact_turn_object_stride_" << suffix << "; ++word) {\n"
        << "        MaskWordUnsigned removedBits = static_cast<MaskWordUnsigned>(beforeObjects[word] & ~afterObjects[word]);\n"
        << "        while (removedBits != 0) {\n"
        << "            const int32_t bit = maskWordCountTrailingZeros(removedBits);\n"
        << "            removedBits &= removedBits - 1;\n"
        << "            const int32_t objectId = word * static_cast<int32_t>(kMaskWordBits) + bit;\n"
        << "            if (objectId < 0 || objectId >= compact_turn_object_count_" << suffix << ") continue;\n"
        << "            const size_t objectCellIndex = static_cast<size_t>(objectId) * static_cast<size_t>(objectCellWordCount) + static_cast<size_t>(cellWord);\n"
        << "            if (objectCellIndex >= compact_turn_object_cell_bits_" << suffix << "(scratch).size() || static_cast<size_t>(objectId) >= compact_turn_object_cell_counts_" << suffix << "(scratch).size()) {\n"
        << "                scratch.objectCellIndexDirty = true;\n"
        << "                return;\n"
        << "            }\n"
        << "            compact_turn_object_cell_bits_" << suffix << "(scratch)[objectCellIndex] &= ~cellBit;\n"
        << "            if (compact_turn_object_cell_counts_" << suffix << "(scratch)[static_cast<size_t>(objectId)] > 0) --compact_turn_object_cell_counts_" << suffix << "(scratch)[static_cast<size_t>(objectId)];\n"
        << "            else {\n"
        << "                scratch.objectCellIndexDirty = true;\n"
        << "                return;\n"
        << "            }\n"
        << "        }\n"
        << "        MaskWordUnsigned addedBits = static_cast<MaskWordUnsigned>(afterObjects[word] & ~beforeObjects[word]);\n"
        << "        while (addedBits != 0) {\n"
        << "            const int32_t bit = maskWordCountTrailingZeros(addedBits);\n"
        << "            addedBits &= addedBits - 1;\n"
        << "            const int32_t objectId = word * static_cast<int32_t>(kMaskWordBits) + bit;\n"
        << "            if (objectId < 0 || objectId >= compact_turn_object_count_" << suffix << ") continue;\n"
        << "            const size_t objectCellIndex = static_cast<size_t>(objectId) * static_cast<size_t>(objectCellWordCount) + static_cast<size_t>(cellWord);\n"
        << "            if (objectCellIndex >= compact_turn_object_cell_bits_" << suffix << "(scratch).size() || static_cast<size_t>(objectId) >= compact_turn_object_cell_counts_" << suffix << "(scratch).size()) {\n"
        << "                scratch.objectCellIndexDirty = true;\n"
        << "                return;\n"
        << "            }\n"
        << "            compact_turn_object_cell_bits_" << suffix << "(scratch)[objectCellIndex] |= cellBit;\n"
        << "            ++compact_turn_object_cell_counts_" << suffix << "(scratch)[static_cast<size_t>(objectId)];\n"
        << "        }\n"
        << "    }\n"
        << "}\n\n";

    out << "bool compact_turn_update_object_mask_counts_" << suffix << "(LevelDimensions dimensions, Scratch& scratch, int32_t tileIndex, const MaskWord* beforeObjects, const MaskWord* afterObjects) {\n"
        << "    const int32_t tileCount = compact_turn_tile_count_" << suffix << "(dimensions);\n"
        << "    const size_t objectCount = static_cast<size_t>(std::max(compact_turn_object_count_" << suffix << ", int32_t{0}));\n"
        << "    const size_t rowObjectWords = static_cast<size_t>(dimensions.height) * static_cast<size_t>(compact_turn_object_stride_" << suffix << ");\n"
        << "    const size_t columnObjectWords = static_cast<size_t>(dimensions.width) * static_cast<size_t>(compact_turn_object_stride_" << suffix << ");\n"
        << "    const size_t rowObjectCountWords = static_cast<size_t>(dimensions.height) * objectCount;\n"
        << "    const size_t columnObjectCountWords = static_cast<size_t>(dimensions.width) * objectCount;\n"
        << "    if (tileIndex < 0 || tileIndex >= tileCount || beforeObjects == nullptr || afterObjects == nullptr\n"
        << "        || dimensions.width <= 0 || dimensions.height <= 0\n"
        << "        || scratch.objectRowCounts.size() != rowObjectCountWords\n"
        << "        || scratch.objectColumnCounts.size() != columnObjectCountWords\n"
        << "        || scratch.objectBoardCounts.size() != objectCount\n"
        << "        || (compact_turn_needs_object_row_masks_" << suffix << " && scratch.rowMasks.size() != rowObjectWords)\n"
        << "        || (compact_turn_needs_object_column_masks_" << suffix << " && scratch.columnMasks.size() != columnObjectWords)\n"
        << "        || (compact_turn_needs_object_row_all_masks_" << suffix << " && scratch.rowAllMasks.size() != rowObjectWords)\n"
        << "        || (compact_turn_needs_object_column_all_masks_" << suffix << " && scratch.columnAllMasks.size() != columnObjectWords)\n"
        << "        || (compact_turn_needs_object_board_mask_" << suffix << " && scratch.boardMask.size() != static_cast<size_t>(compact_turn_object_stride_" << suffix << "))) {\n"
        << "        return false;\n"
        << "    }\n"
        << "    const int32_t x = tileIndex / dimensions.height;\n"
        << "    const int32_t y = tileIndex % dimensions.height;\n"
        << "    if (!compact_turn_in_bounds_" << suffix << "(dimensions, x, y)) return false;\n"
        << "    auto clearObjectMaskBit = [](MaskVector& masks, size_t base, int32_t word, MaskWord bit) {\n"
        << "        if (base + static_cast<size_t>(word) < masks.size()) masks[base + static_cast<size_t>(word)] &= ~bit;\n"
        << "    };\n"
        << "    auto setObjectMaskBit = [](MaskVector& masks, size_t base, int32_t word, MaskWord bit) {\n"
        << "        if (base + static_cast<size_t>(word) < masks.size()) masks[base + static_cast<size_t>(word)] |= bit;\n"
        << "    };\n"
        << "    const size_t rowCountBase = static_cast<size_t>(y) * objectCount;\n"
        << "    const size_t columnCountBase = static_cast<size_t>(x) * objectCount;\n"
        << "    const size_t rowMaskBase = static_cast<size_t>(y) * static_cast<size_t>(compact_turn_object_stride_" << suffix << ");\n"
        << "    const size_t columnMaskBase = static_cast<size_t>(x) * static_cast<size_t>(compact_turn_object_stride_" << suffix << ");\n"
        << "    for (int32_t word = 0; word < compact_turn_object_stride_" << suffix << "; ++word) {\n"
        << "        MaskWordUnsigned removedBits = static_cast<MaskWordUnsigned>(beforeObjects[word] & ~afterObjects[word]);\n"
        << "        while (removedBits != 0) {\n"
        << "            const int32_t bit = maskWordCountTrailingZeros(removedBits);\n"
        << "            removedBits &= removedBits - 1;\n"
        << "            const int32_t objectId = word * static_cast<int32_t>(kMaskWordBits) + bit;\n"
        << "            if (objectId < 0 || objectId >= compact_turn_object_count_" << suffix << ") continue;\n"
        << "            const size_t objectIndex = static_cast<size_t>(objectId);\n"
        << "            const MaskWord objectBit = static_cast<MaskWord>(MaskWordUnsigned{1} << bit);\n"
        << "            uint32_t& rowCount = scratch.objectRowCounts[rowCountBase + objectIndex];\n"
        << "            uint32_t& columnCount = scratch.objectColumnCounts[columnCountBase + objectIndex];\n"
        << "            uint32_t& boardCount = scratch.objectBoardCounts[objectIndex];\n"
        << "            if (rowCount == 0 || columnCount == 0 || boardCount == 0) return false;\n"
        << "            --rowCount;\n"
        << "            --columnCount;\n"
        << "            --boardCount;\n"
        << "            if constexpr (compact_turn_needs_object_row_masks_" << suffix << ") if (rowCount == 0) clearObjectMaskBit(scratch.rowMasks, rowMaskBase, word, objectBit);\n"
        << "            if constexpr (compact_turn_needs_object_column_masks_" << suffix << ") if (columnCount == 0) clearObjectMaskBit(scratch.columnMasks, columnMaskBase, word, objectBit);\n"
        << "            if constexpr (compact_turn_needs_object_board_mask_" << suffix << ") if (boardCount == 0) clearObjectMaskBit(scratch.boardMask, 0, word, objectBit);\n"
        << "            if constexpr (compact_turn_needs_object_row_all_masks_" << suffix << ") if (rowCount < static_cast<uint32_t>(dimensions.width)) clearObjectMaskBit(scratch.rowAllMasks, rowMaskBase, word, objectBit);\n"
        << "            if constexpr (compact_turn_needs_object_column_all_masks_" << suffix << ") if (columnCount < static_cast<uint32_t>(dimensions.height)) clearObjectMaskBit(scratch.columnAllMasks, columnMaskBase, word, objectBit);\n"
        << "        }\n"
        << "        MaskWordUnsigned addedBits = static_cast<MaskWordUnsigned>(afterObjects[word] & ~beforeObjects[word]);\n"
        << "        while (addedBits != 0) {\n"
        << "            const int32_t bit = maskWordCountTrailingZeros(addedBits);\n"
        << "            addedBits &= addedBits - 1;\n"
        << "            const int32_t objectId = word * static_cast<int32_t>(kMaskWordBits) + bit;\n"
        << "            if (objectId < 0 || objectId >= compact_turn_object_count_" << suffix << ") continue;\n"
        << "            const size_t objectIndex = static_cast<size_t>(objectId);\n"
        << "            const MaskWord objectBit = static_cast<MaskWord>(MaskWordUnsigned{1} << bit);\n"
        << "            uint32_t& rowCount = scratch.objectRowCounts[rowCountBase + objectIndex];\n"
        << "            uint32_t& columnCount = scratch.objectColumnCounts[columnCountBase + objectIndex];\n"
        << "            uint32_t& boardCount = scratch.objectBoardCounts[objectIndex];\n"
        << "            ++rowCount;\n"
        << "            ++columnCount;\n"
        << "            ++boardCount;\n"
        << "            if (rowCount > static_cast<uint32_t>(dimensions.width) || columnCount > static_cast<uint32_t>(dimensions.height) || boardCount > static_cast<uint32_t>(tileCount)) return false;\n"
        << "            if constexpr (compact_turn_needs_object_row_masks_" << suffix << ") if (rowCount == 1) setObjectMaskBit(scratch.rowMasks, rowMaskBase, word, objectBit);\n"
        << "            if constexpr (compact_turn_needs_object_column_masks_" << suffix << ") if (columnCount == 1) setObjectMaskBit(scratch.columnMasks, columnMaskBase, word, objectBit);\n"
        << "            if constexpr (compact_turn_needs_object_board_mask_" << suffix << ") if (boardCount == 1) setObjectMaskBit(scratch.boardMask, 0, word, objectBit);\n"
        << "            if constexpr (compact_turn_needs_object_row_all_masks_" << suffix << ") if (rowCount == static_cast<uint32_t>(dimensions.width)) setObjectMaskBit(scratch.rowAllMasks, rowMaskBase, word, objectBit);\n"
        << "            if constexpr (compact_turn_needs_object_column_all_masks_" << suffix << ") if (columnCount == static_cast<uint32_t>(dimensions.height)) setObjectMaskBit(scratch.columnAllMasks, columnMaskBase, word, objectBit);\n"
        << "        }\n"
        << "    }\n"
        << "    return true;\n"
        << "}\n\n";

    out << "bool compact_turn_prepare_state_" << suffix << "(LevelDimensions dimensions, PersistentLevelState& levelState, Scratch& scratch) {\n"
        << "    const int32_t tileCount = compact_turn_tile_count_" << suffix << "(dimensions);\n"
        << "    if (tileCount <= 0) return false;\n"
        << "#if defined(PS_GBA_PERF_TELEMETRY)\n"
        << "    ps_gba_perf_progress(1, 1);\n"
        << "#endif\n"
        << "    scratch.singleRowMatchScratch.reserve(static_cast<size_t>(tileCount));\n"
        << "    const size_t objectWords = static_cast<size_t>(tileCount) * static_cast<size_t>(compact_turn_object_stride_" << suffix << ");\n"
        << "    if (compact_turn_board_objects_size_" << suffix << "(levelState) != objectWords) return false;\n"
        << "    const size_t movementWords = static_cast<size_t>(tileCount) * static_cast<size_t>(compact_turn_movement_stride_" << suffix << ");\n"
        << "#if defined(PS_GBA_PERF_TELEMETRY)\n"
        << "    ps_gba_perf_progress(1, 2);\n"
        << "#endif\n"
        << "    if (scratch.liveMovements.size() != movementWords) {\n"
        << "        scratch.liveMovements.assign(movementWords, 0);\n"
        << "        scratch.liveMovementsClean = true;\n"
        << "        scratch.movementCellIndexDirty = true;\n"
        << "    }\n"
        << "    const size_t rowObjectWords = static_cast<size_t>(dimensions.height) * static_cast<size_t>(compact_turn_object_stride_" << suffix << ");\n"
        << "    const size_t columnObjectWords = static_cast<size_t>(dimensions.width) * static_cast<size_t>(compact_turn_object_stride_" << suffix << ");\n"
        << "    const size_t objectCount = static_cast<size_t>(std::max(compact_turn_object_count_" << suffix << ", int32_t{0}));\n"
        << "    const size_t rowObjectCountWords = static_cast<size_t>(dimensions.height) * objectCount;\n"
        << "    const size_t columnObjectCountWords = static_cast<size_t>(dimensions.width) * objectCount;\n"
        << "    const size_t rowMovementWords = static_cast<size_t>(dimensions.height) * static_cast<size_t>(compact_turn_movement_stride_" << suffix << ");\n"
        << "    const size_t columnMovementWords = static_cast<size_t>(dimensions.width) * static_cast<size_t>(compact_turn_movement_stride_" << suffix << ");\n"
        << "    const bool masksStorageReady = (!compact_turn_needs_object_row_masks_" << suffix << "\n"
        << "            || (scratch.rowMasks.size() == rowObjectWords && scratch.dirtyObjectRows.size() == static_cast<size_t>(dimensions.height)))\n"
        << "        && (!compact_turn_needs_object_column_masks_" << suffix << "\n"
        << "            || (scratch.columnMasks.size() == columnObjectWords && scratch.dirtyObjectColumns.size() == static_cast<size_t>(dimensions.width)))\n"
        << "        && (!compact_turn_needs_object_row_all_masks_" << suffix << " || scratch.rowAllMasks.size() == rowObjectWords)\n"
        << "        && (!compact_turn_needs_object_column_all_masks_" << suffix << " || scratch.columnAllMasks.size() == columnObjectWords)\n"
        << "        && (!compact_turn_needs_object_board_mask_" << suffix << " || scratch.boardMask.size() == static_cast<size_t>(compact_turn_object_stride_" << suffix << "))\n"
        << "        && scratch.objectRowCounts.size() == rowObjectCountWords\n"
        << "        && scratch.objectColumnCounts.size() == columnObjectCountWords\n"
        << "        && scratch.objectBoardCounts.size() == objectCount\n"
        << "        && (!compact_turn_needs_movement_row_masks_" << suffix << "\n"
        << "            || (scratch.rowMovementMasks.size() == rowMovementWords && scratch.dirtyMovementRows.size() == static_cast<size_t>(dimensions.height)))\n"
        << "        && (!compact_turn_needs_movement_column_masks_" << suffix << "\n"
        << "            || (scratch.columnMovementMasks.size() == columnMovementWords && scratch.dirtyMovementColumns.size() == static_cast<size_t>(dimensions.width)))\n"
        << "        && (!compact_turn_needs_movement_row_all_masks_" << suffix << " || scratch.rowAllMovementMasks.size() == rowMovementWords)\n"
        << "        && (!compact_turn_needs_movement_column_all_masks_" << suffix << " || scratch.columnAllMovementMasks.size() == columnMovementWords)\n"
        << "        && (!compact_turn_needs_movement_board_mask_" << suffix << " || scratch.boardMovementMask.size() == static_cast<size_t>(compact_turn_movement_stride_" << suffix << "));\n"
        << "#if defined(PS_GBA_PERF_TELEMETRY)\n"
        << "    ps_gba_perf_progress(1, 3);\n"
        << "#endif\n"
        << "    if (!scratch.anyMasksDirty && masksStorageReady) {\n"
        << "        if (compact_turn_has_rigid_" << suffix << ") {\n"
        << "            if (scratch.rigidGroupIndexMasks.size() != movementWords) scratch.rigidGroupIndexMasks.assign(movementWords, 0);\n"
        << "            if (scratch.rigidMovementAppliedMasks.size() != movementWords) scratch.rigidMovementAppliedMasks.assign(movementWords, 0);\n"
        << "        }\n"
        << "        return true;\n"
        << "    }\n"
        << "    const auto noDirtyBytes = [](const std::vector<uint8_t>& values) {\n"
        << "        return std::none_of(values.begin(), values.end(), [](uint8_t value) { return value != 0; });\n"
        << "    };\n"
        << "    const bool objectRowsReady = !compact_turn_needs_object_row_masks_" << suffix << "\n"
        << "        || (scratch.rowMasks.size() == rowObjectWords\n"
        << "            && scratch.dirtyObjectRows.size() == static_cast<size_t>(dimensions.height)\n"
        << "            && noDirtyBytes(scratch.dirtyObjectRows));\n"
        << "    const bool objectColumnsReady = !compact_turn_needs_object_column_masks_" << suffix << "\n"
        << "        || (scratch.columnMasks.size() == columnObjectWords\n"
        << "            && scratch.dirtyObjectColumns.size() == static_cast<size_t>(dimensions.width)\n"
        << "            && noDirtyBytes(scratch.dirtyObjectColumns));\n"
        << "    const bool objectRowAllReady = !compact_turn_needs_object_row_all_masks_" << suffix << "\n"
        << "        || scratch.rowAllMasks.size() == rowObjectWords;\n"
        << "    const bool objectColumnAllReady = !compact_turn_needs_object_column_all_masks_" << suffix << "\n"
        << "        || scratch.columnAllMasks.size() == columnObjectWords;\n"
        << "    const bool objectBoardReady = !compact_turn_needs_object_board_mask_" << suffix << "\n"
        << "        || (scratch.boardMask.size() == static_cast<size_t>(compact_turn_object_stride_" << suffix << ")\n"
        << "            && !scratch.dirtyObjectBoard);\n"
        << "    const bool objectCountCachesReady = scratch.objectRowCounts.size() == rowObjectCountWords\n"
        << "        && scratch.objectColumnCounts.size() == columnObjectCountWords\n"
        << "        && scratch.objectBoardCounts.size() == objectCount;\n"
        << "    const bool objectMasksReady = objectRowsReady\n"
        << "        && objectColumnsReady\n"
        << "        && objectRowAllReady\n"
        << "        && objectColumnAllReady\n"
        << "        && objectBoardReady\n"
        << "        && objectCountCachesReady;\n"
        << "    if (!objectMasksReady) {\n"
        << "#if defined(PS_GBA_PERF_TELEMETRY)\n"
        << "        ps_gba_perf_progress(1, 4);\n"
        << "#endif\n"
        << "        if (!compact_turn_rebuild_object_derived_state_" << suffix << "(dimensions, levelState, scratch)) return false;\n"
        << "#if defined(PS_GBA_PERF_TELEMETRY)\n"
        << "        ps_gba_perf_progress(1, 5);\n"
        << "#endif\n"
        << "    }\n"
        << "    const bool movementRowsReady = !compact_turn_needs_movement_row_masks_" << suffix << "\n"
        << "        || (scratch.rowMovementMasks.size() == rowMovementWords\n"
        << "            && scratch.dirtyMovementRows.size() == static_cast<size_t>(dimensions.height)\n"
        << "            && noDirtyBytes(scratch.dirtyMovementRows));\n"
        << "    const bool movementColumnsReady = !compact_turn_needs_movement_column_masks_" << suffix << "\n"
        << "        || (scratch.columnMovementMasks.size() == columnMovementWords\n"
        << "            && scratch.dirtyMovementColumns.size() == static_cast<size_t>(dimensions.width)\n"
        << "            && noDirtyBytes(scratch.dirtyMovementColumns));\n"
        << "    const bool movementRowAllReady = !compact_turn_needs_movement_row_all_masks_" << suffix << "\n"
        << "        || scratch.rowAllMovementMasks.size() == rowMovementWords;\n"
        << "    const bool movementColumnAllReady = !compact_turn_needs_movement_column_all_masks_" << suffix << "\n"
        << "        || scratch.columnAllMovementMasks.size() == columnMovementWords;\n"
        << "    const bool movementBoardReady = !compact_turn_needs_movement_board_mask_" << suffix << "\n"
        << "        || (scratch.boardMovementMask.size() == static_cast<size_t>(compact_turn_movement_stride_" << suffix << ")\n"
        << "            && !scratch.dirtyMovementBoard);\n"
        << "    const bool movementMasksReady = movementRowsReady\n"
        << "        && movementColumnsReady\n"
        << "        && movementRowAllReady\n"
        << "        && movementColumnAllReady\n"
        << "        && movementBoardReady;\n"
        << "    if (!movementMasksReady) {\n"
        << "#if defined(PS_GBA_PERF_TELEMETRY)\n"
        << "        ps_gba_perf_progress(1, 6);\n"
        << "#endif\n"
        << "        if (!compact_turn_rebuild_movement_derived_state_" << suffix << "(dimensions, scratch)) return false;\n"
        << "#if defined(PS_GBA_PERF_TELEMETRY)\n"
        << "        ps_gba_perf_progress(1, 7);\n"
        << "#endif\n"
        << "    }\n"
        << "    scratch.anyMasksDirty = !compact_turn_needs_object_row_masks_" << suffix << "\n"
        << "        || !compact_turn_needs_object_column_masks_" << suffix << "\n"
        << "        || !compact_turn_needs_object_board_mask_" << suffix << "\n"
        << "        || !compact_turn_needs_movement_row_masks_" << suffix << "\n"
        << "        || !compact_turn_needs_movement_column_masks_" << suffix << "\n"
        << "        || !compact_turn_needs_movement_board_mask_" << suffix << ";\n"
        << "    if (compact_turn_has_rigid_" << suffix << ") {\n"
        << "        if (scratch.rigidGroupIndexMasks.size() != movementWords) scratch.rigidGroupIndexMasks.assign(movementWords, 0);\n"
        << "        if (scratch.rigidMovementAppliedMasks.size() != movementWords) scratch.rigidMovementAppliedMasks.assign(movementWords, 0);\n"
        << "    }\n"
        << "#if defined(PS_GBA_PERF_TELEMETRY)\n"
        << "    ps_gba_perf_progress(1, 8);\n"
        << "#endif\n"
        << "    return true;\n"
        << "}\n\n";

    out << "MaskWord* compact_turn_cell_objects_" << suffix << "(PersistentLevelState& levelState, int32_t tileIndex) {\n"
        << "    return compact_turn_board_objects_data_" << suffix << "(levelState) + static_cast<size_t>(tileIndex) * static_cast<size_t>(compact_turn_object_stride_" << suffix << ");\n"
        << "}\n\n";

    out << "const MaskWord* compact_turn_cell_objects_" << suffix << "(const PersistentLevelState& levelState, int32_t tileIndex) {\n"
        << "    return compact_turn_board_objects_data_" << suffix << "(levelState) + static_cast<size_t>(tileIndex) * static_cast<size_t>(compact_turn_object_stride_" << suffix << ");\n"
        << "}\n\n";

    out << "MaskWord* compact_turn_cell_movements_" << suffix << "(Scratch& scratch, int32_t tileIndex) {\n"
        << "    return scratch.liveMovements.data() + static_cast<size_t>(tileIndex) * static_cast<size_t>(compact_turn_movement_stride_" << suffix << ");\n"
        << "}\n\n";

    out << "const MaskWord* compact_turn_cell_movements_" << suffix << "(const Scratch& scratch, int32_t tileIndex) {\n"
        << "    return scratch.liveMovements.data() + static_cast<size_t>(tileIndex) * static_cast<size_t>(compact_turn_movement_stride_" << suffix << ");\n"
        << "}\n\n";

    out << "void compact_turn_note_object_cell_written_" << suffix << "(LevelDimensions dimensions, Scratch& scratch, int32_t tileIndex, const MaskWord* beforeObjects, const MaskWord* afterObjects) {\n"
        << "    const int32_t x = tileIndex / dimensions.height;\n"
        << "    const int32_t y = tileIndex % dimensions.height;\n"
        << "    const bool updatedObjectMasks = compact_turn_update_object_mask_counts_" << suffix << "(dimensions, scratch, tileIndex, beforeObjects, afterObjects);\n"
        << "    if (!updatedObjectMasks) {\n"
        << "        scratch.objectRowCounts.clear();\n"
        << "        scratch.objectColumnCounts.clear();\n"
        << "        scratch.objectBoardCounts.clear();\n"
        << "        if (y >= 0 && static_cast<size_t>(y) < scratch.dirtyObjectRows.size()) scratch.dirtyObjectRows[static_cast<size_t>(y)] = 1;\n"
        << "        if (x >= 0 && static_cast<size_t>(x) < scratch.dirtyObjectColumns.size()) scratch.dirtyObjectColumns[static_cast<size_t>(x)] = 1;\n"
        << "        scratch.dirtyObjectBoard = true;\n"
        << "        scratch.anyMasksDirty = true;\n"
        << "    }\n"
        << "    compact_turn_update_object_cell_index_" << suffix << "(dimensions, scratch, tileIndex, beforeObjects, afterObjects);\n"
        << "}\n\n";

    out << "void compact_turn_note_replacement_object_cell_written_" << suffix << "(LevelDimensions dimensions, Scratch& scratch, int32_t tileIndex, const MaskWord* beforeObjects, const MaskWord* afterObjects) {\n"
        << "#if defined(PS_COMPACT_TURN_OUTPUT_HOOKS)\n"
        << "    compactTurnAccumulateReplacementAudio(beforeObjects, afterObjects, compact_turn_object_stride_" << suffix << ");\n"
        << "#endif\n"
        << "    compact_turn_note_object_cell_written_" << suffix << "(dimensions, scratch, tileIndex, beforeObjects, afterObjects);\n"
        << "}\n\n";

    out << "void compact_turn_note_movement_cell_written_" << suffix << "(LevelDimensions dimensions, Scratch& scratch, int32_t tileIndex, const MaskWord* beforeMovements, const MaskWord* afterMovements) {\n"
        << "    const int32_t x = tileIndex / dimensions.height;\n"
        << "    const int32_t y = tileIndex % dimensions.height;\n"
        << "    scratch.liveMovementsClean = false;\n"
        << "    compact_turn_update_movement_cell_index_" << suffix << "(dimensions, scratch, tileIndex, beforeMovements, afterMovements);\n"
        << "    bool removedMovements = false;\n"
        << "    for (int32_t word = 0; word < compact_turn_movement_stride_" << suffix << "; ++word) {\n"
        << "        const MaskWord removed = beforeMovements[word] & ~afterMovements[word];\n"
        << "        removedMovements = removedMovements || removed != 0;\n"
        << "    }\n"
        << "    if (removedMovements) {\n"
        << "        if (y >= 0 && static_cast<size_t>(y) < scratch.dirtyMovementRows.size()) scratch.dirtyMovementRows[static_cast<size_t>(y)] = 1;\n"
        << "        if (x >= 0 && static_cast<size_t>(x) < scratch.dirtyMovementColumns.size()) scratch.dirtyMovementColumns[static_cast<size_t>(x)] = 1;\n"
        << "        scratch.dirtyMovementBoard = true;\n"
        << "        scratch.anyMasksDirty = true;\n"
        << "    }\n"
        << "    for (int32_t word = 0; word < compact_turn_movement_stride_" << suffix << "; ++word) {\n"
        << "        const MaskWord value = afterMovements[word];\n"
        << "        if constexpr (compact_turn_needs_movement_row_masks_" << suffix << ") scratch.rowMovementMasks[static_cast<size_t>(y * compact_turn_movement_stride_" << suffix << " + word)] |= value;\n"
        << "        if constexpr (compact_turn_needs_movement_column_masks_" << suffix << ") scratch.columnMovementMasks[static_cast<size_t>(x * compact_turn_movement_stride_" << suffix << " + word)] |= value;\n"
        << "        if constexpr (compact_turn_needs_movement_board_mask_" << suffix << ") scratch.boardMovementMask[static_cast<size_t>(word)] |= value;\n"
        << "    }\n"
        << "}\n\n";

    out << "inline bool compact_turn_simple_replacement_fast_path_objects_eager_" << suffix << "(\n"
        << "    LevelDimensions dimensions,\n"
        << "    PersistentLevelState& levelState,\n"
        << "    Scratch& scratch,\n"
        << "    int32_t tileIndex,\n"
        << "    const MaskWord* objectClearMask,\n"
        << "    const MaskWord* objectSetMask\n"
        << ") {\n"
        << "    compact_turn_count_simple_replacement_fast_path_call_" << suffix << "();\n"
        << "    compact_turn_count_replacements_attempted_" << suffix << "();\n"
        << "    MaskWord* fastObjects = compact_turn_cell_objects_" << suffix << "(levelState, tileIndex);\n"
        << "    MaskWord beforeObjects[compact_turn_object_stride_" << suffix << "] = {};\n"
        << "    for (int32_t word = 0; word < compact_turn_object_stride_" << suffix << "; ++word) {\n"
        << "        const MaskWord before = fastObjects[word];\n"
        << "        beforeObjects[word] = before;\n"
        << "        const MaskWord after = (before & ~objectClearMask[word]) | objectSetMask[word];\n"
        << "        fastObjects[word] = after;\n"
        << "    }\n"
        << "    compact_turn_note_replacement_object_cell_written_" << suffix << "(dimensions, scratch, tileIndex, beforeObjects, fastObjects);\n"
        << "    compact_turn_count_simple_replacement_fast_path_change_" << suffix << "();\n"
        << "    compact_turn_count_replacements_applied_" << suffix << "();\n"
        << "    return true;\n"
        << "}\n\n";

    out << "inline bool compact_turn_simple_replacement_fast_path_movements_eager_" << suffix << "(\n"
        << "    LevelDimensions dimensions,\n"
        << "    Scratch& scratch,\n"
        << "    int32_t tileIndex,\n"
        << "    const MaskWord* movementClearMask,\n"
        << "    const MaskWord* movementSetMask,\n"
        << "    const MaskWord* movementLayerMask\n"
        << ") {\n"
        << "    compact_turn_count_simple_replacement_fast_path_call_" << suffix << "();\n"
        << "    compact_turn_count_replacements_attempted_" << suffix << "();\n"
        << "    MaskWord* fastMovements = compact_turn_cell_movements_" << suffix << "(scratch, tileIndex);\n"
        << "    MaskWord beforeMovements[compact_turn_movement_stride_" << suffix << "] = {};\n"
        << "    for (int32_t word = 0; word < compact_turn_movement_stride_" << suffix << "; ++word) {\n"
        << "        const MaskWord before = fastMovements[word];\n"
        << "        beforeMovements[word] = before;\n"
        << "        const MaskWord clear = movementClearMask[word] | movementLayerMask[word];\n"
        << "        const MaskWord after = (before & ~clear) | movementSetMask[word];\n"
        << "        fastMovements[word] = after;\n"
        << "    }\n"
        << "    compact_turn_note_movement_cell_written_" << suffix << "(dimensions, scratch, tileIndex, beforeMovements, fastMovements);\n"
        << "    compact_turn_count_simple_replacement_fast_path_change_" << suffix << "();\n"
        << "    compact_turn_count_replacements_applied_" << suffix << "();\n"
        << "    return true;\n"
        << "}\n\n";

    auto emitObjectsMovementsEagerHelper = [&](std::string_view variant, bool objectsGuaranteed, bool movementsGuaranteed) {
        out << "inline bool compact_turn_simple_replacement_fast_path_objects_movements_eager" << variant << "_" << suffix << "(\n"
            << "    LevelDimensions dimensions,\n"
            << "    PersistentLevelState& levelState,\n"
            << "    Scratch& scratch,\n"
            << "    int32_t tileIndex,\n"
            << "    const MaskWord* objectClearMask,\n"
            << "    const MaskWord* objectSetMask,\n"
            << "    const MaskWord* movementClearMask,\n"
            << "    const MaskWord* movementSetMask,\n"
            << "    const MaskWord* movementLayerMask\n"
            << ") {\n"
            << "    compact_turn_count_simple_replacement_fast_path_call_" << suffix << "();\n"
            << "    compact_turn_count_replacements_attempted_" << suffix << "();\n";
        if (objectsGuaranteed) {
            out << "    MaskWord* fastObjects = compact_turn_cell_objects_" << suffix << "(levelState, tileIndex);\n"
                << "    MaskWord beforeObjects[compact_turn_object_stride_" << suffix << "] = {};\n"
                << "    for (int32_t word = 0; word < compact_turn_object_stride_" << suffix << "; ++word) {\n"
                << "        const MaskWord before = fastObjects[word];\n"
                << "        beforeObjects[word] = before;\n"
                << "        const MaskWord after = (before & ~objectClearMask[word]) | objectSetMask[word];\n"
                << "        fastObjects[word] = after;\n"
                << "    }\n";
        } else {
            out << "    bool fastObjectsChanged = false;\n"
                << "    MaskWord* fastObjects = compact_turn_cell_objects_" << suffix << "(levelState, tileIndex);\n"
                << "    MaskWord beforeObjects[compact_turn_object_stride_" << suffix << "] = {};\n"
                << "    for (int32_t word = 0; word < compact_turn_object_stride_" << suffix << "; ++word) {\n"
                << "        const MaskWord before = fastObjects[word];\n"
                << "        beforeObjects[word] = before;\n"
                << "        const MaskWord after = (before & ~objectClearMask[word]) | objectSetMask[word];\n"
                << "        if (before != after) {\n"
                << "            fastObjects[word] = after;\n"
                << "            fastObjectsChanged = true;\n"
                << "        }\n"
                << "    }\n";
        }
        if (movementsGuaranteed) {
            out << "    MaskWord* fastMovements = compact_turn_cell_movements_" << suffix << "(scratch, tileIndex);\n"
                << "    MaskWord beforeMovements[compact_turn_movement_stride_" << suffix << "] = {};\n"
                << "    for (int32_t word = 0; word < compact_turn_movement_stride_" << suffix << "; ++word) {\n"
                << "        const MaskWord before = fastMovements[word];\n"
                << "        beforeMovements[word] = before;\n"
                << "        const MaskWord clear = movementClearMask[word] | movementLayerMask[word];\n"
                << "        const MaskWord after = (before & ~clear) | movementSetMask[word];\n"
                << "        fastMovements[word] = after;\n"
                << "    }\n";
        } else {
            out << "    bool fastMovementsChanged = false;\n"
                << "    MaskWord* fastMovements = compact_turn_cell_movements_" << suffix << "(scratch, tileIndex);\n"
                << "    MaskWord beforeMovements[compact_turn_movement_stride_" << suffix << "] = {};\n"
                << "    for (int32_t word = 0; word < compact_turn_movement_stride_" << suffix << "; ++word) {\n"
                << "        const MaskWord before = fastMovements[word];\n"
                << "        beforeMovements[word] = before;\n"
                << "        const MaskWord clear = movementClearMask[word] | movementLayerMask[word];\n"
                << "        const MaskWord after = (before & ~clear) | movementSetMask[word];\n"
                << "        if (before != after) {\n"
                << "            fastMovements[word] = after;\n"
                << "            fastMovementsChanged = true;\n"
                << "        }\n"
                << "    }\n";
        }
        if (objectsGuaranteed) {
            out << "    compact_turn_note_replacement_object_cell_written_" << suffix << "(dimensions, scratch, tileIndex, beforeObjects, fastObjects);\n";
        } else {
            out << "    if (fastObjectsChanged) compact_turn_note_replacement_object_cell_written_" << suffix << "(dimensions, scratch, tileIndex, beforeObjects, fastObjects);\n";
        }
        if (movementsGuaranteed) {
            out << "    compact_turn_note_movement_cell_written_" << suffix << "(dimensions, scratch, tileIndex, beforeMovements, fastMovements);\n";
        } else {
            out << "    if (fastMovementsChanged) compact_turn_note_movement_cell_written_" << suffix << "(dimensions, scratch, tileIndex, beforeMovements, fastMovements);\n";
        }
        out << "    compact_turn_count_simple_replacement_fast_path_change_" << suffix << "();\n"
            << "    compact_turn_count_replacements_applied_" << suffix << "();\n"
            << "    return true;\n"
            << "}\n\n";
    };
    emitObjectsMovementsEagerHelper("_objects", true, false);
    emitObjectsMovementsEagerHelper("_movements", false, true);
    emitObjectsMovementsEagerHelper("_both", true, true);

    out << "inline bool compact_turn_simple_replacement_fast_path_objects_" << suffix << "(\n"
        << "    LevelDimensions dimensions,\n"
        << "    PersistentLevelState& levelState,\n"
        << "    Scratch& scratch,\n"
        << "    int32_t tileIndex,\n"
        << "    const MaskWord* objectClearMask,\n"
        << "    const MaskWord* objectSetMask\n"
        << ") {\n"
        << "    compact_turn_count_simple_replacement_fast_path_call_" << suffix << "();\n"
        << "    compact_turn_count_replacements_attempted_" << suffix << "();\n"
        << "    MaskWord* fastObjects = compact_turn_cell_objects_" << suffix << "(levelState, tileIndex);\n"
        << "    int32_t firstChangedObjectWord = -1;\n"
        << "    for (int32_t word = 0; word < compact_turn_object_stride_" << suffix << "; ++word) {\n"
        << "        const MaskWord before = fastObjects[word];\n"
        << "        const MaskWord after = (before & ~objectClearMask[word]) | objectSetMask[word];\n"
        << "        if (before != after) {\n"
        << "            firstChangedObjectWord = word;\n"
        << "            break;\n"
        << "        }\n"
        << "    }\n"
        << "    if (firstChangedObjectWord >= 0) {\n"
        << "        MaskWord beforeObjects[compact_turn_object_stride_" << suffix << "] = {};\n"
        << "        for (int32_t word = 0; word < firstChangedObjectWord; ++word) beforeObjects[word] = fastObjects[word];\n"
        << "        for (int32_t word = firstChangedObjectWord; word < compact_turn_object_stride_" << suffix << "; ++word) {\n"
        << "            const MaskWord before = fastObjects[word];\n"
        << "            beforeObjects[word] = before;\n"
        << "            const MaskWord after = (before & ~objectClearMask[word]) | objectSetMask[word];\n"
        << "            if (before != after) fastObjects[word] = after;\n"
        << "        }\n"
        << "        compact_turn_note_replacement_object_cell_written_" << suffix << "(dimensions, scratch, tileIndex, beforeObjects, fastObjects);\n"
        << "        compact_turn_count_simple_replacement_fast_path_change_" << suffix << "();\n"
        << "        compact_turn_count_replacements_applied_" << suffix << "();\n"
        << "        return true;\n"
        << "    }\n"
        << "    compact_turn_count_simple_replacement_fast_path_noop_" << suffix << "();\n"
        << "    return false;\n"
        << "}\n\n";

    out << "inline bool compact_turn_simple_replacement_fast_path_movements_" << suffix << "(\n"
        << "    LevelDimensions dimensions,\n"
        << "    Scratch& scratch,\n"
        << "    int32_t tileIndex,\n"
        << "    const MaskWord* movementClearMask,\n"
        << "    const MaskWord* movementSetMask,\n"
        << "    const MaskWord* movementLayerMask\n"
        << ") {\n"
        << "    compact_turn_count_simple_replacement_fast_path_call_" << suffix << "();\n"
        << "    compact_turn_count_replacements_attempted_" << suffix << "();\n"
        << "    MaskWord* fastMovements = compact_turn_cell_movements_" << suffix << "(scratch, tileIndex);\n"
        << "    int32_t firstChangedMovementWord = -1;\n"
        << "    for (int32_t word = 0; word < compact_turn_movement_stride_" << suffix << "; ++word) {\n"
        << "        const MaskWord before = fastMovements[word];\n"
        << "        const MaskWord clear = movementClearMask[word] | movementLayerMask[word];\n"
        << "        const MaskWord after = (before & ~clear) | movementSetMask[word];\n"
        << "        if (before != after) {\n"
        << "            firstChangedMovementWord = word;\n"
        << "            break;\n"
        << "        }\n"
        << "    }\n"
        << "    if (firstChangedMovementWord >= 0) {\n"
        << "        MaskWord beforeMovements[compact_turn_movement_stride_" << suffix << "] = {};\n"
        << "        for (int32_t word = 0; word < firstChangedMovementWord; ++word) beforeMovements[word] = fastMovements[word];\n"
        << "        for (int32_t word = firstChangedMovementWord; word < compact_turn_movement_stride_" << suffix << "; ++word) {\n"
        << "            const MaskWord before = fastMovements[word];\n"
        << "            beforeMovements[word] = before;\n"
        << "            const MaskWord clear = movementClearMask[word] | movementLayerMask[word];\n"
        << "            const MaskWord after = (before & ~clear) | movementSetMask[word];\n"
        << "            if (before != after) fastMovements[word] = after;\n"
        << "        }\n"
        << "        compact_turn_note_movement_cell_written_" << suffix << "(dimensions, scratch, tileIndex, beforeMovements, fastMovements);\n"
        << "        compact_turn_count_simple_replacement_fast_path_change_" << suffix << "();\n"
        << "        compact_turn_count_replacements_applied_" << suffix << "();\n"
        << "        return true;\n"
        << "    }\n"
        << "    compact_turn_count_simple_replacement_fast_path_noop_" << suffix << "();\n"
        << "    return false;\n"
        << "}\n\n";

    out << "inline bool compact_turn_simple_replacement_fast_path_objects_movements_" << suffix << "(\n"
        << "    LevelDimensions dimensions,\n"
        << "    PersistentLevelState& levelState,\n"
        << "    Scratch& scratch,\n"
        << "    int32_t tileIndex,\n"
        << "    const MaskWord* objectClearMask,\n"
        << "    const MaskWord* objectSetMask,\n"
        << "    const MaskWord* movementClearMask,\n"
        << "    const MaskWord* movementSetMask,\n"
        << "    const MaskWord* movementLayerMask\n"
        << ") {\n"
        << "    compact_turn_count_simple_replacement_fast_path_call_" << suffix << "();\n"
        << "    compact_turn_count_replacements_attempted_" << suffix << "();\n"
        << "    MaskWord* fastObjects = compact_turn_cell_objects_" << suffix << "(levelState, tileIndex);\n"
        << "    int32_t firstChangedObjectWord = -1;\n"
        << "    for (int32_t word = 0; word < compact_turn_object_stride_" << suffix << "; ++word) {\n"
        << "        const MaskWord before = fastObjects[word];\n"
        << "        const MaskWord after = (before & ~objectClearMask[word]) | objectSetMask[word];\n"
        << "        if (before != after) {\n"
        << "            firstChangedObjectWord = word;\n"
        << "            break;\n"
        << "        }\n"
        << "    }\n"
        << "    MaskWord* fastMovements = compact_turn_cell_movements_" << suffix << "(scratch, tileIndex);\n"
        << "    int32_t firstChangedMovementWord = -1;\n"
        << "    for (int32_t word = 0; word < compact_turn_movement_stride_" << suffix << "; ++word) {\n"
        << "        const MaskWord before = fastMovements[word];\n"
        << "        const MaskWord clear = movementClearMask[word] | movementLayerMask[word];\n"
        << "        const MaskWord after = (before & ~clear) | movementSetMask[word];\n"
        << "        if (before != after) {\n"
        << "            firstChangedMovementWord = word;\n"
        << "            break;\n"
        << "        }\n"
        << "    }\n"
        << "    if (firstChangedObjectWord >= 0) {\n"
        << "        MaskWord beforeObjects[compact_turn_object_stride_" << suffix << "] = {};\n"
        << "        for (int32_t word = 0; word < firstChangedObjectWord; ++word) beforeObjects[word] = fastObjects[word];\n"
        << "        for (int32_t word = firstChangedObjectWord; word < compact_turn_object_stride_" << suffix << "; ++word) {\n"
        << "            const MaskWord before = fastObjects[word];\n"
        << "            beforeObjects[word] = before;\n"
        << "            const MaskWord after = (before & ~objectClearMask[word]) | objectSetMask[word];\n"
        << "            if (before != after) fastObjects[word] = after;\n"
        << "        }\n"
        << "        compact_turn_note_replacement_object_cell_written_" << suffix << "(dimensions, scratch, tileIndex, beforeObjects, fastObjects);\n"
        << "    }\n"
        << "    if (firstChangedMovementWord >= 0) {\n"
        << "        MaskWord beforeMovements[compact_turn_movement_stride_" << suffix << "] = {};\n"
        << "        for (int32_t word = 0; word < firstChangedMovementWord; ++word) beforeMovements[word] = fastMovements[word];\n"
        << "        for (int32_t word = firstChangedMovementWord; word < compact_turn_movement_stride_" << suffix << "; ++word) {\n"
        << "            const MaskWord before = fastMovements[word];\n"
        << "            beforeMovements[word] = before;\n"
        << "            const MaskWord clear = movementClearMask[word] | movementLayerMask[word];\n"
        << "            const MaskWord after = (before & ~clear) | movementSetMask[word];\n"
        << "            if (before != after) fastMovements[word] = after;\n"
        << "        }\n"
        << "        compact_turn_note_movement_cell_written_" << suffix << "(dimensions, scratch, tileIndex, beforeMovements, fastMovements);\n"
        << "    }\n"
        << "    if (firstChangedObjectWord >= 0 || firstChangedMovementWord >= 0) {\n"
        << "        compact_turn_count_simple_replacement_fast_path_change_" << suffix << "();\n"
        << "        compact_turn_count_replacements_applied_" << suffix << "();\n"
        << "        return true;\n"
        << "    }\n"
        << "    compact_turn_count_simple_replacement_fast_path_noop_" << suffix << "();\n"
        << "    return false;\n"
        << "}\n\n";

    out << "void compact_turn_clear_movement_masks_" << suffix << "(Scratch& scratch) {\n"
        << "    scratch.movementCellIndexDirty = true;\n"
        << "    if constexpr (compact_turn_needs_movement_row_masks_" << suffix << ") std::fill(scratch.rowMovementMasks.begin(), scratch.rowMovementMasks.end(), 0);\n"
        << "    if constexpr (compact_turn_needs_movement_column_masks_" << suffix << ") std::fill(scratch.columnMovementMasks.begin(), scratch.columnMovementMasks.end(), 0);\n"
        << "    if constexpr (compact_turn_needs_movement_board_mask_" << suffix << ") std::fill(scratch.boardMovementMask.begin(), scratch.boardMovementMask.end(), 0);\n"
        << "    std::fill(scratch.dirtyMovementRows.begin(), scratch.dirtyMovementRows.end(), 0);\n"
        << "    std::fill(scratch.dirtyMovementColumns.begin(), scratch.dirtyMovementColumns.end(), 0);\n"
        << "    scratch.dirtyMovementBoard = false;\n"
        << "    const bool objectDirty = scratch.dirtyObjectBoard\n"
        << "        || std::any_of(scratch.dirtyObjectRows.begin(), scratch.dirtyObjectRows.end(), [](uint8_t value) { return value != 0; })\n"
        << "        || std::any_of(scratch.dirtyObjectColumns.begin(), scratch.dirtyObjectColumns.end(), [](uint8_t value) { return value != 0; });\n"
        << "    if (!objectDirty) scratch.anyMasksDirty = false;\n"
        << "}\n\n";

    out << "bool compact_turn_board_has_required_masks_" << suffix << "(\n"
        << "    const Scratch& scratch,\n"
        << "    const MaskWord* requiredObjects,\n"
        << "    const MaskWord* requiredMovements\n"
        << ") {\n"
        << "    if constexpr (compact_turn_needs_object_board_mask_" << suffix << ") {\n"
        << "        for (int32_t word = 0; word < compact_turn_object_stride_" << suffix << "; ++word) {\n"
        << "            if ((scratch.boardMask[static_cast<size_t>(word)] & requiredObjects[word]) != requiredObjects[word]) return false;\n"
        << "        }\n"
        << "    }\n"
        << "    if constexpr (compact_turn_needs_movement_board_mask_" << suffix << ") {\n"
        << "        for (int32_t word = 0; word < compact_turn_movement_stride_" << suffix << "; ++word) {\n"
        << "            if ((scratch.boardMovementMask[static_cast<size_t>(word)] & requiredMovements[word]) != requiredMovements[word]) return false;\n"
        << "        }\n"
        << "    }\n"
        << "    return true;\n"
        << "}\n\n";

    out << "bool compact_turn_line_has_required_masks_" << suffix << "(\n"
        << "    LevelDimensions dimensions,\n"
        << "    const PersistentLevelState& levelState,\n"
        << "    const Scratch& scratch,\n"
        << "    bool horizontalScan,\n"
        << "    int32_t primary,\n"
        << "    const MaskWord* requiredObjects,\n"
        << "    const MaskWord* requiredMovements,\n"
        << "    const MaskWord* missingObjects,\n"
        << "    const MaskWord* missingMovements,\n"
        << "    const MaskWord* const* anyObjectMasks,\n"
        << "    size_t anyObjectMaskCount,\n"
        << "    const MaskWord* const* anyMovementMasks,\n"
        << "    size_t anyMovementMaskCount\n"
        << ") {\n"
        << "    (void)dimensions;\n"
        << "    (void)levelState;\n"
        << "    const MaskWord* lineObjects = nullptr;\n"
        << "    if ((horizontalScan && compact_turn_needs_object_row_masks_" << suffix << ")\n"
        << "        || (!horizontalScan && compact_turn_needs_object_column_masks_" << suffix << ")) {\n"
        << "        lineObjects = horizontalScan\n"
        << "            ? scratch.rowMasks.data() + static_cast<size_t>(primary * compact_turn_object_stride_" << suffix << ")\n"
        << "            : scratch.columnMasks.data() + static_cast<size_t>(primary * compact_turn_object_stride_" << suffix << ");\n"
        << "        for (int32_t word = 0; word < compact_turn_object_stride_" << suffix << "; ++word) {\n"
        << "            if ((lineObjects[word] & requiredObjects[word]) != requiredObjects[word]) return false;\n"
        << "        }\n"
        << "    }\n"
        << "    for (size_t anyIndex = 0; anyIndex < anyObjectMaskCount; ++anyIndex) {\n"
        << "        if (lineObjects == nullptr) return false;\n"
        << "        bool found = false;\n"
        << "        for (int32_t word = 0; word < compact_turn_object_stride_" << suffix << "; ++word) {\n"
        << "            if ((lineObjects[word] & anyObjectMasks[anyIndex][word]) != 0) { found = true; break; }\n"
        << "        }\n"
        << "        if (!found) return false;\n"
        << "    }\n"
        << "    if ((horizontalScan && compact_turn_needs_object_row_all_masks_" << suffix << ")\n"
        << "        || (!horizontalScan && compact_turn_needs_object_column_all_masks_" << suffix << ")) {\n"
        << "        const MaskWord* lineAllObjects = horizontalScan\n"
        << "            ? scratch.rowAllMasks.data() + static_cast<size_t>(primary * compact_turn_object_stride_" << suffix << ")\n"
        << "            : scratch.columnAllMasks.data() + static_cast<size_t>(primary * compact_turn_object_stride_" << suffix << ");\n"
        << "        for (int32_t word = 0; word < compact_turn_object_stride_" << suffix << "; ++word) {\n"
        << "            if ((lineAllObjects[word] & missingObjects[word]) != 0) return false;\n"
        << "        }\n"
        << "    }\n"
        << "    const MaskWord* lineMovements = nullptr;\n"
        << "    if ((horizontalScan && compact_turn_needs_movement_row_masks_" << suffix << ")\n"
        << "        || (!horizontalScan && compact_turn_needs_movement_column_masks_" << suffix << ")) {\n"
        << "        lineMovements = horizontalScan\n"
        << "            ? scratch.rowMovementMasks.data() + static_cast<size_t>(primary * compact_turn_movement_stride_" << suffix << ")\n"
        << "            : scratch.columnMovementMasks.data() + static_cast<size_t>(primary * compact_turn_movement_stride_" << suffix << ");\n"
        << "        for (int32_t word = 0; word < compact_turn_movement_stride_" << suffix << "; ++word) {\n"
        << "            if ((lineMovements[word] & requiredMovements[word]) != requiredMovements[word]) return false;\n"
        << "        }\n"
        << "    }\n"
        << "    for (size_t anyIndex = 0; anyIndex < anyMovementMaskCount; ++anyIndex) {\n"
        << "        if (lineMovements == nullptr) return false;\n"
        << "        bool found = false;\n"
        << "        for (int32_t word = 0; word < compact_turn_movement_stride_" << suffix << "; ++word) {\n"
        << "            if ((lineMovements[word] & anyMovementMasks[anyIndex][word]) != 0) { found = true; break; }\n"
        << "        }\n"
        << "        if (!found) return false;\n"
        << "    }\n"
        << "    if ((horizontalScan && compact_turn_needs_movement_row_all_masks_" << suffix << ")\n"
        << "        || (!horizontalScan && compact_turn_needs_movement_column_all_masks_" << suffix << ")) {\n"
        << "        const MaskWord* lineAllMovements = horizontalScan\n"
        << "            ? scratch.rowAllMovementMasks.data() + static_cast<size_t>(primary * compact_turn_movement_stride_" << suffix << ")\n"
        << "            : scratch.columnAllMovementMasks.data() + static_cast<size_t>(primary * compact_turn_movement_stride_" << suffix << ");\n"
        << "        for (int32_t word = 0; word < compact_turn_movement_stride_" << suffix << "; ++word) {\n"
        << "            if ((lineAllMovements[word] & missingMovements[word]) != 0) return false;\n"
        << "        }\n"
        << "    }\n"
        << "    return true;\n"
        << "}\n\n";

    out << "MaskWord* compact_turn_cell_rigid_group_index_" << suffix << "(Scratch& scratch, int32_t tileIndex) {\n"
        << "    return scratch.rigidGroupIndexMasks.data() + static_cast<size_t>(tileIndex) * static_cast<size_t>(compact_turn_movement_stride_" << suffix << ");\n"
        << "}\n\n";

    out << "const MaskWord* compact_turn_cell_rigid_group_index_" << suffix << "(const Scratch& scratch, int32_t tileIndex) {\n"
        << "    return scratch.rigidGroupIndexMasks.data() + static_cast<size_t>(tileIndex) * static_cast<size_t>(compact_turn_movement_stride_" << suffix << ");\n"
        << "}\n\n";

    out << "MaskWord* compact_turn_cell_rigid_movement_applied_" << suffix << "(Scratch& scratch, int32_t tileIndex) {\n"
        << "    return scratch.rigidMovementAppliedMasks.data() + static_cast<size_t>(tileIndex) * static_cast<size_t>(compact_turn_movement_stride_" << suffix << ");\n"
        << "}\n\n";

    out << "const MaskWord* compact_turn_cell_rigid_movement_applied_" << suffix << "(const Scratch& scratch, int32_t tileIndex) {\n"
        << "    return scratch.rigidMovementAppliedMasks.data() + static_cast<size_t>(tileIndex) * static_cast<size_t>(compact_turn_movement_stride_" << suffix << ");\n"
        << "}\n\n";

    out << "int32_t compact_turn_layer_bits_" << suffix << "(const MaskWord* cell, int32_t layer) {\n"
        << "    if (layer < 0 || layer >= compact_turn_layer_count_" << suffix << ") return 0;\n"
        << "    const uint32_t shiftIndex = static_cast<uint32_t>(layer) * 5U;\n"
        << "    const uint32_t word = shiftIndex >> kMaskWordShift;\n"
        << "    if (word >= static_cast<uint32_t>(compact_turn_movement_stride_" << suffix << ")) return 0;\n"
        << "    const uint32_t bit = shiftIndex & kMaskWordBitMask;\n"
        << "    MaskWordUnsigned result = static_cast<MaskWordUnsigned>(cell[word]) >> bit;\n"
        << "    if (bit > kMaskWordBits - 5U && word + 1U < static_cast<uint32_t>(compact_turn_movement_stride_" << suffix << ")) {\n"
        << "        result |= static_cast<MaskWordUnsigned>(cell[word + 1U]) << (kMaskWordBits - bit);\n"
        << "    }\n"
        << "    return static_cast<int32_t>(result & MaskWordUnsigned{0x1f});\n"
        << "}\n\n";

    out << "void compact_turn_set_layer_bits_" << suffix << "(MaskWord* cell, int32_t layer, int32_t value) {\n"
        << "    if (layer < 0 || layer >= compact_turn_layer_count_" << suffix << ") return;\n"
        << "    const uint32_t shiftIndex = static_cast<uint32_t>(layer) * 5U;\n"
        << "    const uint32_t word = shiftIndex >> kMaskWordShift;\n"
        << "    if (word >= static_cast<uint32_t>(compact_turn_movement_stride_" << suffix << ")) return;\n"
        << "    const uint32_t bit = shiftIndex & kMaskWordBitMask;\n"
        << "    const MaskWordUnsigned packed = MaskWordUnsigned{static_cast<uint32_t>(value) & 0x1fU};\n"
        << "    const MaskWordUnsigned lowMask = MaskWordUnsigned{0x1f} << bit;\n"
        << "    cell[word] = static_cast<MaskWord>((static_cast<MaskWordUnsigned>(cell[word]) & ~lowMask) | (packed << bit));\n"
        << "    if (bit > kMaskWordBits - 5U && word + 1U < static_cast<uint32_t>(compact_turn_movement_stride_" << suffix << ")) {\n"
        << "        const uint32_t highShift = kMaskWordBits - bit;\n"
        << "        const MaskWordUnsigned highMask = MaskWordUnsigned{0x1f} >> highShift;\n"
        << "        cell[word + 1U] = static_cast<MaskWord>((static_cast<MaskWordUnsigned>(cell[word + 1U]) & ~highMask) | (packed >> highShift));\n"
        << "    }\n"
        << "}\n\n";

    out << "bool compact_turn_cell_has_object_" << suffix << "(const PersistentLevelState& levelState, int32_t tileIndex, int32_t objectId) {\n"
        << "    if (objectId < 0 || objectId >= compact_turn_object_count_" << suffix << ") return false;\n"
        << "    const uint32_t bit = static_cast<uint32_t>(objectId);\n"
        << "    const uint32_t word = maskWordIndex(bit);\n"
        << "    if (word >= static_cast<uint32_t>(compact_turn_object_stride_" << suffix << ")) return false;\n"
        << "    return (compact_turn_cell_objects_" << suffix << "(levelState, tileIndex)[word] & maskBit(bit)) != 0;\n"
        << "}\n\n";

    out << "bool compact_turn_cell_any_objects_" << suffix << "(const PersistentLevelState& levelState, int32_t tileIndex, const MaskWord* mask) {\n"
        << "    const MaskWord* cell = compact_turn_cell_objects_" << suffix << "(levelState, tileIndex);\n"
        << "    for (int32_t word = 0; word < compact_turn_object_stride_" << suffix << "; ++word) {\n"
        << "        if ((cell[word] & mask[word]) != 0) return true;\n"
        << "    }\n"
        << "    return false;\n"
        << "}\n\n";

    out << "bool compact_turn_cell_has_all_objects_" << suffix << "(const PersistentLevelState& levelState, int32_t tileIndex, const MaskWord* mask) {\n"
        << "    const MaskWord* cell = compact_turn_cell_objects_" << suffix << "(levelState, tileIndex);\n"
        << "    for (int32_t word = 0; word < compact_turn_object_stride_" << suffix << "; ++word) {\n"
        << "        if ((cell[word] & mask[word]) != mask[word]) return false;\n"
        << "    }\n"
        << "    return true;\n"
        << "}\n\n";

    out << "bool compact_turn_matches_filter_" << suffix << "(const MaskWord* filter, bool aggregate, const MaskWord* cell) {\n"
        << "    if (aggregate) {\n"
        << "        for (int32_t word = 0; word < compact_turn_object_stride_" << suffix << "; ++word) {\n"
        << "            if ((cell[word] & filter[word]) != filter[word]) return false;\n"
        << "        }\n"
        << "        return true;\n"
        << "    }\n"
        << "    for (int32_t word = 0; word < compact_turn_object_stride_" << suffix << "; ++word) {\n"
        << "        if ((cell[word] & filter[word]) != 0) return true;\n"
        << "    }\n"
        << "    return false;\n"
        << "}\n\n";

    out << "bool compact_turn_evaluate_win_condition_" << suffix << "(LevelDimensions dimensions, const PersistentLevelState& levelState, int32_t quantifier, const MaskWord* filter1, bool aggr1, const MaskWord* filter2, bool aggr2) {\n"
        << "    const int32_t tileCount = compact_turn_tile_count_" << suffix << "(dimensions);\n"
        << "    switch (quantifier) {\n"
        << "        case -1:\n"
        << "            for (int32_t tileIndex = 0; tileIndex < tileCount; ++tileIndex) {\n"
        << "                const MaskWord* cell = compact_turn_cell_objects_" << suffix << "(levelState, tileIndex);\n"
        << "                if (compact_turn_matches_filter_" << suffix << "(filter1, aggr1, cell) && compact_turn_matches_filter_" << suffix << "(filter2, aggr2, cell)) return false;\n"
        << "            }\n"
        << "            return true;\n"
        << "        case 0:\n"
        << "            for (int32_t tileIndex = 0; tileIndex < tileCount; ++tileIndex) {\n"
        << "                const MaskWord* cell = compact_turn_cell_objects_" << suffix << "(levelState, tileIndex);\n"
        << "                if (compact_turn_matches_filter_" << suffix << "(filter1, aggr1, cell) && compact_turn_matches_filter_" << suffix << "(filter2, aggr2, cell)) return true;\n"
        << "            }\n"
        << "            return false;\n"
        << "        case 1:\n"
        << "            for (int32_t tileIndex = 0; tileIndex < tileCount; ++tileIndex) {\n"
        << "                const MaskWord* cell = compact_turn_cell_objects_" << suffix << "(levelState, tileIndex);\n"
        << "                if (compact_turn_matches_filter_" << suffix << "(filter1, aggr1, cell) && !compact_turn_matches_filter_" << suffix << "(filter2, aggr2, cell)) return false;\n"
        << "            }\n"
        << "            return true;\n"
        << "        default:\n"
        << "            return false;\n"
        << "    }\n"
        << "}\n\n";

    out << "bool compact_turn_evaluate_win_" << suffix << "(LevelDimensions dimensions, const PersistentLevelState& levelState) {\n";
    if (game.winConditions.empty()) {
        out << "    (void)dimensions;\n"
            << "    (void)levelState;\n"
            << "    return false;\n";
    } else {
        for (size_t conditionIndex = 0; conditionIndex < game.winConditions.size(); ++conditionIndex) {
            const WinCondition& condition = game.winConditions[conditionIndex];
            out << "    if (!compact_turn_evaluate_win_condition_" << suffix << "(\n"
                << "            dimensions,\n"
                << "            levelState,\n"
                << "            " << condition.quantifier << ",\n"
                << "            compact_turn_win_filter1_" << suffix << "_" << conditionIndex << ",\n"
                << "            " << (condition.aggr1 ? "true" : "false") << ",\n"
                << "            compact_turn_win_filter2_" << suffix << "_" << conditionIndex << ",\n"
                << "            " << (condition.aggr2 ? "true" : "false") << ")) {\n"
                << "        return false;\n"
                << "    }\n";
        }
        out << "    return true;\n";
    }
    out << "}\n\n";

    out << "const MaskWord* compact_turn_layer_mask_" << suffix << "(int32_t layer) {\n"
        << "    switch (layer) {\n";
    for (int32_t layer = 0; layer < game.layerCount; ++layer) {
        out << "        case " << layer << ": return compact_turn_layer_mask_" << suffix << "_" << layer << ";\n";
    }
    out << "        default: return nullptr;\n"
        << "    }\n"
        << "}\n\n";

    out << "bool compact_turn_mask_overlaps_" << suffix << "(const MaskWord* left, const MaskWord* right, int32_t wordCount) {\n"
        << "    if (left == nullptr || right == nullptr) return false;\n"
        << "    for (int32_t word = 0; word < wordCount; ++word) {\n"
        << "        if ((left[word] & right[word]) != 0) return true;\n"
        << "    }\n"
        << "    return false;\n"
        << "}\n\n";

    out << "bool compact_turn_layer_coupled_movement_matches_" << suffix << "(\n"
        << "    const MaskWord* oldObjects,\n"
        << "    const MaskWord* oldMovements,\n"
        << "    const CompactTurnLayerCoupledMovementTerm_" << suffix << "& term\n"
        << ") {\n"
        << "    if (!compact_turn_mask_overlaps_" << suffix << "(oldObjects, term.objectMask, compact_turn_object_stride_" << suffix << ")) return false;\n"
        << "    const int32_t movementField = compact_turn_layer_bits_" << suffix << "(oldMovements, term.layerIndex);\n"
        << "    const int32_t anyField = compact_turn_layer_bits_" << suffix << "(term.movementsAny, term.layerIndex);\n"
        << "    const int32_t presentField = compact_turn_layer_bits_" << suffix << "(term.movementsPresent, term.layerIndex);\n"
        << "    const int32_t missingField = compact_turn_layer_bits_" << suffix << "(term.movementsMissing, term.layerIndex);\n"
        << "    if (anyField != 0 && (movementField & anyField) == 0) return false;\n"
        << "    if (presentField != 0 && (movementField & presentField) != presentField) return false;\n"
        << "    if (missingField != 0 && (movementField & missingField) != 0) return false;\n"
        << "    return true;\n"
        << "}\n\n";

    out << "bool compact_turn_pattern_matches_" << suffix << "(\n"
        << "    const PersistentLevelState& levelState,\n"
        << "    const Scratch& scratch,\n"
        << "    int32_t tileIndex,\n"
        << "    const MaskWord* objectsPresent,\n"
        << "    const MaskWord* objectsMissing,\n"
        << "    const MaskWord* movementsPresent,\n"
        << "    const MaskWord* movementsMissing,\n"
        << "    const MaskWord* const* anyObjectMasks,\n"
        << "    size_t anyObjectMaskCount,\n"
        << "    const MaskWord* const* anyMovementMasks,\n"
        << "    size_t anyMovementMaskCount,\n"
        << "    const CompactTurnLayerCoupledMovementTerm_" << suffix << "* layerCoupledMovementTerms,\n"
        << "    const int32_t* layerCoupledMovementGroupFirsts,\n"
        << "    const int32_t* layerCoupledMovementGroupCounts,\n"
        << "    size_t layerCoupledMovementGroupCount\n"
        << ") {\n"
        << "    const MaskWord* objects = compact_turn_cell_objects_" << suffix << "(levelState, tileIndex);\n"
        << "    const MaskWord* movements = compact_turn_cell_movements_" << suffix << "(scratch, tileIndex);\n"
        << "    for (int32_t word = 0; word < compact_turn_object_stride_" << suffix << "; ++word) {\n"
        << "        if ((objects[word] & objectsPresent[word]) != objectsPresent[word]) return false;\n"
        << "        if ((objects[word] & objectsMissing[word]) != 0) return false;\n"
        << "    }\n"
        << "    for (size_t anyIndex = 0; anyIndex < anyObjectMaskCount; ++anyIndex) {\n"
        << "        if (!compact_turn_cell_any_objects_" << suffix << "(levelState, tileIndex, anyObjectMasks[anyIndex])) return false;\n"
        << "    }\n"
        << "    for (int32_t word = 0; word < compact_turn_movement_stride_" << suffix << "; ++word) {\n"
        << "        if ((movements[word] & movementsPresent[word]) != movementsPresent[word]) return false;\n"
        << "        if ((movements[word] & movementsMissing[word]) != 0) return false;\n"
        << "    }\n"
        << "    for (size_t anyIndex = 0; anyIndex < anyMovementMaskCount; ++anyIndex) {\n"
        << "        if (!compact_turn_mask_overlaps_" << suffix << "(movements, anyMovementMasks[anyIndex], compact_turn_movement_stride_" << suffix << ")) return false;\n"
        << "    }\n"
        << "    for (size_t groupIndex = 0; groupIndex < layerCoupledMovementGroupCount; ++groupIndex) {\n"
        << "        bool matchedGroup = false;\n"
        << "        const int32_t first = layerCoupledMovementGroupFirsts[groupIndex];\n"
        << "        const int32_t count = layerCoupledMovementGroupCounts[groupIndex];\n"
        << "        for (int32_t offset = 0; offset < count; ++offset) {\n"
        << "            if (compact_turn_layer_coupled_movement_matches_" << suffix << "(objects, movements, layerCoupledMovementTerms[first + offset])) {\n"
        << "                matchedGroup = true;\n"
        << "                break;\n"
        << "            }\n"
        << "        }\n"
        << "        if (!matchedGroup) return false;\n"
        << "    }\n"
        << "    return true;\n"
        << "}\n\n";

    out << "bool compact_turn_pattern_apply_" << suffix << "(\n"
        << "    LevelDimensions dimensions,\n"
        << "    PersistentLevelState& levelState,\n"
        << "    Scratch& scratch,\n"
        << "    int32_t tileIndex,\n"
        << "    int32_t rigidGroupIndex,\n"
        << "    const MaskWord* objectsClearMask,\n"
        << "    const MaskWord* objectsSetMask,\n"
        << "    const MaskWord* movementsClearMask,\n"
        << "    const MaskWord* movementsSetMask,\n"
        << "    const MaskWord* movementsLayerMask,\n"
        << "    const int32_t* randomEntityChoices,\n"
        << "    size_t randomEntityChoiceCount,\n"
        << "    const int32_t* randomDirLayers,\n"
        << "    size_t randomDirLayerCount,\n"
        << "    const CompactTurnLayerCoupledMovementTerm_" << suffix << "* layerCoupledMovementTerms,\n"
        << "    size_t layerCoupledMovementTermCount,\n"
        << "    const CompactTurnInferredAggregateTerm_" << suffix << "* inferredAggregateTerms,\n"
        << "    size_t inferredAggregateTermCount,\n"
        << "    const int32_t* aggregateCaptures,\n"
        << "    size_t aggregateCaptureCount\n"
        << ") {\n"
        << "    compact_turn_count_replacements_attempted_" << suffix << "();\n"
        << "    bool changed = false;\n"
        << "    bool objectsChanged = false;\n"
        << "    bool movementsChanged = false;\n"
        << "    bool rigidChange = false;\n"
        << "    MaskWord objectsClear[compact_turn_object_stride_" << suffix << "] = {};\n"
        << "    MaskWord objectsSet[compact_turn_object_stride_" << suffix << "] = {};\n"
        << "    MaskWord movementsClear[compact_turn_movement_stride_" << suffix << "] = {};\n"
        << "    MaskWord movementsSet[compact_turn_movement_stride_" << suffix << "] = {};\n"
        << "    for (int32_t word = 0; word < compact_turn_object_stride_" << suffix << "; ++word) {\n"
        << "        objectsClear[word] = objectsClearMask[word];\n"
        << "        objectsSet[word] = objectsSetMask[word];\n"
        << "    }\n"
        << "    for (int32_t word = 0; word < compact_turn_movement_stride_" << suffix << "; ++word) {\n"
        << "        movementsClear[word] = movementsClearMask[word];\n"
        << "        movementsSet[word] = movementsSetMask[word];\n"
        << "    }\n"
        << "    if (randomEntityChoiceCount > 0) {\n"
        << "        const double randomValue = compact_turn_random_uniform_" << suffix << "(levelState.rng);\n"
        << "        const size_t chosenIndex = std::min(randomEntityChoiceCount - 1, static_cast<size_t>(randomValue * static_cast<double>(randomEntityChoiceCount)));\n"
        << "        const int32_t objectId = randomEntityChoices[chosenIndex];\n"
        << "        if (objectId >= 0 && objectId < compact_turn_object_count_" << suffix << ") {\n"
        << "            const uint32_t objectBit = static_cast<uint32_t>(objectId);\n"
        << "            objectsSet[maskWordIndex(objectBit)] |= maskBit(objectBit);\n"
        << "            const int32_t layer = compact_turn_object_layer_" << suffix << "[objectId];\n"
        << "            const MaskWord* layerMask = compact_turn_layer_mask_" << suffix << "(layer);\n"
        << "            if (layerMask != nullptr) {\n"
        << "                for (int32_t word = 0; word < compact_turn_object_stride_" << suffix << "; ++word) objectsClear[word] |= layerMask[word];\n"
        << "                compact_turn_set_layer_bits_" << suffix << "(movementsClear, layer, 0x1f);\n"
        << "            }\n"
        << "        }\n"
        << "    }\n"
        << "    for (size_t randomLayerIndex = 0; randomLayerIndex < randomDirLayerCount; ++randomLayerIndex) {\n"
        << "        const int32_t layer = randomDirLayers[randomLayerIndex];\n"
        << "        const double randomValue = compact_turn_random_uniform_" << suffix << "(levelState.rng);\n"
        << "        const int32_t randomDir = std::min(int32_t{3}, static_cast<int32_t>(randomValue * 4.0));\n"
        << "        const int32_t beforeBits = compact_turn_layer_bits_" << suffix << "(movementsSet, layer);\n"
        << "        compact_turn_set_layer_bits_" << suffix << "(movementsSet, layer, beforeBits | (1 << randomDir));\n"
        << "    }\n"
        << "    for (int32_t word = 0; word < compact_turn_movement_stride_" << suffix << "; ++word) {\n"
        << "        movementsClear[word] |= movementsLayerMask[word];\n"
        << "    }\n"
        << "    const MaskWord* oldObjects = compact_turn_cell_objects_" << suffix << "(levelState, tileIndex);\n"
        << "    const MaskWord* oldMovements = compact_turn_cell_movements_" << suffix << "(scratch, tileIndex);\n"
        << "    for (size_t termIndex = 0; termIndex < layerCoupledMovementTermCount; ++termIndex) {\n"
        << "        const CompactTurnLayerCoupledMovementTerm_" << suffix << "& term = layerCoupledMovementTerms[termIndex];\n"
        << "        if (!compact_turn_layer_coupled_movement_matches_" << suffix << "(oldObjects, oldMovements, term)) continue;\n"
        << "        compact_turn_set_layer_bits_" << suffix << "(movementsClear, term.layerIndex, 0x1f);\n"
        << "        int32_t replacementMovementMask = term.replacementMovementMask;\n"
        << "        if (term.aggregateCaptureIndex >= 0) {\n"
        << "            replacementMovementMask = 0;\n"
        << "            const size_t captureIndex = static_cast<size_t>(term.aggregateCaptureIndex);\n"
        << "            if (aggregateCaptures != nullptr && captureIndex < aggregateCaptureCount) {\n"
        << "                replacementMovementMask = aggregateCaptures[captureIndex] & 0x1f;\n"
        << "            }\n"
        << "        }\n"
        << "        if (replacementMovementMask != 0) compact_turn_set_layer_bits_" << suffix << "(movementsSet, term.layerIndex, replacementMovementMask);\n"
        << "    }\n"
        << "    for (size_t termIndex = 0; termIndex < inferredAggregateTermCount; ++termIndex) {\n"
        << "        const CompactTurnInferredAggregateTerm_" << suffix << "& term = inferredAggregateTerms[termIndex];\n"
        << "        if (term.layerIndex < 0 || term.aggregateCaptureIndex < 0) continue;\n"
        << "        const size_t captureIndex = static_cast<size_t>(term.aggregateCaptureIndex);\n"
        << "        if (aggregateCaptures == nullptr || captureIndex >= aggregateCaptureCount) continue;\n"
        << "        const int32_t captured = aggregateCaptures[captureIndex] & 0x1f;\n"
        << "        if (captured != 0) compact_turn_set_layer_bits_" << suffix << "(movementsSet, term.layerIndex, captured);\n"
        << "    }\n"
        << "    MaskWord* objects = compact_turn_cell_objects_" << suffix << "(levelState, tileIndex);\n"
        << "    MaskWord beforeObjects[compact_turn_object_stride_" << suffix << "] = {};\n"
        << "    for (int32_t word = 0; word < compact_turn_object_stride_" << suffix << "; ++word) {\n"
        << "        const MaskWord before = objects[word];\n"
        << "        beforeObjects[word] = before;\n"
        << "        const MaskWord after = (before & ~objectsClear[word]) | objectsSet[word];\n"
        << "        objects[word] = after;\n"
        << "        objectsChanged = objectsChanged || before != after;\n"
        << "    }\n"
        << "    MaskWord* movements = compact_turn_cell_movements_" << suffix << "(scratch, tileIndex);\n"
        << "    MaskWord beforeMovements[compact_turn_movement_stride_" << suffix << "] = {};\n"
        << "    for (int32_t word = 0; word < compact_turn_movement_stride_" << suffix << "; ++word) {\n"
        << "        const MaskWord before = movements[word];\n"
        << "        beforeMovements[word] = before;\n"
        << "        const MaskWord after = (before & ~movementsClear[word]) | movementsSet[word];\n"
        << "        movements[word] = after;\n"
        << "        movementsChanged = movementsChanged || before != after;\n"
        << "    }\n"
        << "    if (objectsChanged) compact_turn_note_replacement_object_cell_written_" << suffix << "(dimensions, scratch, tileIndex, beforeObjects, objects);\n"
        << "    if (movementsChanged) compact_turn_note_movement_cell_written_" << suffix << "(dimensions, scratch, tileIndex, beforeMovements, movements);\n"
        << "    if (rigidGroupIndex > 0) {\n"
        << "        MaskWord rigidMask[compact_turn_movement_stride_" << suffix << "] = {};\n"
        << "        for (int32_t layer = 0; layer < compact_turn_layer_count_" << suffix << "; ++layer) {\n"
        << "            if (compact_turn_layer_bits_" << suffix << "(movementsLayerMask, layer) != 0) {\n"
        << "                compact_turn_set_layer_bits_" << suffix << "(rigidMask, layer, rigidGroupIndex);\n"
        << "            }\n"
        << "        }\n"
        << "        MaskWord* rigidGroupMask = compact_turn_cell_rigid_group_index_" << suffix << "(scratch, tileIndex);\n"
        << "        MaskWord* rigidAppliedMask = compact_turn_cell_rigid_movement_applied_" << suffix << "(scratch, tileIndex);\n"
        << "        bool rigidGroupAlreadySet = true;\n"
        << "        bool rigidMovementAlreadySet = true;\n"
        << "        for (int32_t word = 0; word < compact_turn_movement_stride_" << suffix << "; ++word) {\n"
        << "            if ((rigidGroupMask[word] & rigidMask[word]) != rigidMask[word]) rigidGroupAlreadySet = false;\n"
        << "            if ((rigidAppliedMask[word] & movementsLayerMask[word]) != movementsLayerMask[word]) rigidMovementAlreadySet = false;\n"
        << "        }\n"
        << "        if (!rigidGroupAlreadySet && !rigidMovementAlreadySet) {\n"
        << "            for (int32_t word = 0; word < compact_turn_movement_stride_" << suffix << "; ++word) {\n"
        << "                rigidGroupMask[word] |= rigidMask[word];\n"
        << "                rigidAppliedMask[word] |= movementsLayerMask[word];\n"
        << "            }\n"
        << "            rigidChange = true;\n"
        << "        }\n"
        << "    }\n"
        << "    changed = objectsChanged || movementsChanged;\n"
        << "    changed = changed || rigidChange;\n"
        << "    if (changed) compact_turn_count_replacements_applied_" << suffix << "();\n"
        << "    return changed;\n"
        << "}\n\n";

    out << "bool compact_turn_cell_has_layer_" << suffix << "(const PersistentLevelState& levelState, int32_t tileIndex, int32_t layer) {\n"
        << "    const MaskWord* layerMask = compact_turn_layer_mask_" << suffix << "(layer);\n"
        << "    return layerMask != nullptr && compact_turn_cell_any_objects_" << suffix << "(levelState, tileIndex, layerMask);\n"
        << "}\n\n";

    out << "bool compact_turn_cell_matches_player_" << suffix << "(const PersistentLevelState& levelState, int32_t tileIndex) {\n"
        << "    if (!compact_turn_has_player_mask_" << suffix << ") return false;\n"
        << "    if (compact_turn_player_mask_aggregate_" << suffix << ") {\n"
        << "        return compact_turn_cell_has_all_objects_" << suffix << "(levelState, tileIndex, compact_turn_player_mask_" << suffix << ");\n"
        << "    }\n"
        << "    return compact_turn_cell_any_objects_" << suffix << "(levelState, tileIndex, compact_turn_player_mask_" << suffix << ");\n"
        << "}\n\n";

    out << "bool compact_turn_cell_aggregate_player_has_layer_" << suffix << "(const PersistentLevelState& levelState, int32_t tileIndex, int32_t layer) {\n"
        << "    if (!compact_turn_player_mask_aggregate_" << suffix << ") return false;\n"
        << "    const MaskWord* layerMask = compact_turn_layer_mask_" << suffix << "(layer);\n"
        << "    if (layerMask == nullptr) return false;\n"
        << "    const MaskWord* cell = compact_turn_cell_objects_" << suffix << "(levelState, tileIndex);\n"
        << "    for (int32_t word = 0; word < compact_turn_object_stride_" << suffix << "; ++word) {\n"
        << "        if ((cell[word] & compact_turn_player_mask_" << suffix << "[word] & layerMask[word]) != 0) return true;\n"
        << "    }\n"
        << "    return false;\n"
        << "}\n\n";

    out << "std::vector<int32_t> compact_turn_collect_player_positions_" << suffix << "(LevelDimensions dimensions, const PersistentLevelState& levelState) {\n"
        << "    std::vector<int32_t> positions;\n"
        << "    const int32_t tileCount = compact_turn_tile_count_" << suffix << "(dimensions);\n"
        << "    for (int32_t tileIndex = 0; tileIndex < tileCount; ++tileIndex) {\n"
        << "        if (compact_turn_cell_matches_player_" << suffix << "(levelState, tileIndex)) {\n"
        << "            positions.push_back(tileIndex);\n"
        << "        }\n"
        << "    }\n"
        << "    return positions;\n"
        << "}\n\n";

    out << "bool compact_turn_any_start_player_moved_" << suffix << "(const PersistentLevelState& levelState, const std::vector<int32_t>& startPlayerPositions) {\n"
        << "    for (const int32_t tileIndex : startPlayerPositions) {\n"
        << "        if (!compact_turn_cell_matches_player_" << suffix << "(levelState, tileIndex)) return true;\n"
        << "    }\n"
        << "    return false;\n"
        << "}\n\n";

    out << "void compact_turn_set_cell_object_" << suffix << "(PersistentLevelState& levelState, int32_t tileIndex, int32_t objectId) {\n"
        << "    if (objectId < 0 || objectId >= compact_turn_object_count_" << suffix << ") return;\n"
        << "    const uint32_t bit = static_cast<uint32_t>(objectId);\n"
        << "    compact_turn_cell_objects_" << suffix << "(levelState, tileIndex)[maskWordIndex(bit)] |= maskBit(bit);\n"
        << "}\n\n";

    out << "void compact_turn_clear_cell_object_" << suffix << "(PersistentLevelState& levelState, int32_t tileIndex, int32_t objectId) {\n"
        << "    if (objectId < 0 || objectId >= compact_turn_object_count_" << suffix << ") return;\n"
        << "    const uint32_t bit = static_cast<uint32_t>(objectId);\n"
        << "    compact_turn_cell_objects_" << suffix << "(levelState, tileIndex)[maskWordIndex(bit)] &= ~maskBit(bit);\n"
        << "}\n\n";

    out << "bool compact_turn_seed_player_movements_" << suffix << "(LevelDimensions dimensions, PersistentLevelState& levelState, Scratch& scratch, int32_t directionMask) {\n"
        << "    if (directionMask == 0 || !compact_turn_has_player_mask_" << suffix << ") return false;\n"
        << "    bool changed = false;\n"
        << "    const int32_t tileCount = compact_turn_tile_count_" << suffix << "(dimensions);\n"
        << "    for (int32_t tileIndex = 0; tileIndex < tileCount; ++tileIndex) {\n"
        << "        if (!compact_turn_cell_matches_player_" << suffix << "(levelState, tileIndex)) continue;\n"
        << "        const MaskWord* cell = compact_turn_cell_objects_" << suffix << "(levelState, tileIndex);\n"
        << "        MaskWord* movementCell = compact_turn_cell_movements_" << suffix << "(scratch, tileIndex);\n"
        << "        MaskWord beforeMovements[compact_turn_movement_stride_" << suffix << "] = {};\n"
        << "        for (int32_t word = 0; word < compact_turn_movement_stride_" << suffix << "; ++word) beforeMovements[word] = movementCell[word];\n"
        << "        bool tileChanged = false;\n"
        << "        for (int32_t objectId = 0; objectId < compact_turn_object_count_" << suffix << "; ++objectId) {\n"
        << "            const uint32_t objectBit = static_cast<uint32_t>(objectId);\n"
        << "            const uint32_t word = maskWordIndex(objectBit);\n"
        << "            const MaskWord bit = maskBit(objectBit);\n"
        << "            if ((compact_turn_player_mask_" << suffix << "[word] & bit) == 0 || (cell[word] & bit) == 0) continue;\n"
        << "            const int32_t layer = compact_turn_object_layer_" << suffix << "[objectId];\n"
        << "            if (layer < 0) continue;\n"
        << "            const int32_t before = compact_turn_layer_bits_" << suffix << "(movementCell, layer);\n"
        << "            compact_turn_set_layer_bits_" << suffix << "(movementCell, layer, directionMask);\n"
        << "            const int32_t after = compact_turn_layer_bits_" << suffix << "(movementCell, layer);\n"
        << "            tileChanged = tileChanged || before != after;\n"
        << "        }\n"
        << "        if (tileChanged) {\n"
        << "            compact_turn_note_movement_cell_written_" << suffix << "(dimensions, scratch, tileIndex, beforeMovements, movementCell);\n"
        << "            changed = true;\n"
        << "        }\n"
        << "    }\n"
        << "    return changed;\n"
        << "}\n\n";

    out << "bool compact_turn_resolve_one_layer_movement_" << suffix << "(LevelDimensions dimensions, PersistentLevelState& levelState, Scratch& scratch, int32_t tileIndex, int32_t layer, int32_t directionMask) {\n"
        << "    int32_t targetIndex = 0;\n"
        << "    if (!compact_turn_cell_at_direction_" << suffix << "(dimensions, tileIndex, directionMask, 1, targetIndex)) return false;\n"
        << "    const MaskWord* layerMask = compact_turn_layer_mask_" << suffix << "(layer);\n"
        << "    if (layerMask == nullptr) return false;\n"
        << "    if (directionMask != 16 && compact_turn_cell_any_objects_" << suffix << "(levelState, targetIndex, layerMask)) return false;\n"
        << "    if (targetIndex == tileIndex) return true;\n"
        << "    MaskWord* source = compact_turn_cell_objects_" << suffix << "(levelState, tileIndex);\n"
        << "    MaskWord* target = compact_turn_cell_objects_" << suffix << "(levelState, targetIndex);\n"
        << "#if defined(PS_COMPACT_TURN_OUTPUT_HOOKS)\n"
        << "    compactTurnOutputMovementAudio(source, layer, directionMask);\n"
        << "#endif\n"
        << "    MaskWord sourceBeforeObjects[compact_turn_object_stride_" << suffix << "] = {};\n"
        << "    MaskWord targetBeforeObjects[compact_turn_object_stride_" << suffix << "] = {};\n"
        << "    for (int32_t word = 0; word < compact_turn_object_stride_" << suffix << "; ++word) {\n"
        << "        sourceBeforeObjects[word] = source[word];\n"
        << "        targetBeforeObjects[word] = target[word];\n"
        << "        const MaskWord moving = source[word] & layerMask[word];\n"
        << "        source[word] &= ~layerMask[word];\n"
        << "        target[word] |= moving;\n"
        << "    }\n"
        << "    compact_turn_note_object_cell_written_" << suffix << "(dimensions, scratch, tileIndex, sourceBeforeObjects, source);\n"
        << "    compact_turn_note_object_cell_written_" << suffix << "(dimensions, scratch, targetIndex, targetBeforeObjects, target);\n"
        << "    return true;\n"
        << "}\n\n";

    out << "CompactTurnMovementOutcome_" << suffix << " compact_turn_resolve_movements_" << suffix << "(LevelDimensions dimensions, PersistentLevelState& levelState, Scratch& scratch, std::vector<bool>* bannedGroups) {\n"
        << "    CompactTurnMovementOutcome_" << suffix << " outcome;\n"
        << "    bool movedAny = false;\n"
        << "    bool movedThisPass = true;\n"
        << "    const int32_t tileCount = compact_turn_tile_count_" << suffix << "(dimensions);\n"
        << "    while (movedThisPass) {\n"
        << "        movedThisPass = false;\n"
        << "        for (int32_t tileIndex = 0; tileIndex < tileCount; ++tileIndex) {\n"
        << "            bool changedTile = false;\n"
        << "            MaskWord* movementCell = compact_turn_cell_movements_" << suffix << "(scratch, tileIndex);\n"
        << "            if (!compact_turn_mask_overlaps_" << suffix << "(movementCell, movementCell, compact_turn_movement_stride_" << suffix << ")) continue;\n"
        << "            bool preventAggregateSplit = false;\n"
        << "            if (compact_turn_player_mask_aggregate_" << suffix << " && compact_turn_cell_matches_player_" << suffix << "(levelState, tileIndex)) {\n"
        << "                const size_t aggregatePlayerCount = compact_turn_collect_player_positions_" << suffix << "(dimensions, levelState).size();\n"
        << "                int32_t playerDirection = 0;\n"
        << "                bool playerHasMovement = false;\n"
        << "                for (int32_t layer = 0; layer < compact_turn_layer_count_" << suffix << "; ++layer) {\n"
        << "                    if (!compact_turn_cell_aggregate_player_has_layer_" << suffix << "(levelState, tileIndex, layer)) continue;\n"
        << "                    const int32_t layerMovement = compact_turn_layer_bits_" << suffix << "(movementCell, layer);\n"
        << "                    if (layerMovement == 0) continue;\n"
        << "                    playerHasMovement = true;\n"
        << "                    if (playerDirection == 0) {\n"
        << "                        playerDirection = layerMovement;\n"
        << "                    } else if (playerDirection != layerMovement) {\n"
        << "                        playerHasMovement = false;\n"
        << "                        break;\n"
        << "                    }\n"
        << "                }\n"
        << "                if (playerHasMovement && playerDirection != 0) {\n"
        << "                    int32_t targetIndex = 0;\n"
        << "                    if (!compact_turn_cell_at_direction_" << suffix << "(dimensions, tileIndex, playerDirection, 1, targetIndex)) {\n"
        << "                        preventAggregateSplit = true;\n"
        << "                    } else {\n"
        << "                        const MaskWord* targetMask = compact_turn_cell_objects_" << suffix << "(levelState, targetIndex);\n"
        << "                        bool canMoveAll = true;\n"
        << "                        bool blockedByPlayerConstituent = false;\n"
        << "                        for (int32_t layer = 0; layer < compact_turn_layer_count_" << suffix << "; ++layer) {\n"
        << "                            if (!compact_turn_cell_aggregate_player_has_layer_" << suffix << "(levelState, tileIndex, layer)) continue;\n"
        << "                            if (compact_turn_layer_bits_" << suffix << "(movementCell, layer) == 0) continue;\n"
        << "                            const MaskWord* layerMask = compact_turn_layer_mask_" << suffix << "(layer);\n"
        << "                            if (layerMask == nullptr) continue;\n"
        << "                            bool targetHasLayer = false;\n"
        << "                            for (int32_t word = 0; word < compact_turn_object_stride_" << suffix << "; ++word) {\n"
        << "                                if ((targetMask[word] & layerMask[word]) != 0) targetHasLayer = true;\n"
        << "                            }\n"
        << "                            if (playerDirection != 16 && targetHasLayer) {\n"
        << "                                canMoveAll = false;\n"
        << "                                for (int32_t word = 0; word < compact_turn_object_stride_" << suffix << "; ++word) {\n"
        << "                                    if ((targetMask[word] & compact_turn_player_mask_" << suffix << "[word]) != 0) blockedByPlayerConstituent = true;\n"
        << "                                }\n"
        << "                                break;\n"
        << "                            }\n"
        << "                        }\n"
        << "                        preventAggregateSplit = blockedByPlayerConstituent || aggregatePlayerCount <= 1;\n"
        << "                        if (canMoveAll) {\n"
        << "                            MaskWord* source = compact_turn_cell_objects_" << suffix << "(levelState, tileIndex);\n"
        << "                            MaskWord* target = compact_turn_cell_objects_" << suffix << "(levelState, targetIndex);\n"
        << "                            for (int32_t layer = 0; layer < compact_turn_layer_count_" << suffix << "; ++layer) {\n"
        << "                                if (!compact_turn_cell_aggregate_player_has_layer_" << suffix << "(levelState, tileIndex, layer)) continue;\n"
        << "                                if (compact_turn_layer_bits_" << suffix << "(movementCell, layer) == 0) continue;\n"
        << "                                const MaskWord* layerMask = compact_turn_layer_mask_" << suffix << "(layer);\n"
        << "                                if (layerMask == nullptr) continue;\n"
        << "                                for (int32_t word = 0; word < compact_turn_object_stride_" << suffix << "; ++word) {\n"
        << "                                    const MaskWord moving = source[word] & layerMask[word];\n"
        << "                                    source[word] &= ~layerMask[word];\n"
        << "                                    target[word] |= moving;\n"
        << "                                }\n"
        << "                                compact_turn_set_layer_bits_" << suffix << "(movementCell, layer, 0);\n"
        << "                            }\n"
        << "                            movedThisPass = true;\n"
        << "                            movedAny = true;\n"
        << "                            changedTile = true;\n"
        << "                        }\n"
        << "                    }\n"
        << "                }\n"
        << "            }\n"
        << "            for (int32_t layer = 0; layer < compact_turn_layer_count_" << suffix << "; ++layer) {\n"
        << "                const int32_t layerMovement = compact_turn_layer_bits_" << suffix << "(movementCell, layer);\n"
        << "                if (layerMovement == 0) continue;\n"
        << "                if (preventAggregateSplit && compact_turn_cell_matches_player_" << suffix << "(levelState, tileIndex) && compact_turn_cell_aggregate_player_has_layer_" << suffix << "(levelState, tileIndex, layer)) continue;\n"
        << "                if (compact_turn_resolve_one_layer_movement_" << suffix << "(dimensions, levelState, scratch, tileIndex, layer, layerMovement)) {\n"
        << "                    MaskWord beforeMovements[compact_turn_movement_stride_" << suffix << "] = {};\n"
        << "                    for (int32_t word = 0; word < compact_turn_movement_stride_" << suffix << "; ++word) beforeMovements[word] = movementCell[word];\n"
        << "                    compact_turn_set_layer_bits_" << suffix << "(movementCell, layer, 0);\n"
        << "                    compact_turn_note_movement_cell_written_" << suffix << "(dimensions, scratch, tileIndex, beforeMovements, movementCell);\n"
        << "                    movedThisPass = true;\n"
        << "                    movedAny = true;\n"
        << "                    changedTile = true;\n"
        << "                }\n"
        << "            }\n"
        << "            (void)changedTile;\n"
        << "        }\n"
        << "    }\n"
        << "    if (compact_turn_has_rigid_" << suffix << " && bannedGroups != nullptr) {\n"
        << "        for (int32_t tileIndex = 0; tileIndex < tileCount; ++tileIndex) {\n"
        << "            const MaskWord* movementMask = compact_turn_cell_movements_" << suffix << "(scratch, tileIndex);\n"
        << "            if (!compact_turn_mask_overlaps_" << suffix << "(movementMask, movementMask, compact_turn_movement_stride_" << suffix << ")) continue;\n"
        << "            const MaskWord* rigidAppliedMask = compact_turn_cell_rigid_movement_applied_" << suffix << "(scratch, tileIndex);\n"
        << "            bool hasRigidFailure = false;\n"
        << "            for (int32_t word = 0; word < compact_turn_movement_stride_" << suffix << "; ++word) {\n"
        << "                if ((movementMask[word] & rigidAppliedMask[word]) != 0) hasRigidFailure = true;\n"
        << "            }\n"
        << "            if (!hasRigidFailure) continue;\n"
        << "            const MaskWord* rigidGroupMask = compact_turn_cell_rigid_group_index_" << suffix << "(scratch, tileIndex);\n"
        << "            for (int32_t layer = 0; layer < compact_turn_layer_count_" << suffix << "; ++layer) {\n"
        << "                if ((compact_turn_layer_bits_" << suffix << "(movementMask, layer) & compact_turn_layer_bits_" << suffix << "(rigidAppliedMask, layer)) == 0) continue;\n"
        << "                const int32_t rigidGroupIndex = compact_turn_layer_bits_" << suffix << "(rigidGroupMask, layer) - 1;\n"
        << "                if (rigidGroupIndex < 0 || rigidGroupIndex >= compact_turn_rigid_group_index_to_group_index_count_" << suffix << ") break;\n"
        << "                const int32_t groupIndex = compact_turn_rigid_group_index_to_group_index_" << suffix << "[rigidGroupIndex];\n"
        << "                if (groupIndex >= 0) {\n"
        << "                    if (static_cast<size_t>(groupIndex) >= bannedGroups->size()) bannedGroups->resize(static_cast<size_t>(groupIndex + 1), false);\n"
        << "                    (*bannedGroups)[static_cast<size_t>(groupIndex)] = true;\n"
        << "                    outcome.shouldUndo = true;\n"
        << "                }\n"
        << "                break;\n"
        << "            }\n"
        << "        }\n"
        << "    }\n"
        << "#if defined(PS_COMPACT_TURN_OUTPUT_HOOKS)\n"
        << "    for (int32_t tileIndex = 0; tileIndex < tileCount; ++tileIndex) {\n"
        << "        const MaskWord* movementMask = compact_turn_cell_movements_" << suffix << "(scratch, tileIndex);\n"
        << "        if (!compact_turn_mask_overlaps_" << suffix << "(movementMask, movementMask, compact_turn_movement_stride_" << suffix << ")) continue;\n"
        << "        compactTurnOutputMovementFailureAudio(compact_turn_cell_objects_" << suffix << "(levelState, tileIndex), movementMask);\n"
        << "    }\n"
        << "#endif\n"
        << "    std::fill(scratch.liveMovements.begin(), scratch.liveMovements.end(), 0);\n"
        << "    compact_turn_clear_movement_masks_" << suffix << "(scratch);\n"
        << "    scratch.liveMovementsClean = true;\n"
        << "    outcome.moved = movedAny;\n"
        << "    return outcome;\n"
        << "}\n\n";

    CompactFunctionInterner functions;
    emitCompactRulegroupFunctions(out, game, earlyMasks, functions, game.rules, game.loopPoint, suffix, "early");
    emitCompactRulegroupFunctions(out, game, lateMasks, functions, game.lateRules, game.lateLoopPoint, suffix, "late");
}

} // namespace

void emitGbcSpecializedTurn(std::ostream& out) {
    out << "#include \"puzzlescript/gbc_compact_facade.h\"\n"
        << "#include \"specialized_turn.h\"\n\n"
        << "bool ps_gbc_apply_turn_phases(\n"
        << "    ps_gbc_session* session,\n"
        << "    uint8_t direction,\n"
        << "    ps_gbc_commands* commands);\n\n"
        << "bool ps_gbc_specialized_apply_turn_phases(\n"
        << "    ps_gbc_session* session,\n"
        << "    uint8_t direction,\n"
        << "    ps_gbc_commands* commands,\n"
        << "    bool* out_changed\n"
        << ") {\n"
        << "    if (out_changed == NULL) return true;\n"
        << "    *out_changed = ps_gbc_apply_turn_phases(session, direction, commands);\n"
        << "    return true;\n"
        << "}\n";
}

void emitCompactTurnBackend(
    std::ostream& out,
    const Game& game,
    std::string_view sourcePath,
    uint64_t sourceHash,
    size_t sourceIndex,
    CompactCodegenOptions options
) {
    if (options.target == CompactCodegenTarget::GbdC) {
        emitGbcSpecializedTurn(out);
        return;
    }
    const CompactTurnSupport compactTurnSupport = compactTurnSupportForGame(game, options);
    const std::string suffix = sourceSuffix(sourceIndex);
    const CompactTurnProgram program = buildCompactTurnProgram(game);
    if (compactTurnSupport.nativeKernel()) {
        out << "// compact-turn program source_index=" << sourceIndex
            << " instructions=" << program.instructions.size()
            << " has_again=" << (program.hasAgain ? "true" : "false")
            << " has_cancel=" << (program.hasCancel ? "true" : "false")
            << " has_restart=" << (program.hasRestart ? "true" : "false")
            << " has_rule_loops=" << (program.hasRuleLoops ? "true" : "false")
            << "\n";
        emitCompactTurnAccessLayer(out, game, sourceIndex, options);
        out << "SpecializedCompactTurnOutcome compact_turn_execute_program_" << suffix << "(\n"
            << "    LevelDimensions dimensions,\n"
            << "    int32_t currentLevelIndex,\n"
            << "    PersistentLevelState& levelState,\n"
            << "    Scratch& scratch,\n"
            << "    ps_input input,\n"
            << "    RuntimeStepOptions options,\n"
            << "    bool* outHasAgain,\n"
            << "    bool probeOnly\n"
            << ") {\n";
        emitCompactTurnCompilerSingleBody(out, suffix, options);
        out << "}\n\n";
        out << "SpecializedCompactTurnOutcome specialized_compact_turn_core_" << sourceIndex << "(\n"
            << "    LevelDimensions dimensions,\n"
            << "    int32_t currentLevelIndex,\n"
            << "    PersistentLevelState& levelState,\n"
            << "    Scratch& scratch,\n"
            << "    ps_input input,\n"
            << "    RuntimeStepOptions options\n"
            << ") {\n";
        emitCompactTurnCompilerDrainBody(out, suffix);
        out << "}\n\n";
    }
    out << "SpecializedCompactTurnOutcome specialized_compact_turn_source_" << sourceIndex << "(\n"
        << "    const Game& game,\n"
        << "    PersistentLevelState& levelState,\n"
        << "    Scratch& scratch,\n"
        << "    SpecializedCompactTurnContext context,\n"
        << "    ps_input input,\n"
        << "    RuntimeStepOptions options\n"
        << ") {\n";
    if (!compactTurnSupport.supported()) {
        emitCompactTurnUnsupportedBody(out);
        out << "}\n\n";
    } else if (compactTurnSupport.usesInterpreterBridge()) {
        out << "    return compactStateInterpretedTurnBridge(game, levelState, scratch, context, input, options);\n"
            << "}\n\n";
    } else {
        out << "    (void)game;\n"
            << "    addRuntimeCounter(RuntimeCounterId::CompactTurnNativeCalls);\n"
            << "    return specialized_compact_turn_core_" << sourceIndex << "(context.dimensions, context.currentLevelIndex, levelState, scratch, input, options);\n"
            << "}\n\n";
    }
    out
        << "const SpecializedCompactTurnBackend specialized_compact_turn_backend_" << sourceIndex << " = {\n"
        << "    " << sourceHash << "ULL,\n"
        << "    " << cppStringLiteral(sourcePath) << ",\n"
        << "    specialized_compact_turn_source_" << sourceIndex << ",\n"
        << "    {" << (compactTurnSupport.supported() ? "true" : "false")
        << ", " << cppStringLiteral(compactTurnSupport.statusReason) << "},\n"
        << "    " << (compactTurnSupport.nativeKernel() ? "true" : "false") << ",\n"
        << "};\n\n";
}

CompactTurnSupport compactNativeTurnSupportForGame(const Game& game) {
    const std::string unsupportedReason = compactNativeTurnUnsupportedReasonForGame(game);
    if (!unsupportedReason.empty()) {
        CompactTurnSupport support;
        support.backendKind = CompactTurnBackendKind::Unsupported;
        support.statusReason = unsupportedReason;
        return support;
    }
    CompactTurnSupport support;
    support.backendKind = CompactTurnBackendKind::NativeKernel;
    support.statusReason = "native_kernel";
    return support;
}

CompactTurnSupport compactTurnSupportForGame(const Game& game, const CompactCodegenOptions& options) {
    CompactTurnSupport support = compactNativeTurnSupportForGame(game);
    support.nativeKernelStatusReason = support.statusReason;
    if (options.interpreterMode) {
        support.backendKind = CompactTurnBackendKind::InterpreterBridge;
        support.statusReason = "interpreter_bridge";
        return support;
    }
    return support;
}

CompactTurnSupport compactTurnSupportForGame(const Game& game) {
    return compactTurnSupportForGame(game, CompactCodegenOptions{});
}

} // namespace puzzlescript::compiler
