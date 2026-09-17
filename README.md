# UPC Barcode Tool — Lookup, Vector Generator & Batch Export

A **single-page, offline-capable web tool** for turning a list of product codes into **print-ready vector
barcode artwork**. No build step, no backend, no dependencies, no data ever leaves the browser.

It was built to solve one specific problem: when the identifier you *have* (a model number) lives in a
master spreadsheet, and the code you *need* (a UPC/GTIN) is in a different system that cannot read it,
somebody has to be the wire — reading one cell, remembering a number, and retyping it into a barcode
generator. That hand-off is slow and it is where mistakes happen. This tool removes the hand-off: it
uploads the spreadsheet you already maintain, looks the identifier up, and generates the artwork named
after the row it came from.

---

## What it does

1. **Upload a master CSV** — it stays in your browser (IndexedDB). Nothing is uploaded to a server.
2. **Type or paste model numbers** — one value, or a whole column straight out of a spreadsheet.
3. **Add the found rows** to an export list.
4. **Generate** — a ZIP of vector barcode files, each named `MODELNUMBER_UPCNUMBER`.

Every row is validated and drawn as a live vector preview before anything is exported.

### Every file is named `MODELNUMBER_UPCNUMBER`

`ACME-1000` + `012345678905` → **`ACME-1000_012345678905.svg`**

The 2D files add a suffix so the two kinds can never be confused:
**`ACME-1000_012345678905_GS1-DIGITAL-LINK.svg`**. Descriptions are deliberately **not** in the filename —
the description lives inside the artwork and in the ZIP's `00_README.txt`, and a long product name in a
filename is unusable on a print vendor's system.

---

## One box: type one code, or paste a whole column

There is **one lookup box**, not two. Type a single model number, or copy the model-number column
straight out of your spreadsheet and paste it in.

This is deliberate rather than cosmetic: **a single value and a pasted column run through exactly the
same code path**, so the two cases cannot drift apart or behave differently.

It handles the messy reality of a spreadsheet copy:

| You paste | What happens |
|---|---|
| One model per line | Each line is looked up. |
| Comma, tab or semicolon separated | Split correctly. |
| `"ACME-1000"` quoted cells | Quotes unwrapped; `"say ""hi"""` becomes `say "hi"`. |
| CRLF (Windows Excel) | Handled. |
| Blank lines, stray spaces | Ignored and trimmed. |
| Repeated values | De-duplicated. |

Every pasted value comes back with a status:

| Status | Meaning |
|---|---|
| **FOUND** | Exactly one master row matched. |
| **NOT FOUND** | Not in the master list — reported, never guessed. |
| **AMBIGUOUS** | Several rows match; no Add button, because guessing would ship the wrong code. |
| **PARTIAL MATCH** | Loose hits only; surfaced for you to add deliberately, with no Add button. |

**Matching is deliberately strict.** Normalised whole-value equality first, then a *word-boundary*
contains. A plain substring search would let `ACME-1000` match `ACME-10000` and hand you the wrong
code — which is the one failure mode that could actually put a bad barcode on a package.

> **The dangerous outcomes never get an Add button.** That is the point of the tool: it either knows the
> answer, or it tells you it does not know.

---

## Real GS1 correctness — not a decorative barcode

This is not a barcode *picture* generator. It implements the actual standards.

**Symbologies:** UPC-A (12 digits), EAN-13 (13), EAN-8 (8), ITF-14 (14) — chosen automatically, or forced.

**Automatic GTIN repair** handles the ways spreadsheets damage codes:

| Input in the master | What happens |
|---|---|
| `012345678905` | Valid UPC-A. |
| `12345678905` | Leading zero eaten by the spreadsheet → **restored**. |
| `01234567890` | Missing check digit → **calculated**. |
| `012345678906` | Wrong check digit → **corrected**, flagged, tells you the old and new digit. |
| `00012345678905` | Zero-suppressed GTIN-14 → printed as **UPC-A**. |
| `HBX-0000` | Not encodable → red `ERROR`, excluded from generation, listed in the skipped report. |

