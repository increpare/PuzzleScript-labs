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

struct MovementLayerAnalysis {
    MaskVector originatingObjects;
    // -1 means that the collision layer can never originate transient
    // movement and therefore needs no movement-state lane.
    std::vector<int32_t> collisionToMovementLayer;
    std::vector<int32_t> movementToCollisionLayer;
};

struct SolverHashProjectionAnalysis {
    MaskVector projectedObjects;
    std::vector<int32_t> projectedLayers;
    MaskVector transientObjects;
    std::vector<std::string> blockers;
    std::string scope = "solver_hash_only";
};

StaticObjectAnalysis analyzeStaticObjects(const Game& game);

// Conservatively returns every object that can originate cardinal movement.
// This includes player objects (input-seeded movement) and objects that rules
// can put into motion. Action-only RHS state is intentionally outside this
// analysis. Consumers may project the result to collision layers.
MaskVector movementOriginatingObjects(const Game& game);

// Builds a compact, semantics-preserving lane map for transient movement
// storage. Collision layers remain unchanged; this only projects layers that
// can receive player input or an RHS movement write. A consumer that remaps
// rule masks must constant-fold movement predicates on omitted layers.
MovementLayerAnalysis analyzeMovementLayers(const Game& game);

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
