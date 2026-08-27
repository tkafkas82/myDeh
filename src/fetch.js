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
 * Each property has its own page at /el/account/<contract account>/, which is
 * where its ledger table lives. Enumerating those links is exact, so it is
 * tried before any of the guesswork below.
 */
const ACCOUNT_LINK = /\/(?:el|en)\/account\/(\d{6,})/;

async function findAccountPages(page) {
  const hrefs = await page
    .evaluate(() => [...document.querySelectorAll('a[href]')].map(a => a.href))
    .catch(() => []);

  const ids = [];
  for (const href of hrefs) {
    const m = href.match(ACCOUNT_LINK);
    if (m && !ids.includes(m[1])) ids.push(m[1]);
  }

  return ids.map(id => ({
    name: id,
    contractAccount: id,
    supply: null,
    address: null,
    url: `${BASE}/el/account/${id}/`,
    source: 'account-page',
  }));
}

/**
 * Best-effort human label for a property, read off its own page.
 *
 * The account pages carry no obvious address element, so this looks for a
 * labelled value and falls back to the contract account number rather than
 * inventing something.
 */
async function readPropertyLabel(page) {
  return page
    .evaluate(() => {
      const clean = s => (s || '').trim().replace(/\s+/g, ' ');
      const fold = s => clean(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

      for (const el of document.querySelectorAll('dt, th, span, strong, label, p')) {
        const label = fold(el.textContent);
        if (!/διευθυνσ|ακινητ|παροχ/.test(label) || label.length > 40) continue;

        // The value is usually the next element or the parent's other child.
        const candidates = [el.nextElementSibling, el.parentElement && el.parentElement.lastElementChild];
        for (const c of candidates) {
          if (!c || c === el) continue;
          const value = clean(c.textContent);
          if (value && value.length < 120 && value !== clean(el.textContent)) {
            return { label: clean(el.textContent), value };
          }
        }
      }
      return null;
    })
    .catch(() => null);
}

/**
 * Fallback property discovery, for portals that do not use account pages.
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

  // Prefer the per-property account pages: each one owns its ledger, so no
  // guessing is needed about which bill belongs where.
  let properties = await findAccountPages(page);
  let perProperty = properties.length > 0;

  if (!perProperty) {
    properties = await findProperties(page);
  }

  console.log(`  found ${properties.length} property/properties` +
    (properties.length ? ` (via ${properties[0].source})` : ''));

  let result;

  if (perProperty) {
    result = [];

    for (const property of properties) {
      try {
        await page.goto(property.url, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(900); // the ledger is client-rendered
      } catch (e) {
        console.log(`  ${property.contractAccount}: could not open (${e.message.split('\n')[0]})`);
        result.push({ ...property, bills: [] });
        continue;
      }

      const tables = await tablesOn(page).catch(() => []);
      const bills = billsFromPage(tables);

      const label = await readPropertyLabel(page);
      if (label && label.value) property.name = `${label.value} · ${property.contractAccount}`;

      const kinds = bills.reduce((acc, b) => {
        acc[b.kind] = (acc[b.kind] || 0) + 1;
        return acc;
      }, {});

      console.log(
        `    ${property.contractAccount}  ${String(bills.length).padStart(3)} row(s)` +
        (Object.keys(kinds).length ? `  (${Object.entries(kinds).map(([k, n]) => `${n} ${k}`).join(', ')})` : '')
      );

      result.push({ ...property, bills });
    }
  } else {
    console.log('\nLooking for bills...');
    const pages = await collectBills(page);
    for (const f of pages) console.log(`  ${f.bills.length} bill(s) on ${f.url}`);
    const allBills = pages.flatMap(f => f.bills);

    result = properties.length
      ? properties.map(p => ({ ...p, bills: properties.length === 1 ? allBills : [] }))
      : [{ name: 'Unknown property', supply: null, bills: allBills, source: 'none' }];
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

  // Counted from `result`, which both branches above produce — the previous
  // `allBills` only existed in one of them, so this threw after a successful
  // per-property run.
  const rowCount = result.reduce((n, p) => n + (p.bills ? p.bills.length : 0), 0);

  if (!rowCount) {
    console.log('\n  No bills were recognised. Choose "Discover" in mydei.bat,');
    console.log('  then share data/discovery.json so the parsers can be');
    console.log('  calibrated to the real page structure.');
  } else {
    const bills = result.reduce((n, p) => n + p.bills.filter(b => b.kind === 'bill').length, 0);
    const payments = result.reduce((n, p) => n + p.bills.filter(b => b.kind === 'payment').length, 0);
    console.log(`  ledger rows      : ${rowCount} (${bills} bills, ${payments} payments)`);
    console.log('\n  Open the dashboard from mydei.bat, or export to CSV.');
  }
  console.log('');

  await context.close();
  return result;
}

module.exports = { run, findProperties, tablesOn, collectBills };