Every correction is **disclosed, never silent**. There is an **Auto-fix wrong check digits** toggle;
switch it off and bad codes are refused outright instead of repaired.

**Physical accuracy** — geometry is computed in inches from the GS1 reference figures, not scaled by eye.

### Human-readable digits sit where GS1 says they sit

| Symbol | Left quiet zone | Under the bars | Right quiet zone |
|---|---|---|---|
| **UPC-A** | number-system digit (1st) | digits 2–11, as **5 + 5** | check digit (12th) |
| **EAN-13** | 1st digit | digits 2–13, as 6 + 6 | nothing |
| **EAN-8** | nothing | all 8 digits, as 4 + 4 | nothing |

The digit cells under a UPC-A are **not evenly spaced** — the jump between the two groups is the centre
guard *plus* the first digit cell, which a UPC-A leaves empty. That empty cell is why a UPC-A looks like
it has a hole before the second group of five. It is correct; do not "fix" it.

> One honest difference from cheap online generators: many of them, including
> online-barcode-generator.com, draw **all bars the same length**. GS1 requires the three guard patterns
> to **descend below** the rest of the symbol, and this tool does that. If you hand artwork from a free
> web generator to a print vendor, expect a query.

**GS1 linting** — the tool warms you when a setting would not scan, e.g. an ITF-14 X-dimension below the
GS1 minimum, or a symbol ratio drifting outside 2.5:1.

---

## The 2D code — GS1 Digital Link (QR), a separate download

### So what IS a "2D GS1 Digital Link code"?

| Word | What it means |
|---|---|
| **2D** | A two-dimensional symbol — data in both directions. A UPC is **1D**: bars read as one line of digits. A QR is **2D**: a grid holding hundreds of characters. |
| **GS1** | The standards body that owns UPC/EAN and defines how the identifier works. "GS1 Digital Link" is their specification — a rulebook, not a product. |
| **Digital Link** | The rulebook's trick: **the same GTIN**, written as a **web address** instead of bars. |

**In one line:** a UPC says *"this is GTIN 012345678905."* A GS1 Digital Link says *"this is GTIN
012345678905 — and here it is as a link you can follow."* Same number. One needs a laser at a till; the
other works with the phone already in a customer's hand.

This tool encodes:

```
https://id.gs1.org/01/00012345678905
                  │  └─ your GTIN, zero-padded to 14 digits
                  └──── AI (01) = "the number that follows is a GTIN"
```

Optional fields hang off the end, exactly as GS1 defines them:

```
https://id.gs1.org/01/00012345678905?10=LOT2026A&17=270630
                                       └─ AI (10) batch  └─ AI (17) expiry YYMMDD
```

**The three names for the same thing — they are not synonyms:**

- **QR code** — a *symbology*. The format of the squares (Data Matrix is another).
- **2D code** — a *category*. Any symbol holding data in two dimensions.
- **GS1 Digital Link** — a *content specification*. What the QR is told to contain.

So this tool makes **QR codes**, which are a kind of **2D code**, whose contents follow the **GS1 Digital
Link** spec. All three descriptions are true at once — which is exactly why nobody knows what anyone means.

**The facts that matter for a packaging release:**

- **The UPC stays.** The 2D code is additive. If a retailer's POS cannot read 2D yet, the linear UPC is
  what works at the counter. Never let the 2D code replace it.
- **The retailer upgrades, not you.** The 2D-in-retail programme is about scanner firmware and POS
  software. Your packaging change is to *carry both codes*.
- **Treat any date as directional** until a specific retailer confirms it for your account.
- **Barcodes are not anti-counterfeit.** Anyone can copy a QR or a UPC. A code that opens a page can be
  copied with the page. Genuine anti-counterfeit needs unique per-unit serials plus real-time lookup.

### Will it actually scan? The print-size check

The failure mode that hides from design review: **a QR can be drawn perfectly and still be unreadable.**
Design software will happily scale it to fit a narrow panel, the artwork looks right, and it dies in a
customer's hand.

