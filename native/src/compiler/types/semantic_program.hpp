#pragma once

#include <cstdint>
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

// Current SemanticProgram contract: resolved object identity, collision layers,
// resolved legends, and resolved levels. Extended in later slices with win
// conditions, rules, and metadata. Serialized form is versioned via schemaVersion.
struct SemanticProgram {
    int32_t schemaVersion = 1;
    std::vector<SemanticObject> objects;
    std::vector<std::vector<int32_t>> collisionLayers;
    std::vector<SemanticLegend> synonyms;    // sorted by name
    std::vector<SemanticLegend> aggregates;  // sorted by name
    std::vector<SemanticLegend> properties;  // sorted by name
    std::vector<SemanticLevel> levels;
};

} // namespace puzzlescript::compiler
