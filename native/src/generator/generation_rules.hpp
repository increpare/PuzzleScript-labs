#pragma once

#include "compiler/parser.hpp"
#include "generator/spec_parser.hpp"
#include "runtime/core.hpp"
#include "search/search_common.hpp"

#include <cstdint>
#include <map>
#include <set>
#include <string>
#include <variant>
#include <vector>

namespace puzzlescript::generator {

struct PatternTerm {
    MaskVector mask;
    bool missing = false;
    bool any = false;
};

struct ReplacementTerm {
    MaskVector clearMask;
    MaskVector setMask;
};

struct Slot {
    std::vector<PatternTerm> terms;
    std::vector<ReplacementTerm> replacements;
};

enum class Direction {
    Up,
    Down,
    Left,
    Right,
};

struct PatternGroup {
    std::vector<Slot> cells;
};

struct Alternative {
    std::vector<PatternGroup> groups;
    std::vector<Direction> directions;
    double optionProbability = 1.0;
};

struct ChooseRule {
    int32_t minCount = 0;
    int32_t maxCount = 0;
    std::vector<Alternative> alternatives;
};

struct ProbRule {
    double probability = 0.0;
    Slot slot;
};

using GenerationRule = std::variant<ProbRule, ChooseRule>;

struct GenerationProgram {
    std::vector<GenerationRule> rules;
};

uint64_t splitmix64(uint64_t x);

struct Rng {
    uint64_t state = 1;

    explicit Rng(uint64_t seed);

    uint64_t next();
    size_t index(size_t n);
    double unit();
    int32_t intInRange(int32_t min, int32_t max);
};

class NameResolver {
public:
    NameResolver(const Game& game, const puzzlescript::compiler::ParserState& state);

    MaskVector resolve(const std::string& rawName);
    bool isProperty(const std::string& rawName) const;

private:
    const Game& game_;
    std::map<std::string, int32_t> objectIdByName_;
    std::map<std::string, std::string> synonymOf_;
    std::map<std::string, std::vector<std::string>> aggregateOf_;
    std::map<std::string, std::vector<std::string>> propertyOf_;
    std::map<std::string, MaskVector> resolved_;

    void normalizeAliases();
    MaskVector resolveInner(const std::string& name, std::set<std::string>& visiting);
    static std::string rawDisplay(const std::string& name);
};

GenerationProgram compileGenerationProgram(
    const std::vector<std::string>& ruleLines,
    const Game& game,
    NameResolver& resolver
);

GenerationProgram compileGenerationProgram(
    const LegacySpec& spec,
    const Game& game,
    NameResolver& resolver
);

bool applyProgram(
    const GenerationProgram& program,
    const LevelTemplate& init,
    const Game& game,
    Rng& rng,
    LevelTemplate& out
);

uint64_t hashLevel(const LevelTemplate& level);

} // namespace puzzlescript::generator
