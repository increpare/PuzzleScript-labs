#include "gba/exporter.hpp"
#include "puzzlescript/gba.h"

#include <algorithm>
#include <array>
#include <cstdint>
#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <sstream>
#include <stdexcept>
#include <string>
#include <vector>

#ifndef PS_REPO_ROOT
#error PS_REPO_ROOT is required
#endif

namespace {

void require(bool condition, const char* message) {
    if (!condition) {
        std::cerr << "gba_exporter: " << message << "\n";
        std::exit(1);
    }
}

std::string readFile(const std::filesystem::path& path) {
    std::ifstream input(path, std::ios::binary);
    std::ostringstream out;
    out << input.rdbuf();
    return out.str();
}

uint16_t readU16(const std::string& bytes, size_t offset) {
    return static_cast<uint16_t>(static_cast<uint8_t>(bytes[offset]))
        | static_cast<uint16_t>(static_cast<uint8_t>(bytes[offset + 1])) << 8U;
}

uint32_t readU32(const std::string& bytes, size_t offset) {
    return readU16(bytes, offset) | static_cast<uint32_t>(readU16(bytes, offset + 2)) << 16U;
}

void writePpm(const std::filesystem::path& path, int width, int height,
    const std::vector<std::array<uint8_t, 3>>& pixels) {
    require(width > 0 && height > 0 && pixels.size() == static_cast<size_t>(width) * height,
        "PPM fixture dimensions are valid");
    std::filesystem::create_directories(path.parent_path());
    std::ofstream output(path, std::ios::binary | std::ios::trunc);
    output << "P6\n" << width << " " << height << "\n255\n";
    for (const auto& pixel : pixels) {
        output.write(reinterpret_cast<const char*>(pixel.data()), 3);
    }
}

} // namespace

