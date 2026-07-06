# PuzzleScript ESP32-P4 Board Probe Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first ESP32-P4 firmware slice for the ordered Waveshare 7-inch board: boot, display diagnostics, structured heap logs, SD game loading, and one rendered PuzzleScript board frame.

**Architecture:** Add a self-contained ESP-IDF project under `firmware/esp32p4/`. Reuse existing native PuzzleScript C APIs and host-tested handheld display layout code where practical, but keep board glue, instrumentation, storage, and framebuffer rendering in small firmware files. The firmware emits serial JSON-lines so board runs can be compared to host memory audits.

**Tech Stack:** ESP-IDF for `esp32p4`, C++17, ESP-IDF heap APIs, ESP LCD/MIPI DSI EK79007 driver, SDMMC/FAT VFS, existing native PuzzleScript compiler/runtime C API, existing `native/src/handheld/display_layout` logic.

---

## Scope Check

This plan implements the first board-probe firmware from `docs/superpowers/specs/2026-07-06-puzzlescript-handheld-track1-devkit-design.md`. It covers:

- repo-owned ESP-IDF project scaffold
- serial boot and phase instrumentation
- native 1024x600 and centered 800x480 display diagnostics
- FAT TF-card mount and `/sdcard/games` source scan
- built-in `sokoban_basic` compile, runtime creation, level load, and frame render
- broken-source diagnostics
- optional SD-card game probe, including `at-the-hedges-of-time.txt` when present

This plan does not implement physical button wiring, audio, haptics, LEDs, USB mass storage, battery measurement, library UI, or final PCB work. Those are separate Track 1 plans after this firmware proves board/display/heap/runtime truth.

## Source References

Use these official references while executing:

- Waveshare board docs: `https://docs.waveshare.com/ESP32-P4-WIFI6-Touch-LCD-7B`
- Waveshare product page: `https://www.waveshare.com/esp32-p4-wifi6-touch-lcd-7b.htm`
- Waveshare demo repo: `https://github.com/waveshareteam/ESP32-P4-WIFI6-Touch-LCD-7B`
- Clean display reference: `examples/ESP-IDF/07_color_panel/main/test_esp_lcd_ek79007.c` in the Waveshare demo repo
- SD reference: `examples/ESP-IDF/04_sdmmc/main/sd_card_example_main.c` and `main/Kconfig.projbuild` in the Waveshare demo repo
- ESP32-P4 product page: `https://www.espressif.com/en/products/socs/esp32-p4`
- ESP-IDF heap debugging: `https://docs.espressif.com/projects/esp-idf/en/latest/esp32p4/api-reference/system/heap_debug.html`
- ESP-IDF heap allocation: `https://docs.espressif.com/projects/esp-idf/en/latest/esp32p4/api-reference/system/mem_alloc.html`

## File Structure

- Create `firmware/esp32p4/CMakeLists.txt`
  - ESP-IDF project root.
- Create `firmware/esp32p4/sdkconfig.defaults`
  - ESP32-P4, 32 MB flash, PSRAM, C++ exceptions, performance build, and 1000 Hz tick defaults.
- Create `firmware/esp32p4/partitions.csv`
  - Simple 32 MB flash partition table with room for app and NVS.
- Create `firmware/esp32p4/main/CMakeLists.txt`
  - Main component registration, embedded sources, native PuzzleScript source list, and include paths.
- Create `firmware/esp32p4/main/idf_component.yml`
  - ESP-IDF component dependencies for EK79007 display driver.
- Create `firmware/esp32p4/main/probe_config.hpp`
  - Central constants for panel, target viewport, SD mount, and source-size caps.
- Create `firmware/esp32p4/main/ps_instrumentation.hpp`
  - Phase names, phase timer, framebuffer policy data, and instrumentation API.
- Create `firmware/esp32p4/main/ps_instrumentation.cpp`
  - JSON-lines serial logging using ESP-IDF heap APIs.
- Create `firmware/esp32p4/main/board_waveshare_7b.hpp`
  - Board display API.
- Create `firmware/esp32p4/main/board_waveshare_7b.cpp`
  - EK79007 MIPI DSI init and bitmap drawing, adapted from Waveshare's Apache-2.0 color-panel example.
- Create `firmware/esp32p4/main/ps_framebuffer.hpp`
  - RGB565 framebuffer helpers and display diagnostic API.
- Create `firmware/esp32p4/main/ps_framebuffer.cpp`
  - Native and target display diagnostic drawing.
- Create `firmware/esp32p4/main/ps_storage.hpp`
  - SD mount and source-loading API.
- Create `firmware/esp32p4/main/ps_storage.cpp`
  - SDMMC mount, `/sdcard/games` scan, and bounded text-file reads.
- Create `firmware/esp32p4/main/ps_renderer.hpp`
  - PuzzleScript framebuffer renderer API.
- Create `firmware/esp32p4/main/ps_renderer.cpp`
  - Minimal RGB565 board renderer using the public native C API.
- Create `firmware/esp32p4/main/ps_probe_runtime.hpp`
  - Probe orchestration API for source compile/load/render runs.
- Create `firmware/esp32p4/main/ps_probe_runtime.cpp`
  - Built-in, broken-source, and SD-source PuzzleScript probes with phase logs.
- Create `firmware/esp32p4/main/main.cpp`
  - Boot flow and probe sequencing.
- Create `firmware/esp32p4/main/embedded_games/broken_smoke.txt`
  - Intentional compile failure fixture.
- Modify `Makefile`
  - Add `handheld_p4_probe_build`, `handheld_p4_probe_flash`, and `handheld_p4_probe_monitor`.
- Create `docs/superpowers/notes/2026-07-06-esp32p4-board-probe-usage.md`
  - How to build, flash, prepare SD, capture logs, and interpret first results.

## Task 1: ESP-IDF Project Scaffold

**Files:**
- Create: `firmware/esp32p4/CMakeLists.txt`
- Create: `firmware/esp32p4/sdkconfig.defaults`
- Create: `firmware/esp32p4/partitions.csv`
- Create: `firmware/esp32p4/main/CMakeLists.txt`
- Create: `firmware/esp32p4/main/idf_component.yml`
- Create: `firmware/esp32p4/main/probe_config.hpp`
- Create: `firmware/esp32p4/main/main.cpp`

- [ ] **Step 1: Run the scaffold build before files exist**

Run:

```bash
cd firmware/esp32p4
idf.py set-target esp32p4 build
```

Expected: command fails because `firmware/esp32p4` does not exist. If `idf.py` is missing, install or activate ESP-IDF before continuing.

- [ ] **Step 2: Create the ESP-IDF root files**

Create `firmware/esp32p4/CMakeLists.txt`:

```cmake
cmake_minimum_required(VERSION 3.20)

include($ENV{IDF_PATH}/tools/cmake/project.cmake)
project(puzzlescript_esp32p4_probe)
```

Create `firmware/esp32p4/partitions.csv`:

```csv
# Name,   Type, SubType, Offset,  Size, Flags
nvs,      data, nvs,     0x9000,  0x6000,
phy_init, data, phy,     0xf000,  0x1000,
factory,  app,  factory, 0x10000, 0x700000,
storage,  data, fat,             , 0x800000,
```

Create `firmware/esp32p4/sdkconfig.defaults`:

```text
CONFIG_IDF_TARGET="esp32p4"
CONFIG_ESP32P4_SELECTS_REV_LESS_V3=y
CONFIG_ESP32P4_REV_MIN_1=y
CONFIG_ESPTOOLPY_FLASHMODE_QIO=y
CONFIG_ESPTOOLPY_FLASHSIZE_32MB=y
CONFIG_PARTITION_TABLE_CUSTOM=y
CONFIG_PARTITION_TABLE_CUSTOM_FILENAME="partitions.csv"
CONFIG_COMPILER_OPTIMIZATION_PERF=y
CONFIG_COMPILER_CXX_EXCEPTIONS=y
CONFIG_COMPILER_CXX_RTTI=y
CONFIG_COMPILER_ORPHAN_SECTIONS_PLACE=y
CONFIG_SPIRAM=y
CONFIG_SPIRAM_SPEED_200M=y
CONFIG_SPIRAM_USE_MALLOC=y
CONFIG_SPIRAM_MALLOC_ALWAYSINTERNAL=16384
CONFIG_CACHE_L2_CACHE_256KB=y
CONFIG_CACHE_L2_CACHE_LINE_128B=y
CONFIG_ESP_MAIN_TASK_STACK_SIZE=16384
CONFIG_FREERTOS_HZ=1000
CONFIG_FREERTOS_VTASKLIST_INCLUDE_COREID=y
CONFIG_FREERTOS_GENERATE_RUN_TIME_STATS=y
CONFIG_FATFS_VFS_FSTAT_BLKSIZE=4096
CONFIG_IDF_EXPERIMENTAL_FEATURES=y
```