The thing that decides readability is the **module pitch** — the physical size of *one* black square.
The tool includes a **"Will it scan? Width I have"** field. Type the width your panel actually gives you
and it reports the real pitch in mm and a verdict, computed from the **live encoder**.

| Pitch per module | Verdict | What it means on pack |
|---|---|---|
| under 0.25 mm | **BELOW MINIMUM** | Below the point a QR is defined to work. Do not print. |
| 0.25–0.35 mm | **AT THE FLOOR** | Bare floor. Perfect print, flat matte surface, good light, phone close. Expect failures on gloss or curve. |
| 0.35–0.50 mm | **WORKABLE** | Fine for close-range scanning on a flat matte panel. Avoid high-gloss laminate — glare kills the read. |
| 0.50–0.80 mm | **COMFORTABLE** | The range to aim for on a consumer pack. Tolerates curvature, laminate, average lighting. |
| 0.80–1.60 mm | **ROBUST** | Reads at distance and through scuffing. Fine on cartons and shelf-ready trays. |
| over 1.60 mm | **VERY LARGE** | Scans perfectly but is eating artwork. Consider higher error correction — same box, more data. |

These bands are **practical engineering judgement for consumer phone scanning under normal packaging
conditions** — deliberately conservative, not a quotation from a standard.

**The trap this panel exists to kill:** it does *not* react to *QR module size (px)*. That control only
sets the pixel resolution of the exported PNG and has **no bearing on scanned size**. Two separate facts,
two separate controls, deliberately labelled apart.

**Also note:** pitch is not simply width ÷ 30. It is width ÷ (modules **+ 8**) — the mandatory 4-module
quiet zone is part of the footprint.

---

## Generate — one button per deliverable

| Button | What you get |
|---|---|
| **Generate UPCs only** | One ZIP of linear barcode files named `MODELNUMBER_UPC`. |
| **Generate 2D GS1 Digital Link Codes only (QR)** | One ZIP of QR files named `MODEL_UPC_GS1-DIGITAL-LINK`. |
| **Download Merged PDF (all rows)** | One multi-page PDF, one barcode per page. |
| **Download Print Sheet (actual size)** | Pages laid out at **true physical size**. Print at 100% and it scans directly. |
| **Download Export CSV** | A clean 3-column CSV (with a UTF-8 BOM so Excel opens it correctly). |
| **Download Spec Sheet CSV** | Every row with exact X-dimension, magnification, symbol width/height and mm values. |

The two generate buttons **state what they will produce**, live, from the *Batch output files* checkboxes.
Untick PDF and the button stops claiming a PDF — so you are never told you got a file you did not.

**Why two ZIPs rather than one:** the linear UPC and the 2D code are not interchangeable. In a single
pile, a 2D file could be placed where a UPC is required (or the reverse) and the pack ships with a code
that will not scan at the till. Two clearly-named archives is the safer shape.

### File naming

`ACME-1000` + `012345678905` → `ACME-1000_012345678905.svg`

Illegal filename characters (`/ \ : * ? " < > |`) are converted to `-`; duplicates get `-2`, `-3`.
Each ZIP also contains `00_README.txt` listing every code, its symbology and its printed size.

---

## Output settings

- **Symbology** — Auto, or force UPC-A / EAN-13 / EAN-8 / ITF-14.
- **X-dimension / size** — GS1 presets from 0.0104 in (80%, smallest legal) to 0.0394 in (ITF-14 nominal).
- **Bar height** — auto (GS1 standard for the chosen size) or a fixed 0.50–1.2598 in.
- **Options** — show human-readable digits, model + description caption, ITF-14 bearer bars, auto-fix check digits.
- **Batch output files** — SVG per item, PDF per item, PNG per item (300 dpi), any combination.
- **2D code** — error correction level, optional batch/lot as AI (10), expiry as AI (17), and the print-size check.

Every change re-renders the live previews instantly.

### Which format to use

- **SVG** — true vector. Open in Illustrator and it comes in as editable paths plus real text. Browsers
  cannot write Adobe's proprietary `.ai` format; open the SVG and *File → Save As → Adobe Illustrator (.ai)*.