int main() {
    const std::filesystem::path root = PS_REPO_ROOT;
    const std::string gbaPlatformSource = readFile(root / "firmware" / "gba" / "source" / "main.cpp");
    require(gbaPlatformSource.find("irqSet(IRQ_VBLANK, mmVBlank)") != std::string::npos,
        "audio builds install Maxmod's mandatory VBlank DMA handler");
    require(gbaPlatformSource.find("mmSetVBlankHandler(reinterpret_cast<void*>(ps_gba_perf_vblank))")
            != std::string::npos,
        "audio performance telemetry chains through Maxmod's VBlank handler");
    require(gbaPlatformSource.find("eventCount > PS_GBA_MAX_AUDIO_EVENTS") != std::string::npos
            && gbaPlatformSource.find("sampleId < MSL_NSAMPS") != std::string::npos,
        "firmware rejects corrupt audio queues and out-of-range sample IDs");
    const std::string gbaMakefile = readFile(root / "firmware" / "gba" / "Makefile");
    require(gbaMakefile.find(
                "BINFILES    := $(if $(filter 1 yes true on,$(AUDIO)),soundbank.bin,)")
            != std::string::npos,
        "muted firmware builds cannot link a stale soundbank from another game");
    require(gbaMakefile.find(
                "$(if $(filter 1 yes true on,$(AUDIO)),,--no-mmutil)")
            != std::string::npos,
        "muted firmware exports skip unnecessary Maxmod conversion");
    require(gbaMakefile.find("LCD_CONTRAST        ?= 1") != std::string::npos
            && gbaMakefile.find("LCD_CONTRAST_ARG") != std::string::npos,
        "firmware exports default to LCD contrast with an opt-out flag");
    const std::filesystem::path output = root / "build" / "native" / "gba_exporter_test_output";
    std::filesystem::remove_all(output);

    puzzlescript::gba::ExportOptions options;
    options.sourcePath = root / "src" / "demo" / "sokoban_basic.txt";
    options.outputDirectory = output;
    options.runMmutil = false;
    options.lcdContrast = false;
    const auto first = puzzlescript::gba::exportGame(options);
    require(std::filesystem::exists(first.manifestPath), "manifest is generated");
    require(std::filesystem::exists(first.generatedHeaderPath), "generated header is generated");
    require(std::filesystem::exists(first.generatedSourcePath), "generated source is generated");
    require(std::filesystem::exists(first.generatedRulesPath), "generated compact rules are generated");
    require(std::filesystem::exists(output / "audio" / "seed_36772507.wav"), "movement SFX is synthesized once by seed");

    const std::string wav = readFile(output / "audio" / "seed_36772507.wav");
    require(wav.size() >= 46 && wav.substr(0, 4) == "RIFF" && wav.substr(8, 4) == "WAVE", "SFX is a WAV file");
    require(readU16(wav, 22) == 1 && readU32(wav, 24) == 16000 && readU16(wav, 34) == 16, "SFX is 16 kHz mono PCM16");
    const uint32_t pcmBytes = readU32(wav, 40);
    require(pcmBytes >= 4 && 44U + pcmBytes <= wav.size(), "SFX PCM payload is valid");
    int32_t peak = 0;
    for (size_t offset = 44; offset < 44U + pcmBytes; offset += 2) {
        const int32_t sample = static_cast<int16_t>(readU16(wav, offset));
        peak = std::max(peak, sample < 0 ? -sample : sample);
    }
    require(static_cast<int16_t>(readU16(wav, 44)) == 0, "SFX fades in from zero");
    require(static_cast<int16_t>(readU16(wav, 42U + pcmBytes)) == 0, "SFX fades out to zero");
    require(peak <= 32767, "SFX peak is capped at PCM full scale");

    const std::string manifest = readFile(first.manifestPath);
    require(manifest.find("\"runtime_profile\": \"generated_compact\"") != std::string::npos,
        "manifest records the generated compact runtime");
    require(manifest.find("\"palette_count\": 9") != std::string::npos, "BGR555 palette is deduplicated");
    require(manifest.find("\"sound_seed_count\": 1") != std::string::npos, "sound seeds are deduplicated");
    require(manifest.find("\"sound_alias_count\": 1") != std::string::npos,
        "manifest records the retained sound-name aliases");
    require(manifest.find("\"undo_capacity\": 32") != std::string::npos,
        "small games retain the full 32-snapshot undo ring");
    require(manifest.find("\"kernel_snapshot_bytes\": 336") != std::string::npos,
        "manifest accounts for two fixed board-sized kernel snapshots");
    require(manifest.find("\"object_cell_index_bytes\": 60") != std::string::npos,
        "manifest accounts for the fixed object-to-cell index and counts");
    require(manifest.find("\"object_cell_index_enabled\": true") != std::string::npos,
        "manifest records that the representative game uses the fixed object index");
    require(manifest.find("\"soundbank_generated\": false") != std::string::npos, "no-mmutil mode is explicit");
    require(manifest.find("\"lcd_contrast\": {") != std::string::npos
            && manifest.find("\"enabled\": false") != std::string::npos
            && manifest.find("\"applied\": false") != std::string::npos,
        "literal-color exports record disabled LCD contrast");
    const std::string generatedBefore = readFile(first.generatedSourcePath);
    const std::string generatedRules = readFile(first.generatedRulesPath);
    require(generatedRules.find("compact_turn_attach_external_board_0") != std::string::npos,
        "generated kernel attaches the session board as non-owning storage");
    require(generatedRules.find("compact_turn_attach_external_snapshots_0") != std::string::npos,
        "generated kernel attaches fixed session-backed turn and again snapshots");
    require(generatedRules.find("compact_turn_attach_external_object_cell_index_0") != std::string::npos,
        "generated kernel attaches a fixed session-backed object-to-cell index");
    require(generatedRules.find("compact_turn_enable_movement_cell_index_0 = false") != std::string::npos,
        "generated GBA kernels avoid the optional heap-backed movement-cell index");
    require(generatedRules.find("if (!usedAnchorScan && !compact_turn_enable_movement_cell_index_0)") != std::string::npos,
        "generated GBA kernels use the zero-allocation movement-anchor fallback");
    require(generatedRules.find("if (!turnStartLiveMovementsClean) turnStartMovements = scratch.liveMovements") != std::string::npos,
        "again probes do not copy an already-clean movement board");
    require(generatedRules.find("options.againPolicy = puzzlescript::AgainPolicy::Defer") != std::string::npos,
        "generated GBA kernels defer again ticks instead of probing them synchronously");
    require(generatedRules.find("scratch.objectCellBits.assign") == std::string::npos
            && generatedRules.find("scratch.objectCellCounts.assign") == std::string::npos,
        "generated GBA object-cell indexes do not allocate owning vectors");
    require(generatedRules.find("MaskVector localTurnStartObjects") == std::string::npos,
        "generated GBA turns do not allocate local owning board snapshots");
    require(generatedRules.find("if (resetScratch) puzzlescript::resetScratchForLevel(scratch)") != std::string::npos
            && generatedRules.find("scratch = puzzlescript::Scratch{}") == std::string::npos,
        "generated GBA scratch resets retain reusable vector capacity");
    require(generatedRules.find("levelState.board.objects.resize(boardWordCount)") == std::string::npos,
        "generated kernel does not allocate an owning board per turn");
    require(generatedRules.find("memcpy(boardWords, levelState.board.objects.data()") == std::string::npos,
        "generated kernel does not copy its board back after every turn");
    require(generatedRules.find("#if defined(PS_GBA_PERF_TELEMETRY)") != std::string::npos
            && generatedRules.find("ps_gba_perf_progress(1, 1)") != std::string::npos
            && generatedRules.find("ps_gba_perf_progress(2,") != std::string::npos,
        "generated kernel exposes opt-in setup and rule progress telemetry");
    require(generatedRules.find(
        "if (commands.hasCancel) {\n"
        "        compact_turn_restore_board_objects_0(levelState, *turnStartObjects);\n"
        "        (void)compact_turn_rebuild_object_derived_state_0(dimensions, levelState, scratch);\n"
        "        scratch.objectCellIndexDirty = true;\n"
        "        compact_turn_refresh_any_masks_dirty_0(scratch);") != std::string::npos,
        "cancel rollback refreshes the generated kernel's board-derived caches");
    require(readFile(first.generatedHeaderPath).find("PS_GBA_GENERATED_SESSION_BYTES") != std::string::npos,
        "generated header sizes the fixed session arena for this game");
    require(generatedBefore.find("alignas(4) const uint8_t kObject0Pixels[]") != std::string::npos,
        "object pixels are emitted as byte-sized palette indices");
    require(generatedBefore.find("const uint16_t kObject0Pixels[]") == std::string::npos,
        "object pixels are not emitted as interlaced 16-bit values");
    require(generatedBefore.find("PS_GBA_TRANSPARENT_PIXEL") == std::string::npos,
        "transparent pixels are not encoded as 16-bit sentinels");
    require(generatedBefore.find("kObject1Pixels, 0x1f8d63fU") != std::string::npos,
        "transparent pixels are emitted in a separate bitmask");
    require(generatedBefore.find("PS_GBA_GAME_ABI_VERSION") != std::string::npos,
        "generated games declare the current embedded ABI");
    require(manifest.find("\"format\": \"puzzlescript-gba-v4\"") != std::string::npos,
        "manifest records the generated-kernel ABI version");
    const auto second = puzzlescript::gba::exportGame(options);
    require(generatedBefore == readFile(second.generatedSourcePath), "export is deterministic");

    const std::filesystem::path audioAliasOutput = root / "build" / "native" / "gba_audio_alias_test_output";
    std::filesystem::remove_all(audioAliasOutput);
    puzzlescript::gba::ExportOptions audioAliasOptions = options;
    audioAliasOptions.sourcePath = root / "native" / "tests" / "gba_audio_parity.txt";
    audioAliasOptions.outputDirectory = audioAliasOutput;
    const auto audioAliasResult = puzzlescript::gba::exportGame(audioAliasOptions);
    const std::string audioAliasManifest = readFile(audioAliasResult.manifestPath);
    const std::string audioAliasSource = readFile(audioAliasResult.generatedSourcePath);
    require(audioAliasManifest.find("\"sound_seed_count\": 9") != std::string::npos,
        "shared SFX seeds synthesize one sample");
    require(audioAliasManifest.find("\"sound_alias_count\": 10") != std::string::npos,
        "shared SFX seeds retain every named alias");
    require(audioAliasSource.find("{\"sfx0\", 555555, 4}") != std::string::npos
            && audioAliasSource.find("{\"sfx1\", 555555, 4}") != std::string::npos,
        "shared SFX aliases point at the same Maxmod sample ID");

    const std::filesystem::path randomAgainOutput =
        root / "build" / "native" / "gba_random_again_test_output";
    std::filesystem::remove_all(randomAgainOutput);
    puzzlescript::gba::ExportOptions randomAgainOptions = options;
    randomAgainOptions.sourcePath = root / "src" / "demo" / "againexample.txt";
    randomAgainOptions.outputDirectory = randomAgainOutput;
    const auto randomAgainResult = puzzlescript::gba::exportGame(randomAgainOptions);
    const std::string randomAgainRules = readFile(randomAgainResult.generatedRulesPath);
    require(randomAgainRules.find("options.againPolicy = puzzlescript::AgainPolicy::Yield") != std::string::npos,
        "random GBA games retain RNG-consuming again probes for desktop compatibility");

    const std::filesystem::path propertyNoopOutput =
        root / "build" / "native" / "gba_property_noop_test_output";
    std::filesystem::remove_all(propertyNoopOutput);
    puzzlescript::gba::ExportOptions propertyNoopOptions = options;
    propertyNoopOptions.sourcePath = root / "src" / "tests" / "static_analysis_testdata"
        / "object_tags" / "static-preserved-property-movement-noop.txt";
    propertyNoopOptions.outputDirectory = propertyNoopOutput;
    const auto propertyNoopResult = puzzlescript::gba::exportGame(propertyNoopOptions);
    const std::string propertyNoopRules = readFile(propertyNoopResult.generatedRulesPath);
    require(propertyNoopRules.find("changed = compact_turn_simple_replacement_fast_path_movements_0") == std::string::npos,
        "static property-preserving movement replacements emit no redundant write helper");

    const std::filesystem::path titleOutput = root / "build" / "native" / "gba_exporter_title_test_output";
    std::filesystem::remove_all(titleOutput);
    const std::filesystem::path titleImage = titleOutput / "title.ppm";
    writePpm(titleImage, 2, 1, {{{255, 0, 255}}, {{0, 255, 255}}});
    puzzlescript::gba::ExportOptions titleOptions = options;
    titleOptions.outputDirectory = titleOutput;
    titleOptions.titleImagePath = titleImage;
    const auto titleResult = puzzlescript::gba::exportGame(titleOptions);
    const std::string titleManifest = readFile(titleResult.manifestPath);
    const std::string titleSource = readFile(titleResult.generatedSourcePath);
    require(titleManifest.find("\"title_image\": true") != std::string::npos, "manifest records title image");
    require(titleManifest.find("\"title_image_width\": 240") != std::string::npos, "title image is fitted to Mode 4 width");
    require(titleManifest.find("\"title_image_height\": 160") != std::string::npos, "title image is fitted to Mode 4 height");
    require(titleManifest.find("\"palette_count\": 11") != std::string::npos, "title colors share the deduplicated game palette");
    require(titleSource.find("alignas(4) const uint8_t kTitleImagePixels[]") != std::string::npos,
        "title pixels are emitted as aligned ROM data");
    require(titleSource.find("240, 160, kTitleImagePixels") != std::string::npos,
        "generated game view references the title image");

    const std::filesystem::path overflowImage = titleOutput / "too_many_colors.ppm";
    std::vector<std::array<uint8_t, 3>> overflowPixels(PS_GBA_SCREEN_WIDTH * PS_GBA_SCREEN_HEIGHT);
    for (size_t index = 0; index < overflowPixels.size(); ++index) {
        const uint16_t color = static_cast<uint16_t>(index < 300 ? index : 0);
        overflowPixels[index] = {static_cast<uint8_t>((color & 31U) << 3U),
            static_cast<uint8_t>(((color >> 5U) & 31U) << 3U),
            static_cast<uint8_t>(((color >> 10U) & 31U) << 3U)};
    }
    writePpm(overflowImage, PS_GBA_SCREEN_WIDTH, PS_GBA_SCREEN_HEIGHT, overflowPixels);
    puzzlescript::gba::ExportOptions overflowOptions = options;
    overflowOptions.outputDirectory = titleOutput / "overflow";
    overflowOptions.titleImagePath = overflowImage;
    bool paletteRejected = false;
    try {
        (void)puzzlescript::gba::exportGame(overflowOptions);
    } catch (const std::runtime_error& error) {
        paletteRejected = std::string(error.what()).find("palette exceeds 256") != std::string::npos;
    }
    require(paletteRejected, "title image fails export when the combined Mode 4 palette exceeds 256 colors");

    const std::filesystem::path contrastOutput = root / "build" / "native" / "gba_exporter_lcd_contrast_test_output";
    std::filesystem::remove_all(contrastOutput);
    puzzlescript::gba::ExportOptions contrastOptions = options;
    contrastOptions.outputDirectory = contrastOutput;
    contrastOptions.lcdContrast = true;
    const auto contrastResult = puzzlescript::gba::exportGame(contrastOptions);
    const std::string contrastManifest = readFile(contrastResult.manifestPath);
    const std::string contrastSource = readFile(contrastResult.generatedSourcePath);
    require(contrastManifest.find("\"enabled\": true") != std::string::npos
            && contrastManifest.find("\"applied\": true") != std::string::npos
            && contrastManifest.find("\"background_layer_transparent\": true") != std::string::npos,
        "LCD contrast applies the unlit-LCD path by default");
    // text black (0), bg white (0x7fff)
    require(contrastSource.find("0x0, 0x7fff") != std::string::npos
            || contrastSource.find("0x0000, 0x7fff") != std::string::npos,
        "LCD contrast forces white clear and black text");
    require(contrastSource.find("{\"background\", 0, 5, 5, kObject0Pixels, 0x1ffffffU}") != std::string::npos,
        "LCD contrast forces collision-layer-0 background tiles fully transparent");
    // Object white → #CCCCCC then lift → BGR555 0x6f7b.
    require(contrastSource.find("0x6f7b") != std::string::npos
            || contrastSource.find("0x6F7B") != std::string::npos,
        "LCD contrast remaps object white to lifted lightgray");

    const std::filesystem::path darkTextOutput = contrastOutput / "dark-text";
    const std::filesystem::path darkTextSource = contrastOutput / "dark_text.txt";
    {
        std::string sokoban = readFile(root / "src" / "demo" / "sokoban_basic.txt");
        const std::string needle = "homepage www.puzzlescript.net\n";
        const auto pos = sokoban.find(needle);
        require(pos != std::string::npos, "sokoban_basic preamble contains homepage for dark-text fixture");
        sokoban.insert(pos + needle.size(), "text_color #224466\n");
        std::ofstream out(darkTextSource, std::ios::binary | std::ios::trunc);
        out << sokoban;
    }
    puzzlescript::gba::ExportOptions darkTextOptions = contrastOptions;
    darkTextOptions.outputDirectory = darkTextOutput;
    darkTextOptions.sourcePath = darkTextSource;
    const auto darkTextResult = puzzlescript::gba::exportGame(darkTextOptions);
    const std::string darkTextSourceCpp = readFile(darkTextResult.generatedSourcePath);
    require(darkTextSourceCpp.find("0x0, 0x7fff") != std::string::npos
            || darkTextSourceCpp.find("0x0000, 0x7fff") != std::string::npos,
        "LCD contrast forces black text even when authored text_color is dark");

#if PS_MASK_WORD_BITS == 32
    // These fixtures need enough objects/layers that a 64-bit host's mask layout
    // no longer matches GBA's 32-bit packing; keep them on the 32-bit build.
    const std::filesystem::path shadedOutput = contrastOutput / "shaded-reds";
    puzzlescript::gba::ExportOptions shadedOptions = contrastOptions;
    shadedOptions.outputDirectory = shadedOutput;
    shadedOptions.sourcePath = root / "src" / "tests" / "solver_tests" / "Any hole is a goal.txt";
    const auto shadedResult = puzzlescript::gba::exportGame(shadedOptions);
    const std::string shadedManifest = readFile(shadedResult.manifestPath);
    const auto paletteCountPos = shadedManifest.find("\"palette_count\": ");
    require(paletteCountPos != std::string::npos, "shaded-red export records palette_count");
    const int shadedPaletteCount = std::stoi(shadedManifest.substr(paletteCountPos + 17));
    require(shadedPaletteCount >= 15,
        "LCD contrast retains shaded red distinctions instead of snapping to a tiny fixed palette");

    const std::filesystem::path paleTextOutput = contrastOutput / "pale-text";
    puzzlescript::gba::ExportOptions paleTextOptions = contrastOptions;
    paleTextOptions.outputDirectory = paleTextOutput;
    paleTextOptions.sourcePath = root / "src" / "tests" / "solver_tests" / "a clear view of the sky.txt";
    const auto paleTextResult = puzzlescript::gba::exportGame(paleTextOptions);
    const std::string paleTextSource = readFile(paleTextResult.generatedSourcePath);
    require(paleTextSource.find("0x0, 0x7fff") != std::string::npos
            || paleTextSource.find("0x0000, 0x7fff") != std::string::npos,
        "LCD contrast forces black text on white clear for pale authored text_color");
#endif

    const std::filesystem::path contrastTitleOutput = contrastOutput / "title";
    std::filesystem::create_directories(contrastTitleOutput);
    const std::filesystem::path contrastTitleImage = contrastTitleOutput / "title.ppm";
    writePpm(contrastTitleImage, 2, 1, {{{0, 0, 0}}, {{255, 255, 255}}});
    puzzlescript::gba::ExportOptions contrastTitleOptions = contrastOptions;
    contrastTitleOptions.outputDirectory = contrastTitleOutput;
    contrastTitleOptions.titleImagePath = contrastTitleImage;
    const auto contrastTitleResult = puzzlescript::gba::exportGame(contrastTitleOptions);
    const std::string contrastTitleManifest = readFile(contrastTitleResult.manifestPath);
    require(contrastTitleManifest.find("\"applied\": true") != std::string::npos
            && contrastTitleManifest.find("\"title_image\": true") != std::string::npos,
        "title-image exports still apply LCD contrast");
#if PS_MASK_WORD_BITS != 32
    puzzlescript::gba::ExportOptions wrongWordSizeOptions = options;
    wrongWordSizeOptions.sourcePath = root / "src" / "tests" / "solver_tests" / "BIAXIAL INVASION OF SATURN.txt";
    wrongWordSizeOptions.outputDirectory = output / "wrong-word-size";
    bool wordSizeRejected = false;
    try {
        (void)puzzlescript::gba::exportGame(wrongWordSizeOptions);
    } catch (const std::runtime_error& error) {
        wordSizeRejected = std::string(error.what()).find("PS_MASK_WORD_BITS=32") != std::string::npos;
    }
    require(wordSizeRejected, "64-bit host rejects GBA exports whose movement masks require 32-bit repacking");
#endif
    return 0;
}