Create `firmware/esp32p4/main/idf_component.yml`:

```yaml
version: 0.1.0
targets:
  - esp32p4
dependencies:
  idf: ">=5.3"
  espressif/esp_lcd_ek79007: "*"
```

- [ ] **Step 3: Add the main component skeleton**

Create `firmware/esp32p4/main/CMakeLists.txt`:

```cmake
idf_component_register(
  SRCS
    "main.cpp"
  INCLUDE_DIRS
    "."
)

target_compile_features(${COMPONENT_LIB} PRIVATE cxx_std_17)
target_compile_options(${COMPONENT_LIB} PRIVATE
  -Wall
  -Wextra
  -Wno-missing-field-initializers
)
```

Create `firmware/esp32p4/main/probe_config.hpp`:

```cpp
#pragma once

#include <cstddef>
#include <cstdint>

namespace ps_probe {

inline constexpr int kNativeWidth = 1024;
inline constexpr int kNativeHeight = 600;
inline constexpr int kTargetWidth = 800;
inline constexpr int kTargetHeight = 480;
inline constexpr int kRgb565BytesPerPixel = 2;
inline constexpr std::size_t kNativeFramebufferBytes =
    static_cast<std::size_t>(kNativeWidth) * kNativeHeight * kRgb565BytesPerPixel;
inline constexpr std::size_t kTargetFramebufferBytes =
    static_cast<std::size_t>(kTargetWidth) * kTargetHeight * kRgb565BytesPerPixel;
inline constexpr const char* kSdMountPoint = "/sdcard";
inline constexpr const char* kSdGamesDir = "/sdcard/games";
inline constexpr std::size_t kMaxSourceBytes = 1024 * 1024;

} // namespace ps_probe
```

Create `firmware/esp32p4/main/main.cpp`:

```cpp
#include "esp_log.h"
#include "esp_system.h"
#include "esp_chip_info.h"
#include "esp_flash.h"
#include "probe_config.hpp"

namespace {
constexpr const char* kTag = "ps_probe";

void log_boot_probe() {
    esp_chip_info_t chip{};
    esp_chip_info(&chip);
    uint32_t flash_size = 0;
    esp_flash_get_size(nullptr, &flash_size);
    ESP_LOGI(kTag,
             "{\"event\":\"boot\",\"cores\":%d,\"revision\":%d,\"flash_bytes\":%" PRIu32 ",\"target_width\":%d,\"target_height\":%d}",
             chip.cores,
             chip.revision,
             flash_size,
             ps_probe::kTargetWidth,
             ps_probe::kTargetHeight);
}
} // namespace

extern "C" void app_main(void) {
    log_boot_probe();
    ESP_LOGI(kTag, "{\"event\":\"probe_stub\",\"status\":\"ok\"}");
}
```

- [ ] **Step 4: Fix the missing include from the skeleton**

Add this include to `firmware/esp32p4/main/main.cpp` because the `PRIu32` macro comes from `<cinttypes>`:

```cpp
#include <cinttypes>
```

- [ ] **Step 5: Build the scaffold**

Run:

```bash
cd firmware/esp32p4
idf.py set-target esp32p4 build
```

Expected: build completes and produces `firmware/esp32p4/build/puzzlescript_esp32p4_probe.bin`.

- [ ] **Step 6: Commit the scaffold**

```bash
git add firmware/esp32p4/CMakeLists.txt firmware/esp32p4/sdkconfig.defaults firmware/esp32p4/partitions.csv firmware/esp32p4/main/CMakeLists.txt firmware/esp32p4/main/idf_component.yml firmware/esp32p4/main/probe_config.hpp firmware/esp32p4/main/main.cpp
git commit -m "firmware: scaffold ESP32-P4 probe app"
```

## Task 2: Structured Heap Instrumentation

**Files:**
- Create: `firmware/esp32p4/main/ps_instrumentation.hpp`
- Create: `firmware/esp32p4/main/ps_instrumentation.cpp`
- Modify: `firmware/esp32p4/main/CMakeLists.txt`
- Modify: `firmware/esp32p4/main/main.cpp`

- [ ] **Step 1: Add instrumentation to the component build**

Modify `firmware/esp32p4/main/CMakeLists.txt` so `SRCS` includes:

```cmake
    "ps_instrumentation.cpp"
```

- [ ] **Step 2: Add the instrumentation header**

Create `firmware/esp32p4/main/ps_instrumentation.hpp`:

```cpp
#pragma once

#include <cstdint>

namespace ps_probe {

enum class Phase : uint8_t {
    Boot,
    DisplayInit,
    StorageInit,
    LoadSourceFlash,
    CompileSource,
    CreateRuntime,
    LoadLevel,
    RenderFrame,
    RunInputTrace,
    UnloadGame,
    LoadSourceSd,
};

struct FramebufferPolicy {
    const char* mode;
    int width;
    int height;
    int buffer_count;
    int bytes_per_pixel;
};

class PhaseTimer {
public:
    explicit PhaseTimer(Phase phase);
    int64_t elapsed_ms() const;
private:
    Phase phase_;
    int64_t start_us_;
};

const char* phase_name(Phase phase);
void instrumentation_init();
void set_active_phase(Phase phase);
void set_framebuffer_policy(const FramebufferPolicy& policy);
void emit_phase_result(Phase phase, const char* status, const char* detail, int64_t elapsed_ms);
void emit_boot_summary();

} // namespace ps_probe
```

- [ ] **Step 3: Add the instrumentation implementation**

Create `firmware/esp32p4/main/ps_instrumentation.cpp`:

```cpp
#include "ps_instrumentation.hpp"

#include <cinttypes>
#include "esp_heap_caps.h"
#include "esp_log.h"
#include "esp_timer.h"
#include "esp_system.h"
#include "esp_chip_info.h"
#include "esp_flash.h"

namespace ps_probe {
namespace {

constexpr const char* kTag = "ps_probe";
Phase g_active_phase = Phase::Boot;
FramebufferPolicy g_framebuffer_policy{"none", 0, 0, 0, 2};

void append_heap(const char* name, uint32_t caps) {
    multi_heap_info_t info{};
    heap_caps_get_info(&info, caps);
    ESP_LOGI(kTag,
             "{\"event\":\"heap\",\"phase\":\"%s\",\"region\":\"%s\",\"free\":%zu,\"allocated\":%zu,\"largest_free_block\":%zu,\"minimum_free\":%zu,\"allocated_blocks\":%zu,\"free_blocks\":%zu,\"total_blocks\":%zu}",
             phase_name(g_active_phase),
             name,
             info.total_free_bytes,
             info.total_allocated_bytes,
             info.largest_free_block,
             info.minimum_free_bytes,
             info.allocated_blocks,
             info.free_blocks,
             info.total_blocks);
}

void alloc_failed_hook(size_t requested_size, uint32_t caps, const char* function_name) {
    ESP_EARLY_LOGE(kTag,
                   "{\"event\":\"alloc_failed\",\"phase\":\"%s\",\"requested\":%zu,\"caps\":%" PRIu32 ",\"function\":\"%s\"}",
                   phase_name(g_active_phase),
                   requested_size,
                   caps,
                   function_name == nullptr ? "" : function_name);
}

} // namespace

PhaseTimer::PhaseTimer(Phase phase) : phase_(phase), start_us_(esp_timer_get_time()) {
    set_active_phase(phase_);
}

int64_t PhaseTimer::elapsed_ms() const {
    return (esp_timer_get_time() - start_us_) / 1000;
}

const char* phase_name(Phase phase) {
    switch (phase) {
        case Phase::Boot: return "BOOT";
        case Phase::DisplayInit: return "DISPLAY_INIT";
        case Phase::StorageInit: return "STORAGE_INIT";
        case Phase::LoadSourceFlash: return "LOAD_SOURCE_FLASH";
        case Phase::CompileSource: return "COMPILE_SOURCE";
        case Phase::CreateRuntime: return "CREATE_RUNTIME";
        case Phase::LoadLevel: return "LOAD_LEVEL";
        case Phase::RenderFrame: return "RENDER_FRAME";
        case Phase::RunInputTrace: return "RUN_INPUT_TRACE";
        case Phase::UnloadGame: return "UNLOAD_GAME";
        case Phase::LoadSourceSd: return "LOAD_SOURCE_SD";
    }
    return "UNKNOWN";
}

void instrumentation_init() {
    heap_caps_register_failed_alloc_callback(alloc_failed_hook);
}

void set_active_phase(Phase phase) {
    g_active_phase = phase;
}

void set_framebuffer_policy(const FramebufferPolicy& policy) {
    g_framebuffer_policy = policy;
}

void emit_phase_result(Phase phase, const char* status, const char* detail, int64_t elapsed_ms) {
    set_active_phase(phase);
    ESP_LOGI(kTag,
             "{\"event\":\"phase\",\"phase\":\"%s\",\"status\":\"%s\",\"detail\":\"%s\",\"elapsed_ms\":%" PRId64 ",\"fb_mode\":\"%s\",\"fb_width\":%d,\"fb_height\":%d,\"fb_count\":%d,\"fb_bpp\":%d}",
             phase_name(phase),
             status == nullptr ? "" : status,
             detail == nullptr ? "" : detail,
             elapsed_ms,
             g_framebuffer_policy.mode == nullptr ? "" : g_framebuffer_policy.mode,
             g_framebuffer_policy.width,
             g_framebuffer_policy.height,
             g_framebuffer_policy.buffer_count,
             g_framebuffer_policy.bytes_per_pixel);
    append_heap("internal", MALLOC_CAP_INTERNAL);
    append_heap("spiram", MALLOC_CAP_SPIRAM);
    append_heap("8bit", MALLOC_CAP_8BIT);
}

void emit_boot_summary() {
    esp_chip_info_t chip{};
    esp_chip_info(&chip);
    uint32_t flash_size = 0;
    esp_flash_get_size(nullptr, &flash_size);
    ESP_LOGI(kTag,
             "{\"event\":\"boot\",\"cores\":%d,\"revision\":%d,\"flash_bytes\":%" PRIu32 ",\"idf\":\"%s\",\"reset_reason\":%d}",
             chip.cores,
             chip.revision,
             flash_size,
             esp_get_idf_version(),
             static_cast<int>(esp_reset_reason()));
}

} // namespace ps_probe
```

