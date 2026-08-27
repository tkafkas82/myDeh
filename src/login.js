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

/**
 * Is this page past the login screen?
 *
 * Deliberately conservative: anything unrecognised counts as *not* signed in.
 * A false negative just asks you to log in again; a false positive makes the
 * tool pretend to work and report zero bills.
 *
 * @param {import('playwright-core').Page} page
 */
async function isSignedIn(page) {
  // Two things make the naive checks wrong here, both learned the hard way:
  //
  //  1. The login form is rendered by JavaScript, so at domcontentloaded the
  //     page has no inputs at all and "no password field" looks like success.
  //     Hence waiting for one of the two signals to actually appear.
  //  2. The logout link is in the markup even when anonymous — the template
  //     ships both states and hides one. So visibility decides, not presence.
  await page.waitForLoadState('load').catch(() => {});

  const password = page.locator('input[type="password"]').first();
  const logout = page.locator('a[href*="Logout" i], a[href*="logout" i]').first();

  // Whichever becomes visible first settles it.
  await Promise.any([
    password.waitFor({ state: 'visible', timeout: 15000 }),
    logout.waitFor({ state: 'visible', timeout: 15000 }),
  ]).catch(() => {});

  if (await password.isVisible().catch(() => false)) return false;
  if (await logout.isVisible().catch(() => false)) return true;

  // Neither appeared: unknown, so treat as not signed in. A false negative
  // asks for a login; a false positive makes the tool report zero bills.
  return false;
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
    console.log('Fetching continues automatically.\n');
  } else {
    console.log('Could not confirm a signed-in session.');
    console.log(`Current URL: ${page.url()}`);
    console.log('If you really are signed in, the detection needs adjusting:');
    console.log('choose "Discover" in mydei.bat and share data/discovery.json.\n');
  }

  await context.close();
  return signedIn;
}

/**
 * Is the saved session still good? Checked quietly, without a visible window.
 */
async function hasValidSession() {
  let context;
  try {
    ({ context } = await open({ headless: true }));
    const page = await firstPage(context);
    await page.goto(`${BASE}/el/`, { waitUntil: 'domcontentloaded', timeout: 25000 });
    return await isSignedIn(page);
  } catch (e) {
    return false;
  } finally {
    if (context) await context.close().catch(() => {});
  }
}

/**
 * Make sure we are signed in, prompting only when we actually have to.
 *
 * This is what lets the app run itself: callers never need to know whether a
 * login is due.
 */
async function ensureSignedIn() {
  process.stdout.write('  checking saved session... ');
  const valid = await hasValidSession();

  if (valid) {
    console.log('still valid');
    return true;
  }

  console.log('expired or missing');
  return login();
}

module.exports = {
  login,
  ensureSignedIn,
  hasValidSession,
  isSignedIn,
  BASE,
  LOGIN_URL,
};
