#undef NDEBUG
#include <cassert>
#include <fstream>
#include <iostream>
#include <sstream>
#include <string>

#include "compiler/lower_to_runtime.hpp"
#include "compiler/parser.hpp"
#include "runtime/compiled_rules.hpp"
#include "runtime/core.hpp"
#include "runtime/json.hpp"

int main(int argc, char** argv) {
    assert(argc == 2);
    std::ifstream input(argv[1]);
    assert(input);
    std::ostringstream text;
    text << input.rdbuf();
    const auto cases = puzzlescript::json::parse(text.str());
    assert(cases.asArray().size() >= 6);
    for (const auto& entry : cases.asArray()) {
        const auto& name = entry.asArray()[0].asString();
        const auto& payload = entry.asArray()[1].asArray();
        const auto& source = payload[0].asString();
        puzzlescript::compiler::DiagnosticSink diagnostics;
        const auto parsed = puzzlescript::compiler::parseSource(source, diagnostics);
        puzzlescript::LoadedGame loaded;
        assert(!puzzlescript::compiler::lowerToRuntimeGame(parsed, loaded));
        puzzlescript::attachLinkedCompiledRules(*std::const_pointer_cast<puzzlescript::Game>(loaded.information), source);
        assert(loaded.information->specializedCompactTurn);
        assert(loaded.information->specializedCompactTurn->nativeKernel);
        auto interpreted = puzzlescript::createSession(loaded);
        auto compiled = puzzlescript::createSession(loaded);
        assert(!puzzlescript::loadLevel(*interpreted, 0));
        assert(!puzzlescript::loadLevel(*compiled, 0));
        for (const auto& token : payload[1].asArray()) {
            const auto direction = token.isString() ? PS_INPUT_TICK : static_cast<ps_input>(token.asInteger());
            puzzlescript::interpreterStep(*interpreted, direction, {});
            bool handled = false;
            puzzlescript::compiledCompactPrimaryTurn(*compiled, direction, {}, &handled);
            assert(handled);
        }
        const auto& expected = payload[2].asString();
        const auto actual = puzzlescript::serializeTestString(*compiled);
        if (puzzlescript::serializeTestString(*interpreted) != expected || actual != expected) {
            std::cerr << name << ": rigid ownership mismatch\nexpected:\n" << expected << "actual:\n" << actual;
            return 1;
        }
    }
    std::cout << "compiler_generated_rigid_ownership: " << cases.asArray().size() << " cases passed in interpreter and generated native kernel\n";
}
