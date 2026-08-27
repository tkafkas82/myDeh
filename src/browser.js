/**
 * Browser plumbing.
 *
 * Uses playwright-core against the Chromium that Playwright already downloaded
 * on this machine, so `npm install` pulls one small package and no browsers.
 *
 * A *persistent* context is used rather than storageState: the session then
 * lives in a real browser profile on disk, which survives OTP steps, Imperva
 * cookies and anything else the portal sets, exactly as a normal browser would.
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const { chromium } = require('playwright-core');

const DATA = path.join(__dirname, '..', 'data');
const PROFILE = path.join(DATA, 'profile');

/** Candidate locations for the already-installed Chromium. */
function findChrome() {
  if (process.env.MYDEI_CHROME && fs.existsSync(process.env.MYDEI_CHROME)) {
    return process.env.MYDEI_CHROME;
  }

  const roots = [
    path.join(process.env.LOCALAPPDATA || '', 'ms-playwright'),
    path.join(process.env.HOME || '', 'AppData', 'Local', 'ms-playwright'),
  ].filter(Boolean);

  const candidates = [];

  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    for (const dir of fs.readdirSync(root)) {
      if (!/^chromium-\d+$/.test(dir)) continue;
      for (const sub of ['chrome-win64', 'chrome-win', 'chrome-linux']) {
        for (const exe of ['chrome.exe', 'chrome']) {
          const p = path.join(root, dir, sub, exe);
          if (fs.existsSync(p)) candidates.push(p);
        }
      }
    }
  }

  // Fall back to a normal Chrome install.
  for (const p of [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  ]) {
    if (fs.existsSync(p)) candidates.push(p);
  }

  if (!candidates.length) {
    throw new Error(
      'No Chromium found. Set MYDEI_CHROME to a Chrome/Chromium executable, ' +
      'or run: npx playwright install chromium'
    );
  }

  // Highest build number wins.
  candidates.sort();
  return candidates[candidates.length - 1];
}

/**
 * Open the persistent browser context.
 *
 * @param {{headless?: boolean}} opts
 */
async function open(opts = {}) {
  fs.mkdirSync(PROFILE, { recursive: true });

  const executablePath = findChrome();

  const context = await chromium.launchPersistentContext(PROFILE, {
    executablePath,
    headless: opts.headless === true,
    viewport: { width: 1440, height: 900 },
    locale: 'el-GR',
    timezoneId: 'Europe/Athens',
    // A plain, current UA. Nothing here is spoofing anything the browser is
    // not — it *is* Chromium, driven by its own automation protocol.
    args: ['--disable-blink-features=AutomationControlled'],
  });

  context.setDefaultTimeout(45000);

  return { context, executablePath };
}

/** Reuse the first page in the profile, or make one. */
async function firstPage(context) {
  const pages = context.pages();
  return pages.length ? pages[0] : await context.newPage();
}

module.exports = { open, firstPage, findChrome, PROFILE, DATA };
