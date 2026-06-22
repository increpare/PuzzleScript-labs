#include "generator/generation_rules.hpp"

#include "compiler/rule_text.hpp"

#include <algorithm>
#include <cctype>
#include <cmath>
#include <stdexcept>
#include <string_view>
#include <utility>

namespace puzzlescript::generator {
namespace {

using puzzlescript::search::anyBits;
using puzzlescript::search::bitsSet;
using puzzlescript::search::maskPtr;

std::string lowercase(std::string value) {
    std::transform(value.begin(), value.end(), value.begin(), [](unsigned char ch) {
        return static_cast<char>(std::tolower(ch));
    });
    return value;
}

MaskVector emptyMask(const Game& game) {
    return MaskVector(static_cast<size_t>(game.wordCount), 0);
}

void setMaskBit(MaskVector& words, int32_t bitIndex) {
    if (bitIndex < 0) {
        return;
    }
    const uint32_t word = puzzlescript::maskWordIndex(static_cast<uint32_t>(bitIndex));
    if (word >= words.size()) {
        return;
    }
    words[word] |= puzzlescript::maskBit(static_cast<uint32_t>(bitIndex));
}

bool maskHasBit(const MaskVector& words, int32_t bitIndex) {
    if (bitIndex < 0) {
        return false;
    }
    const uint32_t word = puzzlescript::maskWordIndex(static_cast<uint32_t>(bitIndex));
    return word < words.size() && (words[word] & puzzlescript::maskBit(static_cast<uint32_t>(bitIndex))) != 0;
}

void orMask(MaskVector& target, const MaskVector& source) {
    for (size_t i = 0; i < target.size() && i < source.size(); ++i) {
        target[i] |= source[i];
    }
}

void orMaskOffset(MaskVector& target, const Game& game, puzzlescript::MaskOffset offset) {
    const MaskWord* source = maskPtr(game, offset);
    if (source == nullptr) {
        return;
    }
    for (uint32_t i = 0; i < game.wordCount && i < target.size(); ++i) {
        target[i] |= source[i];
    }
}

std::vector<std::vector<std::string>> splitAlternatives(const std::vector<std::string>& tokens, size_t begin) {
    return puzzlescript::compiler::ruletext::splitTopLevelOr(tokens, begin);
}

std::vector<std::vector<std::vector<std::string>>> parseBracketGroups(
    const std::vector<std::string>& tokens,
    size_t begin,
    size_t end
) {
    std::vector<std::vector<std::vector<std::string>>> groups;
    for (auto row : puzzlescript::compiler::ruletext::parseBracketRows(tokens, begin, end, false)) {
        groups.push_back(std::move(row.cells));
    }
    return groups;
}

int32_t objectLayerForBit(const Game& game, int32_t objectId) {
    if (objectId < 0 || static_cast<size_t>(objectId) >= game.objectsById.size()) {
        return -1;
    }
    return game.objectsById[static_cast<size_t>(objectId)].layer;
}

std::vector<int32_t> objectIdsFromMask(const Game& game, const MaskVector& mask) {
    std::vector<int32_t> ids;
    for (int32_t id = 0; id < game.objectCount; ++id) {
        if (maskHasBit(mask, id)) {
            ids.push_back(id);
        }
    }
    return ids;
}

ReplacementTerm makeSetReplacement(const Game& game, const MaskVector& setMask) {
    ReplacementTerm term;
    term.setMask = setMask;
    term.clearMask = emptyMask(game);
    for (const int32_t objectId : objectIdsFromMask(game, setMask)) {
        const int32_t layer = objectLayerForBit(game, objectId);
        if (layer >= 0 && static_cast<size_t>(layer) < game.layerMaskOffsets.size()) {
            orMaskOffset(term.clearMask, game, game.layerMaskOffsets[static_cast<size_t>(layer)]);
        }
    }
    return term;
}

Slot compileSlot(
    const std::vector<std::string>& lhsCell,
    const std::vector<std::string>& rhsCell,
    const Game& game,
    NameResolver& resolver
) {
    Slot slot;
    MaskVector matchedPresentMask = emptyMask(game);
    for (size_t i = 0; i < lhsCell.size(); ++i) {
        std::string token = lowercase(lhsCell[i]);
        if (token == "random" || token == "randomdir" || token == "late" || token == "rigid" || token == "option") {
            throw std::runtime_error("Unsupported V1 generation token in LHS: " + token);
        }
        bool missing = false;
        if (token == "no") {
            if (i + 1 >= lhsCell.size()) {
                throw std::runtime_error("'no' must be followed by a name in generation rules");
            }
            missing = true;
            token = lhsCell[++i];
        }
        PatternTerm term;
        term.mask = resolver.resolve(token);
        term.missing = missing;
        term.any = !missing && resolver.isProperty(token);
        if (!missing) {
            orMask(matchedPresentMask, term.mask);
        }
        slot.terms.push_back(std::move(term));
    }

    if (rhsCell.empty()) {
        ReplacementTerm term;
        term.clearMask = std::move(matchedPresentMask);
        term.setMask = emptyMask(game);
        slot.replacements.push_back(std::move(term));
        return slot;
    }

    for (size_t i = 0; i < rhsCell.size(); ++i) {
        std::string token = lowercase(rhsCell[i]);
        if (token == "random" || token == "randomdir" || token == "late" || token == "rigid" || token == "option") {
            throw std::runtime_error("Unsupported V1 generation token in RHS: " + token);
        }
        if (token == "no") {
            if (i + 1 >= rhsCell.size()) {
                throw std::runtime_error("'no' must be followed by a name in generation rules");
            }
            ReplacementTerm term;
            term.clearMask = resolver.resolve(rhsCell[++i]);
            term.setMask = emptyMask(game);
            slot.replacements.push_back(std::move(term));
            continue;
        }
        slot.replacements.push_back(makeSetReplacement(game, resolver.resolve(token)));
    }
    return slot;
}

Alternative compileAlternative(const std::vector<std::string>& tokens, const Game& game, NameResolver& resolver) {
    size_t cursor = 0;
    std::vector<Direction> explicitDirections;
    bool sawDirection = false;
    double optionProbability = 1.0;
    while (cursor < tokens.size() && tokens[cursor] != "[") {
        const std::string token = lowercase(tokens[cursor]);
        if (token == "up") {
            explicitDirections = {Direction::Up};
            sawDirection = true;
            ++cursor;
            continue;
        }
        if (token == "down") {
            explicitDirections = {Direction::Down};
            sawDirection = true;
            ++cursor;
            continue;
        }
        if (token == "left") {
            explicitDirections = {Direction::Left};
            sawDirection = true;
            ++cursor;
            continue;
        }
        if (token == "right") {
            explicitDirections = {Direction::Right};
            sawDirection = true;
            ++cursor;
            continue;
        }
        if (token == "horizontal") {
            explicitDirections = {Direction::Left, Direction::Right};
            sawDirection = true;
            ++cursor;
            continue;
        }
        if (token == "vertical") {
            explicitDirections = {Direction::Up, Direction::Down};
            sawDirection = true;
            ++cursor;
            continue;
        }
        if (token == "orthogonal") {
            explicitDirections = {Direction::Up, Direction::Down, Direction::Left, Direction::Right};
            sawDirection = true;
            ++cursor;
            continue;
        }
        if (token == "option") {
            if (cursor + 1 >= tokens.size()) {
                throw std::runtime_error("option must be followed by a probability");
            }
            optionProbability = std::stod(tokens[++cursor]);
            if (optionProbability < 0.0 || optionProbability > 1.0) {
                throw std::runtime_error("option probability must be between 0 and 1");
            }
            ++cursor;
            continue;
        }
        throw std::runtime_error("Unsupported generation rule prefix: " + tokens[cursor]);
    }
    const size_t arrowIndex = puzzlescript::compiler::ruletext::findTopLevelArrow(tokens, cursor, tokens.size());
    if (arrowIndex == tokens.size()) {
        throw std::runtime_error("Generation rule alternative is missing ->");
    }
    const auto lhsGroups = parseBracketGroups(tokens, cursor, arrowIndex);
    const auto rhsGroups = parseBracketGroups(tokens, arrowIndex + 1, tokens.size());
    if (lhsGroups.empty()) {
        throw std::runtime_error("Generation rule has no LHS cells");
    }
    if (lhsGroups.size() != rhsGroups.size()) {
        throw std::runtime_error("Generation rule LHS/RHS must have the same number of bracket groups");
    }
    Alternative alternative;
    alternative.optionProbability = optionProbability;
    bool hasDirectionalRows = false;
    for (size_t i = 0; i < lhsGroups.size(); ++i) {
        if (lhsGroups[i].size() != rhsGroups[i].size()) {
            throw std::runtime_error("Generation rule LHS/RHS row cells must have the same length");
        }
        PatternGroup group;
        for (size_t cellIndex = 0; cellIndex < lhsGroups[i].size(); ++cellIndex) {
            group.cells.push_back(compileSlot(lhsGroups[i][cellIndex], rhsGroups[i][cellIndex], game, resolver));
        }
        if (group.cells.size() > 1) {
            hasDirectionalRows = true;
        }
        alternative.groups.push_back(std::move(group));
    }
    if (sawDirection) {
        alternative.directions = std::move(explicitDirections);
    } else if (hasDirectionalRows) {
        alternative.directions = {Direction::Up, Direction::Down, Direction::Left, Direction::Right};
    } else {
        alternative.directions = {Direction::Right};
    }
    return alternative;
}

ProbRule compileProbRule(const std::vector<std::string>& tokens, const Game& game, NameResolver& resolver) {
    if (tokens.size() < 4) {
        throw std::runtime_error("Malformed prob rule");
    }
    ProbRule rule;
    rule.probability = std::stod(tokens[1]);
    if (rule.probability < 0.0 || rule.probability > 1.0) {
        throw std::runtime_error("prob probability must be between 0 and 1");
    }
    size_t cursor = 2;
    const size_t arrowIndex = puzzlescript::compiler::ruletext::findTopLevelArrow(tokens, cursor, tokens.size());
    if (arrowIndex == tokens.size()) {
        throw std::runtime_error("prob rule is missing ->");
    }
    const auto lhsGroups = parseBracketGroups(tokens, cursor, arrowIndex);
    const auto rhsGroups = parseBracketGroups(tokens, arrowIndex + 1, tokens.size());
    if (lhsGroups.size() != 1 || lhsGroups[0].size() != 1) {
        throw std::runtime_error("prob rule must have a single-cell LHS");
    }
    if (rhsGroups.size() != 1 || rhsGroups[0].size() != 1) {
        throw std::runtime_error("prob rule must have a single-cell RHS");
    }
    rule.slot = compileSlot(lhsGroups[0][0], rhsGroups[0][0], game, resolver);
    return rule;
}

void parseChooseCount(const std::string& token, int32_t& minCount, int32_t& maxCount) {
    const size_t dash = token.find('-');
    if (dash == std::string::npos) {
        minCount = maxCount = std::stoi(token);
    } else {
        minCount = std::stoi(token.substr(0, dash));
        maxCount = std::stoi(token.substr(dash + 1));
    }
    if (minCount < 0 || maxCount < minCount) {
        throw std::runtime_error("choose count range must satisfy 0 <= N <= M");
    }
}

const MaskWord* cellPtr(const LevelTemplate& level, const Game& game, int32_t tileIndex) {
    return level.objects.data() + static_cast<size_t>(tileIndex * game.strideObject);
}

MaskWord* cellPtr(LevelTemplate& level, const Game& game, int32_t tileIndex) {
    return level.objects.data() + static_cast<size_t>(tileIndex * game.strideObject);
}

bool matchesSlot(const Slot& slot, const LevelTemplate& level, const Game& game, int32_t tileIndex) {
    const MaskWord* cell = cellPtr(level, game, tileIndex);
    for (const auto& term : slot.terms) {
        if (term.missing) {
            if (anyBits(term.mask.data(), game.wordCount, cell, game.wordCount)) {
                return false;
            }
        } else if (term.any) {
            if (!anyBits(term.mask.data(), game.wordCount, cell, game.wordCount)) {
                return false;
            }
        } else {
            if (!bitsSet(term.mask.data(), game.wordCount, cell, game.wordCount)) {
                return false;
            }
        }
    }
    return true;
}

void applySlot(const Slot& slot, LevelTemplate& level, const Game& game, int32_t tileIndex) {
    MaskWord* cell = cellPtr(level, game, tileIndex);
    for (const auto& replacement : slot.replacements) {
        for (uint32_t w = 0; w < game.wordCount; ++w) {
            cell[w] = (cell[w] & ~replacement.clearMask[w]) | replacement.setMask[w];
        }
    }
}

std::optional<int32_t> directedTile(const LevelTemplate& level, int32_t anchorTile, Direction direction, size_t distance) {
    const int32_t x = anchorTile / level.height;
    const int32_t y = anchorTile % level.height;
    int32_t nx = x;
    int32_t ny = y;
    const int32_t step = static_cast<int32_t>(distance);
    switch (direction) {
        case Direction::Up: ny -= step; break;
        case Direction::Down: ny += step; break;
        case Direction::Left: nx -= step; break;
        case Direction::Right: nx += step; break;
    }
    if (nx < 0 || nx >= level.width || ny < 0 || ny >= level.height) {
        return std::nullopt;
    }
    return nx * level.height + ny;
}

bool matchesGroup(
    const PatternGroup& group,
    const LevelTemplate& level,
    const Game& game,
    int32_t anchorTile,
    Direction direction,
    const std::vector<int32_t>& reservedTiles
) {
    for (size_t cellIndex = 0; cellIndex < group.cells.size(); ++cellIndex) {
        const auto tile = directedTile(level, anchorTile, direction, cellIndex);
        if (!tile) {
            return false;
        }
        if (std::find(reservedTiles.begin(), reservedTiles.end(), *tile) != reservedTiles.end()) {
            return false;
        }
        if (!matchesSlot(group.cells[cellIndex], level, game, *tile)) {
            return false;
        }
    }
    return true;
}

void applyGroup(const PatternGroup& group, LevelTemplate& level, const Game& game, int32_t anchorTile, Direction direction) {
    for (size_t cellIndex = 0; cellIndex < group.cells.size(); ++cellIndex) {
        const auto tile = directedTile(level, anchorTile, direction, cellIndex);
        if (tile) {
            applySlot(group.cells[cellIndex], level, game, *tile);
        }
    }
}

bool chooseGroupsForDirection(
    const Alternative& alternative,
    const LevelTemplate& level,
    const Game& game,
    Direction direction,
    Rng& rng,
    std::vector<int32_t>& candidates,
    std::vector<int32_t>& chosenAnchors,
    std::vector<int32_t>& reservedTiles
) {
    const int32_t tileCount = level.width * level.height;
    chosenAnchors.clear();
    reservedTiles.clear();
    for (const auto& group : alternative.groups) {
        candidates.clear();
        for (int32_t tile = 0; tile < tileCount; ++tile) {
            if (matchesGroup(group, level, game, tile, direction, reservedTiles)) {
                candidates.push_back(tile);
            }
        }
        if (candidates.empty()) {
            return false;
        }
        const int32_t anchor = candidates[rng.index(candidates.size())];
        chosenAnchors.push_back(anchor);
        for (size_t cellIndex = 0; cellIndex < group.cells.size(); ++cellIndex) {
            const auto tile = directedTile(level, anchor, direction, cellIndex);
            if (tile) {
                reservedTiles.push_back(*tile);
            }
        }
    }
    return true;
}

void applyProbRule(const ProbRule& rule, LevelTemplate& level, const Game& game, Rng& rng) {
    const int32_t tileCount = level.width * level.height;
    for (int32_t tile = 0; tile < tileCount; ++tile) {
        if (matchesSlot(rule.slot, level, game, tile) && rng.unit() < rule.probability) {
            applySlot(rule.slot, level, game, tile);
        }
    }
}

bool applyChooseRule(
    const ChooseRule& rule,
    LevelTemplate& level,
    const Game& game,
    Rng& rng,
    std::vector<int32_t>& candidates,
    std::vector<int32_t>& chosenAnchors,
    std::vector<int32_t>& reservedTiles
) {
    const int32_t iterations = rng.intInRange(rule.minCount, rule.maxCount);
    for (int32_t iteration = 0; iteration < iterations; ++iteration) {
        if (rule.alternatives.empty()) {
            return false;
        }
        const Alternative& alternative = rule.alternatives[rng.index(rule.alternatives.size())];
        if (alternative.optionProbability < 1.0 && rng.unit() >= alternative.optionProbability) {
            continue;
        }
        const auto& directions = alternative.directions;
        const size_t directionCount = directions.empty() ? 0 : directions.size();
        const size_t directionStart = directionCount == 0 ? 0 : rng.index(directionCount);
        bool matched = false;
        Direction direction = Direction::Right;
        for (size_t attempt = 0; attempt < std::max<size_t>(1, directionCount); ++attempt) {
            direction = directionCount == 0
                ? Direction::Right
                : directions[(directionStart + attempt) % directionCount];
            if (chooseGroupsForDirection(alternative, level, game, direction, rng, candidates, chosenAnchors, reservedTiles)) {
                matched = true;
                break;
            }
        }
        if (!matched) {
            return false;
        }
        for (size_t groupIndex = 0; groupIndex < alternative.groups.size(); ++groupIndex) {
            applyGroup(alternative.groups[groupIndex], level, game, chosenAnchors[groupIndex], direction);
        }
    }
    return true;
}

} // namespace

uint64_t splitmix64(uint64_t x) {
    x += 0x9e3779b97f4a7c15ULL;
    x = (x ^ (x >> 30)) * 0xbf58476d1ce4e5b9ULL;
    x = (x ^ (x >> 27)) * 0x94d049bb133111ebULL;
    return x ^ (x >> 31);
}

Rng::Rng(uint64_t seed) : state(seed == 0 ? 1 : seed) {}

uint64_t Rng::next() {
    state = splitmix64(state);
    return state;
}

size_t Rng::index(size_t n) {
    return n == 0 ? 0 : static_cast<size_t>(next() % n);
}

double Rng::unit() {
    return static_cast<double>(next() >> 11) * (1.0 / 9007199254740992.0);
}

int32_t Rng::intInRange(int32_t min, int32_t max) {
    if (min >= max) {
        return min;
    }
    const uint64_t span = static_cast<uint64_t>(max - min + 1);
    return min + static_cast<int32_t>(next() % span);
}

NameResolver::NameResolver(const Game& game, const puzzlescript::compiler::ParserState& state)
    : game_(game) {
    for (int32_t id = 0; id < static_cast<int32_t>(game.idDict.size()); ++id) {
        objectIdByName_[game.idDict[static_cast<size_t>(id)]] = id;
    }
    for (const auto& entry : state.legendSynonyms) {
        if (!entry.items.empty()) {
            synonymOf_[lowercase(entry.name)] = lowercase(entry.items.front());
        }
    }
    for (const auto& entry : state.legendAggregates) {
        std::vector<std::string> items;
        for (const auto& item : entry.items) {
            items.push_back(lowercase(item));
        }
        aggregateOf_[lowercase(entry.name)] = std::move(items);
    }
    for (const auto& entry : state.legendProperties) {
        std::vector<std::string> items;
        for (const auto& item : entry.items) {
            items.push_back(lowercase(item));
        }
        propertyOf_[lowercase(entry.name)] = std::move(items);
    }
    normalizeAliases();
}

void NameResolver::normalizeAliases() {
    bool modified = true;
    while (modified) {
        modified = false;
        for (auto& [_, value] : synonymOf_) {
            if (auto it = synonymOf_.find(value); it != synonymOf_.end()) {
                value = it->second;
                modified = true;
            }
        }
        std::vector<std::string> propertyKeys;
        for (const auto& [name, _] : propertyOf_) {
            propertyKeys.push_back(name);
        }
        for (const auto& name : propertyKeys) {
            auto& values = propertyOf_[name];
            for (size_t i = 0; i < values.size(); ++i) {
                if (auto syn = synonymOf_.find(values[i]); syn != synonymOf_.end()) {
                    values[i] = syn->second;
                    modified = true;
                } else if (auto prop = propertyOf_.find(values[i]); prop != propertyOf_.end()) {
                    values.erase(values.begin() + static_cast<std::ptrdiff_t>(i));
                    for (const auto& item : prop->second) {
                        if (std::find(values.begin(), values.end(), item) == values.end()) {
                            values.push_back(item);
                        }
                    }
                    modified = true;
                    --i;
                }
            }
        }
        std::vector<std::string> aggregateKeys;
        for (const auto& [name, _] : aggregateOf_) {
            aggregateKeys.push_back(name);
        }
        for (const auto& name : aggregateKeys) {
            auto& values = aggregateOf_[name];
            for (size_t i = 0; i < values.size(); ++i) {
                if (auto syn = synonymOf_.find(values[i]); syn != synonymOf_.end()) {
                    values[i] = syn->second;
                    modified = true;
                } else if (auto agg = aggregateOf_.find(values[i]); agg != aggregateOf_.end()) {
                    values.erase(values.begin() + static_cast<std::ptrdiff_t>(i));
                    for (const auto& item : agg->second) {
                        if (std::find(values.begin(), values.end(), item) == values.end()) {
                            values.push_back(item);
                        }
                    }
                    modified = true;
                    --i;
                }
            }
        }
    }
}

MaskVector NameResolver::resolve(const std::string& rawName) {
    const std::string name = lowercase(rawName);
    std::set<std::string> visiting;
    return resolveInner(name, visiting);
}

bool NameResolver::isProperty(const std::string& rawName) const {
    return propertyOf_.find(lowercase(rawName)) != propertyOf_.end();
}

MaskVector NameResolver::resolveInner(const std::string& name, std::set<std::string>& visiting) {
    if (auto cached = resolved_.find(name); cached != resolved_.end()) {
        return cached->second;
    }
    if (!visiting.insert(name).second) {
        throw std::runtime_error("Legend cycle detected at '" + name + "'");
    }

    MaskVector mask = emptyMask(game_);
    if (auto object = objectIdByName_.find(name); object != objectIdByName_.end()) {
        setMaskBit(mask, object->second);
    } else if (auto synonym = synonymOf_.find(name); synonym != synonymOf_.end()) {
        mask = resolveInner(synonym->second, visiting);
    } else if (auto aggregate = aggregateOf_.find(name); aggregate != aggregateOf_.end()) {
        for (const auto& item : aggregate->second) {
            orMask(mask, resolveInner(item, visiting));
        }
    } else if (auto property = propertyOf_.find(name); property != propertyOf_.end()) {
        for (const auto& item : property->second) {
            orMask(mask, resolveInner(item, visiting));
        }
    } else {
        throw std::runtime_error("Unknown generation rule name: " + rawDisplay(name));
    }

    visiting.erase(name);
    resolved_.emplace(name, mask);
    return mask;
}

std::string NameResolver::rawDisplay(const std::string& name) {
    return name;
}

GenerationProgram compileGenerationProgram(
    const std::vector<std::string>& ruleLines,
    const Game& game,
    NameResolver& resolver
) {
    GenerationProgram program;
    for (const auto& line : ruleLines) {
        auto tokens = puzzlescript::compiler::ruletext::tokenizeRuleLine(lowercase(line));
        if (tokens.empty()) {
            continue;
        }
        if (tokens[0] == "choose") {
            if (tokens.size() < 4) {
                throw std::runtime_error("Malformed choose rule");
            }
            ChooseRule rule;
            parseChooseCount(tokens[1], rule.minCount, rule.maxCount);
            for (const auto& altTokens : splitAlternatives(tokens, 2)) {
                rule.alternatives.push_back(compileAlternative(altTokens, game, resolver));
            }
            program.rules.push_back(std::move(rule));
        } else if (tokens[0] == "prob") {
            program.rules.push_back(compileProbRule(tokens, game, resolver));
        } else if (tokens[0] == "or") {
            if (program.rules.empty()) {
                throw std::runtime_error("or generation rule must follow a choose rule");
            }
            auto* choose = std::get_if<ChooseRule>(&program.rules.back());
            if (choose == nullptr) {
                throw std::runtime_error("or generation rule must follow a choose rule");
            }
            for (const auto& altTokens : splitAlternatives(tokens, 1)) {
                choose->alternatives.push_back(compileAlternative(altTokens, game, resolver));
            }
        } else if (tokens[0] == "option") {
            ChooseRule rule;
            rule.minCount = 1;
            rule.maxCount = 1;
            for (const auto& altTokens : splitAlternatives(tokens, 0)) {
                rule.alternatives.push_back(compileAlternative(altTokens, game, resolver));
            }
            program.rules.push_back(std::move(rule));
        } else {
            throw std::runtime_error("Generation rules must start with choose, prob, or, or option");
        }
    }
    return program;
}

GenerationProgram compileGenerationProgram(
    const LegacySpec& spec,
    const Game& game,
    NameResolver& resolver
) {
    return compileGenerationProgram(spec.ruleLines, game, resolver);
}

bool applyProgram(
    const GenerationProgram& program,
    const LevelTemplate& init,
    const Game& game,
    Rng& rng,
    LevelTemplate& out
) {
    out = init;
    std::vector<int32_t> candidates;
    std::vector<int32_t> chosenAnchors;
    std::vector<int32_t> reservedTiles;
    for (const auto& ruleVariant : program.rules) {
        if (const auto* prob = std::get_if<ProbRule>(&ruleVariant)) {
            applyProbRule(*prob, out, game, rng);
            continue;
        }
        const auto& rule = std::get<ChooseRule>(ruleVariant);
        if (!applyChooseRule(rule, out, game, rng, candidates, chosenAnchors, reservedTiles)) {
            return false;
        }
    }
    return true;
}

uint64_t hashLevel(const LevelTemplate& level) {
    uint64_t hash = 1469598103934665603ull;
    auto append = [&](uint64_t value) {
        hash ^= value;
        hash *= 1099511628211ull;
    };
    append(static_cast<uint64_t>(static_cast<uint32_t>(level.width)));
    append(static_cast<uint64_t>(static_cast<uint32_t>(level.height)));
    for (const MaskWord word : level.objects) {
        append(static_cast<uint64_t>(static_cast<MaskWordUnsigned>(word)));
    }
    return hash;
}

} // namespace puzzlescript::generator
