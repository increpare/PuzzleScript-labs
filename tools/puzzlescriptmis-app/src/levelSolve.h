#ifndef levelSolve_h
#define levelSolve_h

#include "macros.h"

struct Game;

namespace levelSolve {

enum class Phase {
    Idle,
    Running,
    Solved,
    Unsolvable
};

struct Snapshot {
    Phase phase = Phase::Idle;
    int solutionLength = -1;
    long long expanded = -1;
    string algorithm;
    uint64_t stateHash = 0;
};

uint64_t stateHash(const Game& game, const vvvs& state);
void requestSolve(const Game& game, const vvvs& state);
void stopSolve();
Snapshot snapshot(uint64_t stateHash);

} // namespace levelSolve

#endif /* levelSolve_h */
