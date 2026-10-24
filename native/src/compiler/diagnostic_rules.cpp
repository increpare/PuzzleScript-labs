#include "compiler/diagnostic_rules.hpp"

#include <algorithm>
#include <map>
#include <set>
#include <string_view>
#include "compiler/rule_text.hpp"

namespace puzzlescript::compiler {
namespace {
using Cell = std::vector<std::string>; // modifier/name pairs, as authored
using Row = std::vector<Cell>;
using Side = std::vector<Row>;
struct AuthoredRule {
    int32_t line = 0, group = 0;
    bool late = false, rigid = false, random = false;
    Side lhs, rhs;
    std::vector<std::string> commands;
};
std::string upper(std::string value) {
    for (char& c : value) if (c >= 'a' && c <= 'z') c -= 'a' - 'A';
    return value;
}
bool movement(std::string_view token) {
    static const std::set<std::string_view> words = {"up", "down", "left", "right", "^", "v", "<", ">",
        "moving", "stationary", "horizontal", "vertical", "orthogonal", "parallel", "perpendicular", "action", "no", "random", "randomdir"};
    return words.contains(token);
}
bool command(std::string_view token) {
    static const std::set<std::string_view> words = {"cancel", "checkpoint", "restart", "win", "again", "message", "nosave", "quit", "undo",
        "sfx0", "sfx1", "sfx2", "sfx3", "sfx4", "sfx5", "sfx6", "sfx7", "sfx8", "sfx9", "sfx10"};
    return words.contains(token);
}
struct Names {
    const ParserState& state;
    std::map<std::string, std::string> synonyms;
    std::map<std::string, Cell> aggregates, properties;
    std::map<std::string, int32_t> layers;
    explicit Names(const ParserState& source) : state(source) {
        for (const auto& entry : source.legendSynonyms) if (!entry.items.empty()) synonyms[entry.name] = entry.items.front();
        for (const auto& entry : source.legendAggregates) aggregates[entry.name] = entry.items;
        for (const auto& entry : source.legendProperties) properties[entry.name] = entry.items;
        // Aliases of properties/aggregates remain distinct binding names.
        // Only aliases of concrete objects are rewritten to their target.
        for (size_t pass = 0; pass < source.legendSynonyms.size(); ++pass) {
            for (auto it = synonyms.begin(); it != synonyms.end();) {
                if (properties.contains(it->second)) { properties[it->first] = properties.at(it->second); it = synonyms.erase(it); }
                else if (aggregates.contains(it->second)) { aggregates[it->first] = aggregates.at(it->second); it = synonyms.erase(it); }
                else ++it;
            }
        }
        for (size_t i = 0; i < source.collisionLayers.size(); ++i)
            for (const auto& name : source.collisionLayers[i]) if (source.objects.contains(name)) layers[name] = static_cast<int32_t>(i);
    }
    std::string resolve(std::string name) const {
        std::set<std::string> seen;
        while (synonyms.contains(name) && seen.insert(name).second) name = synonyms.at(name);
        return name;
    }
    Cell objects(std::string name) const {
        Cell result;
        std::set<std::string> seen;
        const auto visit = [&](auto& self, const std::string& current) -> void {
            if (!seen.insert(current).second) return;
            if (state.objects.contains(current)) result.push_back(current);
            else if (synonyms.contains(current)) self(self, synonyms.at(current));
            else if (aggregates.contains(current)) for (const auto& member : aggregates.at(current)) self(self, member);
            else if (properties.contains(current)) for (const auto& member : properties.at(current)) self(self, member);
            seen.erase(current);
        };
        visit(visit, name);
        return result;
    }
    bool property(const std::string& name) const { return properties.contains(resolve(name)); }
};

std::vector<AuthoredRule> parseRules(const ParserState& state, const Names& names, DiagnosticSink& diagnostics, bool& invalid) {
    std::vector<AuthoredRule> rules;
    for (const auto& entry : state.rules) {
        const auto tokens = ruletext::tokenizeRuleLine(entry.rule);
        if (tokens.size() == 1 && (tokens[0] == "startloop" || tokens[0] == "endloop")) continue;
        AuthoredRule rule;
        rule.line = rule.group = entry.lineNumber;
        const auto error = [&](const std::string& text) { diagnostics.error(DiagnosticCode::GenericError, rule.line, text); };
        const auto warn = [&](const std::string& text) { diagnostics.warning(DiagnosticCode::GenericWarning, rule.line, text); };
        if (entry.mixedCase.find('(') != std::string::npos && entry.rule.find("->") == std::string::npos) {
            error("You can't have comments inside rules, sorry. In PuzzleScript, '(' starts a comment, so everything after the first '(' on this line was ignored before your rule was parsed.");
            continue;
        }
        bool malformed = false, stopped = false;
        if (std::find(tokens.begin(), tokens.end(), "->") == tokens.end()) {
            error("A rule has to have an arrow in it. There's no arrow here! Consider reading up about rules - you're clearly doing something weird");
            malformed = true;
        }
        bool prelude = true, inside = false, rhs = false, plus = false;
        int balance = 0;
        Cell cell;
        Row row;
        for (size_t i = 0; i < tokens.size(); ++i) {
            const auto& token = tokens[i];
            if (prelude) {
                if (token == "+") {
                    plus = true;
                    if (rule.group == rule.line) {
                        if (rules.empty()) { error("The \"+\" symbol, for joining a rule with the group of the previous rule, needs a previous rule to be applied to."); plus = false; }
                        if (i) error("The \"+\" symbol, for joining a rule with the group of the previous rule, must be the first symbol on the line ");
                        if (plus) rule.group = rules.back().group;
                    } else error("Two \"+\"s (the \"append to previous rule group\" symbol) applied to the same rule.");
                } else if (token == "parallel" || token == "perpendicular") {
                    error("PARALLEL and PERPENDICULAR are relative directions for objects inside a rule, and cannot be used to indicate the direction in which a whole rule applies.");
                    stopped = true; break;
                } else if (token == "up" || token == "down" || token == "left" || token == "right" || token == "horizontal" || token == "vertical" || token == "orthogonal") {
                    // Direction expansion cannot change the syntax checks.
                } else if (token == "late") rule.late = true;
                else if (token == "rigid") rule.rigid = true;
                else if (token == "random") {
                    rule.random = true;
                    if (plus) error("A rule-group can only be marked random by the opening rule in the group (aka, a '+' and 'random' can't appear as rule modifiers on the same line). Why? Well, you see \"random\" isn't a property of individual rules, but of whole rule groups. It indicates that a single possible application of some rule from the whole group should be applied at random.");
                } else if (token == "^" || token == "v" || token == "<" || token == ">") {
                    error("You cannot use relative directions (\"^v<>\") to indicate in which direction(s) a rule applies. Use absolute directions indicators (Up, Down, Left, Right, Horizontal, or Vertical, for instance), or, if you want the rule to apply in all four directions, do not specify directions");
                } else if (token == "[") { prelude = false; --i; }
                else error("The start of a rule must consist of some number of directions (possibly 0), before the first bracket, specifying in what directions to look (with no direction specified, it applies in all four directions). It seems you've just entered \"" + upper(token) + "\".");
                continue;
            }
            if (token == "[") {
                if (++balance > 1) warn("Multiple opening brackets without closing brackets. Something fishy here. Every '[' has to be closed by a ']', and you can't nest them.");
                if (!cell.empty()) error("Error, malformed cell rule - encountered a \"[\"\" before previous bracket was closed");
                inside = true; cell.clear();
            } else if (movement(token)) {
                if (cell.size() % 2) error("Error, an item can only have one direction/action at a time, but you're looking for several at once!");
                else if (!inside) warn("Invalid syntax. Directions should be placed at the start of a rule.");
                else if (rule.late && token != "no" && token != "random" && token != "randomdir") error("Movements cannot appear in late rules.");
                else cell.push_back(token);
            } else if (token == "|") {
                if (!inside) warn("Janky syntax. \"|\" should only be used inside cell rows (the square brackety bits).");
                else if (cell.size() % 2) error("In a rule, if you specify a movement, it has to act on an object.");
                else { row.push_back(cell); cell.clear(); }
            } else if (token == "]") {
                if (--balance < 0) { warn("Multiple closing brackets without corresponding opening brackets. Something fishy here. Every '[' has to be closed by a ']', and you can't nest them."); stopped = true; break; }
                if (cell.size() % 2) {
                    malformed = true;
                    error(!cell.empty() && cell.front() == "..." ? "Cannot end a rule with ellipses." : "In a rule, if you specify a movement, it has to act on an object.");
                } else { row.push_back(cell); cell.clear(); }
                (rhs ? rule.rhs : rule.lhs).push_back(row); row.clear(); inside = false;
            } else if (token == "->") {
                if (rule.group != rule.line && !rules.empty() && rules.back().late != rule.late)
                    warn("Oh gosh you can mix late and non-late rules in a rule-group if you really want to, but gosh why would you want to do that? What do you expect to accomplish?");
                if (inside) warn("Encountered an unexpected \"->\" inside square brackets. It's used to separate states, it has no place inside them >:| .");
                else if (rhs) { error("Error, you can only use \"->\" once in a rule; it's used to separate before and after states."); stopped = true; break; }
                else rhs = true;
            } else if (state.namesSet.contains(token)) {
                if (!inside) warn("Invalid token " + upper(token) + ". Object names should only be used within cells (square brackets).");
                else {
                    const auto modifier = cell.size() % 2 ? cell.back() : "";
                    for (size_t j = 0; j + 1 < cell.size(); j += 2) if (cell[j+1] == token) {
                        if (cell[j] == "no" && modifier == "no") warn("I notice that you have NO " + upper(token) + " more than once in a single cell. That's redundant innit.");
                        else {
                            error("You cannot specify the same object more than once in a single cell (in this case " + upper(token) + " occurs multiple times).");
                            if (names.property(token)) diagnostics.warning(DiagnosticCode::GenericWarning, std::nullopt,
                                "( However, noticing that you're committing this crime with properties, and not being able to help but acknowledge that you may be trying to do something esoteric and clever with the property inference system, I might be brought to suggest that you consider this: you can have multiple equivalent properties with different names. )");
                        }
                    }
                    if (!(cell.size() % 2)) cell.push_back("");
                    cell.push_back(token);
                }
            } else if (token == "...") {
                if (!inside) warn("Invalid syntax, ellipses should only be used within cells (square brackets).");
                else { cell.push_back(token); cell.push_back(token); }
            } else if (command(token)) {
                if (!rhs) error("Commands should only appear at the end of rules, not in or before the pattern-detection/-replacement sections.");
                else if (inside || std::find(tokens.begin() + i + 1, tokens.end(), "]") != tokens.end()) warn("Commands should only appear at the end of rules, not in or before the pattern-detection/-replacement sections.");
                rule.commands.push_back(token);
                if (token == "message") break;
                if (token.starts_with("sfx") && std::none_of(state.sounds.begin(), state.sounds.end(), [&](const auto& sound) {
                    return !sound.tokens.empty() && sound.tokens.front().text == token;
                })) warn("Sound effect \"" + token + "\" not defined.");
            } else error("Error, malformed cell rule - was looking for cell contents, but found \"" + token + "\". What am I supposed to do with this, eh, please tell me that.");
        }
        if (stopped) continue;
        if (rule.late && rule.rigid) error("Late rules cannot be marked as rigid (rigid rules are all about dealing with the consequences of unresolvable movements, and late rules can't even have movements).");
        malformed |= balance != 0 || inside;
        if (rule.lhs.size() != rule.rhs.size()) {
            if (rule.commands.empty() || !rule.rhs.empty()) {
                warn("Error, when specifying a rule, the number of matches (square bracketed bits) on the left hand side of the arrow must equal the number on the right"); malformed = true;
            }
        } else for (size_t i = 0; i < rule.lhs.size(); ++i) {
            if (rule.lhs[i].size() != rule.rhs[i].size()) {
                error("In a rule, each pattern to match on the left must have a corresponding pattern on the right of equal length (number of cells)."); invalid = malformed = true;
            }
            if (rule.lhs[i].empty()) { diagnostics.error(DiagnosticCode::GenericError, std::nullopt, "You have an totally empty pattern on the left-hand side. This will match *everything*. You certainly don't want this."); malformed = true; }
        }
        if (rule.lhs.empty()) { error("This rule refers to nothing. What the heck? :O"); malformed = true; }
        if (!malformed) rules.push_back(std::move(rule));
    }
    return rules;
}

void checkInference(const Names& names, const AuthoredRule& rule, DiagnosticSink& diagnostics) {
    std::map<std::string, int> properties, movements;
    std::map<std::pair<std::string, std::string>, int> objectMovements;
    for (const auto& row : rule.lhs) for (const auto& cell : row) for (size_t i = 0; i + 1 < cell.size(); i += 2) {
        const auto name = names.resolve(cell[i+1]);
        if (cell[i] == "no" || cell[i] == "random") continue;
        if (names.property(name)) ++properties[name];
        if (cell[i] == "moving" || cell[i] == "vertical" || cell[i] == "horizontal" || cell[i] == "orthogonal" || cell[i] == "parallel" || cell[i] == "perpendicular") { ++movements[cell[i]]; ++objectMovements[{cell[i], name}]; }
    }
    std::string badMovement, badProperty;
    for (size_t r = 0; r < rule.rhs.size(); ++r) for (size_t c = 0; c < rule.rhs[r].size(); ++c) {
        const auto& cell = rule.rhs[r][c];
        const Cell empty;
        const auto& left = r < rule.lhs.size() && c < rule.lhs[r].size() ? rule.lhs[r][c] : empty;
        for (size_t i = 0; i + 1 < cell.size(); i += 2) {
            const auto name = names.resolve(cell[i+1]);
            const auto modifier = cell[i];
            if (modifier == "no" || modifier == "random" || name == "...") continue;
            bool propertyPaired = false, movementPaired = false;
            for (size_t j = 0; j + 1 < left.size(); j += 2) {
                if (names.resolve(left[j+1]) != name) continue;
                propertyPaired |= left[j] != "no" && left[j] != "random";
                movementPaired |= left[j] == modifier;
            }
            if (badProperty.empty() && names.property(name) && properties[name] != 1 && !propertyPaired) badProperty = name;
            if (badMovement.empty() && (modifier == "moving" || modifier == "vertical" || modifier == "horizontal" || modifier == "orthogonal" || modifier == "parallel" || modifier == "perpendicular") && movements[modifier] != 1 && objectMovements[{modifier, name}] != 1 && !movementPaired) badMovement = modifier;
        }
    }
    if (!badMovement.empty()) diagnostics.error(DiagnosticCode::GenericError, rule.line,
        "This rule has an ambiguous movement on the right-hand side, \"" + badMovement + "\", that can't be inferred from the left-hand side. (either for every ambiguous movement associated to an entity on the right there has to be a corresponding one on the left attached to the same entity, OR, if there's a single occurrence of a particular ambiguous movement on the left, all properties of the same movement attached to the same object on the right are assumed to be the same (or something like that)).");
    if (!badProperty.empty()) diagnostics.error(DiagnosticCode::GenericError, rule.line,
        "This rule has a property on the right-hand side, \"" + upper(badProperty) + "\", that can't be inferred from the left-hand side. (either for every property on the right there has to be a corresponding one on the left in the same cell, OR, if there's a single occurrence of a particular property name on the left, all properties of the same name on the right are assumed to be the same).");
}

std::string joined(const Cell& values) {
    std::string result;
    for (const auto& value : values) { if (!result.empty()) result += ", "; result += upper(value); }
    return result;
}

void checkNegations(const Names& names, AuthoredRule& rule, DiagnosticSink& diagnostics) {
    for (const auto& row : rule.rhs) for (const auto& cell : row) {
        Cell present;
        for (size_t i = 0; i+1 < cell.size(); i += 2)
            if (cell[i] != "no" && names.state.objects.contains(cell[i+1])) present.push_back(cell[i+1]);
        for (size_t i = 0; i+1 < cell.size(); i += 2) if (cell[i] == "no") {
            const auto name = names.resolve(cell[i+1]);
            if (!names.layers.contains(name) && !names.properties.contains(name)) {
                diagnostics.error(DiagnosticCode::GenericError, rule.line, "Object " + upper(cell[i+1]) + " has not been assigned to a collision layer.");
                continue;
            }
            const auto excluded = names.objects(name);
            if (std::any_of(excluded.begin(), excluded.end(), [&](const auto& object) { return std::find(present.begin(), present.end(), object) != present.end(); }))
                diagnostics.error(DiagnosticCode::GenericError, rule.line, "You have specified that there should be NO " + upper(cell[i+1]) + " but there is also a requirement that " + joined(present) + " be here. This is a mistake right?");
        }
    }
    for (size_t r = 0; r < rule.rhs.size() && r < rule.lhs.size(); ++r)
        for (size_t c = 0; c < rule.rhs[r].size() && c < rule.lhs[r].size(); ++c) {
            auto& right = rule.rhs[r][c];
            const auto& left = rule.lhs[r][c];
            for (size_t i = 0; i+1 < right.size();) {
                bool remove = false;
                if (right[i] == "no") for (size_t j = 0; j+1 < left.size(); j += 2) remove |= left[j] == "no" && left[j+1] == right[i+1];
                if (remove) right.erase(right.begin()+i, right.begin()+i+2); else i += 2;
            }
        }
    for (auto& row : rule.lhs) for (auto& cell : row) {
        std::set<std::string> required;
        std::map<int32_t, std::string> occupiers;
        for (size_t i = 0; i+1 < cell.size(); i += 2) {
            if (cell[i] == "no") continue;
            const auto name = names.resolve(cell[i+1]);
            const auto members = names.objects(name);
            std::set<int32_t> layers;
            for (const auto& member : members) if (names.layers.contains(member)) layers.insert(names.layers.at(member));
            if (names.property(name) && layers.size() != 1) continue;
            for (const auto& member : members) if (names.layers.contains(member)) {
                required.insert(member); occupiers[names.layers.at(member)] = cell[i+1];
            }
        }
        for (size_t i = 0; i+1 < cell.size();) {
            if (cell[i] != "no") { i += 2; continue; }
            const auto name = names.resolve(cell[i+1]);
            const auto members = names.objects(name);
            const bool redundant = !members.empty() && !names.aggregates.contains(name) && std::all_of(members.begin(), members.end(), [&](const auto& object) {
                return !required.contains(object) && names.layers.contains(object) && occupiers.contains(names.layers.at(object));
            });
            if (!redundant) { i += 2; continue; }
            Cell present; std::string layers;
            for (const auto& [layer, object] : occupiers) { present.push_back(object); if (!layers.empty()) layers += ", "; layers += std::to_string(layer+1); }
            diagnostics.warning(DiagnosticCode::GenericWarning, rule.line, "You have specified that there should be NO " + upper(cell[i+1]) + " but there is also a requirement that " + joined(present) + " be there, which collectively occupies the same layers (Layers " + layers + "), so you can leave this out.");
            cell.erase(cell.begin()+i, cell.begin()+i+2);
        }
    }
}

bool atomize(const Names& names, AuthoredRule& rule, DiagnosticSink& diagnostics) {
    bool valid = true;
    for (auto* side : {&rule.lhs, &rule.rhs}) for (auto& row : *side) for (auto& cell : row) {
        Cell result;
        for (size_t i = 0; i+1 < cell.size(); i += 2) {
            const auto name = names.resolve(cell[i+1]);
            if (names.aggregates.contains(name)) {
                if (cell[i] == "no") {
                    diagnostics.error(DiagnosticCode::GenericError, rule.line, "You cannot use 'no' to exclude the aggregate object " + upper(name) + " (defined using 'AND'), only regular objects, or properties (objects defined using 'OR'). If you want to do this, you'll have to write it out yourself the long way.");
                    valid = false;
                } else for (const auto& member : names.objects(name)) { result.push_back(cell[i]); result.push_back(member); }
            } else { result.push_back(cell[i]); result.push_back(name); }
        }
        cell = std::move(result);
    }
    return valid;
}

using Conflict = std::pair<std::string, std::string>;
std::vector<Conflict> overlaps(const Names& names, const std::string& first, const std::string& second) {
    std::vector<Conflict> conflicts;
    const auto a = names.objects(first), b = names.objects(second);
    for (const auto& x : a) for (const auto& y : b) {
        if (first == second && names.property(first) && x != y) continue;
        if (!names.state.objects.contains(x) || !names.state.objects.contains(y)) continue;
        // The reference mask compiler coerces an unassigned concrete layer to
        // zero, then reports its missing layer in the later object pass.
        const int lx = names.layers.contains(x) ? names.layers.at(x) : 0;
        const int ly = names.layers.contains(y) ? names.layers.at(y) : 0;
        if (lx != ly) return {};
        conflicts.emplace_back(upper(x), upper(y));
    }
    return conflicts;
}

Cell boundMembers(const Names& names, const AuthoredRule& rule, const std::string& name, size_t row, size_t column) {
    auto result = names.objects(name);
    if (!names.property(name)) return result;
    const Cell* source = nullptr;
    for (size_t r = 0; r < rule.lhs.size(); ++r) for (size_t c = 0; c < rule.lhs[r].size(); ++c) {
        const auto& cell = rule.lhs[r][c];
        for (size_t i = 0; i+1 < cell.size(); i += 2) if (cell[i+1] == name && cell[i] != "no" && cell[i] != "random") {
            if (r == row && c == column) source = &cell;
            else if (!source) source = &cell;
        }
    }
    if (!source) return result;
    std::set<int32_t> excluded;
    for (size_t i = 0; i+1 < source->size(); i += 2)
        if ((*source)[i] != "no" && (*source)[i] != "random" && names.state.objects.contains((*source)[i+1]) && names.layers.contains((*source)[i+1])) excluded.insert(names.layers.at((*source)[i+1]));
    std::erase_if(result, [&](const auto& member) { return names.layers.contains(member) && excluded.contains(names.layers.at(member)); });
    return result;
}

void checkMasks(const Names& names, const AuthoredRule& rule, DiagnosticSink& diagnostics,
    std::vector<Conflict>& discards) {
    const auto error = [&](const std::string& message) { diagnostics.error(DiagnosticCode::GenericError, rule.line, message); };
    const auto warn = [&](const std::string& message) { diagnostics.warning(DiagnosticCode::GenericWarning, rule.line, message); };
    for (size_t r = 0; r < rule.lhs.size(); ++r) {
        size_t ellipses = 0;
        for (size_t c = 0; c < rule.lhs[r].size(); ++c) {
            const auto& left = rule.lhs[r][c];
            const Cell empty;
            const auto& right = r < rule.rhs.size() && c < rule.rhs[r].size() ? rule.rhs[r][c] : empty;
            if (!left.empty() && left.front() == "...") {
                ++ellipses;
                if (left.size() != 2) { error("You can't have anything in with an ellipsis. Sorry."); return; }
                bool malformed = false;
                if (!c || c+1 == rule.lhs[r].size()) { error("There's no point in putting an ellipsis at the very start or the end of a rule"); malformed = true; }
                if (!rule.rhs.empty() && right != Cell{"...", "..."}) { error("An ellipsis on the left must be matched by one in the corresponding place on the right."); malformed = true; }
                if (malformed) return;
                if (ellipses > 2) error("You can't use more than two ellipses in a single cell match pattern.");
                if (c && !rule.lhs[r][c-1].empty() && rule.lhs[r][c-1].front() == "...") warn("Why would you go and have two ellipses in a row like that? It's exactly the same as just having a single ellipsis, right?");
                continue;
            }
            Cell present, absent;
            for (size_t i = 0; i+1 < left.size(); i += 2) {
                const auto& name = left[i+1];
                if (left[i] == "random") { error("RANDOM cannot be matched on the left-hand side, it can only appear on the right"); continue; }
                if (!names.state.objects.contains(name) && !names.properties.contains(name)) { error("Oops! " + upper(name) + " not assigned to a layer."); return; }
                if (left[i] == "no") { const auto members = names.objects(name); absent.insert(absent.end(), members.begin(), members.end()); continue; }
                if (names.state.objects.contains(name)) present.push_back(name);
                for (size_t j = 0; j < i; j += 2) if (left[j] != "no" && left[j] != "random") {
                    auto conflicts = overlaps(names, name, left[j+1]);
                    if (!conflicts.empty()) discards = std::move(conflicts);
                }
            }
            Cell impossible;
            for (const auto& layer : names.state.collisionLayers) for (const auto& name : layer)
                if (std::find(present.begin(), present.end(), name) != present.end() && std::find(absent.begin(), absent.end(), name) != absent.end()) impossible.push_back(upper(name) + " NO " + upper(name));
            if (!impossible.empty()) {
                warn("This rule has something amounting to \"" + joined(impossible) + "\" on the left-hand-side,which can never match, so the rule is getting removed during compilation.");
                discards.clear(); return;
            }
            for (size_t i = 0; i+1 < left.size(); i += 2) if (left[i] != "no" && left[i] != "random" && names.property(left[i+1])) {
                for (const auto& name : names.objects(left[i+1])) if (std::find(absent.begin(), absent.end(), name) != absent.end())
                    warn("This rule has something amounting to \"" + upper(name) + " NO " + upper(name) + "\" on the left-hand-side,which can never match, so the rule is getting removed during compilation.");
            }
            bool malformedEllipsis = false;
            for (size_t i = 0; i+1 < right.size(); i += 2) if (right[i] == "...") {
                if (i == 0) { error("An ellipsis on the right must be matched by one in the corresponding place on the left."); malformedEllipsis = true; }
                if (right.size() != 2) { error("You can't have anything in with an ellipsis. Sorry."); malformedEllipsis = true; }
            }
            if (malformedEllipsis) continue;
            for (size_t i = 0; i+1 < right.size(); i += 2) {
                const auto& name = right[i+1];
                const auto members = right[i] == "random" ? names.objects(name) : boundMembers(names, rule, name, r, c);
                if (right[i] == "random") {
                    if (!names.layers.contains(name) && !names.properties.contains(name)) { error("You want to spawn a random \"" + upper(name) + "\", but I don't know how to do that"); continue; }
                    if (!names.property(name) || members.size() == 1) warn("In this rule you're asking me to spawn a random " + upper(name) + " for you, but that's already a concrete single object. You wanna be using random with properties (things defined in terms of OR in the legend) so there's some things to select between.");
                } else if (!names.state.objects.contains(name) && !names.properties.contains(name)) { error("Oops! " + upper(name) + " not assigned to a layer."); return; }
                if (right[i] == "no") continue;
                for (size_t j = 0; j < i; j += 2) {
                    if (right[j] == "no") continue;
                    const auto other = right[j] == "random" ? names.objects(right[j+1]) : boundMembers(names, rule, right[j+1], r, c);
                    for (const auto& x : members) for (const auto& y : other) {
                        if (!names.layers.contains(x) || !names.layers.contains(y) || names.layers.at(x) != names.layers.at(y)) continue;
                        if (right[i] == "random" || right[j] == "random") {
                            if (x != y) warn("This rule may try to spawn a " + upper(right[i] == "random" ? x : y) + " with random, but also requires a " + upper(right[i] == "random" ? y : x) + " be here, which is on the same layer - they shouldn't be able to coexist!");
                        } else if (discards.empty() && !(names.property(name) && names.property(right[j+1]))) {
                            // Preserved property bindings represent alternatives;
                            // report the member that the concrete write covers.
                            const auto first = names.property(name) ? x : name;
                            const auto second = names.property(right[j+1]) ? y : right[j+1];
                            error("Rule matches object types that can't overlap: \"" + upper(first) + "\" and \"" + upper(second) + "\".");
                        }
                    }
                }
            }
        }
    }
}

void reportDiscard(const AuthoredRule& rule, const std::vector<Conflict>& discards, DiagnosticSink& diagnostics) {
    if (discards.empty()) return;
    std::string parenthetical;
    if (discards.size() > 1) {
        parenthetical = " (ditto for ";
        for (size_t i = 1; i < discards.size(); ++i) {
            if (i > 1) { parenthetical += ", "; if (i+1 == discards.size()) parenthetical += "and "; }
            parenthetical += discards[i].first + "/" + discards[i].second;
            if (i == 3 && discards.size() > 4) { parenthetical += " etc."; break; }
        }
        parenthetical += ")";
    }
    diagnostics.error(DiagnosticCode::GenericError, rule.line, discards.front().first + " and " + discards.front().second + " can never overlap" + parenthetical + ". This rule requires that to happen, so it impossible it will ever trigger.");
}

void checkGroups(const ParserState& state, const std::vector<AuthoredRule>& rules, DiagnosticSink& diagnostics) {
    std::map<std::pair<bool, int32_t>, std::pair<int32_t, int32_t>> groups;
    std::set<int32_t> rigid;
    for (const auto& rule : rules) {
        auto [it, inserted] = groups.emplace(std::make_pair(rule.late, rule.group), std::make_pair(rule.line, rule.line));
        it->second.second = rule.line;
        if (rule.rigid && !rule.late && rigid.insert(rule.group).second && rigid.size() == 31)
            diagnostics.error(DiagnosticCode::GenericError, rule.line, "There can't be more than 30 rigid groups (rule groups containing rigid members).");
    }
    std::vector<std::pair<int32_t, bool>> loops;
    for (const auto& entry : state.rules) {
        const auto tokens = ruletext::tokenizeRuleLine(entry.rule);
        if (tokens.size() == 1 && (tokens[0] == "startloop" || tokens[0] == "endloop")) loops.emplace_back(entry.lineNumber, tokens[0] == "startloop");
    }
    for (size_t i = 0; i < loops.size(); ++i) {
        if (!(i % 2) && !loops[i].second) diagnostics.error(DiagnosticCode::GenericError, loops[i].first, "Found an ENDLOOP, but I'm not in a loop?");
        if (i % 2 && loops[i].second) diagnostics.error(DiagnosticCode::GenericError, loops[i].first, "Found a STARTLOOP, but I'm already inside a loop? (Puzzlescript can't nest loops, FWIW).");
    }
    if (loops.size() % 2) diagnostics.error(DiagnosticCode::GenericError, loops.back().first, "Yo I found a STARTLOOP without a corresponding ENDLOOP.");
    for (size_t i = 0; i < loops.size(); i += 2) {
        const auto start = loops[i].first, end = i+1 < loops.size() ? loops[i+1].first : start;
        for (const auto& [key, range] : groups) if ((range.first <= start && start <= range.second) || (range.first <= end && end <= range.second))
            diagnostics.error(DiagnosticCode::GenericError, start, "Found a loop point in the middle of a rule. You probably don't want to do this, right?");
    }
}
} // namespace

bool runRuleDiagnostics(const ParserState& state, DiagnosticSink& diagnostics) {
    const Names names(state);
    bool invalid = false;
    auto rules = parseRules(state, names, diagnostics, invalid);
    for (auto& rule : rules) checkNegations(names, rule, diagnostics);
    for (auto& rule : rules) if (!atomize(names, rule, diagnostics)) invalid = true;
    for (const auto& rule : rules) checkInference(names, rule, diagnostics);
    if (invalid) return false;
    std::vector<std::vector<Conflict>> discards(rules.size());
    for (size_t i = 0; i < rules.size(); ++i) checkMasks(names, rules[i], diagnostics, discards[i]);
    for (size_t i = 0; i < rules.size(); ++i) reportDiscard(rules[i], discards[i], diagnostics);
    checkGroups(state, rules, diagnostics);
    return !invalid;
}
} // namespace puzzlescript::compiler
