// The native test targets build Release with -DNDEBUG, which would strip every
// assert() in this file and make this test a vacuous no-op. Force assertions on.
#undef NDEBUG

#include <algorithm>
#include <cassert>
#include <fstream>
#include <set>
#include <sstream>
#include <string>
#include <vector>

#include "compiler/lower_to_runtime.hpp"
#include "compiler/parser.hpp"
#include "compiler/semantic_program.hpp"

namespace {

std::string readFixture(const char* relPath) {
    std::ifstream in(relPath);
    std::stringstream buffer;
    buffer << in.rdbuf();
    return buffer.str();
}

} // namespace

int main() {
    const std::string source = readFixture("src/demo/sokoban_basic.txt") + "\n";
    assert(!source.empty());

    puzzlescript::compiler::DiagnosticSink diagnostics;
    const auto state = puzzlescript::compiler::parseSource(source, diagnostics);
    puzzlescript::LoadedGame loadedGame;
    std::vector<puzzlescript::compiler::SemanticRule> authoredRules;
    auto error = puzzlescript::compiler::lowerToRuntimeGame(state, loadedGame, &authoredRules);
    assert(!error);
    assert(loadedGame.information);

    const auto program = puzzlescript::compiler::buildSemanticProgram(*loadedGame.information, authoredRules);

    // sokoban_basic is a single-layer-conforming fixture: every object sits on
    // exactly one collision layer (layer >= 0) and every name is unique. That
    // invariant is the SemanticProgram contract's precondition (enforced over the
    // corpus by semantic_program_parity_corpus_node.js), so these are deliberate
    // conformance checks, not accidental assumptions about all games.
    assert(!program.objects.empty());
    assert(program.objects.front().id == 0);
    std::set<std::string> seenNames;
    for (size_t i = 0; i < program.objects.size(); ++i) {
        assert(program.objects[i].layer >= 0);
        assert(seenNames.insert(program.objects[i].name).second);  // single layer => unique name
        if (i > 0) {
            assert(program.objects[i].id > program.objects[i - 1].id);
        }
    }

    assert(!program.collisionLayers.empty());
    for (const auto& layer : program.collisionLayers) {
        for (int32_t id : layer) {
            assert(id >= 0);
        }
    }

    // Resolved legends: sokoban has 5 synonyms and the aggregate "@" = Crate and
    // Target. Each legend resolves to a sorted set of base object ids; "@" must
    // resolve to {target, crate} on both the C++ and JS sides.
    assert(program.synonyms.size() == 5);
    assert(program.properties.empty());

    int32_t crateId = -1;
    int32_t targetId = -1;
    for (const auto& object : program.objects) {
        if (object.name == "crate") crateId = object.id;
        if (object.name == "target") targetId = object.id;
    }
    assert(crateId >= 0 && targetId >= 0);

    const puzzlescript::compiler::SemanticLegend* atLegend = nullptr;
    for (const auto& legend : program.aggregates) {
        if (legend.name == "@") atLegend = &legend;
    }
    assert(atLegend != nullptr);
    const std::vector<int32_t> expectedAt{
        std::min(crateId, targetId),
        std::max(crateId, targetId),
    };
    assert(atLegend->objectIds == expectedAt);

    // Resolved levels: sokoban_basic has 2 grid level templates (no messages),
    // level 0 is 6x7. Background fill means every cell contains the background
    // object, and each level has exactly one player cell.
    assert(program.levels.size() == 2);

    int32_t backgroundId = -1;
    int32_t playerId = -1;
    for (const auto& object : program.objects) {
        if (object.name == "background") backgroundId = object.id;
        if (object.name == "player") playerId = object.id;
    }
    assert(backgroundId >= 0 && playerId >= 0);

    assert(!program.levels[0].isMessage);
    assert(program.levels[0].width == 6);
    assert(program.levels[0].height == 7);

    for (const auto& level : program.levels) {
        assert(!level.isMessage);
        assert(level.cells.size() == static_cast<size_t>(level.width) * static_cast<size_t>(level.height));
        int playerCells = 0;
        for (const auto& cell : level.cells) {
            assert(std::find(cell.begin(), cell.end(), backgroundId) != cell.end());
            if (std::find(cell.begin(), cell.end(), playerId) != cell.end()) {
                ++playerCells;
            }
        }
        assert(playerCells == 1);
    }

    // Win conditions: sokoban_basic has "all Target on Crate" => quantifier 1
    // (all), filter1 = {target}, filter2 = {crate}, no aggregates.
    assert(program.winConditions.size() == 1);
    const auto& win = program.winConditions[0];
    assert(win.quantifier == 1);
    assert((win.objectIds1 == std::vector<int32_t>{targetId}));
    assert((win.objectIds2 == std::vector<int32_t>{crateId}));
    assert(!win.aggregate1 && !win.aggregate2);

    // Metadata: sokoban_basic declares title/author/homepage (no flickscreen).
    assert(program.metadata.size() == 3);
    assert(program.metadata.count("title") && program.metadata.at("title") == "Simple Block Pushing Game");
    assert(program.metadata.count("author") && program.metadata.at("author") == "David Skinner");
    assert(program.metadata.count("homepage") && program.metadata.at("homepage") == "www.puzzlescript.net");

    // Sounds: sokoban_basic has an empty SOUNDS section.
    assert(program.sounds.events.empty());

    // Rules: sokoban_basic has exactly one authored rule, `[ > Player | Crate ] ->
    // [ > Player | > Crate ]` — group 0, no modifiers/commands, one LHS row of 2
    // cells and one RHS row of 2 cells.
    assert(program.rules.size() == 1);
    const auto& sokRule = program.rules[0];
    assert(!sokRule.rigid && !sokRule.random && !sokRule.late);
    assert(sokRule.groupNumber == 0);
    assert(sokRule.commands.empty());
    assert(sokRule.lhs.size() == 1 && sokRule.lhs[0].size() == 2);
    assert(sokRule.rhs.size() == 1 && sokRule.rhs[0].size() == 2);

    // Slice 7b: the authored cell/term contents of sokoban's rule.
    assert(sokRule.lhs[0][0].terms.size() == 1);
    assert(sokRule.lhs[0][0].terms[0].name == "player");
    assert(!sokRule.lhs[0][0].terms[0].dir.empty());   // "> Player" has a direction modifier
    assert(sokRule.lhs[0][1].terms.size() == 1);
    assert(sokRule.lhs[0][1].terms[0].name == "crate");
    assert(sokRule.lhs[0][1].terms[0].dir.empty());    // bare "Crate"
    assert(sokRule.rhs[0][0].terms[0].name == "player" && !sokRule.rhs[0][0].terms[0].dir.empty());
    assert(sokRule.rhs[0][1].terms[0].name == "crate" && !sokRule.rhs[0][1].terms[0].dir.empty());
    assert(!sokRule.lhs[0][0].ellipsis);

    const std::string json = puzzlescript::compiler::serializeSemanticProgramJson(program);
    assert(json.find("\"semantic_program\"") != std::string::npos);
    assert(json.find("\"collision_layers\"") != std::string::npos);
    assert(json.find("\"legends\"") != std::string::npos);
    assert(json.find("\"aggregates\"") != std::string::npos);
    assert(json.find("\"levels\"") != std::string::npos);
    assert(json.find("\"cells\"") != std::string::npos);
    assert(json.find("\"win_conditions\"") != std::string::npos);
    assert(json.find("\"quantifier\"") != std::string::npos);
    assert(json.find("\"metadata\"") != std::string::npos);
    assert(json.find("\"sounds\"") != std::string::npos);
    assert(json.find("\"events\"") != std::string::npos);
    assert(json.find("\"creation\"") != std::string::npos);
    assert(json.find("\"movement\"") != std::string::npos);
    assert(json.find("\"rules\"") != std::string::npos);
    assert(json.find("\"group_number\"") != std::string::npos);
    assert(json.find("\"terms\"") != std::string::npos);
    assert(json.find("\"ellipsis\"") != std::string::npos);

    // normalizeMetadataHomepage must mirror JS formatHomePage: strip the first
    // "http://" then the first "https://". This fixture has both schemes (leading
    // https://, mid-path http:// — like midas.txt) and checks both are removed.
    // Sokoban's homepage has no scheme, so it alone wouldn't catch a regression
    // that stripped neither. (Strip order is not observable for realistic inputs
    // where the two schemes don't overlap, so this does not pin the order.)
    {
        const std::string homepageSource =
            "title T\n"
            "homepage https://web.archive.org/http://wanderlands.org/\n"
            "\n"
            "========\nOBJECTS\n========\n\n"
            "Background\nblack\n\n"
            "=======\nLEGEND\n=======\n\n"
            ". = Background\n\n"
            "=======\nSOUNDS\n=======\n\n"
            "================\nCOLLISIONLAYERS\n================\n\n"
            "Background\n\n"
            "======\nRULES\n======\n\n"
            "==============\nWINCONDITIONS\n==============\n\n"
            "=======\nLEVELS\n=======\n\n"
            ".\n";
        puzzlescript::compiler::DiagnosticSink homepageDiagnostics;
        const auto homepageState = puzzlescript::compiler::parseSource(homepageSource, homepageDiagnostics);
        puzzlescript::LoadedGame homepageGame;
        auto homepageError = puzzlescript::compiler::lowerToRuntimeGame(homepageState, homepageGame);
        assert(!homepageError);
        assert(homepageGame.information);
        const auto homepageProgram = puzzlescript::compiler::buildSemanticProgram(*homepageGame.information);
        assert(homepageProgram.metadata.count("homepage"));
        assert(homepageProgram.metadata.at("homepage") == "web.archive.org/wanderlands.org/");
    }

    // Sound events resolve name -> integer seed (sokoban declares no sounds, so
    // cover the real mapping with an explicit fixture; JS stores seeds as
    // strings, so the snapshot normalizes them to integers).
    {
        const std::string soundSource =
            "title T\n"
            "\n"
            "========\nOBJECTS\n========\n\n"
            "Background\nblack\n\n"
            "Player\nblue\n\n"
            "=======\nLEGEND\n=======\n\n"
            ". = Background\n"
            "P = Player\n\n"
            "=======\nSOUNDS\n=======\n\n"
            "sfx0 12345678\n"
            "endlevel 87654321\n\n"
            "================\nCOLLISIONLAYERS\n================\n\n"
            "Background\nPlayer\n\n"
            "======\nRULES\n======\n\n"
            "==============\nWINCONDITIONS\n==============\n\n"
            "=======\nLEVELS\n=======\n\n"
            "P\n";
        puzzlescript::compiler::DiagnosticSink soundDiagnostics;
        const auto soundState = puzzlescript::compiler::parseSource(soundSource, soundDiagnostics);
        puzzlescript::LoadedGame soundGame;
        auto soundError = puzzlescript::compiler::lowerToRuntimeGame(soundState, soundGame);
        assert(!soundError);
        assert(soundGame.information);
        const auto soundProgram = puzzlescript::compiler::buildSemanticProgram(*soundGame.information);
        assert(soundProgram.sounds.events.size() == 2);
        assert(soundProgram.sounds.events.count("sfx0") && soundProgram.sounds.events.at("sfx0") == 12345678);
        assert(soundProgram.sounds.events.count("endlevel") && soundProgram.sounds.events.at("endlevel") == 87654321);
    }

    {
        const std::string sfxSource =
            "title T\n\n========\nOBJECTS\n========\n\n"
            "Background\nblack\n\nPlayer\nblue\n\nCrate\nbrown\n\n"
            "=======\nLEGEND\n=======\n\n. = Background\nP = Player\n* = Crate\n\n"
            "=======\nSOUNDS\n=======\n\nCrate create 11111111\nPlayer move up 22222222\n\n"
            "================\nCOLLISIONLAYERS\n================\n\nBackground\nPlayer, Crate\n\n"
            "======\nRULES\n======\n\n==============\nWINCONDITIONS\n==============\n\n"
            "=======\nLEVELS\n=======\n\nP*\n";
        puzzlescript::compiler::DiagnosticSink d;
        const auto st = puzzlescript::compiler::parseSource(sfxSource, d);
        puzzlescript::LoadedGame g;
        assert(!puzzlescript::compiler::lowerToRuntimeGame(st, g));
        assert(g.information);
        const auto p = puzzlescript::compiler::buildSemanticProgram(*g.information);
        assert(p.sounds.creation.size() == 1 && p.sounds.creation[0].seed == 11111111);
        assert(p.sounds.creation[0].objectIds.size() == 1);   // crate
        assert(p.sounds.creation[0].directions.empty() && p.sounds.creation[0].layer == -1);
        assert(p.sounds.movement.size() == 1 && p.sounds.movement[0].seed == 22222222);
        assert(p.sounds.movement[0].objectIds.size() == 1);   // player
        assert((p.sounds.movement[0].directions == std::vector<std::string>{"up"}));
        assert(p.sounds.movement[0].layer >= 0);
    }

    return 0;
}
