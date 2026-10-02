#!/usr/bin/env node

/* 

creates a highly compressed release build in bin of the contents of src

(See DEVELOPMENT.md for information on how to set up/use this script)

*/

const fs = require("fs");
const path = require('path');
const { execFileSync } = require('child_process');

const rimraf = require('rimraf');
const compress_images = require("compress-images");
let webResourceInliner = require("web-resource-inliner");
const ncp = require('ncp').ncp;
const gifsicle = require('gifsicle').default || require('gifsicle');
const concat = require('concat');
const cssmin = require('ycssmin').cssmin;
const { minify } = require("terser");
const { Compress } = require('gzipper');
const htmlminify = require('html-minifier-terser').minify;
const glob = require("glob")
const { removeLocalScriptTags } = require("./build-html");

const releaseCompressionOptions = Object.freeze({
    brotli: true,
    gzip: false,
    brotliParamMode: "text",
    brotliQuality: 11,
    removeLarger: false
});

function copyDirectory(source, destination) {
    return new Promise((resolve, reject) => {
        ncp(source, destination, error => {
            if (error) {
                reject(error);
            } else {
                resolve();
            }
        });
    });
}

function inlineResources(options) {
    return new Promise((resolve, reject) => {
        webResourceInliner.html(options, (error, inlined) => {
            if (error) {
                reject(error);
            } else {
                resolve(inlined);
            }
        });
    });
}

function compressPngImages() {
    return new Promise((resolve, reject) => {
        compress_images(
            "./src/images/*.png",
            "./bin/images/",
            { compress_force: false, statistic: false, autoupdate: true }, false,
            { jpg: { engine: "mozjpeg", command: ["-quality", "60"] } },
            { png: { engine: "pngcrush", command: ["-reduce", "-brute"] } },
            { svg: { engine: "svgo", command: "--multipass" } },
            { gif: { engine: "gifsicle", command: ["--colors", "64", "--use-col=web"] } },
            (error, completed) => {
                if (error) {
                    reject(error);
                } else if (completed) {
                    resolve();
                }
            }
        );
    });
}

async function generateFrom(files, outputSource, outputBin) {
    const corpus = {};
    for (const filePath of files) {
        corpus["source/" + filePath.slice(9)] = fs.readFileSync(filePath, encoding = 'utf-8');
    }

    const result = await minify(corpus, {
        sourceMap: {
            filename: outputSource,
            url: outputSource + ".map"
        }
    });
    fs.writeFileSync(outputBin, result.code);
    fs.writeFileSync(outputBin + ".map", result.map);
}

