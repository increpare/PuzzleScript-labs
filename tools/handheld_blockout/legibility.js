"use strict";

var fs = require("fs");
var path = require("path");

// Legibility-sheet renderer for the PuzzleScript Card spec.
// Sprites: Simple Block Pushing Game (src/demo/sokoban_basic.txt).
// Colors: arnecolors palette (src/js/colors.js).
// Node-only: loadFont() reads src/js/font.js from disk.

var PALETTE = {
    black: "#000000", white: "#ffffff",
    lightgreen: "#a3ce27", green: "#44891a",
    darkblue: "#1B2632", brown: "#a46422", darkbrown: "#493c2b",
    orange: "#eb8931", blue: "#1d57f7"
};

var SPRITES = {
    background: { colors: ["lightgreen", "green"],
        rows: ["11111", "01111", "11101", "11111", "10111"] },
    target: { colors: ["darkblue"],
        rows: [".....", ".000.", ".0.0.", ".000.", "....."] },
    wall: { colors: ["brown", "darkbrown"],
        rows: ["00010", "11111", "01000", "11111", "00010"] },
    player: { colors: ["black", "orange", "white", "blue"],
        rows: [".000.", ".111.", "22222", ".333.", ".3.3."] },
    crate: { colors: ["orange"],
        rows: ["00000", "0...0", "0...0", "0...0", "00000"] }
};

var LEGEND = {
    ".": ["background"],
    "#": ["background", "wall"],
    "P": ["background", "player"],
    "*": ["background", "crate"],
    "@": ["background", "target", "crate"],
    "O": ["background", "target"]
};

// Density proxies for legibility testing, not solvable puzzles.
var LEVEL_P90 = [
    "#####################",
    "#...#....O....#.....#",
    "#.*.#..#####..#..*..#",
    "#...#..#O..#..#.....#",
    "##.###.#.*.#..###.###",
    "#..O...#...#....#...#",
    "#..#####.#######.#..#",
    "#..#...*.....O#..#..#",
    "#..#..#####...#..*..#",
    "#.....#O..#.#.##..###",
    "###.#.#.*.#.#..#....#",
    "#...#.#...#.##.####.#",
    "#.#.#.###.#..#....#.#",
    "#.#....O#.#..##.#.#.#",
    "#.#..*..#.#P..*.#...#",
    "#....#..#....O..#.#.#",
    "#####################"
];

var LEVEL_MEDIAN = [
    "###########",
    "#....#....#",
    "#.*..O..#.#",
    "#..#....*.#",
    "#.O.##P...#",
    "#....#..O.#",
    "#.*....#..#",
    "#......O*.#",
    "###########"
];

function fmt(n) {
    return String(Math.round(n * 1000) / 1000);
}

function renderLevelSvg(rows, cellMm) {
    var out = [];
    var px = cellMm / 5;
    for (var r = 0; r < rows.length; r++) {
        for (var c = 0; c < rows[r].length; c++) {
            var stack = LEGEND[rows[r].charAt(c)];
            var x0 = c * cellMm, y0 = r * cellMm;
            out.push('<rect x="' + fmt(x0) + '" y="' + fmt(y0) + '" width="' + fmt(cellMm) +
                '" height="' + fmt(cellMm) + '" fill="' +
                PALETTE[SPRITES[stack[0]].colors[0]] + '"/>');
            for (var s = 0; s < stack.length; s++) {
                var sp = SPRITES[stack[s]];
                for (var y = 0; y < 5; y++) {
                    for (var x = 0; x < 5; x++) {
                        var ch = sp.rows[y].charAt(x);
                        if (ch === "." || (s === 0 && ch === "0")) {
                            continue;
                        }
                        out.push('<rect x="' + fmt(x0 + x * px) + '" y="' + fmt(y0 + y * px) +
                            '" width="' + fmt(px) + '" height="' + fmt(px) + '" fill="' +
                            PALETTE[sp.colors[+ch]] + '"/>');
                    }
                }
            }
        }
    }
    return { svg: out.join("\n"), w: rows[0].length * cellMm, h: rows.length * cellMm };
}

function loadFont() {
    var p = path.join(__dirname, "..", "..", "src", "js", "font.js");
    var src = fs.readFileSync(p, "utf8");
    return new Function(src + "\n;return font;")();
}

// Representative title screen (approximates the engine's 34x13 terminal).
var TITLE_LINES = [
    "",
    "",
    "",
    "    simple block pushing game",
    "",
    "         by david skinner",
    "",
    "       www.puzzlescript.net",
    "",
    "",
    "    arrow keys to move, x to act",
    "      z to undo, r to restart",
    ""
];

function renderTextScreenSvg(lines, cellW, cellH, font) {
    var cols = 34, rows = 13;
    var out = ['<rect x="0" y="0" width="' + fmt(cols * cellW) + '" height="' +
        fmt(rows * cellH) + '" fill="#000000"/>'];
    var pw = cellW / 5, ph = cellH / 12;
    for (var r = 0; r < rows; r++) {
        var line = lines[r] || "";
        for (var c = 0; c < cols; c++) {
            var ch = line.charAt(c);
            if (!ch || ch === " ") {
                continue;
            }
            var glyph = font[ch] || font[ch.toLowerCase()];
            if (!glyph) {
                continue;
            }
            var g = glyph.trim().split("\n");
            for (var y = 0; y < g.length; y++) {
                for (var x = 0; x < 5; x++) {
                    if (g[y].charAt(x) === "1") {
                        out.push('<rect x="' + fmt(c * cellW + x * pw) + '" y="' +
                            fmt(r * cellH + y * ph) + '" width="' + fmt(pw) + '" height="' +
                            fmt(ph) + '" fill="#ffffff"/>');
                    }
                }
            }
        }
    }
    return { svg: out.join("\n"), w: cols * cellW, h: rows * cellH };
}

if (typeof module !== "undefined" && module.exports) {
    module.exports = {
        PALETTE: PALETTE,
        SPRITES: SPRITES,
        LEGEND: LEGEND,
        LEVEL_P90: LEVEL_P90,
        LEVEL_MEDIAN: LEVEL_MEDIAN,
        renderLevelSvg: renderLevelSvg,
        fmt: fmt,
        loadFont: loadFont,
        TITLE_LINES: TITLE_LINES,
        renderTextScreenSvg: renderTextScreenSvg
    };
}