- [ ] **Step 4: Wire instrumentation into boot**

Replace `firmware/esp32p4/main/main.cpp` with:

```cpp
#include "ps_instrumentation.hpp"

using ps_probe::Phase;
using ps_probe::PhaseTimer;

extern "C" void app_main(void) {
    ps_probe::instrumentation_init();
    PhaseTimer boot(Phase::Boot);
    ps_probe::emit_boot_summary();
    ps_probe::emit_phase_result(Phase::Boot, "pass", "boot_summary", boot.elapsed_ms());
}
```

- [ ] **Step 5: Build instrumentation**

Run:

```bash
cd firmware/esp32p4
idf.py build
```

Expected: build succeeds. After flashing, serial output contains one `event:"boot"` line and at least three `event:"heap"` lines for `internal`, `spiram`, and `8bit`.

- [ ] **Step 6: Commit instrumentation**

```bash
git add firmware/esp32p4/main/CMakeLists.txt firmware/esp32p4/main/main.cpp firmware/esp32p4/main/ps_instrumentation.hpp firmware/esp32p4/main/ps_instrumentation.cpp
git commit -m "firmware: add ESP32-P4 heap phase logging"
```

## Task 3: Waveshare EK79007 Display Bring-up

**Files:**
- Create: `firmware/esp32p4/main/board_waveshare_7b.hpp`
- Create: `firmware/esp32p4/main/board_waveshare_7b.cpp`
- Modify: `firmware/esp32p4/main/CMakeLists.txt`
- Modify: `firmware/esp32p4/main/main.cpp`

- [ ] **Step 1: Add board display source to the build**

Modify `firmware/esp32p4/main/CMakeLists.txt` so `SRCS` includes:

```cmake
    "board_waveshare_7b.cpp"
```

- [ ] **Step 2: Add the board display header**

Create `firmware/esp32p4/main/board_waveshare_7b.hpp`:

```cpp
#pragma once

#include <cstdint>
#include "esp_err.h"

namespace ps_probe::board {

esp_err_t init_display();
esp_err_t show_hardware_pattern();
esp_err_t clear_hardware_pattern();
esp_err_t draw_rgb565(const uint16_t* pixels, int x0, int y0, int width, int height);

} // namespace ps_probe::board
```

- [ ] **Step 3: Add EK79007 display initialization**

Create `firmware/esp32p4/main/board_waveshare_7b.cpp`:

```cpp
#include "board_waveshare_7b.hpp"

#include "probe_config.hpp"
#include "esp_check.h"
#include "esp_lcd_ek79007.h"
#include "esp_lcd_mipi_dsi.h"
#include "esp_lcd_panel_ops.h"
#include "esp_ldo_regulator.h"
#include "esp_log.h"

namespace ps_probe::board {
namespace {

constexpr const char* kTag = "board_7b";
constexpr int kPanelResetGpio = 33;
constexpr int kMipiDsiLaneCount = 2;
constexpr int kMipiPhyLdoChannel = 3;
constexpr int kMipiPhyLdoVoltageMv = 2500;

esp_ldo_channel_handle_t g_mipi_ldo = nullptr;
esp_lcd_dsi_bus_handle_t g_dsi_bus = nullptr;
esp_lcd_panel_io_handle_t g_dbi_io = nullptr;
esp_lcd_panel_handle_t g_panel = nullptr;

} // namespace

esp_err_t init_display() {
    if (g_panel != nullptr) {
        return ESP_OK;
    }

    ESP_LOGI(kTag, "Enable MIPI DSI PHY LDO");
    esp_ldo_channel_config_t ldo_config = {
        .chan_id = kMipiPhyLdoChannel,
        .voltage_mv = kMipiPhyLdoVoltageMv,
    };
    ESP_RETURN_ON_ERROR(esp_ldo_acquire_channel(&ldo_config, &g_mipi_ldo), kTag, "ldo");

    ESP_LOGI(kTag, "Create MIPI DSI bus");
    esp_lcd_dsi_bus_config_t bus_config = EK79007_PANEL_BUS_DSI_2CH_CONFIG();
    ESP_RETURN_ON_ERROR(esp_lcd_new_dsi_bus(&bus_config, &g_dsi_bus), kTag, "dsi_bus");

    ESP_LOGI(kTag, "Create DBI panel IO");
    esp_lcd_dbi_io_config_t dbi_config = EK79007_PANEL_IO_DBI_CONFIG();
    ESP_RETURN_ON_ERROR(esp_lcd_new_panel_io_dbi(g_dsi_bus, &dbi_config, &g_dbi_io), kTag, "dbi_io");

    ESP_LOGI(kTag, "Create EK79007 panel");
    esp_lcd_dpi_panel_config_t dpi_config = EK79007_1024_600_PANEL_60HZ_CONFIG(LCD_COLOR_PIXEL_FORMAT_RGB565);
    ek79007_vendor_config_t vendor_config = {
        .mipi_config = {
            .dsi_bus = g_dsi_bus,
            .dpi_config = &dpi_config,
            .lane_num = kMipiDsiLaneCount,
        },
    };
    const esp_lcd_panel_dev_config_t panel_config = {
        .reset_gpio_num = kPanelResetGpio,
        .rgb_ele_order = LCD_RGB_ELEMENT_ORDER_RGB,
        .bits_per_pixel = 16,
        .vendor_config = &vendor_config,
    };
    ESP_RETURN_ON_ERROR(esp_lcd_new_panel_ek79007(g_dbi_io, &panel_config, &g_panel), kTag, "panel");
    ESP_RETURN_ON_ERROR(esp_lcd_panel_reset(g_panel), kTag, "panel_reset");
    ESP_RETURN_ON_ERROR(esp_lcd_panel_init(g_panel), kTag, "panel_init");
    ESP_RETURN_ON_ERROR(esp_lcd_panel_disp_on_off(g_panel, true), kTag, "panel_on");
    return ESP_OK;
}

esp_err_t show_hardware_pattern() {
    if (g_panel == nullptr) {
        return ESP_ERR_INVALID_STATE;
    }
    return esp_lcd_dpi_panel_set_pattern(g_panel, MIPI_DSI_PATTERN_BAR_VERTICAL);
}

esp_err_t clear_hardware_pattern() {
    if (g_panel == nullptr) {
        return ESP_ERR_INVALID_STATE;
    }
    return esp_lcd_dpi_panel_set_pattern(g_panel, MIPI_DSI_PATTERN_NONE);
}

esp_err_t draw_rgb565(const uint16_t* pixels, int x0, int y0, int width, int height) {
    if (g_panel == nullptr || pixels == nullptr || width <= 0 || height <= 0) {
        return ESP_ERR_INVALID_ARG;
    }
    return esp_lcd_panel_draw_bitmap(g_panel, x0, y0, x0 + width, y0 + height, pixels);
}

} // namespace ps_probe::board
```

