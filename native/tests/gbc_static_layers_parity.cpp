#include "generated_game.h"
#include "puzzlescript/compiler.h"
#include "puzzlescript/gbc.h"
#include "puzzlescript/puzzlescript.h"

#include <algorithm>
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
            const uint32_t cell =
                ps_gbc_cell_objects(gbc, static_cast<int16_t>(x), static_cast<int16_t>(y));
            for (int32_t object = 0; object < ps_gbc_generated_game.object_count; ++object) {
                const bool nativeHas = ps_full_state_cell_has_object(native, x, y, object);
                const bool gbcHas = (cell & (uint32_t{1} << object)) != 0U;
                if (nativeHas != gbcHas) {
                    std::cerr << "gbc_static_parity: " << phase << " differs at "
                              << x << "," << y << " object=" << object << "\n";
                    return false;
                }
            }
        }
    }
    return true;
}

} // namespace

int main() {
    if (ps_gbc_generated_game.layer_count != 7U
        || ps_gbc_generated_game.movement_layer_count != 1U
        || ps_gbc_generated_game.movement_bytes_per_cell != 1U
        || ps_gbc_generated_game.movement_collision_layers[0] != 6U) {
        std::cerr << "gbc_static_parity: generated compact layout is wrong\n";
        return 1;
    }

    const std::string source = readFile(
        std::filesystem::path(PS_REPO_ROOT)
        / "native" / "tests" / "fixtures" / "gbc_static_collision_layers.txt");
    ps_compile_result* compilation = nullptr;
    if (!ps_compile_source(source.data(), source.size(), &compilation)
        || compilation == nullptr) {
        std::cerr << "gbc_static_parity: native compilation failed\n";
        return 1;
    }
    ps_game* nativeGame =
        const_cast<ps_game*>(ps_compile_result_game(compilation));
    ps_free_compile_result(compilation);
    if (nativeGame == nullptr) {
        std::cerr << "gbc_static_parity: compiled game transfer failed\n";
        return 1;
    }

    ps_full_state* native = nullptr;
    ps_error* error = nullptr;
    if (!ps_full_state_create(nativeGame, &native, &error)
        || !ps_full_state_load_level(native, 0, &error)) {
        std::cerr << "gbc_static_parity: native session failed: "
                  << (error == nullptr ? "unknown" : ps_error_message(error)) << "\n";
        ps_free_error(error);
        if (native != nullptr) ps_full_state_destroy(native);
        ps_free_game(nativeGame);
        return 1;
    }

    std::vector<uint8_t> arena(std::max<size_t>(
        PS_GBC_GENERATED_SESSION_BYTES,
        ps_gbc_session_required_bytes(&ps_gbc_generated_game)));
    SnapshotMemory memory;
    memory.stride = static_cast<uint16_t>(
        ps_gbc_generated_game.max_level_cells
        * ps_gbc_generated_game.object_bytes_per_cell);
    memory.cells.resize(
        static_cast<size_t>(ps_gbc_generated_game.undo_capacity + 1U) * memory.stride);
    const ps_gbc_snapshot_io snapshots{
        &memory,
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

    const ps_step_result nativeResult = ps_full_state_turn(native, PS_INPUT_RIGHT);
    const ps_step_result gbcResult = ps_gbc_step(gbc, PS_INPUT_RIGHT);
    if (nativeResult.changed != gbcResult.changed
        || nativeResult.won != gbcResult.won
        || nativeResult.transitioned != gbcResult.transitioned
        || nativeResult.restarted != gbcResult.restarted
        || !boardsEqual(native, gbc, "right")) {
        std::cerr << "gbc_static_parity: compact movement turn differs\n";
        ps_full_state_destroy(native);
        ps_free_game(nativeGame);
        return 1;
    }

    // Dust1's impossible movement-present rule must not erase it, while
    // Dust2's stationary predicate must remain true and create Dust3.
    const uint32_t oldCell = ps_gbc_cell_objects(gbc, 0, 0);
    const uint32_t newCell = ps_gbc_cell_objects(gbc, 1, 0);
    if ((oldCell & (uint32_t{1} << 1U)) == 0U
        || (oldCell & (uint32_t{1} << 3U)) == 0U
        || (oldCell & (uint32_t{1} << 6U)) != 0U
        || (newCell & (uint32_t{1} << 6U)) == 0U) {
        std::cerr << "gbc_static_parity: dormant movement predicates were folded incorrectly\n";
        ps_full_state_destroy(native);
        ps_free_game(nativeGame);
        return 1;
    }

    if (ps_full_state_undo(native) != ps_gbc_undo(gbc)
        || !boardsEqual(native, gbc, "undo")) {
        std::cerr << "gbc_static_parity: undo differs\n";
        ps_full_state_destroy(native);
        ps_free_game(nativeGame);
        return 1;
    }
    ps_full_state_destroy(native);
    ps_free_game(nativeGame);
    return 0;
}
