#include "gbc/exporter.hpp"

#include "runtime/core.hpp"

#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <sstream>
#include <stdexcept>
#include <string>

#ifndef PS_REPO_ROOT
#error PS_REPO_ROOT is required
#endif

namespace {

void require(bool condition, const char* message) {
    if (condition) return;
    std::cerr << "gbc_exporter: " << message << "\n";
    std::exit(1);
}

std::string readFile(const std::filesystem::path& path) {
    std::ifstream input(path, std::ios::binary);
    std::ostringstream out;
    out << input.rdbuf();
    return out.str();
}

void writeFile(const std::filesystem::path& path, const std::string& value) {
    std::filesystem::create_directories(path.parent_path());
    std::ofstream output(path, std::ios::binary | std::ios::trunc);
    output << value;
}

} // namespace

int main() {
    const std::filesystem::path root = PS_REPO_ROOT;
    const std::filesystem::path output =
        root / "build" / "native" / "gbc_exporter_test_output";
    std::filesystem::remove_all(output);
    puzzlescript::gbc::ExportOptions options;
    options.sourcePath = root / "src" / "demo" / "sokoban_basic.txt";
    options.outputDirectory = output;
    const auto first = puzzlescript::gbc::exportGame(options);
    require(std::filesystem::exists(first.manifestPath), "manifest is generated");
    require(std::filesystem::exists(first.generatedHeaderPath), "generated header is generated");
    require(std::filesystem::exists(first.generatedSourcePath), "generated C is generated");
    require(
        std::filesystem::exists(first.generatedSpecializedTurnPath),
        "specialized turn stub is generated for Sokoban");
    require(
        first.generatedSpecializedTurnPath.filename() == "generated_specialized_turn.c",
        "specialized turn stub uses the expected filename");

    const std::string manifest = readFile(first.manifestPath);
    require(manifest.find("\"runtime_profile\": \"bounded_interpreter_c\"") != std::string::npos,
        "manifest records the bounded C runtime");
    require(
        manifest.find("\"specialized_turn\": true") != std::string::npos,
        "manifest records compact-turn support for Sokoban");
    require(
        manifest.find("\"single_player_cell\": true") != std::string::npos,
        "manifest records single-player certification for Sokoban");

    const std::string specializedTurn = readFile(first.generatedSpecializedTurnPath);
    require(
        specializedTurn.find("ps_gbc_specialized_apply_turn_phases")
            != std::string::npos
            && specializedTurn.find("ps_gbc_specialized_seed_player_movement")
                != std::string::npos
            && specializedTurn.find("#if PS_GBC_GENERATED_SINGLE_PLAYER_CELL")
                != std::string::npos
            && specializedTurn.find("ps_gbc_specialized_player_cell")
                != std::string::npos
            && specializedTurn.find("ps_gbc_specialized_refresh_player_cell")
                != std::string::npos
            && specializedTurn.find("ps_gbc_facade_apply_groups") == std::string::npos
            && specializedTurn.find("ps_gbc_specialized_patterns") == std::string::npos
            && specializedTurn.find("ps_gbc_specialized_pattern_matches") == std::string::npos
            && specializedTurn.find("ps_gbc_specialized_apply_replacement") == std::string::npos
            && specializedTurn.find("ps_gbc_specialized_rule_matches_at") == std::string::npos
            && specializedTurn.find("ps_gbc_specialized_apply_early") != std::string::npos
            && specializedTurn.find("ps_gbc_specialized_apply_late") != std::string::npos
            && specializedTurn.find("ps_gbc_resolve_movements(session)") != std::string::npos
            && specializedTurn.find("ps_gbc_apply_rules_and_movement") == std::string::npos
            && specializedTurn.find("ps_gbc_facade_get_objects") != std::string::npos
            && specializedTurn.find("& 0x") != std::string::npos,
        "specialized turn emits inline literal match/apply without pattern-table helpers");

    {
        puzzlescript::Rule unsupportedRule;
        unsupportedRule.patterns = {{{}}};
        unsupportedRule.ellipsisCount = {0};
        unsupportedRule.commands.push_back({"unsupported_test_command", std::nullopt});
        puzzlescript::Game unsupportedGame;
        unsupportedGame.rules = {{unsupportedRule}};

        const std::filesystem::path unsupportedDir =
            output / "unsupported_specialized_turn_cleanup";
        std::filesystem::create_directories(unsupportedDir);
        const std::filesystem::path stalePath =
            unsupportedDir / "generated_specialized_turn.c";
        writeFile(stalePath, "/* stale marker */\n");

        const auto unsupportedInfo = puzzlescript::gbc::writeSpecializedTurnArtifacts(
            unsupportedGame, unsupportedDir, false);
        require(
            !unsupportedInfo.supported,
            "compact-turn support rejects synthetic unsupported commands");
        require(
            unsupportedInfo.generatedPath.empty(),
            "unsupported export clears the specialized turn result path");
        require(
            !std::filesystem::exists(stalePath),
            "unsupported export deletes a stale specialized turn stub");
    }

    require(manifest.find("\"object_count\": 5") != std::string::npos,
        "manifest records the lowered object count");
    require(manifest.find("\"collision_layer_count\": 3") != std::string::npos,
        "manifest retains every lowered collision layer");
    require(manifest.find("\"movement_layer_count\": 1") != std::string::npos,
        "manifest culls static collision layers from movement storage");
    require(manifest.find("\"movement_bytes_per_cell\": 1") != std::string::npos,
        "manifest selects byte-wide movement cells for one live lane");
    require(manifest.find("\"object_bytes_per_cell\": 1") != std::string::npos,
        "manifest selects byte-wide object cells for five objects");
    require(manifest.find("\"single_pass_group_count\": 1") != std::string::npos,
        "manifest records the certified single-pass Sokoban group");
    require(
        manifest.find("\"source_pattern_count\": 8") != std::string::npos
            && manifest.find("\"shared_pattern_record_count\": 0")
                != std::string::npos,
        "manifest records the no-duplicate pattern control");
    require(manifest.find("\"input_specialized_group_count\": 1") != std::string::npos,
        "manifest records the certified input-specialized Sokoban group");
    require(manifest.find("\"active_early_rules_by_input\": [1, 1, 1, 1, 0, 0]")
            != std::string::npos,
        "manifest records the rules reachable from each input");
    require(manifest.find("\"board_cells\": 90") != std::string::npos,
        "manifest advertises the hardware board ceiling");
    require(
        manifest.find("\"rendered_cell_width\": 16") != std::string::npos
            && manifest.find("\"rendered_cell_height\": 16") != std::string::npos,
        "manifest records the fixed 16x16 target cell");
    require(manifest.find("\"session_bytes\": 4096") != std::string::npos,
        "manifest advertises the contiguous WRAM ceiling");
    require(manifest.find("\"snapshot_sram_bytes\": 210") != std::string::npos,
        "manifest budgets four undo states and a checkpoint in SRAM");
    require(
        manifest.find("\"precomposed_composition_count\": 6")
                != std::string::npos
            && manifest.find("\"precomposed_composition_bytes\": 414")
                != std::string::npos,
        "manifest records the bounded level-mask tile table");
    require(
        manifest.find("\"run_rules_on_level_start\": false")
            != std::string::npos,
        "manifest records the absence of a level-start rule pass");
    require(
        manifest.find("\"audio_supported\": true") != std::string::npos
            && manifest.find("\"sound_seed_count\": 1") != std::string::npos
            && manifest.find("\"sound_mask_count\": 1") != std::string::npos
            && manifest.find("\"audio\"") == std::string::npos,
        "manifest records compact cartridge audio instead of omitting it");

    const std::string header = readFile(first.generatedHeaderPath);
    const std::string source = readFile(first.generatedSourcePath);
    require(header.find("PS_GBC_GENERATED_ROM_BANK 1U") != std::string::npos,
        "generated data declares its switchable ROM bank");
    require(header.find("PS_GBC_GENERATED_SESSION_BYTES 393U") != std::string::npos,
        "generated header budgets the player-cell anchor list");
    require(header.find("PS_GBC_GENERATED_MOVEMENT_BYTES_PER_CELL 1U") != std::string::npos,
        "generated header exposes the compile-time movement cell width");
    require(header.find("PS_GBC_GENERATED_OBJECT_BYTES_PER_CELL 1U") != std::string::npos,
        "generated header exposes the compile-time object cell width");
    require(
        header.find("PS_GBC_GENERATED_OBJECT_PRESENCE_PRECHECK_COUNT 0U")
            != std::string::npos,
        "generated header compiles out unprofitable Sokoban presence checks");
    require(
        header.find("PS_GBC_GENERATED_PACKED_PATTERNS 1") != std::string::npos
            && header.find("PS_GBC_GENERATED_PATTERN_BYTES 10U")
                != std::string::npos
            && manifest.find("\"pattern_record_bytes\": 10")
                != std::string::npos,
        "generated Sokoban patterns use byte-wide object and movement masks");
    require(
        header.find("PS_GBC_GENERATED_ABI_VERSION 19U") != std::string::npos
            && source.find("    19U, 0x") != std::string::npos
            && manifest.find("\"abi_version\": 19") != std::string::npos,
        "generated data bakes in the exporter ABI for stale-tool detection");
    require(
        header.find("PS_GBC_GENERATED_PACKED_RULES 1") != std::string::npos
            && header.find("PS_GBC_GENERATED_RULE_BYTES 5U")
                != std::string::npos
            && header.find("PS_GBC_GENERATED_RULE_MESSAGE_COUNT 0U")
                != std::string::npos
            && manifest.find("\"rule_record_bytes\": 5")
                != std::string::npos,
        "generated Sokoban rules omit absent sound and message fields");
    require(
        header.find("PS_GBC_GENERATED_PLAYER_CELL_ANCHOR_COUNT 2U")
            != std::string::npos,
        "generated header records first-pattern player anchors");
    require(
        header.find("PS_GBC_GENERATED_CELL_WIDTH 5U") != std::string::npos
            && header.find("PS_GBC_GENERATED_CELL_HEIGHT 5U") != std::string::npos
            && header.find("PS_GBC_GENERATED_CELL_PIXELS 25U") != std::string::npos
            && header.find("PS_GBC_GENERATED_RENDER_OBJECT_COUNT 5U")
                != std::string::npos
            && header.find("PS_GBC_GENERATED_PRECOMPOSED_COMPOSITION_COUNT 6U")
                != std::string::npos,
        "generated header preserves the native PuzzleScript cell dimensions");
    require(source.find("#pragma bank 1") != std::string::npos,
        "generated data is linked outside fixed ROM bank zero");
    require(source.find("static const ps_gbc_generated_pattern kPatterns[]")
            != std::string::npos,
        "lowered fixed patterns are emitted as C data");
    require(source.find("static const ps_gbc_generated_rule kRules[]")
            != std::string::npos,
        "lowered rules use the generated game-specific record");
    require(source.find("PS_GBC_RULE_GROUP_SINGLE_PASS") != std::string::npos,
        "certified groups skip their redundant confirmation pass");
    require(source.find("PS_GBC_RULE_GROUP_INPUT_QUARTET") != std::string::npos,
        "certified directional groups select only the current input block");
    require(source.find("static const uint8_t kLevel0Cells[]") != std::string::npos,
        "level object masks use the selected byte-wide storage");
    require(
        source.find("static const ps_gbc_object kObjects[] = {\n    {0U, 255U}")
                != std::string::npos
            && source.find(
                "const ps_gbc_render_object ps_gbc_generated_render_objects[]")
                != std::string::npos
            && source.find("{0x1U, kObject0Pixels, 0U}") != std::string::npos,
        "generated objects separate movement metadata from ordered render data");
    require(
        source.find(
            "static const uint8_t kObject3Pixels[] = {14U, 14U, 14U, 15U, 14U")
            != std::string::npos,
        "5x5 sprite arrays retain the native pixels used by 16x16 upscaling");
    require(
        source.find(
            "ps_gbc_generated_precomposed_masks[] = {0x9U, 0x1U, 0x13U, "
            "0x3U, 0x5U, 0x11U}") != std::string::npos
            && source.find(
                "ps_gbc_generated_precomposed_tiles[] = {0U, 255U, 0U, 255U")
                != std::string::npos,
        "frequent level masks receive deterministic precomposed 16x16 tiles");
    require(
        source.find(
            "static const uint16_t kBackgroundPalettes[] = {6965U, 3658U, 0U, 0U, "
            "6965U, 3658U, 8355U, 0U, 6965U, 3658U, 0U, 7773U, "
            "6965U, 3658U, 4565U, 6443U, 6965U, 3658U, 7773U, 8355U")
            != std::string::npos,
        "object palettes reserve neighboring background colours and retain "
        "visible lower layers when capacity permits");
    require(source.find("static const uint16_t kUiPalette[] = {0U, 32767U, 32767U, 32767U}")
            != std::string::npos,
        "generated game emits an explicit background/text UI palette");
    require(
        source.find("kPalettePriorities") == std::string::npos
            && source.find("kExactPaletteCandidates") == std::string::npos
            && source.find("kBackgroundPhaseTiles") == std::string::npos,
        "generated data omits packed-cell palette and phase heuristics");
    require(source.find("kMovementCollisionLayers[] = {2U}") != std::string::npos,
        "the moving Sokoban layer is remapped to compact lane zero");
    require(
        source.find("static const int32_t kSoundSeeds[] = {36772507}")
                != std::string::npos
            && source.find("static const ps_gbc_sound_mask kMovementSounds[]")
                != std::string::npos,
        "movement sound seeds and masks are emitted as compact cartridge data");
    require(source.find("const ps_gbc_game_view ps_gbc_generated_game") != std::string::npos,
        "generated C exports the cartridge ABI root");

    const auto second = puzzlescript::gbc::exportGame(options);
    require(readFile(first.generatedSourcePath) == readFile(second.generatedSourcePath),
        "repeated exports are deterministic");

    puzzlescript::gbc::ExportOptions presenceOptions;
    presenceOptions.sourcePath =
        root / "src" / "tests" / "good_games" / "Xorro The Chaos Warden.txt";
    presenceOptions.outputDirectory = output / "presence";
    presenceOptions.cullOversizeLevels = true;
    const auto presenceResult = puzzlescript::gbc::exportGame(presenceOptions);
    const std::string presenceManifest = readFile(presenceResult.manifestPath);
    const std::string presenceHeader = readFile(presenceResult.generatedHeaderPath);
    const std::string presenceSource = readFile(presenceResult.generatedSourcePath);
    require(
        presenceManifest.find("\"object_presence_precheck_rule_count\": 22")
                != std::string::npos
            && presenceManifest.find("\"single_pass_group_count\": 3")
                != std::string::npos
            && presenceHeader.find(
                "PS_GBC_GENERATED_OBJECT_PRESENCE_PRECHECK_COUNT 22U")
                != std::string::npos
            && presenceManifest.find("\"player_cell_anchor_rule_count\": 6")
                != std::string::npos
            && presenceHeader.find(
                "PS_GBC_GENERATED_PLAYER_CELL_ANCHOR_COUNT 6U")
                != std::string::npos
            && presenceManifest.find("\"source_pattern_count\": 126")
                != std::string::npos
            && presenceManifest.find("\"pattern_count\": 62")
                != std::string::npos
            && presenceManifest.find("\"shared_pattern_record_count\": 64")
                != std::string::npos
            && presenceSource.find("PS_GBC_RULE_OBJECT_PRESENCE_PRECHECK")
                != std::string::npos,
        "compact games emit presence prechecks and player-cell anchors");

    puzzlescript::gbc::ExportOptions wideObjectOptions;
    wideObjectOptions.sourcePath =
        root / "src" / "tests" / "good_games" / "slot machine.txt";
    wideObjectOptions.outputDirectory = output / "wide_objects";
    wideObjectOptions.cullOversizeLevels = true;
    const auto wideObjectResult = puzzlescript::gbc::exportGame(wideObjectOptions);
    const std::string wideObjectManifest = readFile(wideObjectResult.manifestPath);
    const std::string wideObjectHeader = readFile(wideObjectResult.generatedHeaderPath);
    require(
        wideObjectManifest.find("\"player_cell_anchor_rule_count\": 0")
                != std::string::npos
            && wideObjectManifest.find("\"single_pass_group_count\": 12")
                != std::string::npos
            && wideObjectHeader.find(
                "PS_GBC_GENERATED_PLAYER_CELL_ANCHOR_COUNT 0U")
                != std::string::npos
            && wideObjectHeader.find("PS_GBC_GENERATED_PATTERN_BYTES 22U")
                != std::string::npos,
        "wide-object games compile out the player index and certify singleton groups");

    puzzlescript::gbc::ExportOptions contrastOptions;
    contrastOptions.sourcePath =
        root / "native" / "tests" / "fixtures" / "gbc_contrast.txt";
    contrastOptions.outputDirectory = output / "contrast";
    const auto contrastResult = puzzlescript::gbc::exportGame(contrastOptions);
    const std::string contrastManifest = readFile(contrastResult.manifestPath);
    const std::string contrastSource = readFile(contrastResult.generatedSourcePath);
    require(
        contrastManifest.find("\"mode\": \"optimized_gameplay_gamut\"")
                != std::string::npos
            && contrastManifest.find(
                "\"anchor_policy\": \"background_and_object_colors\"")
                != std::string::npos
            && contrastManifest.find(
                "\"foreground_metadata_used_as_anchor\": false")
                != std::string::npos
            && contrastManifest.find(
                "\"foreground_metadata\": {\"source\": \"#FFFFFF\", "
                "\"literal_bgr555\": 32767, \"stretched_bgr555\": 32767}")
                != std::string::npos
            && contrastManifest.find("\"source_color_count\": 4")
                != std::string::npos
            && contrastManifest.find("\"source_brightness_level_count\": 4")
                != std::string::npos
            && contrastManifest.find("\"stretched_brightness_level_count\": 4")
                != std::string::npos,
        "manifest records the optimized game-wide brightness gamut stretch");
    require(
        contrastManifest.find(
            "{\"source\": \"#202020\", \"literal_bgr555\": 4228, "
            "\"stretched_bgr555\": 0}") != std::string::npos
            && contrastManifest.find(
                "{\"source\": \"#404040\", \"literal_bgr555\": 8456, "
                "\"stretched_bgr555\": 10570}") != std::string::npos
            && contrastManifest.find(
                "{\"source\": \"#804020\", \"literal_bgr555\": 4368, "
                "\"stretched_bgr555\": 341}") != std::string::npos
            && contrastManifest.find(
                "{\"source\": \"#E0E0E0\", \"literal_bgr555\": 29596, "
                "\"stretched_bgr555\": 32767}") != std::string::npos,
        "manifest lists every source colour and its literal and stretched CGB values");
    require(
        contrastManifest.find("\"literal_bgr555_collision_count\": 0")
                != std::string::npos
            && contrastManifest.find("\"stretched_bgr555_collision_count\": 0")
                != std::string::npos
            && contrastManifest.find("\"minimum_pair_distance_before\": 48")
                != std::string::npos
            && contrastManifest.find("\"minimum_pair_distance_after\": 221")
                != std::string::npos,
        "manifest quantifies collision-free minimum contrast improvement");
    require(
        contrastManifest.find("\"minimum_brightness_before\": 4")
                != std::string::npos
            && contrastManifest.find("\"maximum_brightness_before\": 28")
                != std::string::npos
            && contrastManifest.find("\"minimum_brightness_after\": 0")
                != std::string::npos
            && contrastManifest.find("\"maximum_brightness_after\": 31")
                != std::string::npos,
        "gameplay brightness reaches both CGB gamut endpoints without using "
        "the white metadata foreground as an anchor");
    require(
        contrastSource.find(
            "static const uint16_t kUiPalette[] = {0U, 32767U, 32767U, 32767U}")
                != std::string::npos
            && contrastSource.find("0U, 10570U, 341U, 32767U")
                != std::string::npos,
        "the generated cartridge uses the stretched endpoint and midtone colours");

    puzzlescript::gbc::ExportOptions literalFallbackOptions;
    literalFallbackOptions.sourcePath =
        root / "src" / "tests" / "good_games" / "Recondite Star Sector Sigma.txt";
    literalFallbackOptions.outputDirectory = output / "contrast_literal_fallback";
    literalFallbackOptions.cullOversizeLevels = true;
    const auto literalFallbackResult =
        puzzlescript::gbc::exportGame(literalFallbackOptions);
    const std::string literalFallbackManifest =
        readFile(literalFallbackResult.manifestPath);
    require(
        literalFallbackManifest.find(
            "\"curve\": \"brightness_linear_rank_blend\"")
                != std::string::npos
            && literalFallbackManifest.find("\"minimum_pair_distance_before\": 194")
                != std::string::npos
            && literalFallbackManifest.find("\"minimum_pair_distance_after\": 209")
                != std::string::npos,
        "an already full-gamut game still redistributes intermediate brightness "
        "levels when that improves its closest-pair contrast");

    puzzlescript::gbc::ExportOptions audioOptions;
    audioOptions.sourcePath =
        root / "native" / "tests" / "fixtures" / "gbc_audio.txt";
    audioOptions.outputDirectory = output / "audio";
    const auto audioResult = puzzlescript::gbc::exportGame(audioOptions);
    const std::string audioManifest = readFile(audioResult.manifestPath);
    const std::string audioSource = readFile(audioResult.generatedSourcePath);
    const std::string audioHeader = readFile(audioResult.generatedHeaderPath);
    require(
        audioManifest.find("\"sound_seed_count\": 7") != std::string::npos
            && audioManifest.find("\"rule_sound_reference_count\": 4")
                != std::string::npos
            && audioManifest.find("\"sound_mask_count\": 4")
                != std::string::npos,
        "audio fixture reports named, rule, and mask sound data");
    require(
        audioSource.find(
            "kNamedSoundIds[] = {255U, 255U, 255U, 0U, 255U, "
            "255U, 1U, 255U, 255U, 255U}")
                != std::string::npos
            && audioSource.find("kRuleSoundIds[] = {6U, 6U, 6U, 6U}")
                != std::string::npos
            && audioSource.find("kCreationSounds[]") != std::string::npos
            && audioSource.find("kDestructionSounds[]") != std::string::npos
            && audioSource.find("kMovementFailureSounds[]") != std::string::npos,
        "audio fixture emits compact named, rule, and trigger tables");
    require(
        audioHeader.find("PS_GBC_GENERATED_SOUND_COUNT 7U")
                != std::string::npos
            && audioHeader.find("PS_GBC_GENERATED_RULE_SOUND_COUNT 4U")
                != std::string::npos
            && audioHeader.find("PS_GBC_GENERATED_RULE_BYTES 7U")
                != std::string::npos,
        "audio fixture emits sound-count specialization constants");

    puzzlescript::gbc::ExportOptions messageAudioOptions;
    messageAudioOptions.sourcePath =
        root / "native" / "tests" / "gba_audio_parity.txt";
    messageAudioOptions.outputDirectory = output / "message_audio";
    const auto messageAudioResult =
        puzzlescript::gbc::exportGame(messageAudioOptions);
    const std::string messageAudioHeader =
        readFile(messageAudioResult.generatedHeaderPath);
    const std::string messageAudioSource =
        readFile(messageAudioResult.generatedSourcePath);
    require(
        messageAudioHeader.find("PS_GBC_GENERATED_RULE_MESSAGE_COUNT 1U")
                != std::string::npos
            && messageAudioHeader.find("PS_GBC_GENERATED_RULE_BYTES 9U")
                != std::string::npos
            && messageAudioSource.find("\"Audio parity\"")
                != std::string::npos,
        "games with rule sounds and messages retain the complete rule record");

    const std::string minimalPrefix =
        "title GBC Fixed Cell Limits\n\n"
        "========\nOBJECTS\n========\n\n"
        "Background\nblack\n0\n\n"
        "Player\nwhite\n0\n\n"
        "=======\nLEGEND\n=======\n\n"
        ". = Background\nP = Background and Player\n\n"
        "================\nCOLLISIONLAYERS\n================\n\n"
        "Background\nPlayer\n\n"
        "======\nRULES\n======\n\n"
        "right [ > Player ] -> [ > Player ]\n\n"
        "==============\nWINCONDITIONS\n==============\n\n"
        "some Player\n\n"
        "=======\nLEVELS\n=======\n\n";
    bool rejectedWideBoard = false;
    const std::filesystem::path wideBoardPath = output / "wide_board_source.txt";
    writeFile(
        wideBoardPath,
        minimalPrefix + "message intro\n\nPPPPPPPPPPP\n\nP\n");
    try {
        puzzlescript::gbc::ExportOptions wideBoard;
        wideBoard.sourcePath = wideBoardPath;
        wideBoard.outputDirectory = output / "wide_board";
        (void)puzzlescript::gbc::exportGame(wideBoard);
    } catch (const std::runtime_error& error) {
        rejectedWideBoard =
            std::string(error.what()).find("10x9") != std::string::npos;
    }
    require(rejectedWideBoard,
        "the exporter rejects an 11-cell-wide board under the fixed 16x16 layout");

    puzzlescript::gbc::ExportOptions culledWideBoard;
    culledWideBoard.sourcePath = wideBoardPath;
    culledWideBoard.outputDirectory = output / "wide_board_culled";
    culledWideBoard.cullOversizeLevels = true;
    const auto culledWideBoardResult =
        puzzlescript::gbc::exportGame(culledWideBoard);
    const std::string culledWideBoardManifest =
        readFile(culledWideBoardResult.manifestPath);
    require(
        culledWideBoardManifest.find("\"level_count\": 2")
                != std::string::npos
            && culledWideBoardManifest.find("\"source_level_count\": 3")
                != std::string::npos
            && culledWideBoardManifest.find("\"board_level_count\": 1")
                != std::string::npos
            && culledWideBoardManifest.find("\"source_board_level_count\": 2")
                != std::string::npos
            && culledWideBoardManifest.find("\"culled_level_count\": 1")
                != std::string::npos
            && culledWideBoardManifest.find("\"culled_level_indices\": [1]")
                != std::string::npos,
        "opt-in culling preserves messages and legal boards with source accounting");
    require(
        culledWideBoardManifest.find(
            "\"diagnostics\": [\"culled 1 oversized board level\"]")
            != std::string::npos,
        "the manifest diagnoses opt-in oversized-level culling");

    bool rejectedAllCulled = false;
    const std::filesystem::path allWidePath = output / "all_wide_source.txt";
    writeFile(allWidePath, minimalPrefix + "PPPPPPPPPPP\n");
    try {
        puzzlescript::gbc::ExportOptions allWide;
        allWide.sourcePath = allWidePath;
        allWide.outputDirectory = output / "all_wide_culled";
        allWide.cullOversizeLevels = true;
        (void)puzzlescript::gbc::exportGame(allWide);
    } catch (const std::runtime_error& error) {
        rejectedAllCulled =
            std::string(error.what()).find("removed every board level")
            != std::string::npos;
    }
    require(rejectedAllCulled,
        "opt-in culling still requires at least one playable board");

    const std::filesystem::path maximumBoardPath =
        output / "maximum_board_source.txt";
    writeFile(
        maximumBoardPath,
        minimalPrefix
            + "PPPPPPPPPP\nPPPPPPPPPP\nPPPPPPPPPP\n"
              "PPPPPPPPPP\nPPPPPPPPPP\nPPPPPPPPPP\n"
              "PPPPPPPPPP\nPPPPPPPPPP\nPPPPPPPPPP\n");
    puzzlescript::gbc::ExportOptions maximumBoard;
    maximumBoard.sourcePath = maximumBoardPath;
    maximumBoard.outputDirectory = output / "maximum_board";
    const auto maximumBoardResult =
        puzzlescript::gbc::exportGame(maximumBoard);
    require(
        readFile(maximumBoardResult.manifestPath).find(
            "\"max_level_cells\": 90")
            != std::string::npos,
        "the exact 10x9 board boundary remains exportable");
    require(
        readFile(maximumBoardResult.generatedSourcePath).find(
            "kObject0Pixels[] = {255U, 255U, 255U, 255U, 255U, "
            "255U, 255U, 255U, 255U, 255U, 255U, 255U, 0U, 255U")
            != std::string::npos,
        "smaller source sprites are centered in the exported 5x5 render cell");

    bool rejectedWideSprite = false;
    std::string wideSpriteSource = minimalPrefix;
    const size_t backgroundSprite = wideSpriteSource.find("Background\nblack\n0");
    wideSpriteSource.replace(
        backgroundSprite,
        std::string("Background\nblack\n0").size(),
        "Background\nblack\n000000\n000000\n000000\n000000\n000000\n000000");
    const std::filesystem::path wideSpritePath = output / "wide_sprite_source.txt";
    writeFile(wideSpritePath, wideSpriteSource + "P\n");
    try {
        puzzlescript::gbc::ExportOptions wideSprite;
        wideSprite.sourcePath = wideSpritePath;
        wideSprite.outputDirectory = output / "wide_sprite";
        (void)puzzlescript::gbc::exportGame(wideSprite);
    } catch (const std::runtime_error& error) {
        rejectedWideSprite =
            std::string(error.what()).find("fixed 5x5") != std::string::npos;
    }
    require(rejectedWideSprite,
        "the exporter rejects source sprites wider than the fixed 5x5 cell");

    puzzlescript::gbc::ExportOptions levelStart;
    levelStart.sourcePath =
        root / "native" / "tests" / "fixtures" / "gbc_level_start_rules.txt";
    levelStart.outputDirectory = output / "level_start";
    const auto levelStartResult = puzzlescript::gbc::exportGame(levelStart);
    const std::string levelStartManifest =
        readFile(levelStartResult.manifestPath);
    const std::string levelStartSource =
        readFile(levelStartResult.generatedSourcePath);
    require(
        levelStartManifest.find("\"run_rules_on_level_start\": true")
            != std::string::npos,
        "manifest preserves run_rules_on_level_start");
    require(
        levelStartSource.find("kUiPalette,\n    true, false, false, false")
            != std::string::npos,
        "generated ABI enables the level-start rule pass");

    puzzlescript::gbc::ExportOptions staticLayers;
    staticLayers.sourcePath =
        root / "native" / "tests" / "fixtures" / "gbc_static_collision_layers.txt";
    staticLayers.outputDirectory = output / "static_layers";
    const auto staticResult = puzzlescript::gbc::exportGame(staticLayers);
    const std::string staticManifest = readFile(staticResult.manifestPath);
    const std::string staticSource = readFile(staticResult.generatedSourcePath);
    require(staticManifest.find("\"collision_layer_count\": 7") != std::string::npos,
        "more than five collision layers survive export");
    require(staticManifest.find("\"movement_layer_count\": 1") != std::string::npos,
        "six dormant collision layers consume no movement lanes");
    require(staticManifest.find("\"movement_bytes_per_cell\": 1") != std::string::npos,
        "a single live lane selects one-byte movement cells");
    require(staticSource.find("kMovementCollisionLayers[] = {6U}") != std::string::npos,
        "the high source collision layer remaps to compact movement lane zero");
    require(staticSource.find(
            "0x2U, 0x0U, 0x2U, 0x0U, 0x0U, 0x0U, 0x0U, 0x0U, 0x0U, 117U")
            != std::string::npos,
        "an impossible movement-present predicate is retained as never-matching");
    require(staticSource.find(
            "0x4U, 0x0U, 0xcU, 0xcU, 0x0U, 0x0U, 0x0U, 0x0U, 0x0U, 57U")
            != std::string::npos,
        "a dormant stationary predicate is folded to an always-true movement mask");

    std::ostringstream maxCollisionSource;
    maxCollisionSource << "title GBC Maximum Collision Layers\n\n"
        << "========\nOBJECTS\n========\n\n"
        << "Background\nblack\n0\n\n"
        << "Player\nwhite\n0\n\n";
    for (int index = 0; index < 30; ++index) {
        maxCollisionSource << "D" << index << "\nred\n0\n\n";
    }
    maxCollisionSource << "=======\nLEGEND\n=======\n\n"
        << ". = Background\nP = Background and Player\n\n"
        << "================\nCOLLISIONLAYERS\n================\n\n"
        << "Background\nPlayer\n";
    for (int index = 0; index < 30; ++index) {
        maxCollisionSource << "D" << index << "\n";
    }
    maxCollisionSource << "\n======\nRULES\n======\n\n"
        << "right [ > D0 ] -> [ ]\n\n"
        << "==============\nWINCONDITIONS\n==============\n\n"
        << "some Player on D0\n\n"
        << "=======\nLEVELS\n=======\n\nP\n";
    const std::filesystem::path maxCollisionPath = output / "max_collision_source.txt";
    writeFile(maxCollisionPath, maxCollisionSource.str());
    puzzlescript::gbc::ExportOptions maxCollision;
    maxCollision.sourcePath = maxCollisionPath;
    maxCollision.outputDirectory = output / "max_collision";
    const auto maxCollisionResult = puzzlescript::gbc::exportGame(maxCollision);
    const std::string maxCollisionManifest = readFile(maxCollisionResult.manifestPath);
    require(maxCollisionManifest.find("\"object_count\": 32") != std::string::npos,
        "the object-count boundary remains exportable");
    require(maxCollisionManifest.find("\"collision_layer_count\": 32")
            != std::string::npos,
        "all 32 collision layers remain represented");
    require(maxCollisionManifest.find("\"movement_layer_count\": 1")
            != std::string::npos,
        "31 dormant layers do not inflate movement storage");
    require(maxCollisionManifest.find("\"object_bytes_per_cell\": 4")
            != std::string::npos,
        "the 32-object boundary retains 32-bit object cells");

    puzzlescript::gbc::ExportOptions threeMovers;
    threeMovers.sourcePath =
        root / "native" / "tests" / "fixtures" / "gbc_three_movement_layers.txt";
    threeMovers.outputDirectory = output / "three_movers";
    const auto threeResult = puzzlescript::gbc::exportGame(threeMovers);
    const std::string threeManifest = readFile(threeResult.manifestPath);
    require(threeManifest.find("\"movement_layer_count\": 3") != std::string::npos,
        "three originating layers are discovered by shared static analysis");
    require(threeManifest.find("\"movement_bytes_per_cell\": 2") != std::string::npos,
        "three live lanes select two-byte movement cells");
    require(threeManifest.find("\"pattern_record_bytes\": 15") != std::string::npos,
        "byte-wide objects and two-byte movements produce 15-byte patterns");

    puzzlescript::gbc::ExportOptions sixMovers;
    sixMovers.sourcePath =
        root / "native" / "tests" / "fixtures" / "gbc_six_movement_layers.txt";
    sixMovers.outputDirectory = output / "six_movers";
    const auto sixResult = puzzlescript::gbc::exportGame(sixMovers);
    const std::string sixManifest = readFile(sixResult.manifestPath);
    require(sixManifest.find("\"movement_layer_count\": 6") != std::string::npos,
        "all six lanes available in a 32-bit movement word are usable");
    require(sixManifest.find("\"movement_bytes_per_cell\": 4") != std::string::npos,
        "six live lanes select four-byte movement cells");
    require(sixManifest.find("\"pattern_record_bytes\": 25") != std::string::npos,
        "byte-wide objects and four-byte movements produce 25-byte patterns");

    puzzlescript::gbc::ExportOptions actionMovement;
    actionMovement.sourcePath =
        root / "native" / "tests" / "fixtures" / "gbc_action_movement_layer.txt";
    actionMovement.outputDirectory = output / "action_movement";
    const auto actionResult = puzzlescript::gbc::exportGame(actionMovement);
    const std::string actionManifest = readFile(actionResult.manifestPath);
    const std::string actionSource = readFile(actionResult.generatedSourcePath);
    require(actionManifest.find("\"movement_layer_count\": 2") != std::string::npos,
        "an action-only RHS movement layer is retained alongside the player layer");
    require(actionSource.find("kMovementCollisionLayers[] = {1U, 2U}")
            != std::string::npos,
        "action-only movement is assigned a compact lane");

    bool rejectedSevenMovers = false;
    try {
        puzzlescript::gbc::ExportOptions sevenMovers;
        sevenMovers.sourcePath =
            root / "native" / "tests" / "fixtures" / "gbc_seven_movement_layers.txt";
        sevenMovers.outputDirectory = output / "seven_movers";
        (void)puzzlescript::gbc::exportGame(sevenMovers);
    } catch (const std::runtime_error& error) {
        rejectedSevenMovers =
            std::string(error.what()).find("at most 6 movement-capable") != std::string::npos;
    }
    require(rejectedSevenMovers,
        "the exporter rejects seven live lanes without rejecting seven collision layers");

    bool rejectedRigid = false;
    try {
        puzzlescript::gbc::ExportOptions rigid;
        rigid.sourcePath = root / "src" / "tests" / "static_analysis_testdata"
            / "movement_action" / "action-rigid-rule.txt";
        rigid.outputDirectory = output / "rigid";
        (void)puzzlescript::gbc::exportGame(rigid);
    } catch (const std::runtime_error& error) {
        rejectedRigid = std::string(error.what()).find("rigid") != std::string::npos;
    }
    require(rejectedRigid, "rigid games are rejected with an explicit structural diagnostic");

    const std::string firmware =
        readFile(root / "firmware" / "gbc" / "source" / "main.c")
        + readFile(root / "firmware" / "gbc" / "source" / "tile_cache.c");
    require(firmware.find("SWITCH_RAM_MBC5(SNAPSHOT_RAM_BANK)") != std::string::npos,
        "firmware stores snapshots in a dedicated SRAM bank");
    require(
        firmware.find("part < PS_GBC_TILES_PER_CELL") != std::string::npos
            && firmware.find("base_tile + part") != std::string::npos
            && firmware.find("VBK_REG = (uint8_t)(tile >> 8U)")
                != std::string::npos,
        "renderer maps each logical cell to an aligned four-tile quartet");
    require(
        firmware.find(
            "0U, 0U, 0U, 1U, 1U, 1U, 2U, 2U,\n"
            "    2U, 2U, 3U, 3U, 3U, 4U, 4U, 4U")
            != std::string::npos,
        "renderer expands the middle 5x5 source row and column to exactly 16");
    require(firmware.find("cpu_fast()") != std::string::npos,
        "firmware enables CGB double-speed mode");

    puzzlescript::gbc::ExportOptions spawnPlayerOptions;
    spawnPlayerOptions.sourcePath =
        root / "native" / "tests" / "fixtures" / "gbc_spawn_second_player.txt";
    spawnPlayerOptions.outputDirectory = output / "spawn_second_player";
    const auto spawnPlayerResult = puzzlescript::gbc::exportGame(spawnPlayerOptions);
    const std::string spawnPlayerManifest = readFile(spawnPlayerResult.manifestPath);
    require(
        spawnPlayerManifest.find("\"single_player_cell\": false")
            != std::string::npos,
        "spawn-player fixture is not single-player certified");
    return 0;
}
