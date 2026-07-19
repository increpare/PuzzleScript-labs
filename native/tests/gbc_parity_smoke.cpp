#include "generated_game.h"
#include "puzzlescript/compiler.h"
#include "puzzlescript/gbc.h"
#include "puzzlescript/puzzlescript.h"

#include <algorithm>
#include <array>
#include <cstdint>
#include <filesystem>
#include <fstream>
#include <iostream>
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

bool boardsEqual(ps_full_state* native, ps_gbc_session* gbc, const char* phase) {
    ps_gbc_status status{};
    ps_gbc_status_get(gbc, &status);
    for (int32_t x = 0; x < status.width; ++x) {
        for (int32_t y = 0; y < status.height; ++y) {
            const uint32_t cell = ps_gbc_cell_objects(gbc, static_cast<int16_t>(x), static_cast<int16_t>(y));
            for (int32_t object = 0; object < ps_gbc_generated_game.object_count; ++object) {
                const bool nativeHas = ps_full_state_cell_has_object(native, x, y, object);
                const bool gbcHas = (cell & (uint32_t{1} << object)) != 0U;
                if (nativeHas != gbcHas) {
                    std::cerr << "gbc_parity: " << phase << " differs at "
                              << x << "," << y << " object=" << object << "\n";
                    return false;
                }
            }
        }
    }
    return true;
}

bool resultsEqual(const ps_step_result& native, const ps_step_result& gbc) {
    return native.changed == gbc.changed
        && native.won == gbc.won
        && native.transitioned == gbc.transitioned
        && native.restarted == gbc.restarted;
}

} // namespace

int main() {
    const std::string source = readFile(
        std::filesystem::path(PS_REPO_ROOT) / "src" / "demo" / "sokoban_basic.txt");
    ps_compile_result* compilation = nullptr;
    ps_game* nativeGame = nullptr;
    ps_full_state* native = nullptr;
    ps_error* error = nullptr;
    if (!ps_compile_source(source.data(), source.size(), &compilation)
        || compilation == nullptr) {
        std::cerr << "gbc_parity: native compilation failed\n";
        return 1;
    }
    nativeGame = const_cast<ps_game*>(ps_compile_result_game(compilation));
    ps_free_compile_result(compilation);
    compilation = nullptr;
    if (nativeGame == nullptr) {
        std::cerr << "gbc_parity: compiled game transfer failed\n";
        return 1;
    }
    if (!ps_full_state_create(nativeGame, &native, &error)) {
        std::cerr << "gbc_parity: native session failed: "
                  << (error == nullptr ? "unknown" : ps_error_message(error)) << "\n";
        ps_free_error(error);
        ps_free_game(nativeGame);
        return 1;
    }
    if (!ps_full_state_load_level(native, 0, &error)) {
        std::cerr << "gbc_parity: native level load failed: "
                  << (error == nullptr ? "unknown" : ps_error_message(error)) << "\n";
        ps_free_error(error);
        ps_full_state_destroy(native);
        ps_free_game(nativeGame);
        return 1;
    }
    std::vector<uint8_t> arena(PS_GBC_GENERATED_SESSION_BYTES);
    SnapshotMemory snapshotMemory;
    snapshotMemory.stride = static_cast<uint16_t>(
        ps_gbc_generated_game.max_level_cells
        * ps_gbc_generated_game.object_bytes_per_cell);
    snapshotMemory.cells.resize(
        static_cast<size_t>(ps_gbc_generated_game.undo_capacity + 1U) * snapshotMemory.stride);
    const ps_gbc_snapshot_io snapshots{
        &snapshotMemory,
        snapshotRead,
        snapshotWrite,
    };
    ps_gbc_session* gbc = ps_gbc_session_init(
        arena.data(), arena.size(), &ps_gbc_generated_game, &snapshots);
    if (gbc == nullptr || !boardsEqual(native, gbc, "initial")) {
        ps_full_state_destroy(native);
        ps_free_game(nativeGame);
        return 1;
    }
    const std::array<ps_input, 12> inputs{
        PS_INPUT_RIGHT, PS_INPUT_RIGHT, PS_INPUT_UP, PS_INPUT_LEFT,
        PS_INPUT_DOWN, PS_INPUT_LEFT, PS_INPUT_UP, PS_INPUT_RIGHT,
        PS_INPUT_DOWN, PS_INPUT_RIGHT, PS_INPUT_UP, PS_INPUT_LEFT,
    };
    for (size_t index = 0; index < inputs.size(); ++index) {
        const ps_step_result nativeResult = ps_full_state_turn(native, inputs[index]);
        const ps_step_result gbcResult = ps_gbc_step(gbc, inputs[index]);
        if (!resultsEqual(nativeResult, gbcResult)
            || !boardsEqual(native, gbc, ("step " + std::to_string(index)).c_str())) {
            std::cerr << "gbc_parity: result flags differ at step " << index
                      << " native=" << nativeResult.changed << "/" << nativeResult.won
                      << "/" << nativeResult.transitioned << "/" << nativeResult.restarted
                      << " gbc=" << gbcResult.changed << "/" << gbcResult.won
                      << "/" << gbcResult.transitioned << "/" << gbcResult.restarted << "\n";
            ps_full_state_destroy(native);
            ps_free_game(nativeGame);
            return 1;
        }
    }
    if (ps_full_state_undo(native) != ps_gbc_undo(gbc)
        || !boardsEqual(native, gbc, "undo")) {
        std::cerr << "gbc_parity: undo differs\n";
        ps_full_state_destroy(native);
        ps_free_game(nativeGame);
        return 1;
    }
    ps_full_state_destroy(native);
    ps_free_game(nativeGame);
    return 0;
}
