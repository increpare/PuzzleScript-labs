#include "levelSolve.h"

#include "game.h"
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
    if (lower.find("astar") != string::npos || lower.find("a-star") != string::npos) {
        return "AStar";
    }
    if (lower.find("portfolio") != string::npos) {
        const size_t colon = lower.rfind(':');
        if (colon != string::npos && colon + 1 < lower.size()) {
            return formatAlgorithmName(lower.substr(colon + 1));
        }
    }
    return strategy.empty() ? "Solver" : strategy;
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
                updateSnapshotLocked({Phase::Idle, -1, -1, "", requestHash});
                keepSolving.store(false, std::memory_order_relaxed);
            }
        }
        return;
    }

    long long timeoutMs = 500;
    while (keepSolving.load(std::memory_order_relaxed) && activeRequestHash.load() == requestHash) {
        const nativebridge::CandidateSolveResult result =
            nativebridge::solveGeneratedState(*context, state, timeoutMs);

        synchronized(solveMutex) {
            if (activeRequestHash.load() != requestHash) {
                break;
            }

            Snapshot next = activeSnapshot;
            next.stateHash = requestHash;
            if (result.expanded > 0 && (next.expanded < 0 || result.expanded > next.expanded)) {
                next.expanded = result.expanded;
            }
            if (!result.strategy.empty()) {
                next.algorithm = formatAlgorithmName(result.strategy);
            }

            if (result.status == nativebridge::CandidateSolveStatus::Solved) {
                next.phase = Phase::Solved;
                next.solutionLength = static_cast<int>(result.solution.size());
                if (next.expanded < 0) {
                    next.expanded = MAX(1LL, result.expanded);
                }
                if (next.algorithm.empty()) {
                    next.algorithm = formatAlgorithmName(result.strategy);
                }
                updateSnapshotLocked(next);
                break;
            }

            if (result.status == nativebridge::CandidateSolveStatus::Unsolvable) {
                next.phase = Phase::Unsolvable;
                updateSnapshotLocked(next);
                break;
            }

            next.phase = Phase::Running;
            updateSnapshotLocked(next);

            if (result.status == nativebridge::CandidateSolveStatus::Error) {
                if (!result.error.empty()) {
                    cerr << "native level solve error: " << result.error << endl;
                }
                break;
            }
        }

        if (result.status == nativebridge::CandidateSolveStatus::Timeout) {
            timeoutMs = MIN(timeoutMs * 2, 60000LL);
            continue;
        }
        break;
    }

    // The search has finished (solved / unsolvable / error / superseded). If we
    // are still the active request, clear the running flag so that a later
    // requestSolve() for this same state is not mistaken for an in-flight solve
    // and short-circuited.
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

    // requestSolve()/stopSolve() are only ever called from the UI thread, so the
    // two critical sections below cannot interleave with each other.
    thread previousThread;
    synchronized(solveMutex) {
        if (activeRequestHash.load() == requestHash && activeSnapshot.phase == Phase::Solved) {
            return;
        }
        if (activeRequestHash.load() == requestHash && keepSolving.load(std::memory_order_relaxed)) {
            return;
        }

        // Signal the worker to stop and take ownership of its handle so we can join
        // it *outside* solveMutex. The worker re-acquires solveMutex after every
        // solve to publish its snapshot, so joining while holding the lock would
        // deadlock.
        keepSolving.store(false, std::memory_order_relaxed);
        previousThread = std::move(solveThread);
    }

    if (previousThread.joinable()) {
        previousThread.join();
    }

    synchronized(solveMutex) {
        activeRequestHash.store(requestHash, std::memory_order_relaxed);
        activeSnapshot = {Phase::Running, -1, -1, "", requestHash};
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
    // Join outside the lock; the worker needs solveMutex to observe the stop and exit.
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
