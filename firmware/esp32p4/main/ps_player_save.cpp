#include "ps_player_save.hpp"

#include <functional>

#include "esp_err.h"
#include "nvs.h"
#include "nvs_flash.h"

namespace ps_probe {
namespace {

constexpr const char* kSaveNamespace = "ps_player";

std::string save_nvs_key(const std::string& save_key) {
    const std::size_t hash = std::hash<std::string>{}(save_key);
    return "save_" + std::to_string(static_cast<unsigned long long>(hash));
}

} // namespace

void player_save_refresh(const std::string& save_key, int level_count, PlayerSaveState& out_state) {
    out_state.has_save = false;
    out_state.saved_level = 0;
    out_state.title_selection = 0;

    nvs_handle_t handle = 0;
    if (nvs_open(kSaveNamespace, NVS_READONLY, &handle) != ESP_OK) {
        return;
    }

    int32_t level = 0;
    const esp_err_t err = nvs_get_i32(handle, save_nvs_key(save_key).c_str(), &level);
    nvs_close(handle);
    if (err != ESP_OK || level <= 0 || level >= level_count) {
        return;
    }

    out_state.has_save = true;
    out_state.saved_level = static_cast<int>(level);
    out_state.title_selection = 1;
}

void player_save_write(const std::string& save_key, int level_index) {
    nvs_handle_t handle = 0;
    if (nvs_open(kSaveNamespace, NVS_READWRITE, &handle) != ESP_OK) {
        return;
    }
    (void)nvs_set_i32(handle, save_nvs_key(save_key).c_str(), static_cast<int32_t>(level_index));
    (void)nvs_commit(handle);
    nvs_close(handle);
}

void player_save_clear(const std::string& save_key) {
    nvs_handle_t handle = 0;
    if (nvs_open(kSaveNamespace, NVS_READWRITE, &handle) != ESP_OK) {
        return;
    }
    (void)nvs_erase_key(handle, save_nvs_key(save_key).c_str());
    (void)nvs_commit(handle);
    nvs_close(handle);
}

} // namespace ps_probe
