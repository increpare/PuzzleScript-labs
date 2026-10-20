#!/usr/bin/env node
// Static server for the Phase 1.5 browser spike (autocomplete/spike/index.html).
//
//   node autocomplete/spike/serve.js [--port 8768]
//
// Routes:
//   /            -> this directory (the page)
//   /models/     -> <PS_AC_DATA>/models/spike   (ONNX exports, not in git)
//   /tokenizer/  -> <PS_AC_DATA>/tokenizer      (tokenizer.json + fixture)
//   /ort/        -> <PS_AC_DATA>/spike/node_modules/onnxruntime-web/dist (vendored for the spike)
//
// Sends Cross-Origin-Opener-Policy / Cross-Origin-Embedder-Policy so the page is
// cross-origin isolated: that enables SharedArrayBuffer (multi-threaded WASM) and
// performance.measureUserAgentSpecificMemory() for the memory column.

'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

const dataDir = process.env.PS_AC_DATA || 'D:\\Projects\\ps_autocomplete_data';
const routes = [
    ['/models/', path.join(dataDir, 'models', 'spike')],
    ['/tokenizer/', path.join(dataDir, 'tokenizer')],
    ['/ort/', path.join(dataDir, 'spike', 'node_modules', 'onnxruntime-web', 'dist')],
    ['/', __dirname],
];
const types = {
    '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json', '.wasm': 'application/wasm',
    '.onnx': 'application/octet-stream', '.css': 'text/css', '.map': 'application/json',
};

const portArg = process.argv.indexOf('--port');
const port = portArg >= 0 ? Number(process.argv[portArg + 1]) : 8768;

http.createServer((req, res) => {
    const url = decodeURIComponent(req.url.split('?')[0]);
    const route = routes.find(([prefix]) => url.startsWith(prefix));
    let rel = url.slice(route[0].length);
    if (rel === '' || rel.endsWith('/')) rel += 'index.html';
    const file = path.normalize(path.join(route[1], rel));
    if (!file.startsWith(path.normalize(route[1]))) { res.writeHead(403); res.end(); return; }
    fs.stat(file, (err, st) => {
        if (err || !st.isFile()) { res.writeHead(404); res.end('not found: ' + url); return; }
        res.writeHead(200, {
            'Content-Type': types[path.extname(file)] || 'application/octet-stream',
            'Content-Length': st.size,
            'Cache-Control': 'no-cache',
            'Cross-Origin-Opener-Policy': 'same-origin',
            'Cross-Origin-Embedder-Policy': 'require-corp',
            'Cross-Origin-Resource-Policy': 'same-origin',
        });
        if (req.method === 'HEAD') { res.end(); return; }
        fs.createReadStream(file).pipe(res);
    });
}).listen(port, () => {
    console.log(`spike server on http://localhost:${port}/  (data: ${dataDir})`);
});
