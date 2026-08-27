/**
 * Scrape properties and bills from the signed-in portal.
 *
 * Written to survive not knowing the exact markup: tables are located by their
 * headers (see parse.js) and properties by several independent strategies. What
 * it found is always reported, so a miss is visible rather than silent.
 *
 * If the portal's structure defeats the heuristics, `node cli.js discover`
 * dumps the real structure to data/discovery.json to calibrate against.
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const { open, firstPage, DATA } = require('./browser');
const { isSignedIn, BASE } = require('./login');
const { fold, containsAny } = require('./greek');
const { billsFromPage } = require('./parse');
const store = require('./store');

const BILLS_DIR = path.join(DATA, 'bills');

/** Pull every table on the page as {headers, rows, links}. */
async function tablesOn(page) {
  return page.evaluate(() => {
    const clean = s => (s || '').trim().replace(/\s+/g, ' ');

    return [...document.querySelectorAll('table')].map(table => {
      let headers = [...table.querySelectorAll('thead th, thead td')].map(c => clean(c.textContent));

      if (!headers.length) {
        const first = table.querySelector('tr');
        if (first) headers = [...first.querySelectorAll('th,td')].map(c => clean(c.textContent));
      }

      const bodyRows = table.querySelectorAll('tbody tr').length
        ? [...table.querySelectorAll('tbody tr')]
        : [...table.querySelectorAll('tr')].slice(1);

      const rows = bodyRows.map(tr => [...tr.querySelectorAll('td,th')].map(c => clean(c.textContent)));
      const links = bodyRows.map(tr => [...tr.querySelectorAll('a[href]')].map(a => a.href));

      return { headers, rows, links };
    });
  });
}

/**
 * Find the properties (supply points).
 *
 * Tried in order of reliability:
 *   1. a <select> whose options look like supply numbers
 *   2. a table whose headers mention παροχή
 *   3. repeated blocks containing a long digit run next to an address
 */
async function findProperties(page) {
  // 1. Select-based switcher.
  const fromSelect = await page.evaluate(() => {
    const out = [];
    for (const sel of document.querySelectorAll('select')) {
      for (const o of sel.options) {
        const text = (o.textContent || '').trim().replace(/\s+/g, ' ');
        if (/\d{6,}/.test(text)) {
          out.push({ value: o.value, text, select: sel.getAttribute('name') || sel.id || '' });
        }
      }
    }
    return out;
  }).catch(() => []);

  if (fromSelect.length) {
    return fromSelect.map(o => ({
      name: o.text,
      supply: (o.text.match(/\d{6,}/) || [])[0] || null,
      address: o.text.replace(/\d{6,}/, '').replace(/[-–|,]\s*$/, '').trim() || null,
      selectValue: o.value,
      selectName: o.select,
      source: 'select',
    }));
  }

  // 2. A table of supply points.
  const tables = await tablesOn(page);
  for (const t of tables) {
    if (!containsAny(t.headers.join(' '), ['παροχ', 'ακινητ', 'διευθυνσ'])) continue;

    const supplyCol = t.headers.findIndex(h => containsAny(h, ['παροχ']));
    const addrCol = t.headers.findIndex(h => containsAny(h, ['διευθυνσ', 'ακινητ']));
    if (supplyCol === -1) continue;

    const rows = t.rows
      .map(cells => ({
        supply: (String(cells[supplyCol] || '').match(/\d{4,}/) || [])[0] || null,
        address: addrCol === -1 ? null : cells[addrCol] || null,
        name: addrCol === -1 ? cells[supplyCol] : cells[addrCol],
        source: 'table',
      }))
      .filter(r => r.supply);

    if (rows.length) return rows;
  }

  // 3. Repeated card blocks.
  const fromCards = await page.evaluate(() => {
    const out = [];
    const seen = new Set();
    for (const el of document.querySelectorAll('article, li, div')) {
      if (el.children.length > 12) continue;
      const text = (el.textContent || '').trim().replace(/\s+/g, ' ');
      if (text.length > 220) continue;
      const m = text.match(/\b(\d{8,})\b/);
      if (!m) continue;
      if (seen.has(m[1])) continue;
      seen.add(m[1]);
      out.push({ supply: m[1], text });
    }
    return out.slice(0, 30);
  }).catch(() => []);

  return fromCards.map(c => ({
    name: c.text.slice(0, 90),
    supply: c.supply,
    address: null,
    source: 'card',
  }));
}

/** Candidate pages that list bills. */
const BILL_PAGES = [
  '/el/',
  '/el/my-bills/',
  '/el/bills/',
  '/el/logariasmoi/',
  '/el/my-account/',
];

