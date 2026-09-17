/* =====================================================================
   Life Works QR / GS1 Digital Link batch  •  js/qr-batch.js
   Generates the SECOND, SEPARATE deliverable: one QR per export-list row,
   built from an existing GTIN (never a new one).

   Kept in its own file, and emitted as its own ZIP, so the 2D codes can
   never be confused with — or substituted for — the linear UPC barcodes.
   ===================================================================== */
(function () {
  'use strict';

  var LW = window.LW;
  var B = LW.barcode;

  var Q = null;   /* bound on init so a missing qrcode.js degrades quietly */

  function $(id) { return document.getElementById(id); }

  function setOutputStatus(html, cls) {
    var el = $('outputStatus');
    el.innerHTML = html;
    el.className = 'status' + (cls ? ' ' + cls : '');
  }

  function saveBlob(blob, filename) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  }

  /* -------------------- options -------------------- */
  function readExtra() {
    var extra = {};
    if ($('optQrBatch') && $('optQrBatch').checked) {
      var b = String($('qrBatch').value || '').trim();
      if (b) extra.batch = b;
    }
    if ($('optQrExpiry') && $('optQrExpiry').checked) {
      var e = String($('qrExpiry').value || '').trim();
      /* only a real YYMMDD goes in — a malformed date is surfaced, not encoded */
      if (/^[0-9]{6}$/.test(e)) {
        extra.expiry = e;
      } else if (e) {
        return { error: 'Expiry must be exactly 6 digits as YYMMDD (e.g. 270630). "' +
                        e.replace(/[<>]/g, '') + '" cannot be encoded as GS1 AI (17).' };
      }
    }
    return { extra: extra };
  }

  function qrMeta() {
    return {
      ecc: ($('qrEcc') && $('qrEcc').value) || 'M',
      includeMeta: true,
      moduleSize: 8,
      quiet: 4
    };
  }

  /* The 2D batch honours the SAME "Batch output files" checkboxes as the linear
     barcode batch. A QR has no X-dimension or magnification, so its PDF page is
     sized to the module grid plus a caption allowance instead. */
  function wantSvg() { return !$('outSvg') || $('outSvg').checked; }
  function wantPdf() { return !$('outPdf') || $('outPdf').checked; }
  function wantPng() { return !$('outPng') || $('outPng').checked; }
  function outputCount() {
    return (wantSvg() ? 1 : 0) + (wantPdf() ? 1 : 0) + (wantPng() ? 1 : 0);
  }
  function moduleSize() {
    var s = parseInt($('qrModuleSize') ? $('qrModuleSize').value : '', 10);
    if (!isFinite(s)) s = 8;
    return Math.min(40, Math.max(4, s));
  }

  /* QR PNG via canvas. The SVG is fully self-contained (no external refs), so a
     data URL keeps the canvas untainted. Mirrors app.js svgToPngBytes. */
  function svgToPngBytes(svgText, pxW, pxH) {
    return new Promise(function (resolve, reject) {
      var dataUrl = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgText);
      var img = new Image();
      img.onload = function () {
        try {
          var canvas = document.createElement('canvas');
          canvas.width = pxW;
          canvas.height = pxH;
          var ctx = canvas.getContext('2d');
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, pxW, pxH);
          ctx.drawImage(img, 0, 0, pxW, pxH);
          canvas.toBlob(function (blob) {
            if (!blob) { reject(new Error('PNG encode failed')); return; }
            blob.arrayBuffer().then(function (buf) { resolve(new Uint8Array(buf)); });
          }, 'image/png');
        } catch (err) { reject(err); }
      };
      img.onerror = function () { reject(new Error('SVG could not be rasterised')); };
      img.src = dataUrl;
    });
  }

  /* Reuse the barcode engine only to decide which rows are genuinely
     encodable GTINs — the QR always encodes the GTIN, never a new number. */
  function prepare() {
    var items = [], problems = [];
    var S = {
      symbology: ($('symPref') && $('symPref').value) || 'Auto',
      autoFixCheck: ($('optFix') ? $('optFix').checked : true)
    };
    var rows = window.LW.__getSavedRows ? window.LW.__getSavedRows() : [];

    rows.forEach(function (row) {
      var res = B.analyze(row.upc, { preferred: S.symbology, autoFixCheck: S.autoFixCheck });
      if (!res.ok) {
        problems.push((row.item || '(no model)') + ' — ' +
          (res.messages.filter(function (m) { return m.level === 'error'; })[0] || {}).text);
        return;
      }
      items.push({
        item: row.item,
        description: row.description,
        code: res.code,
        symbology: res.symbology,
        base: B.makeBaseName(row.item, res.code)
      });
    });

    /* de-duplicate filenames the same way the barcode ZIP does */
    var seen = {};
    items.forEach(function (it) {
      var name = it.base, n = 2;
      while (seen[name]) { name = it.base + '-' + n; n++; }
      seen[name] = true;
      it.base = name;
    });

    return { items: items, problems: problems };
  }

  /* -------------------- the batch --------------------
     Split into two halves:
       buildQrFiles() — pure: returns {files, problems, failed, largest, count}
       generateQRs()  — builds, packages the ZIP and downloads it
     The split predates the removal of the combined "Generate Everything"
     action; it is kept because it separates building from downloading,
     which keeps the file builder testable without triggering a download. */
  async function buildQrFiles() {
    var rows = window.LW.__getSavedRows ? window.LW.__getSavedRows() : [];
    if (!rows.length) return { empty: true, files: [], problems: [], failed: [], count: 0 };

    var opt = readExtra();
    if (opt.error) return { error: opt.error, files: [], problems: [], failed: [], count: 0 };

    var prep = prepare();
    if (!prep.items.length) {
      return { noneEncodable: true, files: [], problems: prep.problems, failed: [], count: 0 };
    }

    var meta = qrMeta();
    var mSize = moduleSize();
    var files = [], failed = [], lines = [];
    var largest = null;

    for (var i = 0; i < prep.items.length; i++) {
      var it = prep.items[i];
      var url = Q.digitalLink(it.code, opt.extra);
      if (!url) { failed.push(it.item || it.code); continue; }

      var enc = Q.encode(url, { ecc: meta.ecc });
      if (!enc.ok) {
        /* one over-long case must not kill the whole batch */
        failed.push((it.item || it.code) + ' (' + enc.error + ')');
        continue;
      }

      var svgOpts = {
        moduleSize: mSize,
        quiet: meta.quiet,
        includeMeta: meta.includeMeta,
        item: it.item,
        url: url,
        gtin: Q.gtin14(it.code)
      };
      var dim = (enc.size + meta.quiet * 2) * mSize;
      var capAllowance = 34;                 /* room for the printed caption */

      if (wantSvg()) {
        var svg = Q.buildSVG(enc, svgOpts);
        /* the _GS1-DIGITAL-LINK suffix makes the deliverable self-describing,
           so a 2D file can never be mistaken for a linear barcode file */
        files.push({ name: it.base + '_GS1-DIGITAL-LINK.svg',
                     bytes: new TextEncoder().encode(svg) });
      }

      if (wantPdf()) {
        var svgForPdf = Q.buildSVG(enc, svgOpts);
        files.push({ name: it.base + '_GS1-DIGITAL-LINK.pdf',
                     bytes: buildQrPdf(svgForPdf, dim, dim + capAllowance, svgOpts) });
      }

      if (wantPng()) {
        var rasterSvg = Q.buildSVG(enc, svgOpts);
        files.push({ name: it.base + '_GS1-DIGITAL-LINK.png',
                     bytes: await svgToPngBytes(rasterSvg, dim, dim) });
      }

      lines.push([
        it.item || '(no model)',
        it.symbology + ' ' + it.code,
        'GTIN-14 ' + Q.gtin14(it.code),
        url,
        'QR version ' + enc.version + ', EC ' + enc.ecc + ', mask ' + enc.mask,
        enc.size + ' x ' + enc.size + ' modules, quiet zone 4 modules (mandatory)',
        'Printed size at ' + mSize + ' px/module: ' + (dim / 96).toFixed(3) +
          ' in square (module size is a screen/print decision, not a GS1 figure)'
      ].join('\n    '));

      if (!largest || enc.size > largest.size) largest = { size: enc.size, item: it.item };
    }

    return { files: files, problems: prep.problems, failed: failed,
             largest: largest, count: prep.items.length, prepared: prep.items,
             meta: meta, lines: lines };
  }

  /* --- a minimal, self-contained PDF wrapper around a QR SVG page.
     The QR itself is drawn as vector rectangles, so the PDF stays
     resolution-independent at any print size. --- */
  function buildQrPdf(svgText, wPx, hPx, meta) {
    var PT = 72;
    var dpi = 96;                     /* SVG user units are treated as px */
    var wIn = wPx / dpi, hIn = hPx / dpi;

    /* The QR SVG draws every dark module into ONE path whose runs are written
       as `M<x> <y>h<w>v<h>h-<w>z`. There is no per-module <rect>, and the single
       background <rect> carries no x/y at all — so parsing <rect> elements here
       yields nothing and would emit a blank page. Parse the path runs instead. */
    var re = /M(-?[\d.]+) (-?[\d.]+)h(-?[\d.]+)v(-?[\d.]+)/g;
    var rects = [], m;
    while ((m = re.exec(svgText)) !== null) {
      rects.push({
        x: parseFloat(m[1]), y: parseFloat(m[2]),
        w: Math.abs(parseFloat(m[3])), h: Math.abs(parseFloat(m[4]))
      });
    }

    function pdfStr(v) {
      return String(v == null ? '' : v)
        .replace(/[\\()]/g, '\\$&')
        .replace(/[^\x20-\x7e]/g, '?');
    }

    var stream = [];
    stream.push('q');
    stream.push('0 0 0 rg');
    rects.forEach(function (r) {
      var yb = (hPx - r.y - r.h) / dpi * PT;
      stream.push((r.x / dpi * PT).toFixed(3) + ' ' + yb.toFixed(3) + ' ' +
                  (r.w / dpi * PT).toFixed(3) + ' ' + (r.h / dpi * PT).toFixed(3) + ' re f');
    });
    stream.push('Q');

    /* caption sits in the 34px allowance BELOW the symbol */
    var label = String((meta && meta.item) || '');
    if (label) {
      stream.push('BT');
      stream.push('0 0 0 rg');
      stream.push('/F1 7 Tf');
      stream.push('1 0 0 1 2 11 Tm');
      stream.push('(' + pdfStr(label.slice(0, 60)) + ') Tj');
      stream.push('/F1 6 Tf');
      stream.push('1 0 0 1 2 3 Tm');
      stream.push('(' + pdfStr('GS1 Digital Link ' + ((meta && meta.gtin) || '')).slice(0, 90) + ') Tj');
      stream.push('ET');
    }

    var body = stream.join('\n');
    var pageId = 4, contentId = 5;
    var out = [];
    var offsets = {};
    var len = 0;
    function push(s) { out.push(s); len += (typeof s === 'string') ? s.length : s.length; }
    function addObj(id, content) {
      offsets[id] = len;
      push(id + ' 0 obj\n' + content + '\nendobj\n');
    }
    push('%PDF-1.4\n');
    push(new Uint8Array([0x25, 0xE2, 0xE3, 0xCF, 0xD3, 0x0A]));
    addObj(1, '<< /Type /Catalog /Pages 2 0 R >>');
    addObj(2, '<< /Type /Pages /Kids [' + pageId + ' 0 R] /Count 1 >>');
    addObj(3, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
    addObj(contentId, '<< /Length ' + body.length + ' >>\nstream\n' + body + '\nendstream');
    addObj(pageId, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' +
      (wIn * PT).toFixed(2) + ' ' + (hIn * PT).toFixed(2) + '] ' +
      '/Resources << /Font << /F1 3 0 R >> >> /Contents ' + contentId + ' 0 R >>');
    var total = 6;
    var xrefStart = len;
    push('xref\n0 ' + total + '\n');
    push('0000000000 65535 f \n');
    for (var i = 1; i < total; i++) {
      var s = String(offsets[i] || 0);
      while (s.length < 10) s = '0' + s;
      push(s + ' 00000 n \n');
    }
    push('trailer\n<< /Size ' + total + ' /Root 1 0 R >>\nstartxref\n' + xrefStart + '\n%%EOF\n');
    var t = 0;
    out.forEach(function (c) { t += c.length; });
    var buf = new Uint8Array(t);
    var pos = 0;
    out.forEach(function (c) {
      if (typeof c === 'string') {
        for (var k = 0; k < c.length; k++) buf[pos++] = c.charCodeAt(k) & 0xff;
      } else { buf.set(c, pos); pos += c.length; }
    });
    return buf;
  }

  /* Build the 2D ZIP (with its spec sheet) without downloading it. The spec
     sheet must stay as auditable as the linear deliverable's README, so it
     carries version / EC level / mask / GTIN / URL per item. */
  function packageQrZip(res) {
    var files = res.files.slice();
    var spec = ['GS1 Digital Link (2D) specification sheet',
      'Life Works UPC Tool — generated ' + new Date().toISOString().slice(0, 10),
      'Error correction level: ' + res.meta.ecc,
      'Each QR encodes an HTTPS GS1 Digital Link built from the existing GTIN via AI (01).',
      'The 4-module quiet zone is REQUIRED for these codes to scan — do not crop it.',
      'The QR encodes the SAME GTIN as the linear UPC. It never replaces it.'].concat(res.lines || []);
    files.push({ name: '00_GS1-DIGITAL-LINK_README.txt',
                 bytes: new TextEncoder().encode(spec.join('\n\n')) });
    return files;
  }

  async function generateQRs() {
    if (!Q) {
      setOutputStatus('<strong>QR engine unavailable.</strong> js/qrcode.js did not load.', 'errortext');
      return;
    }
    var rows = window.LW.__getSavedRows ? window.LW.__getSavedRows() : [];
    if (!rows.length) { alert('Your export list is empty. Look up and add model numbers first.'); return; }
    if (!outputCount()) {
      setOutputStatus('<strong>No file type is ticked.</strong> Tick SVG, PDF or PNG under ' +
        '&ldquo;Batch output files&rdquo;.', 'errortext');
      return;
    }

    var res = await buildQrFiles();
    if (res.error) { setOutputStatus('<strong>' + escapeText(res.error) + '</strong>', 'errortext'); return; }
    if (res.empty) { alert('Your export list is empty. Look up and add model numbers first.'); return; }
    if (res.noneEncodable) {
      setOutputStatus('<strong>Nothing generated.</strong> No row could be read as a GTIN. ' +
        'Fix the errors in the Check column first.', 'errortext');
      return;
    }
    if (!res.files.length) {
      setOutputStatus('<strong>Nothing generated.</strong> ' + res.failed.map(escapeText).join(' · '), 'errortext');
      return;
    }

    setOutputStatus('Building ' + res.count + ' Digital Link code(s)…');
    var files = packageQrZip(res);
    var zipBytes = LW.exporters.buildZip(files);
    var stamp = new Date().toISOString().slice(0, 10);
    saveBlob(new Blob([zipBytes], { type: 'application/zip' }),
             'lifeworks_gs1_digital_link_' + stamp + '.zip');

    var msg = '<strong>Generated ' + files.length + ' file(s)</strong> in a separate ZIP: one editable ' +
      'file per item, named <span class="code-cell">MODEL_UPC_GS1-DIGITAL-LINK.*</span>. ' +
      'Largest symbol: ' + (res.largest ? res.largest.size + ' &times; ' + res.largest.size + ' modules, EC ' + res.meta.ecc : '') +
      '. These are <strong>additional</strong> codes — place them alongside the UPC, never instead of it.';
    if (res.problems.length) msg += '<br>Skipped: ' + res.problems.map(escapeText).join(' · ');
    if (res.failed.length) msg += '<br>Failed: ' + res.failed.map(escapeText).join(' · ');
    setOutputStatus(msg, (res.problems.length || res.failed.length) ? 'errortext' : 'goodtext');
  }

  function escapeText(v) {
    return String(v == null ? '' : v).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function init() {
    Q = (LW && LW.qr) ? LW.qr : null;
    var btn = $('qrBtn');
    if (!btn) return;
    if (!Q) {
      btn.disabled = true;
      btn.textContent = 'Generate 2D Codes (engine not loaded)';
      return;
    }
    btn.addEventListener('click', generateQRs);

    /* keep the batch/expiry inputs visually tied to their checkboxes */
    [['optQrBatch', 'qrBatch'], ['optQrExpiry', 'qrExpiry']].forEach(function (pair) {
      var cb = $(pair[0]), input = $(pair[1]);
      if (!cb || !input) return;
      var sync = function () { input.disabled = !cb.checked; };
      cb.addEventListener('change', sync);
      sync();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else { init(); }

  /* exposed so the harness can drive it — and so the combined generate
     action can reuse the builder without a second download */
  LW.qrBatch = {
    generate: generateQRs,
    prepare: prepare,
    buildQrFiles: buildQrFiles,
    packageQrZip: packageQrZip
  };
})();
