#include "runtime/layout_metrics.hpp"

#include <algorithm>
#include <sstream>
#include <string>
#include <unordered_set>
#include <vector>

namespace puzzlescript {
namespace {

std::string jsonString(std::string_view value) {
    std::ostringstream out;
    out << '"';
    for (const char ch : value) {
        switch (ch) {
        case '"': out << "\\\""; break;
        case '\\': out << "\\\\"; break;
        case '\b': out << "\\b"; break;
        case '\f': out << "\\f"; break;
        case '\n': out << "\\n"; break;
        case '\r': out << "\\r"; break;
        case '\t': out << "\\t"; break;
        default:
            if (static_cast<unsigned char>(ch) < 0x20) {
                out << "\\u" << std::hex << std::uppercase << static_cast<int>(static_cast<unsigned char>(ch));
            } else {
                out << ch;
            }
            break;
        }
    }
    out << '"';
    return out.str();
}

std::string maskKeyForWords(const MaskWord* words, uint32_t wordCount) {
    std::string key;
    key.reserve(static_cast<size_t>(wordCount) * sizeof(MaskWord));
    for (uint32_t index = 0; index < wordCount; ++index) {
        const MaskWord word = words[index];
        key.append(reinterpret_cast<const char*>(&word), sizeof(word));
    }
    return key;
}

void addOffset(std::vector<MaskOffset>& offsets, MaskOffset offset) {
    if (offset != kNullMaskOffset) {
        offsets.push_back(offset);
    }
}

uint64_t countRules(const std::vector<std::vector<Rule>>& groups) {
    uint64_t count = 0;
    for (const std::vector<Rule>& group : groups) {
        count += group.size();
    }
    return count;
}

uint64_t countUniqueMaskSlots(const Game& game) {
    if (game.wordCount == 0 || game.maskArena.empty()) {
        return 0;
    }
    std::unordered_set<std::string> seen;
    const uint32_t wordCount = game.wordCount;
    const size_t step = static_cast<size_t>(wordCount);
    for (size_t offset = 0; offset + step <= game.maskArena.size(); offset += step) {
        seen.insert(maskKeyForWords(game.maskArena.data() + offset, wordCount));
    }
    return seen.size();
}

void collectReferencedOffsets(const Game& game, std::vector<MaskOffset>& offsets) {
    offsets.clear();
    offsets.reserve(256);
    for (const MaskOffset offset : game.layerMaskOffsets) {
        addOffset(offsets, offset);
    }
    addOffset(offsets, game.playerMask);
    addOffset(offsets, game.staticAnalysisExtraWrittenObjects);
    addOffset(offsets, game.staticAnalysisExtraMovementMentionedObjects);
    for (const MaskOffset offset : game.anyObjectOffsets) {
        addOffset(offsets, offset);
    }
    for (const MaskOffset offset : game.anyMovementOffsets) {
        addOffset(offsets, offset);
    }
    for (const MaskOffset offset : game.cellRowMaskOffsets) {
        addOffset(offsets, offset);
    }
    for (const MaskOffset offset : game.cellRowMaskMovementsOffsets) {
        addOffset(offsets, offset);
    }
    for (const MaskOffset offset : game.cellRowMissingObjectMaskOffsets) {
        addOffset(offsets, offset);
    }
    for (const MaskOffset offset : game.cellRowMissingMovementMaskOffsets) {
        addOffset(offsets, offset);
    }
    for (const MaskOffset offset : game.cellRowAnyObjectMaskOffsets) {
        addOffset(offsets, offset);
    }
    for (const MaskOffset offset : game.cellRowAnyMovementMaskOffsets) {
        addOffset(offsets, offset);
    }
    for (const Game::NamedMaskEntry& entry : game.glyphMaskTable) {
        addOffset(offsets, entry.offset);
    }
    for (const Game::NamedMaskEntry& entry : game.objectMaskTable) {
        addOffset(offsets, entry.offset);
    }
    for (const Game::NamedMaskEntry& entry : game.synonymMaskTable) {
        addOffset(offsets, entry.offset);
    }
    for (const Game::NamedMaskEntry& entry : game.aggregateMaskTable) {
        addOffset(offsets, entry.offset);
    }
    for (const Game::NamedMaskEntry& entry : game.propertyMaskTable) {
        addOffset(offsets, entry.offset);
    }
    for (const std::vector<Rule>& group : game.rules) {
        for (const Rule& rule : group) {
            addOffset(offsets, rule.ruleMask);
            addOffset(offsets, rule.ruleMovementMask);
            addOffset(offsets, rule.readMovements);
            addOffset(offsets, rule.readObjects);
            addOffset(offsets, rule.writeObjects);
            addOffset(offsets, rule.writeMovements);
            for (uint32_t index = 0; index < rule.cellRowMasksCount; ++index) {
                addOffset(offsets, game.cellRowMaskOffsets[rule.cellRowMasksFirst + index]);
            }
            for (uint32_t index = 0; index < rule.cellRowMasksMovementsCount; ++index) {
                addOffset(offsets, game.cellRowMaskMovementsOffsets[rule.cellRowMasksMovementsFirst + index]);
            }
            for (uint32_t index = 0; index < rule.cellRowMissingObjectMasksCount; ++index) {
                addOffset(offsets, game.cellRowMissingObjectMaskOffsets[rule.cellRowMissingObjectMasksFirst + index]);
            }
            for (uint32_t index = 0; index < rule.cellRowMissingMovementMasksCount; ++index) {
                addOffset(offsets, game.cellRowMissingMovementMaskOffsets[rule.cellRowMissingMovementMasksFirst + index]);
            }
            for (const RowAnyMaskSpan& span : rule.cellRowAnyObjectMasks) {
                for (uint32_t index = 0; index < span.count; ++index) {
                    addOffset(offsets, game.cellRowAnyObjectMaskOffsets[span.first + index]);
                }
            }
            for (const RowAnyMaskSpan& span : rule.cellRowAnyMovementMasks) {
                for (uint32_t index = 0; index < span.count; ++index) {
                    addOffset(offsets, game.cellRowAnyMovementMaskOffsets[span.first + index]);
                }
            }
        }
    }
    for (const std::vector<Rule>& group : game.lateRules) {
        for (const Rule& rule : group) {
            addOffset(offsets, rule.ruleMask);
            addOffset(offsets, rule.ruleMovementMask);
            addOffset(offsets, rule.readMovements);
            addOffset(offsets, rule.readObjects);
            addOffset(offsets, rule.writeObjects);
            addOffset(offsets, rule.writeMovements);
        }
    }
}

} // namespace

GameLayoutMetrics computeGameLayoutMetrics(const Game& game) {
    GameLayoutMetrics metrics{};
    metrics.objectCount = game.objectCount;
    metrics.layerCount = game.layerCount;
    metrics.wordCount = game.wordCount;
    metrics.strideObject = game.strideObject;
    metrics.strideMovement = game.strideMovement;
    metrics.maskArenaWords = game.maskArena.size();
    metrics.maskArenaBytes = game.maskArena.size() * sizeof(MaskWord);
    metrics.ruleCount = countRules(game.rules);
    metrics.lateRuleCount = countRules(game.lateRules);
    if (game.wordCount > 0) {
        metrics.maskSlotCount = game.maskArena.size() / static_cast<size_t>(game.wordCount);
        metrics.uniqueMaskCount = countUniqueMaskSlots(game);
        if (metrics.maskSlotCount > 0) {
            metrics.maskArenaUtilization =
                static_cast<double>(metrics.uniqueMaskCount) / static_cast<double>(metrics.maskSlotCount);
        }
    }

    std::vector<MaskOffset> referencedOffsets;
    collectReferencedOffsets(game, referencedOffsets);
    if (!referencedOffsets.empty() && !game.maskArena.empty()) {
        const auto [minIt, maxIt] = std::minmax_element(referencedOffsets.begin(), referencedOffsets.end());
        const uint64_t minOffset = static_cast<uint64_t>(*minIt);
        const uint64_t maxOffset = static_cast<uint64_t>(*maxIt);
        metrics.maskReferenceSpanWords = maxOffset - minOffset + static_cast<uint64_t>(game.wordCount);
        metrics.maskReferenceSpanRatio =
            static_cast<double>(metrics.maskReferenceSpanWords) / static_cast<double>(game.maskArena.size());
    }

    return metrics;
}

std::string gameLayoutMetricsJson(
    const GameLayoutMetrics& metrics,
    const std::string& sourceName,
    bool compileOk
) {
    std::ostringstream out;
    out << '{'
        << "\"source\":" << jsonString(sourceName) << ','
        << "\"compile_ok\":" << (compileOk ? "true" : "false") << ','
        << "\"object_count\":" << metrics.objectCount << ','
        << "\"layer_count\":" << metrics.layerCount << ','
        << "\"word_count\":" << metrics.wordCount << ','
        << "\"stride_object\":" << metrics.strideObject << ','
        << "\"stride_movement\":" << metrics.strideMovement << ','
        << "\"mask_arena_words\":" << metrics.maskArenaWords << ','
        << "\"mask_arena_bytes\":" << metrics.maskArenaBytes << ','
        << "\"rule_count\":" << metrics.ruleCount << ','
        << "\"late_rule_count\":" << metrics.lateRuleCount << ','
        << "\"mask_slot_count\":" << metrics.maskSlotCount << ','
        << "\"unique_mask_count\":" << metrics.uniqueMaskCount << ','
        << "\"mask_arena_utilization\":" << metrics.maskArenaUtilization << ','
        << "\"mask_reference_span_words\":" << metrics.maskReferenceSpanWords << ','
        << "\"mask_reference_span_ratio\":" << metrics.maskReferenceSpanRatio << ','
        << "\"first_board_level_index\":" << metrics.firstBoardLevelIndex << ','
        << "\"first_board_width\":" << metrics.firstBoardWidth << ','
        << "\"first_board_height\":" << metrics.firstBoardHeight << ','
        << "\"board_objects_bytes\":" << metrics.boardObjectsBytes
        << '}';
    return out.str();
}

} // namespace puzzlescript
