#pragma once

#include <string>
#include <utility>
#include <vector>

#include "runtime/core.hpp"

namespace puzzlescript::solver {

struct StaticObjectAnalysis {
    MaskVector staticObjects;
    MaskVector writtenObjects;
    MaskVector movementMentionedObjects;
};

StaticObjectAnalysis analyzeStaticObjects(const Game& game);

std::vector<std::string> staticObjectNames(
    const Game& game,
    const MaskVector& staticObjects
);

std::vector<std::pair<std::string, std::vector<std::string>>> staticObjectBlockers(
    const Game& game,
    const MaskVector& staticObjects,
    const MaskVector& writtenObjects,
    const MaskVector& movementMentionedObjects
);

} // namespace puzzlescript::solver
