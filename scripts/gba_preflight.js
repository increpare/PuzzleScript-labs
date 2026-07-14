#!/usr/bin/env node
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

function valueAfter(args, flag, fallback = "") {
  const index = args.indexOf(flag);
  return index >= 0 && index + 1 < args.length ? args[index + 1] : fallback;
}

function main(argv) {
  const compiler = valueAfter(argv, "--compiler");
  const corpusPath = valueAfter(argv, "--corpus-ndjson");
  const outputPath = valueAfter(argv, "--out");
  const requestedTmp = valueAfter(argv, "--tmp-dir");
  const limitText = valueAfter(argv, "--limit", "0");
  const limit = Number.parseInt(limitText, 10) || 0;
  if (!compiler || !corpusPath || !outputPath) {
    throw new Error("usage: gba_preflight.js --compiler BIN --corpus-ndjson FILE --out FILE [--tmp-dir DIR] [--limit N]");
  }

  const root = requestedTmp || fs.mkdtempSync(path.join(os.tmpdir(), "puzzlescript-gba-preflight-"));
  fs.mkdirSync(root, { recursive: true });
  const records = fs.readFileSync(corpusPath, "utf8").split(/\r?\n/).filter(Boolean).map(JSON.parse);
  const games = [];
  for (const record of records.slice(0, limit > 0 ? limit : records.length)) {
    const id = String(record.index ?? games.length).padStart(5, "0");
    const sourcePath = path.join(root, `${id}.txt`);
    const gameOutput = path.join(root, `${id}-out`);
    fs.writeFileSync(sourcePath, record.source, "utf8");
    const run = spawnSync(compiler, ["export-gba", sourcePath, "--out", gameOutput, "--no-mmutil"], {
      encoding: "utf8",
      windowsHide: true,
      timeout: 120000,
    });
    let manifest = null;
    const manifestPath = path.join(gameOutput, "gba_manifest.json");
    if (run.status === 0 && fs.existsSync(manifestPath)) manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    games.push({
      index: record.index ?? games.length,
      name: record.name || `game-${id}`,
      compatible: run.status === 0,
      reason: run.status === 0 ? "compatible" : (run.stderr || run.stdout || "export failed").trim(),
      manifest,
    });
    fs.rmSync(sourcePath, { force: true });
    fs.rmSync(gameOutput, { recursive: true, force: true });
  }
  const compatible = games.filter((game) => game.compatible).length;
  const report = {
    format: "puzzlescript-gba-preflight-v1",
    corpus: path.resolve(corpusPath),
    summary: { games: games.length, compatible, incompatible: games.length - compatible },
    games,
  };
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  if (!requestedTmp) fs.rmSync(root, { recursive: true, force: true });
  console.log(`GBA preflight: ${compatible}/${games.length} compatible; wrote ${outputPath}`);
}

try {
  main(process.argv.slice(2));
} catch (error) {
  console.error(error && error.stack ? error.stack : String(error));
  process.exit(1);
}