- [ ] **Step 4: Run display init during boot**

Modify `firmware/esp32p4/main/main.cpp`:

```cpp
#include "board_waveshare_7b.hpp"
#include "ps_instrumentation.hpp"

#include "esp_err.h"

using ps_probe::Phase;
using ps_probe::PhaseTimer;

extern "C" void app_main(void) {
    ps_probe::instrumentation_init();

    {
        PhaseTimer boot(Phase::Boot);
        ps_probe::emit_boot_summary();
        ps_probe::emit_phase_result(Phase::Boot, "pass", "boot_summary", boot.elapsed_ms());
    }

    {
        PhaseTimer display(Phase::DisplayInit);
        const esp_err_t init = ps_probe::board::init_display();
        if (init == ESP_OK) {
            ps_probe::board::show_hardware_pattern();
            ps_probe::emit_phase_result(Phase::DisplayInit, "pass", "hardware_pattern", display.elapsed_ms());
        } else {
            ps_probe::emit_phase_result(Phase::DisplayInit, "fail", esp_err_to_name(init), display.elapsed_ms());
        }
    }
}
```

- [ ] **Step 5: Build and flash display probe**

Run:

```bash
cd firmware/esp32p4
idf.py build
idf.py -p "$ESP32P4_PORT" flash monitor
```

Expected: build succeeds, flash succeeds, and the board shows a vertical color-bar hardware pattern. Serial logs include `DISPLAY_INIT` with status `pass`.

- [ ] **Step 6: Commit display bring-up**

```bash
git add firmware/esp32p4/main/CMakeLists.txt firmware/esp32p4/main/main.cpp firmware/esp32p4/main/board_waveshare_7b.hpp firmware/esp32p4/main/board_waveshare_7b.cpp
git commit -m "firmware: bring up Waveshare 7B display"
```

## Task 4: RGB565 Framebuffer Diagnostics

**Files:**
- Create: `firmware/esp32p4/main/ps_framebuffer.hpp`
- Create: `firmware/esp32p4/main/ps_framebuffer.cpp`
- Modify: `firmware/esp32p4/main/CMakeLists.txt`
- Modify: `firmware/esp32p4/main/main.cpp`

- [ ] **Step 1: Add framebuffer source to the build**

Modify `firmware/esp32p4/main/CMakeLists.txt` so `SRCS` includes:

```cmake
    "ps_framebuffer.cpp"
```

- [ ] **Step 2: Add framebuffer helpers**

Create `firmware/esp32p4/main/ps_framebuffer.hpp`:

```cpp
#pragma once

#include <cstddef>
#include <cstdint>

namespace ps_probe {

uint16_t rgb565(uint8_t r, uint8_t g, uint8_t b);
void fill_native_diagnostic(uint16_t* pixels, std::size_t pixel_count);
void fill_target_800x480_diagnostic(uint16_t* pixels, std::size_t pixel_count);

} // namespace ps_probe
```

Create `firmware/esp32p4/main/ps_framebuffer.cpp`:

```cpp
#include "ps_framebuffer.hpp"

#include "probe_config.hpp"

namespace ps_probe {

uint16_t rgb565(uint8_t r, uint8_t g, uint8_t b) {
    return static_cast<uint16_t>(((r & 0xF8) << 8) | ((g & 0xFC) << 3) | (b >> 3));
}

void fill_native_diagnostic(uint16_t* pixels, std::size_t pixel_count) {
    if (pixels == nullptr || pixel_count < static_cast<std::size_t>(kNativeWidth) * kNativeHeight) {
        return;
    }
    for (int y = 0; y < kNativeHeight; ++y) {
        for (int x = 0; x < kNativeWidth; ++x) {
            const bool left = x < kNativeWidth / 3;
            const bool middle = x >= kNativeWidth / 3 && x < (2 * kNativeWidth) / 3;
            pixels[y * kNativeWidth + x] = left
                ? rgb565(220, 32, 48)
                : (middle ? rgb565(32, 180, 96) : rgb565(40, 96, 220));
        }
    }
}

void fill_target_800x480_diagnostic(uint16_t* pixels, std::size_t pixel_count) {
    if (pixels == nullptr || pixel_count < static_cast<std::size_t>(kNativeWidth) * kNativeHeight) {
        return;
    }

    const uint16_t border = rgb565(16, 18, 20);
    const uint16_t background = rgb565(36, 40, 48);
    for (std::size_t i = 0; i < pixel_count; ++i) {
        pixels[i] = border;
    }

    const int x0 = (kNativeWidth - kTargetWidth) / 2;
    const int y0 = (kNativeHeight - kTargetHeight) / 2;
    for (int y = 0; y < kTargetHeight; ++y) {
        for (int x = 0; x < kTargetWidth; ++x) {
            const bool axis = (x % 100) == 0 || (y % 80) == 0;
            const bool frame = x == 0 || y == 0 || x == kTargetWidth - 1 || y == kTargetHeight - 1;
            pixels[(y0 + y) * kNativeWidth + (x0 + x)] =
                frame ? rgb565(255, 255, 255) : (axis ? rgb565(96, 128, 180) : background);
        }
    }
}

} // namespace ps_probe
```

- [ ] **Step 3: Allocate one native framebuffer and draw both diagnostics**

Modify `firmware/esp32p4/main/main.cpp` after successful display init:

```cpp
#include "ps_framebuffer.hpp"
#include "probe_config.hpp"
#include "esp_heap_caps.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
```

Inside the `DISPLAY_INIT` success branch, replace the hardware pattern call with:

```cpp
            ps_probe::set_framebuffer_policy({"native_1024x600", ps_probe::kNativeWidth, ps_probe::kNativeHeight, 1, ps_probe::kRgb565BytesPerPixel});
            auto* fb = static_cast<uint16_t*>(heap_caps_malloc(ps_probe::kNativeFramebufferBytes, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT));
            if (fb == nullptr) {
                ps_probe::emit_phase_result(Phase::DisplayInit, "fail", "framebuffer_alloc", display.elapsed_ms());
                return;
            }
            ps_probe::fill_native_diagnostic(fb, ps_probe::kNativeWidth * ps_probe::kNativeHeight);
            ps_probe::board::draw_rgb565(fb, 0, 0, ps_probe::kNativeWidth, ps_probe::kNativeHeight);
            vTaskDelay(pdMS_TO_TICKS(1200));
            ps_probe::set_framebuffer_policy({"target_800x480", ps_probe::kNativeWidth, ps_probe::kNativeHeight, 1, ps_probe::kRgb565BytesPerPixel});
            ps_probe::fill_target_800x480_diagnostic(fb, ps_probe::kNativeWidth * ps_probe::kNativeHeight);
            ps_probe::board::draw_rgb565(fb, 0, 0, ps_probe::kNativeWidth, ps_probe::kNativeHeight);
            heap_caps_free(fb);
            ps_probe::emit_phase_result(Phase::DisplayInit, "pass", "target_800x480_diagnostic", display.elapsed_ms());
```

- [ ] **Step 4: Build and flash framebuffer diagnostics**

Run:

```bash
cd firmware/esp32p4
idf.py build
idf.py -p "$ESP32P4_PORT" flash monitor
```

Expected: board first shows full-screen native color bands, then a centered 800x480 diagnostic area with visible border and letterboxing. Serial logs include framebuffer policy `native_1024x600` and `target_800x480`.

- [ ] **Step 5: Commit framebuffer diagnostics**

```bash
git add firmware/esp32p4/main/CMakeLists.txt firmware/esp32p4/main/main.cpp firmware/esp32p4/main/ps_framebuffer.hpp firmware/esp32p4/main/ps_framebuffer.cpp
git commit -m "firmware: draw ESP32-P4 probe diagnostics"
```

## Task 5: TF Card Source Loading

