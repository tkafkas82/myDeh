/**
 * Local store: current snapshot plus history.
 *
 * Plain JSON on disk, no database dependency. History matters because the
 * portal stops showing older bills after a while — once a bill has been seen it
 * is kept here forever, so a long-run cost and consumption record survives the
 * portal forgetting it.
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const { DATA } = require('./browser');

const CURRENT = path.join(DATA, 'current.json');
const HISTORY = path.join(DATA, 'history.json');

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    return fallback;
  }
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2));
}

/** Stable identity for a bill, so re-runs update rather than duplicate. */
function billKey(bill) {
  return [
    bill.billNumber || '',
    bill.issueDate || '',
    bill.dueDate || '',
    bill.amount == null ? '' : bill.amount,
  ].join('|');
}

/** Stable identity for a property. */
function propertyKey(property) {
  return String(property.supply || property.contractAccount || property.name || '').trim();
}

/**
 * Merge a freshly scraped set of properties into the history.
 *
 * Newly seen bills are added; bills already known are updated in place (status
 * can change from unpaid to paid). Nothing is ever removed, which is the whole
 * point of keeping history.
 *
 * @returns {{added: number, updated: number, properties: number}}
 */
function merge(scraped, now = new Date().toISOString()) {
  const history = readJson(HISTORY, { properties: {}, runs: [] });

  let added = 0;
  let updated = 0;

  for (const property of scraped) {
    const key = propertyKey(property);
    if (!key) continue;

    const existing = history.properties[key] || {
      firstSeen: now,
      name: property.name || key,
      supply: property.supply || null,
      contractAccount: property.contractAccount || null,
      address: property.address || null,
      bills: {},
    };

    // Refresh descriptive fields, keeping any earlier value if now missing.
    existing.name = property.name || existing.name;
    existing.address = property.address || existing.address;
    existing.supply = property.supply || existing.supply;
    existing.contractAccount = property.contractAccount || existing.contractAccount;
    existing.lastSeen = now;

    for (const bill of property.bills || []) {
      const bk = billKey(bill);
      if (!bk.replace(/\|/g, '')) continue;

      if (existing.bills[bk]) {
        const before = JSON.stringify(existing.bills[bk]);
        existing.bills[bk] = { ...existing.bills[bk], ...bill, lastSeen: now };
        if (JSON.stringify(existing.bills[bk]) !== before) updated++;
      } else {
        existing.bills[bk] = { ...bill, firstSeen: now, lastSeen: now };
        added++;
      }
    }

    history.properties[key] = existing;
  }

  history.runs.push({ at: now, properties: scraped.length, added, updated });
  // Keep the run log from growing without bound.
  if (history.runs.length > 500) history.runs = history.runs.slice(-500);

  writeJson(HISTORY, history);

  return { added, updated, properties: Object.keys(history.properties).length };
}

/** Everything known, shaped for the dashboard and CSV. */
function all() {
  const history = readJson(HISTORY, { properties: {}, runs: [] });

  const properties = Object.entries(history.properties).map(([key, p]) => ({
    key,
    name: p.name,
    supply: p.supply,
    contractAccount: p.contractAccount,
    address: p.address,
    firstSeen: p.firstSeen,
    lastSeen: p.lastSeen,
    bills: Object.values(p.bills || {}).sort((a, b) =>
      String(b.issueDate || b.dueDate || '').localeCompare(String(a.issueDate || a.dueDate || ''))
    ),
  }));

  return { properties, runs: history.runs || [] };
}

function saveCurrent(payload) {
  writeJson(CURRENT, payload);
}

function readCurrent() {
  return readJson(CURRENT, null);
}

module.exports = { merge, all, saveCurrent, readCurrent, billKey, propertyKey, CURRENT, HISTORY };
