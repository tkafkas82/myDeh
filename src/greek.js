/**
 * Greek text, number and date handling.
 *
 * This is where the subtle bugs live, so it is kept separate and unit-tested:
 *
 *  - Greek numbers use "." for thousands and "," for decimals — the exact
 *    reverse of English. "1.234,56" is one thousand, not one point two.
 *  - JavaScript's \b and \w are ASCII-only, so Greek keyword matching has to
 *    fold accents and final sigma by hand or it silently never matches.
 *  - Greek dates are dd/mm/yyyy, and month names appear in the genitive
 *    ("12 Σεπτεμβρίου 2026").
 */

'use strict';

/* ------------------------------------------------------------------ */
/* Text folding                                                        */
/* ------------------------------------------------------------------ */

/**
 * Fold a string for accent- and case-insensitive comparison.
 *
 * Stripping combining marks after NFD handles the accents. Final sigma needs
 * folding by hand: it is a distinct code point, not a decomposable accent, so
 * "Πολιτικός" would never match "πολιτικοσ" without this.
 *
 * @param {*} s
 * @returns {string}
 */
function fold(s) {
  return String(s == null ? '' : s)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\u03c2/g, '\u03c3')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Does `haystack` contain any of `needles`, ignoring case and accents?
 * @param {string} haystack
 * @param {string[]} needles
 */
function containsAny(haystack, needles) {
  const h = fold(haystack);
  return needles.some(n => h.includes(fold(n)));
}

/* ------------------------------------------------------------------ */
/* Numbers                                                             */
/* ------------------------------------------------------------------ */

/**
 * Parse a monetary or numeric value written in Greek (or English) format.
 *
 * Handles: "142,30 €", "€1.234,56", "1,234.56", "0,00", "-45,10", "1.234",
 * "310 kWh", "(45,10)" (parenthesised negative).
 *
 * The separator ambiguity is resolved by position: whichever of "." or ","
 * appears last is the decimal separator. With only one separator present, a
 * group of exactly three digits after it is treated as thousands
 * ("1.234" = 1234), anything else as a decimal ("142,30" = 142.3).
 *
 * @param {*} raw
 * @returns {number|null} null when there is no number at all.
 */
function parseAmount(raw) {
  if (raw == null) return null;
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;

  let s = String(raw).trim();
  if (!s) return null;

  // Accounting-style negatives.
  const parenNegative = /^\(.*\)$/.test(s);

  // Keep digits, separators and sign only. Strips €, kWh, spaces, NBSP, etc.
  s = s.replace(/[^\d.,\-]/g, '');
  if (!s || !/\d/.test(s)) return null;

  const negative = parenNegative || s.startsWith('-');
  s = s.replace(/-/g, '');

  const lastDot = s.lastIndexOf('.');
  const lastComma = s.lastIndexOf(',');

  let decimalSep = null;

  if (lastDot !== -1 && lastComma !== -1) {
    // Both present: the later one is the decimal separator.
    decimalSep = lastDot > lastComma ? '.' : ',';
  } else if (lastDot !== -1 || lastComma !== -1) {
    const sep = lastDot !== -1 ? '.' : ',';
    const idx = lastDot !== -1 ? lastDot : lastComma;
    const after = s.length - idx - 1;
    const occurrences = s.split(sep).length - 1;

    // "1.234" or "1.234.567" -> thousands. "142,30" or "1.5" -> decimal.
    decimalSep = (after === 3 && occurrences >= 1 && s.length > 4) ? null : sep;
  }

  let normalised;
  if (decimalSep === null) {
    normalised = s.replace(/[.,]/g, '');
  } else {
    const other = decimalSep === '.' ? ',' : '.';
    normalised = s.split(other).join('').replace(decimalSep, '.');
  }

  const n = Number.parseFloat(normalised);
  if (!Number.isFinite(n)) return null;

  return negative ? -n : n;
}

