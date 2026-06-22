#pragma once

#include <cstdint>
#include <map>
#include <string>
#include <vector>

namespace puzzlescript::compiler {

struct SemanticObject {
    int32_t id = -1;
    std::string name;
    int32_t layer = -1;
};

struct SemanticLegend {
    std::string name;
    std::vector<int32_t> objectIds;  // base object ids, sorted ascending
};

struct SemanticLevel {
    bool isMessage = false;
    std::string message;
    int32_t width = 0;
    int32_t height = 0;
    // Row-major (y outer, x inner) cells; each cell is the sorted set of object
    // ids present (background included). Empty for message screens.
    std::vector<std::vector<int32_t>> cells;
};

struct SemanticWinCondition {
    int32_t quantifier = 0;            // -1 = no, 0 = some, 1 = all
    std::vector<int32_t> objectIds1;   // sorted ascending
    bool aggregate1 = false;
    std::vector<int32_t> objectIds2;   // sorted; all objects when there is no "on Y" clause
    bool aggregate2 = false;
};

struct SemanticSounds {
    std::map<std::string, int32_t> events;  // sound-event name -> seed
};

struct SemanticTerm {
    std::string dir;   // movement/direction modifier: "" | ">" | "<" | "^" | "v" | "moving" | "stationary" | "no" | "randomdir" | "action" | "up"/"down"/"left"/"right" | "horizontal"/"vertical" | "orthogonal" | "perpendicular" | "parallel"
    std::string name;  // object/legend name, lowercased
};

struct SemanticCell {
    bool ellipsis = false;            // "..." cell; terms is empty when true
    std::vector<SemanticTerm> terms;
};

using SemanticRow = std::vector<SemanticCell>;  // one bracket [ ... ]

struct SemanticRuleCommand {
    std::string name;
    std::string argument;  // "" when the command has no argument
};

struct SemanticRule {
    int32_t lineNumber = 0;
    std::vector<std::string> directions;  // as-written direction-prefix tokens (0+), e.g. {"horizontal"} or {"up"}
    bool rigid = false;
    bool random = false;
    bool late = false;
    int32_t groupNumber = 0;
    std::vector<SemanticRow> lhs;
    std::vector<SemanticRow> rhs;
    std::vector<SemanticRuleCommand> commands;
};

// Current SemanticProgram contract: resolved object identity, collision layers,
// resolved legends, resolved levels, resolved win conditions, resolved metadata,
// and resolved global sound events. Object/movement sfx and rules remain
// deferred to later slices. Serialized form is versioned via schemaVersion.
struct SemanticProgram {
    int32_t schemaVersion = 1;
    std::vector<SemanticObject> objects;
    std::vector<std::vector<int32_t>> collisionLayers;
    std::vector<SemanticLegend> synonyms;    // sorted by name
    std::vector<SemanticLegend> aggregates;  // sorted by name
    std::vector<SemanticLegend> properties;  // sorted by name
    std::vector<SemanticLevel> levels;
    std::vector<SemanticWinCondition> winConditions;  // source-declaration order
    std::map<std::string, std::string> metadata;  // raw key->value, excludes flickscreen/zoomscreen
    SemanticSounds sounds;
    std::vector<SemanticRule> rules;  // authored, pre-expansion; source-declaration order (early then late)
};

} // namespace puzzlescript::compiler
