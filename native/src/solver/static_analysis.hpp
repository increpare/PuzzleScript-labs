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

struct SolverHashProjectionAnalysis {
    MaskVector projectedObjects;
    std::vector<int32_t> projectedLayers;
    MaskVector transientObjects;
    std::vector<std::string> blockers;
    std::string scope = "solver_hash_only";
};

StaticObjectAnalysis analyzeStaticObjects(const Game& game);

SolverHashProjectionAnalysis analyzeSolverHashProjection(const Game& game);

std::vector<std::string> objectNamesForMask(
    const Game& game,
    const MaskVector& objects
);

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
