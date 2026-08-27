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
npm run serve        # dashboard (port 4820 by default)
npm run export       # CSV for Excel
node cli.js status   # quick summary in the terminal
```

**Ports.** The dashboard defaults to **4820** and walks upwards if that is taken,
printing and opening whichever port it actually secured. It recognises its own
instance (via an `app` marker in `/api/data`) so a second start just points at
the one already running, and it never opens a port it does not own — 4800 was
the old default and another local project already had it, which sent the browser
to that app instead. Force a port with:

```cmd
set PORT=4900 && mydei.bat serve
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

## The portal's actual structure

Calibrated against the live site, not guessed. Each property has its own page:

```
/el/account/<contract account>/
```

carrying one table:

```
Ημερομηνία | Είδος κίνησης | Περίοδος κατανάλωσης | Εξόφληση έως
           | Τρέχον ποσό | Ληξιπρ. ποσό | Συνολικό ποσό
```

Three facts about it shape everything:

- **It is a transaction ledger, not a bill list.** `Είδος κίνησης` distinguishes
  a bill from a payment, so rows are classified `bill` / `payment` / `other`
  instead of all being counted as bills.
- **There is no status column.** Paid/unpaid comes from `Ληξιπρ. ποσό` —
  anything sitting in "overdue" is overdue by definition.
- **There is no consumption column.** See the gap below.

`test/snapshot.test.js` re-runs the parser over saved account pages and asserts
all seven columns still map, reporting only counts and fill rates — never a
date, amount or address, so its output is safe to paste anywhere. Run it after
any portal change:

```bash
node cli.js discover        # refresh the snapshots
node test/snapshot.test.js  # 7/7 columns must still map
```

## Known gap: no kWh

The ledger carries no consumption figure, so **the kWh fields stay empty** and
the dashboard's consumption sparkline does not draw. Consumption appears to live
in an *Ενεργειακή κατανάλωση* widget on the account page — likely a chart rather
than a table — which would need a separate pass to reach. The fields are left
null rather than filled with anything invented.

## Naming your properties

The account pages expose no address in any form this could read reliably, so
properties would show as bare 12-digit numbers. Name them yourself instead —
menu option 8, or:

```bash
node cli.js name                              # list them
node cli.js name 300015431312 "Σέριφος"       # set one
node cli.js name 300015431312                 # clear it
```

Stored in `data/names.json`, which the scraper never writes, so names survive
every re-fetch.

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
