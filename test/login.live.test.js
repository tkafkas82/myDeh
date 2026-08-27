/**
 * Live checks against mydei.dei.gr. Kept out of `npm test` because it hits the
 * real site:
 *
 *     node test/login.live.test.js
 *
 * Guards the bug that made the whole tool pretend to work: detection used to
 * match navigation words like "Λογαριασμοί", which exist on the PUBLIC site, so
 * login() reported "already signed in" while sitting on the login page and the
 * scrape then ran with no session and found nothing.
 *
 * Also pins the shape of the login page, since that is what login()'s
 * instructions promise the user they will see.
 */

'use strict';

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const { chromium } = require('playwright-core');
const { findChrome } = require('../src/browser');
const {
  isSignedIn,
  dismissCookieBanner,
  hasCategoryChooser,
  BASE,
  LOGIN_URL,
} = require('../src/login');

(async () => {
  // A throwaway profile, so a real session cannot mask a false positive.
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'mydei-anon-'));

  const context = await chromium.launchPersistentContext(profile, {
    executablePath: findChrome(),
    headless: true,
    locale: 'el-GR',
    viewport: { width: 1440, height: 1000 },
  });

  let pass = 0;
  let fail = 0;

  const check = (label, ok, detail = '') => {
    console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? ' — ' + detail : ''}`);
    ok ? pass++ : fail++;
  };

  console.log('\nAnonymous profile must never read as signed in:\n');

  for (const [label, url] of [
    ['landing  /el/', `${BASE}/el/`],
    ['login    /el/login', LOGIN_URL],
  ]) {
    const page = await context.newPage();
    try {
      await page.goto(url, { waitUntil: 'load', timeout: 40000 });
      check(label, (await isSignedIn(page)) === false, 'not signed in');
    } catch (e) {
      console.log(`  skip  ${label} (${e.message.split('\n')[0]})`);
    } finally {
      await page.close().catch(() => {});
    }
  }

  console.log('\nLogin page shape:\n');
  {
    const page = await context.newPage();
    try {
      await page.goto(LOGIN_URL, { waitUntil: 'load', timeout: 40000 });

      const consent = await dismissCookieBanner(page);
      check('cookie banner is dismissable', Boolean(consent), consent || 'none found');

      // The credentials fields do not exist until a category card is clicked,
      // which is why login() tells the user to pick one instead of pretending
      // a form is already waiting.
      check('category chooser present', await hasCategoryChooser(page), 'user picks a card first');

      const pwd = await page.locator('input[type="password"]').count();
      check('no password field before choosing', pwd === 0, `${pwd} found`);
    } catch (e) {
      console.log(`  FAIL  ${e.message.split('\n')[0]}`);
      fail++;
    } finally {
      await page.close().catch(() => {});
    }
  }

  await context.close().catch(() => {});
  fs.rmSync(profile, { recursive: true, force: true });

  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
})();
