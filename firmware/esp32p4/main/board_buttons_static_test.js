"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const here = __dirname;
const cpp = fs.readFileSync(path.join(here, "board_buttons.cpp"), "utf8");
const hpp = fs.readFileSync(path.join(here, "board_buttons.hpp"), "utf8");

function contains(source, pattern, message) {
  assert(
    pattern.test(source),
    message + "\nMissing pattern: " + pattern
  );
}

contains(cpp, /constexpr int kRestartHoldMs = 650;/, "Restart must have an explicit hold threshold.");
contains(hpp, /bool holding_restart_ = false;/, "ButtonInput must track a pending restart hold.");
contains(hpp, /bool restart_fired_ = false;/, "ButtonInput must fire restart at most once per hold.");
contains(hpp, /int64_t restart_press_ms_ = 0;/, "ButtonInput must remember when the restart press began.");
contains(cpp, /void ButtonInput::begin_restart_hold\(\)/, "Restart hold setup must be factored for poll transitions.");
contains(cpp, /void ButtonInput::maybe_emit_restart_hold\(\)/, "Restart hold polling must be factored for stable frames.");
contains(cpp, /if \(action == PlayerAction::Restart\) \{[\s\S]*?begin_restart_hold\(\);[\s\S]*?\} else \{[\s\S]*?emit_edge\(action\);/s,
  "Restart must not emit on the initial press edge.");
contains(cpp, /if \(held_action_ == PlayerAction::Restart\) \{[\s\S]*?begin_restart_hold\(\);[\s\S]*?\} else \{[\s\S]*?emit_edge\(held_action_\);/s,
  "Changing from another held button to Restart must start a hold, not emit immediately.");
contains(cpp, /maybe_emit_restart_hold\(\);/g, "poll() must check pending restart holds while the raw state is stable.");

console.log("ok - board_buttons restart hold static checks");
