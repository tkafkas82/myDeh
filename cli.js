#!/usr/bin/env node
/**
 * myDEH — fetch and organize your DEI properties and bills.
 *
 *   node cli.js run        do everything: sign in if needed, fetch, open dashboard
 *   node cli.js login      sign in once, in a real browser window
 *   node cli.js fetch      scrape properties + bills, archive PDFs
 *   node cli.js discover   map the portal's structure (for calibration)
 *   node cli.js export     write CSV files
 *   node cli.js serve      local dashboard
 *   node cli.js status     what is stored right now
 */

'use strict';

const path = require('node:path');

const command = (process.argv[2] || 'help').replace(/^-+/, '');
const flags = new Set(process.argv.slice(3).filter(a => a.startsWith('--')));

function has(flag) {
  return flags.has('--' + flag);
}

/** Open a URL in the default browser. */
function openBrowser(url) {
  const { spawn } = require('node:child_process');
  try {
    if (process.platform === 'win32') {
      // "start" is a shell builtin, and the empty title argument is required
      // or a quoted URL is treated as the window title.
      spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' }).unref();
    } else if (process.platform === 'darwin') {
      spawn('open', [url], { detached: true, stdio: 'ignore' }).unref();
    } else {
      spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
    }
  } catch (e) {
    /* the URL is printed anyway */
  }
}

async function main() {
  switch (command) {
    // The whole flow, so nobody has to know the order of the steps.
    case 'run': {
      const { ensureSignedIn } = require('./src/login');
      const { run } = require('./src/fetch');
      const { serve } = require('./src/server');

      console.log('');
      if (!(await ensureSignedIn())) {
        console.log('\n  Sign-in did not complete, so there is nothing to fetch.\n');
        process.exitCode = 1;
        break;
      }

      await run({ headless: !has('show'), pdfs: !has('no-pdfs') });

      const port = Number(process.env.PORT) || 4800;
      const server = await serve({ port });
      openBrowser(`http://localhost:${port}`);
      if (!server) break; // another instance already has the port
      break;
    }

    case 'login': {
      const { login } = require('./src/login');
      const ok = await login();
      process.exitCode = ok ? 0 : 1;
      break;
    }

    case 'fetch': {
      const { ensureSignedIn } = require('./src/login');
      const { run } = require('./src/fetch');

      // Sign in first if the session has lapsed, so "fetch" always just works
      // instead of failing and telling you to go and run something else.
      console.log('');
      if (!(await ensureSignedIn())) {
        console.log('\n  Sign-in did not complete, so there is nothing to fetch.\n');
        process.exitCode = 1;
        break;
      }

      // Headed is useful when something is not being found.
      await run({ headless: !has('show'), pdfs: !has('no-pdfs') });
      break;
    }

    case 'discover': {
      const { ensureSignedIn } = require('./src/login');
      const { discover } = require('./src/discover');

      // Same as fetch: sign in if the session has lapsed, rather than bailing
      // out and telling you to go and run something else.
      console.log('');
      if (!(await ensureSignedIn())) {
        console.log('\n  Sign-in did not complete, so there is nothing to map.\n');
        process.exitCode = 1;
        break;
      }

      await discover({ headless: !has('show'), max: 30 });
      break;
    }

    case 'export': {
      const store = require('./src/store');
      const csv = require('./src/csv');
      const { summarise } = require('./src/parse');

      const data = store.all();
      if (!data.properties.length) {
        console.log('\nNothing stored yet. Run:  npm run fetch\n');
        break;
      }

      const outDir = path.join(__dirname, 'data', 'export');
      const bills = csv.writeBills(data, path.join(outDir, 'bills.csv'));
      const summary = csv.writeSummary(data, path.join(outDir, 'summary.csv'), summarise);

      console.log(`\n  ${bills.rows} bill row(s)  -> ${path.relative(process.cwd(), bills.file)}`);
      console.log(`  ${summary.rows} property row(s) -> ${path.relative(process.cwd(), summary.file)}`);
      console.log('\n  Written with a UTF-8 BOM and ";" separator so Greek Excel');
      console.log('  opens them correctly.\n');
      break;
    }

    case 'serve': {
      const { serve } = require('./src/server');
      const port = Number(process.env.PORT) || 4800;
      const server = await serve({ port });
      if (!has('no-open')) openBrowser(`http://localhost:${port}`);
      void server;
      break;
    }

    case 'status': {
      const store = require('./src/store');
      const { summarise } = require('./src/parse');
      const { formatAmount } = require('./src/greek');

      const data = store.all();
      if (!data.properties.length) {
        console.log('\nNothing stored yet. Run:  npm run login  then  npm run fetch\n');
        break;
      }

      const rows = summarise(data.properties);
      console.log('');
      for (const p of rows) {
        console.log(`  ${(p.name || p.key).slice(0, 46).padEnd(48)} ${String(p.stats.billCount).padStart(3)} bills  ` +
          `owed ${formatAmount(p.stats.outstanding).padStart(10)} €  next ${p.stats.nextDue || '—'}`);
      }
      const last = data.runs[data.runs.length - 1];
      console.log(`\n  last run: ${last ? last.at : 'never'}\n`);
      break;
    }

    default:
      console.log(require('node:fs').readFileSync(__filename, 'utf8').split('*/')[0].replace(/^#!.*\n/, '').replace(/\/\*\*?/g, '').replace(/^ \* ?/gm, ''));
      break;
  }
}

main().catch(err => {
  console.error('\n' + (err && err.stack ? err.stack : err) + '\n');
  process.exit(1);
});
