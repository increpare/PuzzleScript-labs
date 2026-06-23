#include "generator/block_scheduler.hpp"

#include "search/difficulty.hpp"

#include <algorithm>
#include <exception>
#include <iomanip>
#include <iostream>
#include <sstream>
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

std::string formatDurationMs(int64_t ms) {
    if (ms % 1000 == 0) {
        return std::to_string(ms / 1000) + "s";
    }
    if (ms % 60000 == 0) {
        return std::to_string(ms / 60000) + "m";
    }
    std::ostringstream out;
    out << std::fixed << std::setprecision(1) << (static_cast<double>(ms) / 1000.0) << "s";
    return out.str();
}

void logKeeperImprovement(std::ostream& out, const Keeper& keeper, size_t keeperCount, size_t take) {
    out << "levelset_improved block=\"" << keeper.blockName << "\" "
        << keeper.dimensionsLabel << " difficulty=" << keeper.difficulty
        << " expanded=" << keeper.expandedPortfolio
        << " seed=" << keeper.sampleSeed
        << " keepers=" << keeperCount << "/" << take << "\n";
}

void logLevelSetStartup(
    std::ostream& out,
    const std::deque<BlockState>& blocks,
    const LevelSetOptions& options) {
    out << "levelset_start mode=" << options.modeLabel
        << " blocks=" << blocks.size()
        << " jobs=" << options.jobs
        << " solver_timeout=" << formatDurationMs(options.solverTimeoutMs)
        << " inactivity_start=" << formatDurationMs(options.inactivityStartMs);
    if (options.exhaustPasses > 0) {
        out << " exhaust_passes=" << options.exhaustPasses;
    }
    out << " seed=" << options.globalSeed;
    if (!options.outPath.empty()) {
        out << " output=" << options.outPath;
    }
    out << "\n";
    for (const BlockState& block : blocks) {
        out << "  block " << (block.blockIndex + 1) << "/" << blocks.size()
            << " name=\"" << block.spec.header.name << "\" "
            << dimensionsLabel(block.spec.header.width, block.spec.header.height)
            << " take=" << block.spec.header.take << "\n";
    }
    out << "levelset_running (Ctrl+C to stop; searching for hardest solvable boards";
    if (options.exhaustPasses > 0) {
        out << "; blocks retire after " << options.exhaustPasses << " passes with no improvement";
    }
    out << ")\n";
}

void logBlockSearchStart(std::ostream& out, const BlockState& block, size_t blockCount, size_t passIndex) {
    out << "levelset_search pass=" << passIndex
        << " block=" << (block.blockIndex + 1) << "/" << blockCount
        << " name=\"" << block.spec.header.name << "\" "
        << dimensionsLabel(block.spec.header.width, block.spec.header.height)
        << " inactivity_timeout=" << formatDurationMs(block.inactivityTimeoutMs)
        << " samples_so_far=" << block.samplesAttempted.load(std::memory_order_relaxed)
        << "\n";
}

void logBlockSearchIdle(
    std::ostream& out,
    const BlockState& block,
    size_t blockCount,
    size_t passIndex) {
    int64_t bestDifficulty = -1;
    int64_t bestExpanded = -1;
    size_t keeperCount = 0;
    {
        std::lock_guard<std::mutex> lock(block.keeperMutex);
        keeperCount = block.keepers.size();
        if (!block.keepers.empty()) {
            const Keeper& best = *std::max_element(
                block.keepers.begin(),
                block.keepers.end(),
                keeperLessDifficulty);
            bestDifficulty = best.difficulty;
            bestExpanded = best.expandedPortfolio;
        }
    }
    out << "levelset_idle pass=" << passIndex
        << " block=" << (block.blockIndex + 1) << "/" << blockCount
        << " name=\"" << block.spec.header.name << "\""
        << " keepers=" << keeperCount << "/" << block.spec.header.take
        << " best_difficulty=" << bestDifficulty
        << " best_expanded=" << bestExpanded
        << " samples=" << block.samplesAttempted.load(std::memory_order_relaxed)
        << " next_inactivity_timeout=" << formatDurationMs(block.inactivityTimeoutMs)
        << "\n";
}

void logBlockExhausted(std::ostream& out, const BlockState& block, size_t blockCount, size_t passIndex) {
    out << "levelset_exhausted pass=" << passIndex
        << " block=" << (block.blockIndex + 1) << "/" << blockCount
        << " name=\"" << block.spec.header.name << "\""
        << " passes_without_improvement=" << block.passesWithoutImprovement
        << " samples=" << block.samplesAttempted.load(std::memory_order_relaxed)
        << "\n";
}

