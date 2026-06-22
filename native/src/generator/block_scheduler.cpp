#include "generator/block_scheduler.hpp"

#include "search/difficulty.hpp"

#include <algorithm>
#include <exception>
#include <thread>
#include <utility>

namespace puzzlescript::generator {
namespace {

using puzzlescript::search::assessGeneratedLevelDifficulty;
using puzzlescript::search::DifficultyOptions;

bool keeperLessDifficulty(const Keeper& a, const Keeper& b) {
    if (a.difficulty != b.difficulty) {
        return a.difficulty < b.difficulty;
    }
    if (a.expandedPortfolio != b.expandedPortfolio) {
        return a.expandedPortfolio < b.expandedPortfolio;
    }
    return a.levelHash < b.levelHash;
}

uint64_t blockSeedFor(const BlockState& block, uint64_t globalSeed) {
    if (block.spec.header.seed) {
        return *block.spec.header.seed;
    }
    return splitmix64(globalSeed ^ (static_cast<uint64_t>(block.blockIndex) + 0x9e3779b97f4a7c15ULL));
}

void workerMain(
    const puzzlescript::LoadedGame& loadedGame,
    BlockState& block,
    GlobalDedupe& dedupe,
    OutputCoordinator& outputCoordinator,
    const std::deque<BlockState>& allBlocks,
    const LevelSetOptions& options,
    std::atomic<bool>& blockCancel) {
    const auto& game = *loadedGame.information;
    const uint64_t blockSeed = blockSeedFor(block, options.globalSeed);

    while (!blockCancel.load(std::memory_order_relaxed)) {
        const uint64_t sampleId = block.nextSampleId.fetch_add(1, std::memory_order_relaxed);
        const uint64_t sampleSeed = splitmix64(blockSeed ^ (sampleId + 0x9e3779b97f4a7c15ULL));
        Rng rng(sampleSeed);

        LevelTemplate candidateLevel;
        if (!applyProgram(block.program, block.spec.initLevel, game, rng, candidateLevel)) {
            continue;
        }

        const uint64_t levelHash = hashLevel(candidateLevel);

        DifficultyOptions primaryOpts;
        primaryOpts.timeoutMs = options.solverTimeoutMs;
        primaryOpts.runSupplemental = false;
        const auto primary = assessGeneratedLevelDifficulty(loadedGame, candidateLevel, primaryOpts);
        if (!primary.solved) {
            continue;
        }
        if (!insertGlobalDedupe(dedupe, levelHash, options.dedupeMax)) {
            continue;
        }

        const bool mightAdmit = [&] {
            std::lock_guard<std::mutex> lock(block.keeperMutex);
            if (block.keepers.size() < block.spec.header.take) {
                return true;
            }
            const Keeper& weakest = *std::min_element(
                block.keepers.begin(),
                block.keepers.end(),
                keeperLessDifficulty);
            return primary.breakdown.expandedPortfolio > weakest.expandedPortfolio;
        }();
        if (!mightAdmit) {
            continue;
        }

        DifficultyOptions fullOpts = primaryOpts;
        fullOpts.runSupplemental = true;
        const auto assessed = assessGeneratedLevelDifficulty(loadedGame, candidateLevel, fullOpts);
        if (!assessed.solved) {
            continue;
        }

        Keeper candidate;
        candidate.levelHash = levelHash;
        candidate.difficulty = assessed.breakdown.difficulty;
        candidate.expandedPortfolio = primary.breakdown.expandedPortfolio;
        candidate.sampleSeed = sampleSeed;
        candidate.blockIndex = block.blockIndex;
        candidate.blockName = block.spec.header.name;
        candidate.dimensionsLabel = dimensionsLabel(block.spec.header.width, block.spec.header.height);
        candidate.solution = assessed.solution;
        candidate.level = std::move(candidateLevel);

        bool improved = false;
        {
            std::lock_guard<std::mutex> lock(block.keeperMutex);
            improved = tryInsertKeeper(block, std::move(candidate));
            if (improved) {
                block.idleSince = Clock::now();
            }
        }
        if (improved) {
            outputCoordinator.notifyImprovement(snapshotAllKeepers(allBlocks));
        }
    }
}

} // namespace

bool insertGlobalDedupe(GlobalDedupe& dedupe, uint64_t hash, size_t dedupeMax) {
    const size_t shard = static_cast<size_t>(hash % dedupe.sets.size());
    std::lock_guard<std::mutex> lock(dedupe.mutexes[shard]);
    const size_t shardCap = std::max<size_t>(1, dedupeMax / dedupe.sets.size());
    if (dedupe.sets[shard].find(hash) != dedupe.sets[shard].end()) {
        return false;
    }
    if (dedupe.sets[shard].size() >= shardCap) {
        const uint64_t evicted = dedupe.order[shard].front();
        dedupe.order[shard].pop_front();
        dedupe.sets[shard].erase(evicted);
    }
    dedupe.sets[shard].insert(hash);
    dedupe.order[shard].push_back(hash);
    return true;
}

bool tryInsertKeeper(BlockState& block, Keeper candidate) {
    const size_t take = block.spec.header.take;
    if (block.keepers.size() < take) {
        block.keepers.push_back(std::move(candidate));
        std::sort(block.keepers.begin(), block.keepers.end(), keeperLessDifficulty);
        return true;
    }

    auto weakest = std::min_element(block.keepers.begin(), block.keepers.end(), keeperLessDifficulty);
    if (weakest == block.keepers.end() || candidate.difficulty <= weakest->difficulty) {
        return false;
    }

    *weakest = std::move(candidate);
    std::sort(block.keepers.begin(), block.keepers.end(), keeperLessDifficulty);
    return true;
}

std::vector<Keeper> snapshotAllKeepers(const std::deque<BlockState>& blocks) {
    std::vector<Keeper> snapshot;
    for (const BlockState& block : blocks) {
        std::lock_guard<std::mutex> lock(block.keeperMutex);
        snapshot.insert(snapshot.end(), block.keepers.begin(), block.keepers.end());
    }
    return snapshot;
}

void runBlockUntilIdle(
    const puzzlescript::LoadedGame& loadedGame,
    BlockState& block,
    GlobalDedupe& dedupe,
    OutputCoordinator& outputCoordinator,
    const std::deque<BlockState>& allBlocks,
    const LevelSetOptions& options) {
    {
        std::lock_guard<std::mutex> lock(block.keeperMutex);
        block.idleSince = Clock::now();
    }

    std::atomic<bool> blockCancel{false};
    std::vector<std::thread> workers;
    workers.reserve(options.jobs);
    for (size_t workerIndex = 0; workerIndex < options.jobs; ++workerIndex) {
        workers.emplace_back(
            workerMain,
            std::cref(loadedGame),
            std::ref(block),
            std::ref(dedupe),
            std::ref(outputCoordinator),
            std::cref(allBlocks),
            std::cref(options),
            std::ref(blockCancel));
    }

    while (true) {
        if (options.cancel != nullptr && options.cancel->load(std::memory_order_relaxed)) {
            break;
        }
        TimePoint idleSince;
        {
            std::lock_guard<std::mutex> lock(block.keeperMutex);
            idleSince = block.idleSince;
        }
        if (Clock::now() - idleSince >= std::chrono::milliseconds(block.inactivityTimeoutMs)) {
            break;
        }
        std::this_thread::sleep_for(std::chrono::milliseconds(50));
    }

    blockCancel.store(true, std::memory_order_relaxed);
    for (auto& worker : workers) {
        worker.join();
    }

    outputCoordinator.flush();
    block.inactivityTimeoutMs *= 2;
}

void runLevelSetForever(
    const puzzlescript::LoadedGame& loadedGame,
    const std::string& /*gameSource*/,
    std::deque<BlockState>& blocks,
    OutputCoordinator& outputCoordinator,
    const LevelSetOptions& options) {
    if (blocks.empty()) {
        throw std::runtime_error("Level-set spec produced no blocks");
    }

    GlobalDedupe dedupe;
    for (BlockState& block : blocks) {
        block.inactivityTimeoutMs = options.inactivityStartMs;
    }

    outputCoordinator.notifyImprovement(snapshotAllKeepers(blocks));
    outputCoordinator.flush();

    while (options.cancel == nullptr || !options.cancel->load(std::memory_order_relaxed)) {
        for (BlockState& block : blocks) {
            if (options.cancel != nullptr && options.cancel->load(std::memory_order_relaxed)) {
                break;
            }
            runBlockUntilIdle(loadedGame, block, dedupe, outputCoordinator, blocks, options);
        }
    }

    outputCoordinator.flush();
}

} // namespace puzzlescript::generator