**Files:**
- Create: `firmware/esp32p4/main/ps_storage.hpp`
- Create: `firmware/esp32p4/main/ps_storage.cpp`
- Modify: `firmware/esp32p4/main/CMakeLists.txt`
- Modify: `firmware/esp32p4/main/main.cpp`

- [ ] **Step 1: Add storage source to the build**

Modify `firmware/esp32p4/main/CMakeLists.txt` so `SRCS` includes:

```cmake
    "ps_storage.cpp"
```

- [ ] **Step 2: Add storage API**

Create `firmware/esp32p4/main/ps_storage.hpp`:

```cpp
#pragma once

#include <string>
#include <vector>
#include "esp_err.h"

namespace ps_probe {

struct LoadedSource {
    std::string name;
    std::string text;
};

esp_err_t mount_sd_card();
std::vector<std::string> list_sd_games();
esp_err_t read_text_file(const std::string& path, LoadedSource& out_source);
esp_err_t load_first_sd_game(LoadedSource& out_source);
esp_err_t load_named_sd_game(const char* basename, LoadedSource& out_source);

} // namespace ps_probe
```

- [ ] **Step 3: Add storage implementation**

Create `firmware/esp32p4/main/ps_storage.cpp`:

```cpp
#include "ps_storage.hpp"

#include "probe_config.hpp"
#include "sdkconfig.h"
#include "soc/soc_caps.h"
#include <algorithm>
#include <cstdio>
#include <cstring>
#include <dirent.h>
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

} // namespace

esp_err_t mount_sd_card() {
    if (g_mounted) {
        return ESP_OK;
    }

    esp_vfs_fat_sdmmc_mount_config_t mount_config = {
        .format_if_mount_failed = false,
        .max_files = 5,
        .allocation_unit_size = 16 * 1024,
    };

    sdmmc_host_t host = SDMMC_HOST_DEFAULT();
#if SOC_SDMMC_IO_POWER_EXTERNAL
    sd_pwr_ctrl_ldo_config_t ldo_config = {
        .ldo_chan_id = 4,
    };
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
    return result;
}

std::vector<std::string> list_sd_games() {
    std::vector<std::string> names;
    DIR* dir = opendir(kSdGamesDir);
    if (dir == nullptr) {
        return names;
    }
    while (dirent* entry = readdir(dir)) {
        if (entry->d_type == DT_REG && ends_with_txt(entry->d_name)) {
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
```

- [ ] **Step 4: Mount SD during boot**

Modify `firmware/esp32p4/main/main.cpp` after display init:

```cpp
#include "ps_storage.hpp"
```

Add this block after the display block:

```cpp
    {
        PhaseTimer storage(Phase::StorageInit);
        const esp_err_t mount = ps_probe::mount_sd_card();
        if (mount == ESP_OK) {
            const auto games = ps_probe::list_sd_games();
            ps_probe::emit_phase_result(Phase::StorageInit, "pass", games.empty() ? "mounted_no_games" : "mounted_games", storage.elapsed_ms());
        } else {
            ps_probe::emit_phase_result(Phase::StorageInit, "fail", esp_err_to_name(mount), storage.elapsed_ms());
        }
    }
```

- [ ] **Step 5: Build and test SD mount**

Run:

```bash
cd firmware/esp32p4
idf.py build
idf.py -p "$ESP32P4_PORT" flash monitor
```

Expected without a card: app continues and logs `STORAGE_INIT` with status `fail`. Expected with FAT card containing `/games/sokoban_basic.txt`: app logs `STORAGE_INIT` with status `pass`.

- [ ] **Step 6: Commit storage loading**

```bash
git add firmware/esp32p4/main/CMakeLists.txt firmware/esp32p4/main/main.cpp firmware/esp32p4/main/ps_storage.hpp firmware/esp32p4/main/ps_storage.cpp
git commit -m "firmware: mount ESP32-P4 probe SD games"
```

## Task 6: Native PuzzleScript Sources In ESP-IDF

**Files:**
- Modify: `firmware/esp32p4/main/CMakeLists.txt`
- Create: `firmware/esp32p4/main/embedded_games/broken_smoke.txt`

- [ ] **Step 1: Add the intentional broken source**

Create `firmware/esp32p4/main/embedded_games/broken_smoke.txt`:

```text
title Broken Probe Smoke

OBJECTS
Player
red
11111
11111
11111
11111
11111

RULES
[ Player ->

LEVELS
Player
```

- [ ] **Step 2: Embed sources and link the native compiler/runtime**

Replace `firmware/esp32p4/main/CMakeLists.txt` with:

```cmake
set(PUZZLESCRIPT_NATIVE_DIR "${CMAKE_CURRENT_LIST_DIR}/../../../native")

idf_component_register(
  SRCS
    "main.cpp"
    "ps_instrumentation.cpp"
    "board_waveshare_7b.cpp"
    "ps_framebuffer.cpp"
    "ps_storage.cpp"
    "${PUZZLESCRIPT_NATIVE_DIR}/src/handheld/display_layout.cpp"
    "${PUZZLESCRIPT_NATIVE_DIR}/src/runtime/compiled_rules.cpp"
    "${PUZZLESCRIPT_NATIVE_DIR}/src/runtime/c_api.cpp"
    "${PUZZLESCRIPT_NATIVE_DIR}/src/runtime/core.cpp"
    "${PUZZLESCRIPT_NATIVE_DIR}/src/runtime/hash.cpp"
    "${PUZZLESCRIPT_NATIVE_DIR}/src/runtime/json.cpp"
    "${PUZZLESCRIPT_NATIVE_DIR}/src/runtime/simd.cpp"
    "${PUZZLESCRIPT_NATIVE_DIR}/third_party/simdjson/simdjson.cpp"
    "${PUZZLESCRIPT_NATIVE_DIR}/src/compiler/compact_turn_codegen.cpp"
    "${PUZZLESCRIPT_NATIVE_DIR}/src/compiler/compact_turn_program.cpp"
    "${PUZZLESCRIPT_NATIVE_DIR}/src/compiler/compiled_rules_codegen.cpp"
    "${PUZZLESCRIPT_NATIVE_DIR}/src/compiler/compile_diagnostics.cpp"
    "${PUZZLESCRIPT_NATIVE_DIR}/src/compiler/c_api.cpp"
    "${PUZZLESCRIPT_NATIVE_DIR}/src/compiler/source_c_api.cpp"
    "${PUZZLESCRIPT_NATIVE_DIR}/src/compiler/diagnostic.cpp"
    "${PUZZLESCRIPT_NATIVE_DIR}/src/compiler/lower_to_runtime.cpp"
    "${PUZZLESCRIPT_NATIVE_DIR}/src/compiler/parser.cpp"
    "${PUZZLESCRIPT_NATIVE_DIR}/src/compiler/parser_glyphs.cpp"
    "${PUZZLESCRIPT_NATIVE_DIR}/src/compiler/rule_text.cpp"
    "${PUZZLESCRIPT_NATIVE_DIR}/src/compiler/semantic_program.cpp"
    "${PUZZLESCRIPT_NATIVE_DIR}/third_party/utf8proc/utf8proc.c"
  INCLUDE_DIRS
    "."
    "${PUZZLESCRIPT_NATIVE_DIR}/include"
    "${PUZZLESCRIPT_NATIVE_DIR}/src"
    "${PUZZLESCRIPT_NATIVE_DIR}/third_party/simdjson"
    "${PUZZLESCRIPT_NATIVE_DIR}/third_party/utf8proc"
  EMBED_TXTFILES
    "../../../src/demo/sokoban_basic.txt"
    "embedded_games/broken_smoke.txt"
)

target_compile_features(${COMPONENT_LIB} PRIVATE cxx_std_17)
target_compile_options(${COMPONENT_LIB} PRIVATE
  -Wall
  -Wextra
  -Wno-missing-field-initializers
  -Wno-unused-parameter
  -Wno-sign-compare
)
target_compile_definitions(${COMPONENT_LIB} PRIVATE
  UTF8PROC_STATIC
  PS_MASK_WORD_BITS=32
  PS_INTERPRETER_OBJECT_CELL_INDEX=1
)
```

- [ ] **Step 3: Build native sources under ESP-IDF**

Run:

```bash
cd firmware/esp32p4
idf.py build
```

Expected: either the build succeeds, or it fails on a concrete native portability issue. If it fails, fix only the smallest compile blocker in the native source or ESP-IDF CMake options, then rerun `idf.py build`. Keep desktop `cmake --build build --target puzzlescript_cpp` passing after any native source change.

