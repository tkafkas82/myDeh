/**
 * Turn portal tables into structured bills.
 *
 * Deliberately driven by *column headers*, not CSS selectors or column
 * positions. A portal redesign that moves a column, renames a class or adds a
 * column then changes nothing here — whereas `td:nth-child(3)` would silently
 * start reading the wrong value, which is the worst kind of failure for
 * financial data.
 *
 * Every field is optional: a row that yields an amount and a date is useful
 * even if consumption is missing.
 */

'use strict';

const { fold, containsAny, parseAmount, parseDate, parseKwh } = require('./greek');

/**
 * Column vocabulary. First match wins, so more specific terms come first.
 * All compared folded (accent- and case-insensitive).
 */
const COLUMNS = [
  ['dueDate', ['ημερομηνια ληξης', 'ληξη προθεσμιας', 'ληξης', 'πληρωτεο εως', 'προθεσμια']],
  ['issueDate', ['ημερομηνια εκδοσης', 'εκδοσης', 'ημερομηνια λογαριασμου', 'ημ/νια']],
  ['period', ['περιοδος', 'περιοδος καταναλωσης', 'διαστημα', 'μηνας']],
  ['amount', ['ποσο πληρωμης', 'πληρωτεο ποσο', 'συνολικο ποσο', 'ποσο', 'οφειλη', 'υπολοιπο', 'χρεωση']],
  ['kwh', ['καταναλωση', 'kwh', 'κατανάλωση kwh', 'ενεργεια']],
  ['status', ['κατασταση', 'status', 'εξοφληση']],
  ['billNumber', ['αριθμος λογαριασμου', 'κωδικος λογαριασμου', 'αρ. λογαριασμου', 'αριθμος παραστατικου']],
  ['supply', ['αριθμος παροχης', 'παροχη', 'αρ. παροχης']],
  ['meter', ['μετρητης', 'αριθμος μετρητη']],
];

/** Words that mean "settled" / "unsettled" in a status cell. */
const PAID_WORDS = ['εξοφλημ', 'πληρωμενο', 'πληρωθηκε', 'paid', 'εξοφληθηκε'];
const UNPAID_WORDS = ['ανεξοφλητ', 'εκκρεμ', 'οφειλ', 'unpaid', 'ληξιπροθεσμ'];

/**
 * Map a table's header cells onto known fields.
 * @param {string[]} headers
 * @returns {Record<string, number>} field -> column index
 */
function mapHeaders(headers) {
  const map = {};
  const used = new Set();

  headers.forEach((raw, i) => {
    const h = fold(raw);
    if (!h) return;

    for (const [field, synonyms] of COLUMNS) {
      if (map[field] !== undefined) continue;
      // Longest synonym first so 'ποσο πληρωμης' beats 'ποσο'.
      const ordered = [...synonyms].sort((a, b) => b.length - a.length);
      if (ordered.some(s => h.includes(fold(s)))) {
        if (used.has(i)) return;
        map[field] = i;
        used.add(i);
        return;
      }
    }
  });

  return map;
}

/**
 * Interpret a status cell, falling back to the amount when there is no status
 * column at all (a zero balance means nothing is owed).
 * @param {string} raw
 * @param {number|null} amount
 * @returns {'paid'|'unpaid'|'unknown'}
 */
function readStatus(raw, amount) {
  if (raw) {
    if (containsAny(raw, PAID_WORDS)) return 'paid';
    if (containsAny(raw, UNPAID_WORDS)) return 'unpaid';
  }
  if (amount === 0) return 'paid';
  return 'unknown';
}

/**
 * Extract bills from one table.
 *
 * @param {{headers: string[], rows: string[][], links?: (string|null)[][]}} table
 * @returns {object[]}
 */
function billsFromTable(table) {
  const headers = table.headers || [];
  const map = mapHeaders(headers);

  // Without at least an amount or a date this is not a bill table.
  if (map.amount === undefined && map.dueDate === undefined && map.issueDate === undefined) {
    return [];
  }

  const bills = [];

  (table.rows || []).forEach((cells, rowIndex) => {
    const at = field => (map[field] === undefined ? '' : (cells[map[field]] || '').trim());

    const amount = parseAmount(at('amount'));
    const dueDate = parseDate(at('dueDate'));
    const issueDate = parseDate(at('issueDate'));
    const periodRaw = at('period');

    // A row with no money and no dates is a spacer or a total line.
    if (amount === null && !dueDate && !issueDate) return;

    const pdf = (table.links && table.links[rowIndex] || []).find(h => h && /\.pdf|invoice|download|εκτυπωσ/i.test(h)) || null;

    bills.push({
      billNumber: at('billNumber') || null,
      issueDate,
      dueDate,
      period: periodRaw || null,
      periodMonth: parseDate(periodRaw) ? parseDate(periodRaw).slice(0, 7) : null,
      amount,
      kwh: parseKwh(at('kwh')),
      status: readStatus(at('status'), amount),
      statusRaw: at('status') || null,
      supply: at('supply') || null,
      meter: at('meter') || null,
      pdfUrl: pdf,
      // Kept so a mis-mapped column can be diagnosed without re-scraping.
      raw: cells,
    });
  });

  return bills;
}

/**
 * Pick the tables from a page that actually look like bills, and parse them.
 * @param {Array} tables
 */
function billsFromPage(tables) {
  const all = [];
  for (const t of tables || []) {
    for (const bill of billsFromTable(t)) all.push(bill);
  }
  return dedupe(all);
}

/** Same bill can appear on a summary page and a detail page. */
function dedupe(bills) {
  const seen = new Map();
  for (const b of bills) {
    const key = [b.billNumber, b.issueDate, b.dueDate, b.amount].join('|');
    if (!seen.has(key)) seen.set(key, b);
  }
  return [...seen.values()];
}

/**
 * Roll bills up per property, for the dashboard.
 * @param {object[]} properties
 */
function summarise(properties) {
  return properties.map(p => {
    const bills = p.bills || [];
    const unpaid = bills.filter(b => b.status === 'unpaid');
    const amounts = bills.map(b => b.amount).filter(n => typeof n === 'number');
    const kwhs = bills.map(b => b.kwh).filter(n => typeof n === 'number');

    const upcoming = bills
      .filter(b => b.dueDate && b.status !== 'paid')
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate));

    const byYear = {};
    for (const b of bills) {
      const y = (b.issueDate || b.dueDate || '').slice(0, 4);
      if (!y || typeof b.amount !== 'number') continue;
      byYear[y] = (byYear[y] || 0) + b.amount;
    }

    return {
      ...p,
      stats: {
        billCount: bills.length,
        outstanding: unpaid.reduce((s, b) => s + (b.amount || 0), 0),
        unpaidCount: unpaid.length,
        nextDue: upcoming.length ? upcoming[0].dueDate : null,
        totalBilled: amounts.reduce((s, n) => s + n, 0),
        avgBill: amounts.length ? amounts.reduce((s, n) => s + n, 0) / amounts.length : null,
        lastKwh: kwhs.length ? kwhs[0] : null,
        avgKwh: kwhs.length ? kwhs.reduce((s, n) => s + n, 0) / kwhs.length : null,
        byYear,
      },
    };
  });
}

module.exports = {
  COLUMNS,
  mapHeaders,
  billsFromTable,
  billsFromPage,
  readStatus,
  summarise,
  dedupe,
};
