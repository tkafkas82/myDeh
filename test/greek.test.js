/**
 * Tests for the Greek number/date/text handling.
 *
 * Run: npm test
 *
 * These are the cases that silently produce wrong money or wrong months if the
 * parsing is naive, so they are worth pinning down before anything is built on
 * top of them.
 */

'use strict';

const assert = require('node:assert');
const g = require('../src/greek');

let pass = 0;
let fail = 0;

function check(label, actual, expected) {
  try {
    assert.deepStrictEqual(actual, expected);
    pass++;
  } catch (e) {
    fail++;
    console.log(`  FAIL  ${label}`);
    console.log(`        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

/* ------------------------------------------------------------------ */
console.log('\nparseAmount — Greek format (. thousands, , decimals)');

check('142,30 €', g.parseAmount('142,30 €'), 142.3);
check('€1.234,56', g.parseAmount('€1.234,56'), 1234.56);
check('1.234.567,89', g.parseAmount('1.234.567,89'), 1234567.89);
check('0,00', g.parseAmount('0,00'), 0);
check('1.234 (thousands, no decimals)', g.parseAmount('1.234'), 1234);
check('12,345 (thousands)', g.parseAmount('12,345'), 12345);

console.log('parseAmount — English format');
check('1,234.56', g.parseAmount('1,234.56'), 1234.56);
check('1.5', g.parseAmount('1.5'), 1.5);
check('plain 310', g.parseAmount('310'), 310);

console.log('parseAmount — signs, units, junk');
check('-45,10', g.parseAmount('-45,10'), -45.1);
check('(45,10) parenthesised negative', g.parseAmount('(45,10)'), -45.1);
check('310 kWh', g.parseAmount('310 kWh'), 310);
check('1.250 kWh', g.parseAmount('1.250 kWh'), 1250);
check('NBSP + euro', g.parseAmount('142,30 €'), 142.3);
check('empty string', g.parseAmount(''), null);
check('no digits', g.parseAmount('—'), null);
check('null', g.parseAmount(null), null);
check('number passthrough', g.parseAmount(88.1), 88.1);

/* ------------------------------------------------------------------ */
console.log('\nparseDate');

check('dd/mm/yyyy is day-first', g.parseDate('03/09/2026'), '2026-09-03');
check('12/09/2026', g.parseDate('12/09/2026'), '2026-09-12');
check('dd-mm-yyyy', g.parseDate('12-09-2026'), '2026-09-12');
check('dd.mm.yyyy', g.parseDate('12.09.2026'), '2026-09-12');
check('ISO stays ISO', g.parseDate('2026-09-12'), '2026-09-12');
check('two-digit year', g.parseDate('12/09/26'), '2026-09-12');
check('Greek genitive month', g.parseDate('12 Σεπτεμβρίου 2026'), '2026-09-12');
check('Greek month, no day', g.parseDate('Σεπτεμβρίου 2026'), '2026-09-01');
check('Greek nominative month', g.parseDate('Ιανουάριος 2026'), '2026-01-01');
check('Μαΐου (accented iota)', g.parseDate('5 Μαΐου 2025'), '2025-05-05');
check('impossible date rejected', g.parseDate('31/02/2026'), null);
check('garbage', g.parseDate('not a date'), null);
check('empty', g.parseDate(''), null);

/* ------------------------------------------------------------------ */
console.log('\nfold — accents and final sigma');

check('accents stripped', g.fold('Κατανάλωση'), 'καταναλωση');
check('final sigma folded', g.fold('Πολιτικός'), 'πολιτικοσ');
check('final sigma matches medial', g.fold('Πολιτικός') === g.fold('πολιτικοσ'), true);
check('accent-insensitive match', g.fold('κάτοψη') === g.fold('ΚΑΤΟΨΗ'), true);
check('whitespace collapsed', g.fold('  Ποσό   Πληρωμής '), 'ποσο πληρωμησ');

console.log('containsAny — header keyword matching');
check('accented header found', g.containsAny('Ημερομηνία Λήξης', ['ληξης']), true);
check('unaccented needle finds accented text', g.containsAny('Ποσό', ['ποσο']), true);
check('miss', g.containsAny('Ποσό', ['καταναλωση']), false);

/* ------------------------------------------------------------------ */
console.log('\nformatAmount — Greek output');

check('1234.56 -> Greek', g.formatAmount(1234.56).replace(/ /g, ' '), '1.234,56');
check('null -> empty', g.formatAmount(null), '');

console.log('\nmonthKey');
check('groups by month', g.monthKey('2026-09-12'), '2026-09');
check('null safe', g.monthKey(null), null);

/* ------------------------------------------------------------------ */
console.log('\n' + '-'.repeat(50));
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