- **PDF** — true vector, page sized to the exact physical barcode, so it keeps correct scale in packaging art.
- **PNG** — 300 dpi raster, for documentation and email.

---

## Privacy — nothing leaves the browser

Everything runs in the browser tab. **No master list, item number or product code is ever uploaded to a
server.** There is no backend at all. The master list is stored in the browser's own IndexedDB, scoped to
the page's origin and to that machine.

**Consequence worth knowing:** because storage is per-browser, each person uploads the master CSV once on
their own computer. Two people on **different** computers are completely isolated. Two people on the
**same** computer and browser share one storage area — so a shared studio machine should be treated as
shared data.

---

## Project structure

```
index.html                  the tool (master upload, lookup box, export list, settings, generate)
js/barcode.js               GTIN validation, check digits, encoders, geometry, digit placement
js/exporters.js             vector SVG, hand-built vector PDF, merged PDF, print sheet, ZIP writer
js/qrcode.js                from-scratch QR encoder (ISO/IEC 18004) + GS1 Digital Link builder
js/qr-sizing.js             print-size calculator: physical width -> module pitch -> verdict
js/qr-batch.js              the 2D batch: QR SVG/PDF/PNG builder + its own ZIP
js/app.js                   UI wiring, IndexedDB, paste lookup, live previews, GS1 linting
tests/                      browser test harnesses (dev tools, safe to ignore)
upc-anatomy.html            a standalone "UPC anatomy" teaching page
.nojekyll                   stops Jekyll from processing the folder on GitHub Pages
```

**Zero runtime dependencies. No CDN for the engine. No network calls. No build step.**

---

## Test harnesses

All harnesses run in a real browser against the shipped files, not a mock. Current totals:
**125 + 85 + 44 + 197 + 111 + 26 + 35 = 623 assertions passing.**

Highlights of what is actually proven, rather than assumed:

- **Check digits** against hand-computed values, and module strings against tables derived by hand from
  the standard.
- **The real SVG is rasterised and a scanline is read back**, proving the rendered pixels equal the
  encoder's module string exactly. That test caught a serious rendering bug.
- **PDFs are opened with pdf.js** (the parser behind Firefox's viewer), with error recovery *disabled*,
  then required to parse, report the right page count, and expose the digits as extractable text.
- **The QR encoder is cross-checked against a different implementation.** A hand-written encoder cannot
  be validated by its own tables — a shared mistake would pass. So each symbol is decoded with **jsQR**,
  an independent decoder, and the output must equal the input character for character. It also proves
  every Reed-Solomon generator polynomial vanishes at α⁰…αⁿ⁻¹, a property of the field rather than a
  memorised table.
- **Digit placement** is asserted at exact module centres for UPC-A, EAN-13 and EAN-8, so a fix to one
  cannot silently break the others.

The tool refuses rather than guesses: a payload too large for the QR encoder is **refused with its actual
byte limit**, never silently truncated. A 6-digit UPC-E is refused with a message telling you to expand
it, because expanding it incorrectly would produce a code that scans as the wrong product.

---

## Known limits

- **No `.ai` export** — impossible in a browser.
- **No PDF417, Data Matrix or GS1-128** — this tool is UPC/EAN/ITF-14 plus QR (GS1 Digital Link).
- **QR is capped at version 10 (271 bytes at level L)** — comfortably more than any GS1 Digital Link needs.
- **UPC-E is not supported** — a 6-digit value is refused with instructions.
- **No server anything** — deliberate. The flip side is nothing is shared between machines.
- **A resolver page is not included.** The QR points at `id.gs1.org`. Pointing it at your own
  customer-facing page with authenticity content needs a hosted site, and for per-unit serials a database.

---

## Verification you should still do yourself

Automated tests prove structure, geometry and decodability. **They cannot prove paper.** Before a live
run, print the **Print Sheet** at 100% / actual size and scan both the linear barcode with a handheld
scanner and the 2D code with a real phone. That is the only test that fully closes the loop.

---

## Licence

Internal tooling. No warranty; verify against your own printed output before production use.