async function main() {
    execFileSync(process.execPath, [
        path.join(__dirname, "build-codemirror6.js"),
        "--check"
    ], {stdio: "inherit"});

    const lines = fs.readFileSync(".build/buildnumber.txt", encoding = 'utf-8');
    const buildnum = parseInt(lines) + 1;
    fs.writeFileSync(".build/buildnumber.txt", buildnum.toString(), encoding = 'utf-8');

    console.log("===========================");
    console.log('build number ' + buildnum)
    console.log("removing bin")

    rimraf.sync("./bin");
    fs.mkdirSync('./bin');

    console.log("Copying files")
    ncp.limit = 16;
    await copyDirectory("./src", "./bin/");

    console.log("echo optimizing pngs");
    rimraf.sync('./bin/images/*.png');
    await compressPngImages();

    console.log('Optimizing gallery gifs');
    const galleryGifDirectory = "./bin/Gallery/gifs";
    for (const file of fs.readdirSync(galleryGifDirectory)) {
        const filePath = path.resolve(galleryGifDirectory, file);
        if (!fs.lstatSync(filePath).isDirectory() && path.extname(file).toLowerCase() === ".gif") {
            execFileSync(gifsicle, ['--batch', '-O2', galleryGifDirectory + "/" + file]);
        }
    }

    console.log('Optimizing documentation gifs');
    for (const filename of glob.sync("./bin/Documentation/images/*.gif")) {
        execFileSync(gifsicle, ['-O2', '-o', filename, filename]);
    }
    console.log('Images optimized');

    rimraf.sync('./bin/js');
    rimraf.sync('./bin/css');
    rimraf.sync('./bin/tests');
    fs.mkdirSync('./bin/js');
    fs.mkdirSync('./bin/css');

    console.log('compressing css');
    await concat(["./src/css/editor-cm6.css",
        "./src/css/editor-theme.css",
        "./src/css/docs.css",
        "./src/css/console.css",
        "./src/css/gamecanvas.css",
        "./src/css/soundbar.css",
        "./src/css/layout.css",
        "./src/css/toolbar.css"],
        "./bin/css/combined.css");
    console.log('css files concatenated')

    let css = fs.readFileSync("./bin/css/combined.css", encoding = 'utf8');
    let min = cssmin(css);
    fs.writeFileSync("./bin/css/combined.css", min, encoding = "utf8");

    css = fs.readFileSync("./bin/Documentation/css/bootstrap.css", encoding = 'utf8');
    min = cssmin(css);
    fs.writeFileSync("./bin/Documentation/css/bootstrap.css", min, encoding = "utf8");

    console.log("running js minification");
    const includesEditor = [
        "./src/js/Blob.js",
        "./src/js/FileSaver.js",
        "./src/js/jsgif/LZWEncoder.js",
        "./src/js/jsgif/NeuQuant.js",
        "./src/js/jsgif/GIFEncoder.js",
        "./src/js/storagewrapper.js",
        "./src/js/debug.js",
        "./src/js/plugin_header_off.js",
        "./src/js/bitvec.js",
        "./src/js/level.js",
        "./src/js/languageConstants.js",
        "./src/js/globalVariables.js",
        "./src/js/font.js",
        "./src/js/rng.js",
        "./src/js/riffwave.js",
        "./src/js/sfxr.js",
        "./src/js/colorhelpers.js",
        "./src/js/puzzlescript-stream.js",
        "./src/js/codemirror6/runtime/dist/codemirror6-runtime.js",
        "./src/js/codemirror6/plugins/bootstrap.js",
        "./src/js/codemirror6/plugins/style-token.js",
        "./src/js/codemirror6/plugins/dynamic-colors.js",
        "./src/js/codemirror6/plugins/exact-prefix.js",
        "./src/js/codemirror6/plugins/stream-language.js",
        "./src/js/codemirror6/plugins/stream-state.js",
        "./src/js/codemirror6/plugins/token-presentation.js",
        "./src/js/codemirror6/plugins/autocomplete.js",
        "./src/js/codemirror6/plugins/commands.js",
        "./src/js/codemirror6/plugins/interactions.js",
        "./src/js/codemirror6/plugins/search.js",
        "./src/js/codemirror6/plugins/editor-adapter.js",
        "./src/js/codemirror6/plugins/index.js",
        "./src/js/codemirror/rule-transform.js",
        "./src/js/puzzlescript-autocomplete.js",
        "./src/js/colors.js",
        "./src/js/graphics.js",
        "./src/js/inputoutput.js",
        "./src/js/mobile.js",
        "./src/js/buildStandalone.js",
        "./src/js/engine.js",
        "./src/js/parser.js",
        "./src/js/github.js",
        "./src/js/imagepaste.js",
        "./src/js/editor-api.js",
        "./src/js/editor-cm6.js",
        "./src/js/editor.js",
        "./src/js/compiler.js",
        "./src/js/console.js",
        "./src/js/soundbar.js",
        "./src/js/toolbar.js",
        "./src/js/layout.js",
        "./src/js/addlisteners.js",
        "./src/js/addlisteners_editor.js",
        "./src/js/makegif.js"];
    await generateFrom(includesEditor, "scripts_compiled.js", "./bin/js/scripts_compiled.js");

    const includesPlay = [
        "./src/js/storagewrapper.js",
        "./src/js/bitvec.js",
        "./src/js/level.js",
        "./src/js/languageConstants.js",
        "./src/js/globalVariables.js",
        "./src/js/debug_off.js",
        "./src/js/plugin_header_off.js",
        "./src/js/font.js",
        "./src/js/rng.js",
        "./src/js/riffwave.js",
        "./src/js/sfxr.js",
        "./src/js/puzzlescript-stream.js",
        "./src/js/colors.js",
        "./src/js/graphics.js",
        "./src/js/engine.js",
        "./src/js/parser.js",
        "./src/js/github.js",
        "./src/js/compiler.js",
        "./src/js/inputoutput.js",
        "./src/js/mobile.js"];
    await generateFrom(includesPlay, "scripts_play_compiled.js", "./bin/js/scripts_play_compiled.js");

    await copyDirectory("./src/js", "./bin/js/source");
    console.log("compilation done");

    let editor = fs.readFileSync("./bin/editor.html", encoding = 'utf8');
    editor = removeLocalScriptTags(editor);
    editor = editor.replace(/<!--___SCRIPTINSERT___-->/g, '<script src="js\/scripts_compiled.js"><\/script>');
    editor = editor.replace(/<link rel="stylesheet" href="[A-Za-z0-9_\/-]*\.css">/g, '');
    editor = editor.replace(/<!--CSSREPLACE-->/g, '<link rel="stylesheet" href="css\/combined.css">');
    const date = new Date();
    const monthname = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
    editor = editor.replace(/<!--BUILDNUMBER-->/g, `build ${buildnum.toString()}, ${date.getDate()}-${monthname[date.getMonth()]}-${date.getFullYear()}`);
    fs.writeFileSync("./bin/editor.html", editor, encoding = 'utf8');

    let player = fs.readFileSync("./bin/play.html", encoding = 'utf8');
    player = removeLocalScriptTags(player);
    player = player.replace(/<!--___SCRIPTINSERT___-->/g, '<script src="js\/scripts_play_compiled.js"><\/script>');
    fs.writeFileSync("./bin/play.html", player, encoding = 'utf8');

    console.log("inlining standalone template")
    const standaloneRaw = fs.readFileSync("./src/standalone.html", 'utf8');
    const sourceStandalone = await inlineResources({fileContent: standaloneRaw, relativeTo: "src/"});
    fs.writeFileSync("./src/standalone_inlined.txt", sourceStandalone);

    let releaseStandaloneRaw = removeLocalScriptTags(standaloneRaw);
    releaseStandaloneRaw = releaseStandaloneRaw.replace(/<!--___SCRIPTINSERT___-->/g, '<script src="js\/scripts_play_compiled.js"><\/script>');
    const releaseStandalone = await inlineResources({fileContent: releaseStandaloneRaw, relativeTo: "bin/"});
    const minifiedStandalone = await htmlminify(releaseStandalone, {
        collapseBooleanAttributes: true,
        collapseWhitespace: true,
        minifyCSS: true,
        minifyURLs: true,
        removeComments: true,
        removeEmptyAttributes: true,
    });
    fs.writeFileSync("./bin/standalone_inlined.txt", minifiedStandalone);
    fs.unlinkSync("./bin/standalone.html");

    console.log("compressing html");
    const htmlFiles = glob.sync("./bin/*.html");
    for (const filename of htmlFiles) {
        const lines = fs.readFileSync(filename, encoding = 'utf8');
        const result = await htmlminify(lines);
        fs.writeFileSync(filename, result);
    }

    let files = glob.sync("./bin/**/*.js");
    files = files.concat(glob.sync("./bin/**/*.html"));
    files = files.concat(glob.sync("./bin/**/*.css"));
    files = files.concat(glob.sync("./bin/**/*.txt"));
    for (const file of files) {
        const comp = new Compress(file, undefined, releaseCompressionOptions);
        await comp.run();
    }

    console.log("Files compressed. All good!");
}

main().catch(error => {
    console.error(error.message || error);
    process.exitCode = 1;
});
