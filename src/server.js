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

  return new Promise((resolve, reject) => {
    // A busy port must not surface as an unhandled 'error' event and a stack
    // trace — that reads as a crash when the usual cause is simply that the
    // dashboard is already open in another window.
    server.on('error', async err => {
      if (err.code !== 'EADDRINUSE') {
        reject(err);
        return;
      }

      const mine = await isOwnDashboard(port);

      if (mine) {
        console.log(`\n  Already running  ->  http://localhost:${port}`);
        console.log('  Using the instance that is already up.\n');
        resolve(null);
        return;
      }

      console.log(`\n  Port ${port} is already in use by something else.`);
      console.log('  Either stop that program, or choose another port:\n');
      console.log(`      set PORT=4801 && node cli.js serve`);
      console.log(`      mydei.bat serve            (uses PORT if set)\n`);
      process.exitCode = 1;
      resolve(null);
    });

    // 127.0.0.1, not 0.0.0.0 — this is personal billing data.
    server.listen(port, '127.0.0.1', () => {
      console.log(`\n  myDEH dashboard  ->  http://localhost:${port}`);
      console.log('  Ctrl+C to stop\n');
      resolve(server);
    });
  });
}

/**
 * Is the thing already listening on this port our own dashboard?
 *
 * Distinguishes "you already have it open" from "something unrelated has the
 * port", which need different advice.
 */
function isOwnDashboard(port) {
  return new Promise(resolve => {
    const req = http.get(
      { host: '127.0.0.1', port, path: '/api/data', timeout: 1500 },
      res => {
        // Read it all: truncating would break JSON.parse once there are
        // enough bills, and misreport our own dashboard as a foreign process.
        let body = '';
        res.setEncoding('utf8');
        res.on('data', c => { body += c; });
        res.on('end', () => {
          try {
            resolve(Array.isArray(JSON.parse(body).properties));
          } catch (e) {
            resolve(false);
          }
        });
      }
    );

    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.on('error', () => resolve(false));
  });
}

module.exports = { serve };
