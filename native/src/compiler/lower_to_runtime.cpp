#include "compiler/lower_to_runtime.hpp"

#include <algorithm>
#include <array>
#include <cctype>
#include <cstdint>
#include <map>
#include <memory>
#include <set>
#include <stdexcept>
#include <string_view>
#include <utility>

#include <utf8proc.h>

#include "compiler/rule_text.hpp"

namespace puzzlescript::compiler {

namespace {

std::string toLowerAsciiCopy(std::string_view input) {
    std::string out;
    out.reserve(input.size());
    for (unsigned char ch : input) {
        out.push_back(static_cast<char>(std::tolower(ch)));
    }
    return out;
}

uint32_t ceilDivU32(uint32_t a, uint32_t b) {
    return (a + b - 1) / b;
}

puzzlescript::MaskOffset storeMaskWords(puzzlescript::Game& game, const puzzlescript::MaskVector& words) {
    const auto offset = static_cast<puzzlescript::MaskOffset>(game.maskArena.size());
    game.maskArena.insert(game.maskArena.end(), words.begin(), words.end());
    return offset;
}

puzzlescript::MaskVector makeEmptyMask(uint32_t wordCount) {
    return puzzlescript::MaskVector(static_cast<size_t>(wordCount), 0);
}

void setMaskBit(puzzlescript::MaskVector& words, int32_t bitIndex) {
    if (bitIndex < 0) {
        return;
    }
    const uint32_t word = puzzlescript::maskWordIndex(static_cast<uint32_t>(bitIndex));
    if (word >= words.size()) {
        return;
    }
    words[word] |= puzzlescript::maskBit(static_cast<uint32_t>(bitIndex));
}

bool maskHasBit(const puzzlescript::MaskVector& words, int32_t bitIndex) {
    if (bitIndex < 0) {
        return false;
    }
    const uint32_t word = puzzlescript::maskWordIndex(static_cast<uint32_t>(bitIndex));
    return word < words.size()
        && (words[word] & puzzlescript::maskBit(static_cast<uint32_t>(bitIndex))) != 0;
}

bool maskHasAnyBit(const puzzlescript::MaskVector& words) {
    return std::any_of(
        words.begin(),
        words.end(),
        [](puzzlescript::MaskWord word) { return word != 0; });
}

const puzzlescript::MaskWord* storedMaskPtr(
    const puzzlescript::Game& game,
    puzzlescript::MaskOffset offset
) {
    if (offset == puzzlescript::kNullMaskOffset) {
        return nullptr;
    }
    return game.maskArena.data() + offset;
}

void orStoredMaskInto(
    puzzlescript::MaskVector& target,
    const puzzlescript::Game& game,
    puzzlescript::MaskOffset offset,
    uint32_t width
) {
    const puzzlescript::MaskWord* source = storedMaskPtr(game, offset);
    if (source == nullptr) {
        return;
    }
    for (uint32_t word = 0; word < width && word < target.size(); ++word) {
        target[static_cast<size_t>(word)] |= source[word];
    }
}

bool storedMaskAllZero(
    const puzzlescript::Game& game,
    puzzlescript::MaskOffset offset,
    uint32_t width
) {
    const puzzlescript::MaskWord* source = storedMaskPtr(game, offset);
    if (source == nullptr) {
        return true;
    }
    for (uint32_t word = 0; word < width; ++word) {
        if (source[word] != 0) {
            return false;
        }
    }
    return true;
}

bool storedMaskOverlaps(
    const puzzlescript::Game& game,
    puzzlescript::MaskOffset offset,
    const puzzlescript::MaskVector& other,
    uint32_t width
) {
    const puzzlescript::MaskWord* source = storedMaskPtr(game, offset);
    if (source == nullptr) {
        return false;
    }
    for (uint32_t word = 0; word < width && word < other.size(); ++word) {
        if ((source[word] & other[static_cast<size_t>(word)]) != 0) {
            return true;
        }
    }
    return false;
}

void orShiftedMask5(puzzlescript::MaskVector& words, int32_t shift, int32_t value5);

void orMovementBitsForLayer(
    puzzlescript::MaskVector& target,
    int32_t layer,
    int32_t movementBits
) {
    if (layer < 0) {
        return;
    }
    orShiftedMask5(target, 5 * layer, movementBits & 0x1f);
}

void orMovementBitsForPropertyLayers(
    puzzlescript::MaskVector& target,
    const puzzlescript::Game& game,
    const std::map<std::string, std::vector<std::string>>& propertyOf,
    const std::map<std::string, int32_t>& objectIdByName,
    const std::string& propertyName,
    int32_t movementBits
) {
    const auto property = propertyOf.find(propertyName);
    if (property == propertyOf.end()) {
        for (int32_t layer = 0; layer < game.layerCount; ++layer) {
            orMovementBitsForLayer(target, layer, movementBits);
        }
        return;
    }
    for (const std::string& objectName : property->second) {
        const auto object = objectIdByName.find(objectName);
        if (object == objectIdByName.end()) {
            continue;
        }
        const int32_t layer =
            game.objectsById[static_cast<size_t>(object->second)].layer;
        orMovementBitsForLayer(target, layer, movementBits);
    }
}

bool isReplaySensitiveCommand(const std::string& name) {
    return name == "again"
        || name == "restart"
        || name == "cancel"
        || name == "win"
        || name == "checkpoint";
}

std::vector<int32_t> objectIdsFromMask(const puzzlescript::MaskVector& words, int32_t objectCount) {
    std::vector<int32_t> ids;
    for (uint32_t word = 0; word < words.size(); ++word) {
        puzzlescript::MaskWordUnsigned bits = static_cast<puzzlescript::MaskWordUnsigned>(words[static_cast<size_t>(word)]);
        while (bits != 0) {
            const int32_t bit = puzzlescript::maskWordCountTrailingZeros(bits);
            const int32_t objectId = static_cast<int32_t>(word) * static_cast<int32_t>(puzzlescript::kMaskWordBits) + bit;
            if (objectId < objectCount) {
                ids.push_back(objectId);
            }
            bits &= bits - 1;
        }
    }
    return ids;
}

std::vector<std::vector<int32_t>> parseSpriteMatrix(const std::vector<std::string>& rows) {
    // PuzzleScript sprites are typically 5x5; treat '.' as transparent (-1) and digits as palette indices.
    std::vector<std::vector<int32_t>> result;
    result.reserve(rows.size());
    for (const auto& row : rows) {
        std::vector<int32_t> outRow;
        outRow.reserve(row.size());
        for (const char ch : row) {
            if (ch == '.') {
                outRow.push_back(-1);
            } else if (ch >= '0' && ch <= '9') {
                outRow.push_back(static_cast<int32_t>(ch - '0'));
            } else {
                outRow.push_back(-1);
            }
        }
        result.push_back(std::move(outRow));
    }
    return result;
}

std::vector<std::string> splitUtf8Codepoints(std::string_view text) {
    std::vector<std::string> out;
    const auto* bytes = reinterpret_cast<const utf8proc_uint8_t*>(text.data());
    const utf8proc_ssize_t total = static_cast<utf8proc_ssize_t>(text.size());
    utf8proc_ssize_t cursor = 0;
    while (cursor < total) {
        utf8proc_int32_t cp = 0;
        const utf8proc_ssize_t advance = utf8proc_iterate(bytes + cursor, total - cursor, &cp);
        if (advance <= 0) {
            // Fall back to byte-wise to avoid infinite loops on malformed UTF-8.
            out.emplace_back(1, static_cast<char>(bytes[cursor]));
            cursor += 1;
            continue;
        }
        out.emplace_back(text.substr(static_cast<size_t>(cursor), static_cast<size_t>(advance)));
        cursor += advance;
    }
    return out;
}

std::string takeRulePrefixBeforeComment(std::string_view line) {
    std::string prefix;
    prefix.reserve(line.size());
    for (const char ch : line) {
        if (ch == '(') {
            break;
        }
        prefix.push_back(ch);
    }
    return prefix;
}

std::string trimAsciiWhitespace(std::string_view value) {
    size_t start = 0;
    while (start < value.size() && std::isspace(static_cast<unsigned char>(value[start]))) {
        ++start;
    }
    size_t end = value.size();
    while (end > start && std::isspace(static_cast<unsigned char>(value[end - 1]))) {
        --end;
    }
    return std::string(value.substr(start, end - start));
}

size_t findIndexAfterToken(
    std::string_view lineLower,
    const std::vector<std::string>& tokens,
    size_t tokenIndex
) {
    size_t curIndex = 0;
    for (size_t i = 0; i <= tokenIndex && i < tokens.size(); ++i) {
        const auto pos = lineLower.find(tokens[i], curIndex);
        if (pos == std::string_view::npos) {
            return lineLower.size();
        }
        curIndex = pos + tokens[i].size();
    }
    return curIndex;
}

std::string messageTextFromRuleLine(
    std::string_view mixedCaseLine,
    std::string_view lowerLine,
    const std::vector<std::string>& ruleTokens,
    size_t messageTokenIndex
) {
    const size_t start = findIndexAfterToken(lowerLine, ruleTokens, messageTokenIndex);
    std::string message = trimAsciiWhitespace(mixedCaseLine.substr(start));
    if (message.empty()) {
        message = " ";
    }
    return message;
}

int32_t dirMaskFromToken(std::string_view token) {
    if (token == "^") return 1;
    if (token == "up") return 1;
    if (token == "v") return 2;
    if (token == "down") return 2;
    if (token == "<") return 4;
    if (token == "left") return 4;
    if (token == ">") return 8;
    if (token == "right") return 8;
    if (token == "action") return 16;
    if (token == "moving") return 1; // canonicalized to UP in JS rule masks
    if (token == "horizontal" || token == "horizontal_par" || token == "horizontal_perp") return 4;
    if (token == "vertical" || token == "vertical_par" || token == "vertical_perp") return 1;
    if (token == "orthogonal") return 15; // up|down|left|right
    // Aggregates: non-zero so `parseSide` pairs them with the following object name
    // (reg_directions in languageConstants.js).
    if (token == "perpendicular" || token == "parallel") return 1;
    if (token == "stationary") return 0; // special-cased: goes to movementsMissing=0x1f
    return 0;
}

void setShiftedMask5(puzzlescript::MaskVector& words, int32_t shift, int32_t value5) {
    // shift is bit offset (multiple of 5).
    const int32_t wordIndex = shift / static_cast<int32_t>(puzzlescript::kMaskWordBits);
    const int32_t bitIndex = shift % static_cast<int32_t>(puzzlescript::kMaskWordBits);
    if (wordIndex < 0 || static_cast<size_t>(wordIndex) >= words.size()) {
        return;
    }
    const puzzlescript::MaskWordUnsigned mask = 0x1fU;
    puzzlescript::MaskWordUnsigned v = static_cast<puzzlescript::MaskWordUnsigned>(value5) & mask;
    puzzlescript::MaskWordUnsigned w0 = static_cast<puzzlescript::MaskWordUnsigned>(words[static_cast<size_t>(wordIndex)]);
    w0 &= ~(mask << bitIndex);
    w0 |= (v << bitIndex);
    words[static_cast<size_t>(wordIndex)] = static_cast<puzzlescript::MaskWord>(w0);
    if (bitIndex > static_cast<int32_t>(puzzlescript::kMaskWordBits - 5U)) {
        // Straddles boundary.
        const int32_t next = wordIndex + 1;
        if (static_cast<size_t>(next) >= words.size()) {
            return;
        }
        const int32_t spill = bitIndex + 5 - static_cast<int32_t>(puzzlescript::kMaskWordBits);
        puzzlescript::MaskWordUnsigned w1 = static_cast<puzzlescript::MaskWordUnsigned>(words[static_cast<size_t>(next)]);
        w1 &= ~(mask >> (5 - spill));
        w1 |= (v >> (5 - spill));
        words[static_cast<size_t>(next)] = static_cast<puzzlescript::MaskWord>(w1);
    }
}

void orShiftedMask5(puzzlescript::MaskVector& words, int32_t shift, int32_t value5) {
    const int32_t wordIndex = shift / static_cast<int32_t>(puzzlescript::kMaskWordBits);
    const int32_t bitIndex = shift % static_cast<int32_t>(puzzlescript::kMaskWordBits);
    if (wordIndex < 0 || static_cast<size_t>(wordIndex) >= words.size()) {
        return;
    }
    const puzzlescript::MaskWordUnsigned mask = 0x1fU;
    puzzlescript::MaskWordUnsigned v = static_cast<puzzlescript::MaskWordUnsigned>(value5) & mask;
    puzzlescript::MaskWordUnsigned w0 = static_cast<puzzlescript::MaskWordUnsigned>(words[static_cast<size_t>(wordIndex)]);
    w0 |= (v << bitIndex);
    words[static_cast<size_t>(wordIndex)] = static_cast<puzzlescript::MaskWord>(w0);
    if (bitIndex > static_cast<int32_t>(puzzlescript::kMaskWordBits - 5U)) {
        const int32_t next = wordIndex + 1;
        if (static_cast<size_t>(next) >= words.size()) {
            return;
        }
        const int32_t spill = bitIndex + 5 - static_cast<int32_t>(puzzlescript::kMaskWordBits);
        puzzlescript::MaskWordUnsigned w1 = static_cast<puzzlescript::MaskWordUnsigned>(words[static_cast<size_t>(next)]);
        w1 |= (v >> (5 - spill));
        words[static_cast<size_t>(next)] = static_cast<puzzlescript::MaskWord>(w1);
    }
}

int32_t getShiftedMask5(const puzzlescript::MaskVector& words, int32_t shift) {
    const int32_t wordIndex = shift / static_cast<int32_t>(puzzlescript::kMaskWordBits);
    const int32_t bitIndex = shift % static_cast<int32_t>(puzzlescript::kMaskWordBits);
    if (wordIndex < 0 || static_cast<size_t>(wordIndex) >= words.size()) {
        return 0;
    }
    const puzzlescript::MaskWordUnsigned mask = 0x1fU;
    puzzlescript::MaskWordUnsigned value = (static_cast<puzzlescript::MaskWordUnsigned>(words[static_cast<size_t>(wordIndex)]) >> bitIndex) & mask;
    if (bitIndex > static_cast<int32_t>(puzzlescript::kMaskWordBits - 5U)) {
        const int32_t next = wordIndex + 1;
        if (static_cast<size_t>(next) < words.size()) {
            const int32_t spill = bitIndex + 5 - static_cast<int32_t>(puzzlescript::kMaskWordBits);
            const puzzlescript::MaskWordUnsigned nextBits = static_cast<puzzlescript::MaskWordUnsigned>(words[static_cast<size_t>(next)]) & ((puzzlescript::MaskWordUnsigned{1} << spill) - 1U);
            value |= (nextBits << (5 - spill));
        }
    }
    return static_cast<int32_t>(value);
}

constexpr std::array<int32_t, 5> kInputSpecArgToMovementMask = {
    1 << 0,
    1 << 2,
    1 << 1,
    1 << 3,
    1 << 4,
};
constexpr uint8_t kInputSpecTickBit = 5;
constexpr uint8_t kInputSpecAll = 0x3f;

void orAggregateBindingReadMovements(
    puzzlescript::MaskVector& target,
    const puzzlescript::Game& game,
    const std::map<std::string, std::vector<std::string>>& propertyOf,
    const std::map<std::string, int32_t>& objectIdByName,
    const puzzlescript::AggregateBinding& binding
) {
    const int32_t movementBits = binding.aggregateMask & 0x1f;
    if (binding.sourcePropertyName.has_value()) {
        orMovementBitsForPropertyLayers(
            target,
            game,
            propertyOf,
            objectIdByName,
            *binding.sourcePropertyName,
            movementBits);
        return;
    }
    orMovementBitsForLayer(target, binding.sourceLayer, movementBits);
}

puzzlescript::MaskVector computeInputSpecReadMovementsPresent(
    const puzzlescript::Game& game,
    const puzzlescript::Rule& rule,
    const std::map<std::string, std::vector<std::string>>& propertyOf,
    const std::map<std::string, int32_t>& objectIdByName
) {
    puzzlescript::MaskVector result(static_cast<size_t>(game.movementWordCount), 0);
    for (const auto& row : rule.patterns) {
        for (const puzzlescript::Pattern& pattern : row) {
            if (pattern.kind != puzzlescript::Pattern::Kind::CellPattern) {
                continue;
            }
            orStoredMaskInto(result, game, pattern.movementsPresent, game.movementWordCount);
            for (uint32_t index = 0; index < pattern.anyMovementsCount; ++index) {
                orStoredMaskInto(
                    result,
                    game,
                    game.anyMovementOffsets[
                        static_cast<size_t>(pattern.anyMovementsFirst + index)],
                    game.movementWordCount);
            }
            for (const auto& coupled : pattern.layerCoupledMovementMasks) {
                for (const auto& layerTerm : coupled.layers) {
                    orStoredMaskInto(result, game, layerTerm.movementsAny, game.movementWordCount);
                    orStoredMaskInto(result, game, layerTerm.movementsPresent, game.movementWordCount);
                }
            }
        }
    }
    for (const puzzlescript::AggregateBinding& binding : rule.aggregateBindings) {
        orAggregateBindingReadMovements(
            result,
            game,
            propertyOf,
            objectIdByName,
            binding);
    }
    return result;
}

std::map<std::string, int32_t> aggregateSourceMovementMasks(const puzzlescript::Rule& rule) {
    std::map<std::string, int32_t> masks;
    for (const puzzlescript::AggregateBinding& binding : rule.aggregateBindings) {
        masks[binding.aggregateName] |= binding.aggregateMask & 0x1f;
    }
    return masks;
}

void orInferredAggregateWriteMovements(
    puzzlescript::MaskVector& target,
    const puzzlescript::Game& game,
    const std::map<std::string, std::vector<std::string>>& propertyOf,
    const std::map<std::string, int32_t>& objectIdByName,
    const std::map<std::string, int32_t>& aggregateMasks,
    const puzzlescript::InferredAggregateBinding& binding
) {
    int32_t movementBits = 0x1f;
    if (const auto mask = aggregateMasks.find(binding.aggregateName);
        mask != aggregateMasks.end() && mask->second != 0) {
        movementBits = mask->second & 0x1f;
    }
    if (binding.layerIndex.has_value()) {
        orMovementBitsForLayer(target, *binding.layerIndex, movementBits);
        return;
    }
    if (binding.propertyName.has_value()) {
        orMovementBitsForPropertyLayers(
            target,
            game,
            propertyOf,
            objectIdByName,
            *binding.propertyName,
            movementBits);
        return;
    }
    for (int32_t layer = 0; layer < game.layerCount; ++layer) {
        orMovementBitsForLayer(target, layer, movementBits);
    }
}

puzzlescript::MaskVector computeInputSpecWriteMovementsSet(
    const puzzlescript::Game& game,
    const puzzlescript::Rule& rule,
    const std::map<std::string, std::vector<std::string>>& propertyOf,
    const std::map<std::string, int32_t>& objectIdByName
) {
    puzzlescript::MaskVector result(static_cast<size_t>(game.movementWordCount), 0);
    const std::map<std::string, int32_t> aggregateMasks =
        aggregateSourceMovementMasks(rule);
    for (const auto& row : rule.patterns) {
        for (const puzzlescript::Pattern& pattern : row) {
            if (pattern.kind != puzzlescript::Pattern::Kind::CellPattern
                || !pattern.replacement.has_value()) {
                continue;
            }
            const puzzlescript::Replacement& replacement = *pattern.replacement;
            orStoredMaskInto(result, game, replacement.movementsSet, game.movementWordCount);
            if (replacement.hasRandomDirMask) {
                orStoredMaskInto(result, game, replacement.randomDirMask, game.movementWordCount);
            }
            const puzzlescript::ReplacementDynamic* dynamic = replacement.dynamic.get();
            if (dynamic == nullptr) {
                continue;
            }
            for (const auto& coupled : dynamic->layerCoupledMovementReplacements) {
                const int32_t movementBits = coupled.hasReplacementMovementMask
                    ? coupled.replacementMovementMask
                    : 0x1f;
                for (const auto& layerTerm : coupled.layers) {
                    orMovementBitsForLayer(result, layerTerm.layerIndex, movementBits);
                }
            }
            for (const auto& binding : dynamic->inferredPropertyBindings) {
                if (binding.dirMode == 0) {
                    continue;
                }
                orMovementBitsForPropertyLayers(
                    result,
                    game,
                    propertyOf,
                    objectIdByName,
                    binding.propertyName,
                    0x1f);
            }
            for (const auto& binding : dynamic->inferredAggregateBindings) {
                orInferredAggregateWriteMovements(
                    result,
                    game,
                    propertyOf,
                    objectIdByName,
                    aggregateMasks,
                    binding);
            }
        }
    }
    return result;
}

std::vector<uint8_t> computeInputActiveSet(
    const puzzlescript::Game& game,
    const std::vector<puzzlescript::Rule*>& flatRules,
    const puzzlescript::MaskVector& seedMovements
) {
    std::vector<uint8_t> included(flatRules.size(), 0);
    puzzlescript::MaskVector possibleWriteMovements = seedMovements;

    auto readOffset = [](const puzzlescript::Rule& rule) {
        return rule.inputSpecReadMovementsPresent != puzzlescript::kNullMaskOffset
            ? rule.inputSpecReadMovementsPresent
            : rule.readMovements;
    };
    auto writeOffset = [](const puzzlescript::Rule& rule) {
        return rule.inputSpecWriteMovementsSet != puzzlescript::kNullMaskOffset
            ? rule.inputSpecWriteMovementsSet
            : rule.writeMovements;
    };

    for (size_t index = 0; index < flatRules.size(); ++index) {
        const puzzlescript::Rule& rule = *flatRules[index];
        const puzzlescript::MaskOffset read = readOffset(rule);
        if (rule.forceAlwaysRun
            || storedMaskAllZero(game, read, game.movementWordCount)
            || storedMaskOverlaps(game, read, seedMovements, game.movementWordCount)) {
            included[index] = 1;
            orStoredMaskInto(
                possibleWriteMovements,
                game,
                writeOffset(rule),
                game.movementWordCount);
        }
    }

    bool changed = true;
    while (changed) {
        changed = false;
        for (size_t index = 0; index < flatRules.size(); ++index) {
            if (included[index] != 0) {
                continue;
            }
            const puzzlescript::Rule& rule = *flatRules[index];
            const puzzlescript::MaskOffset read = readOffset(rule);
            if (storedMaskOverlaps(game, read, possibleWriteMovements, game.movementWordCount)) {
                included[index] = 1;
                orStoredMaskInto(
                    possibleWriteMovements,
                    game,
                    writeOffset(rule),
                    game.movementWordCount);
                changed = true;
            }
        }
    }

    return included;
}

void attachInputSpecializationMasks(puzzlescript::Game& game) {
    for (auto& group : game.rules) {
        for (puzzlescript::Rule& rule : group) {
            rule.activeInputsMask = 0;
        }
    }
    for (auto& group : game.lateRules) {
        for (puzzlescript::Rule& rule : group) {
            rule.activeInputsMask = kInputSpecAll;
        }
    }

    std::vector<puzzlescript::Rule*> flatRules;
    for (auto& group : game.rules) {
        for (puzzlescript::Rule& rule : group) {
            flatRules.push_back(&rule);
        }
    }
    if (flatRules.empty()) {
        return;
    }

    std::set<int32_t> playerLayers;
    const puzzlescript::MaskWord* playerMask = storedMaskPtr(game, game.playerMask);
    if (playerMask != nullptr) {
        for (const puzzlescript::ObjectDef& object : game.objectsById) {
            const uint32_t word = puzzlescript::maskWordIndex(
                static_cast<uint32_t>(object.id));
            if (word >= game.wordCount) {
                continue;
            }
            if ((playerMask[word] & puzzlescript::maskBit(static_cast<uint32_t>(object.id))) != 0) {
                playerLayers.insert(object.layer);
            }
        }
    }

    for (size_t input = 0; input < kInputSpecArgToMovementMask.size(); ++input) {
        puzzlescript::MaskVector seed(static_cast<size_t>(game.movementWordCount), 0);
        for (const int32_t layer : playerLayers) {
            orMovementBitsForLayer(seed, layer, kInputSpecArgToMovementMask[input]);
        }
        const std::vector<uint8_t> active = computeInputActiveSet(game, flatRules, seed);
        for (size_t index = 0; index < flatRules.size(); ++index) {
            if (active[index] != 0) {
                flatRules[index]->activeInputsMask |= static_cast<uint8_t>(1u << input);
            }
        }
    }

    puzzlescript::MaskVector tickSeed(static_cast<size_t>(game.movementWordCount), 0);
    const std::vector<uint8_t> tickActive =
        computeInputActiveSet(game, flatRules, tickSeed);
    for (size_t index = 0; index < flatRules.size(); ++index) {
        if (tickActive[index] != 0) {
            flatRules[index]->activeInputsMask |= static_cast<uint8_t>(1u << kInputSpecTickBit);
        }
    }
}

} // namespace

std::unique_ptr<puzzlescript::Error> lowerToRuntimeGame(
    const ParserState& state,
    puzzlescript::LoadedGame& outGame,
    std::vector<SemanticRule>* outAuthoredRules
) {
    auto game = std::make_shared<puzzlescript::Game>();
    puzzlescript::MetaGameState initialMetaGameState;
    game->schemaVersion = 1;

    // --- Metadata ---
    // ParserState.metadata is a flat [key, value, key, value...] list.
    game->metadata.pairs = state.metadata;
    for (size_t i = 0; i + 1 < state.metadata.size(); i += 2) {
        game->metadata.values[state.metadata[i]] = state.metadata[i + 1];
    }
    game->metadata.lines = state.metadataLines;

    // Preserve existing JS exporter behavior: background/text colors are part of IR.
    // If we don't resolve palettes yet, prefer explicit metadata.
    if (const auto it = game->metadata.values.find("text_color"); it != game->metadata.values.end()) {
        game->foregroundColor = it->second;
    }
    if (const auto it = game->metadata.values.find("background_color"); it != game->metadata.values.end()) {
        game->backgroundColor = it->second;
    }

    // Colors (best-effort): default to black/white like the canonical engine
    // when not explicitly overridden. Palette resolution is a later step; for
    // IR-diff debugging we want stable, non-empty values.
    if (game->foregroundColor.empty()) {
        game->foregroundColor = "#FFFFFF";
    }
    if (game->backgroundColor.empty()) {
        game->backgroundColor = "#000000";
    }

    // --- Objects, layers, ids ---
    game->collisionLayers = state.collisionLayers;
    game->layerCount = static_cast<int32_t>(game->collisionLayers.size());

    std::vector<int32_t> idLayerById;
    int32_t idCount = 0;
    for (int32_t layerIndex = 0; layerIndex < static_cast<int32_t>(state.collisionLayers.size()); ++layerIndex) {
        for (const auto& name : state.collisionLayers[static_cast<size_t>(layerIndex)]) {
            if (state.objects.find(name) == state.objects.end()) {
                continue;
            }
            game->idDict.push_back(name);
            idLayerById.push_back(layerIndex);
            ++idCount;
        }
    }
    game->objectCount = idCount;

    game->strideObject = static_cast<int32_t>(ceilDivU32(static_cast<uint32_t>(game->objectCount), puzzlescript::kMaskWordBits));
    game->wordCount = static_cast<uint32_t>(game->strideObject);
    game->strideMovement = static_cast<int32_t>(puzzlescript::movementStrideWordCount(static_cast<uint32_t>(game->layerCount)));
    game->movementWordCount = static_cast<uint32_t>(game->strideMovement);

    game->objectsById.resize(static_cast<size_t>(game->objectCount));

    // Build object defs and objectMaskTable.
    game->objectMaskTable.clear();
    game->objectMaskTable.reserve(static_cast<size_t>(game->objectCount));

    // Name -> id lookup by *last* idDict index. Some games accidentally
    // duplicate object names in collision layers; JS ends up using the later id
    // as the canonical one (and leaves earlier slots without an object def in
    // the IR objects list), but ids still exist in id_dict/collision_layers.
    std::map<std::string, int32_t> objectIdByName;
    for (int32_t id = 0; id < static_cast<int32_t>(game->idDict.size()); ++id) {
        const auto& nm = game->idDict[static_cast<size_t>(id)];
        objectIdByName[nm] = id;
    }

    // Fill objectsById for every id entry. (Even if JS omits duplicates from
    // the serialized `objects` list, runtime logic still expects stable ids,
    // layers, and names.)
    for (int32_t id = 0; id < static_cast<int32_t>(game->idDict.size()); ++id) {
            const auto& name = game->idDict[static_cast<size_t>(id)];
            const auto it = state.objects.find(name);
            if (it == state.objects.end()) {
                continue;
            }
            const int32_t layerIndex = (static_cast<size_t>(id) < idLayerById.size()) ? idLayerById[static_cast<size_t>(id)] : 0;
            const auto canonIt = objectIdByName.find(name);
            const bool isCanonical = (canonIt != objectIdByName.end() && canonIt->second == id);
            puzzlescript::ObjectDef def;
            def.name = name;
            def.id = id;
            // Non-canonical duplicate ids exist in id_dict, but JS does not
            // treat them as real objects for layer masks / clearing.
            def.layer = isCanonical ? layerIndex : -1;
            if (isCanonical) {
                def.colors = it->second.colors;
                if (!it->second.spritematrix.empty()) {
                    def.sprite = parseSpriteMatrix(it->second.spritematrix);
                } else {
                    def.sprite = std::vector<std::vector<int32_t>>(5, std::vector<int32_t>(5, 0));
                }
            }
            game->objectsById[static_cast<size_t>(id)] = std::move(def);

            // objectMaskTable is name-keyed; keep one entry per name (canonical id).
            if (canonIt != objectIdByName.end() && canonIt->second == id) {
                auto mask = makeEmptyMask(game->wordCount);
                setMaskBit(mask, id);
                const auto offset = storeMaskWords(*game, mask);
                game->objectMaskTable.push_back({name, offset});
            }
    }

    // layer masks
    game->layerMaskOffsets.clear();
    game->layerMaskOffsets.reserve(static_cast<size_t>(game->layerCount));
    for (int32_t layerIndex = 0; layerIndex < game->layerCount; ++layerIndex) {
        auto mask = makeEmptyMask(game->wordCount);
        for (int32_t id = 0; id < game->objectCount; ++id) {
            if (game->objectsById[static_cast<size_t>(id)].layer == layerIndex) {
                setMaskBit(mask, id);
            }
        }
        game->layerMaskOffsets.push_back(storeMaskWords(*game, mask));
    }

    // --- Background / player masks ---

    // --- Legend resolution (name -> object mask) ---
    std::map<std::string, puzzlescript::MaskVector> resolvedMasks;
    std::map<std::string, std::string> synonymOf;
    std::map<std::string, std::vector<std::string>> aggregateOf;
    std::map<std::string, std::vector<std::string>> propertyOf;

    for (const auto& entry : state.legendSynonyms) {
        if (!entry.items.empty()) {
            synonymOf[toLowerAsciiCopy(entry.name)] = toLowerAsciiCopy(entry.items.front());
        }
    }
    for (const auto& entry : state.legendAggregates) {
        std::vector<std::string> items;
        items.reserve(entry.items.size());
        for (const auto& item : entry.items) items.push_back(toLowerAsciiCopy(item));
        aggregateOf[toLowerAsciiCopy(entry.name)] = std::move(items);
    }
    for (const auto& entry : state.legendProperties) {
        std::vector<std::string> items;
        items.reserve(entry.items.size());
        for (const auto& item : entry.items) items.push_back(toLowerAsciiCopy(item));
        propertyOf[toLowerAsciiCopy(entry.name)] = std::move(items);
    }
    {
        bool modified = true;
        while (modified) {
            modified = false;

            std::vector<std::string> synonymKeys;
            synonymKeys.reserve(synonymOf.size());
            for (const auto& [name, _] : synonymOf) {
                synonymKeys.push_back(name);
            }
            for (const auto& name : synonymKeys) {
                auto it = synonymOf.find(name);
                if (it == synonymOf.end()) {
                    continue;
                }
                const std::string value = it->second;
                if (const auto propIt = propertyOf.find(value); propIt != propertyOf.end()) {
                    propertyOf[name] = propIt->second;
                    synonymOf.erase(it);
                    modified = true;
                } else if (const auto aggIt = aggregateOf.find(value); aggIt != aggregateOf.end()) {
                    aggregateOf[name] = aggIt->second;
                    synonymOf.erase(it);
                    modified = true;
                } else if (const auto synIt = synonymOf.find(value); synIt != synonymOf.end()) {
                    it->second = synIt->second;
                }
            }

            std::vector<std::string> propertyKeys;
            propertyKeys.reserve(propertyOf.size());
            for (const auto& [name, _] : propertyOf) {
                propertyKeys.push_back(name);
            }
            for (const auto& name : propertyKeys) {
                auto it = propertyOf.find(name);
                if (it == propertyOf.end()) {
                    continue;
                }
                auto& values = it->second;
                for (size_t i = 0; i < values.size(); ++i) {
                    const std::string value = values[i];
                    if (const auto synIt = synonymOf.find(value); synIt != synonymOf.end()) {
                        values[i] = synIt->second;
                        modified = true;
                        continue;
                    }
                    const auto propIt = propertyOf.find(value);
                    if (propIt != propertyOf.end()) {
                        values.erase(values.begin() + static_cast<std::ptrdiff_t>(i));
                        for (const auto& expanded : propIt->second) {
                            if (std::find(values.begin(), values.end(), expanded) == values.end()) {
                                values.push_back(expanded);
                            }
                        }
                        modified = true;
                        --i;
                    }
                }
            }

            std::vector<std::string> aggregateKeys;
            aggregateKeys.reserve(aggregateOf.size());
            for (const auto& [name, _] : aggregateOf) {
                aggregateKeys.push_back(name);
            }
            for (const auto& name : aggregateKeys) {
                auto it = aggregateOf.find(name);
                if (it == aggregateOf.end()) {
                    continue;
                }
                auto& values = it->second;
                for (size_t i = 0; i < values.size(); ++i) {
                    const std::string value = values[i];
                    if (const auto synIt = synonymOf.find(value); synIt != synonymOf.end()) {
                        values[i] = synIt->second;
                        modified = true;
                        continue;
                    }
                    const auto aggIt = aggregateOf.find(value);
                    if (aggIt != aggregateOf.end()) {
                        values.erase(values.begin() + static_cast<std::ptrdiff_t>(i));
                        for (const auto& expanded : aggIt->second) {
                            if (std::find(values.begin(), values.end(), expanded) == values.end()) {
                                values.push_back(expanded);
                            }
                        }
                        modified = true;
                        --i;
                    }
                }
            }
        }
    }

    // Mirrors compiler.js `propertiesSingleLayer`: OR-properties whose members all
    // share one collision layer (used to skip `concretizePropertyRule` explosion).
    std::map<std::string, int32_t> propertiesSingleLayer;
    for (const auto& [propName, aliases] : propertyOf) {
        if (aliases.empty()) {
            continue;
        }
        std::optional<int32_t> commonLayer;
        bool ok = true;
        for (const auto& al : aliases) {
            const auto it = objectIdByName.find(al);
            if (it == objectIdByName.end()) {
                ok = false;
                break;
            }
            const int32_t L = game->objectsById[static_cast<size_t>(it->second)].layer;
            if (!commonLayer.has_value()) {
                commonLayer = L;
            } else if (*commonLayer != L) {
                ok = false;
                break;
            }
        }
        if (ok && commonLayer.has_value()) {
            propertiesSingleLayer[propName] = *commonLayer;
        }
    }

    // JS-style glyphDict: maps a glyph name to a per-layer concrete object id,
    // where -1 means "no object for this layer". This includes:
    // - concrete objects
    // - synonyms
    // - aggregates (AND)
    // Properties (OR) are intentionally *excluded* (ambiguous in maps).
    const std::vector<int32_t> blankGlyph(static_cast<size_t>(game->layerCount), -1);
    std::map<std::string, std::vector<int32_t>> glyphDict;

    for (const auto& [name, id] : objectIdByName) {
        const int32_t layer = game->objectsById[static_cast<size_t>(id)].layer;
        auto glyph = blankGlyph;
        if (layer >= 0 && layer < game->layerCount) {
            glyph[static_cast<size_t>(layer)] = id;
        }
        glyphDict.emplace(name, std::move(glyph));
    }

    bool added = true;
    while (added) {
        added = false;
        // synonyms
        for (const auto& entry : state.legendSynonyms) {
            if (entry.items.empty()) {
                continue;
            }
            const auto key = toLowerAsciiCopy(entry.name);
            const auto val = toLowerAsciiCopy(entry.items.front());
            if (glyphDict.find(key) == glyphDict.end()) {
                const auto it = glyphDict.find(val);
                if (it != glyphDict.end()) {
                    glyphDict.emplace(key, it->second);
                    added = true;
                }
            }
        }
        // aggregates (AND)
        for (const auto& entry : state.legendAggregates) {
            const auto key = toLowerAsciiCopy(entry.name);
            if (glyphDict.find(key) != glyphDict.end()) {
                continue;
            }
            bool allFound = true;
            for (const auto& item : entry.items) {
                if (glyphDict.find(toLowerAsciiCopy(item)) == glyphDict.end()) {
                    allFound = false;
                    break;
                }
            }
            if (!allFound) {
                continue;
            }
            auto glyph = blankGlyph;
            for (const auto& item : entry.items) {
                const auto& sub = glyphDict[toLowerAsciiCopy(item)];
                for (size_t layer = 0; layer < glyph.size(); ++layer) {
                    if (sub[layer] >= 0) {
                        glyph[layer] = sub[layer];
                    }
                }
            }
            glyphDict.emplace(key, std::move(glyph));
            added = true;
        }
        // properties (OR) intentionally skipped for glyphDict (ambiguous in maps)
    }

    auto resolveMask = [&](auto&& self, const std::string& name, std::set<std::string>& visiting) -> puzzlescript::MaskVector {
        if (auto it = resolvedMasks.find(name); it != resolvedMasks.end()) {
            return it->second;
        }
        if (!visiting.insert(name).second) {
            throw std::runtime_error("Legend cycle detected at '" + name + "'");
        }

        puzzlescript::MaskVector mask = makeEmptyMask(game->wordCount);

        if (auto it = objectIdByName.find(name); it != objectIdByName.end()) {
            setMaskBit(mask, it->second);
        } else if (auto it = synonymOf.find(name); it != synonymOf.end()) {
            mask = self(self, it->second, visiting);
        } else if (auto it = aggregateOf.find(name); it != aggregateOf.end()) {
            for (const auto& item : it->second) {
                auto itemMask = self(self, item, visiting);
                for (size_t w = 0; w < mask.size(); ++w) {
                    mask[w] |= itemMask[w];
                }
            }
        } else if (auto it = propertyOf.find(name); it != propertyOf.end()) {
            for (const auto& item : it->second) {
                auto itemMask = self(self, item, visiting);
                for (size_t w = 0; w < mask.size(); ++w) {
                    mask[w] |= itemMask[w];
                }
            }
        } else {
            // Unknown legend key: leave as empty mask for now.
        }

        visiting.erase(name);
        resolvedMasks.emplace(name, mask);
        return mask;
    };

    auto storeLegendMaskTable = [&](const auto& legends, std::vector<puzzlescript::Game::NamedMaskEntry>& table) {
        table.clear();
        table.reserve(legends.size());
        for (const auto& [name, _] : legends) {
            try {
                std::set<std::string> visiting;
                const puzzlescript::MaskVector mask = resolveMask(resolveMask, name, visiting);
                if (!maskHasAnyBit(mask)) {
                    continue;
                }
                table.push_back({name, storeMaskWords(*game, mask)});
            } catch (...) {
                // Keep lowering tolerant of malformed cyclic legend input.
            }
        }
    };
    storeLegendMaskTable(synonymOf, game->synonymMaskTable);
    storeLegendMaskTable(aggregateOf, game->aggregateMaskTable);
    storeLegendMaskTable(propertyOf, game->propertyMaskTable);

    // Player mask: prefer a concrete object named "player"; otherwise resolve
    // the legend key "player" (common: Player = Foo or Bar).
    {
        auto playerMaskWords = makeEmptyMask(game->wordCount);
        const auto playerIt = objectIdByName.find("player");
        if (playerIt != objectIdByName.end()) {
            setMaskBit(playerMaskWords, playerIt->second);
            game->playerMaskAggregate = false;
        } else {
            try {
                std::set<std::string> visiting;
                playerMaskWords = resolveMask(resolveMask, "player", visiting);
                game->playerMaskAggregate = (aggregateOf.find("player") != aggregateOf.end());
            } catch (...) {
                // leave empty
            }
        }
        game->playerMask = storeMaskWords(*game, playerMaskWords);
    }

    // Resolve background object/property.
    puzzlescript::MaskVector backgroundMaskWords = makeEmptyMask(game->wordCount);
    int32_t backgroundLayer = -1;
    {
        // Prefer a concrete object named "background" (matches JS).
        const auto bgObjIt = objectIdByName.find("background");
        if (bgObjIt != objectIdByName.end()) {
            setMaskBit(backgroundMaskWords, bgObjIt->second);
            backgroundLayer = game->objectsById[static_cast<size_t>(bgObjIt->second)].layer;
            game->backgroundId = bgObjIt->second;
            game->backgroundLayer = backgroundLayer;
        } else {
            try {
                std::set<std::string> visiting;
                backgroundMaskWords = resolveMask(resolveMask, "background", visiting);
                // Infer background layer from first set bit.
                for (int32_t id = 0; id < game->objectCount; ++id) {
                    if (maskHasBit(backgroundMaskWords, id)) {
                        backgroundLayer = game->objectsById[static_cast<size_t>(id)].layer;
                        game->backgroundId = id;
                        game->backgroundLayer = backgroundLayer;
                        break;
                    }
                }
                // JS semantics: background must be a *single concrete object* for
                // map default fills. If background is a property/aggregate, pick
                // the first concrete object id and use only that bit.
                if (game->backgroundId >= 0) {
                    backgroundMaskWords = makeEmptyMask(game->wordCount);
                    setMaskBit(backgroundMaskWords, game->backgroundId);
                }
            } catch (...) {
                // Leave unset; suite-green will enforce correctness.
            }
        }
    }

    // --- Levels ---
    game->levels.clear();
    game->levels.reserve(state.levels.size());
    for (const auto& srcLevel : state.levels) {
        // Parser may retain empty placeholder level entries (notably a trailing
        // one); JS compiler drops them.
        if (!srcLevel.isMessage && srcLevel.rows.empty() && !srcLevel.lineNumber.has_value()) {
            continue;
        }
        puzzlescript::LevelTemplate level;
        level.isMessage = srcLevel.isMessage;
        if (level.isMessage) {
            level.message = srcLevel.message;
            game->levels.push_back(std::move(level));
            continue;
        }
        if (srcLevel.lineNumber.has_value()) {
            level.lineNumber = *srcLevel.lineNumber;
        }
        level.height = static_cast<int32_t>(srcLevel.rows.size());
        if (!srcLevel.rows.empty()) {
            level.width = static_cast<int32_t>(splitUtf8Codepoints(srcLevel.rows.front()).size());
        } else {
            level.width = 0;
        }
        const int32_t tileCount = level.width * level.height;
        level.objects.assign(static_cast<size_t>(tileCount * game->strideObject), 0);

        const auto glyphAt = [](const std::vector<std::string>& glyphs, int32_t x) -> std::string {
            if (glyphs.empty()) {
                return {};
            }
            if (x < static_cast<int32_t>(glyphs.size())) {
                return glyphs[static_cast<size_t>(x)];
            }
            // JS levelFromString repeats the row's last character for ragged rows.
            return glyphs.back();
        };

        // Per-level default background: if the level explicitly uses a concrete
        // background-layer glyph (e.g. WoodenFloor), JS effectively treats that
        // as the fill under obstacles/walls in cells without background glyphs.
        int32_t levelBackgroundId = game->backgroundId;
        bool foundLevelBackground = false;
        if (backgroundLayer >= 0) {
            for (int32_t y = 0; y < level.height && !foundLevelBackground; ++y) {
                const auto glyphs = splitUtf8Codepoints(srcLevel.rows[static_cast<size_t>(y)]);
                for (int32_t x = 0; x < level.width; ++x) {
                    const std::string glyph = glyphAt(glyphs, x);
                    if (glyph.empty()) {
                        continue;
                    }
                    const auto it = glyphDict.find(glyph);
                    if (it == glyphDict.end()) {
                        continue;
                    }
                    const auto& perLayer = it->second;
                    if (static_cast<size_t>(backgroundLayer) < perLayer.size()) {
                        const int32_t id = perLayer[static_cast<size_t>(backgroundLayer)];
                        if (id >= 0) {
                            levelBackgroundId = id;
                            foundLevelBackground = true;
                            break;
                        }
                    }
                }
            }
        }
        auto levelBackgroundMaskWords = makeEmptyMask(game->wordCount);
        if (levelBackgroundId >= 0) {
            setMaskBit(levelBackgroundMaskWords, levelBackgroundId);
        }

        for (int32_t y = 0; y < level.height; ++y) {
            const auto glyphs = splitUtf8Codepoints(srcLevel.rows[static_cast<size_t>(y)]);
            for (int32_t x = 0; x < level.width; ++x) {
                const std::string glyph = glyphAt(glyphs, x);
                puzzlescript::MaskVector cellMask = makeEmptyMask(game->wordCount);
                if (!glyph.empty()) {
                    try {
                        const auto it = glyphDict.find(glyph);
                        if (it != glyphDict.end()) {
                            const auto& perLayer = it->second;
                            for (size_t layer = 0; layer < perLayer.size(); ++layer) {
                                const int32_t id = perLayer[layer];
                                if (id >= 0) {
                                    setMaskBit(cellMask, id);
                                }
                            }
                        }
                    } catch (...) {
                        // Ignore glyph failures for now; suite-green will harden this.
                    }
                }

                // JS semantics: if background layer is empty in this cell, add background mask.
                if (backgroundLayer >= 0 && static_cast<size_t>(backgroundLayer) < game->layerMaskOffsets.size()) {
                    const auto layerMaskOffset = game->layerMaskOffsets[static_cast<size_t>(backgroundLayer)];
                    const puzzlescript::MaskWord* layerMask = game->maskArena.data() + layerMaskOffset;
                    bool anyBackgroundLayer = false;
                    for (uint32_t w = 0; w < game->wordCount; ++w) {
                        if ((cellMask[w] & layerMask[w]) != 0) {
                            anyBackgroundLayer = true;
                            break;
                        }
                    }
                    if (!anyBackgroundLayer) {
                        for (size_t w = 0; w < cellMask.size(); ++w) {
                            cellMask[w] |= levelBackgroundMaskWords[w];
                        }
                    }
                }

                // Runtime tile indexing is column-major: tileIndex = x*height + y.
                const int32_t tileIndex = x * level.height + y;
                const size_t base = static_cast<size_t>(tileIndex * game->strideObject);
                for (int32_t w = 0; w < game->strideObject; ++w) {
                    level.objects[base + static_cast<size_t>(w)] = cellMask[static_cast<size_t>(w)];
                }
            }
        }
        game->levels.push_back(std::move(level));
    }

    // --- Prepared session ---
    initialMetaGameState.currentLevelIndex = 0;
    initialMetaGameState.currentLevelTarget.reset();
    initialMetaGameState.titleScreen = false;
    initialMetaGameState.textMode = !game->levels.empty() && game->levels.front().isMessage;
    initialMetaGameState.titleMode = 0;
    initialMetaGameState.titleSelection = 0;
    initialMetaGameState.titleSelected = false;
    initialMetaGameState.messageSelected = false;
    initialMetaGameState.messageText.clear();
    initialMetaGameState.winning = false;
    initialMetaGameState.loadedLevelSeed = "native";
    initialMetaGameState.hasRandomState = false;
    initialMetaGameState.randomStateValid = false;
    initialMetaGameState.randomStateS.clear();
    initialMetaGameState.oldFlickscreenDat.clear();
    if (!game->levels.empty()) {
        initialMetaGameState.level = game->levels.front();
        initialMetaGameState.restart.objects = initialMetaGameState.level.objects;
        initialMetaGameState.restart.oldFlickscreenDat.clear();
    }

    // --- Rules / winconditions / sounds / loop points ---
    game->rules.clear();
    game->lateRules.clear();
    std::vector<int32_t> loopStartStack;
    std::vector<std::pair<int32_t, int32_t>> loopRanges;

    // Precompute (best-effort) single-layer info for legend names: if a mask's
    // set bits all live on the same collision layer, we can treat it as
    // single-layer for rule movement masks.
    auto maskSingleLayer = [&](const puzzlescript::MaskVector& mask) -> std::optional<int32_t> {
        std::optional<int32_t> layer;
        for (int32_t id = 0; id < game->objectCount; ++id) {
            if (!maskHasBit(mask, id)) {
                continue;
            }
            const int32_t objLayer = game->objectsById[static_cast<size_t>(id)].layer;
            if (!layer.has_value()) {
                layer = objLayer;
            } else if (*layer != objLayer) {
                return std::nullopt;
            }
        }
        return layer;
    };

    std::vector<std::vector<std::string>> earlyRuleSignatures;
    std::vector<std::vector<std::string>> lateRuleSignatures;

    // Rule lowering: a subset of JS rulesToMask (enough to start converging).
    for (const auto& entry : state.rules) {
        const auto tokens = ruletext::tokenizeRuleLine(entry.rule);
        const auto mixedCaseTokens = ruletext::tokenizeRuleLine(takeRulePrefixBeforeComment(entry.mixedCase));
        const std::string lowerMixedCaseLine = toLowerAsciiCopy(entry.mixedCase);
        if (tokens.empty()) {
            continue;
        }
        // Handle loop markers.
        const std::string marker = tokens.front();
        if (marker == "startloop" || marker == "endloop") {
            if (marker == "startloop") {
                loopStartStack.push_back(entry.lineNumber);
            } else {
                if (!loopStartStack.empty()) {
                    const int32_t startLine = loopStartStack.back();
                    loopStartStack.pop_back();
                    loopRanges.emplace_back(startLine, entry.lineNumber);
                }
            }
            continue;
        }
        auto arrowIt = tokens.end();
        int32_t arrowSearchBracketDepth = 0;
        for (auto it = tokens.begin(); it != tokens.end(); ++it) {
            if (*it == "[") {
                ++arrowSearchBracketDepth;
                continue;
            }
            if (*it == "]") {
                --arrowSearchBracketDepth;
                continue;
            }
            if (*it == "->") {
                if (arrowSearchBracketDepth == 0) {
                    arrowIt = it;
                    break;
                }
            }
        }
        if (std::find(tokens.begin(), tokens.end(), "->") == tokens.end()) {
            continue;
        }

        // Directions/modifiers at start (optional). JS defaults rules with no
        // explicit direction to orthogonal, then (for non-directional rules only)
        // keeps the first scan direction only — see `directionalRule` + `splice(1)`
        // in compiler.js `processRuleString`.
        size_t cursor = 0;
        bool rigidRule = false;
        bool randomRule = false;
        bool lateRule = false;
        bool sameGroup = false;
        std::vector<std::string> ruleDirections;
        std::vector<std::string> authoredDirections;
        auto addDirectionAggregate = [&](const std::string& token) {
            if (token == "horizontal") {
                ruleDirections.push_back("left");
                ruleDirections.push_back("right");
            } else if (token == "vertical") {
                ruleDirections.push_back("up");
                ruleDirections.push_back("down");
            } else if (token == "orthogonal") {
                ruleDirections.push_back("up");
                ruleDirections.push_back("down");
                ruleDirections.push_back("left");
                ruleDirections.push_back("right");
            }
        };
        while (cursor < tokens.size() && tokens[cursor] != "[") {
            const std::string token = tokens[cursor];
            if (token == "up" || token == "down" || token == "left" || token == "right") {
                authoredDirections.push_back(token);
                ruleDirections.push_back(token);
            } else if (token == "horizontal" || token == "vertical" || token == "orthogonal") {
                authoredDirections.push_back(token);
                addDirectionAggregate(token);
            } else if (token == "rigid") {
                rigidRule = true;
            } else if (token == "random") {
                randomRule = true;
            } else if (token == "late") {
                lateRule = true;
            } else if (token == "+") {
                sameGroup = true;
            }
            ++cursor;
        }
        if (ruleDirections.empty()) {
            addDirectionAggregate("orthogonal");
        }

        // JS grouping: each rule line starts a new group unless prefixed by "+".
        std::vector<std::vector<puzzlescript::Rule>>& groups = lateRule ? game->lateRules : game->rules;
        std::vector<std::vector<std::string>>& groupSignatures = lateRule ? lateRuleSignatures : earlyRuleSignatures;
        if (groups.empty() || !sameGroup) {
            groups.emplace_back();
            groupSignatures.emplace_back();
        }
        std::vector<puzzlescript::Rule>* outputGroup = &groups.back();
        std::vector<std::string>* outputSignatures = &groupSignatures.back();

        struct ParsedItem {
            std::string dir;
            std::string name;
        };
        struct ParsedCell {
            bool isEllipsis = false;
            std::vector<ParsedItem> items;
        };
        using ParsedRow = std::vector<ParsedCell>;

        // Mirrors src/js/languageConstants.js `commandwords` for tokens that may
        // appear inside RHS brackets (legacy): sfxN / cancel / checkpoint / …
        // Sound-only names like `Sfx1` lower-case to `sfx1` and are not in
        // `state.names` in JS, so they become commands rather than cell objects.
        auto cellNameRefersToLegendOrObject = [&](const std::string& name) -> bool {
            return objectIdByName.find(name) != objectIdByName.end()
                || synonymOf.find(name) != synonymOf.end()
                || aggregateOf.find(name) != aggregateOf.end()
                || propertyOf.find(name) != propertyOf.end();
        };
        auto isJsBracketPostfixCommand = [](const std::string& name) -> bool {
            static constexpr std::array<const char*, 17> kWords = {
                "sfx0", "sfx1", "sfx2", "sfx3", "sfx4", "sfx5", "sfx6", "sfx7", "sfx8", "sfx9", "sfx10",
                "cancel", "checkpoint", "restart", "win", "message", "again",
            };
            for (const char* w : kWords) {
                if (name == w) {
                    return true;
                }
            }
            return false;
        };

        auto parseSide = [&](size_t start, size_t end, std::vector<puzzlescript::RuleCommand>* inlineCommandSink) -> std::vector<ParsedRow> {
            std::vector<ParsedRow> rows;
            size_t i = start;
            while (i < end) {
                if (tokens[i] != "[") {
                    ++i;
                    continue;
                }
                ++i; // consume '['
                ParsedRow current;
                ParsedCell cell;
                while (i < end && tokens[i] != "]") {
                    if (tokens[i] == "|") {
                        current.push_back(std::move(cell));
                        cell = ParsedCell{};
                        ++i;
                        continue;
                    }
                    if (tokens[i] == "...") {
                        cell.isEllipsis = true;
                        ++i;
                        continue;
                    }
                    std::string dir;
                    std::string name = tokens[i];
                    const std::string tokLower = toLowerAsciiCopy(tokens[i]);
                    if ((dirMaskFromToken(tokLower) != 0 || tokLower == "stationary" || tokLower == "no" || tokLower == "random"
                         || tokLower == "randomdir")
                        && (i + 1) < end) {
                        dir = tokLower;
                        name = tokens[i + 1];
                        i += 2;
                    } else {
                        i += 1;
                    }
                    if (name == "|") {
                        continue;
                    }
                    // Legend/property maps are lower-case (see legend parsing). JS rule
                    // matching is case-insensitive for object/property names and movement
                    // keywords like MOVING / STATIONARY.
                    const std::string nameNorm = toLowerAsciiCopy(name);
                    std::string dirNorm = dir;
                    if (!dirNorm.empty()) {
                        dirNorm = toLowerAsciiCopy(dirNorm);
                    }
                    if (inlineCommandSink != nullptr && dirNorm.empty() && isJsBracketPostfixCommand(nameNorm)
                        && !cellNameRefersToLegendOrObject(nameNorm)) {
                        puzzlescript::RuleCommand cmd;
                        cmd.name = nameNorm;
                        if (cmd.name == "message") {
                            cmd.argument = messageTextFromRuleLine(
                                entry.mixedCase, lowerMixedCaseLine, tokens, i);
                            inlineCommandSink->push_back(std::move(cmd));
                            return rows;
                        }
                        inlineCommandSink->push_back(std::move(cmd));
                        continue;
                    }
                    if (!cellNameRefersToLegendOrObject(nameNorm)) {
                        continue;
                    }
                    cell.items.push_back({std::move(dirNorm), std::move(nameNorm)});
                }
                if (i >= end || tokens[i] != "]") {
                    break;
                }
                // Always push the last cell, even if empty. This is required for
                // rules like `[ | | ]` where empty RHS cells represent clearing.
                current.push_back(std::move(cell));
                ++i;
                if (!current.empty()) {
                    rows.push_back(std::move(current));
                }
            }
            return rows;
        };

        const size_t arrowPos = arrowIt == tokens.end()
            ? tokens.size()
            : static_cast<size_t>(std::distance(tokens.begin(), arrowIt));
        const size_t rhsEnd = tokens.size();
        auto firstTopLevelPostfixCommand = [&]() -> size_t {
            if (arrowPos >= tokens.size()) {
                return rhsEnd;
            }
            int32_t bracketDepth = 0;
            for (size_t i = arrowPos + 1; i < rhsEnd; ++i) {
                if (tokens[i] == "[") {
                    ++bracketDepth;
                    continue;
                }
                if (tokens[i] == "]") {
                    if (bracketDepth > 0) {
                        --bracketDepth;
                    }
                    continue;
                }
                if (bracketDepth == 0 && tokens[i] == "message") {
                    return i;
                }
            }
            return rhsEnd;
        }();
        std::vector<puzzlescript::RuleCommand> parsedCommands;
        auto lhsRows = parseSide(cursor, arrowPos, nullptr);
        auto rhsRows = arrowPos < tokens.size()
            ? parseSide(arrowPos + 1, firstTopLevelPostfixCommand, &parsedCommands)
            : std::vector<ParsedRow>{};

        auto maskTouchesLayer = [&](const puzzlescript::MaskVector& mask, int32_t layer) -> bool {
            if (layer < 0 || layer >= game->layerCount) {
                return false;
            }
            const auto off = game->layerMaskOffsets[static_cast<size_t>(layer)];
            for (uint32_t w = 0; w < game->wordCount; ++w) {
                const puzzlescript::MaskWord layerWord = game->maskArena[static_cast<size_t>(off + w)];
                if ((mask[static_cast<size_t>(w)] & layerWord) != 0) {
                    return true;
                }
            }
            return false;
        };
        auto trimSuperfluousLhsNegations = [&]() {
            for (auto& row : lhsRows) {
                for (auto& cell : row) {
                    if (cell.isEllipsis) {
                        continue;
                    }
                    auto requiredObjects = makeEmptyMask(game->wordCount);
                    std::vector<int32_t> requiredLayers(static_cast<size_t>(game->layerCount), 0);
                    for (const auto& item : cell.items) {
                        if (item.dir == "no") {
                            continue;
                        }
                        auto addRequiredObject = [&](const std::string& objectName) {
                            const auto objectIt = objectIdByName.find(objectName);
                            if (objectIt == objectIdByName.end()) {
                                return;
                            }
                            setMaskBit(requiredObjects, objectIt->second);
                            const auto& object = game->objectsById[static_cast<size_t>(objectIt->second)];
                            if (object.layer >= 0 && object.layer < game->layerCount) {
                                requiredLayers[static_cast<size_t>(object.layer)] = 1;
                            }
                        };
                        if (objectIdByName.find(item.name) != objectIdByName.end()) {
                            addRequiredObject(item.name);
                        } else if (const auto aggregateIt = aggregateOf.find(item.name); aggregateIt != aggregateOf.end()) {
                            for (const auto& objectName : aggregateIt->second) {
                                addRequiredObject(objectName);
                            }
                        } else if (const auto propertyLayerIt = propertiesSingleLayer.find(item.name);
                                   propertyLayerIt != propertiesSingleLayer.end()) {
                            requiredLayers[static_cast<size_t>(propertyLayerIt->second)] = 1;
                            if (const auto propertyIt = propertyOf.find(item.name); propertyIt != propertyOf.end()) {
                                for (const auto& objectName : propertyIt->second) {
                                    const auto objectIt = objectIdByName.find(objectName);
                                    if (objectIt != objectIdByName.end()) {
                                        setMaskBit(requiredObjects, objectIt->second);
                                    }
                                }
                            }
                        }
                    }

                    std::vector<ParsedItem> trimmed;
                    trimmed.reserve(cell.items.size());
                    for (const auto& item : cell.items) {
                        if (item.dir != "no") {
                            trimmed.push_back(item);
                            continue;
                        }
                        std::set<std::string> visiting;
                        const auto noMask = resolveMask(resolveMask, item.name, visiting);
                        bool disjointObjects = true;
                        for (uint32_t w = 0; w < game->wordCount; ++w) {
                            if ((noMask[static_cast<size_t>(w)] & requiredObjects[static_cast<size_t>(w)]) != 0) {
                                disjointObjects = false;
                                break;
                            }
                        }
                        bool layersCovered = true;
                        for (int32_t layer = 0; layer < game->layerCount; ++layer) {
                            if (maskTouchesLayer(noMask, layer)
                                && requiredLayers[static_cast<size_t>(layer)] == 0) {
                                layersCovered = false;
                                break;
                            }
                        }
                        if (disjointObjects && layersCovered) {
                            continue;
                        }
                        trimmed.push_back(item);
                    }
                    cell.items = std::move(trimmed);
                }
            }
        };
        auto removeRedundantRhsNegations = [&]() {
            const size_t rowCount = std::min(lhsRows.size(), rhsRows.size());
            for (size_t rowIndex = 0; rowIndex < rowCount; ++rowIndex) {
                const size_t cellCount = std::min(lhsRows[rowIndex].size(), rhsRows[rowIndex].size());
                for (size_t cellIndex = 0; cellIndex < cellCount; ++cellIndex) {
                    const auto& lhsCell = lhsRows[rowIndex][cellIndex];
                    auto& rhsCell = rhsRows[rowIndex][cellIndex];
                    if (lhsCell.isEllipsis || rhsCell.isEllipsis) {
                        continue;
                    }
                    for (size_t rhsIndex = 0; rhsIndex < rhsCell.items.size(); ++rhsIndex) {
                        const auto& rhsItem = rhsCell.items[rhsIndex];
                        if (rhsItem.dir == "no") {
                            for (const auto& lhsItem : lhsCell.items) {
                                if (lhsItem.dir == "no" && lhsItem.name == rhsItem.name) {
                                    // JS splices while iterating token pairs, so adjacent
                                    // redundant RHS negations leave every second one behind.
                                    rhsCell.items.erase(rhsCell.items.begin() + static_cast<std::ptrdiff_t>(rhsIndex));
                                    break;
                                }
                            }
                        }
                    }
                }
            }
        };
        removeRedundantRhsNegations();
        trimSuperfluousLhsNegations();

        // JS `processRuleString`: if `directionalRule(rule_line) === false` and
        // `rule_line.directions.length > 1`, only the first direction is kept.
        const auto isDirectionalRule = [](const std::vector<ParsedRow>& lhs, const std::vector<ParsedRow>& rhs) -> bool {
            static const std::set<std::string> kRelativeDirs = {"^", "v", "<", ">", "perpendicular", "parallel"};
            const auto rowsDirectional = [](const std::vector<ParsedRow>& rows, const std::set<std::string>& rel) -> bool {
                for (const auto& row : rows) {
                    if (row.size() > 1) {
                        return true;
                    }
                    for (const auto& cell : row) {
                        if (cell.isEllipsis) {
                            continue;
                        }
                        for (const auto& item : cell.items) {
                            if (rel.find(item.dir) != rel.end()) {
                                return true;
                            }
                        }
                    }
                }
                return false;
            };
            return rowsDirectional(lhs, kRelativeDirs) || rowsDirectional(rhs, kRelativeDirs);
        };
        if (!isDirectionalRule(lhsRows, rhsRows) && ruleDirections.size() > 1) {
            ruleDirections.erase(ruleDirections.begin() + 1, ruleDirections.end());
        }

        {
            int32_t bracketDepth = 0;
            for (size_t i = arrowPos + 1; i < tokens.size(); ++i) {
                if (tokens[i] == "[") {
                    ++bracketDepth;
                    continue;
                }
                if (tokens[i] == "]") {
                    if (bracketDepth > 0) {
                        --bracketDepth;
                    }
                    continue;
                }
                if (bracketDepth != 0 || !isJsBracketPostfixCommand(tokens[i])) {
                    continue;
                }
                puzzlescript::RuleCommand command;
                command.name = tokens[i];
                if (command.name == "message") {
                    command.argument = messageTextFromRuleLine(
                        entry.mixedCase, lowerMixedCaseLine, tokens, i);
                    parsedCommands.push_back(std::move(command));
                    break;
                }
                parsedCommands.push_back(std::move(command));
            }
        }

        if (outAuthoredRules != nullptr) {
            auto toSemanticRow = [](const std::vector<ParsedRow>& rows) {
                std::vector<SemanticRow> out;
                out.reserve(rows.size());
                for (const auto& row : rows) {
                    SemanticRow semRow;
                    semRow.reserve(row.size());
                    for (const auto& cell : row) {
                        SemanticCell semCell;
                        semCell.ellipsis = cell.isEllipsis;
                        semCell.terms.reserve(cell.items.size());
                        for (const auto& item : cell.items) {
                            semCell.terms.push_back(SemanticTerm{item.dir, item.name});
                        }
                        semRow.push_back(std::move(semCell));
                    }
                    out.push_back(std::move(semRow));
                }
                return out;
            };

            SemanticRule authored;
            authored.lineNumber = entry.lineNumber;
            authored.directions = authoredDirections;
            authored.rigid = rigidRule;
            authored.random = randomRule;
            authored.late = lateRule;
            authored.groupNumber = static_cast<int32_t>(groups.size()) - 1;
            authored.lhs = toSemanticRow(lhsRows);
            authored.rhs = toSemanticRow(rhsRows);
            authored.commands.reserve(parsedCommands.size());
            for (const auto& cmd : parsedCommands) {
                authored.commands.push_back(
                    SemanticRuleCommand{cmd.name, cmd.argument.value_or(std::string{})});
            }
            outAuthoredRules->push_back(std::move(authored));
        }

        auto absolutizeDir = [](const std::string& forward, const std::string& dir) -> std::string {
            // Match JS `absolutifyRuleCell` + `relativeDict` / `relativeDirs` in compiler.js.
            // `horizontal`, `vertical`, `orthogonal`, `moving`, etc. stay as aggregates
            // for aggregate expansion; ^ v < > parallel perpendicular become concrete/_par/_perp.
            if (dir == ">") return forward;
            if (dir == "<") {
                if (forward == "up") return "down";
                if (forward == "down") return "up";
                if (forward == "left") return "right";
                if (forward == "right") return "left";
            }
            if (dir == "^") {
                if (forward == "up") return "left";
                if (forward == "down") return "right";
                if (forward == "left") return "down";
                if (forward == "right") return "up";
            }
            if (dir == "v") {
                if (forward == "up") return "right";
                if (forward == "down") return "left";
                if (forward == "left") return "up";
                if (forward == "right") return "down";
            }
            if (dir == "parallel") {
                if (forward == "right" || forward == "left") return "horizontal_par";
                if (forward == "up" || forward == "down") return "vertical_par";
            }
            if (dir == "perpendicular") {
                if (forward == "right" || forward == "left") return "vertical_perp";
                if (forward == "up" || forward == "down") return "horizontal_perp";
            }
            return dir;
        };
        auto absolutizeRows = [&](std::vector<ParsedRow>& rows, const std::string& forward) {
            for (auto& row : rows) {
                for (auto& cell : row) {
                    for (auto& item : cell.items) {
                        item.dir = absolutizeDir(forward, item.dir);
                    }
                }
            }
        };
        auto rephraseSynonymsRows = [&](std::vector<ParsedRow>& lhs, std::vector<ParsedRow>& rhs) {
            auto processRows = [&](std::vector<ParsedRow>& rows) {
                for (auto& row : rows) {
                    for (auto& cell : row) {
                        if (cell.isEllipsis) {
                            continue;
                        }
                        for (auto& item : cell.items) {
                            if (const auto it = synonymOf.find(item.name); it != synonymOf.end()) {
                                item.name = it->second;
                            }
                        }
                    }
                }
            };
            processRows(lhs);
            processRows(rhs);
        };
        auto atomizeAggregatesRows = [&](std::vector<ParsedRow>& lhs, std::vector<ParsedRow>& rhs) {
            auto processRows = [&](std::vector<ParsedRow>& rows) {
                for (auto& row : rows) {
                    for (auto& cell : row) {
                        if (cell.isEllipsis) {
                            continue;
                        }
                        for (size_t i = 0; i < cell.items.size(); ++i) {
                            const auto aggregateIt = aggregateOf.find(cell.items[i].name);
                            if (aggregateIt == aggregateOf.end()) {
                                continue;
                            }
                            if (cell.items[i].dir == "no") {
                                throw std::runtime_error(
                                    "Rule at line " + std::to_string(entry.lineNumber)
                                    + " excludes aggregate " + cell.items[i].name + " with 'no', which JS forbids.");
                            }
                            const auto& equivalents = aggregateIt->second;
                            if (equivalents.empty()) {
                                continue;
                            }
                            cell.items[i].name = equivalents.front();
                            for (size_t j = 1; j < equivalents.size(); ++j) {
                                cell.items.push_back({cell.items[i].dir, equivalents[j]});
                            }
                        }
                    }
                }
            };
            processRows(lhs);
            processRows(rhs);
        };
        auto containsEllipsis = [](const std::vector<ParsedRow>& rows) {
            for (const auto& row : rows) {
                for (const auto& cell : row) {
                    if (cell.isEllipsis) {
                        return true;
                    }
                }
            }
            return false;
        };

        const auto concreteDirsForAggregate = [](const std::string& dir) -> const std::vector<std::string>* {
            static const std::vector<std::string> kHorizDirs = {"left", "right"};
            static const std::vector<std::string> kVertDirs = {"up", "down"};
            static const std::vector<std::string> kMovingDirs = {"up", "down", "left", "right", "action"};
            static const std::vector<std::string> kOrthDirs = {"up", "down", "left", "right"};
            static const std::vector<std::string> kPerpDirs = {"^", "v"};
            static const std::vector<std::string> kParDirs = {"<", ">"};
            if (dir == "horizontal" || dir == "horizontal_par" || dir == "horizontal_perp") return &kHorizDirs;
            if (dir == "vertical" || dir == "vertical_par" || dir == "vertical_perp") return &kVertDirs;
            if (dir == "moving") return &kMovingDirs;
            if (dir == "orthogonal") return &kOrthDirs;
            if (dir == "perpendicular") return &kPerpDirs;
            if (dir == "parallel") return &kParDirs;
            return nullptr;
        };

        auto isLayerCoupledPropertyName = [&](const std::string& nameLower) {
            return propertyOf.find(nameLower) != propertyOf.end()
                && propertiesSingleLayer.find(nameLower) == propertiesSingleLayer.end();
        };
        auto lhsHasOverlappingRequiredLayers = [&](const std::vector<ParsedRow>& rows) {
            for (const auto& row : rows) {
                for (const auto& cell : row) {
                    if (cell.isEllipsis) {
                        continue;
                    }
                    std::vector<uint8_t> usedLayers(static_cast<size_t>(game->layerCount), 0);
                    for (const auto& item : cell.items) {
                        if (item.dir == "no" || item.dir == "random") {
                            continue;
                        }
                        std::optional<int32_t> layer;
                        if (const auto objectIt = objectIdByName.find(item.name); objectIt != objectIdByName.end()) {
                            layer = game->objectsById[static_cast<size_t>(objectIt->second)].layer;
                        } else if (isLayerCoupledPropertyName(item.name)) {
                            continue;
                        } else if (const auto propertyLayerIt = propertiesSingleLayer.find(item.name);
                                   propertyLayerIt != propertiesSingleLayer.end()) {
                            layer = propertyLayerIt->second;
                        }
                        if (!layer.has_value() || *layer < 0 || *layer >= game->layerCount) {
                            continue;
                        }
                        auto& used = usedLayers[static_cast<size_t>(*layer)];
                        if (used != 0) {
                            return true;
                        }
                        used = 1;
                    }
                }
            }
            return false;
        };

        auto cellHasNoTermOverlappingProperty = [&](const ParsedCell& cell, const std::string& propertyName) {
            std::set<std::string> visiting;
            const auto propertyMask = resolveMask(resolveMask, propertyName, visiting);
            for (const auto& item : cell.items) {
                if (item.dir != "no") {
                    continue;
                }
                std::set<std::string> itemVisiting;
                const auto missingMask = resolveMask(resolveMask, item.name, itemVisiting);
                const size_t nWords = std::min(propertyMask.size(), missingMask.size());
                for (size_t w = 0; w < nWords; ++w) {
                    if ((propertyMask[w] & missingMask[w]) != 0) {
                        return true;
                    }
                }
            }
            return false;
        };

        struct AggregatePosition {
            size_t row = 0;
            size_t cell = 0;
            std::string name;
            std::optional<int32_t> layer;
            bool isLayerCoupled = false;
        };
        struct AggregateSinkPosition {
            size_t row = 0;
            size_t cell = 0;
            std::optional<int32_t> layer;
            std::string propertyName;
            bool localProperty = false;
        };
        struct AggregateBinding {
            size_t sourceRow = 0;
            size_t sourceCell = 0;
            std::optional<int32_t> sourceLayer;
            std::string sourcePropertyName;
            std::string aggregateName;
            int32_t aggregateMask = 0;
        };
        struct AggregateCoalescingPlan {
            std::set<std::string> safe;
            std::set<std::string> safePropertyAttachments;
            std::map<std::string, AggregateBinding> bindings;
            std::map<std::string, std::vector<AggregateSinkPosition>> sinks;
        };
        struct PropertySinkPosition {
            size_t row = 0;
            size_t cell = 0;
            std::string name;
        };
        struct PropertyCoalescingPlan {
            std::set<std::string> safe;
            std::map<std::string, puzzlescript::PropertyBinding> bindings;
            std::map<std::string, std::vector<PropertySinkPosition>> sinks;
        };

        auto collectAggregatePositions = [&](const std::vector<ParsedRow>& rows) {
            std::map<std::string, std::vector<AggregatePosition>> byDir;
            for (size_t row = 0; row < rows.size(); ++row) {
                for (size_t cell = 0; cell < rows[row].size(); ++cell) {
                    const ParsedCell& parsedCell = rows[row][cell];
                    if (parsedCell.isEllipsis) {
                        continue;
                    }
                    for (const auto& item : parsedCell.items) {
                        if (concreteDirsForAggregate(item.dir) == nullptr) {
                            continue;
                        }
                        const std::string nameLower = toLowerAsciiCopy(item.name);
                        AggregatePosition pos;
                        pos.row = row;
                        pos.cell = cell;
                        pos.name = nameLower;
                        pos.isLayerCoupled =
                            objectIdByName.find(nameLower) == objectIdByName.end()
                            && isLayerCoupledPropertyName(nameLower);
                        if (const auto it = objectIdByName.find(nameLower); it != objectIdByName.end()) {
                            pos.layer = game->objectsById[static_cast<size_t>(it->second)].layer;
                        } else if (const auto propIt = propertiesSingleLayer.find(nameLower);
                                   propIt != propertiesSingleLayer.end()) {
                            pos.layer = propIt->second;
                        }
                        byDir[item.dir].push_back(std::move(pos));
                    }
                }
            }
            return byDir;
        };

        auto ruleAllowsAggregateInferenceBinding = [&](const std::vector<ParsedRow>& lhs) {
            if (rigidRule || !parsedCommands.empty() || lhs.size() != 1) {
                return false;
            }
            for (const auto& cell : lhs[0]) {
                if (cell.isEllipsis) {
                    return false;
                }
            }
            return true;
        };

        auto computeAggregateCoalescingPlan = [&](const std::vector<ParsedRow>& lhs,
                                                  const std::vector<ParsedRow>& rhs) {
            AggregateCoalescingPlan plan;
            const auto lhsByDir = collectAggregatePositions(lhs);
            const auto rhsByDir = collectAggregatePositions(rhs);
            const bool inferenceAllowed = ruleAllowsAggregateInferenceBinding(lhs);

            for (const auto& [dir, lhsList] : lhsByDir) {
                const auto rhsIt = rhsByDir.find(dir);
                const std::vector<AggregatePosition> rhsList =
                    rhsIt != rhsByDir.end() ? rhsIt->second : std::vector<AggregatePosition>{};
                const bool hasLayerCoupledAttachments =
                    std::any_of(lhsList.begin(), lhsList.end(), [](const AggregatePosition& p) {
                        return p.isLayerCoupled;
                    })
                    || std::any_of(rhsList.begin(), rhsList.end(), [](const AggregatePosition& p) {
                        return p.isLayerCoupled;
                    });
                // Phase 5c-4: layer-coupled property + aggregate cross-cell capture.
                if (hasLayerCoupledAttachments) {
                    if (!inferenceAllowed || lhsList.size() != 1 || rhsList.empty()) {
                        continue;
                    }
                    const AggregatePosition& source = lhsList.front();
                    if (!source.isLayerCoupled) {
                        continue;
                    }
                    const bool hasCrossCellSink = std::any_of(rhsList.begin(), rhsList.end(), [&](const AggregatePosition& p) {
                        return p.row != source.row || p.cell != source.cell || p.name != source.name;
                    });
                    if (!hasCrossCellSink) {
                        continue;
                    }
                    const bool allRhsSameProperty = std::all_of(rhsList.begin(), rhsList.end(), [&](const AggregatePosition& p) {
                        return p.isLayerCoupled && p.name == source.name;
                    });
                    if (!allRhsSameProperty) {
                        continue;
                    }

                    plan.safe.insert(dir);
                    plan.safePropertyAttachments.insert(dir + '\0' + source.name);
                    int32_t aggregateMask = 0;
                    if (const auto* concreteDirs = concreteDirsForAggregate(dir)) {
                        for (const auto& concreteDir : *concreteDirs) {
                            aggregateMask |= dirMaskFromToken(concreteDir);
                        }
                    }
                    plan.bindings.emplace(
                        dir,
                        AggregateBinding{
                            source.row,
                            source.cell,
                            std::nullopt,
                            source.name,
                            dir,
                            aggregateMask,
                        });
                    std::vector<AggregateSinkPosition> sinkList;
                    for (const AggregatePosition& p : rhsList) {
                        AggregateSinkPosition sink;
                        sink.row = p.row;
                        sink.cell = p.cell;
                        sink.propertyName = p.name;
                        if (p.row < lhs.size() && p.cell < lhs[p.row].size()) {
                            const ParsedCell& lhsCell = lhs[p.row][p.cell];
                            for (const auto& lhsItem : lhsCell.items) {
                                if (lhsItem.dir != "no" && lhsItem.dir != "random" && lhsItem.name == p.name) {
                                    sink.localProperty = true;
                                    break;
                                }
                            }
                        }
                        sinkList.push_back(std::move(sink));
                    }
                    plan.sinks.emplace(dir, std::move(sinkList));
                    continue;
                }

                std::vector<AggregatePosition> nonCoupledLhs;
                nonCoupledLhs.reserve(lhsList.size());
                for (const auto& p : lhsList) {
                    if (!p.isLayerCoupled) {
                        nonCoupledLhs.push_back(p);
                    }
                }
                if (nonCoupledLhs.empty()) {
                    continue;
                }
                if (std::any_of(lhsList.begin(), lhsList.end(), [](const AggregatePosition& p) {
                        return p.isLayerCoupled;
                    })) {
                    continue;
                }
                if (std::any_of(rhsList.begin(), rhsList.end(), [](const AggregatePosition& p) {
                        return p.isLayerCoupled;
                    })) {
                    continue;
                }

                std::set<std::string> lhsPosKeys;
                for (const auto& p : nonCoupledLhs) {
                    lhsPosKeys.insert(std::to_string(p.row) + ':' + std::to_string(p.cell) + ':' + p.name);
                }
                const bool preservationOnly = std::all_of(rhsList.begin(), rhsList.end(), [&](const AggregatePosition& p) {
                    return lhsPosKeys.count(std::to_string(p.row) + ':' + std::to_string(p.cell) + ':' + p.name) != 0;
                });
                if (preservationOnly) {
                    plan.safe.insert(dir);
                    continue;
                }

                if (!inferenceAllowed || nonCoupledLhs.size() != 1) {
                    continue;
                }
                const AggregatePosition& source = nonCoupledLhs.front();
                if (objectIdByName.find(source.name) == objectIdByName.end()) {
                    continue;
                }
                if (!source.layer.has_value()) {
                    continue;
                }
                if (!std::all_of(rhsList.begin(), rhsList.end(), [&](const AggregatePosition& p) {
                        return objectIdByName.find(p.name) != objectIdByName.end();
                    })) {
                    continue;
                }
                if (std::any_of(rhsList.begin(), rhsList.end(), [](const AggregatePosition& p) {
                        return !p.layer.has_value();
                    })) {
                    continue;
                }

                plan.safe.insert(dir);
                int32_t aggregateMask = 0;
                if (const auto* concreteDirs = concreteDirsForAggregate(dir)) {
                    for (const auto& concreteDir : *concreteDirs) {
                        aggregateMask |= dirMaskFromToken(concreteDir);
                    }
                }
                plan.bindings.emplace(
                    dir,
                    AggregateBinding{
                        source.row,
                        source.cell,
                        source.layer,
                        "",
                        dir,
                        aggregateMask,
                    });
                std::vector<AggregateSinkPosition> sinkList;
                for (const auto& p : rhsList) {
                    if (p.row != source.row || p.cell != source.cell || p.name != source.name) {
                        sinkList.push_back({p.row, p.cell, p.layer});
                    }
                }
                if (!sinkList.empty()) {
                    plan.sinks.emplace(dir, std::move(sinkList));
                }
            }
            return plan;
        };

        auto rulePropertyBindingAllowed = [&](const std::vector<ParsedRow>& lhs) {
            if (rigidRule || !parsedCommands.empty() || lhs.size() != 1) {
                return false;
            }
            for (const auto& cell : lhs[0]) {
                if (cell.isEllipsis) {
                    return false;
                }
            }
            return true;
        };

        auto computePropertyCoalescingPlan = [&](const std::vector<ParsedRow>& lhs,
                                                   const std::vector<ParsedRow>& rhs,
                                                   const AggregateCoalescingPlan& aggregatePlan) {
            PropertyCoalescingPlan plan;
            if (!rulePropertyBindingAllowed(lhs)) {
                return plan;
            }

            struct PropertyOccurrence {
                size_t row = 0;
                size_t cell = 0;
                std::string dir;
            };

            auto collectLayerCoupled = [&](const std::vector<ParsedRow>& rows) {
                std::map<std::string, std::vector<PropertyOccurrence>> byName;
                for (size_t row = 0; row < rows.size(); ++row) {
                    for (size_t cell = 0; cell < rows[row].size(); ++cell) {
                        const ParsedCell& parsedCell = rows[row][cell];
                        if (parsedCell.isEllipsis) {
                            continue;
                        }
                        for (const auto& item : parsedCell.items) {
                            if (item.dir == "no" || item.dir == "random") {
                                continue;
                            }
                            if (!isLayerCoupledPropertyName(item.name)) {
                                continue;
                            }
                            byName[item.name].push_back({row, cell, item.dir});
                        }
                    }
                }
                return byName;
            };

            auto isLayerCoupledMovementDir = [](const std::string& dir) {
                return dir.empty() || dir == "stationary" || dir == "action"
                    || dir == "up" || dir == "down" || dir == "left" || dir == "right";
            };
            auto findAggregatePropertySink = [&](const PropertyOccurrence& p, const std::string& propName) {
                if (concreteDirsForAggregate(p.dir) == nullptr) {
                    return static_cast<const AggregateSinkPosition*>(nullptr);
                }
                const auto sinkIt = aggregatePlan.sinks.find(p.dir);
                if (sinkIt == aggregatePlan.sinks.end()) {
                    return static_cast<const AggregateSinkPosition*>(nullptr);
                }
                for (const AggregateSinkPosition& sink : sinkIt->second) {
                    if (sink.row == p.row && sink.cell == p.cell && sink.propertyName == propName) {
                        return &sink;
                    }
                }
                return static_cast<const AggregateSinkPosition*>(nullptr);
            };

            const auto lhsByName = collectLayerCoupled(lhs);
            const auto rhsByName = collectLayerCoupled(rhs);

            for (const auto& [propNameEntry, lhsList] : lhsByName) {
                const std::string propName = propNameEntry;
                const auto rhsIt = rhsByName.find(propName);
                const std::vector<PropertyOccurrence> rhsList =
                    rhsIt != rhsByName.end() ? rhsIt->second : std::vector<PropertyOccurrence>{};
                if (rhsList.empty()) {
                    continue;
                }

                std::vector<puzzlescript::PropertyAlias> aliases;
                const auto propIt = propertyOf.find(propName);
                if (propIt == propertyOf.end()) {
                    continue;
                }
                for (const auto& alias : propIt->second) {
                    const auto objIt = objectIdByName.find(alias);
                    if (objIt == objectIdByName.end()) {
                        continue;
                    }
                    puzzlescript::PropertyAlias propertyAlias;
                    propertyAlias.objectId = objIt->second;
                    propertyAlias.layerIndex =
                        game->objectsById[static_cast<size_t>(objIt->second)].layer;
                    aliases.push_back(propertyAlias);
                }
                if (aliases.empty()) {
                    continue;
                }

                auto makePropertyBinding = [&](const PropertyOccurrence& source,
                                               int32_t sourceMovementMode,
                                               int32_t sourceMovementMask) {
                    puzzlescript::PropertyBinding binding;
                    binding.propertyName = propName;
                    binding.sourceRow = static_cast<int32_t>(source.row);
                    binding.sourceCell = static_cast<int32_t>(source.cell);
                    binding.sourceMovementMode = sourceMovementMode;
                    binding.sourceMovementMask = sourceMovementMask;
                    binding.aliases = aliases;
                    return binding;
                };

                if (lhsList.size() != 1) {
                    const AggregateBinding* aggregateBinding = nullptr;
                    for (const auto& [_, binding] : aggregatePlan.bindings) {
                        if (binding.sourcePropertyName == propName) {
                            aggregateBinding = &binding;
                            break;
                        }
                    }
                    if (aggregateBinding == nullptr) {
                        continue;
                    }
                    const PropertyOccurrence* source = nullptr;
                    for (const PropertyOccurrence& candidate : lhsList) {
                        if (candidate.row == aggregateBinding->sourceRow
                            && candidate.cell == aggregateBinding->sourceCell
                            && candidate.dir == aggregateBinding->aggregateName) {
                            source = &candidate;
                            break;
                        }
                    }
                    if (source == nullptr) {
                        continue;
                    }
                    if (source->row >= lhs.size() || source->cell >= lhs[source->row].size()) {
                        continue;
                    }
                    if (cellHasNoTermOverlappingProperty(lhs[source->row][source->cell], propName)) {
                        continue;
                    }
                    const bool allSinksAreLocalAggregatePreservation = std::all_of(
                        rhsList.begin(),
                        rhsList.end(),
                        [&](const PropertyOccurrence& p) {
                            const AggregateSinkPosition* sink = findAggregatePropertySink(p, propName);
                            return sink != nullptr && sink->localProperty;
                        });
                    if (!allSinksAreLocalAggregatePreservation) {
                        continue;
                    }
                    plan.safe.insert(propName);
                    int32_t sourceMovementMask = 0;
                    if (const auto* concreteDirs = concreteDirsForAggregate(source->dir)) {
                        for (const auto& concreteDir : *concreteDirs) {
                            sourceMovementMask |= dirMaskFromToken(concreteDir);
                        }
                    }
                    plan.bindings[propName] =
                        makePropertyBinding(*source, 3, sourceMovementMask);
                    continue;
                }

                const PropertyOccurrence& source = lhsList.front();
                if (source.dir == "no" || source.dir == "random") {
                    continue;
                }
                if (source.row >= lhs.size() || source.cell >= lhs[source.row].size()) {
                    continue;
                }
                if (cellHasNoTermOverlappingProperty(lhs[source.row][source.cell], propName)) {
                    continue;
                }

                const bool sinkDirsOk = std::all_of(rhsList.begin(), rhsList.end(), [&](const PropertyOccurrence& p) {
                    return p.dir.empty()
                        || p.dir == "stationary"
                        || (isLayerCoupledMovementDir(p.dir) && dirMaskFromToken(p.dir) != 0)
                        || findAggregatePropertySink(p, propName) != nullptr;
                });
                if (!sinkDirsOk) {
                    continue;
                }

                const bool hasCrossCellSink = std::any_of(rhsList.begin(), rhsList.end(), [&](const PropertyOccurrence& p) {
                    return p.row != source.row || p.cell != source.cell;
                });
                if (!hasCrossCellSink) {
                    continue;
                }

                plan.safe.insert(propName);
                int32_t sourceMovementMode = 0;
                int32_t sourceMovementMask = 0;
                if (source.dir == "stationary") {
                    sourceMovementMode = 1;
                    sourceMovementMask = 0x1f;
                } else if (!source.dir.empty()) {
                    if (const int32_t concreteMask = dirMaskFromToken(source.dir);
                        concreteMask != 0 && concreteDirsForAggregate(source.dir) == nullptr) {
                        sourceMovementMode = 2;
                        sourceMovementMask = concreteMask;
                    } else if (const auto* concreteDirs = concreteDirsForAggregate(source.dir)) {
                        sourceMovementMode = 3;
                        for (const auto& concreteDir : *concreteDirs) {
                            sourceMovementMask |= dirMaskFromToken(concreteDir);
                        }
                    }
                }
                plan.bindings[propName] =
                    makePropertyBinding(source, sourceMovementMode, sourceMovementMask);
                std::vector<PropertySinkPosition> sinkList;
                for (const PropertyOccurrence& p : rhsList) {
                    sinkList.push_back({p.row, p.cell, propName});
                }
                plan.sinks.emplace(propName, std::move(sinkList));
            }
            return plan;
        };

        // Mirrors JS `concretizeMovingRule` closely, including split order and the
        // two RHS disambiguation passes (`movingReplacement` and
        // `aggregateDirReplacement`). Rule-group order is observable, so the push /
        // erase behavior intentionally follows the JS implementation.
        auto expandConcretizeMovingRows = [&](std::vector<ParsedRow> lhs0,
                                              std::vector<ParsedRow> rhs0,
                                              const std::set<std::string>& safeAggregates,
                                              const std::set<std::string>& safeAggregatePropertyAttachments)
            -> std::vector<std::pair<std::vector<ParsedRow>, std::vector<ParsedRow>>> {
            struct MovingReplacement {
                std::string concreteDirection;
                int occurrenceCount = 1;
                std::string ambiguousMovement;
                std::string attachedObject;
                size_t row = 0;
                size_t cell = 0;
            };
            struct AggregateDirReplacement {
                std::string concreteDirection;
                int occurrenceCount = 1;
                std::string ambiguousMovement;
            };
            struct WorkRule {
                std::vector<ParsedRow> lhs;
                std::vector<ParsedRow> rhs;
                std::map<std::string, MovingReplacement> movingReplacement;
                std::map<std::string, AggregateDirReplacement> aggregateDirReplacement;
            };

            auto getMovingsParsed = [&](const ParsedCell& cell) {
                std::vector<std::pair<std::string, std::string>> result;
                if (cell.isEllipsis) {
                    return result;
                }
                for (const auto& item : cell.items) {
                    if (concreteDirsForAggregate(item.dir) == nullptr) {
                        continue;
                    }
                    if (safeAggregates.count(item.dir) != 0) {
                        const std::string nameLower = toLowerAsciiCopy(item.name);
                        const bool isLayerCoupled =
                            objectIdByName.find(nameLower) == objectIdByName.end()
                            && isLayerCoupledPropertyName(nameLower);
                        const std::string attachmentKey = item.dir + '\0' + item.name;
                        if (!isLayerCoupled || safeAggregatePropertyAttachments.count(attachmentKey) != 0) {
                            continue;
                        }
                    }
                    result.push_back({item.name, item.dir});
                }
                return result;
            };
            auto concretizeMovingInCell = [](ParsedCell& cell,
                                             const std::string& ambiguousMovement,
                                             const std::string& nameToMove,
                                             const std::string& concreteDirection) {
                if (cell.isEllipsis) {
                    return;
                }
                for (auto& item : cell.items) {
                    if (item.dir == ambiguousMovement && item.name == nameToMove) {
                        item.dir = concreteDirection;
                    }
                }
            };
            auto concretizeMovingInCellByAmbiguousMovementName = [](ParsedCell& cell,
                                                                    const std::string& ambiguousMovement,
                                                                    const std::string& concreteDirection) {
                if (cell.isEllipsis) {
                    return;
                }
                for (auto& item : cell.items) {
                    if (item.dir == ambiguousMovement) {
                        item.dir = concreteDirection;
                    }
                }
            };

            std::vector<WorkRule> result;
            result.push_back({std::move(lhs0), std::move(rhs0), {}, {}});

            bool modified = true;
            while (modified) {
                modified = false;
                for (size_t i = 0; i < result.size(); ++i) {
                    bool shouldRemove = false;
                    for (size_t j = 0; j < result[i].lhs.size(); ++j) {
                        auto& currentRuleRow = result[i].lhs[j];
                        for (size_t k = 0; k < currentRuleRow.size(); ++k) {
                            const auto movings = getMovingsParsed(currentRuleRow[k]);
                            if (movings.empty()) {
                                continue;
                            }

                            shouldRemove = true;
                            modified = true;
                            const std::string& candName = movings[0].first;
                            const std::string& ambiguousDir = movings[0].second;
                            const auto* concreteDirs = concreteDirsForAggregate(ambiguousDir);
                            if (concreteDirs == nullptr) {
                                continue;
                            }

                            const WorkRule baseRule = result[i];
                            for (const auto& concreteDirection : *concreteDirs) {
                                WorkRule newRule = baseRule;
                                concretizeMovingInCell(newRule.lhs[j][k], ambiguousDir, candName, concreteDirection);
                                if (!newRule.rhs.empty() && j < newRule.rhs.size() && k < newRule.rhs[j].size()) {
                                    concretizeMovingInCell(newRule.rhs[j][k], ambiguousDir, candName, concreteDirection);
                                }

                                const std::string movingKey = candName + ambiguousDir;
                                auto movingIt = newRule.movingReplacement.find(movingKey);
                                if (movingIt == newRule.movingReplacement.end()) {
                                    newRule.movingReplacement[movingKey] =
                                        MovingReplacement{concreteDirection, 1, ambiguousDir, candName, j, k};
                                } else if (j != movingIt->second.row || k != movingIt->second.cell) {
                                    movingIt->second.occurrenceCount += 1;
                                }

                                auto aggregateIt = newRule.aggregateDirReplacement.find(ambiguousDir);
                                if (aggregateIt == newRule.aggregateDirReplacement.end()) {
                                    newRule.aggregateDirReplacement[ambiguousDir] =
                                        AggregateDirReplacement{concreteDirection, 1, ambiguousDir};
                                } else {
                                    aggregateIt->second.occurrenceCount += 1;
                                }

                                result.push_back(std::move(newRule));
                            }
                        }
                    }
                    if (shouldRemove) {
                        result.erase(result.begin() + static_cast<std::ptrdiff_t>(i));
                        --i;
                    }
                }
            }

            std::vector<std::pair<std::vector<ParsedRow>, std::vector<ParsedRow>>> out;
            out.reserve(result.size());
            for (auto& currentRule : result) {
                for (const auto& [_, replacementInfo] : currentRule.movingReplacement) {
                    if (replacementInfo.occurrenceCount != 1) {
                        continue;
                    }
                    for (auto& rhsRow : currentRule.rhs) {
                        for (auto& cell : rhsRow) {
                            concretizeMovingInCell(
                                cell,
                                replacementInfo.ambiguousMovement,
                                replacementInfo.attachedObject,
                                replacementInfo.concreteDirection
                            );
                        }
                    }
                }

                std::map<std::string, std::string> ambiguousMovementNames;
                for (const auto& [_, replacementInfo] : currentRule.aggregateDirReplacement) {
                    const auto existing = ambiguousMovementNames.find(replacementInfo.ambiguousMovement);
                    if (existing != ambiguousMovementNames.end() || replacementInfo.occurrenceCount != 1) {
                        ambiguousMovementNames[replacementInfo.ambiguousMovement] = "INVALID";
                    } else {
                        ambiguousMovementNames[replacementInfo.ambiguousMovement] = replacementInfo.concreteDirection;
                    }
                }
                for (const auto& [ambiguousMovement, concreteMovement] : ambiguousMovementNames) {
                    if (concreteMovement == "INVALID") {
                        continue;
                    }
                    for (auto& rhsRow : currentRule.rhs) {
                        for (auto& cell : rhsRow) {
                            concretizeMovingInCellByAmbiguousMovementName(cell, ambiguousMovement, concreteMovement);
                        }
                    }
                }

                std::string rhsAmbiguousMovementRemains;
                for (const auto& rhsRow : currentRule.rhs) {
                    for (const auto& cell : rhsRow) {
                        const auto movings = getMovingsParsed(cell);
                        if (!movings.empty()) {
                            rhsAmbiguousMovementRemains = movings[0].second;
                            break;
                        }
                    }
                    if (!rhsAmbiguousMovementRemains.empty()) {
                        break;
                    }
                }
                if (!rhsAmbiguousMovementRemains.empty()) {
                    throw std::runtime_error(
                        "Rule at line " + std::to_string(entry.lineNumber)
                        + " has an ambiguous movement on the right-hand side, \"" + rhsAmbiguousMovementRemains
                        + "\", that can't be inferred from the left-hand side.");
                }

                out.push_back({std::move(currentRule.lhs), std::move(currentRule.rhs)});
            }
            return out;
        };

        // Mirrors src/js/compiler.js `concretizePropertyRule` for ParsedRow/cell form:
        // ambiguousProperties (RHS vs LHS), per-cell property explosion with
        // propertyReplacement bookkeeping, then RHS cleanup when a property was
        // concretized exactly once on the LHS.
        // JS phase 4f: do not expand `no property` into per-alias `no alias_i`
        // terms — rulesToMask reads state.objectMasks[propertyName] directly.
        auto concretizePropertyInCell = [](ParsedCell& cell, const std::string& property, const std::string& concreteType) {
            if (cell.isEllipsis) {
                return;
            }
            for (auto& it : cell.items) {
                if (it.dir != "random" && it.name == property) {
                    it.name = concreteType;
                }
            }
        };
        auto getPropertiesFromCellParsed = [&](const ParsedCell& cell) -> std::vector<std::string> {
            std::vector<std::string> out;
            if (cell.isEllipsis) {
                return out;
            }
            for (const auto& it : cell.items) {
                // JS getPropertiesFromCell: `random` and `no` are constraints, not
                // rewrite targets, so they don't drive property splitting.
                if (it.dir == "random" || it.dir == "no") {
                    continue;
                }
                if (propertyOf.find(it.name) != propertyOf.end()) {
                    out.push_back(it.name);
                }
            }
            return out;
        };
        auto buildAmbiguousPropertiesSet = [&](const std::vector<ParsedRow>& lhs, const std::vector<ParsedRow>& rhs) {
            std::set<std::string> ambiguous;
            const size_t nRows = std::min(lhs.size(), rhs.size());
            for (size_t j = 0; j < nRows; ++j) {
                const auto& rowL = lhs[j];
                const auto& rowR = rhs[j];
                const size_t nCols = std::min(rowL.size(), rowR.size());
                for (size_t k = 0; k < nCols; ++k) {
                    const auto propsL = getPropertiesFromCellParsed(rowL[k]);
                    const std::set<std::string> setL(propsL.begin(), propsL.end());
                    for (const std::string& p : getPropertiesFromCellParsed(rowR[k])) {
                        if (setL.find(p) == setL.end()) {
                            ambiguous.insert(p);
                        }
                    }
                }
            }
            return ambiguous;
        };
        struct CoalescingPlanResult {
            std::set<std::string> skippable;
            bool hasRewriteTerm = false;
        };
        // Mirrors compiler.js `getCoalescingPlan` dispatch.
        auto computePropertyCoalescingSkippable = [&](const std::vector<ParsedRow>& lhs,
                                                      const std::vector<ParsedRow>& rhs,
                                                      const std::set<std::string>& ambiguousProperties)
            -> CoalescingPlanResult {
            CoalescingPlanResult result;
            // JS getCoalescingPlan: rigid rules never skip property splitting.
            if (rigidRule) {
                return result;
            }
            auto isLayerCoupledMovementDir = [](const std::string& dir) {
                return dir.empty() || dir == "stationary" || dir == "action"
                    || dir == "up" || dir == "down" || dir == "left" || dir == "right";
            };
            auto objectOrSingleLayerPropertyLayer = [&](const std::string& name) -> std::optional<int32_t> {
                if (const auto it = objectIdByName.find(name); it != objectIdByName.end()) {
                    return game->objectsById[static_cast<size_t>(it->second)].layer;
                }
                if (const auto pit = propertiesSingleLayer.find(name); pit != propertiesSingleLayer.end()) {
                    return pit->second;
                }
                return std::nullopt;
            };
            auto propertyAliasLayers = [&](const std::string& propertyName,
                                           const std::map<int32_t, bool>& excluded) -> std::set<int32_t> {
                std::set<int32_t> layers;
                const auto propIt = propertyOf.find(propertyName);
                if (propIt == propertyOf.end()) {
                    return layers;
                }
                for (const auto& alias : propIt->second) {
                    const auto objIt = objectIdByName.find(alias);
                    if (objIt == objectIdByName.end()) {
                        continue;
                    }
                    const int32_t layer = game->objectsById[static_cast<size_t>(objIt->second)].layer;
                    if (excluded.find(layer) != excluded.end()) {
                        continue;
                    }
                    layers.insert(layer);
                }
                return layers;
            };
            auto layerSetsOverlap = [](const std::set<int32_t>& a, const std::set<int32_t>& b) {
                for (int32_t layer : a) {
                    if (b.count(layer) != 0) {
                        return true;
                    }
                }
                return false;
            };
            struct PropertyRewriteTerm {
                std::string name;
                int32_t destinationLayer = 0;
                std::set<int32_t> aliasLayers;
            };
            auto propertyAliasLayerSetFull = [&](const std::string& propertyName) {
                return propertyAliasLayers(propertyName, {});
            };
            auto propertyRewriteTermsAreLayerDisjoint = [&](const std::vector<PropertyRewriteTerm>& propertyTerms,
                                                            const std::map<int32_t, bool>& fixedLayers) {
                std::set<std::string> seenProperties;
                std::set<int32_t> occupiedAliasLayers;
                std::set<int32_t> destinationLayers;
                std::set<int32_t> fixedLayerSet;
                for (const auto& [layer, _] : fixedLayers) {
                    fixedLayerSet.insert(layer);
                }
                for (size_t i = 0; i < propertyTerms.size(); ++i) {
                    const PropertyRewriteTerm& term = propertyTerms[i];
                    if (seenProperties.count(term.name) != 0
                        || fixedLayers.count(term.destinationLayer) != 0
                        || destinationLayers.count(term.destinationLayer) != 0) {
                        return false;
                    }
                    if (layerSetsOverlap(fixedLayerSet, term.aliasLayers)) {
                        return false;
                    }
                    for (size_t j = 0; j < propertyTerms.size(); ++j) {
                        if (i == j) {
                            continue;
                        }
                        if (term.aliasLayers.count(propertyTerms[j].destinationLayer) != 0) {
                            return false;
                        }
                    }
                    if (layerSetsOverlap(occupiedAliasLayers, term.aliasLayers)) {
                        return false;
                    }
                    seenProperties.insert(term.name);
                    destinationLayers.insert(term.destinationLayer);
                    occupiedAliasLayers.insert(term.aliasLayers.begin(), term.aliasLayers.end());
                }
                return true;
            };

            const bool hasRhs = !rhs.empty();
            bool movementValid = hasRhs && !lateRule;
            bool rewriteValid = hasRhs;
            bool mixedValid = hasRhs && !lateRule;
            bool preservedValid = hasRhs && lhs.size() == rhs.size();
            bool commandOnlyValid = !hasRhs && !lateRule;
            bool sawLayerCoupledProperty = false;
            bool sawMovementEffect = false;
            bool sawLayerCoupledMovement = false;
            bool sawPropertyRewrite = false;
            int propertyRewriteCount = 0;
            std::set<std::string> coupledPropertiesInRule;

            const bool singleCellRule = hasRhs && lhs.size() == 1 && rhs.size() == 1
                && !lhs[0].empty() && lhs[0].size() == 1
                && !rhs[0].empty() && rhs[0].size() == 1;
            if (preservedValid && !singleCellRule) {
                const bool multiCellAllowed = parsedCommands.empty() && !randomRule
                    && lhs.size() == 1 && rhs.size() == 1 && lhs[0].size() > 1;
                if (!multiCellAllowed) {
                    preservedValid = false;
                }
            }
            if (hasRhs && lhs.size() != rhs.size()) {
                movementValid = false;
                rewriteValid = false;
                mixedValid = false;
                preservedValid = false;
            }

            std::map<std::string, bool> preservedCandidateStatus;
            for (size_t j = 0; j < lhs.size(); ++j) {
                const auto& rowL = lhs[j];
                const ParsedRow* rowRPtr = hasRhs && j < rhs.size() ? &rhs[j] : nullptr;
                if (rowRPtr != nullptr && rowRPtr->size() != rowL.size()) {
                    movementValid = false;
                    rewriteValid = false;
                    mixedValid = false;
                    preservedValid = false;
                    break;
                }

                for (size_t k = 0; k < rowL.size(); ++k) {
                    const ParsedCell& cellL = rowL[k];
                    const ParsedCell* cellRPtr =
                        rowRPtr != nullptr && k < rowRPtr->size() ? &(*rowRPtr)[k] : nullptr;
                    if (cellL.isEllipsis) {
                        continue;
                    }

                    // Phase 7C: tolerate LHS-only tail terms when they are `no`/`random`
                    // constraints. Other tail terms invalidate movement/preserved modes.
                    if (cellRPtr != nullptr && cellL.items.size() > cellRPtr->items.size()) {
                        for (size_t tail = cellRPtr->items.size(); tail < cellL.items.size(); ++tail) {
                            const std::string& tailDir = cellL.items[tail].dir;
                            if (tailDir != "no" && tailDir != "random") {
                                movementValid = false;
                                rewriteValid = false;
                                mixedValid = false;
                                preservedValid = false;
                                break;
                            }
                        }
                    }

                    // Phase 7D: RHS-only tail terms that are concrete-object writes or
                    // `no` destroys are handled at rulesToMask time. Layer-coupled
                    // properties on an RHS-only tail invalidate movement/preserved modes.
                    if (cellRPtr != nullptr && cellRPtr->items.size() > cellL.items.size()) {
                        rewriteValid = false;
                        mixedValid = false;
                        for (size_t tail = cellL.items.size(); tail < cellRPtr->items.size(); ++tail) {
                            const std::string& tailDir = cellRPtr->items[tail].dir;
                            const std::string& tailName = cellRPtr->items[tail].name;
                            const bool handleable =
                                (tailDir == "no"
                                    && objectIdByName.find(tailName) != objectIdByName.end())
                                || (isLayerCoupledMovementDir(tailDir)
                                    && objectIdByName.find(tailName) != objectIdByName.end());
                            if (!handleable) {
                                movementValid = false;
                                preservedValid = false;
                                break;
                            }
                        }
                    }

                    // JS getCoalescingPlan resets these per cell, not per row.
                    std::set<std::string> preservedSeenInCell;
                    std::map<int32_t, bool> movFixedLayers;
                    std::vector<std::string> movCoupledTerms;
                    std::map<int32_t, bool> cmdFixedLayers;
                    std::vector<std::string> cmdCoupledTerms;
                    std::map<int32_t, bool> rewriteFixedLayers;
                    std::vector<PropertyRewriteTerm> rewritePropertyTerms;
                    std::map<int32_t, bool> mixedFixedLayers;
                    std::vector<std::string> mixedMovementTerms;
                    std::vector<PropertyRewriteTerm> mixedPropertyTerms;

                    for (size_t itemIndex = 0; itemIndex < cellL.items.size(); ++itemIndex) {
                        const auto& itemL = cellL.items[itemIndex];
                        const std::string& dirL = itemL.dir;
                        const std::string& nameL = itemL.name;

                        ParsedItem rhsItem;
                        bool hasRhsItem = false;
                        if (cellRPtr != nullptr && itemIndex < cellRPtr->items.size()) {
                            rhsItem = cellRPtr->items[itemIndex];
                            hasRhsItem = true;
                        }
                        const std::string& dirR = hasRhsItem ? rhsItem.dir : std::string{};
                        const std::string& nameR = hasRhsItem ? rhsItem.name : std::string{};

                        if (isLayerCoupledPropertyName(nameL)) {
                            coupledPropertiesInRule.insert(nameL);
                        }
                        if (hasRhsItem && isLayerCoupledPropertyName(nameR)) {
                            coupledPropertiesInRule.insert(nameR);
                        }

                        if (commandOnlyValid) {
                            if (dirL != "no" && dirL != "random") {
                                if (!isLayerCoupledMovementDir(dirL)) {
                                    commandOnlyValid = false;
                                } else if (objectIdByName.find(nameL) == objectIdByName.end()
                                           && propertyOf.find(nameL) == propertyOf.end()) {
                                    commandOnlyValid = false;
                                } else if (isLayerCoupledPropertyName(nameL)) {
                                    if (cellHasNoTermOverlappingProperty(cellL, nameL)) {
                                        commandOnlyValid = false;
                                    } else {
                                        sawLayerCoupledProperty = true;
                                        cmdCoupledTerms.push_back(nameL);
                                    }
                                } else if (const auto layer = objectOrSingleLayerPropertyLayer(nameL);
                                           layer.has_value()) {
                                    cmdFixedLayers[*layer] = true;
                                }
                            }
                        }

                        if (!hasRhsItem) {
                            continue;
                        }

                        if (movementValid) {
                            if (nameL != nameR
                                || !isLayerCoupledMovementDir(dirL)
                                || !isLayerCoupledMovementDir(dirR)) {
                                movementValid = false;
                            } else if (objectIdByName.find(nameL) == objectIdByName.end()
                                       && propertyOf.find(nameL) == propertyOf.end()) {
                                movementValid = false;
                            } else if (isLayerCoupledPropertyName(nameL)) {
                                sawLayerCoupledProperty = true;
                                movCoupledTerms.push_back(nameL);
                                if (!dirL.empty() || !dirR.empty()) {
                                    sawMovementEffect = true;
                                }
                            } else if (const auto layer = objectOrSingleLayerPropertyLayer(nameL);
                                       layer.has_value()) {
                                movFixedLayers[*layer] = true;
                                if (dirL != dirR) {
                                    sawMovementEffect = true;
                                }
                            }
                        }

                        if (rewriteValid) {
                            if (!dirL.empty() || !dirR.empty()) {
                                rewriteValid = false;
                            } else if (propertyOf.find(nameL) != propertyOf.end()) {
                                if (objectIdByName.find(nameR) == objectIdByName.end()) {
                                    rewriteValid = false;
                                } else {
                                    PropertyRewriteTerm term;
                                    term.name = nameL;
                                    term.destinationLayer =
                                        game->objectsById[static_cast<size_t>(objectIdByName.at(nameR))].layer;
                                    term.aliasLayers = propertyAliasLayerSetFull(nameL);
                                    rewritePropertyTerms.push_back(std::move(term));
                                    ++propertyRewriteCount;
                                }
                            } else if (objectIdByName.find(nameL) != objectIdByName.end()) {
                                if (nameL != nameR) {
                                    rewriteValid = false;
                                } else {
                                    rewriteFixedLayers[game->objectsById[static_cast<size_t>(objectIdByName.at(nameL))].layer] = true;
                                }
                            } else {
                                rewriteValid = false;
                            }
                        }

                        if (mixedValid) {
                            if (dirL.empty() && dirR.empty()
                                && propertyOf.find(nameL) != propertyOf.end()
                                && objectIdByName.find(nameR) != objectIdByName.end()) {
                                PropertyRewriteTerm term;
                                term.name = nameL;
                                term.destinationLayer =
                                    game->objectsById[static_cast<size_t>(objectIdByName.at(nameR))].layer;
                                term.aliasLayers = propertyAliasLayerSetFull(nameL);
                                mixedPropertyTerms.push_back(std::move(term));
                                sawPropertyRewrite = true;
                            } else if (nameL != nameR
                                       || !isLayerCoupledMovementDir(dirL)
                                       || !isLayerCoupledMovementDir(dirR)) {
                                mixedValid = false;
                            } else if (isLayerCoupledPropertyName(nameL)) {
                                if (!dirL.empty() || !dirR.empty()) {
                                    mixedMovementTerms.push_back(nameL);
                                    sawLayerCoupledMovement = true;
                                }
                            } else if (objectIdByName.find(nameL) != objectIdByName.end()
                                       || propertiesSingleLayer.find(nameL) != propertiesSingleLayer.end()) {
                                if (const auto layer = objectOrSingleLayerPropertyLayer(nameL); layer.has_value()) {
                                    mixedFixedLayers[*layer] = true;
                                }
                            } else {
                                mixedValid = false;
                            }
                        }

                        if (preservedValid && isLayerCoupledPropertyName(nameL) && dirL.empty()) {
                            // JS getCoalescingPlan preserved mode requires an aligned
                            // empty-direction RHS counterpart at the same term index,
                            // not merely the same property name elsewhere in the cell
                            // (e.g. Indigestion line 556: pushable vs move pushable).
                            const bool canPreserve = hasRhsItem
                                && dirR.empty()
                                && nameR == nameL
                                && ambiguousProperties.find(nameL) == ambiguousProperties.end()
                                && !cellHasNoTermOverlappingProperty(cellL, nameL);
                            if (!canPreserve || preservedSeenInCell.count(nameL) != 0) {
                                preservedCandidateStatus[nameL] = false;
                            } else {
                                preservedSeenInCell.insert(nameL);
                                const auto statusIt = preservedCandidateStatus.find(nameL);
                                if (statusIt == preservedCandidateStatus.end() || statusIt->second) {
                                    preservedCandidateStatus[nameL] = true;
                                }
                            }
                        }
                    }

                    if (commandOnlyValid) {
                        std::set<int32_t> occupied;
                        for (const std::string& coupledName : cmdCoupledTerms) {
                            const std::set<int32_t> layers = propertyAliasLayers(coupledName, cmdFixedLayers);
                            if (layers.empty() || layerSetsOverlap(occupied, layers)) {
                                commandOnlyValid = false;
                                break;
                            }
                            occupied.insert(layers.begin(), layers.end());
                        }
                    }

                    if (movementValid) {
                        std::set<int32_t> occupied;
                        for (const std::string& coupledName : movCoupledTerms) {
                            const std::set<int32_t> layers = propertyAliasLayers(coupledName, movFixedLayers);
                            if (layers.empty() || layerSetsOverlap(occupied, layers)) {
                                movementValid = false;
                                break;
                            }
                            occupied.insert(layers.begin(), layers.end());
                        }
                    }
                    if (rewriteValid
                        && !propertyRewriteTermsAreLayerDisjoint(rewritePropertyTerms, rewriteFixedLayers)) {
                        rewriteValid = false;
                    }
                    if (mixedValid) {
                        if (!propertyRewriteTermsAreLayerDisjoint(mixedPropertyTerms, mixedFixedLayers)) {
                            mixedValid = false;
                        } else {
                            std::set<int32_t> occupied;
                            for (const std::string& coupledName : mixedMovementTerms) {
                                const std::set<int32_t> layers = propertyAliasLayers(coupledName, mixedFixedLayers);
                                if (layers.empty() || layerSetsOverlap(occupied, layers)) {
                                    mixedValid = false;
                                    break;
                                }
                                bool conflict = false;
                                for (const PropertyRewriteTerm& term : mixedPropertyTerms) {
                                    if (layerSetsOverlap(layers, term.aliasLayers)
                                        || layers.count(term.destinationLayer) != 0) {
                                        conflict = true;
                                        break;
                                    }
                                }
                                if (conflict) {
                                    mixedValid = false;
                                    break;
                                }
                                occupied.insert(layers.begin(), layers.end());
                            }
                        }
                    }
                }
            }

            if (movementValid && sawLayerCoupledProperty && sawMovementEffect) {
                result.skippable = coupledPropertiesInRule;
                return result;
            }
            if (rewriteValid && propertyRewriteCount > 1) {
                result.skippable = coupledPropertiesInRule;
                result.hasRewriteTerm = true;
                return result;
            }
            if (mixedValid && sawLayerCoupledMovement && sawPropertyRewrite) {
                result.skippable = coupledPropertiesInRule;
                result.hasRewriteTerm = true;
                return result;
            }
            if (commandOnlyValid && sawLayerCoupledProperty) {
                result.skippable = coupledPropertiesInRule;
                return result;
            }
            // JS getCoalescingPlan: preserved candidates apply only when preservedValid
            // survived every per-cell bail (e.g. LHS-only movement tails on another cell).
            if (preservedValid) {
                for (const auto& [propertyName, status] : preservedCandidateStatus) {
                    if (status) {
                        result.skippable.insert(propertyName);
                    }
                }
            }
            return result;
        };
        struct PropertyConcreteResult {
            std::vector<std::pair<std::vector<ParsedRow>, std::vector<ParsedRow>>> chunks;
            bool hasInferredPropertyRewriteTerm = false;
        };
        auto expandConcretizePropertyRows = [&](std::vector<ParsedRow> lhs0,
                                                  std::vector<ParsedRow> rhs0,
                                                  const std::set<std::string>& extraSkippableProperties)
            -> PropertyConcreteResult {
            struct Work {
                std::vector<ParsedRow> lhs;
                std::vector<ParsedRow> rhs;
                std::map<std::string, std::pair<std::string, int>> propRepl;
            };
            std::vector<Work> work;
            work.push_back({std::move(lhs0), std::move(rhs0), {}});
            // JS freezes `ambiguousProperties` before property splitting; it is not
            // recomputed as concrete names appear on the LHS during splitting.
            const std::set<std::string> ambiguousInitial =
                buildAmbiguousPropertiesSet(work.front().lhs, work.front().rhs);
            const CoalescingPlanResult coalescingPlan = [&] {
                CoalescingPlanResult out = computePropertyCoalescingSkippable(
                    work.front().lhs, work.front().rhs, ambiguousInitial);
                out.skippable.insert(extraSkippableProperties.begin(), extraSkippableProperties.end());
                return out;
            }();
            const std::set<std::string>& skippableProperties = coalescingPlan.skippable;
            const bool hasInferredPropertyRewriteTerm = coalescingPlan.hasRewriteTerm;

            bool modified = true;
            while (modified) {
                modified = false;
                for (size_t i = 0; i < work.size(); ++i) {
                    size_t splitJ = 0;
                    size_t splitK = 0;
                    std::string splitProperty;
                    bool found = false;
                    for (size_t j = 0; j < work[i].lhs.size() && !found; ++j) {
                        for (size_t k = 0; k < work[i].lhs[j].size() && !found; ++k) {
                            for (const std::string& property : getPropertiesFromCellParsed(work[i].lhs[j][k])) {
                                if (propertiesSingleLayer.find(property) != propertiesSingleLayer.end()
                                    && ambiguousInitial.find(property) == ambiguousInitial.end()) {
                                    continue;
                                }
                                if (propertyOf.find(property) == propertyOf.end()) {
                                    continue;
                                }
                                if (skippableProperties.count(property) != 0) {
                                    continue;
                                }
                                splitJ = j;
                                splitK = k;
                                splitProperty = property;
                                found = true;
                                break;
                            }
                        }
                    }
                    if (!found) {
                        continue;
                    }

                    const Work base = work[i];
                    work.erase(work.begin() + static_cast<std::ptrdiff_t>(i));
                    const std::vector<std::string>& aliases = propertyOf.at(splitProperty);
                    std::vector<Work> newOnes;
                    newOnes.reserve(aliases.size());
                    for (const std::string& concreteType : aliases) {
                        Work nw = base;
                        concretizePropertyInCell(nw.lhs[splitJ][splitK], splitProperty, concreteType);
                        if (!nw.rhs.empty() && splitJ < nw.rhs.size() && splitK < nw.rhs[splitJ].size()) {
                            concretizePropertyInCell(nw.rhs[splitJ][splitK], splitProperty, concreteType);
                        }
                        const auto repIt = nw.propRepl.find(splitProperty);
                        if (repIt == nw.propRepl.end()) {
                            nw.propRepl[splitProperty] = {concreteType, 1};
                        } else {
                            repIt->second.second += 1;
                        }
                        newOnes.push_back(std::move(nw));
                    }
                    work.insert(
                        work.begin() + static_cast<std::ptrdiff_t>(i),
                        std::make_move_iterator(newOnes.begin()),
                        std::make_move_iterator(newOnes.end()));
                    modified = true;
                    break;
                }
            }

            PropertyConcreteResult result;
            result.hasInferredPropertyRewriteTerm = hasInferredPropertyRewriteTerm;
            result.chunks.reserve(work.size());
            for (Work& w : work) {
                for (const auto& [prop, info] : w.propRepl) {
                    if (info.second != 1) {
                        continue;
                    }
                    const std::string& concreteType = info.first;
                    for (auto& row : w.rhs) {
                        for (auto& cell : row) {
                            concretizePropertyInCell(cell, prop, concreteType);
                        }
                    }
                }

                std::string rhsPropertyRemains;
                for (const auto& row : w.rhs) {
                    for (const auto& cell : row) {
                        for (const std::string& p : getPropertiesFromCellParsed(cell)) {
                            if (skippableProperties.count(p) != 0) {
                                continue;
                            }
                            if (ambiguousInitial.find(p) != ambiguousInitial.end()) {
                                rhsPropertyRemains = p;
                            }
                        }
                    }
                }
                if (!rhsPropertyRemains.empty()) {
                    throw std::runtime_error(
                        "Rule at line " + std::to_string(entry.lineNumber)
                        + " has a property on the right-hand side, \"" + rhsPropertyRemains
                        + "\", that can't be inferred from the left-hand side.");
                }
                result.chunks.push_back({std::move(w.lhs), std::move(w.rhs)});
            }
            return result;
        };

        // JS `makeSpawnedObjectsStationary` (compiler.js): after moving/property
        // concretization, any RHS object token with an empty direction prefix whose
        // collision layer is not represented among possible LHS objects in the
        // aligned cell gets `stationary`, so old movement bits clear (#492).
        auto getPossibleObjectNamesFromParsedCell = [&](const ParsedCell& cell) -> std::vector<std::string> {
            std::vector<std::string> out;
            if (cell.isEllipsis) {
                return out;
            }
            for (const auto& it : cell.items) {
                if (it.dir == "random") {
                    continue;
                }
                const std::string nameLower = toLowerAsciiCopy(it.name);
                const auto propIt = propertyOf.find(nameLower);
                if (propIt != propertyOf.end()) {
                    for (const auto& al : propIt->second) {
                        out.push_back(al);
                    }
                } else if (objectIdByName.find(nameLower) != objectIdByName.end()) {
                    out.push_back(nameLower);
                }
            }
            return out;
        };
        auto objectLayerByLowerName = [&](const std::string& nameLower) -> std::optional<int32_t> {
            const auto it = objectIdByName.find(nameLower);
            if (it == objectIdByName.end()) {
                return std::nullopt;
            }
            const int32_t layer = game->objectsById[static_cast<size_t>(it->second)].layer;
            if (layer < 0) {
                return std::nullopt;
            }
            return layer;
        };
        auto makeSpawnedObjectsStationaryRows = [&](std::vector<ParsedRow>& lhs, std::vector<ParsedRow>& rhs) {
            const size_t nRows = std::min(lhs.size(), rhs.size());
            for (size_t j = 0; j < nRows; ++j) {
                const ParsedRow& rowL = lhs[j];
                ParsedRow& rowR = rhs[j];
                const size_t nCols = std::min(rowL.size(), rowR.size());
                for (size_t k = 0; k < nCols; ++k) {
                    const ParsedCell& cellL = rowL[k];
                    ParsedCell& cellR = rowR[k];
                    if (cellR.isEllipsis) {
                        continue;
                    }
                    const std::vector<std::string> possible = getPossibleObjectNamesFromParsedCell(cellL);
                    std::vector<int32_t> lhsLayers;
                    lhsLayers.reserve(possible.size());
                    for (const auto& name : possible) {
                        if (const auto layer = objectLayerByLowerName(name)) {
                            lhsLayers.push_back(*layer);
                        }
                    }
                    for (auto& it : cellR.items) {
                        if (it.dir == "random" || !it.dir.empty()) {
                            continue;
                        }
                        const std::string nameLower = toLowerAsciiCopy(it.name);
                        if (propertyOf.find(nameLower) != propertyOf.end()) {
                            continue;
                        }
                        if (std::find(possible.begin(), possible.end(), nameLower) != possible.end()) {
                            continue;
                        }
                        const auto rLayer = objectLayerByLowerName(nameLower);
                        if (!rLayer.has_value()) {
                            continue;
                        }
                        if (std::find(lhsLayers.begin(), lhsLayers.end(), *rLayer) != lhsLayers.end()) {
                            continue;
                        }
                        it.dir = "stationary";
                    }
                }
            }
        };

        auto appendParsedRowsToSignature = [](std::string& sig, const std::vector<ParsedRow>& rows) {
            for (const auto& row : rows) {
                sig.push_back('[');
                for (const auto& cell : row) {
                    sig.push_back('{');
                    if (cell.isEllipsis) {
                        sig.append("...");
                    } else {
                        for (const auto& item : cell.items) {
                            if (!item.dir.empty()) {
                                sig.append(item.dir);
                                sig.push_back(' ');
                            }
                            sig.append(item.name);
                            sig.push_back(',');
                        }
                    }
                    sig.push_back('}');
                }
                sig.push_back(']');
            }
        };
        auto ruleVariantSignature = [&](int32_t lineNumber,
                                       const std::string& forward,
                                       bool rigid,
                                       bool random,
                                       bool late,
                                       const std::vector<ParsedRow>& lhs,
                                       const std::vector<ParsedRow>& rhs,
                                       const std::vector<puzzlescript::RuleCommand>& commands) {
            std::string sig;
            sig.reserve(256);
            sig.append(std::to_string(lineNumber));
            sig.push_back('|');
            bool directed = false;
            for (const auto& row : lhs) {
                if (row.size() > 1) {
                    directed = true;
                    break;
                }
            }
            if (rigid) sig.append("RIGID|");
            if (random) sig.append("RANDOM|");
            if (late) sig.append("LATE|");
            if (directed) {
                sig.append(forward);
                sig.push_back('|');
            }
            appendParsedRowsToSignature(sig, lhs);
            sig.push_back('|');
            appendParsedRowsToSignature(sig, rhs);
            sig.push_back('|');
            for (const auto& command : commands) {
                sig.append(command.name);
                sig.push_back(':');
                if (command.argument.has_value()) {
                    sig.append(*command.argument);
                }
                sig.push_back('|');
            }
            return sig;
        };
        for (const auto& rawRuleDirection : ruleDirections) {
        auto variantLhsRows = lhsRows;
        auto variantRhsRows = rhsRows;
        std::string concreteRuleDirection = rawRuleDirection;
        absolutizeRows(variantLhsRows, concreteRuleDirection);
        absolutizeRows(variantRhsRows, concreteRuleDirection);
        if (!containsEllipsis(variantLhsRows)) {
            if (concreteRuleDirection == "up") {
                concreteRuleDirection = "down";
                for (auto& row : variantLhsRows) std::reverse(row.begin(), row.end());
                for (auto& row : variantRhsRows) std::reverse(row.begin(), row.end());
            } else if (concreteRuleDirection == "left") {
                concreteRuleDirection = "right";
                for (auto& row : variantLhsRows) std::reverse(row.begin(), row.end());
                for (auto& row : variantRhsRows) std::reverse(row.begin(), row.end());
            }
        }
        atomizeAggregatesRows(variantLhsRows, variantRhsRows);
        rephraseSynonymsRows(variantLhsRows, variantRhsRows);

        const AggregateCoalescingPlan aggregateCoalescingPlan =
            computeAggregateCoalescingPlan(variantLhsRows, variantRhsRows);
        const auto movingVariants = expandConcretizeMovingRows(
            std::move(variantLhsRows),
            std::move(variantRhsRows),
            aggregateCoalescingPlan.safe,
            aggregateCoalescingPlan.safePropertyAttachments);
        for (const auto& movingVariant : movingVariants) {
            const PropertyCoalescingPlan propertyCoalescingPlan =
                computePropertyCoalescingPlan(
                    movingVariant.first, movingVariant.second, aggregateCoalescingPlan);
            const PropertyConcreteResult propertyConcreteResult =
                expandConcretizePropertyRows(
                    movingVariant.first,
                    movingVariant.second,
                    propertyCoalescingPlan.safe);
            for (const auto& propChunk : propertyConcreteResult.chunks) {
            const bool hasInferredPropertyRewriteTerm =
                propertyConcreteResult.hasInferredPropertyRewriteTerm;
            std::vector<ParsedRow> variantLhsRowsExpanded = propChunk.first;
            std::vector<ParsedRow> variantRhsRowsExpanded = propChunk.second;
            if (!lateRule) {
                makeSpawnedObjectsStationaryRows(variantLhsRowsExpanded, variantRhsRowsExpanded);
            }
            if (lhsHasOverlappingRequiredLayers(variantLhsRowsExpanded)) {
                continue;
            }

        puzzlescript::Rule rule;
        rule.direction = dirMaskFromToken(concreteRuleDirection);
        rule.lineNumber = entry.lineNumber;
        if (sameGroup && outputGroup != nullptr && !outputGroup->empty()) {
            rule.groupNumber = outputGroup->front().groupNumber;
        } else {
            rule.groupNumber = entry.lineNumber;
        }
        rule.rigid = rigidRule;
        rule.isRandom = randomRule;
        rule.hasReplacements = !variantRhsRowsExpanded.empty();
        rule.commands = parsedCommands;
        for (const auto& [_, bindingPlan] : aggregateCoalescingPlan.bindings) {
            puzzlescript::AggregateBinding binding;
            binding.aggregateName = bindingPlan.aggregateName;
            binding.sourceRow = static_cast<int32_t>(bindingPlan.sourceRow);
            binding.sourceCell = static_cast<int32_t>(bindingPlan.sourceCell);
            if (bindingPlan.sourceLayer.has_value()) {
                binding.sourceLayer = *bindingPlan.sourceLayer;
            }
            binding.aggregateMask = bindingPlan.aggregateMask;
            if (!bindingPlan.sourcePropertyName.empty()) {
                binding.sourcePropertyName = bindingPlan.sourcePropertyName;
            }
            rule.aggregateBindings.push_back(std::move(binding));
        }
        for (const auto& [propertyName, bindingPlan] : propertyCoalescingPlan.bindings) {
            puzzlescript::PropertyBinding binding = bindingPlan;
            const auto sinkIt = propertyCoalescingPlan.sinks.find(propertyName);
            if (sinkIt != propertyCoalescingPlan.sinks.end()) {
                for (const PropertySinkPosition& sink : sinkIt->second) {
                    binding.sinks.push_back(puzzlescript::PropertySink{
                        static_cast<int32_t>(sink.row),
                        static_cast<int32_t>(sink.cell),
                    });
                }
            }
            rule.propertyBindings.push_back(std::move(binding));
        }

        auto buildPatternRow = [&](const ParsedRow& row,
                                   const ParsedRow* rhsRow,
                                   size_t patternRowIndex) -> std::vector<puzzlescript::Pattern> {
            std::vector<puzzlescript::Pattern> out;
            out.reserve(row.size());
            for (size_t cellIndex = 0; cellIndex < row.size(); ++cellIndex) {
                const ParsedCell& cell = row[cellIndex];
                if (cell.isEllipsis) {
                    puzzlescript::Pattern pat;
                    pat.kind = puzzlescript::Pattern::Kind::Ellipsis;
                    out.push_back(std::move(pat));
                    continue;
                }

                auto objectsPresent = makeEmptyMask(game->wordCount);
                auto objectsMissing = makeEmptyMask(game->wordCount);
                auto movementsPresent = puzzlescript::MaskVector(static_cast<size_t>(game->movementWordCount), 0);
                auto movementsMissing = puzzlescript::MaskVector(static_cast<size_t>(game->movementWordCount), 0);
                // JS rulesToMask: per-cell aggregateMovementsMask — aggregate LHS bits
                // cleared on replace unless the RHS preserves the same aggregate term.
                auto aggregateMovementsMask = puzzlescript::MaskVector(static_cast<size_t>(game->movementWordCount), 0);
                std::vector<puzzlescript::MaskOffset> anyOffsets;
                std::vector<std::vector<int32_t>> anyAnchorIds;
                // JS rulesToMask: each unsplit aggregate direction term becomes an
                // anyMovementsPresent entry (OR over its concrete-direction bits).
                std::vector<puzzlescript::MaskVector> anyMovementMasks;
                std::vector<puzzlescript::LayerCoupledMovementReplacement> layerCoupledMovementMasks;

                struct CoupledMovementTermBuild {
                    puzzlescript::MaskVector objectMask;
                    puzzlescript::LayerCoupledMovementReplacement term;
                };

                auto buildLayerCoupledMovementTerm = [&](const std::string& propertyName,
                                                         const std::string& movementDir,
                                                         const ParsedCell& sourceCell,
                                                         size_t sourceItemIndex,
                                                         bool excludeConflictingLayers = true) {
                    CoupledMovementTermBuild built;
                    built.objectMask = makeEmptyMask(game->wordCount);

                    int32_t movementsAnyMask = 0;
                    const auto* aggregateDirs = concreteDirsForAggregate(movementDir);
                    if (aggregateDirs != nullptr) {
                        for (const auto& concreteDir : *aggregateDirs) {
                            movementsAnyMask |= dirMaskFromToken(concreteDir);
                        }
                    }
                    const int32_t movementsPresentMask =
                        movementsAnyMask != 0 || movementDir.empty() || movementDir == "stationary"
                            ? 0
                            : dirMaskFromToken(movementDir);
                    const int32_t movementsMissingMask = movementDir == "stationary" ? 0x1f : 0;

                    std::set<int32_t> excludedLayers;
                    if (excludeConflictingLayers && !sourceCell.isEllipsis) {
                        for (size_t lhsIndex = 0; lhsIndex < sourceCell.items.size(); ++lhsIndex) {
                            if (lhsIndex == sourceItemIndex) {
                                continue;
                            }
                            const auto& lhsItem = sourceCell.items[lhsIndex];
                            if (lhsItem.dir == "no" || lhsItem.dir == "random") {
                                continue;
                            }
                            std::set<std::string> lhsVisiting;
                            const auto lhsMask = resolveMask(resolveMask, lhsItem.name, lhsVisiting);
                            if (const auto lhsLayer = maskSingleLayer(lhsMask); lhsLayer.has_value()) {
                                excludedLayers.insert(*lhsLayer);
                            }
                        }
                    }

                    const auto propIt = propertyOf.find(propertyName);
                    if (propIt == propertyOf.end()) {
                        return built;
                    }
                    std::map<int32_t, puzzlescript::MaskVector> byLayer;
                    for (const auto& alias : propIt->second) {
                        const auto objIt = objectIdByName.find(alias);
                        if (objIt == objectIdByName.end()) {
                            continue;
                        }
                        const int32_t objectId = objIt->second;
                        const int32_t layer =
                            game->objectsById[static_cast<size_t>(objectId)].layer;
                        if (excludedLayers.count(layer) != 0) {
                            continue;
                        }
                        setMaskBit(built.objectMask, objectId);
                        auto& layerMask = byLayer[layer];
                        if (layerMask.empty()) {
                            layerMask = makeEmptyMask(game->wordCount);
                        }
                        setMaskBit(layerMask, objectId);
                    }

                    for (const auto& [layer, objectMask] : byLayer) {
                        puzzlescript::LayerCoupledMovementLayerTerm layerTerm;
                        layerTerm.layerIndex = layer;
                        layerTerm.objectMask = storeMaskWords(*game, objectMask);

                        auto movementsAny = puzzlescript::MaskVector(
                            static_cast<size_t>(game->movementWordCount), 0);
                        auto movementsPresent = puzzlescript::MaskVector(
                            static_cast<size_t>(game->movementWordCount), 0);
                        auto movementsMissing = puzzlescript::MaskVector(
                            static_cast<size_t>(game->movementWordCount), 0);
                        if (movementsAnyMask != 0) {
                            orShiftedMask5(movementsAny, 5 * layer, movementsAnyMask);
                        }
                        if (movementsPresentMask != 0) {
                            orShiftedMask5(movementsPresent, 5 * layer, movementsPresentMask);
                        }
                        if (movementsMissingMask != 0) {
                            orShiftedMask5(movementsMissing, 5 * layer, movementsMissingMask);
                        }
                        layerTerm.movementsAny = storeMaskWords(*game, movementsAny);
                        layerTerm.movementsPresent = storeMaskWords(*game, movementsPresent);
                        layerTerm.movementsMissing = storeMaskWords(*game, movementsMissing);
                        built.term.layers.push_back(std::move(layerTerm));
                    }
                    return built;
                };

                // Per-layer occupancy names (JS `layersUsed_l`): any LHS token with a
                // resolved single layer, including properties.
                std::vector<int32_t> layersUsedL(game->layerCount, 0);
                // Movement-bitvec lanes where LHS had a *concrete* object (JS `objectlayers_l`).
                puzzlescript::MaskVector lhsObjectLayersMovement(static_cast<size_t>(game->movementWordCount), 0);
                std::vector<puzzlescript::InferredPropertySource> inferredPropertySources;
                for (size_t itemIndex = 0; itemIndex < cell.items.size(); ++itemIndex) {
                    const auto& item = cell.items[itemIndex];
                    if (item.dir == "random") {
                        continue; // handled on RHS replacement
                    }
                    std::set<std::string> visiting;
                    const auto mask = resolveMask(resolveMask, item.name, visiting);
                    const auto singleLayer = maskSingleLayer(mask);
                    const bool isProperty = propertyOf.find(item.name) != propertyOf.end();

                    if (item.dir == "no") {
                        for (size_t w = 0; w < objectsMissing.size(); ++w) {
                            objectsMissing[w] |= mask[w];
                        }
                        continue;
                    }

                    if (isProperty) {
                        // JS semantics: OR properties become anyObjectsPresent even
                        // when they live on a single collision layer.
                        if (isLayerCoupledPropertyName(item.name)) {
                            auto coupled = buildLayerCoupledMovementTerm(
                                item.name,
                                item.dir,
                                cell,
                                itemIndex);
                            const auto off = storeMaskWords(*game, coupled.objectMask);
                            game->anyObjectOffsets.push_back(off);
                            anyOffsets.push_back(off);
                            anyAnchorIds.push_back(
                                objectIdsFromMask(coupled.objectMask, game->objectCount));
                            if (!item.dir.empty() && !coupled.term.layers.empty()) {
                                layerCoupledMovementMasks.push_back(std::move(coupled.term));
                            }
                            if (propertyCoalescingPlan.sinks.find(item.name)
                                != propertyCoalescingPlan.sinks.end()) {
                                inferredPropertySources.push_back({item.name});
                            }
                        } else {
                            const auto off = storeMaskWords(*game, mask);
                            game->anyObjectOffsets.push_back(off);
                            anyOffsets.push_back(off);
                            anyAnchorIds.push_back(objectIdsFromMask(mask, game->objectCount));
                        }
                        if (singleLayer.has_value()) {
                            layersUsedL[static_cast<size_t>(*singleLayer)] = 1;
                        }
                    } else if (singleLayer.has_value()) {
                        for (size_t w = 0; w < objectsPresent.size(); ++w) {
                            objectsPresent[w] |= mask[w];
                        }
                        layersUsedL[static_cast<size_t>(*singleLayer)] = 1;
                        orShiftedMask5(lhsObjectLayersMovement, 5 * (*singleLayer), 0x1f);
                    } else {
                        const auto off = storeMaskWords(*game, mask);
                        game->anyObjectOffsets.push_back(off);
                        anyOffsets.push_back(off);
                        anyAnchorIds.push_back(objectIdsFromMask(mask, game->objectCount));
                    }

                    if (singleLayer.has_value()) {
                        const int32_t layer = *singleLayer;
                        const auto* aggregateConcreteDirs = concreteDirsForAggregate(item.dir);
                        if (item.dir == "stationary") {
                            orShiftedMask5(movementsMissing, 5 * layer, 0x1f);
                        } else if (aggregateConcreteDirs != nullptr) {
                            int32_t aggregateBits5 = 0;
                            for (const auto& concreteDir : *aggregateConcreteDirs) {
                                aggregateBits5 |= dirMaskFromToken(concreteDir);
                            }
                            if (aggregateBits5 != 0) {
                                auto anyMask = puzzlescript::MaskVector(
                                    static_cast<size_t>(game->movementWordCount), 0);
                                orShiftedMask5(anyMask, 5 * layer, aggregateBits5);
                                anyMovementMasks.push_back(std::move(anyMask));
                                bool preservedOnRhs = false;
                                if (rhsRow != nullptr && cellIndex < rhsRow->size()) {
                                    const ParsedCell& rhsCell = (*rhsRow)[cellIndex];
                                    if (!rhsCell.isEllipsis) {
                                        for (const auto& rhsItem : rhsCell.items) {
                                            if (rhsItem.dir == item.dir && rhsItem.name == item.name) {
                                                preservedOnRhs = true;
                                                break;
                                            }
                                        }
                                    }
                                }
                                if (!preservedOnRhs) {
                                    orShiftedMask5(aggregateMovementsMask, 5 * layer, aggregateBits5);
                                }
                            }
                        } else if (!item.dir.empty()) {
                            const int32_t dm = dirMaskFromToken(item.dir);
                            if (dm != 0) {
                                orShiftedMask5(movementsPresent, 5 * layer, dm);
                            }
                        }
                    }
                }

                puzzlescript::Pattern pat;
                pat.kind = puzzlescript::Pattern::Kind::CellPattern;
                auto maskHasAnyBit = [](const puzzlescript::MaskVector& words) {
                    return std::any_of(words.begin(), words.end(), [](puzzlescript::MaskWord word) { return word != 0; });
                };
                pat.hasObjectsPresent = maskHasAnyBit(objectsPresent);
                pat.hasObjectsMissing = maskHasAnyBit(objectsMissing);
                pat.hasMovementsPresent = maskHasAnyBit(movementsPresent);
                pat.hasMovementsMissing = maskHasAnyBit(movementsMissing);
                pat.objectsPresent = storeMaskWords(*game, objectsPresent);
                pat.objectsMissing = storeMaskWords(*game, objectsMissing);
                pat.movementsPresent = storeMaskWords(*game, movementsPresent);
                pat.movementsMissing = storeMaskWords(*game, movementsMissing);
                pat.objectAnchorIds = objectIdsFromMask(objectsPresent, game->objectCount);
                pat.anyObjectsFirst = static_cast<uint32_t>(game->anyObjectOffsets.size() - anyOffsets.size());
                pat.anyObjectsCount = static_cast<uint32_t>(anyOffsets.size());
                pat.anyObjectAnchorIds = std::move(anyAnchorIds);
                pat.anyMovementsFirst = static_cast<uint32_t>(game->anyMovementOffsets.size());
                for (const auto& anyMask : anyMovementMasks) {
                    game->anyMovementOffsets.push_back(storeMaskWords(*game, anyMask));
                }
                pat.anyMovementsCount = static_cast<uint32_t>(anyMovementMasks.size());
                pat.layerCoupledMovementMasks = std::move(layerCoupledMovementMasks);

                if (rhsRow && cellIndex < rhsRow->size()) {
                    const ParsedCell& rhsCell = (*rhsRow)[cellIndex];
                    if (!rhsCell.isEllipsis) {
                        // Compute clear/set per layer for RHS. Best-effort:
                        // clear all layers used by either lhs cell single-layer masks
                        // or rhs cell single-layer masks, then set rhs objects.
                        auto objectsClear = makeEmptyMask(game->wordCount);
                        auto objectsSet = makeEmptyMask(game->wordCount);
                        auto movementsClear = puzzlescript::MaskVector(static_cast<size_t>(game->movementWordCount), 0);
                        auto movementsSet = puzzlescript::MaskVector(static_cast<size_t>(game->movementWordCount), 0);
                        auto movementsLayerMask = puzzlescript::MaskVector(static_cast<size_t>(game->movementWordCount), 0);
                        auto randomEntityMask = puzzlescript::MaskVector(static_cast<size_t>(game->wordCount), 0);
                        auto randomDirMask = puzzlescript::MaskVector(static_cast<size_t>(game->movementWordCount), 0);
                        auto rhsPropertyPreserveMask = makeEmptyMask(game->wordCount);
                        std::vector<int32_t> layersUsedR(game->layerCount, 0);
                        puzzlescript::MaskVector rhsObjectLayersMovement(static_cast<size_t>(game->movementWordCount), 0);
                        std::set<int32_t> aggregateInferenceLayers;
                        std::vector<puzzlescript::InferredAggregateBinding> inferredAggregateBindings;
                        std::vector<puzzlescript::InferredPropertyBinding> inferredPropertyBindings;
                        std::vector<puzzlescript::LayerCoupledMovementReplacement> layerCoupledMovementReplacements;

                        auto markLayerClear = [&](int32_t layer) {
                            if (layer < 0 || layer >= game->layerCount) return;
                            const auto off = game->layerMaskOffsets[static_cast<size_t>(layer)];
                            for (uint32_t w = 0; w < game->wordCount; ++w) {
                                objectsClear[static_cast<size_t>(w)] |= game->maskArena[static_cast<size_t>(off + w)];
                            }
                            // JS semantics: mark movement layers that should be reset.
                            orShiftedMask5(movementsLayerMask, 5 * layer, 0x1f);
                        };

                        auto orLayerMaskToObjectsClear = [&](int32_t layer) {
                            if (layer < 0 || layer >= game->layerCount) return;
                            const auto off = game->layerMaskOffsets[static_cast<size_t>(layer)];
                            for (uint32_t w = 0; w < game->wordCount; ++w) {
                                objectsClear[static_cast<size_t>(w)] |= game->maskArena[static_cast<size_t>(off + w)];
                            }
                        };

                        auto applyPropertyObjectRewriteClears = [&](const std::string& propertyName,
                                                                    int32_t destinationLayer) {
                            std::set<std::string> visiting;
                            const auto propertyMask = resolveMask(resolveMask, propertyName, visiting);
                            for (size_t w = 0; w < objectsClear.size(); ++w) {
                                objectsClear[static_cast<size_t>(w)] |= propertyMask[static_cast<size_t>(w)];
                            }
                            std::set<int32_t> clearedLayers;
                            const auto propIt = propertyOf.find(propertyName);
                            if (propIt == propertyOf.end()) {
                                return;
                            }
                            for (const auto& alias : propIt->second) {
                                const auto objIt = objectIdByName.find(alias);
                                if (objIt == objectIdByName.end()) {
                                    continue;
                                }
                                const int32_t aliasLayer =
                                    game->objectsById[static_cast<size_t>(objIt->second)].layer;
                                if (aliasLayer == destinationLayer || clearedLayers.count(aliasLayer) != 0) {
                                    continue;
                                }
                                orShiftedMask5(movementsLayerMask, 5 * aliasLayer, 0x1f);
                                clearedLayers.insert(aliasLayer);
                            }
                        };

                        // Only clear object layers if the RHS actually writes objects
                        // (i.e. concrete objects or explicit deletes). For property
                        // rules like Moveable -> Moveable, JS leaves objects_clear/set empty.
                        bool rhsWritesObjects = rhsCell.items.empty(); // empty cell => clear
                        if (!rhsWritesObjects) {
                            for (const auto& rhsItem : rhsCell.items) {
                                if (rhsItem.dir == "random") {
                                    rhsWritesObjects = true;
                                    break;
                                }
                                if (rhsItem.dir == "no") {
                                    rhsWritesObjects = true;
                                    break;
                                }
                                // JS rulesToMask only calls objectsSet.ibitset when
                                // state.objects[name] exists — legend aggregates like
                                // Crates must not count as object writes.
                                if (objectIdByName.find(rhsItem.name) != objectIdByName.end()) {
                                    rhsWritesObjects = true;
                                    break;
                                }
                            }
                        }

                        auto masksEqual = [](const puzzlescript::MaskVector& left,
                                             const puzzlescript::MaskVector& right) {
                            const size_t n = std::max(left.size(), right.size());
                            for (size_t w = 0; w < n; ++w) {
                                const puzzlescript::MaskWord l = w < left.size() ? left[w] : 0;
                                const puzzlescript::MaskWord r = w < right.size() ? right[w] : 0;
                                if (l != r) {
                                    return false;
                                }
                            }
                            return true;
                        };
                        auto sameAsUnmovedLhsProperty = [&](const ParsedItem& rhsItem) {
                            if (rhsItem.dir == "no"
                                || rhsItem.dir == "random"
                                || propertyOf.find(rhsItem.name) == propertyOf.end()) {
                                return false;
                            }
                            std::set<std::string> rhsVisiting;
                            const auto rhsMask = resolveMask(resolveMask, rhsItem.name, rhsVisiting);
                            for (const auto& lhsItem : cell.items) {
                                if (!lhsItem.dir.empty()
                                    || lhsItem.dir == "no"
                                    || lhsItem.dir == "random"
                                    || propertyOf.find(lhsItem.name) == propertyOf.end()) {
                                    continue;
                                }
                                std::set<std::string> lhsVisiting;
                                const auto lhsMask = resolveMask(resolveMask, lhsItem.name, lhsVisiting);
                                if (masksEqual(lhsMask, rhsMask)) {
                                    return true;
                                }
                            }
                            return false;
                        };
                        std::vector<uint8_t> rhsNonPreservingWriteLayers(static_cast<size_t>(game->layerCount), 0);
                        for (const auto& rhsItem : rhsCell.items) {
                            if (rhsItem.dir == "no" || sameAsUnmovedLhsProperty(rhsItem)) {
                                continue;
                            }
                            std::set<std::string> visiting;
                            const auto mask = resolveMask(resolveMask, rhsItem.name, visiting);
                            for (int32_t objectId = 0; objectId < game->objectCount; ++objectId) {
                                if (!maskHasBit(mask, objectId)) {
                                    continue;
                                }
                                const int32_t layer =
                                    game->objectsById[static_cast<size_t>(objectId)].layer;
                                if (layer >= 0 && layer < game->layerCount) {
                                    rhsNonPreservingWriteLayers[static_cast<size_t>(layer)] = 1;
                                }
                            }
                        }
                        for (const auto& rhsItem : rhsCell.items) {
                            if (!rhsItem.dir.empty()
                                || propertyOf.find(rhsItem.name) == propertyOf.end()
                                || !sameAsUnmovedLhsProperty(rhsItem)) {
                                continue;
                            }
                            std::set<std::string> visiting;
                            const auto mask = resolveMask(resolveMask, rhsItem.name, visiting);
                            for (int32_t objectId = 0; objectId < game->objectCount; ++objectId) {
                                if (!maskHasBit(mask, objectId)) {
                                    continue;
                                }
                                const int32_t layer =
                                    game->objectsById[static_cast<size_t>(objectId)].layer;
                                if (layer < 0
                                    || layer >= game->layerCount
                                    || rhsNonPreservingWriteLayers[static_cast<size_t>(layer)] != 0) {
                                    continue;
                                }
                                setMaskBit(rhsPropertyPreserveMask, objectId);
                            }
                        }

                        for (size_t rhsItemIndex = 0; rhsItemIndex < rhsCell.items.size(); ++rhsItemIndex) {
                            const auto& item = rhsCell.items[rhsItemIndex];
                            if (item.dir == "random") {
                                std::set<std::string> visiting;
                                const auto mask = resolveMask(resolveMask, item.name, visiting);
                                for (size_t w = 0; w < randomEntityMask.size() && w < mask.size(); ++w) {
                                    randomEntityMask[static_cast<size_t>(w)] |= mask[static_cast<size_t>(w)];
                                }
                                continue;
                            }
                            // JS `dirMasks.randomdir` === parseInt('00101', 2) === 5; OR'd into randomDirMask_r
                            // at STRIDE_5 * layerIndex (compiler.js rulesToMask).
                            if (item.dir == "randomdir") {
                                std::set<std::string> visiting;
                                const auto mask = resolveMask(resolveMask, item.name, visiting);
                                const auto singleLayer = maskSingleLayer(mask);
                                const bool isProperty = propertyOf.find(item.name) != propertyOf.end();
                                if (singleLayer.has_value()) {
                                    layersUsedR[static_cast<size_t>(*singleLayer)] = 1;
                                }
                                if (!isProperty
                                    && objectIdByName.find(item.name) != objectIdByName.end()) {
                                    auto oneMask = makeEmptyMask(game->wordCount);
                                    std::set<std::string> rhsVisiting;
                                    const auto resolved = resolveMask(resolveMask, item.name, rhsVisiting);
                                    for (int32_t id = 0; id < game->objectCount; ++id) {
                                        if (maskHasBit(resolved, id)) {
                                            setMaskBit(oneMask, id);
                                            break;
                                        }
                                    }
                                    for (size_t w = 0; w < objectsSet.size(); ++w) {
                                        objectsSet[static_cast<size_t>(w)] |= oneMask[static_cast<size_t>(w)];
                                    }
                                    if (rhsWritesObjects && singleLayer.has_value()) {
                                        const int32_t layer = *singleLayer;
                                        orLayerMaskToObjectsClear(layer);
                                        orShiftedMask5(rhsObjectLayersMovement, 5 * layer, 0x1f);
                                    }
                                }
                                if (singleLayer.has_value()) {
                                    const int32_t layer = *singleLayer;
                                    orShiftedMask5(movementsLayerMask, 5 * layer, 0x1f);
                                    orShiftedMask5(randomDirMask, 5 * layer, 5);
                                }
                                continue;
                            }
                            if (isLayerCoupledPropertyName(item.name)) {
                                bool propertyInferredSink = false;
                                const auto propertySinkIt = propertyCoalescingPlan.sinks.find(item.name);
                                if (propertySinkIt != propertyCoalescingPlan.sinks.end()) {
                                    for (const PropertySinkPosition& sink : propertySinkIt->second) {
                                        if (sink.row == patternRowIndex && sink.cell == cellIndex) {
                                            propertyInferredSink = true;
                                            break;
                                        }
                                    }
                                }
                                if (propertyInferredSink) {
                                    const auto propIt = propertyOf.find(item.name);
                                    if (propIt != propertyOf.end()) {
                                        for (const auto& alias : propIt->second) {
                                            const auto objIt = objectIdByName.find(alias);
                                            if (objIt == objectIdByName.end()) {
                                                continue;
                                            }
                                            const int32_t layer =
                                                game->objectsById[static_cast<size_t>(objIt->second)].layer;
                                            if (layer >= 0 && layer < game->layerCount) {
                                                layersUsedR[static_cast<size_t>(layer)] = 1;
                                            }
                                        }
                                    }
                                    int32_t dirMode = 0;
                                    int32_t dirMask = 0;
                                    if (item.dir == "stationary") {
                                        dirMode = 1;
                                    } else if (!item.dir.empty()
                                               && concreteDirsForAggregate(item.dir) == nullptr) {
                                        const int32_t dm = dirMaskFromToken(item.dir);
                                        if (dm != 0) {
                                            dirMode = 2;
                                            dirMask = dm;
                                        }
                                    }
                                    puzzlescript::InferredPropertyBinding propertyBinding;
                                    propertyBinding.propertyName = item.name;
                                    propertyBinding.dirMode = dirMode;
                                    propertyBinding.dirMask = dirMask;
                                    inferredPropertyBindings.push_back(std::move(propertyBinding));
                                    if (concreteDirsForAggregate(item.dir) != nullptr) {
                                        const auto aggregateSinkIt =
                                            aggregateCoalescingPlan.sinks.find(item.dir);
                                        if (aggregateSinkIt != aggregateCoalescingPlan.sinks.end()) {
                                            for (const AggregateSinkPosition& aggregateSink :
                                                 aggregateSinkIt->second) {
                                                if (aggregateSink.row == patternRowIndex
                                                    && aggregateSink.cell == cellIndex
                                                    && aggregateSink.propertyName == item.name
                                                    && !aggregateSink.localProperty) {
                                                    puzzlescript::InferredAggregateBinding binding;
                                                    binding.aggregateName = item.dir;
                                                    binding.propertyName = item.name;
                                                    inferredAggregateBindings.push_back(
                                                        std::move(binding));
                                                    break;
                                                }
                                            }
                                        }
                                    }
                                    continue;
                                }
                                if (rhsItemIndex < cell.items.size()) {
                                    const auto& lhsItem = cell.items[rhsItemIndex];
                                    if (lhsItem.name == item.name
                                        && (!lhsItem.dir.empty() || !item.dir.empty())) {
                                        auto coupledReplacementBuild = buildLayerCoupledMovementTerm(
                                            item.name,
                                            lhsItem.dir,
                                            cell,
                                            rhsItemIndex,
                                            false);
                                        auto coupledReplacement = std::move(coupledReplacementBuild.term);
                                        if (concreteDirsForAggregate(item.dir) != nullptr) {
                                            coupledReplacement.replacementAggregateName = item.dir;
                                        } else {
                                            const int32_t replacementMovementMask =
                                                item.dir == "stationary" ? 0 : dirMaskFromToken(item.dir);
                                            if (replacementMovementMask != 0) {
                                                coupledReplacement.replacementMovementMask = replacementMovementMask;
                                                coupledReplacement.hasReplacementMovementMask = true;
                                            }
                                        }
                                        if (!coupledReplacement.layers.empty()) {
                                            layerCoupledMovementReplacements.push_back(
                                                std::move(coupledReplacement));
                                        }
                                    }
                                }
                            }
                            std::set<std::string> visiting;
                            const auto mask = resolveMask(resolveMask, item.name, visiting);
                            const auto singleLayer = maskSingleLayer(mask);
                            const bool isProperty = propertyOf.find(item.name) != propertyOf.end();

                            if (item.dir == "no") {
                                // Explicit delete.
                                for (size_t w = 0; w < objectsClear.size(); ++w) {
                                    objectsClear[w] |= mask[w];
                                }
                                continue;
                            }

                            if (singleLayer.has_value()) {
                                layersUsedR[static_cast<size_t>(*singleLayer)] = 1;
                            }

                            if (!isProperty
                                && objectIdByName.find(item.name) != objectIdByName.end()) {
                                // Concrete objects: set only the first id represented
                                // by this token (handles legend aliases like 1/2/3/4).
                                auto oneMask = makeEmptyMask(game->wordCount);
                                std::set<std::string> rhsVisiting;
                                const auto resolved = resolveMask(resolveMask, item.name, rhsVisiting);
                                for (int32_t id = 0; id < game->objectCount; ++id) {
                                    if (maskHasBit(resolved, id)) {
                                        setMaskBit(oneMask, id);
                                        break;
                                    }
                                }
                                for (size_t w = 0; w < objectsSet.size(); ++w) {
                                    objectsSet[w] |= oneMask[w];
                                }
                                if (rhsWritesObjects && singleLayer.has_value()) {
                                    const int32_t layer = *singleLayer;
                                    orLayerMaskToObjectsClear(layer);
                                    orShiftedMask5(rhsObjectLayersMovement, 5 * layer, 0x1f);
                                    if (hasInferredPropertyRewriteTerm
                                        && rhsItemIndex < cell.items.size()) {
                                        const auto& lhsItem = cell.items[rhsItemIndex];
                                        if (lhsItem.dir.empty()
                                            && item.dir.empty()
                                            && propertyOf.find(lhsItem.name) != propertyOf.end()) {
                                            applyPropertyObjectRewriteClears(lhsItem.name, layer);
                                        }
                                    }
                                }
                            }
                            if (singleLayer.has_value()) {
                                const int32_t layer = *singleLayer;
                                bool preservedAggregate = false;
                                bool inferredAggregateSink = false;
                                if (concreteDirsForAggregate(item.dir) != nullptr
                                    && aggregateCoalescingPlan.safe.count(item.dir) != 0
                                    && cellIndex < row.size()) {
                                    const ParsedCell& lhsCell = row[cellIndex];
                                    if (!lhsCell.isEllipsis) {
                                        for (const auto& lhsItem : lhsCell.items) {
                                            if (lhsItem.dir == item.dir && lhsItem.name == item.name) {
                                                preservedAggregate = true;
                                                break;
                                            }
                                        }
                                    }
                                    if (!preservedAggregate) {
                                        const auto sinkIt = aggregateCoalescingPlan.sinks.find(item.dir);
                                        if (sinkIt != aggregateCoalescingPlan.sinks.end()) {
                                            for (const auto& sink : sinkIt->second) {
                                                if (sink.row == patternRowIndex
                                                    && sink.cell == cellIndex
                                                    && sink.layer.has_value()
                                                    && *sink.layer == layer) {
                                                    inferredAggregateSink = true;
                                                    puzzlescript::InferredAggregateBinding binding;
                                                    binding.aggregateName = item.dir;
                                                    binding.layerIndex = layer;
                                                    inferredAggregateBindings.push_back(std::move(binding));
                                                    break;
                                                }
                                            }
                                        }
                                    }
                                }
                                const bool skipMovementShifts =
                                    preservedAggregate || inferredAggregateSink;
                                // JS rulesToMask: non-empty direction sets postMovementsLayerMask unless
                                // preserved; inferred sinks still clear the layer before capture.
                                if (!item.dir.empty() && item.dir != "no"
                                    && (!skipMovementShifts || inferredAggregateSink)) {
                                    orShiftedMask5(movementsLayerMask, 5 * layer, 0x1f);
                                    if (inferredAggregateSink) {
                                        aggregateInferenceLayers.insert(layer);
                                    }
                                }
                                if (item.dir == "stationary") {
                                    orShiftedMask5(movementsClear, 5 * layer, 0x1f);
                                } else if (!item.dir.empty() && item.dir != "no" && !skipMovementShifts) {
                                    const int32_t dm = dirMaskFromToken(item.dir);
                                    if (dm != 0) {
                                        orShiftedMask5(movementsSet, 5 * layer, dm);
                                    }
                                }
                            }
                        }

                        // JS rulesToMask: if RHS objectsSet doesn't cover LHS objectsPresent,
                        // OR LHS objectsPresent into objectsClear.
                        {
                            bool lhsCovered = true;
                            for (uint32_t w = 0; w < game->wordCount; ++w) {
                                const puzzlescript::MaskWord pres = objectsPresent[static_cast<size_t>(w)];
                                const puzzlescript::MaskWord setv = objectsSet[static_cast<size_t>(w)];
                                if ((pres & setv) != pres) {
                                    lhsCovered = false;
                                    break;
                                }
                            }
                            if (!lhsCovered) {
                                for (uint32_t w = 0; w < game->wordCount; ++w) {
                                    objectsClear[static_cast<size_t>(w)] |= objectsPresent[static_cast<size_t>(w)];
                                }
                            }
                        }
                        // Same for movementsPresent vs movementsSet.
                        {
                            bool movCovered = true;
                            for (uint32_t w = 0; w < game->movementWordCount; ++w) {
                                const puzzlescript::MaskWord pres = movementsPresent[static_cast<size_t>(w)];
                                const puzzlescript::MaskWord setv = movementsSet[static_cast<size_t>(w)];
                                if ((pres & setv) != pres) {
                                    movCovered = false;
                                    break;
                                }
                            }
                            if (!movCovered) {
                                for (uint32_t w = 0; w < game->movementWordCount; ++w) {
                                    movementsClear[static_cast<size_t>(w)] |= movementsPresent[static_cast<size_t>(w)];
                                }
                            }
                        }
                        // JS rulesToMask: aggregate LHS bits cleared unless movementsSet covers them.
                        {
                            bool aggCovered = true;
                            for (uint32_t w = 0; w < game->movementWordCount; ++w) {
                                const puzzlescript::MaskWord agg = aggregateMovementsMask[static_cast<size_t>(w)];
                                const puzzlescript::MaskWord setv = movementsSet[static_cast<size_t>(w)];
                                if ((agg & setv) != agg) {
                                    aggCovered = false;
                                    break;
                                }
                            }
                            if (!aggCovered) {
                                for (uint32_t w = 0; w < game->movementWordCount; ++w) {
                                    movementsClear[static_cast<size_t>(w)] |= aggregateMovementsMask[static_cast<size_t>(w)];
                                }
                            }
                        }

                        // JS rulesToMask always clears layers mentioned on the LHS
                        // when the corresponding RHS cell omits that layer.
                        for (int32_t layer = 0; layer < game->layerCount; ++layer) {
                            if (layersUsedL[static_cast<size_t>(layer)] != 0
                                && layersUsedR[static_cast<size_t>(layer)] == 0) {
                                markLayerClear(layer);
                            }
                        }

                        // JS: postMovementsLayerMask |= (objectlayers_l & ~objectlayers_r)
                        {
                            puzzlescript::MaskVector residual = lhsObjectLayersMovement;
                            for (size_t w = 0; w < residual.size(); ++w) {
                                residual[static_cast<size_t>(w)] &= ~rhsObjectLayersMovement[static_cast<size_t>(w)];
                            }
                            for (size_t w = 0; w < movementsLayerMask.size(); ++w) {
                                movementsLayerMask[static_cast<size_t>(w)] |= residual[static_cast<size_t>(w)];
                            }
                        }

                        auto randomEntityTouchesLayer = [&](int32_t layer) {
                            if (layer < 0 || layer >= game->layerCount) {
                                return false;
                            }
                            const auto off = game->layerMaskOffsets[static_cast<size_t>(layer)];
                            for (uint32_t w = 0; w < game->wordCount; ++w) {
                                const puzzlescript::MaskWord layerWord = game->maskArena[static_cast<size_t>(off + w)];
                                if ((randomEntityMask[static_cast<size_t>(w)] & layerWord) != 0) {
                                    return true;
                                }
                            }
                            return false;
                        };

                        // If we set a concrete object on a layer, JS does not
                        // clear that layer's movement bits implicitly.
                        if (rhsWritesObjects) {
                            for (int32_t layer = 0; layer < game->layerCount; ++layer) {
                                const auto off = game->layerMaskOffsets[static_cast<size_t>(layer)];
                                bool overlaps = false;
                                for (uint32_t w = 0; w < game->wordCount; ++w) {
                                    const puzzlescript::MaskWord layerWord = game->maskArena[static_cast<size_t>(off + w)];
                                    if ((objectsSet[static_cast<size_t>(w)] & layerWord) != 0) {
                                        overlaps = true;
                                        break;
                                    }
                                }
                                if (overlaps) {
                                    const int32_t moveSetBits = getShiftedMask5(movementsSet, 5 * layer);
                                    const int32_t moveClearBits = getShiftedMask5(movementsClear, 5 * layer);
                                    const int32_t randomDirBits = getShiftedMask5(randomDirMask, 5 * layer);
                                    const bool randomEntOnLayer = randomEntityTouchesLayer(layer);
                                    // Only suppress implicit layer-mask clearing when there is no explicit
                                    // movement directive on the layer (including randomDir / random entity).
                                    if (aggregateInferenceLayers.count(layer) == 0
                                        && moveSetBits == 0 && moveClearBits == 0 && randomDirBits == 0
                                        && !randomEntOnLayer) {
                                        setShiftedMask5(movementsLayerMask, 5 * layer, 0);
                                    }
                                }
                            }
                        }

                        auto anyNonZero = [](const puzzlescript::MaskVector& words) {
                            for (const puzzlescript::MaskWord w : words) {
                                if (w != 0) return true;
                            }
                            return false;
                        };

                        puzzlescript::Replacement repl;
                        repl.objectsClear = storeMaskWords(*game, objectsClear);
                        repl.objectsSet = storeMaskWords(*game, objectsSet);
                        repl.movementsClear = storeMaskWords(*game, movementsClear);
                        repl.movementsSet = storeMaskWords(*game, movementsSet);
                        repl.movementsLayerMask = storeMaskWords(*game, movementsLayerMask);
                        repl.hasMovementsLayerMask = anyNonZero(movementsLayerMask);
                        const bool hasDynamicReplacement =
                            !inferredAggregateBindings.empty()
                            || !inferredPropertyBindings.empty()
                            || !inferredPropertySources.empty()
                            || !layerCoupledMovementReplacements.empty()
                            || anyNonZero(rhsPropertyPreserveMask);
                        if (hasDynamicReplacement) {
                            auto& dynamic = repl.ensureDynamic();
                            dynamic.inferredAggregateBindings =
                                std::move(inferredAggregateBindings);
                            dynamic.inferredPropertyBindings =
                                std::move(inferredPropertyBindings);
                            dynamic.inferredPropertySources =
                                std::move(inferredPropertySources);
                            dynamic.layerCoupledMovementReplacements =
                                std::move(layerCoupledMovementReplacements);
                            if (anyNonZero(rhsPropertyPreserveMask)) {
                                dynamic.rhsPropertyPreserveMask =
                                    storeMaskWords(*game, rhsPropertyPreserveMask);
                            }
                        }
                        if (anyNonZero(randomEntityMask)) {
                            repl.randomEntityMask = storeMaskWords(*game, randomEntityMask);
                            repl.randomEntityMaskWidth = game->wordCount;
                            repl.hasRandomEntityMask = true;
                            for (int32_t objectId = 0; objectId < game->objectCount; ++objectId) {
                                if (maskHasBit(randomEntityMask, objectId)) {
                                    repl.randomEntityChoices.push_back(objectId);
                                }
                            }
                        }
                        if (anyNonZero(randomDirMask)) {
                            repl.randomDirMask = storeMaskWords(*game, randomDirMask);
                            repl.randomDirMaskWidth = game->movementWordCount;
                            repl.hasRandomDirMask = true;
                            for (int32_t layer = 0; layer < game->layerCount; ++layer) {
                                if (getShiftedMask5(randomDirMask, 5 * layer) != 0) {
                                    repl.randomDirLayers.push_back(layer);
                                }
                            }
                        }
                        if (anyNonZero(objectsClear) || anyNonZero(objectsSet) || anyNonZero(movementsClear)
                            || anyNonZero(movementsSet) || anyNonZero(movementsLayerMask)
                            || anyNonZero(randomEntityMask) || anyNonZero(randomDirMask)
                            || repl.dynamic != nullptr) {
                            pat.replacement = std::move(repl);
                        }
                    }
                }

                out.push_back(std::move(pat));
            }
            return out;
        };

        rule.patterns.clear();
        rule.ellipsisCount.clear();
        for (size_t rowIndex = 0; rowIndex < variantLhsRowsExpanded.size(); ++rowIndex) {
            const ParsedRow& lhsRow = variantLhsRowsExpanded[rowIndex];
            const ParsedRow* rhsRow = (rowIndex < variantRhsRowsExpanded.size()) ? &variantRhsRowsExpanded[rowIndex] : nullptr;
            auto loweredRow = buildPatternRow(lhsRow, rhsRow, rowIndex);
            int32_t ellipsisInRow = 0;
            for (const auto& pat : loweredRow) {
                if (pat.kind == puzzlescript::Pattern::Kind::Ellipsis) {
                    ++ellipsisInRow;
                }
            }
            rule.patterns.push_back(std::move(loweredRow));
            rule.ellipsisCount.push_back(ellipsisInRow);
        }

        // Build row/rule masks so runtime fast-paths don't deref null.
        auto ruleMaskWords = makeEmptyMask(game->wordCount);
        const uint32_t rowMasksFirst = static_cast<uint32_t>(game->cellRowMaskOffsets.size());
        for (const auto& row : rule.patterns) {
            auto rowMaskWords = makeEmptyMask(game->wordCount);
            for (const auto& pat : row) {
                if (pat.kind != puzzlescript::Pattern::Kind::CellPattern) {
                    continue;
                }
                const auto off = pat.objectsPresent;
                if (off == puzzlescript::kNullMaskOffset) {
                    continue;
                }
                for (uint32_t w = 0; w < game->wordCount; ++w) {
                    const puzzlescript::MaskWord word = game->maskArena[static_cast<size_t>(off + w)];
                    rowMaskWords[static_cast<size_t>(w)] |= word;
                    ruleMaskWords[static_cast<size_t>(w)] |= word;
                }
            }
            game->cellRowMaskOffsets.push_back(storeMaskWords(*game, rowMaskWords));
        }
        rule.cellRowMasksFirst = rowMasksFirst;
        rule.cellRowMasksCount = static_cast<uint32_t>(game->cellRowMaskOffsets.size()) - rowMasksFirst;
        rule.ruleMask = storeMaskWords(*game, ruleMaskWords);

        // Movement row masks: JS IR includes these; build them similarly to
        // cell_row_masks but over movement masks.
        auto ruleMovementMaskWords = makeEmptyMask(game->movementWordCount);
        const uint32_t rowMoveMasksFirst = static_cast<uint32_t>(game->cellRowMaskMovementsOffsets.size());
        for (const auto& row : rule.patterns) {
            auto rowMoveMaskWords = makeEmptyMask(game->movementWordCount);
            for (const auto& pat : row) {
                if (pat.kind != puzzlescript::Pattern::Kind::CellPattern) {
                    continue;
                }
                const auto off = pat.movementsPresent;
                if (off == puzzlescript::kNullMaskOffset) {
                    continue;
                }
                for (uint32_t w = 0; w < game->movementWordCount; ++w) {
                    const puzzlescript::MaskWord word = game->maskArena[static_cast<size_t>(off + w)];
                    rowMoveMaskWords[static_cast<size_t>(w)] |= word;
                    ruleMovementMaskWords[static_cast<size_t>(w)] |= word;
                }
            }
            game->cellRowMaskMovementsOffsets.push_back(storeMaskWords(*game, rowMoveMaskWords));
        }
        rule.cellRowMasksMovementsFirst = rowMoveMasksFirst;
        rule.cellRowMasksMovementsCount =
            static_cast<uint32_t>(game->cellRowMaskMovementsOffsets.size()) - rowMoveMasksFirst;
        rule.hasRuleMovementMask = std::any_of(
            ruleMovementMaskWords.begin(),
            ruleMovementMaskWords.end(),
            [](int32_t word) { return word != 0; });
        rule.ruleMovementMask = storeMaskWords(*game, ruleMovementMaskWords);

        const uint32_t rowMissingObjectMasksFirst =
            static_cast<uint32_t>(game->cellRowMissingObjectMaskOffsets.size());
        for (const auto& row : rule.patterns) {
            auto rowMissingWords = makeEmptyMask(game->wordCount);
            for (const auto& pat : row) {
                if (pat.kind != puzzlescript::Pattern::Kind::CellPattern) {
                    continue;
                }
                const auto off = pat.objectsMissing;
                if (off == puzzlescript::kNullMaskOffset) {
                    continue;
                }
                for (uint32_t w = 0; w < game->wordCount; ++w) {
                    rowMissingWords[static_cast<size_t>(w)] |=
                        game->maskArena[static_cast<size_t>(off + w)];
                }
            }
            if (std::any_of(rowMissingWords.begin(), rowMissingWords.end(),
                    [](puzzlescript::MaskWord word) { return word != 0; })) {
                game->needsObjectLineAllMasks = true;
            }
            game->cellRowMissingObjectMaskOffsets.push_back(storeMaskWords(*game, rowMissingWords));
        }
        rule.cellRowMissingObjectMasksFirst = rowMissingObjectMasksFirst;
        rule.cellRowMissingObjectMasksCount =
            static_cast<uint32_t>(game->cellRowMissingObjectMaskOffsets.size()) - rowMissingObjectMasksFirst;

        const uint32_t rowMissingMovementMasksFirst =
            static_cast<uint32_t>(game->cellRowMissingMovementMaskOffsets.size());
        for (const auto& row : rule.patterns) {
            auto rowMissingMovementWords = makeEmptyMask(game->movementWordCount);
            for (const auto& pat : row) {
                if (pat.kind != puzzlescript::Pattern::Kind::CellPattern) {
                    continue;
                }
                const auto off = pat.movementsMissing;
                if (off == puzzlescript::kNullMaskOffset) {
                    continue;
                }
                for (uint32_t w = 0; w < game->movementWordCount; ++w) {
                    rowMissingMovementWords[static_cast<size_t>(w)] |=
                        game->maskArena[static_cast<size_t>(off + w)];
                }
            }
            if (std::any_of(rowMissingMovementWords.begin(), rowMissingMovementWords.end(),
                    [](puzzlescript::MaskWord word) { return word != 0; })) {
                game->needsMovementLineAllMasks = true;
            }
            game->cellRowMissingMovementMaskOffsets.push_back(
                storeMaskWords(*game, rowMissingMovementWords));
        }
        rule.cellRowMissingMovementMasksFirst = rowMissingMovementMasksFirst;
        rule.cellRowMissingMovementMasksCount =
            static_cast<uint32_t>(game->cellRowMissingMovementMaskOffsets.size()) - rowMissingMovementMasksFirst;

        rule.cellRowAnyObjectMasks.clear();
        rule.cellRowAnyObjectMasks.reserve(rule.patterns.size());
        rule.cellRowAnyMovementMasks.clear();
        rule.cellRowAnyMovementMasks.reserve(rule.patterns.size());
        for (const auto& row : rule.patterns) {
            puzzlescript::RowAnyMaskSpan anyObjectSpan{
                static_cast<uint32_t>(game->cellRowAnyObjectMaskOffsets.size()),
                0
            };
            puzzlescript::RowAnyMaskSpan anyMovementSpan{
                static_cast<uint32_t>(game->cellRowAnyMovementMaskOffsets.size()),
                0
            };
            for (const auto& pat : row) {
                if (pat.kind != puzzlescript::Pattern::Kind::CellPattern) {
                    continue;
                }
                for (uint32_t i = 0; i < pat.anyObjectsCount; ++i) {
                    game->cellRowAnyObjectMaskOffsets.push_back(
                        game->anyObjectOffsets[
                            static_cast<size_t>(pat.anyObjectsFirst + i)]);
                    ++anyObjectSpan.count;
                }
                for (uint32_t i = 0; i < pat.anyMovementsCount; ++i) {
                    game->cellRowAnyMovementMaskOffsets.push_back(
                        game->anyMovementOffsets[
                            static_cast<size_t>(pat.anyMovementsFirst + i)]);
                    ++anyMovementSpan.count;
                }
            }
            rule.cellRowAnyObjectMasks.push_back(anyObjectSpan);
            rule.cellRowAnyMovementMasks.push_back(anyMovementSpan);
        }

        auto orArenaMask = [&](puzzlescript::MaskVector& target,
                               puzzlescript::MaskOffset offset,
                               uint32_t width) {
            if (offset == puzzlescript::kNullMaskOffset) {
                return;
            }
            for (uint32_t w = 0; w < width; ++w) {
                target[static_cast<size_t>(w)] |=
                    game->maskArena[static_cast<size_t>(offset + w)];
            }
        };

        auto readObjectsWords = makeEmptyMask(game->wordCount);
        auto writeObjectsWords = makeEmptyMask(game->wordCount);
        auto readMovementWords = puzzlescript::MaskVector(
            static_cast<size_t>(game->movementWordCount), 0);
        auto writeMovementWords = puzzlescript::MaskVector(
            static_cast<size_t>(game->movementWordCount), 0);

        for (const auto& row : rule.patterns) {
            for (const auto& pat : row) {
                if (pat.kind != puzzlescript::Pattern::Kind::CellPattern) {
                    continue;
                }
                orArenaMask(readObjectsWords, pat.objectsPresent, game->wordCount);
                orArenaMask(readObjectsWords, pat.objectsMissing, game->wordCount);
                for (uint32_t i = 0; i < pat.anyObjectsCount; ++i) {
                    orArenaMask(
                        readObjectsWords,
                        game->anyObjectOffsets[
                            static_cast<size_t>(pat.anyObjectsFirst + i)],
                        game->wordCount);
                }
                orArenaMask(readMovementWords, pat.movementsPresent, game->movementWordCount);
                orArenaMask(readMovementWords, pat.movementsMissing, game->movementWordCount);
                for (uint32_t i = 0; i < pat.anyMovementsCount; ++i) {
                    orArenaMask(
                        readMovementWords,
                        game->anyMovementOffsets[
                            static_cast<size_t>(pat.anyMovementsFirst + i)],
                        game->movementWordCount);
                }
                for (const auto& coupled : pat.layerCoupledMovementMasks) {
                    for (const auto& layerTerm : coupled.layers) {
                        orArenaMask(readObjectsWords, layerTerm.objectMask, game->wordCount);
                        orArenaMask(readMovementWords, layerTerm.movementsAny, game->movementWordCount);
                        orArenaMask(readMovementWords, layerTerm.movementsPresent, game->movementWordCount);
                        orArenaMask(readMovementWords, layerTerm.movementsMissing, game->movementWordCount);
                    }
                }

                if (!pat.replacement.has_value()) {
                    continue;
                }
                const auto& repl = *pat.replacement;
                orArenaMask(writeObjectsWords, repl.objectsClear, game->wordCount);
                orArenaMask(writeObjectsWords, repl.objectsSet, game->wordCount);
                if (repl.hasRandomEntityMask) {
                    orArenaMask(writeObjectsWords, repl.randomEntityMask, game->wordCount);
                }
                orArenaMask(writeMovementWords, repl.movementsClear, game->movementWordCount);
                orArenaMask(writeMovementWords, repl.movementsSet, game->movementWordCount);
                if (repl.hasMovementsLayerMask) {
                    orArenaMask(writeMovementWords, repl.movementsLayerMask, game->movementWordCount);
                }
                if (repl.hasRandomDirMask) {
                    orArenaMask(writeMovementWords, repl.randomDirMask, game->movementWordCount);
                }
                if (repl.dynamic != nullptr) {
                    for (const auto& coupled : repl.dynamic->layerCoupledMovementReplacements) {
                        for (const auto& layerTerm : coupled.layers) {
                            auto layerMovement = puzzlescript::MaskVector(
                                static_cast<size_t>(game->movementWordCount), 0);
                            orShiftedMask5(layerMovement, 5 * layerTerm.layerIndex, 0x1f);
                            for (uint32_t w = 0; w < game->movementWordCount; ++w) {
                                writeMovementWords[static_cast<size_t>(w)] |=
                                    layerMovement[static_cast<size_t>(w)];
                            }
                        }
                    }
                }
            }
        }
        const puzzlescript::MaskVector inputSpecReadMovementWords =
            computeInputSpecReadMovementsPresent(
                *game,
                rule,
                propertyOf,
                objectIdByName);
        const puzzlescript::MaskVector inputSpecWriteMovementWords =
            computeInputSpecWriteMovementsSet(
                *game,
                rule,
                propertyOf,
                objectIdByName);
        rule.readObjects = storeMaskWords(*game, readObjectsWords);
        rule.hasReadObjects = maskHasAnyBit(readObjectsWords);
        rule.readMovements = storeMaskWords(*game, readMovementWords);
        rule.hasReadMovements = maskHasAnyBit(readMovementWords);
        rule.writeObjects = storeMaskWords(*game, writeObjectsWords);
        rule.hasWriteObjects = maskHasAnyBit(writeObjectsWords);
        rule.writeMovements = storeMaskWords(*game, writeMovementWords);
        rule.hasWriteMovements = maskHasAnyBit(writeMovementWords);
        rule.inputSpecReadMovementsPresent =
            storeMaskWords(*game, inputSpecReadMovementWords);
        rule.hasInputSpecReadMovementsPresent =
            maskHasAnyBit(inputSpecReadMovementWords);
        rule.inputSpecWriteMovementsSet =
            storeMaskWords(*game, inputSpecWriteMovementWords);
        rule.hasInputSpecWriteMovementsSet =
            maskHasAnyBit(inputSpecWriteMovementWords);
        const bool replaySensitiveCommand = std::any_of(
            rule.commands.begin(),
            rule.commands.end(),
            [](const puzzlescript::RuleCommand& command) {
                return isReplaySensitiveCommand(command.name);
            });
        rule.forceAlwaysRun = rule.isRandom
            || rule.rigid
            || replaySensitiveCommand
            || (!rule.hasReadObjects && !rule.hasReadMovements);

        const std::string signature = ruleVariantSignature(
            entry.lineNumber,
            concreteRuleDirection,
            rigidRule,
            randomRule,
            lateRule,
            variantLhsRowsExpanded,
            variantRhsRowsExpanded,
            parsedCommands
        );
        outputGroup->push_back(std::move(rule));
        outputSignatures->push_back(signature);
        }
        }
        }
    }

    auto dedupeRuleGroups = [](std::vector<std::vector<puzzlescript::Rule>>& groups,
                               std::vector<std::vector<std::string>>& signatures) {
        for (size_t groupIndex = 0; groupIndex < groups.size() && groupIndex < signatures.size(); ++groupIndex) {
            auto& group = groups[groupIndex];
            auto& groupSigs = signatures[groupIndex];
            if (group.size() != groupSigs.size() || group.empty()) {
                continue;
            }
            std::set<std::string> seen;
            std::vector<uint8_t> keep(group.size(), 0);
            for (size_t i = group.size(); i-- > 0;) {
                const auto [_, inserted] = seen.insert(groupSigs[i]);
                if (inserted) {
                    keep[i] = 1;
                }
            }
            std::vector<puzzlescript::Rule> filteredGroup;
            std::vector<std::string> filteredSigs;
            filteredGroup.reserve(group.size());
            filteredSigs.reserve(groupSigs.size());
            for (size_t i = 0; i < group.size(); ++i) {
                if (keep[i] == 0) {
                    continue;
                }
                filteredGroup.push_back(std::move(group[i]));
                filteredSigs.push_back(std::move(groupSigs[i]));
            }
            group = std::move(filteredGroup);
            groupSigs = std::move(filteredSigs);
        }
    };
    dedupeRuleGroups(game->rules, earlyRuleSignatures);
    dedupeRuleGroups(game->lateRules, lateRuleSignatures);

    // Rigid bookkeeping tables used by runtime conflict resolution.
    game->rigid = false;
    game->rigidGroups.clear();
    game->rigidGroupIndexToGroupIndex.clear();
    game->groupIndexToRigidGroupIndex.clear();
    game->groupNumberToRigidGroupIndex.clear();
    game->groupIndexToRigidGroupIndex.reserve(game->rules.size());

    int32_t maxGroupNumber = -1;
    for (const auto& group : game->rules) {
        for (const auto& rule : group) {
            if (rule.groupNumber > maxGroupNumber) {
                maxGroupNumber = rule.groupNumber;
            }
        }
    }
    if (maxGroupNumber >= 0) {
        game->groupNumberToRigidGroupIndex.assign(static_cast<size_t>(maxGroupNumber + 1), -1);
    }

    for (int32_t groupIndex = 0; groupIndex < static_cast<int32_t>(game->rules.size()); ++groupIndex) {
        const auto& group = game->rules[static_cast<size_t>(groupIndex)];
        bool anyRigid = false;
        for (const auto& rule : group) {
            if (rule.rigid) {
                anyRigid = true;
                break;
            }
        }
        if (!anyRigid) {
            game->groupIndexToRigidGroupIndex.push_back(-1);
            continue;
        }

        game->rigid = true;
        const int32_t rigidGroupIndex = static_cast<int32_t>(game->rigidGroups.size());
        game->rigidGroups.push_back(true);
        game->rigidGroupIndexToGroupIndex.push_back(groupIndex);
        game->groupIndexToRigidGroupIndex.push_back(rigidGroupIndex);
        for (const auto& rule : group) {
            if (rule.groupNumber >= 0
                && static_cast<size_t>(rule.groupNumber) < game->groupNumberToRigidGroupIndex.size()) {
                game->groupNumberToRigidGroupIndex[static_cast<size_t>(rule.groupNumber)] = rigidGroupIndex;
            }
        }
    }

    attachInputSpecializationMasks(*game);

    auto calculateLoopPoints = [](const std::vector<std::pair<int32_t, int32_t>>& loopRanges,
                                  const std::vector<std::vector<puzzlescript::Rule>>& ruleGroups) {
        std::map<int32_t, int32_t> loopPoint;
        for (const auto& [loopStartLine, loopEndLine] : loopRanges) {
            int32_t initGroupIndex = -1;
            for (int32_t groupIndex = 0; groupIndex < static_cast<int32_t>(ruleGroups.size()); ++groupIndex) {
                const auto& ruleGroup = ruleGroups[static_cast<size_t>(groupIndex)];
                if (ruleGroup.empty()) {
                    continue;
                }

                const int32_t firstRuleLine = ruleGroup.front().lineNumber;
                if (loopEndLine < firstRuleLine) {
                    break;
                }

                const bool ruleInLoop = loopStartLine <= firstRuleLine && firstRuleLine <= loopEndLine;
                if (!ruleInLoop) {
                    continue;
                }

                if (initGroupIndex == -1) {
                    initGroupIndex = groupIndex;
                }
                const auto prev = loopPoint.find(groupIndex - 1);
                if (groupIndex > 0 && prev != loopPoint.end() && prev->second == initGroupIndex) {
                    loopPoint.erase(prev);
                }
                loopPoint[groupIndex] = initGroupIndex;
            }
        }
        return loopPoint;
    };
    auto buildLoopPointTable = [](const std::map<int32_t, int32_t>& points) {
        puzzlescript::LoopPointTable table;
        if (points.empty()) {
            return table;
        }
        const int32_t maxKey = points.rbegin()->first;
        table.entries.assign(static_cast<size_t>(maxKey + 1), std::nullopt);
        for (const auto& [k, v] : points) {
            if (k >= 0 && static_cast<size_t>(k) < table.entries.size()) {
                table.entries[static_cast<size_t>(k)] = v;
            }
        }
        return table;
    };
    const auto earlyLoopPointMap = calculateLoopPoints(loopRanges, game->rules);
    const auto lateLoopPointMap = calculateLoopPoints(loopRanges, game->lateRules);
    game->loopPoint = buildLoopPointTable(earlyLoopPointMap);
    game->lateLoopPoint = buildLoopPointTable(lateLoopPointMap);

    game->winConditions.clear();
    for (const auto& entry : state.winconditions) {
        if (entry.tokens.size() < 2) {
            continue;
        }

        puzzlescript::WinCondition condition;
        if (entry.tokens[0] == "no") {
            condition.quantifier = -1;
        } else if (entry.tokens[0] == "all") {
            condition.quantifier = 1;
        } else {
            condition.quantifier = 0; // "some"
        }
        condition.lineNumber = entry.lineNumber;

        auto allObjectsMask = [&]() {
            auto mask = makeEmptyMask(game->wordCount);
            for (int32_t id = 0; id < game->objectCount; ++id) {
                setMaskBit(mask, id);
            }
            return mask;
        };

        auto resolveWinMask = [&](const std::string& name, bool& aggregate) {
            aggregate = false;
            if (name == "\nall\n") {
                return allObjectsMask();
            }
            if (objectIdByName.find(name) != objectIdByName.end()
                || synonymOf.find(name) != synonymOf.end()
                || propertyOf.find(name) != propertyOf.end()) {
                std::set<std::string> visiting;
                return resolveMask(resolveMask, name, visiting);
            }
            if (aggregateOf.find(name) != aggregateOf.end()) {
                aggregate = true;
                std::set<std::string> visiting;
                return resolveMask(resolveMask, name, visiting);
            }
            return makeEmptyMask(game->wordCount);
        };

        bool aggr1 = false;
        bool aggr2 = false;
        const auto filter1 = resolveWinMask(entry.tokens[1], aggr1);
        const std::string filter2Name = entry.tokens.size() == 4 ? entry.tokens[3] : std::string("\nall\n");
        const auto filter2 = resolveWinMask(filter2Name, aggr2);

        condition.filter1 = storeMaskWords(*game, filter1);
        condition.filter2 = storeMaskWords(*game, filter2);
        condition.aggr1 = aggr1;
        condition.aggr2 = aggr2;
        game->winConditions.push_back(std::move(condition));
    }
    auto soundDirectionMask = [](const std::string& direction) -> int32_t {
        if (direction == "up") return 1;
        if (direction == "down") return 2;
        if (direction == "left") return 4;
        if (direction == "right") return 8;
        if (direction == "horizontal") return 12;
        if (direction == "vertical") return 3;
        if (direction == "orthogonal") return 15;
        if (direction == "___action____") return 16;
        return 0;
    };

    auto parseSeed = [](const std::string& text) -> int32_t {
        try {
            return static_cast<int32_t>(std::stol(text));
        } catch (const std::exception&) {
            return 0;
        }
    };

    auto expandSoundTargets = [&](auto&& self, const std::string& name, std::set<std::string>& visiting) -> std::vector<std::string> {
        if (!visiting.insert(name).second) {
            return {};
        }
        std::vector<std::string> targets;
        if (objectIdByName.find(name) != objectIdByName.end()) {
            targets.push_back(name);
        } else if (auto synonym = synonymOf.find(name); synonym != synonymOf.end()) {
            targets = self(self, synonym->second, visiting);
        } else if (auto property = propertyOf.find(name); property != propertyOf.end()) {
            for (const auto& item : property->second) {
                auto expanded = self(self, item, visiting);
                targets.insert(targets.end(), expanded.begin(), expanded.end());
            }
        }
        visiting.erase(name);
        return targets;
    };

    game->sfxEvents.clear();
    game->sfxCreationMasks.clear();
    game->sfxDestructionMasks.clear();
    game->sfxMovementMasks.assign(static_cast<size_t>(game->layerCount), {});
    game->sfxMovementFailureMasks.clear();
    for (const auto& entry : state.sounds) {
        if (entry.tokens.size() < 2) {
            continue;
        }
        const auto& seedToken = entry.tokens.back();
        if (seedToken.kind != "SOUND") {
            continue;
        }
        const int32_t seed = parseSeed(seedToken.text);
        const auto& first = entry.tokens.front();
        if (first.kind == "SOUNDEVENT") {
            game->sfxEvents[first.text] = seed;
            continue;
        }
        if (entry.tokens.size() < 3) {
            continue;
        }

        const std::string target = first.text;
        std::string verb = entry.tokens[1].text;
        std::vector<std::string> directions;
        for (size_t tokenIndex = 2; tokenIndex + 1 < entry.tokens.size(); ++tokenIndex) {
            if (entry.tokens[tokenIndex].kind == "DIRECTION") {
                directions.push_back(entry.tokens[tokenIndex].text);
            }
        }
        if (verb == "action") {
            verb = "move";
            directions = {"___action____"};
        }
        if (directions.empty()) {
            directions = {"orthogonal"};
        }

        int32_t directionMaskBits = 0;
        for (const auto& direction : directions) {
            directionMaskBits |= soundDirectionMask(direction);
        }

        puzzlescript::MaskVector objectMask = makeEmptyMask(game->wordCount);
        try {
            std::set<std::string> visiting;
            objectMask = resolveMask(resolveMask, target, visiting);
        } catch (const std::exception&) {
            objectMask = makeEmptyMask(game->wordCount);
        }

        if (verb == "move" || verb == "cantmove") {
            std::set<std::string> visiting;
            const auto targets = expandSoundTargets(expandSoundTargets, target, visiting);
            for (const auto& targetName : targets) {
                const auto objectIt = objectIdByName.find(targetName);
                if (objectIt == objectIdByName.end()) {
                    continue;
                }
                const int32_t objectId = objectIt->second;
                if (objectId < 0 || objectId >= static_cast<int32_t>(game->objectsById.size())) {
                    continue;
                }
                const int32_t layer = game->objectsById[static_cast<size_t>(objectId)].layer;
                if (layer < 0 || layer >= game->layerCount) {
                    continue;
                }
                puzzlescript::MaskVector concreteObjectMask = makeEmptyMask(game->wordCount);
                setMaskBit(concreteObjectMask, objectId);
                puzzlescript::MaskVector directionMaskWords = makeEmptyMask(game->movementWordCount);
                orShiftedMask5(directionMaskWords, 5 * layer, directionMaskBits);

                puzzlescript::SoundMaskEntry lowered;
                lowered.objectMask = storeMaskWords(*game, concreteObjectMask);
                lowered.directionMask = storeMaskWords(*game, directionMaskWords);
                lowered.directionMaskWidth = game->movementWordCount;
                lowered.seed = seed;
                if (verb == "move") {
                    game->sfxMovementMasks[static_cast<size_t>(layer)].push_back(lowered);
                } else {
                    game->sfxMovementFailureMasks.push_back(lowered);
                }
            }
            continue;
        }

        if (verb == "create" || verb == "destroy") {
            puzzlescript::SoundMaskEntry lowered;
            lowered.objectMask = storeMaskWords(*game, objectMask);
            lowered.directionMask = puzzlescript::kNullMaskOffset;
            lowered.directionMaskWidth = 0;
            lowered.seed = seed;
            if (verb == "create") {
                game->sfxCreationMasks.push_back(lowered);
            } else {
                game->sfxDestructionMasks.push_back(lowered);
            }
        }
    }

    outGame.information = std::move(game);
    outGame.initialMetaGameState = std::move(initialMetaGameState);
    return nullptr;
}

} // namespace puzzlescript::compiler
