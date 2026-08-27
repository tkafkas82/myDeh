/**
 * Live check: isSignedIn() must not claim success when nobody is signed in.
 *
 * This guards a bug that made the whole tool pretend to work: the detection
 * used to match navigation words like "Λογαριασμοί", which exist on the public
 * site, so login() reported "already signed in" while sitting on the login
 * form and the scrape then ran with no session and found nothing.
 *
 * Hits the real site, so it is kept out of `npm test`:
 *     node test/signedin.live.test.js
 */

'use strict';

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const { chromium } = require('playwright-core');
const { findChrome } = require('../src/browser');
const { isSignedIn, BASE, LOGIN_URL } = require('../src/login');

(async () => {
  // A throwaway profile, so a real session cannot mask a false positive.
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'mydei-anon-'));

  const context = await chromium.launchPersistentContext(profile, {
    executablePath: findChrome(),
    headless: true,
    locale: 'el-GR',
  });

  let pass = 0;
  let fail = 0;

  const expectFalse = async (label, url) => {
    const page = await context.newPage();
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      const result = await isSignedIn(page);
      if (result === false) {
        console.log(`  ok    ${label} -> not signed in`);
        pass++;
      } else {
        console.log(`  FAIL  ${label} -> reported SIGNED IN while anonymous`);
        fail++;
      }
    } catch (e) {
      console.log(`  skip  ${label} (${e.message.split('\n')[0]})`);
    } finally {
      await page.close().catch(() => {});
    }
  };

  console.log('\nAnonymous profile — every page must read as not signed in:\n');
  await expectFalse('landing  /el/', `${BASE}/el/`);
  await expectFalse('login    /el/login', LOGIN_URL);

  await context.close().catch(() => {});
  fs.rmSync(profile, { recursive: true, force: true });

  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
})();