- [ ] **Step 4: Commit native source integration**

```bash
git add firmware/esp32p4/main/CMakeLists.txt firmware/esp32p4/main/embedded_games/broken_smoke.txt
git commit -m "firmware: link native PuzzleScript core into probe"
```

## Task 7: Minimal PuzzleScript RGB565 Renderer

**Files:**
- Create: `firmware/esp32p4/main/ps_renderer.hpp`
- Create: `firmware/esp32p4/main/ps_renderer.cpp`
- Modify: `firmware/esp32p4/main/CMakeLists.txt`

- [ ] **Step 1: Add renderer source to the build**

Modify `firmware/esp32p4/main/CMakeLists.txt` so `SRCS` includes:

```cmake
    "ps_renderer.cpp"
```

- [ ] **Step 2: Add renderer API**

Create `firmware/esp32p4/main/ps_renderer.hpp`:

```cpp
#pragma once

#include <cstdint>
#include "puzzlescript/puzzlescript.h"

namespace ps_probe {

struct RenderResult {
    bool ok;
    int board_width;
    int board_height;
    int tile_pixels;
    int sprite_scale;
};

RenderResult render_level_to_native_framebuffer(
    const ps_game* game,
    const ps_full_state* state,
    uint16_t* native_pixels,
    int native_width,
    int native_height);

} // namespace ps_probe
```

- [ ] **Step 3: Add renderer implementation**

Create `firmware/esp32p4/main/ps_renderer.cpp`:

```cpp
#include "ps_renderer.hpp"

#include "handheld/display_layout.hpp"
#include "probe_config.hpp"
#include "ps_framebuffer.hpp"
#include <algorithm>
#include <cstddef>
#include <cstdlib>
#include <optional>
#include <string>
#include <vector>

namespace ps_probe {
namespace {

uint16_t named_color(const char* value) {
    const std::string color(value == nullptr ? "" : value);
    if (color == "black") return rgb565(0, 0, 0);
    if (color == "white") return rgb565(255, 255, 255);
    if (color == "orange") return rgb565(255, 128, 0);
    if (color == "blue") return rgb565(40, 96, 220);
    if (color == "darkblue") return rgb565(24, 48, 128);
    if (color == "green") return rgb565(0, 170, 80);
    if (color == "lightgreen") return rgb565(144, 220, 112);
    if (color == "brown") return rgb565(128, 80, 32);
    if (color == "darkbrown") return rgb565(64, 40, 16);
    if (color.size() == 7 && color[0] == '#') {
        const int r = std::strtol(color.substr(1, 2).c_str(), nullptr, 16);
        const int g = std::strtol(color.substr(3, 2).c_str(), nullptr, 16);
        const int b = std::strtol(color.substr(5, 2).c_str(), nullptr, 16);
        return rgb565(static_cast<uint8_t>(r), static_cast<uint8_t>(g), static_cast<uint8_t>(b));
    }
    return rgb565(255, 0, 255);
}

uint16_t object_pixel_color(const ps_game* game, int32_t object_id, int sx, int sy) {
    if (object_id < 0) {
        return named_color(ps_game_background_color(game));
    }
    const int32_t sprite_value = ps_game_object_sprite_value(game, object_id, sx, sy);
    if (sprite_value < 0) {
        return named_color(ps_game_background_color(game));
    }
    return named_color(ps_game_object_color(game, object_id, static_cast<size_t>(sprite_value)));
}

} // namespace

RenderResult render_level_to_native_framebuffer(
    const ps_game* game,
    const ps_full_state* state,
    uint16_t* native_pixels,
    int native_width,
    int native_height) {
    RenderResult result{false, 0, 0, 0, 0};
    if (game == nullptr || state == nullptr || native_pixels == nullptr || native_width != kNativeWidth || native_height != kNativeHeight) {
        return result;
    }

    ps_full_state_status_info status{};
    ps_full_state_status(state, &status);
    result.board_width = status.width;
    result.board_height = status.height;
    if (status.text_mode || status.width <= 0 || status.height <= 0) {
        fill_target_800x480_diagnostic(native_pixels, static_cast<size_t>(native_width) * native_height);
        result.ok = true;
        return result;
    }

    const auto flick = puzzlescript::handheld::parseScreenSize(ps_game_metadata_value(game, "flickscreen"));
    const auto zoom = puzzlescript::handheld::parseScreenSize(ps_game_metadata_value(game, "zoomscreen"));
    std::optional<puzzlescript::handheld::PlayerPosition> player;
    int32_t px = 0;
    int32_t py = 0;
    if (ps_full_state_first_player_position(state, &px, &py)) {
        player = puzzlescript::handheld::PlayerPosition{px, py};
    }
    const puzzlescript::handheld::Viewport viewport = puzzlescript::handheld::computeViewport(
        puzzlescript::handheld::LevelView{status.width, status.height, flick, zoom},
        player,
        std::nullopt);
    const puzzlescript::handheld::FitResult fit = puzzlescript::handheld::computeFit(
        puzzlescript::handheld::DisplaySpec{kTargetWidth, kTargetHeight, 5},
        viewport);
    result.tile_pixels = fit.tilePixels;
    result.sprite_scale = fit.spriteScale;

    const uint16_t background = named_color(ps_game_background_color(game));
    std::fill(native_pixels, native_pixels + static_cast<size_t>(native_width) * native_height, rgb565(12, 12, 16));
    const int target_x0 = (kNativeWidth - kTargetWidth) / 2;
    const int target_y0 = (kNativeHeight - kTargetHeight) / 2;
    for (int y = 0; y < kTargetHeight; ++y) {
        for (int x = 0; x < kTargetWidth; ++x) {
            native_pixels[(target_y0 + y) * native_width + target_x0 + x] = background;
        }
    }

    const int layers = ps_game_layer_count(game);
    std::vector<int32_t> cells(static_cast<size_t>(layers) * status.width * status.height, -1);
    const size_t written = ps_full_state_layer_cell_object_ids(state, cells.data(), cells.size());
    if (written == 0) {
        return result;
    }

    const int board_x0 = target_x0 + fit.offsetX;
    const int board_y0 = target_y0 + fit.offsetY;
    for (int ty = 0; ty < viewport.height; ++ty) {
        const int board_y = viewport.minY + ty;
        if (board_y < 0 || board_y >= status.height) {
            continue;
        }
        for (int tx = 0; tx < viewport.width; ++tx) {
            const int board_x = viewport.minX + tx;
            if (board_x < 0 || board_x >= status.width) {
                continue;
            }
            for (int py5 = 0; py5 < 5; ++py5) {
                for (int px5 = 0; px5 < 5; ++px5) {
                    int32_t top_object = -1;
                    for (int layer = 0; layer < layers; ++layer) {
                        const size_t index = static_cast<size_t>(layer) * status.width * status.height + board_y * status.width + board_x;
                        if (index < cells.size() && cells[index] >= 0) {
                            top_object = cells[index];
                        }
                    }
                    const uint16_t color = object_pixel_color(game, top_object, px5, py5);
                    const int sub_x0 = board_x0 + tx * fit.tilePixels + px5 * fit.spriteScale;
                    const int sub_y0 = board_y0 + ty * fit.tilePixels + py5 * fit.spriteScale;
                    for (int sy = 0; sy < fit.spriteScale; ++sy) {
                        for (int sx = 0; sx < fit.spriteScale; ++sx) {
                            const int x = sub_x0 + sx;
                            const int y = sub_y0 + sy;
                            if (x >= target_x0 && x < target_x0 + kTargetWidth && y >= target_y0 && y < target_y0 + kTargetHeight) {
                                native_pixels[y * native_width + x] = color;
                            }
                        }
                    }
                }
            }
        }
    }
    result.ok = true;
    return result;
}

} // namespace ps_probe
```

- [ ] **Step 4: Build renderer**

Run:

```bash
cd firmware/esp32p4
idf.py build
```

Expected: build succeeds. If the build fails because `<optional>` or C++ exceptions are unavailable, verify `CONFIG_COMPILER_CXX_EXCEPTIONS=y` and the C++17 feature line in `main/CMakeLists.txt`.

- [ ] **Step 5: Commit renderer**

```bash
git add firmware/esp32p4/main/CMakeLists.txt firmware/esp32p4/main/ps_renderer.hpp firmware/esp32p4/main/ps_renderer.cpp
git commit -m "firmware: add PuzzleScript RGB565 renderer"
```

