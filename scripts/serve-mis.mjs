import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { root } from './build-mis-web.mjs';
const web = path.join(root, 'build/mis-web');
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8' };
const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, 'http://localhost');
    const name = decodeURIComponent(url.pathname === '/' ? '/mis.html' : url.pathname);
    const file = path.resolve(web, '.' + name);
    if (!file.startsWith(web + path.sep)) { response.writeHead(403).end(); return; }
    response.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream');
    response.end(await readFile(file));
  } catch { response.writeHead(404).end('Not found'); }
});
server.on('error', error => { if (error.code === 'EADDRINUSE') server.listen(0, '127.0.0.1'); else throw error; });
server.on('listening', () => console.log(`PuzzleScript+MIS: http://127.0.0.1:${server.address().port}/mis.html`));
server.listen(Number(process.env.MIS_WEB_PORT || 8000), '127.0.0.1');
