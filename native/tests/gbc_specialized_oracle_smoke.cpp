#include "generated_game.h"
#include "puzzlescript/compiler.h"
#include "puzzlescript/gbc.h"
#include "puzzlescript/puzzlescript.h"

#include <algorithm>
#include <cstdint>
#include <cstdio>
#include <filesystem>
#include <fstream>
#include <sstream>
#include <string>
#include <vector>

#ifndef PS_REPO_ROOT
#error PS_REPO_ROOT is required
#endif

namespace {

std::string readFile(const std::filesystem::path& path) {
    std::ifstream input(path, std::ios::binary);
    std::ostringstream out;
    out << input.rdbuf();
    return out.str();
}

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
    if (token == "tick") {
        *out = PS_INPUT_TICK;
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
        ps_input parsed = PS_INPUT_TICK;
        if (!parseInputToken(line, &parsed)) {
            fprintf(stderr, "gbc_specialized_oracle_smoke: unknown replay token: %s\n", line.c_str());
            return {};
        }
        inputs.push_back(parsed);
    }
    return inputs;
}

bool boardsEqualNative(ps_full_state* native, ps_gbc_session* gbc, const char* phase) {
    ps_gbc_status status{};
    ps_gbc_status_get(gbc, &status);
    for (int32_t x = 0; x < status.width; ++x) {
        for (int32_t y = 0; y < status.height; ++y) {
            const uint32_t cell = ps_gbc_cell_objects(gbc, static_cast<int16_t>(x), static_cast<int16_t>(y));
            for (int32_t object = 0; object < ps_gbc_generated_game.object_count; ++object) {
                const bool nativeHas = ps_full_state_cell_has_object(native, x, y, object);
                const bool gbcHas = (cell & (uint32_t{1} << object)) != 0U;
                if (nativeHas != gbcHas) {
                    fprintf(
                        stderr,
                        "gbc_specialized_oracle_smoke: %s differs at %d,%d object=%d\n",
                        phase,
                        x,
                        y,
                        object);
                    return false;
                }
            }
        }
    }
    return true;
}

bool boardsEqualGbc(ps_gbc_session* left, ps_gbc_session* right, const char* phase) {
    ps_gbc_status leftStatus{};
    ps_gbc_status rightStatus{};
    ps_gbc_status_get(left, &leftStatus);
    ps_gbc_status_get(right, &rightStatus);
    if (leftStatus.width != rightStatus.width || leftStatus.height != rightStatus.height) {
        fprintf(stderr, "gbc_specialized_oracle_smoke: %s board size differs\n", phase);
        return false;
    }
    for (int32_t x = 0; x < leftStatus.width; ++x) {
        for (int32_t y = 0; y < leftStatus.height; ++y) {
            const uint32_t leftCell = ps_gbc_cell_objects(left, static_cast<int16_t>(x), static_cast<int16_t>(y));
            const uint32_t rightCell = ps_gbc_cell_objects(right, static_cast<int16_t>(x), static_cast<int16_t>(y));
            if (leftCell != rightCell) {
                fprintf(
                    stderr,
                    "gbc_specialized_oracle_smoke: %s gbc determinism differs at %d,%d\n",
                    phase,
                    x,
                    y);
                return false;
            }
        }
    }
    return true;
}

bool resultsEqual(const ps_step_result& left, const ps_step_result& right) {
    return left.changed == right.changed
        && left.won == right.won
        && left.transitioned == right.transitioned
        && left.restarted == right.restarted;
}

struct GbcSessionBundle {
    std::vector<uint8_t> arena;
    SnapshotMemory snapshotMemory;
    ps_gbc_snapshot_io snapshots{};
    ps_gbc_session* session = nullptr;
};

bool initGbcSession(GbcSessionBundle* bundle) {
    bundle->arena.resize(std::max<size_t>(
        PS_GBC_GENERATED_SESSION_BYTES,
        ps_gbc_session_required_bytes(&ps_gbc_generated_game)));
    bundle->snapshotMemory.stride = static_cast<uint16_t>(
        ps_gbc_generated_game.max_level_cells
        * ps_gbc_generated_game.object_bytes_per_cell);
    bundle->snapshotMemory.cells.resize(
        static_cast<size_t>(ps_gbc_generated_game.undo_capacity + 1U) * bundle->snapshotMemory.stride);
    bundle->snapshots.context = &bundle->snapshotMemory;
    bundle->snapshots.read = snapshotRead;
    bundle->snapshots.write = snapshotWrite;
    bundle->session = ps_gbc_session_init(
        bundle->arena.data(),
        bundle->arena.size(),
        &ps_gbc_generated_game,
        &bundle->snapshots);
    return bundle->session != nullptr;
}

} // namespace

