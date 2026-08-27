/**
 * Login: you authenticate, the tool watches.
 *
 * The portal is behind Imperva and may add an OTP step. Rather than trying to
 * get around either, a real browser window opens and you sign in yourself.
 * The session lands in the persistent profile, so later runs need no password
 * and nothing is stored by this tool — there is no credential handling here at
 * all, by design.
 */

'use strict';

const readline = require('node:readline');

const { open, firstPage } = require('./browser');

const BASE = 'https://mydei.dei.gr';
const LOGIN_URL = `${BASE}/el/login`;

// Text that only appears once you are through the login wall. Several
// candidates, since the portal's wording may change and any one of them is
// enough to be confident.
const SIGNED_IN_HINTS = [
  'Αποσύνδεση',
  'Αποσυνδεση',
  'Logout',
  'Οι παροχές μου',
  'Οι λογαριασμοί μου',
  'Λογαριασμοί',
  'Παροχές',
];

/**
 * Is this page past the login screen?
 * @param {import('playwright-core').Page} page
 */
async function isSignedIn(page) {
  const url = page.url();

  // Still sitting on the login form.
  if (/\/login(\/|$|\?)/i.test(url)) {
    // ...unless the form is gone, which happens on some redirect flows.
    const hasPassword = await page.locator('input[type="password"]').count().catch(() => 0);
    if (hasPassword) return false;
  }

  const body = await page.textContent('body').catch(() => '');
  if (!body) return false;

  return SIGNED_IN_HINTS.some(h => body.includes(h));
}

/** Wait for either auto-detection or the user pressing Enter. */
function waitForEnter(prompt) {
  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(prompt, () => {
      rl.close();
      resolve('enter');
    });
  });
}

async function pollSignedIn(page, intervalMs = 2000) {
  for (;;) {
    try {
      if (await isSignedIn(page)) return 'detected';
    } catch (e) {
      /* page navigating — try again */
    }
    await new Promise(r => setTimeout(r, intervalMs));
  }
}

/**
 * Open the portal and wait until signed in.
 * @param {{headless?: boolean}} opts
 */
async function login(opts = {}) {
  const { context, executablePath } = await open({ headless: false });
  const page = await firstPage(context);

  console.log(`\nChromium: ${executablePath}`);
  console.log(`Opening  ${LOGIN_URL}\n`);

  await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded' }).catch(() => {});

  if (await isSignedIn(page).catch(() => false)) {
    console.log('Already signed in — the saved session is still valid.\n');
    await context.close();
    return true;
  }

  console.log('─'.repeat(64));
  console.log(' Sign in in the browser window that just opened.');
  console.log(' Handle any OTP or verification there as you normally would.');
  console.log('');
  console.log(' Nothing is typed or stored by this tool. It only waits.');
  console.log(' It should notice by itself; press Enter here if it does not.');
  console.log('─'.repeat(64));
  console.log('');

  const outcome = await Promise.race([
    pollSignedIn(page),
    waitForEnter('   ...waiting (or press Enter once you are in) '),
  ]);

  // Give a just-completed navigation a moment to settle.
  await page.waitForLoadState('domcontentloaded').catch(() => {});
  await new Promise(r => setTimeout(r, 1500));

  const signedIn = await isSignedIn(page).catch(() => false);

  console.log('');
  if (signedIn) {
    console.log(`Signed in (${outcome}). Session saved to data/profile.`);
    console.log('Next:  npm run fetch\n');
  } else {
    console.log('Could not confirm a signed-in session.');
    console.log(`Current URL: ${page.url()}`);
    console.log('If you are actually signed in, the detection hints may need');
    console.log('updating — run "node cli.js discover" and share what it finds.\n');
  }

  await context.close();
  return signedIn;
}

module.exports = { login, isSignedIn, BASE, LOGIN_URL, SIGNED_IN_HINTS };
