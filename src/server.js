/**
 * Local dashboard server. No framework — node:http and one static file.
 *
 * Binds to 127.0.0.1 only: this serves your account data, so it should never be
 * reachable from the network.
 */

'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const store = require('./store');
const { summarise } = require('./parse');
const { DATA } = require('./browser');

const DASH = path.join(__dirname, 'dashboard');

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.pdf': 'application/pdf',
};

function serve(opts = {}) {
  const port = opts.port || 4800;

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://localhost:${port}`);
    const route = decodeURIComponent(url.pathname);

    // API: everything the dashboard needs, already summarised.
    if (route === '/api/data') {
      const data = store.all();
      const payload = {
        properties: summarise(data.properties),
        runs: data.runs.slice(-30),
        generatedAt: new Date().toISOString(),
      };
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(payload));
      return;
    }

    // Archived bill PDFs, so the dashboard can link to them.
    if (route.startsWith('/bills/')) {
      const file = path.join(DATA, route.replace(/^\//, ''));
      if (file.startsWith(path.join(DATA, 'bills')) && fs.existsSync(file)) {
        res.writeHead(200, { 'Content-Type': 'application/pdf' });
        fs.createReadStream(file).pipe(res);
        return;
      }
    }

    const file = path.join(DASH, route === '/' ? 'index.html' : route.replace(/^\//, ''));

    if (file.startsWith(DASH) && fs.existsSync(file) && fs.statSync(file).isFile()) {
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'text/plain; charset=utf-8' });
      fs.createReadStream(file).pipe(res);
      return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
  });

  return new Promise(resolve => {
    // 127.0.0.1, not 0.0.0.0 — this is personal billing data.
    server.listen(port, '127.0.0.1', () => {
      console.log(`\n  myDEH dashboard  ->  http://localhost:${port}`);
      console.log('  Ctrl+C to stop\n');
      resolve(server);
    });
  });
}

module.exports = { serve };