## Task 8: PuzzleScript Probe Runtime

**Files:**
- Create: `firmware/esp32p4/main/ps_probe_runtime.hpp`
- Create: `firmware/esp32p4/main/ps_probe_runtime.cpp`
- Modify: `firmware/esp32p4/main/CMakeLists.txt`
- Modify: `firmware/esp32p4/main/main.cpp`

- [ ] **Step 1: Add runtime probe source to the build**

Modify `firmware/esp32p4/main/CMakeLists.txt` so `SRCS` includes:

```cmake
    "ps_probe_runtime.cpp"
```

- [ ] **Step 2: Add probe runtime API**

Create `firmware/esp32p4/main/ps_probe_runtime.hpp`:

```cpp
#pragma once

#include <cstddef>
#include <cstdint>
#include <string>

namespace ps_probe {

struct SourceProbeInput {
    const char* name;
    const char* text;
    std::size_t size;
    bool render;
};

void run_embedded_sokoban_probe(uint16_t* framebuffer);
void run_embedded_broken_probe();
void run_sd_probe_if_available(uint16_t* framebuffer);
void run_named_sd_probe_if_available(const char* basename, uint16_t* framebuffer);

} // namespace ps_probe
```

- [ ] **Step 3: Add probe runtime implementation**

Create `firmware/esp32p4/main/ps_probe_runtime.cpp`:

```cpp
#include "ps_probe_runtime.hpp"

#include "board_waveshare_7b.hpp"
#include "probe_config.hpp"
#include "ps_instrumentation.hpp"
#include "ps_renderer.hpp"
#include "ps_storage.hpp"
#include "puzzlescript/compiler.h"
#include "puzzlescript/puzzlescript.h"
#include "esp_err.h"
#include "esp_log.h"
#include <memory>
#include <string>

extern const uint8_t _binary_sokoban_basic_txt_start[] asm("_binary_sokoban_basic_txt_start");
extern const uint8_t _binary_sokoban_basic_txt_end[] asm("_binary_sokoban_basic_txt_end");
extern const uint8_t _binary_broken_smoke_txt_start[] asm("_binary_broken_smoke_txt_start");
extern const uint8_t _binary_broken_smoke_txt_end[] asm("_binary_broken_smoke_txt_end");

namespace ps_probe {
namespace {

using CompileResultPtr = std::unique_ptr<ps_compile_result, decltype(&ps_free_compile_result)>;
using CompilerResultPtr = std::unique_ptr<ps_compiler_result, decltype(&ps_compiler_result_free)>;
using FullStatePtr = std::unique_ptr<ps_full_state, decltype(&ps_full_state_destroy)>;
using ErrorPtr = std::unique_ptr<ps_error, decltype(&ps_free_error)>;

std::string error_message(ps_error* error) {
    ErrorPtr holder(error, ps_free_error);
    if (!holder) {
        return "";
    }
    const char* value = ps_error_message(holder.get());
    return value == nullptr ? "" : value;
}

void emit_compile_diagnostics(const char* source_name, const char* text, std::size_t size) {
    CompilerResultPtr diagnostics(ps_compiler_compile_source_diagnostics(text, size), ps_compiler_result_free);
    const size_t count = diagnostics ? ps_compiler_result_diagnostic_count(diagnostics.get()) : 0;
    for (size_t i = 0; i < count; ++i) {
        const ps_diagnostic* diag = ps_compiler_result_diagnostic(diagnostics.get(), i);
        if (diag != nullptr) {
            ESP_LOGI("ps_probe",
                     "{\"event\":\"diagnostic\",\"source\":\"%s\",\"severity\":%d,\"line\":%d,\"message\":\"%s\"}",
                     source_name,
                     static_cast<int>(diag->severity),
                     diag->line,
                     diag->message == nullptr ? "" : diag->message);
        }
    }
}

bool run_source_probe(const SourceProbeInput& input, uint16_t* framebuffer) {
    {
        PhaseTimer load(Phase::LoadSourceFlash);
        emit_phase_result(Phase::LoadSourceFlash, "pass", input.name, load.elapsed_ms());
    }

    ps_compile_result* raw_compile = nullptr;
    bool compiled = false;
    {
        PhaseTimer compile(Phase::CompileSource);
        compiled = ps_compile_source(input.text, input.size, &raw_compile);
        emit_phase_result(Phase::CompileSource, compiled ? "pass" : "fail", input.name, compile.elapsed_ms());
    }
    CompileResultPtr compile_result(raw_compile, ps_free_compile_result);
    if (!compiled || !compile_result) {
        emit_compile_diagnostics(input.name, input.text, input.size);
        return false;
    }

    const ps_game* game = ps_compile_result_game(compile_result.get());
    ps_full_state* raw_state = nullptr;
    {
        ps_error* raw_error = nullptr;
        PhaseTimer create(Phase::CreateRuntime);
        const bool ok = ps_full_state_create(game, &raw_state, &raw_error);
        const std::string detail = ok ? std::string(input.name) : error_message(raw_error);
        emit_phase_result(Phase::CreateRuntime, ok ? "pass" : "fail", detail.c_str(), create.elapsed_ms());
        if (!ok) {
            return false;
        }
    }
    FullStatePtr state(raw_state, ps_full_state_destroy);

    {
        ps_error* raw_error = nullptr;
        PhaseTimer load_level(Phase::LoadLevel);
        const bool ok = ps_full_state_load_level(state.get(), 0, &raw_error);
        const std::string detail = ok ? std::string(input.name) : error_message(raw_error);
        emit_phase_result(Phase::LoadLevel, ok ? "pass" : "fail", detail.c_str(), load_level.elapsed_ms());
        if (!ok) {
            return false;
        }
    }

    if (input.render && framebuffer != nullptr) {
        PhaseTimer render(Phase::RenderFrame);
        const RenderResult rendered = render_level_to_native_framebuffer(game, state.get(), framebuffer, kNativeWidth, kNativeHeight);
        if (rendered.ok) {
            board::draw_rgb565(framebuffer, 0, 0, kNativeWidth, kNativeHeight);
        }
        emit_phase_result(Phase::RenderFrame, rendered.ok ? "pass" : "fail", input.name, render.elapsed_ms());
    }

    {
        PhaseTimer trace(Phase::RunInputTrace);
        ps_full_state_turn(state.get(), PS_INPUT_RIGHT);
        ps_full_state_turn(state.get(), PS_INPUT_DOWN);
        ps_full_state_undo(state.get());
        ps_full_state_restart(state.get());
        emit_phase_result(Phase::RunInputTrace, "pass", input.name, trace.elapsed_ms());
    }

    {
        PhaseTimer unload(Phase::UnloadGame);
        emit_phase_result(Phase::UnloadGame, "pass", input.name, unload.elapsed_ms());
    }
    return true;
}

} // namespace

void run_embedded_sokoban_probe(uint16_t* framebuffer) {
    run_source_probe(
        SourceProbeInput{
            "embedded:sokoban_basic.txt",
            reinterpret_cast<const char*>(_binary_sokoban_basic_txt_start),
            static_cast<std::size_t>(_binary_sokoban_basic_txt_end - _binary_sokoban_basic_txt_start),
            true,
        },
        framebuffer);
}

void run_embedded_broken_probe() {
    run_source_probe(
        SourceProbeInput{
            "embedded:broken_smoke.txt",
            reinterpret_cast<const char*>(_binary_broken_smoke_txt_start),
            static_cast<std::size_t>(_binary_broken_smoke_txt_end - _binary_broken_smoke_txt_start),
            false,
        },
        nullptr);
}

void run_sd_probe_if_available(uint16_t* framebuffer) {
    LoadedSource source;
    PhaseTimer load(Phase::LoadSourceSd);
    const esp_err_t result = load_first_sd_game(source);
    emit_phase_result(Phase::LoadSourceSd, result == ESP_OK ? "pass" : "fail", result == ESP_OK ? source.name.c_str() : esp_err_to_name(result), load.elapsed_ms());
    if (result == ESP_OK) {
        run_source_probe(SourceProbeInput{source.name.c_str(), source.text.data(), source.text.size(), true}, framebuffer);
    }
}

void run_named_sd_probe_if_available(const char* basename, uint16_t* framebuffer) {
    LoadedSource source;
    PhaseTimer load(Phase::LoadSourceSd);
    const esp_err_t result = load_named_sd_game(basename, source);
    emit_phase_result(Phase::LoadSourceSd, result == ESP_OK ? "pass" : "fail", result == ESP_OK ? source.name.c_str() : esp_err_to_name(result), load.elapsed_ms());
    if (result == ESP_OK) {
        run_source_probe(SourceProbeInput{source.name.c_str(), source.text.data(), source.text.size(), true}, framebuffer);
    }
}

} // namespace ps_probe
```