/**
 * Parse a consumption figure, e.g. "310 kWh", "1.250 kWh", "310".
 * @param {*} raw
 * @returns {number|null}
 */
function parseKwh(raw) {
  return parseAmount(raw);
}

/**
 * Format a number the way a Greek reader expects: 1.234,56
 * @param {number|null} n
 * @param {number} decimals
 */
function formatAmount(n, decimals = 2) {
  if (n == null || !Number.isFinite(n)) return '';
  return n.toLocaleString('el-GR', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/* ------------------------------------------------------------------ */
/* Dates                                                               */
/* ------------------------------------------------------------------ */

// Genitive forms as they appear in dates, plus nominative for safety.
const MONTHS = {
  ιανουαριου: 1, ιανουαριος: 1, ιαν: 1,
  φεβρουαριου: 2, φεβρουαριος: 2, φεβ: 2,
  μαρτιου: 3, μαρτιος: 3, μαρ: 3,
  απριλιου: 4, απριλιος: 4, απρ: 4,
  μαιου: 5, μαιος: 5, μαι: 5,
  ιουνιου: 6, ιουνιος: 6, ιουν: 6,
  ιουλιου: 7, ιουλιος: 7, ιουλ: 7,
  αυγουστου: 8, αυγουστος: 8, αυγ: 8,
  σεπτεμβριου: 9, σεπτεμβριος: 9, σεπ: 9,
  οκτωβριου: 10, οκτωβριος: 10, οκτ: 10,
  νοεμβριου: 11, νοεμβριος: 11, νοε: 11,
  δεκεμβριου: 12, δεκεμβριος: 12, δεκ: 12,
};

/**
 * Parse a date and return it as ISO yyyy-mm-dd.
 *
 * Handles dd/mm/yyyy, dd-mm-yyyy, dd.mm.yyyy, yyyy-mm-dd, two-digit years,
 * and Greek month names ("12 Σεπτεμβρίου 2026", "Σεπ 2026").
 *
 * Day-first is assumed for ambiguous numeric dates, which is the Greek
 * convention — 03/09/2026 is 3 September, not 9 March.
 *
 * @param {*} raw
 * @returns {string|null} ISO date, or null.
 */
function parseDate(raw) {
  if (raw == null) return null;
  if (raw instanceof Date && !Number.isNaN(raw.valueOf())) {
    return raw.toISOString().slice(0, 10);
  }

  const s = String(raw).trim();
  if (!s) return null;

  // ISO first — unambiguous.
  const iso = s.match(/(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (iso) return build(+iso[1], +iso[2], +iso[3]);

  // Numeric, day first.
  const dmy = s.match(/(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/);
  if (dmy) {
    let year = +dmy[3];
    if (year < 100) year += year < 70 ? 2000 : 1900;
    return build(year, +dmy[2], +dmy[1]);
  }

  // Greek month name, with or without a day.
  const folded = fold(s);
  for (const [name, month] of Object.entries(MONTHS)) {
    if (!folded.includes(name)) continue;
    const y = folded.match(/(\d{4})/);
    if (!y) continue;
    const dayMatch = folded.match(/(\d{1,2})\s+[a-zα-ω]/);
    const day = dayMatch ? +dayMatch[1] : 1;
    return build(+y[1], month, day);
  }

  return null;
}

function build(year, month, day) {
  if (!year || !month || !day) return null;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;

  const d = new Date(Date.UTC(year, month - 1, day));
  // Reject impossible dates that JS would silently roll over (31 Feb).
  if (d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null;

  return d.toISOString().slice(0, 10);
}

/** yyyy-mm from an ISO date, for grouping bills by month. */
function monthKey(isoDate) {
  return isoDate ? isoDate.slice(0, 7) : null;
}

module.exports = {
  fold,
  containsAny,
  parseAmount,
  parseKwh,
  formatAmount,
  parseDate,
  monthKey,
  MONTHS,
};
