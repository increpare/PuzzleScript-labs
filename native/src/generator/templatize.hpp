#pragma once

#include "generator/spec_parser.hpp"
#include "runtime/core.hpp"

#include <cstdint>
#include <optional>
#include <string>
#include <vector>

namespace puzzlescript::generator {

struct TemplatizeOptions {
    size_t take = 1;
    std::optional<int32_t> levelIndex;
    std::string namePrefix = "level";
    std::optional<uint64_t> globalSeed;
};

struct TemplatizedBlock {
    int32_t width = 0;
    int32_t height = 0;
    size_t take = 1;
    std::string name;
    std::optional<uint64_t> seed;
    std::vector<std::string> ruleLines;
};

std::vector<TemplatizedBlock> templatizeGame(const Game& game, const TemplatizeOptions& options);

BlockSpec toBlockSpec(const Game& game, const TemplatizedBlock& block);

std::string serializeTemplatizedSpec(const std::vector<TemplatizedBlock>& blocks);

} // namespace puzzlescript::generator
