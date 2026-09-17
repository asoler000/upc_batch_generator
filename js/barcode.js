/* =====================================================================
   Life Works UPC Engine  •  js/barcode.js
   Symbologies: UPC-A, EAN-13, EAN-8, ITF-14
   Pure logic: check digits, validation, module encoding, physical geometry.
   No DOM, no dependencies, no network.
   ===================================================================== */
window.LW = window.LW || {};

(function (LW) {
  'use strict';

  /* ---------------------------------------------------------------
     GS1 reference numbers (all in inches / points), 100% magnification
     --------------------------------------------------------------- */
  var REF_X          = 0.0130;   // GS1 100% X-dimension, UPC-A / EAN-13
  var REF_BAR_H      = 0.8996;   // 22.85 mm  bar height at 100%
  var REF_EAN8_BAR_H = 0.7240;   // 18.39 mm  EAN-8 bar height at 100%
  var REF_GUARD      = 0.0650;   // 5X guard-bar descender at 100%
  var REF_HRI_PT     = 9.5;      // human-readable text size at 100%
  var ITF_BAR_H_TALL = 1.2598;   // 32 mm   GS1 min, X <= 0.8 mm
  var ITF_BAR_H_SHORT= 0.7500;   // 19.05 mm
  var ITF_HRI_IN     = 0.1100;
  var ITF_WIDE       = 3;        // wide:narrow ratio in modules (GS1: 2.25-3.0)

  /* ---------------------------------------------------------------
     Symbology tables
     --------------------------------------------------------------- */
  var L_CODE = ['0001101','0011001','0010011','0111101','0100011','0110001',
                '0101111','0111011','0110111','0001011'];
  var G_CODE = ['0100111','0110011','0011011','0100001','0011101','0111001',
                '0000101','0010001','0001001','0010111'];
  var R_CODE = ['1110010','1100110','1101100','1000010','1011100','1001110',
                '1010000','1000100','1001000','1110100'];
  /* EAN-13 first-digit parity: which of the six left digits use G-code */
  var PARITY_13 = ['LLLLLL','LLGLGG','LLGGLG','LLGGGL','LGLLGG',
                   'LGGLLG','LGGGLL','LGLGLG','LGLGGL','LGGLGL'];
  /* Interleaved 2 of 5: 0 = narrow (1 module), 1 = wide (3 modules) */
  var ITF_2OF5 = ['00110','10001','01001','11000','00101',
                  '10100','01100','00011','10010','01010'];

  /* UPC-A / EAN-13 occupy 95 modules.  Guard ranges (module index):
     left guard 0-3, centre guard 45-50, right guard 92-95. */
  var GUARDS_95 = [{ start: 0, end: 3 }, { start: 45, end: 50 }, { start: 92, end: 95 }];
  /* EAN-8 occupies 67 modules: left guard 0-3, centre 31-36, right 64-67 */
  var GUARDS_67 = [{ start: 0, end: 3 }, { start: 31, end: 36 }, { start: 64, end: 67 }];

  var MAG_PRESETS = [0.80, 0.85, 0.90, 0.95, 1.00, 1.05, 1.10, 1.15, 1.20,
                     1.25, 1.30, 1.35, 1.40, 1.45, 1.50, 2.00];

  /* ---------------------------------------------------------------
     Small helpers
     --------------------------------------------------------------- */
  function repeat(s, n) {
    var out = '';
    for (var i = 0; i < n; i++) out += s;
    return out;
  }
  function num(v, fallback) {
    var n = parseFloat(v);
    return isFinite(n) ? n : fallback;
  }
  function onlyDigits(s) {
    return String(s == null ? '' : s).replace(/[^0-9]/g, '');
  }
  function hasLetters(s) {
    return /[A-Za-z]/.test(String(s == null ? '' : s));
  }

  /* GS1 mod-10 check digit.  `base` = all digits EXCEPT the check digit. */
  function checkDigit(base) {
    var sum = 0;
    for (var i = 0; i < base.length; i++) {
      var d = +base.charAt(base.length - 1 - i);
      sum += (i % 2 === 0) ? d * 3 : d;
    }
    var m = sum % 10;
    return m === 0 ? 0 : 10 - m;
  }

  /* True when `v` is a complete, self-consistent GTIN of a valid length. */
  function isCompleteValid(v) {
    if (!/^[0-9]+$/.test(v)) return false;
    if ([8, 12, 13, 14].indexOf(v.length) < 0) return false;
    var base = v.slice(0, -1);
    return checkDigit(base) === +v.charAt(v.length - 1);
  }

  function fixCheck(v) {
    var base = v.slice(0, -1);
    return base + checkDigit(base);
  }

  /* ---------------------------------------------------------------
     Physical size presets (shown in the UI)
     --------------------------------------------------------------- */
  var X_PRESETS = [
    { inches: 0.0104, label: '0.0104 in  (80% UPC/EAN — smallest GS1 allows)' },
    { inches: 0.0117, label: '0.0117 in  (90% UPC/EAN)' },
    { inches: 0.0130, label: '0.0130 in  (100% UPC/EAN — recommended retail)' },
    { inches: 0.0143, label: '0.0143 in  (110% UPC/EAN)' },
    { inches: 0.0156, label: '0.0156 in  (120% UPC/EAN)' },
    { inches: 0.0169, label: '0.0169 in  (130% UPC/EAN)' },
    { inches: 0.0182, label: '0.0182 in  (140% UPC/EAN)' },
    { inches: 0.0195, label: '0.0195 in  (150% UPC/EAN)' },
    { inches: 0.0250, label: '0.0250 in  (0.64 mm — carton / ITF-14 common)' },
    { inches: 0.0394, label: '0.0394 in  (1.016 mm — ITF-14 GS1 nominal)' }
  ];

  /* ---------------------------------------------------------------
     RESOLVE — turn raw user/master value into an encodable GTIN
     --------------------------------------------------------------- */
  function resolveDigits(v) {
    var L = v.length;

    if (L === 7) return { ok: true, sym: 'EAN-8',  code: v + checkDigit(v), note: 'Check digit calculated.' };

    if (L === 8)  return { ok: true, sym: 'EAN-8',  code: v };
    if (L === 6)  return { ok: false, msg: '6-digit UPC-E is not supported — expand it to the 12-digit UPC-A first.' };
    if (L === 9 || L === 10) return { ok: false, msg: 'A GTIN must be 8, 12, 13 or 14 digits (got ' + L + ').' };

    if (L === 11) {
      /* Ambiguous: either a UPC-A minus its check digit, or a UPC-A whose
         leading zero was eaten by Excel.  A zero-stripped code still passes
         the check-digit test once the zero is put back — prefer that. */
      if (isCompleteValid('0' + v)) {
        return { ok: true, sym: 'UPC-A', code: '0' + v, note: 'Leading zero restored (Excel stripped it).' };
      }
      return { ok: true, sym: 'UPC-A', code: v + checkDigit(v), note: 'Check digit calculated.' };
    }

    if (L === 12) {
      if (isCompleteValid(v)) return { ok: true, sym: 'UPC-A', code: v };
      if (isCompleteValid('0' + v)) {
        return { ok: true, sym: 'EAN-13', code: '0' + v, note: 'Read as a zero-stripped EAN-13.' };
      }
      return { ok: true, sym: 'UPC-A', code: v, invalidCheck: true };
    }

    if (L === 13) {
      if (isCompleteValid(v)) {
        if (v.charAt(0) === '0' && isCompleteValid(v.slice(1))) {
          return { ok: true, sym: 'UPC-A', code: v.slice(1),
                   note: 'Zero-suppressed GTIN-13 → printed as UPC-A.' };
        }
        return { ok: true, sym: 'EAN-13', code: v };
      }
      return { ok: true, sym: 'EAN-13', code: v, invalidCheck: true };
    }

    if (L === 14) {
      if (isCompleteValid(v)) {
        if (v.slice(0, 2) === '00' && isCompleteValid(v.slice(2))) {
          return { ok: true, sym: 'UPC-A', code: v.slice(2),
                   note: 'Zero-suppressed GTIN-14 → printed as UPC-A.' };
        }
        if (v.charAt(0) === '0' && isCompleteValid(v.slice(1))) {
          return { ok: true, sym: 'EAN-13', code: v.slice(1),
                   note: 'Zero-suppressed GTIN-14 → printed as EAN-13.' };
        }
        return { ok: true, sym: 'ITF-14', code: v };
      }
      return { ok: true, sym: 'ITF-14', code: v, invalidCheck: true };
    }

    return { ok: false, msg: 'Length ' + L + ' is not a valid GTIN length (8, 12, 13 or 14 digits).' };
  }

  var SYM_LENGTH = { 'UPC-A': 12, 'EAN-13': 13, 'EAN-8': 8, 'ITF-14': 14 };

  function forceSym(v, sym) {
    var want = SYM_LENGTH[sym];
    if (!want) return null;
    if (v.length === want) {
      if (isCompleteValid(v)) return { ok: true, sym: sym, code: v, forced: true };
      return { ok: true, sym: sym, code: v, forced: true, invalidCheck: true };
    }
    /* Accept the "minus check digit" form too. */
    if (v.length === want - 1) {
      return { ok: true, sym: sym, code: v + checkDigit(v), forced: true, note: 'Check digit calculated.' };
    }
    /* Zero-stripped forms. */
    if (v.length === want + 1 && v.charAt(0) === '0' && isCompleteValid(v.slice(1))) {
      return { ok: true, sym: sym, code: v.slice(1), forced: true, note: 'Leading zero removed.' };
    }
    if (v.length === want + 2 && v.slice(0, 2) === '00' && isCompleteValid(v.slice(2))) {
      return { ok: true, sym: sym, code: v.slice(2), forced: true, note: 'Leading zeros removed.' };
    }
    return { ok: false, msg: 'Forced ' + sym + ' needs ' + want + ' digits, but this value has ' + v.length + '.' };
  }

  /* ---------------------------------------------------------------
     ANALYZE — the single entry point the UI uses
       analyze(rawValue, { preferred: 'Auto'|symbology, autoFixCheck: bool })
     Returns a plain object; never throws.
     --------------------------------------------------------------- */
  function analyze(rawValue, opts) {
    opts = opts || {};
    var preferred = opts.preferred || 'Auto';
    var autoFix = opts.autoFixCheck !== false;

    var raw = String(rawValue == null ? '' : rawValue).trim();
    var res = {
      ok: false,
      raw: raw,
      digits: '',
      code: '',
      symbology: null,
      status: 'error',          // ok | fixed | warning | error
      messages: [],
      checkWasFixed: false,
      original: raw,
      autoPicked: false
    };
    function say(level, text) { res.messages.push({ level: level, text: text }); }

    if (!raw) { say('error', 'No UPC / GTIN value.'); return res; }

    var digits = onlyDigits(raw);
    res.digits = digits;

    if (!digits) { say('error', 'No digits found in "' + raw + '".'); return res; }
    if (hasLetters(raw)) say('warning', 'Letters were ignored — GTINs are digits 0-9 only.');

    var r;
    if (preferred === 'Auto') {
      r = resolveDigits(digits);
      res.autoPicked = !!(r && r.ok);
    } else {
      r = forceSym(digits, preferred) || resolveDigits(digits);
    }

    if (!r || !r.ok) {
      say('error', (r && r.msg) || 'Unrecognised GTIN.');
      return res;
    }

    res.symbology = r.sym;
    res.code = r.code;
    if (r.note) say('info', r.note);
    if (r.invalidCheck) {
      var good = fixCheck(r.code);
      res.expectedCheck = good.charAt(good.length - 1);
      res.foundCheck = r.code.charAt(r.code.length - 1);
      if (autoFix) {
        res.code = good;
        res.checkWasFixed = true;
        res.status = 'fixed';
        say('warning', 'Check digit was ' + res.foundCheck + ' but should be ' + res.expectedCheck +
                       ' — corrected automatically. Verify this GTIN against your master.');
      } else {
        res.ok = false;
        res.status = 'error';
        say('error', 'Check digit is ' + res.foundCheck + ' but should be ' + res.expectedCheck +
                     '. Enable "Auto-fix check digits" or fix it in the master.');
        return res;
      }
    }

    if (res.status !== 'fixed') res.status = res.messages.some(function (m) { return m.level === 'warning'; })
      ? 'warning' : 'ok';

    res.ok = true;
    return res;
  }

  /* ---------------------------------------------------------------
     ENCODE — GTIN digits => module string ("1" = bar, "0" = space)
     --------------------------------------------------------------- */
  function encodeUpcA(d) {
    var mods = '101', i;
    for (i = 0; i < 6; i++) mods += L_CODE[+d.charAt(i)];
    mods += '01010';
    for (i = 6; i < 12; i++) mods += R_CODE[+d.charAt(i)];
    mods += '101';
    return mods;
  }

  function encodeEan13(d) {
    var parity = PARITY_13[+d.charAt(0)];
    var mods = '101', i;
    for (i = 1; i <= 6; i++) {
      mods += (parity.charAt(i - 1) === 'L' ? L_CODE : G_CODE)[+d.charAt(i)];
    }
    mods += '01010';
    for (i = 7; i <= 12; i++) mods += R_CODE[+d.charAt(i)];
    mods += '101';
    return mods;
  }

  function encodeEan8(d) {
    var mods = '101', i;
    for (i = 0; i < 4; i++) mods += L_CODE[+d.charAt(i)];
    mods += '01010';
    for (i = 4; i < 8; i++) mods += R_CODE[+d.charAt(i)];
    mods += '101';
    return mods;
  }

  function encodeItf14(d) {
    var mods = '1010', p, i, a, b;
    for (p = 0; p < 7; p++) {
      a = ITF_2OF5[+d.charAt(p * 2)];
      b = ITF_2OF5[+d.charAt(p * 2 + 1)];
      for (i = 0; i < 5; i++) {
        mods += repeat('1', a.charAt(i) === '1' ? ITF_WIDE : 1);
        mods += repeat('0', b.charAt(i) === '1' ? ITF_WIDE : 1);
      }
    }
    mods += '11101';   // stop: wide bar, narrow space, narrow bar
    return mods;
  }

  function encode(digits, symbology) {
    switch (symbology) {
      case 'UPC-A':  return encodeUpcA(digits);
      case 'EAN-13': return encodeEan13(digits);
      case 'EAN-8':  return encodeEan8(digits);
      case 'ITF-14': return encodeItf14(digits);
      default:       return null;
    }
  }

  /* Group the module string into runs of bars. */
  function barsFromModules(mods) {
    var bars = [], i = 0, n = mods.length, j;
    while (i < n) {
      if (mods.charAt(i) === '1') {
        j = i;
        while (j < n && mods.charAt(j) === '1') j++;
        bars.push({ start: i, width: j - i });
        i = j;
      } else { i++; }
    }
    return bars;
  }

  /* ---------------------------------------------------------------
     GEOMETRY — encoder output + physical settings => drawable primitives
       opts: { xDim, barHeight (in, optional override), showText (bool),
               bearerBars (bool, ITF-14 only), padding (in) }
     All coordinates are INCHES, origin top-left of the artwork.
     --------------------------------------------------------------- */
  function buildGeometry(a, opts) {
    opts = opts || {};
    var sym   = a.symbology;
    var code  = a.code;
    var mods  = encode(code, sym);
    if (!mods) return null;

    var x = num(opts.xDim, REF_X);
    if (x <= 0) x = REF_X;
    var mag = x / REF_X;
    var showText = opts.showText !== false;
    var padding = Math.max(0, num(opts.padding, 0));

    var quietLeft, quietRight, guards, textMode, barH, hriSize;

    if (sym === 'UPC-A') {
      quietLeft = 9; quietRight = 9; guards = GUARDS_95; textMode = 'perDigit';
      barH = REF_BAR_H * mag;
    } else if (sym === 'EAN-13') {
      /* 11-module left quiet zone makes room for the leading digit */
      quietLeft = 11; quietRight = 7; guards = GUARDS_95; textMode = 'perDigit';
      barH = REF_BAR_H * mag;
    } else if (sym === 'EAN-8') {
      quietLeft = 7; quietRight = 7; guards = GUARDS_67; textMode = 'perDigit';
      barH = REF_EAN8_BAR_H * mag;
    } else { /* ITF-14 */
      quietLeft = 10; quietRight = 10; guards = []; textMode = 'below';
      /* GS1: 32 mm (1.2598 in) nominal bar height. A 19.05 mm allowance
         exists for X > 0.8 mm, but defaulting to the minimum looks broken
         on a case label, so we always start at the nominal height. */
      barH = ITF_BAR_H_TALL;
    }
    if (opts.barHeight > 0) barH = opts.barHeight;

    var guardDepth = (sym === 'ITF-14') ? 0 : 5 * x;
    hriSize = (sym === 'ITF-14') ? ITF_HRI_IN : (REF_HRI_PT * mag) / 72;

    var moduleCount = mods.length;
    var symbolStart = quietLeft;                 // in modules, from artwork left
    var symbolWidthIn = moduleCount * x;         // bars only
    var totalWidthIn  = (quietLeft + moduleCount + quietRight) * x;

    var bars = barsFromModules(mods);
    var drawn = [];

    bars.forEach(function (b) {
      var isGuard = guards.some(function (g) {
        return b.start >= g.start && (b.start + b.width) <= g.end;
      });
      drawn.push({
        x: padding + (symbolStart + b.start) * x,
        w: b.width * x,
        y: padding,
        h: barH + (isGuard ? guardDepth : 0),
        guard: isGuard
      });
    });

    /* -------- human readable text -------- */
    var textItems = [];
    if (showText) {
      var guardBottom = padding + barH + guardDepth;
      var hriGap = hriSize * 0.30;
      var baseline = guardBottom + hriGap + hriSize * 0.72;

      if (textMode === 'perDigit') {
        var centers;
        if (sym === 'EAN-8') {
          /* EAN-8 has no digits outside the bars: four under each half */
          centers = [6.5, 13.5, 20.5, 27.5, 39.5, 46.5, 53.5, 60.5];
          for (var e = 0; e < 8; e++) {
            textItems.push({ text: code.charAt(e), x: padding + (symbolStart + centers[e]) * x,
                             y: baseline, size: hriSize, align: 'middle' });
          }
        } else {
          /* Module centres of the twelve under-bar digit positions. Note they
             are NOT evenly spaced: digit 5 ends at module 45 and digit 6 starts
             at module 50, so the 5-module centre guard sits between them. */
          var centers95 = [6.5, 13.5, 20.5, 27.5, 34.5, 41.5,
                           53.5, 60.5, 67.5, 74.5, 81.5, 88.5];

          if (sym === 'EAN-13') {
            /* Emitted in LOGICAL order: leading digit first, then 1-12. The
               array order is what a PDF's text layer preserves, so keeping it
               logical means copying the number out of the PDF gives the real
               GTIN rather than a jumbled one. Each digit is still POSITIONED
               where GS1 wants it. */
            textItems.push({ text: code.charAt(0),
                             x: padding + (symbolStart - quietLeft / 2) * x,
                             y: baseline, size: hriSize, align: 'middle' });
            for (var k = 1; k <= 12; k++) {
              textItems.push({ text: code.charAt(k),
                               x: padding + (symbolStart + centers95[k - 1]) * x,
                               y: baseline, size: hriSize, align: 'middle' });
            }
          } else {
            /* UPC-A is the one that surprised us. GS1 prints the NUMBER SYSTEM
               digit in the left quiet zone and the CHECK digit in the right
               quiet zone — both OUTSIDE the bars — with the remaining ten digits
               in two groups of five underneath. Printing all twelve beneath the
               bars (which this used to do) is not the standard layout.

               Pushed in LOGICAL order 0..11 for the same text-layer reason as
               EAN-13; only the x position differs per digit. Digit index d IS
               the index into centers95, so the two stay aligned: 1-5 sit under
               the left half, 6-10 under the right half. */
            for (var d = 0; d <= 11; d++) {
              var px;
              if (d === 0) {
                px = symbolStart - quietLeft / 2;                      /* left quiet zone */
              } else if (d === 11) {
                px = symbolStart + moduleCount + quietRight / 2;        /* right quiet zone */
              } else {
                px = symbolStart + centers95[d];
              }
              textItems.push({ text: code.charAt(d), x: padding + px * x,
                               y: baseline, size: hriSize, align: 'middle' });
            }
          }
        }
      } else {
        textItems.push({ text: code, x: padding + (symbolStart + moduleCount / 2) * x,
                         y: baseline, size: hriSize, align: 'middle' });
      }
    }

    /* -------- vertical extent -------- */
    var contentBottom = padding + barH + guardDepth;
    if (showText) {
      var last = textItems[0];
      if (last) contentBottom = last.y + last.size * 0.22;
    }
    var totalHeightIn = contentBottom + padding;

    /* -------- ITF-14 bearer bars -------- */
    var bearer = null;
    if (sym === 'ITF-14' && opts.bearerBars !== false) {
      var t = Math.max(5 * x, 0.02);
      bearer = { t: t,
                 top:    { x: padding,               y: padding,               w: symbolWidthIn, h: t },
                 bottom: { x: padding,               y: padding + barH - t,    w: symbolWidthIn, h: t },
                 left:   { x: padding,               y: padding,               w: t,             h: barH },
                 right:  { x: padding + symbolWidthIn - t, y: padding,          w: t,             h: barH } };
    }

    return {
      symbology: sym,
      code: code,
      xDim: x,
      magnification: mag,
      modules: mods,
      moduleCount: moduleCount,
      quietLeft: quietLeft,
      quietRight: quietRight,
      symbolWidthIn: symbolWidthIn,
      totalWidthIn: totalWidthIn + padding * 2,
      barHeightIn: barH,
      guardDepthIn: guardDepth,
      totalHeightIn: totalHeightIn,
      hriSizeIn: hriSize,
      padding: padding,
      bars: drawn,
      textItems: textItems,
      bearer: bearer,
      textMode: textMode
    };
  }

  /* ---------------------------------------------------------------
     Filenames: "MODEL_UPC"
     --------------------------------------------------------------- */
  function sanitizeFilename(name) {
    var s = String(name == null ? '' : name).trim();
    s = s.replace(/[\u0000-\u001f\u007f]/g, '');
    s = s.replace(/[\\/:*?"<>|]+/g, '-');       /* illegal on Windows */
    s = s.replace(/[#%&{}$!'@+`=~^\[\]]+/g, ''); /* URL / shell hostile */
    s = s.replace(/[\s]+/g, '-');
    s = s.replace(/-{2,}/g, '-');
    s = s.replace(/^[-._]+|[-._]+$/g, '');
    if (s.length > 60) s = s.replace(/-+$/, '').slice(0, 60).replace(/-+$/, '');
    return s;
  }

  function makeBaseName(item, code, index) {
    var model = sanitizeFilename(item);
    var upc = sanitizeFilename(code);
    var base = model ? (model + '_' + upc) : upc;
    if (!base) base = 'barcode';
    return base;
  }

  /* ---------------------------------------------------------------
     Friendly status text for the UI
     --------------------------------------------------------------- */
  function statusLabel(res) {
    if (!res.ok) return 'Not encodable';
    if (res.checkWasFixed) return 'Check digit auto-corrected';
    if (res.status === 'warning') return 'OK — see notes';
    return 'Valid';
  }

  LW.barcode = {
    REF_X: REF_X,
    MAG_PRESETS: MAG_PRESETS,
    X_PRESETS: X_PRESETS,
    SYMBOLOGIES: ['Auto', 'UPC-A', 'EAN-13', 'EAN-8', 'ITF-14'],
    SYM_LENGTH: SYM_LENGTH,
    checkDigit: checkDigit,
    isCompleteValid: isCompleteValid,
    analyze: analyze,
    encode: encode,
    barsFromModules: barsFromModules,
    buildGeometry: buildGeometry,
    sanitizeFilename: sanitizeFilename,
    makeBaseName: makeBaseName,
    statusLabel: statusLabel,
    onlyDigits: onlyDigits
  };
})(window.LW);
