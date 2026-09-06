#include "levelSolve.h"

#include "game.h"
#include "native_bridge/DifficultyAssessment.h"
#include "native_bridge/NativeGameFacade.h"

#include <atomic>
#include <thread>

namespace levelSolve {
namespace {

string formatAlgorithmName(const string& strategy) {
    const string lower = [&]() {
        string value = strategy;
        for (char& ch : value) {
            ch = static_cast<char>(tolower(static_cast<unsigned char>(ch)));
        }
        return value;
    }();

    if (lower.find("bfs") != string::npos) {
        return "BFS";
    }
    if (lower.find("greedy") != string::npos) {
        return "Greedy";
    }
    if (lower.find("weighted") != string::npos && lower.find("astar") != string::npos) {
        return "WeightedAStar";
    }
    if (lower.find("astar") != string::npos || lower.find("a-star") != string::npos) {
        return "WeightedAStar";
    }
    if (lower.find("portfolio") != string::npos) {
        const size_t colon = lower.rfind(':');
        if (colon != string::npos && colon + 1 < lower.size()) {
            return formatAlgorithmName(lower.substr(colon + 1));
        }
        return "Portfolio";
    }
    return strategy.empty() ? "Solver" : strategy;
}

Snapshot snapshotFromAssessment(
    const nativebridge::DifficultyAssessmentResult& assessed,
    uint64_t requestHash,
    Phase phase) {
    Snapshot next{};
    next.phase = phase;
    next.stateHash = requestHash;
    next.solutionLength = static_cast<int>(assessed.solution.size());
    next.algorithm = formatAlgorithmName(assessed.primaryStrategy);
    next.expandedPortfolio = assessed.breakdown.expandedPortfolio;
    next.expandedGreedy = assessed.breakdown.expandedGreedy;
    next.expandedWeightedAStar = assessed.breakdown.expandedWeightedAStar;
    next.expandedBfs = assessed.breakdown.expandedBfs;
    next.difficulty = assessed.breakdown.difficulty;
    next.difficultyAlgorithm = assessed.breakdown.difficultyAlgorithm;
    next.expanded = next.difficulty;
    return next;
}

Snapshot emptySnapshot(Phase phase, uint64_t requestHash) {
    Snapshot next{};
    next.phase = phase;
    next.stateHash = requestHash;
    return next;
}

recursive_mutex solveMutex;
thread solveThread;
atomic<bool> keepSolving(false);
atomic<uint64_t> activeRequestHash{0};
Snapshot activeSnapshot;

void updateSnapshotLocked(const Snapshot& next) {
    activeSnapshot = next;
}

void solvingLoop(uint64_t requestHash, vvvs state) {
    shared_ptr<nativebridge::CandidateSolverContext> context = nativebridge::createCandidateSolverContext();
    if (!context) {
        synchronized(solveMutex) {
            if (activeRequestHash.load() == requestHash) {
                updateSnapshotLocked(emptySnapshot(Phase::Idle, requestHash));
                keepSolving.store(false, std::memory_order_relaxed);
            }
        }
        return;
    }

    long long timeoutMs = 500;
    while (keepSolving.load(std::memory_order_relaxed) && activeRequestHash.load() == requestHash) {
        nativebridge::DifficultyAssessmentOptions options;
        options.primaryTimeoutMs = timeoutMs;
        options.runSupplemental = true;
        options.supplementalTimeoutMs = 60000;
        options.shouldCancel = [requestHash] {
            return !keepSolving.load(std::memory_order_relaxed)
                || activeRequestHash.load() != requestHash;
        };

        const nativebridge::DifficultyAssessmentResult assessed = nativebridge::assessDifficulty(
            *context,
            state,
            options,
            [&](nativebridge::DifficultyAssessmentStage stage, const nativebridge::DifficultyAssessmentResult& partial) {
                if (!keepSolving.load(std::memory_order_relaxed) || activeRequestHash.load() != requestHash) {
                    return;
                }

                synchronized(solveMutex) {
                    if (activeRequestHash.load() != requestHash) {
                        return;
                    }

                    Phase phase = Phase::Running;
                    if (stage == nativebridge::DifficultyAssessmentStage::PrimaryComplete) {
                        phase = Phase::Refining;
                    } else if (stage == nativebridge::DifficultyAssessmentStage::Complete) {
                        phase = partial.primaryStatus == nativebridge::CandidateSolveStatus::Solved
                            ? Phase::Solved
                            : activeSnapshot.phase;
                    } else if (stage != nativebridge::DifficultyAssessmentStage::PrimaryComplete) {
                        phase = Phase::Refining;
                    }

                    Snapshot next = snapshotFromAssessment(partial, requestHash, phase);
                    if (partial.primaryStatus != nativebridge::CandidateSolveStatus::Solved
                        && stage == nativebridge::DifficultyAssessmentStage::Complete) {
                        next.phase = Phase::Running;
                    }
                    updateSnapshotLocked(next);
                }
            });

        if (assessed.interrupted) break;
        synchronized(solveMutex) {
            if (activeRequestHash.load() != requestHash) {
                break;
            }

            if (assessed.primaryStatus == nativebridge::CandidateSolveStatus::Solved) {
                updateSnapshotLocked(snapshotFromAssessment(assessed, requestHash, Phase::Solved));
                break;
            }

            if (assessed.primaryStatus == nativebridge::CandidateSolveStatus::Unsolvable) {
                updateSnapshotLocked(emptySnapshot(Phase::Unsolvable, requestHash));
                break;
            }

            if (assessed.primaryStatus == nativebridge::CandidateSolveStatus::Error) {
                if (!assessed.primaryError.empty()) {
                    cerr << "native level solve error: " << assessed.primaryError << endl;
                }
                break;
            }

            updateSnapshotLocked(snapshotFromAssessment(assessed, requestHash, Phase::Running));
        }

        if (assessed.primaryStatus == nativebridge::CandidateSolveStatus::Timeout) {
            timeoutMs = MIN(timeoutMs * 2, 60000LL);
            continue;
        }
        break;
    }

    synchronized(solveMutex) {
        if (activeRequestHash.load() == requestHash) {
            keepSolving.store(false, std::memory_order_relaxed);
        }
    }
}

} // namespace

uint64_t stateHash(const Game& game, const vvvs& state) {
    uint64_t hash = game.getHash();
    HashVVV(state, hash);
    return hash;
}

void requestSolve(const Game& game, const vvvs& state) {
    if (state.empty() || state[0].empty() || state[0][0].empty()) {
        return;
    }

    const uint64_t requestHash = stateHash(game, state);

    thread previousThread;
    synchronized(solveMutex) {
        if (activeRequestHash.load() == requestHash && activeSnapshot.phase == Phase::Solved) {
            return;
        }
        if (activeRequestHash.load() == requestHash && keepSolving.load(std::memory_order_relaxed)) {
            return;
        }

        keepSolving.store(false, std::memory_order_relaxed);
        previousThread = std::move(solveThread);
    }

    if (previousThread.joinable()) {
        previousThread.join();
    }

    synchronized(solveMutex) {
        activeRequestHash.store(requestHash, std::memory_order_relaxed);
        activeSnapshot = emptySnapshot(Phase::Running, requestHash);
        keepSolving.store(true, std::memory_order_relaxed);
        solveThread = thread(solvingLoop, requestHash, state);
    }
}

void stopSolve() {
    thread previousThread;
    synchronized(solveMutex) {
        keepSolving.store(false, std::memory_order_relaxed);
        activeRequestHash.store(0, std::memory_order_relaxed);
        activeSnapshot = {};
        previousThread = std::move(solveThread);
    }
    if (previousThread.joinable()) {
        previousThread.join();
    }
}

Snapshot snapshot(uint64_t requestedHash) {
    Snapshot result{};
    synchronized(solveMutex) {
        if (activeSnapshot.stateHash == requestedHash) {
            result = activeSnapshot;
        }
    }
    return result;
}

} // namespace levelSolve