- [ ] **Step 4: Run probes from boot**

Modify `firmware/esp32p4/main/main.cpp`:

```cpp
#include "ps_probe_runtime.hpp"
```

After display and storage initialization, allocate one framebuffer and run probes:

```cpp
    auto* probe_fb = static_cast<uint16_t*>(heap_caps_malloc(ps_probe::kNativeFramebufferBytes, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT));
    if (probe_fb != nullptr) {
        ps_probe::set_framebuffer_policy({"target_800x480", ps_probe::kNativeWidth, ps_probe::kNativeHeight, 1, ps_probe::kRgb565BytesPerPixel});
        ps_probe::run_embedded_sokoban_probe(probe_fb);
        ps_probe::run_embedded_broken_probe();
        ps_probe::run_sd_probe_if_available(probe_fb);
        ps_probe::run_named_sd_probe_if_available("at-the-hedges-of-time.txt", probe_fb);
        heap_caps_free(probe_fb);
    } else {
        ps_probe::emit_phase_result(Phase::RenderFrame, "fail", "probe_framebuffer_alloc", 0);
    }
```

- [ ] **Step 5: Build and flash PuzzleScript probe**

Run:

```bash
cd firmware/esp32p4
idf.py build
idf.py -p "$ESP32P4_PORT" flash monitor
```

Expected:

- built-in `sokoban_basic` compiles, creates runtime, loads level 0, renders one frame
- broken source emits at least one `event:"diagnostic"` line and app continues
- no SD card logs `LOAD_SOURCE_SD` failure without reboot
- SD card with `/games/*.txt` logs an SD load and attempts compile/render
- SD card with `/games/at-the-hedges-of-time.txt` logs a phase-specific result for that outlier

- [ ] **Step 6: Commit PuzzleScript probe runtime**

```bash
git add firmware/esp32p4/main/CMakeLists.txt firmware/esp32p4/main/main.cpp firmware/esp32p4/main/ps_probe_runtime.hpp firmware/esp32p4/main/ps_probe_runtime.cpp
git commit -m "firmware: run PuzzleScript board probe"
```

## Task 9: Make Targets And Usage Notes

**Files:**
- Modify: `Makefile`
- Create: `docs/superpowers/notes/2026-07-06-esp32p4-board-probe-usage.md`

- [ ] **Step 1: Add Makefile variables**

Near the existing handheld variables in `Makefile`, add:

```make
IDF_PY ?= idf.py
ESP32P4_PORT ?=
ESP32P4_FIRMWARE_DIR := firmware/esp32p4
```

- [ ] **Step 2: Add Makefile help**

Near the existing handheld help lines, add:

```make
	@echo "  make handheld_p4_probe_build       Build ESP32-P4 Waveshare board-probe firmware"
	@echo "  make handheld_p4_probe_flash       Flash ESP32-P4 board-probe firmware (set ESP32P4_PORT=/dev/...)"
	@echo "  make handheld_p4_probe_monitor     Monitor ESP32-P4 board-probe serial logs"
```

- [ ] **Step 3: Add Makefile targets**

Add these targets near `handheld_report`:

```make
handheld_p4_probe_build:
	cd $(ESP32P4_FIRMWARE_DIR) && $(IDF_PY) set-target esp32p4
	cd $(ESP32P4_FIRMWARE_DIR) && $(IDF_PY) build

handheld_p4_probe_flash:
	@if [ -z "$(ESP32P4_PORT)" ]; then echo "Set ESP32P4_PORT=/dev/cu.usbmodem..." >&2; exit 2; fi
	cd $(ESP32P4_FIRMWARE_DIR) && $(IDF_PY) -p "$(ESP32P4_PORT)" flash

handheld_p4_probe_monitor:
	@if [ -z "$(ESP32P4_PORT)" ]; then echo "Set ESP32P4_PORT=/dev/cu.usbmodem..." >&2; exit 2; fi
	cd $(ESP32P4_FIRMWARE_DIR) && $(IDF_PY) -p "$(ESP32P4_PORT)" monitor
```

Add `handheld_p4_probe_build handheld_p4_probe_flash handheld_p4_probe_monitor` to the `.PHONY` list.

- [ ] **Step 4: Add usage note**

Create `docs/superpowers/notes/2026-07-06-esp32p4-board-probe-usage.md`:

````markdown
# ESP32-P4 Board Probe Usage

The ESP32-P4 board probe targets the Waveshare ESP32-P4-WIFI6-Touch-LCD-7B.
It verifies the first hardware slice for the PuzzleScript handheld: boot logs,
heap snapshots, display diagnostics, TF-card game loading, and one rendered
PuzzleScript board frame.

## Build

Activate ESP-IDF first, then run:

```bash
make handheld_p4_probe_build
```

The firmware project lives at:

```bash
firmware/esp32p4
```

## Flash And Monitor

Set the serial port for the connected board:

```bash
make handheld_p4_probe_flash ESP32P4_PORT=/dev/cu.usbmodemXXXX
make handheld_p4_probe_monitor ESP32P4_PORT=/dev/cu.usbmodemXXXX
```

## SD Card

Format a TF card as FAT and create:

```bash
/games
```

Copy one or more PuzzleScript `.txt` games into that directory. To run the
current memory-audit outlier, copy it as:

```bash
/games/at-the-hedges-of-time.txt
```

## Expected Serial Events

The probe prints JSON-lines through ESP logging. Important event names:

- `boot`
- `phase`
- `heap`
- `diagnostic`

Required phase names:

```text
BOOT
DISPLAY_INIT
STORAGE_INIT
LOAD_SOURCE_FLASH
COMPILE_SOURCE
CREATE_RUNTIME
LOAD_LEVEL
RENDER_FRAME
RUN_INPUT_TRACE
UNLOAD_GAME
LOAD_SOURCE_SD
```

The first useful success run has `pass` for `BOOT`, `DISPLAY_INIT`,
`COMPILE_SOURCE`, `CREATE_RUNTIME`, `LOAD_LEVEL`, and `RENDER_FRAME` for
`embedded:sokoban_basic.txt`.
````

- [ ] **Step 5: Verify help and build target**

Run:

```bash
make help | rg 'handheld_p4_probe|handheld_report'
make handheld_p4_probe_build
```

Expected: help prints the three P4 probe targets, and the firmware build succeeds.

- [ ] **Step 6: Commit docs and Make targets**

```bash
git add Makefile docs/superpowers/notes/2026-07-06-esp32p4-board-probe-usage.md
git commit -m "docs: add ESP32-P4 board probe usage"
```

## Final Verification

Run these after all tasks:

```bash
cmake --build build --target puzzlescript_handheld_report
ctest --test-dir build/native -R '^handheld_' --output-on-failure
make handheld_p4_probe_build
```

Expected:

- native handheld tests still pass
- ESP-IDF probe firmware builds
- no desktop native source integration regresses the host handheld report

On hardware, run:

```bash
make handheld_p4_probe_flash ESP32P4_PORT=/dev/cu.usbmodemXXXX
make handheld_p4_probe_monitor ESP32P4_PORT=/dev/cu.usbmodemXXXX
```

Expected:

- board displays native diagnostic, then centered 800x480 diagnostic, then rendered `sokoban_basic`
- serial logs include heap snapshots for internal, SPIRAM, and 8-bit regions per phase
- broken source emits diagnostics without reboot
- SD game load is attempted when `/sdcard/games/*.txt` exists

## Spec Coverage Self-Review

- Board decision and ESP-IDF stack: Tasks 1, 3, 6.
- 1024x600 native and 800x480 target display modes: Tasks 3 and 4.
- Machine-readable heap and phase logs: Task 2 and final verification.
- Built-in PuzzleScript compile/runtime/render smoke: Tasks 6, 7, and 8.
- TF-card `/games` loading: Task 5 and Task 8.
- Broken-source diagnostics: Task 6 and Task 8.
- Outlier path: Task 8 attempts `at-the-hedges-of-time.txt` from SD when present.
- Physical controls, audio, haptics, LEDs, USB mass storage, and battery measurement: deliberately outside this first board-probe slice.
