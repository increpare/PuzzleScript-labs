#include "generated_game.h"
#include "puzzlescript/gbc.h"

#include <algorithm>
#include <chrono>
#include <cstdio>
#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <sstream>
#include <string>
#include <vector>

#ifndef PS_REPO_ROOT
#error PS_REPO_ROOT is required
#endif

namespace {

using Clock = std::chrono::steady_clock;

struct SnapshotMemory {
    uint16_t stride = 0;
    std::vector<uint8_t> cells;
};

bool snapshotRead(void* context, uint8_t slot, void* data, uint16_t byteCount) {
    const auto& memory = *static_cast<const SnapshotMemory*>(context);
    std::copy_n(
        memory.cells.data() + static_cast<size_t>(slot) * memory.stride,
        byteCount,
        static_cast<uint8_t*>(data));
    return true;
}

bool snapshotWrite(void* context, uint8_t slot, const void* data, uint16_t byteCount) {
    auto& memory = *static_cast<SnapshotMemory*>(context);
    std::copy_n(
        static_cast<const uint8_t*>(data),
        byteCount,
        memory.cells.data() + static_cast<size_t>(slot) * memory.stride);
    return true;
}

bool parseInputToken(const std::string& token, ps_input* out) {
    if (token == "up") {
        *out = PS_INPUT_UP;
        return true;
    }
    if (token == "left") {
        *out = PS_INPUT_LEFT;
        return true;
    }
    if (token == "down") {
        *out = PS_INPUT_DOWN;
        return true;
    }
    if (token == "right") {
        *out = PS_INPUT_RIGHT;
        return true;
    }
    if (token == "action") {
        *out = PS_INPUT_ACTION;
        return true;
    }
    return false;
}

std::vector<ps_input> loadReplay(const std::filesystem::path& path) {
    std::vector<ps_input> inputs;
    std::ifstream input(path);
    std::string line;
    while (std::getline(input, line)) {
        if (line.empty()) continue;
        ps_input value = PS_INPUT_TICK;
        if (!parseInputToken(line, &value)) {
            fprintf(stderr, "gbc_solution_replay_bench: unknown token: %s\n", line.c_str());
            return {};
        }
        inputs.push_back(value);
    }
    return inputs;
}

bool initSession(
    ps_gbc_session** sessionOut,
    SnapshotMemory* memoryOut,
    std::vector<uint8_t>* arenaOut,
    ps_gbc_snapshot_io* snapshotsOut
) {
    const size_t requiredBytes = std::max(
        static_cast<size_t>(PS_GBC_GENERATED_SESSION_BYTES),
        ps_gbc_session_required_bytes(&ps_gbc_generated_game));
    arenaOut->assign(requiredBytes, 0U);
    memoryOut->stride = static_cast<uint16_t>(
        ps_gbc_generated_game.max_level_cells
            * ps_gbc_generated_game.object_bytes_per_cell);
    memoryOut->cells.assign(
        static_cast<size_t>(ps_gbc_generated_game.undo_capacity + 1U)
            * memoryOut->stride,
        0U);
    snapshotsOut->context = memoryOut;
    snapshotsOut->read = snapshotRead;
    snapshotsOut->write = snapshotWrite;
    *sessionOut = ps_gbc_session_init(
        arenaOut->data(),
        arenaOut->size(),
        &ps_gbc_generated_game,
        snapshotsOut);
    return *sessionOut != nullptr;
}

double percentileLe(const std::vector<double>& samples, double thresholdMs) {
    if (samples.empty()) return 0.0;
    const size_t count = std::count_if(
        samples.begin(),
        samples.end(),
        [thresholdMs](double value) { return value <= thresholdMs; });
    return 100.0 * static_cast<double>(count) / static_cast<double>(samples.size());
}

void printJsonDouble(const char* key, double value, bool trailingComma) {
    std::printf("  \"%s\": %.6f%s\n", key, value, trailingComma ? "," : "");
}

} // namespace

int main(int argc, char** argv) {
    std::filesystem::path fixturePath =
        std::filesystem::path(PS_REPO_ROOT)
        / "native"
        / "tests"
        / "fixtures"
        / "gbc_sokoban_basic_solution.txt";
    int iterations = 3;
    for (int index = 1; index < argc; ++index) {
        const std::string arg = argv[index];
        if (arg == "--fixture" && index + 1 < argc) {
            fixturePath = argv[++index];
            continue;
        }
        if (arg == "--iterations" && index + 1 < argc) {
            iterations = std::max(1, std::atoi(argv[++index]));
            continue;
        }
        fprintf(stderr, "usage: %s [--fixture PATH] [--iterations N]\n", argv[0]);
        return 1;
    }

    const std::vector<ps_input> inputs = loadReplay(fixturePath);
    if (inputs.empty()) {
        fprintf(stderr, "gbc_solution_replay_bench: empty or invalid fixture\n");
        return 1;
    }

    std::vector<double> turnMs;
    turnMs.reserve(inputs.size());
    bool won = false;

    for (int run = 0; run < iterations; ++run) {
        ps_gbc_session* session = nullptr;
        SnapshotMemory memory{};
        std::vector<uint8_t> arena;
        ps_gbc_snapshot_io snapshots{};
        if (!initSession(&session, &memory, &arena, &snapshots)) {
            fprintf(stderr, "gbc_solution_replay_bench: session init failed\n");
            return 1;
        }

        if (run == 0) turnMs.clear();
        for (const ps_input input : inputs) {
            const auto start = Clock::now();
            const ps_step_result result = ps_gbc_step(session, input);
            const auto elapsed = Clock::now() - start;
            if (run == 0) {
                turnMs.push_back(
                    std::chrono::duration<double, std::milli>(elapsed).count());
            }
            if (result.won) won = true;
        }
    }

    double meanMs = 0.0;
    for (double sample : turnMs) meanMs += sample;
    if (!turnMs.empty()) meanMs /= static_cast<double>(turnMs.size());

    const double ticksPerTurn4096 = meanMs * 4096.0 / 1000.0;

    std::printf("{\n");
    std::printf("  \"format\": \"puzzlescript-gbc-solution-replay-bench-v1\",\n");
    std::printf("  \"timing_source\": \"host_gbc_core\",\n");
    std::printf("  \"game_slug\": \"sokoban_basic\",\n");
    std::printf("  \"specialized\": true,\n");
    std::printf("  \"replay_turns\": %zu,\n", turnMs.size());
    std::printf("  \"won\": %s,\n", won ? "true" : "false");
    printJsonDouble("mean_ms_per_turn", meanMs, true);
    printJsonDouble("mean_ticks_per_turn_4096hz", ticksPerTurn4096, true);
    printJsonDouble("pct_le_50ms", percentileLe(turnMs, 50.0), true);
    printJsonDouble("pct_le_80ms", percentileLe(turnMs, 80.0), false);
    std::printf("}\n");
    return won ? 0 : 1;
}
