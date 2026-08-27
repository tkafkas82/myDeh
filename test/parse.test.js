/**
 * Tests for header-driven bill extraction.
 *
 * The point of these: prove the parser reads by *meaning*, not position — so a
 * reordered, renamed or extra column cannot silently shift money into the wrong
 * field. That is the failure mode worth defending against here.
 */

'use strict';

const assert = require('node:assert');
const p = require('../src/parse');

let pass = 0;
let fail = 0;

function check(label, actual, expected) {
  try {
    assert.deepStrictEqual(actual, expected);
    pass++;
  } catch (e) {
    fail++;
    console.log(`  FAIL  ${label}`);
    console.log(`        expected ${JSON.stringify(expected)}`);
    console.log(`        got      ${JSON.stringify(actual)}`);
  }
}

/* ------------------------------------------------------------------ */
console.log('\nmapHeaders');

check(
  'plain Greek headers',
  p.mapHeaders(['Ημερομηνία Έκδοσης', 'Ημερομηνία Λήξης', 'Ποσό', 'Κατανάλωση']),
  { issueDate: 0, dueDate: 1, amount: 2, kwh: 3 }
);

check(
  'columns reordered — mapping follows the header, not the position',
  p.mapHeaders(['Ποσό', 'Κατανάλωση', 'Ημερομηνία Λήξης']),
  { amount: 0, kwh: 1, dueDate: 2 }
);

check(
  'unknown columns are ignored, not mis-assigned',
  p.mapHeaders(['Α/Α', 'Ημερομηνία Λήξης', 'Σχόλια', 'Ποσό']),
  { dueDate: 1, amount: 3 }
);

check(
  'specific beats generic: "Ποσό Πληρωμής" wins over "Ποσό"',
  p.mapHeaders(['Ποσό Πληρωμής', 'Κατάσταση']).amount,
  0
);

check('accents are irrelevant', p.mapHeaders(['ΠΟΣΟ', 'ΛΗΞΗΣ']), { amount: 0, dueDate: 1 });

/* ------------------------------------------------------------------ */
console.log('\nbillsFromTable');

const table = {
  headers: ['Αριθμός Λογαριασμού', 'Ημερομηνία Έκδοσης', 'Ημερομηνία Λήξης', 'Κατανάλωση', 'Ποσό Πληρωμής', 'Κατάσταση'],
  rows: [
    ['700123456', '05/07/2026', '20/07/2026', '310 kWh', '142,30 €', 'Ανεξόφλητος'],
    ['700123123', '05/05/2026', '20/05/2026', '1.250 kWh', '1.234,56 €', 'Εξοφλημένος'],
    ['', '', '', '', '', ''],                     // spacer row
    ['ΣΥΝΟΛΟ', '', '', '', '1.376,86 €', ''],      // totals row keeps an amount
  ],
  links: [[null], [null], [null], [null]],
};

const bills = p.billsFromTable(table);

check('spacer row dropped, real rows kept', bills.length, 3);

check('Greek amount parsed', bills[0].amount, 142.3);
check('thousands amount parsed', bills[1].amount, 1234.56);
check('due date day-first', bills[0].dueDate, '2026-07-20');
check('issue date', bills[0].issueDate, '2026-07-05');
check('kWh with unit', bills[0].kwh, 310);
check('kWh with thousands separator', bills[1].kwh, 1250);
check('unpaid detected from Greek', bills[0].status, 'unpaid');
check('paid detected from Greek', bills[1].status, 'paid');
check('bill number kept', bills[0].billNumber, '700123456');

console.log('\nreadStatus');
check('εξοφλημένος -> paid', p.readStatus('Εξοφλημένος', 100), 'paid');
check('ανεξόφλητος -> unpaid', p.readStatus('Ανεξόφλητος', 100), 'unpaid');
check('ληξιπρόθεσμος -> unpaid', p.readStatus('Ληξιπρόθεσμος', 100), 'unpaid');
check('no status + zero amount -> paid', p.readStatus('', 0), 'paid');
check('no status + amount -> unknown', p.readStatus('', 100), 'unknown');

/* ------------------------------------------------------------------ */
console.log('\nnon-bill tables are rejected');

check(
  'a table of addresses yields nothing',
  p.billsFromTable({ headers: ['Διεύθυνση', 'Πόλη', 'ΤΚ'], rows: [['Οδός 1', 'Αθήνα', '11111']] }),
  []
);

/* ------------------------------------------------------------------ */
console.log('\nsummarise');

const summary = p.summarise([
  {
    name: 'Κολωνάκι',
    supply: '1234',
    bills: [
      { amount: 142.3, kwh: 310, status: 'unpaid', dueDate: '2026-09-12', issueDate: '2026-07-05' },
      { amount: 88.1, kwh: 190, status: 'paid', dueDate: '2026-05-20', issueDate: '2026-05-05' },
    ],
  },
]);

check('outstanding counts only unpaid', summary[0].stats.outstanding, 142.3);
check('unpaid count', summary[0].stats.unpaidCount, 1);
check('next due date', summary[0].stats.nextDue, '2026-09-12');
check('total billed', Math.round(summary[0].stats.totalBilled * 100) / 100, 230.4);
check('yearly rollup', summary[0].stats.byYear['2026'], 230.4);

/* ------------------------------------------------------------------ */
console.log('\n' + '-'.repeat(50));
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
