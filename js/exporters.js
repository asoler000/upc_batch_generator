/* =====================================================================
   Life Works UPC Engine  •  js/exporters.js
   Vector SVG, true-size vector PDF (hand-built, no libraries),
   multi-item merged PDF, ZIP packaging, print sheet, CSV exports.
   Everything runs in the browser. Nothing is uploaded anywhere.
   ===================================================================== */
window.LW = window.LW || {};

(function (LW) {
  'use strict';

  var PT = 72;                    /* PostScript points per inch */

  /* ---------------------------------------------------------------
     Shared: geometry -> SVG path data
     --------------------------------------------------------------- */
  function rectPath(x, y, w, h, dp) {
    return 'M' + dp(x) + ' ' + dp(y) + 'h' + dp(w) + 'v' + dp(h) + 'h' + dp(-w) + 'Z';
  }

  function dec(v, places) {
    var p = places == null ? 4 : places;
    var s = Number(v).toFixed(p);
    if (s.indexOf('.') > -1) s = s.replace(/0+$/, '').replace(/\.$/, '');
    return s;
  }

  /* ---------------------------------------------------------------
     SVG export — the Illustrator handoff
     --------------------------------------------------------------- */
  function buildSVG(geo, meta, opts) {
    opts = opts || {};
    var dp = function (v) { return dec(v, 4); };
    var W = geo.totalWidthIn;
    /* IMPORTANT: every dimension below is a plain SVG user unit, and the
       viewBox is expressed in inches, so one user unit == one inch.
       Never express a font-size with a CSS unit here: `font-size:0.15in`
       would be resolved against CSS's 96px-per-inch reference and blow the
       text up ~96x, painting a black slab across the bars. */
    var hasCaption = !!(opts.includeMeta && (meta.item || meta.description));
    var capH = hasCaption ? 0.34 : 0;
    var H = geo.totalHeightIn + capH;

    var title = meta.title || (meta.item ? meta.item + '_' + geo.code : geo.code);
    var noIds = !!opts.noIds;                 /* inline previews: avoid duplicate ids */
    var raster = opts.raster;                 /* { w, h } pixel box for canvas rasterising */

    var s = [];
    s.push('<?xml version="1.0" encoding="UTF-8" standalone="no"?>');
    s.push('<svg xmlns="http://www.w3.org/2000/svg" version="1.1"');
    if (raster) {
      /* Raster mode: viewBox in PIXELS with 1 user unit == 1 pixel, so the
         browser has no aspect-ratio mismatch to resolve and cannot letterbox,
         centre or rescale the artwork. The geometry (still in inches) is
         mapped through a single scale transform. */
      s.push('     width="' + Math.round(raster.w) + '" height="' + Math.round(raster.h) + '"');
      s.push('     viewBox="0 0 ' + Math.round(raster.w) + ' ' + Math.round(raster.h) + '">');
    } else {
      s.push('     width="' + dp(W) + 'in" height="' + dp(H) + 'in"');
      s.push('     viewBox="0 0 ' + dp(W) + ' ' + dp(H) + '">');
    }
    s.push('  <title>' + escapeXml(title) + '</title>');
    s.push('  <desc>' + escapeXml(geo.symbology + ' ' + geo.code +
           ' | X-dimension ' + geo.xDim.toFixed(4) + ' in (' +
           Math.round(geo.magnification * 100) + '% magnification) | ' +
           'bars ' + geo.symbolWidthIn.toFixed(4) + ' in wide x ' +
           geo.barHeightIn.toFixed(4) + ' in high') + '</desc>');

    if (raster) {
      var sx = raster.w / W, sy = raster.h / H;
      s.push('  <g transform="scale(' + dec(sx, 6) + ' ' + dec(sy, 6) + ')">');
    }
    /* --- layer: bars, pure vector rectangles, one compound path ---
       No shape-rendering hint: crispEdges would snap every bar edge to the
       device pixel grid, which shifts bars at small raster sizes and is
       wrong for print output anyway. */
    s.push('  <g' + (noIds ? '' : ' id="bars"') + ' fill="#000000" stroke="none">');
    var d = '';
    geo.bars.forEach(function (b) { d += rectPath(b.x, b.y, b.w, b.h, dp) + ' '; });
    if (geo.bearer) {
      var br = geo.bearer;
      ['top', 'bottom', 'left', 'right'].forEach(function (k) {
        d += rectPath(br[k].x, br[k].y, br[k].w, br[k].h, dp) + ' ';
      });
    }
    s.push('    <path d="' + d.trim() + '"/>');
    s.push('  </g>');

    /* --- layer: human readable characters, real text --- */
    if (geo.textItems.length) {
      s.push('  <g' + (noIds ? '' : ' id="hri"') + ' fill="#000000" ' +
             'font-family="Helvetica, Arial, sans-serif" font-weight="normal">');
      geo.textItems.forEach(function (t) {
        s.push('    <text x="' + dp(t.x) + '" y="' + dp(t.y) +
               '" font-size="' + dec(t.size, 4) + '" text-anchor="middle">' +
               escapeXml(t.text) + '</text>');
      });
      s.push('  </g>');
    }

    /* --- optional packaging caption block, inside the viewBox ---
       Rendered OUTSIDE the raster scale group so the caption keeps a
       predictable point size in pixel output instead of shrinking with the
       barcode. Only emitted when a caption was actually requested. */
    if (hasCaption) {
      var capY, capScale = 1;
      if (raster) {
        /* place it just under the scaled artwork, in real pixel space */
        capY = Math.round(raster.h) - 8;
        capScale = 1;
      } else {
        capY = geo.totalHeightIn + 0.13;
      }
      s.push('  <g' + (noIds ? '' : ' id="meta"') + ' fill="#000000" ' +
             'font-family="Helvetica, Arial, sans-serif" text-anchor="start">');
      s.push('    <text x="' + (raster ? 2 : 0) + '" y="' + capY +
             '" font-size="' + (raster ? 9 : 0.095) + '" font-weight="bold">' +
             escapeXml(String(meta.item || '').slice(0, 60)) + '</text>');
      if (meta.description && !raster) {
        s.push('    <text x="0" y="' + dp(capY + 0.12) + '" font-size="0.08">' +
               escapeXml(String(meta.description).slice(0, 90)) + '</text>');
      }
      s.push('  </g>');
    }

    if (raster) s.push('  </g>');   /* close the scale group */

    s.push('</svg>');
    return s.join('\n');
  }

  function escapeXml(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c];
    });
  }

  /* ---------------------------------------------------------------
     PDF builder — hand-built, shared by single + merged + print sheet
     --------------------------------------------------------------- */
  /* PDF base-14 Helvetica + WinAnsiEncoding is an 8-bit encoding, so every
     character we emit must be mapped to a single ASCII byte first, otherwise
     accented / smart punctuation bytes land on the wrong glyph. */
  var UNICODE_TO_ASCII = {
    '\u2018': "'", '\u2019': "'", '\u201A': ',', '\u201B': "'",
    '\u201C': '"', '\u201D': '"', '\u201E': '"',
    '\u2013': '-', '\u2014': '-', '\u2015': '-', '\u2212': '-',
    '\u2026': '...', '\u00a0': ' ', '\u2022': '*', '\u00b7': '*',
    '\u2032': "'", '\u2033': '"', '\u00b0': ' deg', '\u2122': '(TM)',
    '\u00ae': '(R)', '\u00a9': '(C)', '\u00d7': 'x', '\u00f7': '/',
    '\u2264': '<=', '\u2265': '>=', '\u00b1': '+/-', '\u2192': '->'
  };

  function pdfText(str) {
    var s = String(str == null ? '' : str);
    var out = '';
    for (var i = 0; i < s.length; i++) {
      var ch = s.charAt(i);
      if (UNICODE_TO_ASCII[ch] != null) { out += UNICODE_TO_ASCII[ch]; continue; }
      var c = s.charCodeAt(i);
      if (c === 9) { out += ' '; continue; }
      if (c < 32 || c > 255) { out += '?'; continue; }   /* keep WinAnsi range */
      out += ch;
    }
    return out;
  }

  function pdfEscape(str) {
    return pdfText(str).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
  }

  /* Draw one barcode onto a content stream.
     ox, oy = artwork origin in PDF points (oy measured from page bottom).
     NOTE: bar x MUST be offset by ox. This was omitted, so every barcode was
     drawn at x=0 of the page while its caption and HRI digits were indented by
     ox — the digits sat 0.25 in away from the bars in a single-item PDF, and on
     the print sheet every barcode in a row landed on top of the previous one. */
  function drawGeometry(out, geo, ox, oy, printLabel) {
    out.push('q');
    out.push('0 0 0 rg');
    out.push('0 0 0 RG');
    geo.bars.forEach(function (b) {
      var y = oy + (geo.totalHeightIn - (b.y + b.h)) * PT;
      out.push(dec(ox + b.x * PT, 3) + ' ' + dec(y, 3) + ' ' +
               dec(b.w * PT, 3) + ' ' + dec(b.h * PT, 3) + ' re f');
    });
    if (geo.bearer) {
      var br = geo.bearer;
      ['top', 'bottom', 'left', 'right'].forEach(function (k) {
        var r = br[k];
        var y = oy + (geo.totalHeightIn - (r.y + r.h)) * PT;
        out.push(dec(ox + r.x * PT, 3) + ' ' + dec(y, 3) + ' ' +
                 dec(r.w * PT, 3) + ' ' + dec(r.h * PT, 3) + ' re f');
      });
    }
    out.push('Q');

    if (geo.textItems.length) {
      out.push('BT');
      out.push('0 0 0 rg');
      out.push('/F1 ' + dec(geo.hriSizeIn * PT, 2) + ' Tf');
      geo.textItems.forEach(function (t) {
        var size = t.size * PT;
        /* Helvetica digits are all 556/1000 em, so centring is exact */
        var textW = size * (556 / 1000) * t.text.length;
        var cx = ox + t.x * PT - textW / 2;
        var cy = oy + (geo.totalHeightIn - t.y) * PT;
        out.push('1 0 0 1 ' + dec(cx, 3) + ' ' + dec(cy, 3) + ' Tm');
        out.push('(' + pdfEscape(t.text) + ') Tj');
      });
      out.push('ET');
    }

    if (printLabel) {
      out.push('BT');
      out.push('/F1 7 Tf');
      var lines = [
        (printLabel.item || '') + (printLabel.description ? '  \u2014  ' + printLabel.description : ''),
        printLabel.symbology + ' ' + printLabel.code + '   X-dim ' +
          printLabel.xDim.toFixed(4) + ' in   ' + printLabel.magnification + '%'
      ];
      lines.forEach(function (line, i) {
        var y = oy - 9 - i * 8;
        out.push('1 0 0 1 ' + dec(ox, 3) + ' ' + dec(y, 3) + ' Tm');
        out.push('(' + pdfEscape(line.slice(0, 150)) + ') Tj');
      });
      out.push('ET');
    }
  }

  /* pages: [{ wIn, hIn, stream: [ ...ops ] }] */
  function buildPDF(pages, docTitle) {
    var enc = new TextEncoder();
    var chunks = [];       /* {name, bytes} in object order */
    var objects = [];      /* offset bookkeeping */

    var kids = [];
    /* Object 3 is the font. Page objects must therefore start at 4 — when this
       counter also started at 3 the first page's content stream was emitted as
       "3 0 obj", colliding with the font object: the file contained object 3
       twice, the xref pointed at the stream, and viewers reported
       'Font "F1" is not available' — i.e. the human-readable digits and the
       caption line silently never rendered. */
    var nextId = 4;        /* 1 catalog, 2 pages, 3 font */
    var fontId = 3;
    var pageIds = [];
    var pageObjs = [];

    pages.forEach(function (p) {
      var contentId = nextId++;
      var pageId = nextId++;
      pageIds.push(pageId);
      var body = p.stream.join('\n');
      pageObjs.push({ id: pageId, contentId: contentId, w: p.wIn * PT, h: p.hIn * PT, body: body });
      kids.push(pageId + ' 0 R');
    });

    var out = [];
    var len = 0;
    function push(str) { out.push(str); len += str.length; }
    function pushBytes(u8) { out.push(u8); len += u8.length; }

    var offsets = {};
    function addObj(id, content) {
      var head = id + ' 0 obj\n';
      var tail = '\nendobj\n';
      var payload = (typeof content === 'string') ? content : content;
      var size = head.length + (typeof payload === 'string' ? payload.length : payload.length) + tail.length;
      /* uses latin1 byte length; all our object bodies are ASCII */
      offsets[id] = len;
      push(head + payload + tail);
    }

    push('%PDF-1.4\n');
    pushBytes(new Uint8Array([0x25, 0xE2, 0xE3, 0xCF, 0xD3, 0x0A]));   /* binary marker */

    addObj(1, '<< /Type /Catalog /Pages 2 0 R >>');
    addObj(2, '<< /Type /Pages /Kids [' + kids.join(' ') + '] /Count ' + kids.length + ' >>');
    addObj(fontId, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica ' +
                  '/Encoding /WinAnsiEncoding >>');

    pageObjs.forEach(function (p) {
      addObj(p.contentId, '<< /Length ' + p.body.length + ' >>\nstream\n' + p.body + '\nendstream');
      addObj(p.id, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' +
                   dec(p.w, 2) + ' ' + dec(p.h, 2) + '] ' +
                   '/Resources << /Font << /F1 ' + fontId + ' 0 R >> >> ' +
                   '/Contents ' + p.contentId + ' 0 R >>');
    });

    if (docTitle) {
      addObj(nextId, '<< /Title (' + pdfEscape(docTitle) + ') /Producer (Life Works UPC Engine) >>');
      var infoId = nextId;
      nextId++;
      /* attach to trailer */
      var xrefStart = len;
      push('xref\n0 ' + (nextId) + '\n');
      push('0000000000 65535 f \n');
      for (var i = 1; i < nextId; i++) {
        push(pad10(offsets[i] || 0) + ' 00000 n \n');
      }
      push('trailer\n<< /Size ' + nextId + ' /Root 1 0 R /Info ' + infoId + ' 0 R >>\n');
      push('startxref\n' + xrefStart + '\n%%EOF\n');
    } else {
      var xrefStart2 = len;
      push('xref\n0 ' + nextId + '\n');
      push('0000000000 65535 f \n');
      for (var j = 1; j < nextId; j++) push(pad10(offsets[j] || 0) + ' 00000 n \n');
      push('trailer\n<< /Size ' + nextId + ' /Root 1 0 R >>\n');
      push('startxref\n' + xrefStart2 + '\n%%EOF\n');
    }

    /* stitch to bytes */
    var total = 0;
    out.forEach(function (c) { total += (typeof c === 'string') ? c.length : c.length; });
    var buf = new Uint8Array(total);
    var pos = 0;
    out.forEach(function (c) {
      if (typeof c === 'string') {
        for (var i = 0; i < c.length; i++) buf[pos++] = c.charCodeAt(i) & 0xff;
      } else {
        buf.set(c, pos); pos += c.length;
      }
    });
    return buf;
  }

  function pad10(n) {
    var s = String(Math.max(0, Math.round(n)));
    while (s.length < 10) s = '0' + s;
    return s;
  }

  /* ---------------------------------------------------------------
     Single-item PDF
     --------------------------------------------------------------- */
  function buildItemPDF(geo, meta, opts) {
    opts = opts || {};
    var margin = num(opts.margin, 0.25);
    var extraCaption = 0;
    if (opts.includeMeta) extraCaption = 0.36;
    var wIn = geo.totalWidthIn + margin * 2;
    var hIn = geo.totalHeightIn + margin * 2 + extraCaption;

    var stream = [];
    var ox = margin * PT;
    var oy = (margin + extraCaption) * PT;

    drawGeometry(stream, geo, ox, oy, null);

    if (opts.includeMeta && (meta.item || meta.description)) {
      stream.push('BT');
      stream.push('0 0 0 rg');
      stream.push('/F1 11 Tf');
      stream.push('1 0 0 1 ' + dec(ox, 3) + ' ' + dec((margin * PT) + 18, 3) + ' Tm');
      stream.push('(' + pdfEscape(String(meta.item || '').slice(0, 70)) + ') Tj');
      stream.push('/F1 8 Tf');
      stream.push('1 0 0 1 ' + dec(ox, 3) + ' ' + dec((margin * PT) + 6, 3) + ' Tm');
      stream.push('(' + pdfEscape(String(meta.description || '').slice(0, 110)) + ') Tj');
      stream.push('ET');
    }

    return buildPDF([{ wIn: wIn, hIn: hIn, stream: stream }],
                    (meta.item || '') + ' ' + geo.code);
  }

  /* ---------------------------------------------------------------
     Multi-item merged PDF — one clean vector PDF, many pages
     --------------------------------------------------------------- */
  function buildMergedPDF(items, opts) {
    opts = opts || {};
    var margin = num(opts.margin, 0.25);
    var pages = [];
    items.forEach(function (it) {
      var geo = it.geo;
      var extraCaption = opts.includeMeta ? 0.36 : 0;
      var stream = [];
      var ox = margin * PT;
      var oy = (margin + extraCaption) * PT;
      drawGeometry(stream, geo, ox, oy, null);
      if (opts.includeMeta && (it.item || it.description)) {
        stream.push('BT');
        stream.push('0 0 0 rg');
        stream.push('/F1 11 Tf');
        stream.push('1 0 0 1 ' + dec(ox, 3) + ' ' + dec((margin * PT) + 18, 3) + ' Tm');
        stream.push('(' + pdfEscape(String(it.item || '').slice(0, 70)) + ') Tj');
        stream.push('/F1 8 Tf');
        stream.push('1 0 0 1 ' + dec(ox, 3) + ' ' + dec((margin * PT) + 6, 3) + ' Tm');
        stream.push('(' + pdfEscape(String(it.description || '').slice(0, 110)) + ') Tj');
        stream.push('ET');
      }
      pages.push({ wIn: geo.totalWidthIn + margin * 2,
                   hIn: geo.totalHeightIn + margin * 2 + extraCaption,
                   stream: stream });
    });
    if (!pages.length) return null;
    return buildPDF(pages, 'Life Works UPC batch \u2014 ' + pages.length + ' codes');
  }

  /* ---------------------------------------------------------------
     True-size print sheet — Letter, greedy row packing, real inches
     --------------------------------------------------------------- */
  function buildPrintSheet(items, opts) {
    opts = opts || {};
    var pageW = num(opts.pageWidth, 8.5);
    var pageH = num(opts.pageHeight, 11);
    var margin = num(opts.margin, 0.5);
    var usableW = pageW - margin * 2;
    var gutter = 0.30;

    var pages = [];
    var stream = [];
    var rowX = margin;        /* cursor from page left */
    var rowTop = margin;      /* cursor from page top */
    var rowH = 0;

    function headerOps() {
      var ops = [];
      ops.push('q');
      ops.push('0.45 0.45 0.45 rg');
      ops.push('BT');
      ops.push('/F1 7 Tf');
      ops.push('1 0 0 1 ' + dec((pageW * 0.5 - 1.75) * PT, 2) + ' ' +
               dec((pageH - 0.34) * PT, 2) + ' Tm');
      ops.push('(PRINT AT 100% / ACTUAL SIZE - DO NOT SCALE) Tj');
      ops.push('ET');
      ops.push('Q');
      return ops;
    }

    function startPage() {
      stream = headerOps();
      rowX = margin;
      rowTop = margin;
      rowH = 0;
    }

    function endPage() {
      if (stream.length) pages.push({ wIn: pageW, hIn: pageH, stream: stream });
      stream = [];
    }

    startPage();

    items.forEach(function (it) {
      var geo = it.geo;
      /* uniform cell so rows line up neatly, but never narrower than the code */
      var cellW = Math.max(geo.totalWidthIn, 1.75);
      var cellH = geo.totalHeightIn + 0.50;      /* 2 caption lines */
      if (cellW > usableW) cellW = usableW;

      if (rowX > margin && rowX + cellW > margin + usableW + 0.0001) {
        rowX = margin;
        rowTop += rowH + gutter;
        rowH = 0;
      }
      if (rowTop + cellH > pageH - margin + 0.0001 && rowTop > margin) {
        endPage();
        startPage();
      }

      /* Record the tallest cell in THIS row. Without this the row cursor never
         advanced (rowH stayed 0), so every row after the first was drawn on top
         of the one above it — the sheet showed one visible barcode per column
         while every label still printed. */
      if (cellH > rowH) rowH = cellH;

      var drawX = rowX + (cellW - geo.totalWidthIn) / 2;
      var yFromBottom = pageH - rowTop - geo.totalHeightIn;
      drawGeometry(stream, geo, drawX * PT, yFromBottom * PT, null);

      stream.push('BT');
      stream.push('0 0 0 rg');
      stream.push('/F1 8 Tf');
      stream.push('1 0 0 1 ' + dec(drawX * PT, 2) + ' ' +
                  dec((pageH - rowTop - geo.totalHeightIn - 0.17) * PT, 2) + ' Tm');
      stream.push('(' + pdfEscape(String(it.item || '(no model)').slice(0, 48)) + ') Tj');
      stream.push('/F1 7 Tf');
      stream.push('1 0 0 1 ' + dec(drawX * PT, 2) + ' ' +
                  dec((pageH - rowTop - geo.totalHeightIn - 0.29) * PT, 2) + ' Tm');
      stream.push('(' + pdfEscape(geo.symbology + ' ' + geo.code + '   X-dim ' +
                  it.xDim.toFixed(4) + 'in   ' + Math.round(geo.magnification * 100) + '%') + ') Tj');
      stream.push('ET');

      rowX += cellW + gutter;
      if (cellH > rowH) rowH = cellH;
    });

    endPage();
    if (!pages.length) return null;
    return buildPDF(pages, 'Life Works UPC print sheet');
  }

  /* ---------------------------------------------------------------
     ZIP builder — store (no compression), no dependencies
     --------------------------------------------------------------- */
  var CRC_TABLE = (function () {
    var t = new Uint32Array(256);
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c >>> 0;
    }
    return t;
  })();

  function crc32(bytes) {
    var c = 0xFFFFFFFF;
    for (var i = 0; i < bytes.length; i++) {
      c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    }
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  function dosDateTime(d) {
    var year = Math.max(1980, d.getFullYear());
    return {
      time: ((d.getHours() & 31) << 11) | ((d.getMinutes() & 63) << 5) | ((d.getSeconds() / 2) & 31),
      date: (((year - 1980) & 127) << 9) | (((d.getMonth() + 1) & 15) << 5) | (d.getDate() & 31)
    };
  }

  /* files: [{ name, bytes }] -> Uint8Array */
  function buildZip(files) {
    var enc = new TextEncoder();
    var now = dosDateTime(new Date());
    var parts = [];
    var central = [];
    var offset = 0;

    function u16(v) { return [v & 0xff, (v >>> 8) & 0xff]; }
    function u32(v) { return [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff]; }

    files.forEach(function (f) {
      var nameBytes = enc.encode(f.name);
      var data = f.bytes;
      var crc = crc32(data);
      var local = [].concat(
        u32(0x04034b50), u16(20), u16(0x0800), u16(0),
        u16(now.time), u16(now.date),
        u32(crc), u32(data.length), u32(data.length),
        u16(nameBytes.length), u16(0)
      );
      var localHeader = new Uint8Array(local);
      parts.push(localHeader, nameBytes, data);

      central.push({
        name: nameBytes, crc: crc, size: data.length, offset: offset,
        time: now.time, date: now.date
      });
      offset += localHeader.length + nameBytes.length + data.length;
    });

    var centralStart = offset;
    var centralBytes = 0;
    central.forEach(function (c) {
      var rec = [].concat(
        u32(0x02014b50), u16(20), u16(20), u16(0x0800), u16(0),
        u16(c.time), u16(c.date),
        u32(c.crc), u32(c.size), u32(c.size),
        u16(c.name.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(c.offset)
      );
      var arr = new Uint8Array(rec);
      parts.push(arr, c.name);
      centralBytes += arr.length + c.name.length;
    });

    var eocd = new Uint8Array([].concat(
      u32(0x06054b50), u16(0), u16(0),
      u16(central.length), u16(central.length),
      u32(centralBytes), u32(centralStart), u16(0)
    ));
    parts.push(eocd);

    var total = 0;
    parts.forEach(function (p) { total += p.length; });
    var zip = new Uint8Array(total);
    var pos = 0;
    parts.forEach(function (p) { zip.set(p, pos); pos += p.length; });
    return zip;
  }

  function num(v, fallback) {
    var n = parseFloat(v);
    return isFinite(n) ? n : fallback;
  }

  /* ---------------------------------------------------------------
     CSV helpers
     --------------------------------------------------------------- */
  function csvEscape(v) {
    return '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
  }

  LW.exporters = {
    buildSVG: buildSVG,
    buildPDF: buildPDF,
    buildItemPDF: buildItemPDF,
    buildMergedPDF: buildMergedPDF,
    buildPrintSheet: buildPrintSheet,
    buildZip: buildZip,
    csvEscape: csvEscape,
    crc32: crc32
  };
})(window.LW);
