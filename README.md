# myΔΕΗ — houses and bills, organised

Pulls every property (παροχή) and its bills out of
[mydei.dei.gr](https://mydei.dei.gr/el/) into a local dashboard, CSV exports, a
PDF archive and a history that outlives the portal.

Your own account, your own data, on your own machine. Nothing leaves it.

---

## Running it

**Double-click `mydei.bat`.** It installs dependencies on first run and gives a
menu: dashboard, fetch, sign in, export, status, discover. Runs directly on
Windows — no WSL or Docker involved.

It also takes a command directly:

```cmd
mydei.bat login
mydei.bat fetch
mydei.bat serve
mydei.bat export
mydei.bat status
```

Or drive it with npm:

```bash
npm install          # one small package (playwright-core), no browser download
npm run login        # sign in yourself, once, in a real browser window
npm run fetch        # scrape properties + bills, archive PDFs
npm run serve        # dashboard at http://localhost:4800
npm run export       # CSV for Excel
node cli.js status   # quick summary in the terminal
```

If port 4800 is busy, the dashboard says so rather than crashing — and if the
thing on the port is *this* dashboard already running, it just points you at it.
To use another port:

```cmd
set PORT=4801 && mydei.bat serve
```

| Command | What it does |
| --- | --- |
| `login` | Opens Chromium at the login page and waits. You type your credentials; it only watches. |
| `fetch` | Finds properties and bills, downloads new PDFs, merges into history. `--show` to watch, `--no-pdfs` to skip downloads. |
| `discover` | Crawls the signed-in area and reports the real page/table structure. For calibrating the parsers. |
| `export` | `data/export/bills.csv` and `summary.csv`. |
| `serve` | Local dashboard, bound to 127.0.0.1 only. |

---

## How authentication works, and why

The portal sits behind **Imperva/Incapsula** and may add an OTP step. This tool
does not try to get around either, and it handles no credentials at all:

- `npm run login` opens a real browser window. **You** sign in, including any
  OTP or verification.
- **`/el/login` is a category chooser, not a login form.** You pick
  *Φυσικά & Νομικά Πρόσωπα* (homes), *Δήμοι & Πολλαπλοί* or *Κοινόχρηστα*
  first, and only then do the username and password fields appear. The tool
  clears the cookie banner (declining non-essential cookies) and tells you to
  pick a card. It does **not** click one for you: driven from Playwright the
  click registers but no form ever appears, and guessing your account type
  would be worse than asking. It is one click and you are already there.
- The session lands in a normal browser profile at `data/profile`, so later runs
  reuse it with no prompt.
- Your password is never typed by this tool, never written to a file, never in
  an environment variable.

When the session expires (weeks, typically), `npm run login` again. That is the
one thing that cannot be automated — deliberately.

---

## What it collects

Per property: name/address, supply number (παροχή), contract account.

Per bill: issue date, due date, period, amount, consumption in kWh, paid status,
bill number, and the PDF.

The dashboard shows outstanding balance and next due date per house, a
consumption sparkline, average and total cost, and the full bill table with
links to the archived PDFs. Houses with money owed sort to the top.

---

## Design notes

**Bills are parsed by column header, never by position.** `src/parse.js` maps
Greek header text (`Ποσό Πληρωμής`, `Ημερομηνία Λήξης`, `Κατανάλωση`, …) onto
fields. A portal redesign that reorders or renames a column then changes
nothing, whereas `td:nth-child(3)` would quietly start reading the wrong number
— the worst possible failure for financial data. The tests prove reordered
headers still map correctly.

**Greek numbers and dates get their own tested module.** `src/greek.js`, because:

- Greek uses `.` for thousands and `,` for decimals — the reverse of English.
  `1.234,56` is one thousand two hundred, not one point two. Ambiguity is
  resolved by which separator appears *last*.
- Dates are day-first: `03/09/2026` is 3 September.
- Month names appear in the genitive (`12 Σεπτεμβρίου 2026`).
- JavaScript's `\b` and `\w` are ASCII-only, so matching Greek keywords needs
  accent folding and final-sigma folding (`ς` → `σ`) or it silently never
  matches.

`npm test` covers all of the above — 69 assertions.

**CSV is written for Greek Excel:** UTF-8 BOM (without it Greek addresses become
mojibake) and `;` as the delimiter (Greek Windows uses `,` as the decimal
separator, so a comma-delimited file lands entirely in column A).

**History is append-only.** The portal drops older bills after a while. Once a
bill is seen it stays in `data/history.json` forever, so the cost and
consumption record keeps growing. Re-running never duplicates: bills are keyed
on number + dates + amount, and a bill going from unpaid to paid updates in
place.

---

## Status: parsers need one calibration pass

The property list and bill tables are behind the login, so their exact markup
could not be known while building this. The extraction is written to be
structure-agnostic and is fully tested against realistic Greek tables — but it
has **not yet been run against the real signed-in pages**.

If `npm run fetch` reports no bills:

```bash
node cli.js discover
```

That crawls the signed-in area, scores every page and table for how bill-like it
is, and writes `data/discovery.json` plus HTML snapshots. **`discovery.json`
holds structure — page titles, table headers, class names — not your bill
amounts**, so it is the safe file to share for calibration. The snapshots
under `data/snapshots/` do contain real data; `data/` is gitignored entirely.

---

## Caveats worth knowing

- **This is scraping, not an API.** There is no public DEI API (`/api/*` 404s;
  the portal is server-rendered Umbraco/ASP.NET). Scrapers break when sites are
  redesigned. Header-driven parsing makes that less likely, not impossible.
- **Automated access may sit awkwardly with the portal's terms**, even for your
  own data. Personal use, at human frequency. Don't hammer it.
- **`data/` is sensitive.** It holds a live session for your electricity
  account, your addresses and your bills. It is gitignored; keep it that way,
  and remember it is not encrypted at rest.
