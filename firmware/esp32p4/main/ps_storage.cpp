#include "ps_storage.hpp"

#include "probe_config.hpp"
#include "sdkconfig.h"
#include "soc/soc_caps.h"

#include <algorithm>
#include <cstdio>
#include <cstring>
#include <dirent.h>
#include <string>
#include <sys/stat.h>
#include <utility>

#include "driver/sdmmc_host.h"
#include "esp_vfs_fat.h"
#include "sd_pwr_ctrl_by_on_chip_ldo.h"
#include "sdmmc_cmd.h"

namespace ps_probe {
namespace {

sdmmc_card_t* g_card = nullptr;
bool g_mounted = false;

bool ends_with_txt(const char* name) {
    const std::string value(name == nullptr ? "" : name);
    return value.size() >= 4 && value.substr(value.size() - 4) == ".txt";
}

std::string join_game_path(const char* basename) {
    return std::string(kSdGamesDir) + "/" + basename;
}

bool is_regular_game_file(const dirent* entry) {
    if (entry == nullptr || !ends_with_txt(entry->d_name)) {
        return false;
    }
    if (entry->d_type == DT_REG) {
        return true;
    }
    if (entry->d_type != DT_UNKNOWN) {
        return false;
    }

    struct stat st {};
    const std::string path = join_game_path(entry->d_name);
    return stat(path.c_str(), &st) == 0 && S_ISREG(st.st_mode);
}

} // namespace

esp_err_t mount_sd_card() {
    if (g_mounted) {
        return ESP_OK;
    }

    esp_vfs_fat_sdmmc_mount_config_t mount_config = {};
    mount_config.format_if_mount_failed = false;
    mount_config.max_files = 5;
    mount_config.allocation_unit_size = 16 * 1024;

    sdmmc_host_t host = SDMMC_HOST_DEFAULT();
#if SOC_SDMMC_IO_POWER_EXTERNAL
    sd_pwr_ctrl_ldo_config_t ldo_config = {};
    ldo_config.ldo_chan_id = 4;
    sd_pwr_ctrl_handle_t pwr_ctrl_handle = nullptr;
    const esp_err_t ldo = sd_pwr_ctrl_new_on_chip_ldo(&ldo_config, &pwr_ctrl_handle);
    if (ldo == ESP_OK) {
        host.pwr_ctrl_handle = pwr_ctrl_handle;
    }
#endif

    sdmmc_slot_config_t slot_config = SDMMC_SLOT_CONFIG_DEFAULT();
    slot_config.width = 4;
#ifdef CONFIG_SOC_SDMMC_USE_GPIO_MATRIX
    slot_config.clk = 43;
    slot_config.cmd = 44;
    slot_config.d0 = 39;
    slot_config.d1 = 40;
    slot_config.d2 = 41;
    slot_config.d3 = 42;
#endif
    slot_config.flags |= SDMMC_SLOT_FLAG_INTERNAL_PULLUP;

    const esp_err_t result = esp_vfs_fat_sdmmc_mount(kSdMountPoint, &host, &slot_config, &mount_config, &g_card);
    g_mounted = result == ESP_OK;
#if SOC_SDMMC_IO_POWER_EXTERNAL
    if (result != ESP_OK && pwr_ctrl_handle != nullptr) {
        sd_pwr_ctrl_del_on_chip_ldo(pwr_ctrl_handle);
    }
#endif
    return result;
}

std::vector<std::string> list_sd_games() {
    std::vector<std::string> names;
    DIR* dir = opendir(kSdGamesDir);
    if (dir == nullptr) {
        return names;
    }
    while (dirent* entry = readdir(dir)) {
        if (is_regular_game_file(entry)) {
            names.emplace_back(entry->d_name);
        }
    }
    closedir(dir);
    std::sort(names.begin(), names.end());
    return names;
}

esp_err_t read_text_file(const std::string& path, LoadedSource& out_source) {
    struct stat st {};
    if (stat(path.c_str(), &st) != 0) {
        return ESP_ERR_NOT_FOUND;
    }
    if (!S_ISREG(st.st_mode)) {
        return ESP_ERR_INVALID_ARG;
    }
    if (st.st_size <= 0 || static_cast<std::size_t>(st.st_size) > kMaxSourceBytes) {
        return ESP_ERR_INVALID_SIZE;
    }

    FILE* file = fopen(path.c_str(), "rb");
    if (file == nullptr) {
        return ESP_FAIL;
    }
    std::string text;
    text.resize(static_cast<std::size_t>(st.st_size));
    const std::size_t read = fread(text.data(), 1, text.size(), file);
    fclose(file);
    if (read != text.size()) {
        return ESP_FAIL;
    }

    out_source.name = path;
    out_source.text = std::move(text);
    return ESP_OK;
}

esp_err_t load_first_sd_game(LoadedSource& out_source) {
    const auto games = list_sd_games();
    if (games.empty()) {
        return ESP_ERR_NOT_FOUND;
    }
    return read_text_file(join_game_path(games.front().c_str()), out_source);
}

esp_err_t load_named_sd_game(const char* basename, LoadedSource& out_source) {
    if (basename == nullptr || std::strchr(basename, '/') != nullptr) {
        return ESP_ERR_INVALID_ARG;
    }
    return read_text_file(join_game_path(basename), out_source);
}

} // namespace ps_probe