int main() {
    const std::filesystem::path replayPath =
        std::filesystem::path(PS_REPO_ROOT)
        / "native"
        / "tests"
        / "fixtures"
        / "gbc_sokoban_basic_replay.txt";
    const std::vector<ps_input> inputs = loadReplay(replayPath);
    if (inputs.empty()) {
        fprintf(stderr, "gbc_specialized_oracle_smoke: replay fixture is empty or invalid\n");
        return 1;
    }

    const std::string source = readFile(
        std::filesystem::path(PS_REPO_ROOT) / "src" / "demo" / "sokoban_basic.txt");
    ps_compile_result* compilation = nullptr;
    ps_game* nativeGame = nullptr;
    ps_full_state* native = nullptr;
    ps_error* error = nullptr;
    if (!ps_compile_source(source.data(), source.size(), &compilation) || compilation == nullptr) {
        fprintf(stderr, "gbc_specialized_oracle_smoke: native compilation failed\n");
        return 1;
    }
    nativeGame = const_cast<ps_game*>(ps_compile_result_game(compilation));
    ps_free_compile_result(compilation);
    compilation = nullptr;
    if (nativeGame == nullptr) {
        fprintf(stderr, "gbc_specialized_oracle_smoke: compiled game transfer failed\n");
        return 1;
    }
    if (!ps_full_state_create(nativeGame, &native, &error)) {
        fprintf(
            stderr,
            "gbc_specialized_oracle_smoke: native session failed: %s\n",
            error == nullptr ? "unknown" : ps_error_message(error));
        ps_free_error(error);
        ps_free_game(nativeGame);
        return 1;
    }
    if (!ps_full_state_load_level(native, 0, &error)) {
        fprintf(
            stderr,
            "gbc_specialized_oracle_smoke: native level load failed: %s\n",
            error == nullptr ? "unknown" : ps_error_message(error));
        ps_free_error(error);
        ps_full_state_destroy(native);
        ps_free_game(nativeGame);
        return 1;
    }

    GbcSessionBundle gbcA{};
    GbcSessionBundle gbcB{};
    if (!initGbcSession(&gbcA) || !initGbcSession(&gbcB)) {
        fprintf(stderr, "gbc_specialized_oracle_smoke: gbc session init failed\n");
        ps_full_state_destroy(native);
        ps_free_game(nativeGame);
        return 1;
    }
    if (!boardsEqualNative(native, gbcA.session, "initial")
        || !boardsEqualGbc(gbcA.session, gbcB.session, "initial")) {
        ps_full_state_destroy(native);
        ps_free_game(nativeGame);
        return 1;
    }

    for (size_t index = 0; index < inputs.size(); ++index) {
        const ps_input input = inputs[index];
        const ps_step_result nativeResult = ps_full_state_turn(native, input);
        const ps_step_result gbcAResult = ps_gbc_step(gbcA.session, input);
        const ps_step_result gbcBResult = ps_gbc_step(gbcB.session, input);
        char phase[64];
        std::snprintf(phase, sizeof(phase), "step %zu", index);
        if (!resultsEqual(nativeResult, gbcAResult)) {
            fprintf(
                stderr,
                "gbc_specialized_oracle_smoke: native vs gbcA result flags differ at step %zu\n",
                index);
            ps_full_state_destroy(native);
            ps_free_game(nativeGame);
            return 1;
        }
        if (!resultsEqual(gbcAResult, gbcBResult)) {
            fprintf(
                stderr,
                "gbc_specialized_oracle_smoke: gbcA vs gbcB result flags differ at step %zu\n",
                index);
            ps_full_state_destroy(native);
            ps_free_game(nativeGame);
            return 1;
        }
        if (!boardsEqualNative(native, gbcA.session, phase)
            || !boardsEqualGbc(gbcA.session, gbcB.session, phase)) {
            ps_full_state_destroy(native);
            ps_free_game(nativeGame);
            return 1;
        }
    }

    ps_full_state_destroy(native);
    ps_free_game(nativeGame);
    printf("gbc_specialized_oracle_smoke: ok\n");
    return 0;
}