void logLevelSetProgress(
    std::ostream& out,
    const std::deque<BlockState>& blocks,
    TimePoint start,
    size_t passIndex,
    int64_t solverTimeoutMs) {
    const double elapsed = std::chrono::duration<double>(Clock::now() - start).count();
    uint64_t totalSamples = 0;
    size_t filledKeepers = 0;
    size_t totalKeepers = 0;
    size_t searchingCount = 0;
    size_t doneCount = 0;
    size_t exhaustedCount = 0;
    for (const BlockState& block : blocks) {
        totalSamples += block.samplesAttempted.load(std::memory_order_relaxed);
        if (block.passPhase == BlockState::PassPhase::Searching) {
            ++searchingCount;
        } else if (block.passPhase == BlockState::PassPhase::Done) {
            ++doneCount;
        } else if (block.passPhase == BlockState::PassPhase::Exhausted) {
            ++exhaustedCount;
        }
        std::lock_guard<std::mutex> lock(block.keeperMutex);
        filledKeepers += block.keepers.size();
        totalKeepers += block.spec.header.take;
    }
    out << "levelset_progress elapsed_s=" << std::fixed << std::setprecision(1) << elapsed
        << " pass=" << passIndex
        << " blocks=" << blocks.size()
        << " keepers=" << filledKeepers << "/" << totalKeepers
        << " searching=" << searchingCount
        << " done=" << doneCount
        << " exhausted=" << exhaustedCount
        << " samples=" << totalSamples << "\n";
    const TimePoint now = Clock::now();
    for (const BlockState& block : blocks) {
        int64_t bestDifficulty = -1;
        int64_t bestExpanded = -1;
        size_t keeperCount = 0;
        {
            std::lock_guard<std::mutex> lock(block.keeperMutex);
            keeperCount = block.keepers.size();
            if (!block.keepers.empty()) {
                const Keeper& best = *std::max_element(
                    block.keepers.begin(),
                    block.keepers.end(),
                    keeperLessDifficulty);
                bestDifficulty = best.difficulty;
                bestExpanded = best.expandedPortfolio;
            }
        }
        out << "  [" << std::setw(2) << (block.blockIndex + 1) << "/" << blocks.size() << "] "
            << std::setw(16) << std::left << block.spec.header.name << std::right
            << " " << dimensionsLabel(block.spec.header.width, block.spec.header.height)
            << " keepers=" << keeperCount << "/" << block.spec.header.take
            << " best=" << bestDifficulty
            << " expanded=" << bestExpanded
            << " samples=" << block.samplesAttempted.load(std::memory_order_relaxed);
        switch (block.passPhase) {
        case BlockState::PassPhase::Queued:
            out << " status=queued";
            break;
        case BlockState::PassPhase::Searching: {
            double quietSeconds = 0.0;
            {
                std::lock_guard<std::mutex> lock(block.keeperMutex);
                quietSeconds = std::chrono::duration<double>(now - block.idleSince).count();
            }
            out << " status=searching quiet_s=" << std::fixed << std::setprecision(1) << quietSeconds
                << " solver_timeout_ms=" << solverTimeoutMs;
            break;
        }
        case BlockState::PassPhase::Done:
            out << " status=done";
            break;
        case BlockState::PassPhase::Exhausted:
            out << " status=exhausted passes_without_improvement=" << block.passesWithoutImprovement;
            break;
        }
        out << "\n";
    }
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
        block.samplesAttempted.fetch_add(1, std::memory_order_relaxed);
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
            if (!options.quiet) {
                std::lock_guard<std::mutex> lock(block.keeperMutex);
                const Keeper& best = *std::max_element(
                    block.keepers.begin(),
                    block.keepers.end(),
                    keeperLessDifficulty);
                logKeeperImprovement(
                    std::cerr,
                    best,
                    block.keepers.size(),
                    block.spec.header.take);
            }
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

BlockBestSnapshot snapshotBlockBest(const BlockState& block) {
    BlockBestSnapshot snapshot;
    std::lock_guard<std::mutex> lock(block.keeperMutex);
    snapshot.keeperCount = block.keepers.size();
    if (block.keepers.empty()) {
        return snapshot;
    }
    const Keeper& best = *std::max_element(
        block.keepers.begin(),
        block.keepers.end(),
        keeperLessDifficulty);
    snapshot.difficulty = best.difficulty;
    snapshot.expandedPortfolio = best.expandedPortfolio;
    return snapshot;
}

bool blockImprovedSinceSnapshot(const BlockState& block, const BlockBestSnapshot& before) {
    std::lock_guard<std::mutex> lock(block.keeperMutex);
    if (block.keepers.size() > before.keeperCount) {
        return true;
    }
    if (block.keepers.empty()) {
        return false;
    }
    const Keeper& best = *std::max_element(
        block.keepers.begin(),
        block.keepers.end(),
        keeperLessDifficulty);
    if (before.keeperCount == 0) {
        return true;
    }
    if (best.difficulty > before.difficulty) {
        return true;
    }
    return best.difficulty == before.difficulty
        && best.expandedPortfolio > before.expandedPortfolio;
}

void notePassOutcome(BlockState& block, const BlockBestSnapshot& before, const LevelSetOptions& options) {
    if (options.exhaustPasses == 0) {
        return;
    }
    if (blockImprovedSinceSnapshot(block, before)) {
        block.passesWithoutImprovement = 0;
        return;
    }
    ++block.passesWithoutImprovement;
    if (block.passesWithoutImprovement >= options.exhaustPasses) {
        block.permanentlyExhausted = true;
        block.passPhase = BlockState::PassPhase::Exhausted;
    }
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
    const LevelSetOptions& options,
    size_t passIndex) {
    if (block.permanentlyExhausted) {
        block.passPhase = BlockState::PassPhase::Exhausted;
        return;
    }

    const BlockBestSnapshot passStart = snapshotBlockBest(block);
    if (!options.quiet) {
        logBlockSearchStart(std::cerr, block, allBlocks.size(), passIndex);
    }
    block.passPhase = BlockState::PassPhase::Searching;
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

    if (!options.quiet) {
        logBlockSearchIdle(std::cerr, block, allBlocks.size(), passIndex);
    }

    const bool wasExhausted = block.permanentlyExhausted;
    notePassOutcome(block, passStart, options);
    if (!wasExhausted && block.permanentlyExhausted && !options.quiet) {
        logBlockExhausted(std::cerr, block, allBlocks.size(), passIndex);
    }

    if (block.permanentlyExhausted) {
        block.passPhase = BlockState::PassPhase::Exhausted;
    } else {
        block.passPhase = BlockState::PassPhase::Done;
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

    if (!options.quiet) {
        logLevelSetStartup(std::cerr, blocks, options);
    }

    outputCoordinator.notifyImprovement(snapshotAllKeepers(blocks));
    outputCoordinator.flush();

    const TimePoint start = Clock::now();
    std::atomic<size_t> passIndex{1};
    std::atomic<bool> progressCancel{false};
    std::thread progressThread;
    if (!options.quiet) {
        progressThread = std::thread([&]() {
            while (!progressCancel.load(std::memory_order_relaxed)) {
                if (options.cancel != nullptr && options.cancel->load(std::memory_order_relaxed)) {
                    break;
                }
                std::this_thread::sleep_for(std::chrono::seconds(10));
                if (progressCancel.load(std::memory_order_relaxed)) {
                    break;
                }
                logLevelSetProgress(
                    std::cerr,
                    blocks,
                    start,
                    passIndex.load(std::memory_order_relaxed),
                    options.solverTimeoutMs);
            }
        });
    }

    while (options.cancel == nullptr || !options.cancel->load(std::memory_order_relaxed)) {
        const size_t currentPass = passIndex.load(std::memory_order_relaxed);
        for (BlockState& block : blocks) {
            if (block.permanentlyExhausted) {
                block.passPhase = BlockState::PassPhase::Exhausted;
            } else {
                block.passPhase = BlockState::PassPhase::Queued;
            }
        }
        for (BlockState& block : blocks) {
            if (options.cancel != nullptr && options.cancel->load(std::memory_order_relaxed)) {
                break;
            }
            if (block.permanentlyExhausted) {
                continue;
            }
            runBlockUntilIdle(loadedGame, block, dedupe, outputCoordinator, blocks, options, currentPass);
        }
        const bool allExhausted = std::all_of(
            blocks.begin(),
            blocks.end(),
            [](const BlockState& block) { return block.permanentlyExhausted; });
        if (allExhausted) {
            if (!options.quiet) {
                std::cerr << "levelset_complete all blocks exhausted\n";
            }
            break;
        }
        passIndex.fetch_add(1, std::memory_order_relaxed);
    }

    progressCancel.store(true, std::memory_order_relaxed);
    if (progressThread.joinable()) {
        progressThread.join();
    }

    if (!options.quiet) {
        logLevelSetProgress(
            std::cerr,
            blocks,
            start,
            passIndex.load(std::memory_order_relaxed),
            options.solverTimeoutMs);
        std::cerr << "levelset_stopped\n";
    }

    outputCoordinator.flush();
}

} // namespace puzzlescript::generator
