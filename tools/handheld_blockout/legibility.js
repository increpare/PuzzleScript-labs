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

function caption(x, y, s) {
    return '<text x="' + fmt(x) + '" y="' + fmt(y) + '" font-size="3" ' +
        'font-family="sans-serif" fill="#444">' + s + "</text>";
}

function legibilitySheetSvg() {
    // 4.3-inch 800x480: 0.119 mm/px -> 25 px tiles = 2.97 mm; text cells
    // 95/34 x 54/13 mm. The 5-inch block stays for A/B comparison.
    var font = loadFont();
    var p90card = renderLevelSvg(LEVEL_P90, 2.97);
    var p90ref = renderLevelSvg(LEVEL_P90, 3.4);
    var median = renderLevelSvg(LEVEL_MEDIAN, 5.94);
    var text = renderTextScreenSvg(TITLE_LINES, 2.794, 4.154, font);
    var out = ['<svg xmlns="http://www.w3.org/2000/svg" width="297mm" height="210mm" viewBox="0 0 297 210">'];
    out.push(caption(18, 10, "PuzzleScript Card legibility sheet — print at 100% scale, " +
        "A4 landscape. View at handheld distance (~35 cm)."));
    out.push('<g stroke="#000" stroke-width="0.3">');
    out.push('<line x1="180" y1="14" x2="280" y2="14"/>');
    for (var t = 0; t <= 100; t += 10) {
        var tick = (t % 50 === 0) ? 3 : 1.5;
        out.push('<line x1="' + (180 + t) + '" y1="' + (14 - tick) + '" x2="' + (180 + t) +
            '" y2="' + (14 + tick) + '"/>');
    }
    out.push("</g>");
    out.push(caption(180, 9.5, "calibration: this bar must measure exactly 100 mm"));
    out.push(caption(18, 26, "p90 21x17 at 3.0 mm cells (4.3-inch card)"));
    out.push('<g transform="translate(18,30)">' + p90card.svg + "</g>");
    out.push(caption(95, 26, "p90 21x17 at 3.4 mm cells (retired 5-inch, comparison)"));
    out.push('<g transform="translate(95,30)">' + p90ref.svg + "</g>");
    out.push(caption(190, 26, "median 11x9 at 5.9 mm cells (4.3-inch card)"));
    out.push('<g transform="translate(190,30)">' + median.svg + "</g>");
    out.push(caption(18, 116, "34x13 text screen, 2.794 x 4.154 mm chars (4.3-inch card)"));
    out.push('<g transform="translate(18,120)">' + text.svg + "</g>");
    out.push(caption(18, 182, "levels are density proxies (real Simple Block Pushing Game " +
        "sprites), not solvable puzzles"));
    out.push("</svg>");
    return out.join("\n");
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
        renderTextScreenSvg: renderTextScreenSvg,
        legibilitySheetSvg: legibilitySheetSvg
    };
}
