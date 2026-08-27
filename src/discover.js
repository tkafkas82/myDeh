/**
 * Map the signed-in portal.
 *
 * The property and bill pages sit behind the login, so their markup cannot be
 * known in advance. This crawls the authenticated area, saves each page, and
 * scores every page and table for how bill-like it looks — which is what the
 * parsers are then written against, instead of guessed selectors.
 *
 * Everything is written under data/snapshots/. Those files contain your real
 * account data, so data/ is gitignored.
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const { open, firstPage, DATA } = require('./browser');
const { isSignedIn, BASE } = require('./login');
const { fold, containsAny } = require('./greek');

const SNAP = path.join(DATA, 'snapshots');

// Vocabulary that marks a page or table as interesting.
const BILL_WORDS = [
  'λογαριασμ',      // λογαριασμός / λογαριασμοί  (bill/account)
  'παροχ',          // παροχή / παροχές          (supply point)
  'καταναλωσ',      // κατανάλωση                (consumption)
  'ποσο',           // ποσό                      (amount)
  'πληρωμ',         // πληρωμή                   (payment)
  'εκκαθαρισ',      // εκκαθάριση                (settlement)
  'ληξ',            // λήξη                      (due)
  'οφειλ',          // οφειλή                    (debt/outstanding)
  'τιμολογ',        // τιμολόγιο                 (invoice)
  'μετρητ',         // μετρητής                  (meter)
  'kwh',
];

const SKIP = /logout|αποσ[υύ]νδεση|signout|\.pdf($|\?)|mailto:|tel:|javascript:/i;

function slug(url) {
  return url
    .replace(/^https?:\/\//, '')
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .replace(/_+/g, '_')
    .slice(0, 120);
}

/**
 * Pull a structural summary out of a page: tables with their headers, plus any
 * repeated "card" blocks, which is how portals usually list supply points.
 */
async function summarise(page) {
  return page.evaluate(() => {
    const out = { tables: [], headings: [], selects: [], counts: {} };

    for (const h of document.querySelectorAll('h1,h2,h3')) {
      const t = (h.textContent || '').trim().replace(/\s+/g, ' ');
      if (t) out.headings.push({ tag: h.tagName.toLowerCase(), text: t.slice(0, 120) });
    }

    document.querySelectorAll('table').forEach((table, i) => {
      const headers = [...table.querySelectorAll('thead th, thead td, tr:first-child th')]
        .map(c => (c.textContent || '').trim().replace(/\s+/g, ' '))
        .filter(Boolean);

      const rows = [...table.querySelectorAll('tbody tr')].slice(0, 3).map(tr =>
        [...tr.querySelectorAll('td,th')].map(c => (c.textContent || '').trim().replace(/\s+/g, ' '))
      );

      out.tables.push({
        index: i,
        headers,
        rowCount: table.querySelectorAll('tbody tr').length || table.querySelectorAll('tr').length,
        sampleRows: rows,
      });
    });

    // <select> options often hold the list of supply points.
    document.querySelectorAll('select').forEach(sel => {
      out.selects.push({
        name: sel.getAttribute('name') || sel.id || '',
        options: [...sel.options].slice(0, 30).map(o => (o.textContent || '').trim()),
      });
    });

    // Class names that repeat a lot are usually the card/list components.
    const tally = {};
    document.querySelectorAll('[class]').forEach(el => {
      for (const c of el.classList) {
        if (/^(col|row|container|d-|px-|py-|mt-|mb-|text-)/.test(c)) continue;
        tally[c] = (tally[c] || 0) + 1;
      }
    });
    out.counts = Object.fromEntries(
      Object.entries(tally).filter(([, n]) => n >= 3).sort((a, b) => b[1] - a[1]).slice(0, 25)
    );

    return out;
  });
}

async function discover(opts = {}) {
  const maxPages = opts.max || 25;

  fs.mkdirSync(SNAP, { recursive: true });

  const { context } = await open({ headless: opts.headless !== false });
  const page = await firstPage(context);

  await page.goto(`${BASE}/el/`, { waitUntil: 'domcontentloaded' }).catch(() => {});

  if (!(await isSignedIn(page).catch(() => false))) {
    // Reached only if the session lapsed between the check and here; callers
    // sign in first. Worded for whoever is reading it, terminal or dashboard.
    console.log('\nThe myDEH session is not active. Use "Σύνδεση" / Sign in.\n');
    await context.close();
    return null;
  }

  console.log('\nSigned in. Crawling the authenticated area...\n');

  const seen = new Set();
  const queue = [`${BASE}/el/`];
  const report = [];

  while (queue.length && report.length < maxPages) {
    const url = queue.shift();
    if (seen.has(url)) continue;
    seen.add(url);

    let html = '';
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(700); // let any client-side rendering land
      html = await page.content();
    } catch (e) {
      console.log(`  skip ${url} (${e.message.split('\n')[0]})`);
      continue;
    }

    const text = await page.textContent('body').catch(() => '');
    const score = BILL_WORDS.filter(w => fold(text).includes(w)).length;
    const summary = await summarise(page).catch(() => ({ tables: [], headings: [] }));

    const file = path.join(SNAP, slug(url) + '.html');
    fs.writeFileSync(file, html);

    const billTables = summary.tables.filter(t => containsAny(t.headers.join(' '), BILL_WORDS));

    report.push({
      url,
      title: await page.title().catch(() => ''),
      score,
      tables: summary.tables.length,
      billTables: billTables.length,
      headings: summary.headings.slice(0, 6),
      tableHeaders: summary.tables.map(t => t.headers).filter(h => h.length),
      selects: summary.selects,
      repeatedClasses: Object.keys(summary.counts).slice(0, 12),
      snapshot: path.relative(DATA, file),
    });

    console.log(
      `  [${String(score).padStart(2)}] ${summary.tables.length} table(s)  ${url}`
    );

    // Queue same-site links.
    const links = await page
      .evaluate(() => [...document.querySelectorAll('a[href]')].map(a => a.href))
      .catch(() => []);

    for (const href of links) {
      if (!href.startsWith(BASE)) continue;
      if (SKIP.test(href)) continue;
      const clean = href.split('#')[0];
      if (!seen.has(clean) && !queue.includes(clean)) queue.push(clean);
    }
  }

  report.sort((a, b) => b.score - a.score);

  const reportFile = path.join(DATA, 'discovery.json');
  fs.writeFileSync(reportFile, JSON.stringify(report, null, 2));

  console.log('\n' + '─'.repeat(64));
  console.log('Most bill-like pages:\n');
  for (const r of report.slice(0, 8)) {
    console.log(`  score ${r.score}  ${r.url}`);
    if (r.tableHeaders.length) {
      for (const h of r.tableHeaders.slice(0, 2)) console.log(`      headers: ${h.join(' | ')}`);
    }
    for (const s of r.selects.slice(0, 1)) {
      if (s.options.length) console.log(`      select ${s.name}: ${s.options.slice(0, 4).join(' / ')}`);
    }
  }

  console.log(`\n  ${report.length} page(s) saved to data/snapshots/`);
  console.log(`  Summary: data/discovery.json`);
  console.log('\n  These files contain your account data — data/ is gitignored.');
  console.log('  Share data/discovery.json (not the snapshots) to have the');
  console.log('  parsers written against the real structure.\n');

  await context.close();
  return report;
}

module.exports = { discover, BILL_WORDS };
