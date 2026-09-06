#pragma once

#include "generator/generation_rules.hpp"
#include "generator/keeper.hpp"
#include "generator/output_writer.hpp"
#include "generator/spec_parser.hpp"
#include "runtime/core.hpp"

#include <array>
#include <atomic>
#include <chrono>
#include <cstdint>
#include <deque>
#include <mutex>
#include <unordered_set>
#include <vector>

namespace puzzlescript::generator {

using Clock = std::chrono::steady_clock;
using TimePoint = Clock::time_point;

struct GlobalDedupe {
    std::array<std::mutex, 64> mutexes;
    std::array<std::unordered_set<uint64_t>, 64> sets;
    std::array<std::deque<uint64_t>, 64> order;
};

bool insertGlobalDedupe(GlobalDedupe& dedupe, uint64_t hash, size_t dedupeMax);
bool containsGlobalDedupe(GlobalDedupe& dedupe, uint64_t hash);

struct BlockState {
    BlockSpec spec;
    GenerationProgram program;
    std::vector<Keeper> keepers;
    mutable std::mutex keeperMutex;
    std::atomic<uint64_t> nextSampleId{0};
    std::atomic<uint64_t> samplesAttempted{0};
    uint64_t samplesAtPassStart = 0;
    int64_t inactivityTimeoutMs = 10000;
    TimePoint idleSince{};
    size_t blockIndex = 0;
    enum class PassPhase {
        Queued,
        Searching,
        Done,
        Exhausted,
    };
    PassPhase passPhase = PassPhase::Queued;
    bool permanentlyExhausted = false;
    size_t passesWithoutImprovement = 0;
};

struct LevelSetOptions {
    uint64_t globalSeed = 1;
    size_t jobs = 1;
    int64_t solverTimeoutMs = 250;
    size_t dedupeMax = 1000000;
    int64_t inactivityStartMs = 60000;
    size_t exhaustPasses = 3;
    std::atomic<bool>* cancel = nullptr;
    bool quiet = false;
    std::string modeLabel = "level-set";
    std::string outPath;
};

bool tryInsertKeeper(BlockState& block, Keeper candidate);
bool canImproveKeeper(const BlockState& block, int64_t primaryExpanded);

struct BlockBestSnapshot {
    int64_t difficulty = -1;
    int64_t expandedPortfolio = -1;
    size_t keeperCount = 0;
};

BlockBestSnapshot snapshotBlockBest(const BlockState& block);
bool blockImprovedSinceSnapshot(const BlockState& block, const BlockBestSnapshot& before);
void notePassOutcome(BlockState& block, const BlockBestSnapshot& before, const LevelSetOptions& options);

std::vector<Keeper> snapshotAllKeepers(const std::deque<BlockState>& blocks);

void runBlockUntilIdle(
    const puzzlescript::LoadedGame& loadedGame,
    BlockState& block,
    GlobalDedupe& dedupe,
    OutputCoordinator& outputCoordinator,
    const std::deque<BlockState>& allBlocks,
    const LevelSetOptions& options,
    size_t passIndex);

void runLevelSetForever(
    const puzzlescript::LoadedGame& loadedGame,
    const std::string& gameSource,
    std::deque<BlockState>& blocks,
    OutputCoordinator& outputCoordinator,
    const LevelSetOptions& options);

} // namespace puzzlescript::generator
