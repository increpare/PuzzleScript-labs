#include "generator/spec_parser.hpp"

#include <algorithm>
#include <cctype>
#include <regex>
#include <sstream>
#include <stdexcept>
#include <string_view>

namespace puzzlescript::generator {
namespace {

std::string trim(std::string_view value) {
    size_t begin = 0;
    while (begin < value.size() && std::isspace(static_cast<unsigned char>(value[begin]))) {
        ++begin;
    }
    size_t end = value.size();
    while (end > begin && std::isspace(static_cast<unsigned char>(value[end - 1]))) {
        --end;
    }
    return std::string(value.substr(begin, end - begin));
}

std::string lowercase(std::string value) {
    std::transform(value.begin(), value.end(), value.begin(), [](unsigned char ch) {
        return static_cast<char>(std::tolower(ch));
    });
    return value;
}

std::string stripComment(std::string_view line) {
    std::string text = trim(line);
    const size_t hash = text.find('#');
    if (hash != std::string::npos) {
        text = trim(text.substr(0, hash));
    }
    const size_t paren = text.find('(');
    if (paren != std::string::npos) {
        text = trim(text.substr(0, paren));
    }
    return text;
}

std::vector<std::string> splitLines(const std::string& source) {
    std::vector<std::string> lines;
    std::istringstream stream(source);
    std::string line;
    while (std::getline(stream, line)) {
        if (!line.empty() && line.back() == '\r') {
            line.pop_back();
        }
        lines.push_back(line);
    }
    return lines;
}

bool isBlockSeparator(const std::string& line) {
    const std::string text = trim(line);
    return text.size() >= 3 && std::all_of(text.begin(), text.end(), [](char c) { return c == '='; });
}

void setMaskBit(MaskVector& words, int32_t bitIndex) {
    if (bitIndex < 0) {
        return;
    }
    const uint32_t word = maskWordIndex(static_cast<uint32_t>(bitIndex));
    if (word >= words.size()) {
        return;
    }
    words[word] |= maskBit(static_cast<uint32_t>(bitIndex));
}

std::vector<std::vector<std::string>> splitIntoBlocks(const std::string& text) {
    std::vector<std::vector<std::string>> blocks;
    std::vector<std::string> current;
    for (const auto& rawLine : splitLines(text)) {
        if (isBlockSeparator(rawLine)) {
            if (!current.empty()) {
                blocks.push_back(std::move(current));
                current.clear();
            }
            continue;
        }
        current.push_back(rawLine);
    }
    if (!current.empty()) {
        blocks.push_back(std::move(current));
    }
    return blocks;
}

BlockHeader parseHeaderLine(const std::string& line, BlockHeader header) {
    const size_t colon = line.find(':');
    if (colon == std::string::npos) {
        throw std::runtime_error("Invalid header line (expected key: value): " + line);
    }
    const std::string key = lowercase(trim(line.substr(0, colon)));
    const std::string value = trim(line.substr(colon + 1));
    if (key == "dimensions") {
        static const std::regex pattern(R"(^(\d+)x(\d+)$)");
        std::smatch match;
        if (!std::regex_match(value, match, pattern)) {
            throw std::runtime_error("Invalid dimensions value: " + value);
        }
        header.width = std::stoi(match[1].str());
        header.height = std::stoi(match[2].str());
        if (header.width <= 0 || header.height <= 0) {
            throw std::runtime_error("Dimensions must be positive: " + value);
        }
    } else if (key == "take") {
        const size_t take = static_cast<size_t>(std::stoull(value));
        if (take == 0) {
            throw std::runtime_error("take must be at least 1");
        }
        header.take = take;
    } else if (key == "name") {
        header.name = value;
    } else if (key == "seed") {
        header.seed = static_cast<uint64_t>(std::stoull(value));
    } else {
        throw std::runtime_error("Unknown header key: " + key);
    }
    return header;
}

} // namespace

LevelTemplate synthesizeBackgroundGrid(const Game& game, int32_t width, int32_t height) {
    if (width <= 0 || height <= 0) {
        throw std::runtime_error("Cannot synthesize grid with non-positive dimensions");
    }
    if (game.backgroundId < 0) {
        throw std::runtime_error("Game has no background object for synthesized grid");
    }

    LevelTemplate level;
    level.width = width;
    level.height = height;
    const int32_t tileCount = width * height;
    level.objects.assign(static_cast<size_t>(tileCount * game.strideObject), 0);
    for (int32_t tile = 0; tile < tileCount; ++tile) {
        const size_t tileBase = static_cast<size_t>(tile * game.strideObject);
        const uint32_t word = maskWordIndex(static_cast<uint32_t>(game.backgroundId));
        if (word < game.wordCount) {
            level.objects[tileBase + word] |= maskBit(static_cast<uint32_t>(game.backgroundId));
        }
    }
    return level;
}

LegacySpec parseLegacySpec(const std::string& text) {
    enum class Section { None, Init, Rules };
    Section section = Section::None;
    LegacySpec spec;
    for (const auto& rawLine : splitLines(text)) {
        const std::string line = trim(rawLine);
        const std::string lowered = lowercase(line);
        if (lowered == "[ init level ]" || lowered == "[ generation rules ]") {
            throw std::runtime_error("Generation spec sections must use (INIT LEVEL) and (GENERATION RULES), not square brackets");
        }
        if (lowered == "(init level)") {
            section = Section::Init;
            continue;
        }
        if (lowered == "(generation rules)") {
            section = Section::Rules;
            continue;
        }
        if (line.empty()) {
            continue;
        }
        if (section == Section::Init) {
            spec.initRows.push_back(line);
        } else if (section == Section::Rules) {
            spec.ruleLines.push_back(line);
        } else {
            throw std::runtime_error("Generation spec content found before (INIT LEVEL)");
        }
    }
    if (spec.initRows.empty()) {
        throw std::runtime_error("Generation spec is missing init level rows");
    }
    if (spec.ruleLines.empty()) {
        throw std::runtime_error("Generation spec is missing generation rules");
    }
    return spec;
}

std::vector<BlockSpec> parseLevelSetSpec(const std::string& text, const Game& game) {
    auto rawBlocks = splitIntoBlocks(text);
    if (rawBlocks.empty()) {
        throw std::runtime_error("Level-set spec is empty");
    }

    std::vector<BlockSpec> blocks;
    blocks.reserve(rawBlocks.size());
    for (const auto& rawBlock : rawBlocks) {
        bool hasContent = false;
        for (const auto& rawLine : rawBlock) {
            if (!stripComment(rawLine).empty()) {
                hasContent = true;
                break;
            }
        }
        if (!hasContent) {
            continue;
        }

        BlockSpec block;
        bool inRules = false;
        bool sawDimensions = false;
        for (const auto& rawLine : rawBlock) {
            const std::string line = stripComment(rawLine);
            if (line.empty()) {
                if (sawDimensions) {
                    inRules = true;
                }
                continue;
            }
            if (!inRules) {
                block.header = parseHeaderLine(line, block.header);
                if (block.header.width > 0 && block.header.height > 0) {
                    sawDimensions = true;
                }
            } else {
                block.ruleLines.push_back(line);
            }
        }
        if (block.header.width <= 0 || block.header.height <= 0) {
            throw std::runtime_error("Block is missing required dimensions header");
        }
        if (block.ruleLines.empty()) {
            throw std::runtime_error("Block is missing generation rules");
        }
        block.initLevel = synthesizeBackgroundGrid(game, block.header.width, block.header.height);
        blocks.push_back(std::move(block));
    }
    return blocks;
}

} // namespace puzzlescript::generator
