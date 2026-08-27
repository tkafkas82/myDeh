#!/usr/bin/env node
/**
 * myDEH — fetch and organize your DEI properties and bills.
 *
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

async function main() {
  switch (command) {
    case 'login': {
      const { login } = require('./src/login');
      const ok = await login();
      process.exitCode = ok ? 0 : 1;
      break;
    }

    case 'fetch': {
      const { run } = require('./src/fetch');
      // Headed is useful when something is not being found.
      await run({ headless: !has('show'), pdfs: !has('no-pdfs') });
      break;
    }

    case 'discover': {
      const { discover } = require('./src/discover');
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
      await serve({ port: Number(process.env.PORT) || 4800 });
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
