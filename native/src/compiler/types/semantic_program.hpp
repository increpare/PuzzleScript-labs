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

// Slice 1 of the SemanticProgram contract: resolved object identity + collision
// layers. Extended in later slices with legends, levels, win conditions, rules,
// and metadata. Serialized form is versioned via schemaVersion.
struct SemanticProgram {
    int32_t schemaVersion = 1;
    std::vector<SemanticObject> objects;
    std::vector<std::vector<int32_t>> collisionLayers;
};

} // namespace puzzlescript::compiler