async function collectBills(page) {
  const found = [];

  for (const rel of BILL_PAGES) {
    const url = rel.startsWith('http') ? rel : BASE + rel;
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(600);
    } catch (e) {
      continue;
    }

    const tables = await tablesOn(page).catch(() => []);
    const bills = billsFromPage(tables);
    if (bills.length) found.push({ url, bills });
  }

  return found;
}

/** Download bill PDFs into bills/<property>/<date>.pdf */
async function downloadPdfs(context, property, bills) {
  const dir = path.join(
    BILLS_DIR,
    (property.name || property.supply || 'unknown').replace(/[^\p{L}\p{N}\-_ ]/gu, '').trim().slice(0, 60) || 'unknown'
  );

  let saved = 0;

  for (const bill of bills) {
    if (!bill.pdfUrl) continue;

    const stamp = bill.issueDate || bill.dueDate || bill.billNumber || String(saved);
    const file = path.join(dir, `${stamp}.pdf`);
    if (fs.existsSync(file)) continue;

    try {
      // Fetch through the browser context so the session cookies apply.
      const res = await context.request.get(bill.pdfUrl);
      if (!res.ok()) continue;
      const buf = await res.body();
      if (!buf || buf.length < 1000) continue;

      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(file, buf);
      bill.pdfFile = path.relative(DATA, file);
      saved++;
    } catch (e) {
      /* a failed PDF should never abort the run */
    }
  }

  return saved;
}

/**
 * Full run: properties, their bills, optional PDFs, merged into history.
 * @param {{headless?: boolean, pdfs?: boolean}} opts
 */
async function run(opts = {}) {
  const { context } = await open({ headless: opts.headless !== false });
  const page = await firstPage(context);

  await page.goto(`${BASE}/el/`, { waitUntil: 'domcontentloaded' }).catch(() => {});

  if (!(await isSignedIn(page).catch(() => false))) {
    await context.close();
    // Reached only if the session lapsed between the check and here; callers
    // sign in first. Worded for whoever is reading it, terminal or dashboard.
    console.log('\nThe myDEH session is not active. Use "Σύνδεση" / Sign in.\n');
    return null;
  }

  console.log('\nSigned in. Looking for properties...');

  const properties = await findProperties(page);
  console.log(`  found ${properties.length} property/properties` +
    (properties.length ? ` (via ${properties[0].source})` : ''));

  for (const p of properties) {
    console.log(`    ${p.supply || '?'}  ${p.name || ''}`.slice(0, 90));
  }

  console.log('\nLooking for bills...');

  const pages = await collectBills(page);
  for (const f of pages) console.log(`  ${f.bills.length} bill(s) on ${f.url}`);

  const allBills = pages.flatMap(f => f.bills);

  // Attach bills to properties. When a bill names its own supply, trust that;
  // otherwise, with a single property, everything belongs to it.
  const result = properties.length
    ? properties.map(p => ({
        ...p,
        bills: allBills.filter(b =>
          properties.length === 1 ? true : b.supply && p.supply && String(b.supply).includes(String(p.supply))
        ),
      }))
    : [{ name: 'Unknown property', supply: null, bills: allBills, source: 'none' }];

  // Bills whose supply matched nothing would otherwise be lost.
  const attached = new Set(result.flatMap(p => p.bills));
  const orphans = allBills.filter(b => !attached.has(b));
  if (orphans.length) {
    console.log(`\n  ${orphans.length} bill(s) could not be matched to a property — kept as "Unassigned".`);
    result.push({ name: 'Unassigned', supply: null, bills: orphans, source: 'orphan' });
  }

  if (opts.pdfs !== false) {
    console.log('\nDownloading PDFs...');
    let total = 0;
    for (const p of result) total += await downloadPdfs(context, p, p.bills);
    console.log(`  ${total} new PDF(s)`);
  }

  const merged = store.merge(result);
  store.saveCurrent({ at: new Date().toISOString(), properties: result });

  console.log('\n' + '─'.repeat(56));
  console.log(`  properties known : ${merged.properties}`);
  console.log(`  new bills        : ${merged.added}`);
  console.log(`  updated bills    : ${merged.updated}`);

  if (!allBills.length) {
    console.log('\n  No bills were recognised. Run:  node cli.js discover');
    console.log('  then share data/discovery.json so the parsers can be');
    console.log('  calibrated to the real page structure.');
  } else {
    console.log('\n  Next:  npm run serve      (dashboard)');
    console.log('         npm run export     (CSV)');
  }
  console.log('');

  await context.close();
  return result;
}

module.exports = { run, findProperties, tablesOn, collectBills };
