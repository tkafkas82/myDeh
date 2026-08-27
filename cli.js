#!/usr/bin/env node
/**
 * myDEH — fetch and organize your DEI properties and bills.
 *
 *   node cli.js run        do everything: sign in if needed, fetch, open dashboard
 *   node cli.js login      sign in once, in a real browser window
 *   node cli.js fetch      scrape properties + bills, archive PDFs
 *   node cli.js discover   map the portal's structure (for calibration)
 *   node cli.js name      label a property: name <account> "<label>"
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

      const started = await serve({ port: Number(process.env.PORT) || undefined });
      // Only open what we actually own. Opening a port held by an unrelated
      // local app lands the user on that app instead of this dashboard.
      if (started.url) openBrowser(started.url);
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
        console.log('\nNothing stored yet — choose START or Fetch in mydei.bat.\n');
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
      const started = await serve({ port: Number(process.env.PORT) || undefined });
      if (started.url && !has('no-open')) openBrowser(started.url);
      break;
    }

    // node cli.js name 300015431312 "Σέριφος — Λιβάδι"
    case 'name': {
      const store = require('./src/store');
      const account = process.argv[3];
      const label = process.argv.slice(4).join(' ');

      if (!account) {
        const names = store.readNames();
        const data = store.all();
        console.log('\n  Current names (edit with: node cli.js name <account> "<label>")\n');
        for (const p of data.properties) {
          const own = names[p.key] || names[p.contractAccount];
          console.log(`  ${String(p.key).padEnd(16)} ${own ? own : '(unnamed)'}`);
        }
        console.log('');
        break;
      }

      store.setName(account, label);
      console.log(label ? `\n  ${account} -> ${label}\n` : `\n  ${account} name cleared\n`);
      break;
    }

    case 'status': {
      const store = require('./src/store');
      const { summarise } = require('./src/parse');
      const { formatAmount } = require('./src/greek');

      const data = store.all();
      if (!data.properties.length) {
        console.log('\nNothing stored yet — choose START in mydei.bat.\n');
        break;
      }

      const rows = summarise(data.properties);
      console.log('');
      for (const p of rows) {
        // The account number is always shown: two supplies can sit at the same
        // address (a flat and its shared meter, say), so the address alone does
        // not tell them apart.
        const label = (p.name || p.key).slice(0, 40).padEnd(42);
        const account = String(p.contractAccount || p.key).padEnd(14);

        console.log(
          `  ${label} ${account} ${String(p.stats.billCount).padStart(2)} rows  ` +
          `owed ${formatAmount(p.stats.outstanding).padStart(9)} €  next ${p.stats.nextDue || '—'}`
        );
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
