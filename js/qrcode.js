/* =====================================================================
   Life Works QR / GS1 Digital Link engine  •  js/qrcode.js
   A from-scratch QR Code (model 2) encoder: byte mode, versions 1-10,
   error-correction levels L / M / Q / H.

   Why hand-written: this project ships as a single self-contained file
   with zero dependencies and no network calls, so a CDN QR library is
   not an option. Everything here follows ISO/IEC 18004 directly.

   Correctness is not asserted by eye — tests/qrverify.html renders the
   output and decodes it with an independent QR reader (jsQR), requiring
   the decoded text to equal the input exactly.
   ===================================================================== */
window.LW = window.LW || {};

(function (LW) {
  'use strict';

  /* ---------------------------------------------------------------
     Galois field GF(256), QR primitive polynomial 0x11D
     --------------------------------------------------------------- */
  var EXP = new Uint8Array(512);
  var LOG = new Uint8Array(256);
  (function () {
    var x = 1, i;
    for (i = 0; i < 255; i++) {
      EXP[i] = x;
      LOG[x] = i;
      x <<= 1;
      if (x & 0x100) x ^= 0x11D;
    }
    for (i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
  })();

  function gmul(a, b) {
    if (a === 0 || b === 0) return 0;
    return EXP[LOG[a] + LOG[b]];
  }

  /* Multiply two polynomials over GF(256). Coefficients are arrays with the
     highest-order term first, as the QR spec writes them. */
  function polyMul(a, b) {
    var out = new Array(a.length + b.length - 1);
    var i, j;
    for (i = 0; i < out.length; i++) out[i] = 0;
    for (i = 0; i < a.length; i++) {
      if (a[i] === 0) continue;
      for (j = 0; j < b.length; j++) {
        out[i + j] ^= gmul(a[i], b[j]);
      }
    }
    return out;
  }

  /* Reed-Solomon generator polynomial of degree n: (x-a^0)(x-a^1)...(x-a^(n-1)) */
  var GEN_CACHE = {};
  function rsGenPoly(n) {
    if (GEN_CACHE[n]) return GEN_CACHE[n];
    var poly = [1];
    for (var i = 0; i < n; i++) poly = polyMul(poly, [1, EXP[i]]);
    GEN_CACHE[n] = poly;
    return poly;
  }

  /* Systematic remainder: returns the n EC codewords for the data block. */
  function rsEncode(data, ecLen) {
    var gen = rsGenPoly(ecLen);
    var buf = new Uint8Array(data.length + ecLen);
    buf.set(data, 0);
    for (var i = 0; i < data.length; i++) {
      var coef = buf[i];
      if (coef === 0) continue;
      for (var j = 0; j < gen.length; j++) {
        buf[i + j] ^= gmul(gen[j], coef);
      }
    }
    return buf.subarray(data.length);
  }

  /* ---------------------------------------------------------------
     Version tables, versions 1-10
       ec    = EC codewords per block
       g     = [[blockCount, dataCodewordsPerBlock], ...] group by group
     Verified internally by totalCodewords() below, which reproduces the
     spec's total codeword count for every entry.
     --------------------------------------------------------------- */
  var CAP = {
    1:  { L: { ec: 7,  g: [[1, 19]] },
          M: { ec: 10, g: [[1, 16]] },
          Q: { ec: 13, g: [[1, 13]] },
          H: { ec: 17, g: [[1, 9]] } },
    2:  { L: { ec: 10, g: [[1, 34]] },
          M: { ec: 16, g: [[1, 28]] },
          Q: { ec: 22, g: [[1, 22]] },
          H: { ec: 28, g: [[1, 16]] } },
    3:  { L: { ec: 15, g: [[1, 55]] },
          M: { ec: 26, g: [[1, 44]] },
          Q: { ec: 18, g: [[2, 17]] },
          H: { ec: 22, g: [[2, 13]] } },
    4:  { L: { ec: 20, g: [[1, 80]] },
          M: { ec: 18, g: [[2, 32]] },
          Q: { ec: 26, g: [[2, 24]] },
          H: { ec: 16, g: [[4, 9]] } },
    5:  { L: { ec: 26, g: [[1, 108]] },
          M: { ec: 24, g: [[2, 43]] },
          Q: { ec: 18, g: [[2, 15], [2, 16]] },
          H: { ec: 22, g: [[2, 11], [2, 12]] } },
    6:  { L: { ec: 18, g: [[2, 68]] },
          M: { ec: 16, g: [[4, 27]] },
          Q: { ec: 24, g: [[4, 19]] },
          H: { ec: 28, g: [[4, 15]] } },
    7:  { L: { ec: 20, g: [[2, 78]] },
          M: { ec: 18, g: [[4, 31]] },
          Q: { ec: 18, g: [[2, 14], [4, 15]] },
          H: { ec: 26, g: [[4, 13], [1, 14]] } },
    8:  { L: { ec: 24, g: [[2, 97]] },
          M: { ec: 22, g: [[2, 38], [2, 39]] },
          Q: { ec: 22, g: [[4, 18], [2, 19]] },
          H: { ec: 26, g: [[4, 14], [2, 15]] } },
    9:  { L: { ec: 30, g: [[2, 116]] },
          M: { ec: 22, g: [[3, 36], [2, 37]] },
          Q: { ec: 20, g: [[4, 16], [4, 17]] },
          H: { ec: 24, g: [[4, 12], [4, 13]] } },
    10: { L: { ec: 18, g: [[2, 68], [2, 69]] },
          M: { ec: 26, g: [[4, 43], [1, 44]] },
          Q: { ec: 24, g: [[6, 19], [2, 20]] },
          H: { ec: 28, g: [[6, 15], [2, 16]] } }
  };

  /* Alignment pattern centre coordinates, versions 1-10 */
  var ALIGN = {
    1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30],
    6: [6, 34], 7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50]
  };

  var MAX_VERSION = 10;

  /* EC level indicator bits used in the format information */
  var ECC_BITS = { L: 1, M: 0, Q: 3, H: 2 };
  var ECC_ORDER = ['L', 'M', 'Q', 'H'];

  /* Matrix carrying ONLY the function patterns (finder, separator, timing,
     alignment, format reservation). Everything still null is a data module.
     buildFor() starts from this, and totalCodewords() measures it — so the two
     can never drift apart. */
  function functionMatrix(version) {
    var size = version * 4 + 17;
    var m = blankMatrix(size);
    placeFinder(m, 0, 0);
    placeFinder(m, size - 7, 0);
    placeFinder(m, 0, size - 7);
    placeAlignment(m, version);
    placeTiming(m);
    reserveFormat(m, version);
    return m;
  }

  /* Total codeword count derived by MEASURING the matrix, so it is an
     independent check on the capacity tables rather than a restatement of
     them. Must equal the spec totals (26, 44, 70, 100, ... 346). */
  function totalCodewords(version) {
    var size = version * 4 + 17;
    var m = functionMatrix(version);
    var total = 0, i, j;
    for (i = 0; i < size; i++) {
      for (j = 0; j < size; j++) if (m[i][j] === null) total++;
    }
    /* leftover remainder bits are padding and are not a codeword */
    return Math.floor(total / 8);
  }

  /* Largest byte-mode payload a version/level can hold. */
  function maxBytes(version, ecc) {
    var ccBits = (version <= 9) ? 8 : 16;
    var capacityBits = dataCodewordCount(version, ecc) * 8;
    return Math.floor((capacityBits - 4 - ccBits) / 8);
  }

  function dataCodewordCount(version, ecc) {
    var t = CAP[version][ecc], n = 0;
    t.g.forEach(function (grp) { n += grp[0] * grp[1]; });
    return n;
  }

  /* ---------------------------------------------------------------
     Bit buffer
     --------------------------------------------------------------- */
  function BitBuffer() { this.bits = []; }
  BitBuffer.prototype.put = function (value, length) {
    for (var i = length - 1; i >= 0; i--) this.bits.push((value >>> i) & 1);
  };
  BitBuffer.prototype.length = function () { return this.bits.length; };
  BitBuffer.prototype.toBytes = function () {
    var bytes = [];
    for (var i = 0; i < this.bits.length; i += 8) {
      var b = 0;
      for (var j = 0; j < 8; j++) b = (b << 1) | (this.bits[i + j] || 0);
      bytes.push(b);
    }
    return bytes;
  };

  /* ---------------------------------------------------------------
     Matrix scaffolding
     --------------------------------------------------------------- */
  function blankMatrix(size) {
    var m = [];
    for (var i = 0; i < size; i++) {
      m.push([]);
      for (var j = 0; j < size; j++) m[i].push(null);
    }
    return m;
  }

  function placeFinder(m, row, col) {
    var r, c;
    for (r = -1; r <= 7; r++) {
      for (c = -1; c <= 7; c++) {
        var rr = row + r, cc = col + c;
        if (rr < 0 || rr >= m.length || cc < 0 || cc >= m.length) continue;
        var on = (r >= 0 && r <= 6 && (c === 0 || c === 6)) ||
                 (c >= 0 && c <= 6 && (r === 0 || r === 6)) ||
                 (r >= 2 && r <= 4 && c >= 2 && c <= 4);
        m[rr][cc] = on;
      }
    }
  }

  function placeTiming(m) {
    var size = m.length, i;
    for (i = 8; i <= size - 9; i++) {
      var on = (i % 2 === 0);
      if (m[i][6] === null) m[i][6] = on;
      if (m[6][i] === null) m[6][i] = on;
    }
  }

  function placeAlignment(m, version) {
    var pos = ALIGN[version];
    if (!pos || !pos.length) return;
    pos.forEach(function (r) {
      pos.forEach(function (c) {
        if (m[r][c] !== null) return;         /* overlaps a finder pattern */
        for (var dr = -2; dr <= 2; dr++) {
          for (var dc = -2; dc <= 2; dc++) {
            m[r + dr][c + dc] =
              (dr === -2 || dr === 2 || dc === -2 || dc === 2 || (dr === 0 && dc === 0));
          }
        }
      });
    });
  }

  /* Reserve the format-info cells so data placement skips them. The values
     are written later, once the mask is known. */
  function reserveFormat(m, version) {
    var size = m.length, i;
    for (i = 0; i <= 8; i++) {
      if (m[8][i] === null) m[8][i] = false;
      if (m[i][8] === null) m[i][8] = false;
    }
    for (i = 0; i < 8; i++) {
      if (m[8][size - 1 - i] === null) m[8][size - 1 - i] = false;
      if (m[size - 1 - i][8] === null) m[size - 1 - i][8] = false;
    }
    m[size - 8][8] = true;   /* the fixed dark module */

    if (version >= 7) {
      for (i = 0; i < 18; i++) {
        var a = Math.floor(i / 3), b = i % 3;
        m[size - 11 + b][a] = false;
        m[a][size - 11 + b] = false;
      }
    }
  }

  /* ---------------------------------------------------------------
     Masks
     --------------------------------------------------------------- */
  function maskFn(pattern, i, j) {
    switch (pattern) {
      case 0: return (i + j) % 2 === 0;
      case 1: return i % 2 === 0;
      case 2: return j % 3 === 0;
      case 3: return (i + j) % 3 === 0;
      case 4: return (Math.floor(i / 2) + Math.floor(j / 3)) % 2 === 0;
      case 5: return ((i * j) % 2) + ((i * j) % 3) === 0;
      case 6: return (((i * j) % 2) + ((i * j) % 3)) % 2 === 0;
      case 7: return (((i + j) % 2) + ((i * j) % 3)) % 2 === 0;
      default: return false;
    }
  }

  /* Penalty scoring, ISO/IEC 18004 section 8.8.2 */
  function penalty(m) {
    var size = m.length, score = 0, i, j;

    /* rule 1: runs of five or more identical modules in a row or column */
    function runScore(line) {
      var s = 0, run = 1;
      for (var k = 1; k < line.length; k++) {
        if (line[k] === line[k - 1]) { run++; }
        else {
          if (run >= 5) s += 3 + (run - 5);
          run = 1;
        }
      }
      if (run >= 5) s += 3 + (run - 5);
      return s;
    }
    for (i = 0; i < size; i++) {
      var row = [], col = [];
      for (j = 0; j < size; j++) { row.push(m[i][j]); col.push(m[j][i]); }
      score += runScore(row) + runScore(col);
    }

    /* rule 2: 2x2 blocks of one colour */
    for (i = 0; i < size - 1; i++) {
      for (j = 0; j < size - 1; j++) {
        var a = m[i][j];
        if (a === m[i][j + 1] && a === m[i + 1][j] && a === m[i + 1][j + 1]) score += 3;
      }
    }

    /* rule 3: the finder-like pattern 1011101 0000 or 0000 1011101 */
    var P1 = [true, false, true, true, true, false, true, false, false, false, false];
    var P2 = [false, false, false, false, true, false, true, true, true, false, true];
    function patAt(line, k, pat) {
      for (var q = 0; q < pat.length; q++) if (line[k + q] !== pat[q]) return false;
      return true;
    }
    for (i = 0; i < size; i++) {
      var r2 = [], c2 = [];
      for (j = 0; j < size; j++) { r2.push(m[i][j]); c2.push(m[j][i]); }
      [r2, c2].forEach(function (line) {
        for (var k = 0; k + 11 <= size; k++) {
          if (patAt(line, k, P1) || patAt(line, k, P2)) score += 40;
        }
      });
    }

    /* rule 4: deviation from a 50/50 dark ratio */
    var dark = 0;
    for (i = 0; i < size; i++) for (j = 0; j < size; j++) if (m[i][j]) dark++;
    var pct = (dark * 100) / (size * size);
    score += Math.floor(Math.abs(pct - 50) / 5) * 10;

    return score;
  }

  /* ---------------------------------------------------------------
     Format / version information
     --------------------------------------------------------------- */
  function formatBits(ecc, mask) {
    var data = (ECC_BITS[ecc] << 3) | mask;
    var rem = data;
    for (var i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    return ((data << 10) | rem) ^ 0x5412;
  }

  function versionBits(version) {
    var rem = version;
    for (var i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1F25);
    return (version << 12) | rem;
  }

  /* ---------------------------------------------------------------
     ENCODE
       encode(text, { ecc: 'L'|'M'|'Q'|'H', version: number|null })
       -> { size, version, ecc, mask, modules[][] (true = dark) }
     --------------------------------------------------------------- */
  function encode(text, opts) {
    opts = opts || {};
    var ecc = opts.ecc || 'M';
    if (ECC_ORDER.indexOf(ecc) < 0) ecc = 'M';

    var bytes = utf8Bytes(String(text == null ? '' : text));

    /* --- pick the smallest version that fits --- */
    var version = opts.version || null;
    var ccBits, needed;
    function fits(v) {
      var cap = dataCodewordCount(v, ecc) * 8;
      var cc = (v <= 9) ? 8 : 16;                /* byte-mode character count width */
      return 4 + cc + bytes.length * 8 <= cap;
    }
    if (version) {
      if (!fits(version)) {
        return { ok: false, error: 'Text is ' + bytes.length + ' bytes, which exceeds the ' +
          maxBytes(version, ecc) + '-byte limit of version ' + version + ' at error-correction ' +
          'level ' + ecc + '.', bytes: bytes.length, capacity: maxBytes(version, ecc) };
      }
    } else {
      for (version = 1; version <= MAX_VERSION; version++) {
        if (fits(version)) break;
      }
      if (version > MAX_VERSION) {
        return { ok: false, error: 'Text is ' + bytes.length + ' bytes, which exceeds the ' +
          maxBytes(MAX_VERSION, ecc) + '-byte limit of a version ' + MAX_VERSION + ' QR code at ' +
          'error-correction level ' + ecc + '. Shorten the URL, or lower the error-correction level.',
          bytes: bytes.length, capacity: maxBytes(MAX_VERSION, ecc) };
      }
    }

    ccBits = (version <= 9) ? 8 : 16;
    var totalDataBytes = dataCodewordCount(version, ecc);

    /* --- bit stream: mode 0100, length, payload --- */
    var bb = new BitBuffer();
    bb.put(4, 4);                        /* byte mode */
    bb.put(bytes.length, ccBits);
    for (var i = 0; i < bytes.length; i++) bb.put(bytes[i], 8);

    var capacityBits = totalDataBytes * 8;
    /* terminator, up to four zero bits */
    var term = Math.min(4, capacityBits - bb.length());
    if (term > 0) bb.put(0, term);
    /* pad to a byte boundary */
    while (bb.length() % 8 !== 0) bb.bits.push(0);
    /* pad codewords */
    var padBytes = [0xEC, 0x11], p = 0;
    var dataBytes = bb.toBytes();
    while (dataBytes.length < totalDataBytes) {
      dataBytes.push(padBytes[p % 2]);
      p++;
    }

    /* --- split into blocks, add EC, interleave --- */
    var spec = CAP[version][ecc];
    var blocks = [];
    var at = 0;
    spec.g.forEach(function (grp) {
      for (var b = 0; b < grp[0]; b++) {
        var chunk = dataBytes.slice(at, at + grp[1]);
        at += grp[1];
        blocks.push({ data: chunk, ec: rsEncode(chunk, spec.ec) });
      }
    });

    var interleaved = [];
    var maxData = 0, maxEc = spec.ec;
    blocks.forEach(function (b) { if (b.data.length > maxData) maxData = b.data.length; });
    for (i = 0; i < maxData; i++) {
      blocks.forEach(function (b) { if (i < b.data.length) interleaved.push(b.data[i]); });
    }
    for (i = 0; i < maxEc; i++) {
      blocks.forEach(function (b) { interleaved.push(b.ec[i]); });
    }

    /* --- build the matrix --- */
    var size = version * 4 + 17;

    function buildFor(mask) {
      var m = functionMatrix(version);

      /* data modules, zigzag from the bottom-right */
      var inc = -1, row = size - 1, bitIndex = 7, byteIndex = 0, col, c;
      for (col = size - 1; col > 0; col -= 2) {
        if (col === 6) col--;
        for (;;) {
          for (c = 0; c < 2; c++) {
            var cc = col - c;
            if (m[row][cc] === null) {
              var dark = false;
              if (byteIndex < interleaved.length) {
                dark = ((interleaved[byteIndex] >>> bitIndex) & 1) === 1;
              }
              if (maskFn(mask, row, cc)) dark = !dark;
              m[row][cc] = dark;
              bitIndex--;
              if (bitIndex === -1) { byteIndex++; bitIndex = 7; }
            }
          }
          row += inc;
          if (row < 0 || row >= size) { row -= inc; inc = -inc; break; }
        }
      }

      /* format information, both copies (ISO/IEC 18004 figure 25) */
      var bits = formatBits(ecc, mask);
      function getBit(n) { return ((bits >>> n) & 1) === 1; }
      for (i = 0; i < 15; i++) {
        var v = getBit(i);
        if (i < 6) m[i][8] = v;
        else if (i < 8) m[i + 1][8] = v;
        else m[size - 15 + i][8] = v;
      }
      for (i = 0; i < 15; i++) {
        v = getBit(i);
        if (i < 8) m[8][size - i - 1] = v;
        else if (i < 9) m[8][15 - i - 1 + 1] = v;
        else m[8][15 - i - 1] = v;
      }
      m[size - 8][8] = true;

      /* version information, versions 7 and up */
      if (version >= 7) {
        var vb = versionBits(version);
        for (i = 0; i < 18; i++) {
          v = ((vb >>> i) & 1) === 1;
          var a = Math.floor(i / 3), b = i % 3;
          m[size - 11 + b][a] = v;
          m[a][size - 11 + b] = v;
        }
      }
      return m;
    }

    /* --- choose the mask with the lowest penalty --- */
    var best = null, bestScore = Infinity, bestPattern = 0;
    for (var mk = 0; mk < 8; mk++) {
      var cand = buildFor(mk);
      var sc = penalty(cand);
      if (sc < bestScore) { bestScore = sc; best = cand; bestPattern = mk; }
    }

    return {
      ok: true,
      size: size,
      version: version,
      ecc: ecc,
      mask: bestPattern,
      penalty: bestScore,
      modules: best
    };
  }

  function utf8Bytes(str) {
    var out = [];
    for (var i = 0; i < str.length; i++) {
      var c = str.charCodeAt(i);
      if (c < 0x80) out.push(c);
      else if (c < 0x800) {
        out.push(0xC0 | (c >> 6), 0x80 | (c & 63));
      } else if (c >= 0xD800 && c <= 0xDBFF) {
        /* surrogate pair */
        var c2 = str.charCodeAt(++i);
        var cp = 0x10000 + ((c - 0xD800) << 10) + (c2 - 0xDC00);
        out.push(0xF0 | (cp >> 18), 0x80 | ((cp >> 12) & 63),
                 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
      } else {
        out.push(0xE0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
      }
    }
    return out;
  }

  /* ---------------------------------------------------------------
     GS1 Digital Link
       A UPC-A / GTIN is the *identifier*; the Digital Link is that same
       GTIN expressed as a resolvable HTTPS URL, so a phone camera can
       open it with no app. GS1's canonical host is id.gs1.org.
     --------------------------------------------------------------- */
  function gtin14(code) {
    var d = String(code == null ? '' : code).replace(/[^0-9]/g, '');
    if (d.length > 14) return null;
    while (d.length < 14) d = '0' + d;
    return d;
  }

  /* AI (01) = GTIN. Optional extra AIs, e.g. 10 = batch/lot, 17 = expiry.
     Expiry must be YYMMDD; anything malformed is dropped rather than
     silently encoded wrong. */
  function digitalLink(code, extra) {
    var g = gtin14(code);
    if (!g) return null;
    var url = 'https://id.gs1.org/01/' + g;
    extra = extra || {};
    if (extra.batch) {
      url += '?10=' + encodeURIComponent(String(extra.batch).slice(0, 20));
    }
    if (extra.expiry && /^[0-9]{6}$/.test(String(extra.expiry))) {
      url += (extra.batch ? '&' : '?') + '17=' + extra.expiry;
    }
    return url;
  }

  /* ---------------------------------------------------------------
     Vector SVG for a QR matrix. Unlike the barcode SVGs this is built on
     a PIXEL viewBox (moduleSize px per module) because a QR has no GS1
     physical X-dimension requirement — only the 4-module quiet zone,
     which is mandatory and enforced here.
     --------------------------------------------------------------- */
  function escapeXml(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[ch];
    });
  }

  function buildSVG(qr, opts) {
    opts = opts || {};
    var ms = opts.moduleSize || 8;          /* px per module */
    var quiet = (opts.quiet == null) ? 4 : opts.quiet;   /* QR spec: 4 modules */
    var size = qr.size;
    var dim = (size + quiet * 2) * ms;
    var capH = opts.includeMeta ? 0.30 : 0;
    var height = dim + (capH ? 34 : 0);
    var s = [];
    s.push('<?xml version="1.0" encoding="UTF-8" standalone="no"?>');
    s.push('<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" ' +
           'width="' + (dim / 96).toFixed(4) + 'in" height="' + (height / 96).toFixed(4) + 'in" ' +
           'viewBox="0 0 ' + dim + ' ' + height + '">');
    s.push('  <rect width="' + dim + '" height="' + height + '" fill="#ffffff"/>');
    s.push('  <g id="qr" fill="#000000" shape-rendering="crispEdges">');

    /* one path for all dark modules keeps the file small and is easy for
       Illustrator to select as a single object */
    var d = '';
    for (var r = 0; r < size; r++) {
      for (var c = 0; c < size; c++) {
        if (!qr.modules[r][c]) continue;
        var x = (c + quiet) * ms, y = (r + quiet) * ms;
        d += 'M' + x + ' ' + y + 'h' + ms + 'v' + ms + 'h-' + ms + 'z';
      }
    }
    s.push('    <path d="' + d + '"/>');
    s.push('  </g>');

    if (opts.includeMeta) {
      s.push('  <g fill="#000000" font-family="Helvetica, Arial, sans-serif" text-anchor="start">');
      s.push('    <text x="2" y="' + (dim + 11) + '" font-size="9" font-weight="bold">' +
             escapeXml(String(opts.item || '').slice(0, 60)) + '</text>');
      s.push('    <text x="2" y="' + (dim + 21) + '" font-size="7">' +
             escapeXml(String(opts.url || '').slice(0, 90)) + '</text>');
      s.push('    <text x="2" y="' + (dim + 30) + '" font-size="6">' +
             'GS1 Digital Link ' + escapeXml(String(opts.gtin || '')) +
             '   (AI 01)   QR v' + qr.version + ' ' + qr.ecc + '</text>');
      s.push('  </g>');
    }

    s.push('</svg>');
    return s.join('\n');
  }

  LW.qr = {
    encode: encode,
    buildSVG: buildSVG,
    digitalLink: digitalLink,
    gtin14: gtin14,
    /* exposed for tests */
    _internal: {
      rsGenPoly: rsGenPoly,
      rsEncode: rsEncode,
      formatBits: formatBits,
      versionBits: versionBits,
      totalCodewords: totalCodewords,
      dataCodewordCount: dataCodewordCount,
      maxBytes: maxBytes,
      functionMatrix: functionMatrix,
      utf8Bytes: utf8Bytes,
      penalty: penalty,
      CAP: CAP,
      ALIGN: ALIGN
    }
  };
})(window.LW);
