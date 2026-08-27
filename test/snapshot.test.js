/**
 * Verify the parser against a real saved account page.
 *
 *     node test/snapshot.test.js
 *
 * Needs data/snapshots/ from `node cli.js discover`, so it is not part of
 * `npm test`. It deliberately reports only structure — column mapping, row
 * counts and per-field fill rates — never a date, an amount or an address.
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const { chromium } = require('playwright-core');
const { findChrome } = require('../src/browser');
const { tablesOn } = require('../src/fetch');
const { mapHeaders, billsFromPage } = require('../src/parse');

const SNAP = path.join(__dirname, '..', 'data', 'snapshots');

(async () => {
  if (!fs.existsSync(SNAP)) {
    console.log('\nNo data/snapshots/ — run "node cli.js discover" first.\n');
    process.exit(0);
  }

  // Account pages are the ones with the ledger table.
  const files = fs.readdirSync(SNAP).filter(f => /_el_account_\d+/.test(f) && f.endsWith('.html'));

  if (!files.length) {
    console.log('\nNo account-page snapshots found in data/snapshots/.\n');
    process.exit(0);
  }

  const browser = await chromium.launch({ executablePath: findChrome(), headless: true });
  const context = await browser.newContext({ locale: 'el-GR' });

  let pass = 0;
  let fail = 0;
  const check = (label, ok, detail = '') => {
    console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? ' — ' + detail : ''}`);
    ok ? pass++ : fail++;
  };

  console.log(`\n${files.length} account snapshot(s)\n`);

  let totalRows = 0;

  for (const file of files) {
    const page = await context.newPage();
    try {
      // Strip the page's own scripts before loading it.
      //
      // The snapshot contains the *rendered* table, but reloading it boots the
      // site's Vue app again, which re-renders and can wipe that table before
      // it is read — the test failed roughly one run in three. Nothing here
      // needs the page's JavaScript; page.evaluate is injected separately and
      // still works.
      const html = fs
        .readFileSync(path.join(SNAP, file), 'utf8')
        .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');

      await page.setContent(html, { waitUntil: 'domcontentloaded' });

      const tables = await tablesOn(page);
      const ledger = tables.find(t => t.headers.some(h => /Είδος κίνησης/i.test(h)));

      if (!ledger) {
        check(file.slice(0, 42), false, 'no ledger table found');
        continue;
      }

      const map = mapHeaders(ledger.headers);
      const bills = billsFromPage([ledger]);
      totalRows += bills.length;

      // Every column the live table has must be recognised.
      const required = ['issueDate', 'type', 'period', 'dueDate', 'amountCurrent', 'amountOverdue', 'amount'];
      const missing = required.filter(f => map[f] === undefined);

      const rate = f => bills.length
        ? Math.round((bills.filter(b => b[f] !== null && b[f] !== undefined).length / bills.length) * 100)
        : 0;

      const kinds = bills.reduce((a, b) => { a[b.kind] = (a[b.kind] || 0) + 1; return a; }, {});

      check(
        file.replace(/^mydei\.dei\.gr_/, '').slice(0, 34),
        missing.length === 0 && bills.length > 0,
        `${bills.length} rows · mapped ${Object.keys(map).length}/7` +
        (missing.length ? ` · MISSING ${missing.join(',')}` : '') +
        ` · dates ${rate('issueDate')}% · amounts ${rate('amount')}%` +
        ` · kinds ${JSON.stringify(kinds)}`
      );
    } catch (e) {
      check(file.slice(0, 42), false, e.message.split('\n')[0]);
    } finally {
      await page.close().catch(() => {});
    }
  }

  await browser.close().catch(() => {});

  console.log(`\ntotal ledger rows parsed: ${totalRows}`);
  console.log(`${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
})();
