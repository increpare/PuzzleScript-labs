#include "generator/templatize.hpp"

#include "generator/generation_rules.hpp"
#include "generator/spec_parser.hpp"

#include <algorithm>
#include <cctype>
#include <map>
#include <sstream>
#include <stdexcept>
#include <vector>

namespace puzzlescript::generator {
namespace {

using TileStamp = std::vector<int32_t>;

std::string lowercase(std::string value) {
    for (char& ch : value) {
        ch = static_cast<char>(std::tolower(static_cast<unsigned char>(ch)));
    }
    return value;
}

std::string objectRuleName(const Game& game, int32_t objectId) {
    if (objectId < 0 || static_cast<size_t>(objectId) >= game.idDict.size()) {
        throw std::runtime_error("Invalid object id while templatizing");
    }
    return lowercase(game.idDict[static_cast<size_t>(objectId)]);
}

std::vector<int32_t> objectsAtTile(const Game& game, const LevelTemplate& level, int32_t tileIndex) {
    std::vector<int32_t> ids;
    const size_t base = static_cast<size_t>(tileIndex * game.strideObject);
    if (base + static_cast<size_t>(game.wordCount) > level.objects.size()) {
        return ids;
    }
    for (int32_t objectId = 0; objectId < game.objectCount; ++objectId) {
        const uint32_t word = maskWordIndex(static_cast<uint32_t>(objectId));
        if (word >= game.wordCount) {
            continue;
        }
        if ((level.objects[base + word] & maskBit(static_cast<uint32_t>(objectId))) != 0) {
            ids.push_back(objectId);
        }
    }
    return ids;
}

TileStamp tileStampAt(const Game& game, const LevelTemplate& level, int32_t tileIndex) {
    TileStamp stamp;
    for (int32_t objectId : objectsAtTile(game, level, tileIndex)) {
        if (objectId == game.backgroundId) {
            continue;
        }
        stamp.push_back(objectId);
    }
    std::sort(stamp.begin(), stamp.end());
    return stamp;
}

std::vector<std::string> backgroundOnlyLhs(const Game& game) {
    std::vector<std::pair<std::string, int32_t>> exclusions;
    for (int32_t objectId = 0; objectId < game.objectCount; ++objectId) {
        if (objectId == game.backgroundId) {
            continue;
        }
        exclusions.emplace_back(objectRuleName(game, objectId), objectId);
    }
    std::sort(exclusions.begin(), exclusions.end());
    std::vector<std::string> lhs;
    lhs.reserve(exclusions.size() * 2);
    for (const auto& [name, _] : exclusions) {
        lhs.push_back("no");
        lhs.push_back(name);
    }
    return lhs;
}

std::vector<std::string> stampRuleNames(const Game& game, const TileStamp& stamp) {
    std::vector<std::string> names;
    names.reserve(stamp.size());
    for (int32_t objectId : stamp) {
        names.push_back(objectRuleName(game, objectId));
    }
    return names;
}

std::string bracketCell(const std::vector<std::string>& tokens) {
    std::ostringstream out;
    out << "[ ";
    for (size_t index = 0; index < tokens.size(); ++index) {
        if (index != 0) {
            out << ' ';
        }
        out << tokens[index];
    }
    out << " ]";
    return out.str();
}

std::string formatStampChooseRule(
    int32_t count,
    const std::vector<std::string>& emptyLhs,
    const std::vector<std::string>& stampObjects) {
    std::ostringstream out;
    out << "choose " << count << ' ' << bracketCell(emptyLhs) << " -> [ ";
    for (size_t index = 0; index < stampObjects.size(); ++index) {
        if (index != 0) {
            out << ' ';
        }
        out << stampObjects[index];
    }
    out << " ]";
    return out.str();
}

std::map<TileStamp, int32_t> collectStampCounts(const Game& game, const LevelTemplate& level) {
    std::map<TileStamp, int32_t> stampCounts;
    const int32_t tileCount = level.width * level.height;
    for (int32_t tile = 0; tile < tileCount; ++tile) {
        const TileStamp stamp = tileStampAt(game, level, tile);
        if (stamp.empty()) {
            continue;
        }
        ++stampCounts[stamp];
    }
    return stampCounts;
}

std::vector<std::string> buildRules(const Game& game, const LevelTemplate& level) {
    const std::map<TileStamp, int32_t> stampCounts = collectStampCounts(game, level);
    const std::vector<std::string> emptyLhs = backgroundOnlyLhs(game);

    std::vector<std::pair<TileStamp, int32_t>> ordered(stampCounts.begin(), stampCounts.end());
    std::sort(ordered.begin(), ordered.end(), [&](const auto& lhs, const auto& rhs) {
        if (lhs.first.size() != rhs.first.size()) {
            return lhs.first.size() > rhs.first.size();
        }
        if (lhs.second != rhs.second) {
            return lhs.second > rhs.second;
        }
        return lhs.first < rhs.first;
    });

    std::vector<std::string> rules;
    rules.reserve(ordered.size());
    for (const auto& [stamp, count] : ordered) {
        rules.push_back(formatStampChooseRule(count, emptyLhs, stampRuleNames(game, stamp)));
    }
    return rules;
}

TemplatizedBlock templatizeLevel(
    const Game& game,
    const LevelTemplate& level,
    size_t levelNumber,
    size_t take,
    const std::string& namePrefix) {
    if (level.isMessage) {
        throw std::runtime_error("Cannot templatize message levels");
    }
    if (level.width <= 0 || level.height <= 0) {
        throw std::runtime_error("Cannot templatize empty level");
    }

    TemplatizedBlock block;
    block.width = level.width;
    block.height = level.height;
    block.take = take;
    block.name = namePrefix + " " + std::to_string(levelNumber);
    block.ruleLines = buildRules(game, level);
    if (block.ruleLines.empty()) {
        throw std::runtime_error("Level has no non-background objects to templatize");
    }
    return block;
}

} // namespace

std::vector<TemplatizedBlock> templatizeGame(const Game& game, const TemplatizeOptions& options) {
    std::vector<TemplatizedBlock> blocks;
    size_t playableIndex = 0;
    for (size_t levelIndex = 0; levelIndex < game.levels.size(); ++levelIndex) {
        const LevelTemplate& level = game.levels[levelIndex];
        if (level.isMessage) {
            continue;
        }
        ++playableIndex;
        if (options.levelIndex.has_value() && static_cast<size_t>(*options.levelIndex) != levelIndex) {
            continue;
        }
        TemplatizedBlock block = templatizeLevel(game, level, playableIndex, options.take, options.namePrefix);
        if (options.globalSeed.has_value()) {
            block.seed = splitmix64(*options.globalSeed ^ (static_cast<uint64_t>(levelIndex) + 0x9e3779b97f4a7c15ULL));
        }
        blocks.push_back(std::move(block));
    }
    if (blocks.empty()) {
        throw std::runtime_error("No playable levels found to templatize");
    }
    return blocks;
}

std::string serializeTemplatizedSpec(const std::vector<TemplatizedBlock>& blocks) {
    std::ostringstream out;
    for (size_t index = 0; index < blocks.size(); ++index) {
        if (index != 0) {
            out << "===\n";
        }
        const TemplatizedBlock& block = blocks[index];
        out << "dimensions: " << block.width << 'x' << block.height << '\n';
        out << "take: " << block.take << '\n';
        if (!block.name.empty()) {
            out << "name: " << block.name << '\n';
        }
        if (block.seed.has_value()) {
            out << "seed: " << *block.seed << '\n';
        }
        out << '\n';
        for (const std::string& rule : block.ruleLines) {
            out << rule << '\n';
        }
        out << "===\n";
    }
    return out.str();
}

BlockSpec toBlockSpec(const Game& game, const TemplatizedBlock& block) {
    BlockSpec spec;
    spec.header.width = block.width;
    spec.header.height = block.height;
    spec.header.take = block.take;
    spec.header.name = block.name;
    spec.header.seed = block.seed;
    spec.ruleLines = block.ruleLines;
    spec.initLevel = synthesizeBackgroundGrid(game, block.width, block.height);
    return spec;
}

} // namespace puzzlescript::generator
