/**
 * CSV export, written for Greek Excel.
 *
 * Two things matter and are easy to get wrong:
 *
 *  1. A UTF-8 BOM. Without it Excel opens the file as Windows-1252 and every
 *     Greek address turns to mojibake.
 *  2. A semicolon delimiter. Greek Windows uses "," as the decimal separator,
 *     so Excel's list separator is ";" — a comma-delimited file lands entirely
 *     in column A. The `sep=;` hint line makes it explicit either way.
 *
 * Amounts are written in Greek format (1.234,56) so they are recognised as
 * numbers rather than text.
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const { formatAmount } = require('./greek');

const BOM = '﻿';
const SEP = ';';

function cell(value) {
  if (value == null) return '';
  const s = String(value);
  // Quote when the value could otherwise break the row.
  return /[";\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function row(values) {
  return values.map(cell).join(SEP);
}

const HEADERS = [
  'Ακίνητο',
  'Παροχή',
  'Λογαριασμός Σύμβασης',
  'Διεύθυνση',
  'Αρ. Λογαριασμού',
  'Έκδοση',
  'Λήξη',
  'Περίοδος',
  'Ποσό (€)',
  'Κατανάλωση (kWh)',
  'Κατάσταση',
];

const STATUS_EL = { paid: 'Εξοφλημένος', unpaid: 'Ανεξόφλητος', unknown: '—' };

/**
 * Write one row per bill across all properties.
 *
 * @param {{properties: object[]}} data from store.all()
 * @param {string} file output path
 * @returns {{file: string, rows: number}}
 */
function writeBills(data, file) {
  const lines = [`sep=${SEP}`, row(HEADERS)];
  let count = 0;

  for (const property of data.properties || []) {
    for (const bill of property.bills || []) {
      lines.push(
        row([
          property.name,
          property.supply,
          property.contractAccount,
          property.address,
          bill.billNumber,
          bill.issueDate,
          bill.dueDate,
          bill.period,
          formatAmount(bill.amount),
          bill.kwh == null ? '' : formatAmount(bill.kwh, 0),
          STATUS_EL[bill.status] || bill.status || '',
        ])
      );
      count++;
    }
  }

  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, BOM + lines.join('\r\n') + '\r\n', 'utf8');

  return { file, rows: count };
}

/** A per-property summary sheet. */
function writeSummary(data, file, summarise) {
  const rows = summarise(data.properties || []);

  const lines = [
    `sep=${SEP}`,
    row(['Ακίνητο', 'Παροχή', 'Λογαριασμοί', 'Οφειλή (€)', 'Επόμενη Λήξη', 'Σύνολο (€)', 'Μέσος Λογ. (€)', 'Μέση Κατανάλωση (kWh)']),
  ];

  for (const p of rows) {
    lines.push(
      row([
        p.name,
        p.supply,
        p.stats.billCount,
        formatAmount(p.stats.outstanding),
        p.stats.nextDue || '',
        formatAmount(p.stats.totalBilled),
        p.stats.avgBill == null ? '' : formatAmount(p.stats.avgBill),
        p.stats.avgKwh == null ? '' : formatAmount(p.stats.avgKwh, 0),
      ])
    );
  }

  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, BOM + lines.join('\r\n') + '\r\n', 'utf8');

  return { file, rows: rows.length };
}

module.exports = { writeBills, writeSummary, HEADERS, SEP, BOM };
