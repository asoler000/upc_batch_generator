/* =====================================================================
   Life Works UPC Tool  •  js/qr-sizing.js
   QR print-size check — "will this 2D code actually scan at the size my
   artwork gives it?"

   WHY THIS EXISTS
   ---------------
   A QR that is drawn correctly can still be unreadable. The thing that
   decides readability is the MODULE PITCH: the physical size of one
   black square. Scale a 33-module symbol down to fit a narrow panel and
   the pitch falls through the floor — the code still LOOKS perfect in
   Illustrator and fails in a customer's hand. That is the worst failure
   mode because it survives design review.

   So this module answers two questions, using the REAL encoder (never an
   estimate, so it cannot disagree with the artwork):
     1. given the width I have, what pitch do I get — and is it safe?
     2. what width do I need for a safe pitch?

   The bands below are PRACTICAL GUIDANCE for consumer phone scanning
   under normal packaging conditions, not a quotation from a standard.
   They are deliberately conservative and they are not a substitute for
   printing the thing and scanning it with a real phone.
   ===================================================================== */
(function (LW) {
  'use strict';

  var Q = LW.qr;

  /* Quiet zone is mandated at 4 modules per side by ISO/IEC 18004, so the
     symbol's total footprint is (moduleCount + 8) squares across. */
  var QUIET_MODULES = 4;

  /* Bands of module pitch in millimetres.
     LOWER = below the symbology's own floor; nothing sensible can rescue it.
     These are engineering judgement for retail cosmetics/supplements on a
     phone camera at arm's length, deliberately stricter than the bare
     minimum because packaging is glossy, curved and often poorly lit. */
  var BANDS = [
    { id: 'below',  max: 0.25,
      label: 'BELOW MINIMUM',
      cls: 'err',
      advice: 'Under 0.25 mm per module is below the point where a QR symbol is ' +
              'defined to work. Do not print this. Make the code bigger or move the ' +
              'UPC/GTIN text so the code gets the space.' },
    { id: 'floor',  max: 0.35,
      label: 'AT THE FLOOR',
      cls: 'fixed',
      advice: 'This is the bare floor. It will only read on a perfect print, flat ' +
              'surface, matte stock, good light, phone held close. On a glossy or ' +
              'curved pack expect failures. Treat as a last resort.' },
    { id: 'tight',  max: 0.50,
      label: 'WORKABLE',
      cls: 'ok',
      advice: 'Workable for close-range phone scanning on a flat, matte panel. ' +
              'Avoid small print runs with heavy ink variation, and do not laminate ' +
              'with a high-gloss film — glare kills the read.' },
    { id: 'good',   max: 0.80,
      label: 'COMFORTABLE',
      cls: 'ok',
      advice: 'Comfortable. This is the range to aim for on a consumer pack: reads ' +
              'quickly, tolerates curvature, laminate and average lighting.' },
    { id: 'robust', max: 1.60,
      label: 'ROBUST',
      cls: 'ok',
      advice: 'Very robust — reads at distance and through scuffing. Fine on a ' +
              'carton or shelf-ready tray.' },
    { id: 'huge',   max: Infinity,
      label: 'VERY LARGE',
      cls: 'sym',
      advice: 'Bigger than it needs to be. It will scan perfectly, but the code is ' +
              'eating artwork you may want for claims or legal copy. Consider a ' +
              'higher error-correction level (more data, same box) or trim the width.' }
  ];

  function bandFor(pitchMm) {
    for (var i = 0; i < BANDS.length; i++) {
      if (pitchMm < BANDS[i].max) return BANDS[i];
    }
    return BANDS[BANDS.length - 1];
  }

  function toMm(value, unit) {
    var v = parseFloat(value);
    if (!isFinite(v) || v <= 0) return null;
    return unit === 'in' ? v * 25.4 : v;
  }

  /* Assess one width. Returns null when the inputs are unusable, so the UI
     can show "—" rather than a confident number it cannot support. */
  function assess(opts) {
    opts = opts || {};
    var widthMm = opts.widthMm;
    if (!isFinite(widthMm) || widthMm <= 0) return null;
    if (!Q) return null;

    /* Use a real 12-digit UPC so the GTIN pads to 14 exactly as it will in
       production. The URL length — and therefore the symbol size — is driven
       by the GTIN plus any batch/expiry, never by the specific product. */
    var url = Q.digitalLink(opts.sampleGtin || '012345678905',
                            { batch: opts.batch, expiry: opts.expiry });
    if (!url) return null;

    var ecc = opts.ecc || 'M';
    var enc = Q.encode(url, { ecc: ecc });
    if (!enc.ok) return null;

    var totalModules = enc.size + QUIET_MODULES * 2;
    var pitchMm = widthMm / totalModules;
    var band = bandFor(pitchMm);

    /* the width you would need to land a target pitch */
    function widthFor(targetPitch) {
      return totalModules * targetPitch;
    }

    return {
      url: url,
      version: enc.version,
      ecc: enc.ecc,
      mask: enc.mask,
      moduleCount: enc.size,
      quietModules: QUIET_MODULES,
      totalModules: totalModules,
      widthMm: widthMm,
      pitchMm: pitchMm,
      pitchIn: pitchMm / 25.4,
      band: band.id,
      label: band.label,
      cls: band.cls,
      advice: band.advice,
      safeWidthMm: widthFor(0.50),
      floorWidthMm: widthFor(0.35),
      ceilingWidthMm: widthFor(0.80),
      blocks: [{ targetMm: 0.40, widthMm: widthFor(0.40) },
               { targetMm: 0.50, widthMm: widthFor(0.50) },
               { targetMm: 0.80, widthMm: widthFor(0.80) }]
    };
  }

  /* Convenience for the UI: straight from the raw form values. */
  function assessFromForm(raw) {
    raw = raw || {};
    var widthMm = toMm(raw.width, raw.unit);
    if (widthMm == null) return null;
    return assess({
      widthMm: widthMm,
      ecc: raw.ecc,
      batch: raw.batch,
      expiry: raw.expiry
    });
  }

  LW.qrSizing = {
    QUIET_MODULES: QUIET_MODULES,
    BANDS: BANDS,
    bandFor: bandFor,
    toMm: toMm,
    assess: assess,
    assessFromForm: assessFromForm
  };

  /* =================================================================
     UI — the print-size checker panel
     Reads the live form values directly. Note it deliberately does NOT
     react to "QR module size (px)": that only sets the raster resolution
     of the exported PNG and has no bearing on scanned size. Conflating
     the two is the mistake this panel exists to prevent.
     ================================================================= */
  function $(id) { return document.getElementById(id); }

  function readForm() {
    function checked(id) { return $(id) && $(id).checked; }
    function val(id) { return $(id) ? String($(id).value || '') : ''; }
    return {
      width: val('qrWidth'),
      unit: val('qrUnit') || 'in',
      ecc: val('qrEcc') || 'M',
      batch: checked('optQrBatch') ? val('qrBatch') : '',
      expiry: checked('optQrExpiry') ? val('qrExpiry') : ''
    };
  }

  function fmt(v) {
    return v.toFixed(2) + ' mm';
  }
  function fmtIn(v) {
    var inches = v / 25.4;
    return (inches < 1 ? inches.toFixed(3) : inches.toFixed(2)) + ' in';
  }

  function render() {
    var box = $('qrSizeOut');
    if (!box) return;

    var a = assessFromForm(readForm());
    if (!a) {
      box.className = 'spec-note';
      box.textContent = 'Enter the width you have available to check it.';
      return;
    }

    box.className = 'spec-note' +
      (a.band === 'below' ? ' err' : (a.band === 'floor' ? ' warn' : ''));

    var html = '';
    html += '<strong>' + a.label + '</strong> \u2014 one module of this code prints ' +
            fmt(a.pitchMm) + ' (' + fmtIn(a.pitchMm) + ').<br>';
    html += 'Symbol: QR v' + a.version + ', error correction ' + a.ecc + ', ' + a.moduleCount +
            ' modules across + ' + a.quietModules + ' modules of quiet zone each side = ' +
            a.totalModules + ' squares. Width ' + fmt(a.widthMm) + ' (' + fmtIn(a.widthMm) + ').<br>';
    html += a.advice;

    if (a.pitchMm < 0.50) {
      html += '<br><strong>To reach a comfortable 0.50 mm per module you need at least ' +
              fmt(a.safeWidthMm) + ' (' + fmtIn(a.safeWidthMm) + ').</strong>';
    } else if (a.pitchMm > 0.80) {
      html += '<br>You could shrink this to ' + fmt(a.ceilingWidthMm) +
              ' (' + fmtIn(a.ceilingWidthMm) + ') and still stay comfortable.';
    }
    html += '<br><span class="tiny">Encodes: ' + a.url + '</span>';

    box.innerHTML = html;
  }

  function init() {
    var box = $('qrSizeOut');
    if (!box) return;                       /* not on this page */
    ['qrWidth', 'qrUnit', 'qrEcc', 'optQrBatch', 'qrBatch', 'optQrExpiry', 'qrExpiry']
      .forEach(function (id) {
        var el = $(id);
        if (!el) return;
        el.addEventListener('input', render);
        el.addEventListener('change', render);
      });
    render();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else { init(); }

  LW.qrSizing.render = render;
})(window.LW = window.LW || {});
