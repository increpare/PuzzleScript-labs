#pragma once

#include "native_bridge/NativeGameBridge.h"
#include "search/difficulty.hpp"
#include <stdexcept>
#include <utility>

namespace nativebridge {

// Independent of editor textures and openFrameworks so the exact production
// candidate conversion and assessment path can also run in headless tests.
class CandidateSolverContext {
public:
    explicit CandidateSolverContext(std::unique_ptr<psbridge::NativeGameBridge> bridge)
        : bridge_(std::move(bridge)) {
        if (!bridge_) throw std::invalid_argument("Candidate solver needs a bridge");
    }
    psbridge::NativeGameBridge& bridge() const { return *bridge_; }
    const puzzlescript::LoadedGame& loadedGame() const { return bridge_->loadedGame(); }
    puzzlescript::LevelTemplate levelTemplateFromState(
        const std::vector<std::vector<std::vector<short>>>& state) const {
        const auto& loaded = loadedGame();
        if (!loaded.information || state.empty() || state[0].empty() || state[0][0].empty()) return {};
        const auto height = state[0].size(), width = state[0][0].size();
        if (state.size() != static_cast<size_t>(loaded.information->layerCount)) return {};
        std::vector<int32_t> nativeIds;
        for (size_t layer = 0; layer < state.size(); ++layer) {
            if (state[layer].size() != height) return {};
            for (const auto& row : state[layer]) {
                if (row.size() != width) return {};
                for (short displayId : row) {
                    const int32_t id = displayId <= 0 ? -1 : displayId - 1;
                    // Reject stale IDs and wrong layers instead of silently
                    // deleting objects and assessing a different candidate.
                    if (id >= loaded.information->objectCount || (id >= 0 &&
                        loaded.information->objectsById[id].layer != static_cast<int32_t>(layer))) return {};
                    nativeIds.push_back(id);
                }
            }
        }
        return puzzlescript::search::levelTemplateFromLayerCellObjectIds(
            *loaded.information, static_cast<int32_t>(width), static_cast<int32_t>(height), nativeIds);
    }
private:
    std::unique_ptr<psbridge::NativeGameBridge> bridge_;
};
} // namespace nativebridge
