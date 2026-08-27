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
 * Umbraco's authenticated-member cookie. Present only after a real sign-in,
 * unlike the session and Imperva cookies handed to anonymous visitors.
 */
const MEMBER_COOKIE = 'UMB_UCONTEXT_MEMBERS';

/**
 * /el/login is not a credentials form — it is a category chooser. The username
 * and password fields only exist after one of these is clicked, which is why
 * the page reports zero inputs on arrival.
 */
const CATEGORIES = {
  individual: 'Φυσικά & Νομικά Πρόσωπα',  // households and companies
  municipal: 'Δήμοι & Πολλαπλοί',          // municipalities / multiple supplies
  communal: 'Κοινόχρηστα',                 // shared building supplies
};

/**
 * Deal with the OneTrust cookie banner.
 *
 * Not cosmetic: it lays a fixed dark filter over the page
 * (div.onetrust-pc-dark-filter) that swallows clicks on the category cards.
 *
 * Rejects non-essential cookies where that option exists, since opting someone
 * into tracking on their behalf is not this tool's call; falls back to accept
 * only because the banner must go for the page to be usable.
 */
async function dismissCookieBanner(page) {
  for (const selector of [
    '#onetrust-reject-all-handler',
    '#onetrust-accept-btn-handler',
  ]) {
    const button = page.locator(selector).first();
    if (await button.isVisible().catch(() => false)) {
      await button.click({ timeout: 5000 }).catch(() => {});
      // OneTrust re-renders (and can reload) the page after a consent choice,
      // which throws away the client-rendered login box. Wait for the document
      // to settle again, or the next click has nothing to land on.
      await page.waitForLoadState('load').catch(() => {});
      await page.waitForTimeout(1200);
      return selector;
    }
  }
  return null;
}

/**
 * Is the category chooser on screen?
 *
 * Clicking a card for you was tried and abandoned: driven from Playwright the
 * click registers but no credentials form ever appears, on any consent path.
 * Rather than ship a step that silently does nothing — or worse, picks the
 * wrong account type — the chooser is simply detected so the instructions can
 * name what you are looking at. It is one click, and you are already there.
 *
 * @param {import('playwright-core').Page} page
 */
async function hasCategoryChooser(page) {
  return page
    .locator('button.b-login-box__card')
    .first()
    .waitFor({ state: 'visible', timeout: 20000 })
    .then(() => true)
    .catch(() => false);
}

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
  await page.waitForLoadState('load').catch(() => {});

  // A visible password field means the login form is on screen. Decisive, and
  // checked first so a stale cookie cannot override what is plainly a login
  // page. Note the form is client-rendered, so it needs waiting for.
  const password = page.locator('input[type="password"]').first();
  const visiblePassword = await password
    .waitFor({ state: 'visible', timeout: 6000 })
    .then(() => true)
    .catch(() => false);
  if (visiblePassword) return false;

  // Otherwise trust the cookie jar, not the DOM.
  //
  // Reading the page was tried twice and failed both ways: matching navigation
  // words ("Λογαριασμοί", "Παροχές") gave false positives because they exist on
  // the public site, and requiring a *visible* logout link gave false negatives
  // because it lives in a collapsed user menu. Meanwhile the login itself is
  // unambiguous in the cookies.
  //
  // UMB_UCONTEXT_MEMBERS is Umbraco's authenticated-member context: it exists
  // only once a member has signed in, unlike the session and Imperva cookies
  // which are handed to anonymous visitors too.
  const cookies = await page.context().cookies().catch(() => []);
  return cookies.some(c => c.name === MEMBER_COOKIE && c.value);
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

  await page.goto(LOGIN_URL, { waitUntil: 'load' }).catch(() => {});

  if (await isSignedIn(page).catch(() => false)) {
    console.log('Already signed in — the saved session is still valid.\n');
    await context.close();
    return true;
  }

  // Clearing the consent banner is worth doing: its overlay sits over the page
  // and gets in the way of the very first click.
  const consent = await dismissCookieBanner(page);
  if (consent) console.log('Cookie banner dismissed (non-essential cookies declined).');

  const chooser = await hasCategoryChooser(page);

  console.log('');
  console.log('─'.repeat(66));
  console.log(' Sign in in the browser window that just opened.');
  console.log('');

  if (chooser) {
    console.log(' The page asks which kind of customer you are FIRST — the');
    console.log(' username and password fields only appear after you pick one:');
    console.log('');
    console.log(`   • ${CATEGORIES.individual}   <- homes`);
    console.log(`   • ${CATEGORIES.municipal}`);
    console.log(`   • ${CATEGORIES.communal}`);
    console.log('');
  }

  console.log(' Then sign in, handling any OTP as you normally would.');
  console.log('');
  console.log(' Nothing is typed or stored by this tool. It only waits.');
  console.log(' It should notice by itself; press Enter here if it does not.');
  console.log('─'.repeat(66));
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
  dismissCookieBanner,
  hasCategoryChooser,
  CATEGORIES,
  BASE,
  LOGIN_URL,
};
