/* =====================================================================
   Life Works UPC Tool  •  js/app.js
   Master CSV lookup (unchanged behaviour) + validation, live vector
   preview, and batch generation of barcode files named MODEL_UPC.
   ===================================================================== */
(function () {
  'use strict';

  var LW = window.LW;
  var B = LW.barcode;
  var X = LW.exporters;

  var DB_NAME = 'LifeWorksUPCLookupDB_V8';   /* kept from the original tool */
  var DB_VERSION = 1;
  var STORE = 'state';

  var db = null;
  var masterRows = [];
  var savedRows = [];
  var visibleRows = [];

  /* =================================================================
     IndexedDB (identical to the original tool)
     ================================================================= */
  function openDB() {
    return new Promise(function (resolve, reject) {
      var request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = function (event) {
        var database = event.target.result;
        if (!database.objectStoreNames.contains(STORE)) {
          database.createObjectStore(STORE, { keyPath: 'key' });
        }
      };
      request.onsuccess = function (event) { resolve(event.target.result); };
      request.onerror = function () { reject(request.error); };
    });
  }

  function dbGet(key) {
    return new Promise(function (resolve, reject) {
      var tx = db.transaction(STORE, 'readonly');
      var req = tx.objectStore(STORE).get(key);
      req.onsuccess = function () { resolve(req.result ? req.result.value : null); };
      req.onerror = function () { reject(req.error); };
    });
  }

  function dbSet(key, value) {
    return new Promise(function (resolve, reject) {
      var tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put({ key: key, value: value });
      tx.oncomplete = function () { resolve(); };
      tx.onerror = function () { reject(tx.error); };
    });
  }

  function dbDelete(key) {
    return new Promise(function (resolve, reject) {
      var tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(key);
      tx.oncomplete = function () { resolve(); };
      tx.onerror = function () { reject(tx.error); };
    });
  }

  /* =================================================================
     CSV parsing (identical to the original tool)
     ================================================================= */
  function readFileAsText(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function (e) { resolve(e.target.result); };
      reader.onerror = function () { reject(reader.error); };
      reader.readAsText(file, 'ISO-8859-1');
    });
  }

  function csvToRows(text) {
    text = String(text || '').replace(/^\uFEFF/, '');
    var rows = [], row = [], cell = '', inQuotes = false;

    for (var i = 0; i < text.length; i++) {
      var char = text[i], next = text[i + 1];

      if (char === '"' && inQuotes && next === '"') { cell += '"'; i++; }
      else if (char === '"') { inQuotes = !inQuotes; }
      else if (char === ',' && !inQuotes) { row.push(cell); cell = ''; }
      else if ((char === '\n' || char === '\r') && !inQuotes) {
        if (char === '\r' && next === '\n') i++;
        row.push(cell);
        if (row.some(function (v) { return String(v).trim() !== ''; })) rows.push(row);
        row = []; cell = '';
      } else { cell += char; }
    }
    if (cell.length || row.length) {
      row.push(cell);
      if (row.some(function (v) { return String(v).trim() !== ''; })) rows.push(row);
    }
    return rows;
  }

  function normalizeHeader(value) {
    return String(value || '').replace(/\u00A0/g, ' ').trim().toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ').trim();
  }
  function normalizeSearch(value) {
    return String(value || '').replace(/\u00A0/g, ' ').toLowerCase().replace(/[^a-z0-9]+/g, '');
  }
  function clean(value) { return String(value == null ? '' : value).trim(); }
  function escapeHTML(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (s) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[s];
    });
  }

  function findColumn(headers, choices) {
    var normalized = headers.map(normalizeHeader);
    var choiceNorm = choices.map(normalizeHeader);
    for (var a = 0; a < choiceNorm.length; a++) {
      var idx = normalized.indexOf(choiceNorm[a]);
      if (idx >= 0) return idx;
    }
    for (var b = 0; b < choiceNorm.length; b++) {
      for (var h = 0; h < normalized.length; h++) {
        if (normalized[h].indexOf(choiceNorm[b]) > -1 || choiceNorm[b].indexOf(normalized[h]) > -1) {
          return h;
        }
      }
    }
    return -1;
  }

  /* =================================================================
     Master upload / search
     ================================================================= */
  async function uploadMaster() {
    var fileInput = document.getElementById('csvFile');
    var file = fileInput.files[0];

    if (!file) { alert('Please choose a CSV file first.'); return; }
    if (masterRows.length) {
      if (!confirm('This will replace the current saved master list in this browser. Continue?')) return;
    }

    setUploadStatus('Reading CSV...');
    var text = await readFileAsText(file);
    var parsed = csvToRows(text);

    if (parsed.length < 2) {
      alert('This CSV looks empty.');
      setUploadStatus('Upload failed: CSV looks empty.');
      return;
    }

    var headers = parsed[0];
    var itemIndex = findColumn(headers, ['item num display', 'item number', 'item num', 'model number', 'model', 'sku']);
    var descIndex = findColumn(headers, ['description', 'item description', 'product description', 'desc']);
    var gtinIndex = findColumn(headers, ['gtin single pack upc', 'gtin - single pack upc', 'single pack upc gtin', 'gtin upc']);

    if (itemIndex < 0 || descIndex < 0 || gtinIndex < 0) {
      alert('I could not find the required columns. Required: Item Number, Description, and GTIN - Single Pack UPC.');
      setUploadStatus('Upload failed. Headers found: ' + headers.map(function (h) { return '[' + h + ']'; }).join(' '));
      return;
    }

    masterRows = parsed.slice(1).map(function (row, index) {
      return {
        id: 'm_' + index,
        item: clean(row[itemIndex]),
        description: clean(row[descIndex]),
        upc: clean(row[gtinIndex]),
        searchable: normalizeSearch([row[itemIndex], row[descIndex], row[gtinIndex]].join(' '))
      };
    }).filter(function (row) { return row.item || row.description || row.upc; });

    updateCounts();
    clearSearch(false);

    try {
      await dbSet('masterRows', masterRows);
      await dbSet('lastUploadDate', new Date().toISOString());
      await showWeeklyReminder();
      setUploadStatus('<strong>Master uploaded:</strong> ' + masterRows.length.toLocaleString() +
        ' rows loaded and saved in this browser. File date saved for this week.', true);
    } catch (err) {
      setUploadStatus('<strong>Master loaded:</strong> ' + masterRows.length.toLocaleString() +
        ' rows loaded. Browser storage save failed, but search will still work while this window stays open.', true);
    }
  }

  function setUploadStatus(message, isGood) {
    var el = document.getElementById('uploadStatus');
    el.innerHTML = message;
    el.className = isGood ? 'status goodtext' : 'status';
  }

  function updateCounts() {
    var el = document.getElementById('masterCount');
    if (masterRows.length) {
      el.textContent = masterRows.length.toLocaleString() + ' master rows loaded';
      el.classList.add('loaded');
    } else {
      el.textContent = 'No master list loaded';
      el.classList.remove('loaded');
    }
  }

  /* =================================================================
     Lookup results table — the only search surface.

     A single typed model number and a pasted column of fifty both flow
     through lookupPasted(), so there is exactly ONE matching path in the
     tool and the two cases cannot diverge.
     ================================================================= */

  function renderResults() {
    /* retained only so nothing stale can render into a removed table */
    return;
  }

  /* The old search state is no longer used by any surface, but leaving a
     declared-but-unused variable is harmless and keeps the diff small. */

  function addToSavedLocal(row) {
    var key = [row.item, row.description, row.upc].join('|').toLowerCase();
    var exists = savedRows.some(function (r) {
      return [r.item, r.description, r.upc].join('|').toLowerCase() === key;
    });
    if (exists) { setUploadStatus('That row is already in your export list.'); return false; }

    savedRows.push({
      id: 's_' + Date.now() + '_' + Math.random().toString(16).slice(2),
      item: row.item || '',
      description: row.description || '',
      upc: row.upc || ''
    });
    setUploadStatus('Added to export list.', true);
    return true;
  }

  async function saveSavedRows() {
    try { await dbSet('savedRows', savedRows); }
    catch (err) { console.warn('Could not save export list.', err); }
  }

  async function addManual() {
    var row = {
      id: 'manual_' + Date.now(),
      item: clean(document.getElementById('manualItem').value),
      description: clean(document.getElementById('manualDesc').value),
      upc: clean(document.getElementById('manualUpc').value)
    };
    if (!row.item && !row.description && !row.upc) { alert('Please enter at least one value.'); return; }

    savedRows.push(row);
    renderSaved();
    await saveSavedRows();
    document.getElementById('manualItem').value = '';
    document.getElementById('manualDesc').value = '';
    document.getElementById('manualUpc').value = '';
  }

  async function clearSaved() {
    if (!confirm('Clear the export list?')) return;
    savedRows = [];
    renderSaved();
    await dbSet('savedRows', savedRows);
  }

  async function clearPaste() {
    $('pasteInput').value = '';
    lookupResults = [];
    renderLookupResults();
    $('lookupStatus').textContent = 'Ready. Type one model number or paste a whole column.';
    updatePasteCount();
  }

  function updatePasteCount() {
    var text = $('pasteInput').value;
    var n = parsePastedList(text).length;
    $('pasteCount').textContent = n
      ? n + ' model number' + (n === 1 ? '' : 's') + ' detected — nothing is generated until you generate.'
      : 'Nothing pasted yet.';
  }

  async function clearMaster() {
    if (!confirm('Delete the saved master list from this browser?')) return;
    masterRows = []; visibleRows = [];
    updateCounts();
    lookupResults = [];
    renderLookupResults();
    await dbDelete('masterRows');
    await dbDelete('lastUploadDate');
    await showWeeklyReminder();
    setUploadStatus('Master list deleted. Upload a new CSV when ready.');
  }

  /* =================================================================
     Paste a column of model numbers -> look each one up
     ---------------------------------------------------------------
     Built for the real workflow: copy the model-number column out of a
     spreadsheet (any WHERE clause, any row order), paste it, and get
     every UPC at once instead of typing them one at a time.
     ================================================================= */

  /* Split a pasted block into candidate model numbers. Handles one per
     line, comma / tab / semicolon separated, spreadsheet-quoted cells,
     CRLF and stray blank lines. */
  function parsePastedList(text) {
    var t = String(text == null ? '' : text);
    var out = [];
    var seen = {};
    var i = 0;
    var current = '';
    var values = [];

    function pushCell(v) {
      var clean = String(v).trim();
      if (clean) values.push(clean);
    }
    /* A line break always starts a new value, even when the line had no comma —
       that is what makes a copied spreadsheet COLUMN work. */
    function flushRow() {
      pushCell(current);
      current = '';
      values.forEach(function (v) {
        var norm = v.toLowerCase();
        if (!v || seen[norm]) return;
        seen[norm] = true;
        out.push(v);
      });
      values = [];
    }

    while (i < t.length) {
      var ch = t.charAt(i);

      if (ch === '"') {
        /* quoted cell: keep everything inside, "" means a literal quote */
        var cell = '';
        i++;
        while (i < t.length) {
          if (t.charAt(i) === '"') {
            if (t.charAt(i + 1) === '"') { cell += '"'; i += 2; continue; }
            i++; break;
          }
          cell += t.charAt(i); i++;
        }
        pushCell(cell);
        continue;
      }

      if (ch === '\r' || ch === '\n') { flushRow(); i++; continue; }
      if (ch === ',' || ch === '\t' || ch === ';') { flushRow(); i++; continue; }

      current += ch;
      i++;
    }
    flushRow();

    return out;
  }

  function searchableOf(row) {
    return row.searchable || normalizeSearch([row.item, row.description, row.upc].join(' '));
  }

  /* -----------------------------------------------------------------
     Look one model number up against the master row set.

     Matching is deliberately STRICT first (normalised whole-value equality)
     and only then relaxed to a word-boundary contains. A plain `indexOf`
     would let HB-2200 match HB-22000 and quietly hand you the wrong UPC,
     which is the one failure mode that actually ships a bad barcode.
     ----------------------------------------------------------------- */
  function matchKey(v) {
    return String(v == null ? '' : v).replace(/[\s-]+/g, '').toLowerCase();
  }

  function findMatches(query) {
    var raw = String(query == null ? '' : query).trim();
    if (!raw) return [];

    var norm = normalizeSearch(raw);
    var key = matchKey(raw);
    var exact = [], boundary = [], loose = [];

    /* word-boundary test on the raw characters, so punctuation survives */
    var esc = raw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    var boundaryRe = new RegExp('(^|[^A-Za-z0-9])' + esc + '([^A-Za-z0-9]|$)', 'i');

    for (var i = 0; i < masterRows.length; i++) {
      var row = masterRows[i];
      var item = String(row.item == null ? '' : row.item);
      var desc = String(row.description == null ? '' : row.description);
      var upc = String(row.upc == null ? '' : row.upc);

      /* 1. the whole value IS the item number / UPC (ignoring case, spaces, dashes) */
      if (key && (matchKey(item) === key || matchKey(upc) === key)) { exact.push(row); continue; }

      /* 2. the value appears as a whole token in the item number */
      if (item && boundaryRe.test(item)) { boundary.push(row); continue; }

      /* 3. the value appears as a whole token in the description, or anywhere
            in the UPC (a digit run inside a UPC is still a useful hit) */
      if (desc && boundaryRe.test(desc)) { boundary.push(row); continue; }
      if (norm && upc && normalizeSearch(upc).indexOf(norm) > -1) { loose.push(row); continue; }

      /* 4. fall back to the original substring behaviour, last resort */
      if (norm && searchableOf(row).indexOf(norm) > -1) loose.push(row);
    }

    if (exact.length) return { rows: exact, how: 'exact' };

    /* a boundary hit is only trustworthy when it is unique — if two rows
       claim it we cannot know which the designer meant */
    if (boundary.length === 1) return { rows: boundary, how: 'boundary' };
    if (boundary.length > 1) return { rows: boundary, how: 'ambiguous' };
    if (loose.length) return { rows: loose, how: 'partial' };
    return { rows: [], how: 'none' };
  }

  /* Rows produced by the last paste lookup, in pasted order. */
  var lookupResults = [];

  function renderLookupResults() {
    var body = $('lookupBody');
    var wrap = $('lookupWrap');
    body.innerHTML = '';

    if (!lookupResults.length) {
      wrap.style.display = 'none';
      $('addFoundBtn').disabled = true;
      $('addFoundBtn').textContent = 'Add All Found to Export List';
      return;
    }
    wrap.style.display = 'block';

    lookupResults.forEach(function (r, idx) {
      var tr = document.createElement('tr');

      tr.appendChild(cell(r.pasted, 'mono'));

      var tdStatus = document.createElement('td');
      var badge = document.createElement('span');
      badge.className = 'badge ' + r.badgeClass;
      badge.textContent = r.statusText;
      tdStatus.appendChild(badge);
      if (r.how === 'ambiguous') {
        var n = document.createElement('div');
        n.className = 'spec-note warn';
        n.textContent = r.matchCount + ' rows in the master list match this — pick the right one.';
        tdStatus.appendChild(n);
      }
      if (!r.row) {
        var n2 = document.createElement('div');
        n2.className = 'spec-note err';
        n2.textContent = r.hint;
        tdStatus.appendChild(n2);
      }
      tr.appendChild(tdStatus);

      tr.appendChild(cell(r.row ? r.row.item : '—', r.row ? '' : 'small'));
      tr.appendChild(cell(r.row ? r.row.description : '—', r.row ? '' : 'small'));

      var tdUpc = document.createElement('td');
      if (r.row) {
        var code = document.createElement('div');
        code.className = 'code-cell';
        code.textContent = r.row.upc;
        tdUpc.appendChild(code);
        /* validate immediately so a bad GTIN is visible before it is added */
        var chk = B.analyze(r.row.upc, { preferred: 'Auto', autoFixCheck: false });
        var note = document.createElement('div');
        note.className = 'spec-note' + (chk.ok ? '' : ' err');
        note.textContent = chk.ok
          ? (chk.symbology + ' · ' + B.statusLabel(chk))
          : 'Not encodable as a GTIN';
        tdUpc.appendChild(note);
      } else {
        tdUpc.textContent = '—';
        tdUpc.className = 'small';
      }
      tr.appendChild(tdUpc);

      var tdAct = document.createElement('td');
      tdAct.className = 'actions';
      if (r.row) {
        var btn = document.createElement('button');
        btn.className = 'good';
        btn.textContent = 'Add';
        btn.addEventListener('click', function () { addLookupRow(idx); });
        tdAct.appendChild(btn);
      }
      tr.appendChild(tdAct);

      body.appendChild(tr);
    });

    var found = lookupResults.filter(function (r) { return r.row; }).length;
    $('addFoundBtn').disabled = found === 0;
    $('addFoundBtn').textContent = 'Add All Found to Export List (' + found + ')';
  }

  function cell(text, cls) {
    var td = document.createElement('td');
    td.textContent = text == null ? '' : text;
    if (cls) td.className = cls;
    return td;
  }

  async function lookupPasted() {
    var raw = $('pasteInput').value;
    var list = parsePastedList(raw);

    if (!list.length) {
      $('lookupStatus').innerHTML = '<strong>Nothing to look up.</strong> Type a model number or paste a column.';
      lookupResults = [];
      renderLookupResults();
      return;
    }
    if (!masterRows.length) {
      alert('Please upload the master CSV first — without it there is nothing to look up.');
      return;
    }

    if (list.length > 500) {
      /* keep the browser responsive; the tail is reported rather than dropped silently */
      var dropped = list.length - 500;
      list = list.slice(0, 500);
      var note = ' Only the first 500 were looked up (' + dropped + ' ignored).';
    }

    lookupResults = list.map(function (pasted) {
      var m = findMatches(pasted);
      if (!m.rows.length) {
        return {
          pasted: pasted, row: null, how: 'none',
          statusText: 'NOT FOUND', badgeClass: 'missing',
          hint: 'Not in the master list — check the spelling, or it may be a new item.'
        };
      }
      var how = m.how;
      var rows = m.rows;
      if (how === 'exact') {
        return { pasted: pasted, row: rows[0], how: how, statusText: 'FOUND', badgeClass: 'found',
                 hint: '' };
      }
      if (how === 'ambiguous') {
        /* do NOT auto-add: two matches means we cannot know which is right */
        return { pasted: pasted, row: null, how: how, matchCount: rows.length,
                 statusText: 'AMBIGUOUS', badgeClass: 'alt', hint: 'Not added automatically.' };
      }
      if (how === 'boundary') {
        return { pasted: pasted, row: rows[0], how: how, statusText: 'FOUND', badgeClass: 'found',
                 hint: '' };
      }
      /* partial: surfaced but explicitly not auto-addable */
      return { pasted: pasted, row: null, how: how, matchCount: rows.length,
               statusText: 'PARTIAL MATCH', badgeClass: 'alt',
               hint: rows.length + ' loose match(es) — not added automatically. Put the exact model number in the box on its own.' };
    });

    renderLookupResults();

    var found = lookupResults.filter(function (r) { return r.row; }).length;
    var ambiguous = lookupResults.filter(function (r) { return r.how === 'ambiguous' || r.how === 'partial'; }).length;
    var missing = lookupResults.filter(function (r) { return r.how === 'none'; }).length;

    var html = '<strong>Looked up ' + lookupResults.length +
      (lookupResults.length === 1 ? ' model number' : ' model numbers') + ':</strong> ' +
      found + ' found, ' + missing + ' not in the master list';
    if (ambiguous) html += ', ' + ambiguous + ' needing a decision';
    html += '.';
    if (!found) html += ' Add the master CSV if you have not uploaded it this week.';
    $('lookupStatus').innerHTML = html;
  }

  async function addLookupRow(idx) {
    var r = lookupResults[idx];
    if (!r || !r.row) return;
    var added = addToSavedLocal(r.row);
    renderSaved();
    if (added) await saveSavedRows();
  }

  async function addAllFound() {
    var rows = lookupResults.filter(function (r) { return r.row; });
    if (!rows.length) { alert('No matched rows to add.'); return; }
    var addedCount = 0;
    rows.forEach(function (r) { if (addToSavedLocal(r.row)) addedCount++; });
    renderSaved();
    await saveSavedRows();
    $('lookupStatus').innerHTML = '<strong>Added ' + addedCount + ' row(s)</strong> to the export list' +
      (addedCount < rows.length ? ' (' + (rows.length - addedCount) + ' were already there).' : '.') +
      ' Set your options below, then generate.';
  }

  /* =================================================================
     Weekly reminder (identical to the original tool)
     ================================================================= */
  async function getLastUploadDate() {
    try { return await dbGet('lastUploadDate'); } catch (err) { return null; }
  }

  function startOfCurrentWeekMonday(date) {
    var current = new Date(date);
    current.setHours(0, 0, 0, 0);
    var day = current.getDay();
    current.setDate(current.getDate() + (day === 0 ? -6 : 1 - day));
    return current;
  }

  async function showWeeklyReminder() {
    var reminder = document.getElementById('mondayReminder');
    var lastUploadISO = await getLastUploadDate();
    var mondayStart = startOfCurrentWeekMonday(new Date());

    if (!lastUploadISO) {
      reminder.style.display = 'block';
      reminder.innerHTML = '<strong>Weekly file reminder:</strong> Please upload this week\u2019s newest master CSV before proceeding.';
      return;
    }
    var lastUpload = new Date(lastUploadISO);
    if (lastUpload < mondayStart) {
      reminder.style.display = 'block';
      reminder.innerHTML = '<strong>Weekly file reminder:</strong> Your master CSV was last uploaded on ' +
        lastUpload.toLocaleDateString() + '. Please upload this week\u2019s newest master CSV before proceeding.';
    } else {
      reminder.style.display = 'none';
    }
  }

  /* =================================================================
     Settings
     ================================================================= */
  function $(id) { return document.getElementById(id); }

  function currentSettings() {
    var sel = $('xDimSelect').value;
    var xDim = (sel === 'custom') ? parseFloat($('xDimCustom').value) : parseFloat(sel);
    if (!isFinite(xDim) || xDim <= 0) xDim = B.REF_X;
    xDim = Math.min(0.10, Math.max(0.005, xDim));

    var bh = $('barHeight').value;
    var barHeight = (bh === 'auto') ? null : parseFloat(bh);

    return {
      symbology: $('symPref').value,
      xDim: xDim,
      barHeight: barHeight,
      showText: $('optText').checked,
      includeMeta: $('optCaption').checked,
      bearerBars: $('optBearer').checked,
      autoFixCheck: $('optFix').checked,
      wantSvg: $('outSvg').checked,
      wantPdf: $('outPdf').checked,
      wantPng: $('outPng').checked
    };
  }

  function analyzeRow(row, S) {
    var res = B.analyze(row.upc, { preferred: S.symbology, autoFixCheck: S.autoFixCheck });
    res.item = row.item;
    res.description = row.description;
    res.rowId = row.id;
    if (res.ok) {
      res.geo = B.buildGeometry(res, {
        xDim: S.xDim,
        barHeight: S.barHeight,
        showText: S.showText,
        bearerBars: S.bearerBars,
        padding: 0.02
      });
    }
    return res;
  }

  /* ---- GS1 size linting -------------------------------------------
     Reference bar heights are the GS1 values at 100% magnification and
     they scale with magnification, so the bar-height test is against the
     scaled figure — not a blanket 1 inch, which would wrongly flag a
     standard 100% UPC-A (22.85 mm) as non-compliant. */
  var REF_BAR_H_UPCEAN = 0.8996;   /* 22.85 mm, UPC-A / EAN-13 at 100%  */
  var REF_BAR_H_EAN8   = 0.7240;   /* 18.39 mm, EAN-8 at 100%           */
  var REF_BAR_H_ITF14  = 1.2598;   /* 32 mm, GS1 ITF-14 nominal         */

  function specIssues(geo, S) {
    var issues = [];
    if (!geo) return issues;
    var xmm = geo.xDim * 25.4;   /* inches -> millimetres */

    if (geo.symbology === 'ITF-14') {
      if (xmm < 0.495) issues.push('ITF-14 X-dimension ' + xmm.toFixed(3) + ' mm is below the GS1 minimum of 0.495 mm — scanners may fail.');
      if (xmm > 1.016) issues.push('ITF-14 X-dimension ' + xmm.toFixed(3) + ' mm exceeds the GS1 maximum of 1.016 mm.');
      if (geo.barHeightIn < REF_BAR_H_ITF14 - 1e-6) {
        issues.push('ITF-14 bar height ' + geo.barHeightIn.toFixed(3) + ' in is under the GS1 nominal of ' +
                    REF_BAR_H_ITF14.toFixed(4) + ' in (32 mm).');
      }
    } else {
      var maxX = geo.symbology === 'EAN-8' ? 0.660 : 0.660;
      if (xmm < 0.264) issues.push(geo.symbology + ' X-dimension ' + xmm.toFixed(3) + ' mm is below the GS1 minimum of 0.264 mm.');
      if (xmm > maxX) issues.push(geo.symbology + ' X-dimension ' + xmm.toFixed(3) + ' mm exceeds the GS1 maximum of ' + maxX.toFixed(3) + ' mm.');

      var refH = (geo.symbology === 'EAN-8') ? REF_BAR_H_EAN8 : REF_BAR_H_UPCEAN;
      var expectedH = refH * geo.magnification;
      if (geo.barHeightIn < expectedH - 1e-6) {
        issues.push(geo.symbology + ' bar height ' + geo.barHeightIn.toFixed(3) + ' in is shorter than the GS1 ' +
                    Math.round(geo.magnification * 100) + '% height of ' + expectedH.toFixed(4) + ' in.');
      }

      /* the 2.5:1 limit applies to retail EAN/UPC symbols; ITF-14 cartons
         are legitimately wider, so they are excluded above */
      var ratio = geo.totalWidthIn / geo.totalHeightIn;
      if (ratio > 2.5) issues.push('Symbol is ' + ratio.toFixed(2) + ':1 wide — GS1 asks retail EAN/UPC symbols to stay within 2.5:1.');
      if (ratio < 0.8) issues.push('Symbol is ' + ratio.toFixed(2) + ':1 — quite tall and narrow for retail scanning.');
    }

    return issues;
  }

  /* =================================================================
     Export list rendering with live vector preview
     ================================================================= */
  var previewCache = {};

  function renderSaved() {
    var S = currentSettings();
    var body = $('savedBody');
    body.innerHTML = '';

    if (!savedRows.length) {
      body.innerHTML = '<tr><td colspan="7" class="small">Your export list is empty.</td></tr>';
      $('savedStatus').textContent = 'Saved rows: 0';
      renderSpecWarning([], []);
      return;
    }

    var allIssues = [];
    var brokenRows = [];

    savedRows.forEach(function (row) {
      var res = analyzeRow(row, S);
      var tr = document.createElement('tr');

      /* --- preview cell, rendered straight from the same vector geometry --- */
      var tdPrev = document.createElement('td');
      tdPrev.className = 'preview-cell';
      if (res.ok && res.geo) {
        var px = 300;
        var wPx = Math.max(40, Math.round(res.geo.totalWidthIn * px));
        var hPx = Math.max(20, Math.round(res.geo.totalHeightIn * px));
        var key = [res.geo.code, res.geo.symbology, res.geo.xDim, S.showText, S.bearerBars, wPx, hPx].join('|');
        var svg;
        if (previewCache[key]) { svg = previewCache[key]; }
        else {
          svg = X.buildSVG(res.geo, {}, { noIds: true, raster: { w: wPx, h: hPx } });
          previewCache[key] = svg;
        }
        tdPrev.innerHTML = svg;
      } else {
        var span = document.createElement('span');
        span.className = 'no-prev';
        span.textContent = 'no code';
        tdPrev.appendChild(span);
      }
      tr.appendChild(tdPrev);

      /* --- model --- */
      var tdItem = document.createElement('td');
      tdItem.textContent = row.item;
      var note = document.createElement('div');
      note.className = 'spec-note';
      note.textContent = res.ok ? B.makeBaseName(row.item, res.code) : '';
      tdItem.appendChild(note);
      tr.appendChild(tdItem);

      /* --- description --- */
      var tdDesc = document.createElement('td');
      tdDesc.textContent = row.description;
      tr.appendChild(tdDesc);

      /* --- the UPC as entered, plus any correction message --- */
      var tdUpc = document.createElement('td');
      var codeEl = document.createElement('div');
      codeEl.className = 'code-cell';
      codeEl.textContent = row.upc;
      tdUpc.appendChild(codeEl);

      var msgEl = document.createElement('div');
      msgEl.className = 'spec-note' + (res.ok ? (res.status === 'fixed' ? ' warn' : '') : ' err');
      if (!res.ok) {
        msgEl.textContent = res.messages.filter(function (m) { return m.level === 'error'; })
          .map(function (m) { return m.text; }).join(' ') || 'Could not encode.';
      } else if (res.status === 'fixed') {
        msgEl.textContent = 'Corrected to ' + res.code + ' (check digit was ' + res.foundCheck +
          ', should be ' + res.expectedCheck + ').';
      } else if (res.messages.length) {
        msgEl.textContent = res.messages.map(function (m) { return m.text; }).join(' ');
      }
      if (msgEl.textContent) tdUpc.appendChild(msgEl);
      tr.appendChild(tdUpc);

      /* --- symbology --- */
      var tdSym = document.createElement('td');
      if (res.ok) {
        var bdg = document.createElement('span');
        bdg.className = 'badge sym';
        bdg.textContent = res.symbology;
        tdSym.appendChild(bdg);
        var dims = document.createElement('div');
        dims.className = 'spec-note';
        dims.textContent = res.geo.totalWidthIn.toFixed(3) + ' x ' + res.geo.totalHeightIn.toFixed(3) +
          ' in  (' + Math.round(res.geo.magnification * 100) + '%)';
        tdSym.appendChild(dims);
      } else {
        tdSym.innerHTML = '<span class="badge err">n/a</span>';
      }
      tr.appendChild(tdSym);

      /* --- check status --- */
      var tdChk = document.createElement('td');
      var st = document.createElement('span');
      if (!res.ok) { st.className = 'badge err'; st.textContent = 'ERROR'; }
      else if (res.status === 'fixed') { st.className = 'badge fixed'; st.textContent = 'CORRECTED'; }
      else if (res.status === 'warning') { st.className = 'badge fixed'; st.textContent = 'REVIEW'; }
      else { st.className = 'badge ok'; st.textContent = 'VALID'; }
      tdChk.appendChild(st);

      if (res.ok && res.geo) {
        var issues = specIssues(res.geo, S);
        if (issues.length) {
          var iEl = document.createElement('div');
          iEl.className = 'spec-note warn';
          iEl.textContent = issues[0];
          tdChk.appendChild(iEl);
          issues.forEach(function (t) { allIssues.push(t); });
        }
      } else if (!res.ok) {
        /* keep unencodable rows separate from GS1 sizing advice — they are
           two different kinds of problem and must not share a heading */
        brokenRows.push((row.item || '(no model)') + ' — ' +
          (res.messages.filter(function (m) { return m.level === 'error'; })[0] || {}).text);
      }
      tr.appendChild(tdChk);

      /* --- remove --- */
      var tdAction = document.createElement('td');
      tdAction.className = 'actions';
      var btn = document.createElement('button');
      btn.textContent = 'Remove';
      btn.className = 'danger';
      btn.addEventListener('click', async function () {
        var idx = savedRows.indexOf(row);
        if (idx > -1) savedRows.splice(idx, 1);
        renderSaved();
        await saveSavedRows();
      });
      tdAction.appendChild(btn);
      tr.appendChild(tdAction);

      body.appendChild(tr);
    });

    $('savedStatus').textContent = 'Saved rows: ' + savedRows.length.toLocaleString();
    renderSpecWarning(allIssues, brokenRows);
  }

  function renderSpecWarning(issues, brokenRows) {
    var box = $('specWarn');
    brokenRows = brokenRows || [];
    if (!issues.length && !brokenRows.length) { box.style.display = 'none'; box.innerHTML = ''; return; }

    var html = '';
    if (brokenRows.length) {
      html += '<strong>Rows that cannot be encoded (' + brokenRows.length + ')</strong>' +
        '<ul style="margin:6px 0 0 18px;padding:0">' +
        brokenRows.map(function (t) { return '<li>' + escapeHTML(t) + '</li>'; }).join('') +
        '</ul>';
    }
    if (issues.length) {
      var unique = issues.filter(function (v, i) { return issues.indexOf(v) === i; });
      if (brokenRows.length) html += '<div style="height:8px"></div>';
      html += '<strong>GS1 sizing notes (' + unique.length + ')</strong>' +
        '<ul style="margin:6px 0 0 18px;padding:0">' +
        unique.slice(0, 8).map(function (t) { return '<li>' + escapeHTML(t) + '</li>'; }).join('') +
        (unique.length > 8 ? '<li>…and ' + (unique.length - 8) + ' more.</li>' : '') + '</ul>';
    }
    box.style.display = 'block';
    box.innerHTML = html;
  }

  /* =================================================================
     File / download utilities
     ================================================================= */
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

  function svgToPngBytes(svgText, pxW, pxH) {
    return new Promise(function (resolve, reject) {
      /* Use a plain data URL rather than a blob URL: canvas stays untainted
         because the SVG is fully self-contained with no external references. */
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

  /* Build the full set of prepared items from the export list. */
  function prepareItems() {
    var S = currentSettings();
    var items = [], problems = [];

    savedRows.forEach(function (row) {
      var res = analyzeRow(row, S);
      if (!res.ok || !res.geo) {
        problems.push((row.item || '(no model)') + ' — ' +
          (res.messages.filter(function (m) { return m.level === 'error'; })[0] || {}).text);
        return;
      }
      items.push({
        res: res,
        geo: res.geo,
        item: row.item,
        description: row.description,
        upc: row.upc,
        symbology: res.symbology,
        code: res.code,
        xDim: res.geo.xDim,
        magnification: res.geo.magnification,
        base: B.makeBaseName(row.item, res.code)
      });
    });

    /* de-duplicate filenames */
    var seen = {};
    items.forEach(function (it) {
      var name = it.base, n = 2;
      while (seen[name]) { name = it.base + '-' + n; n++; }
      seen[name] = true;
      it.base = name;
    });

    return { items: items, problems: problems, settings: S };
  }

  function setOutputStatus(html, cls) {
    var el = $('outputStatus');
    el.innerHTML = html;
    el.className = 'status' + (cls ? ' ' + cls : '');
  }

  /* =================================================================
     ACTIONS
     ================================================================= */
  async function generateUPCs(quiet) {
    var S = currentSettings();
    if (!savedRows.length) { alert('Your export list is empty. Add rows first.'); return null; }
    if (!S.wantSvg && !S.wantPdf && !S.wantPng) { alert('Tick at least one output file type (SVG, PDF or PNG).'); return null; }

    var prep = prepareItems();
    if (!prep.items.length) {
      if (!quiet) setOutputStatus('<strong>Nothing generated.</strong> No row could be encoded. Fix the errors in the Check column.', 'errortext');
      return null;
    }

    if (!quiet) setOutputStatus('Generating ' + prep.items.length + ' code(s)…');
    var files = [];
    var failed = [];

    for (var i = 0; i < prep.items.length; i++) {
      var it = prep.items[i];
      try {
        var svgText = X.buildSVG(it.geo, { item: it.item, description: it.description },
                                 { includeMeta: S.includeMeta });
        if (S.wantSvg) {
          files.push({ name: it.base + '.svg', bytes: new TextEncoder().encode(svgText) });
        }
        if (S.wantPdf) {
          files.push({
            name: it.base + '.pdf',
            bytes: X.buildItemPDF(it.geo, { item: it.item, description: it.description },
                                  { includeMeta: S.includeMeta, margin: 0.25 })
          });
        }
        if (S.wantPng) {
          var pxW = Math.max(60, Math.round(it.geo.totalWidthIn * 300));
          var pxH = Math.max(40, Math.round(it.geo.totalHeightIn * 300));
          var rasterSvg = X.buildSVG(it.geo, { item: it.item, description: it.description },
                                     { noIds: true, raster: { w: pxW, h: pxH } });
          files.push({ name: it.base + '.png', bytes: await svgToPngBytes(rasterSvg, pxW, pxH) });
        }
      } catch (err) {
        console.error('Failed for', it.item, err);
        failed.push(it.item || it.code);
      }
      if (!quiet && i % 5 === 4) setOutputStatus('Generating… ' + (i + 1) + ' of ' + prep.items.length);
    }

    var readme = buildReadme(prep.items, prep.problems);
    files.push({ name: '00_README.txt', bytes: new TextEncoder().encode(readme) });

    var zipBytes = X.buildZip(files);
    var stamp = new Date().toISOString().slice(0, 10);
    saveBlob(new Blob([zipBytes], { type: 'application/zip' }),
             'lifeworks_upc_package_' + stamp + '.zip');

    var msg = '<strong>Generated ' + prep.items.length + ' item(s) → ' + files.length +
      ' file(s)</strong> in one ZIP, each named MODELNUMBER_UPC. Each SVG/PDF is true vector at the exact physical size.';
    if (prep.problems.length) {
      msg += '<br>Skipped: ' + prep.problems.map(escapeHTML).join(' · ');
    }
    if (failed.length) msg += '<br>Failed: ' + escapeHTML(failed.join(', '));
    if (!quiet) setOutputStatus(msg, prep.problems.length ? 'errortext' : 'goodtext');

    return { items: prep.items.length, files: files.length,
             problems: prep.problems, failed: failed };
  }

  /* =================================================================
     NOTE: there is intentionally NO "Generate Everything" action.
     ----------------------------------------------------------------
     It existed and was removed on request. The two deliverables are
     now produced by their own buttons only: "Generate UPCs only" and
     "Generate 2D GS1 Digital Link Codes only". Each writes one ZIP and
     both are still named MODELNUMBER_UPC / ..._GS1-DIGITAL-LINK so the
     two kinds can never be confused.
     ================================================================= */

  function buildReadme(items, problems) {
    var lines = [];
    lines.push('LIFE WORKS UPC GENERATOR \u2014 EXPORT PACKAGE');
    lines.push('Generated: ' + new Date().toLocaleString());
    lines.push('');
    lines.push('FILES ARE NAMED:  MODELNUMBER_UPC');
    lines.push('  e.g.  HB-2200_859999001234.svg');
    lines.push('');
    lines.push('SVG per item: true vector, opens in Adobe Illustrator as a text + frame,');
    lines.push('             with the bars as one clean compound path.');
    lines.push('PDF per item: true vector, page is sized to the exact physical barcode.');
    lines.push('PNG per item: 300 dpi raster, for docs and email.');
    lines.push('');
    lines.push('IMPORTANT \u2014 PRINTING AND PLACING');
    lines.push('  Never scale a barcode by eye. Check the printed width against the');
    lines.push('  "X-dim" value listed below, or use the Print Sheet file which is');
    lines.push('  already laid out at actual size. Browsers cannot Write an Adobe .ai');
    lines.push('  file; open the SVG in Illustrator and Save As .ai if you need one.');
    lines.push('');
    lines.push('--------------------------------------------------------------------');
    lines.push('ITEM                 SYMBOLOGY  GTIN            X-DIM(in)  MAG   SYMBOL W x H (in)');

    items.forEach(function (it) {
      function pad(v, n) { var s = String(v == null ? '' : v); while (s.length < n) s += ' '; return s.slice(0, n); }
      lines.push(
        pad(it.item || '(no model)', 20) + ' ' +
        pad(it.symbology, 10) + ' ' +
        pad(it.code, 15) + ' ' +
        pad(it.xDim.toFixed(4), 9) + ' ' +
        pad(Math.round(it.magnification * 100) + '%', 5) + ' ' +
        it.geo.symbolWidthIn.toFixed(4) + ' x ' + it.geo.barHeightIn.toFixed(4)
      );
    });

    if (problems.length) {
      lines.push('');
      lines.push('SKIPPED ROWS (could not be encoded):');
      problems.forEach(function (p) { lines.push('  - ' + p); });
    }

    lines.push('');
    lines.push('X-dimension is the width of one narrow bar. GS1 permits 0.264-0.660 mm');
    lines.push('(0.0104-0.0260 in) for UPC-A / EAN-13 retail symbols and expects a');
    lines.push('minimum 1.00 in bar height. ITF-14 cartons run 0.495-1.016 mm X-dim.');
    return lines.join('\n');
  }

  function downloadMergedPDF() {
    var prep = prepareItems();
    if (!prep.items.length) { alert('Nothing to export. Add at least one valid row.'); return; }
    var bytes = X.buildMergedPDF(prep.items.map(function (it) {
      return { geo: it.geo, item: it.item, description: it.description };
    }), { includeMeta: prep.settings.includeMeta, margin: 0.35 });
    saveBlob(new Blob([bytes], { type: 'application/pdf' }),
             'lifeworks_upc_all_' + prep.items.length + '_items.pdf');
    setOutputStatus('<strong>Merged PDF ready:</strong> ' + prep.items.length +
      ' page(s), one barcode per page, each page sized to its true physical dimensions.', 'goodtext');
  }

  function downloadPrintSheet() {
    var prep = prepareItems();
    if (!prep.items.length) { alert('Nothing to print. Add at least one valid row.'); return; }
    var bytes = X.buildPrintSheet(prep.items.map(function (it) {
      return { geo: it.geo, item: it.item, description: it.description, xDim: it.xDim };
    }), { pageWidth: 8.5, pageHeight: 11, margin: 0.5 });
    saveBlob(new Blob([bytes], { type: 'application/pdf' }), 'lifeworks_upc_print_sheet.pdf');
    setOutputStatus('<strong>Print sheet ready:</strong> laid out at actual size on Letter pages. ' +
      'In the print dialog choose <em>Actual size</em> (100%) and turn OFF "fit to page", or the codes will be scaled and unscannable.', 'goodtext');
  }

  function downloadExportCSV() {
    if (!savedRows.length) { alert('Your export list is empty.'); return; }
    var csv = 'Item Number,Description,GTIN - Single Pack UPC\n';
    savedRows.forEach(function (row) {
      csv += [X.csvEscape(row.item), X.csvEscape(row.description), X.csvEscape(row.upc)].join(',') + '\n';
    });
    /* BOM so Excel opens the accented characters cleanly */
    saveBlob(new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' }), 'lifeworks_upc_export_list.csv');
    setOutputStatus('<strong>Export CSV ready.</strong>', 'goodtext');
  }

  function downloadSpecCSV() {
    var prep = prepareItems();
    if (!prep.items.length) { alert('Nothing to export. Add at least one valid row.'); return; }
    var head = ['Item / Model', 'Description', 'UPC as entered', 'Symbology', 'GTIN encoded',
                'Check digit status', 'X-dimension (in)', 'X-dimension (mm)', 'Magnification',
                'Symbol width (in)', 'Bar height (in)', 'Total size (in)', 'Filename base'];
    var rows = [head];
    prep.items.forEach(function (it) {
      rows.push([
        it.item, it.description, it.upc, it.symbology, it.code,
        it.res.status === 'fixed' ? 'CORRECTED (was ' + it.res.foundCheck + ')' : 'Valid',
        it.xDim.toFixed(4), (it.xDim * 25.4).toFixed(3),
        Math.round(it.magnification * 100) + '%',
        it.geo.symbolWidthIn.toFixed(4), it.geo.barHeightIn.toFixed(4),
        it.geo.totalWidthIn.toFixed(4) + ' x ' + it.geo.totalHeightIn.toFixed(4),
        it.base
      ]);
    });
    prep.problems.forEach(function (p) { rows.push(['SKIPPED', p, '', '', '', '', '', '', '', '', '', '', '']); });

    var csv = rows.map(function (r) {
      return r.map(function (c) { return X.csvEscape(c); }).join(',');
    }).join('\n') + '\n';
    saveBlob(new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' }), 'lifeworks_upc_spec_sheet.csv');
    setOutputStatus('<strong>Spec sheet ready:</strong> ' + prep.items.length + ' row(s) with exact physical dimensions for your packaging specs.', 'goodtext');
  }

  /* =================================================================
     Wire up + init
     ================================================================= */
  function wire() {
    $('deleteMasterBtn').addEventListener('click', clearMaster);
    $('manualAddBtn').addEventListener('click', addManual);
    $('clearSavedBtn').addEventListener('click', clearSaved);

    /* one box: type a single model number or paste a whole column */
    $('lookupBtn').addEventListener('click', lookupPasted);
    $('clearPasteBtn').addEventListener('click', clearPaste);
    $('addFoundBtn').addEventListener('click', addAllFound);
    $('pasteInput').addEventListener('input', updatePasteCount);
    $('pasteInput').addEventListener('paste', function () {
      /* the paste lands after this event, so read the count on the next tick */
      setTimeout(updatePasteCount, 0);
    });
    $('pasteInput').addEventListener('keydown', function (event) {
      /* Ctrl / Cmd + Enter runs the lookup; plain Enter adds a newline so a
         multi-line paste is never accidentally submitted */
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
        event.preventDefault();
        lookupPasted();
      }
    });

    $('generateBtn').addEventListener('click', function () { generateUPCs(false); });
    $('mergedPdfBtn').addEventListener('click', downloadMergedPDF);
    $('printSheetBtn').addEventListener('click', downloadPrintSheet);
    $('csvBtn').addEventListener('click', downloadExportCSV);
    $('specCsvBtn').addEventListener('click', downloadSpecCSV);

    $('csvFile').addEventListener('change', async function (event) {
      if (event.target.files[0]) await uploadMaster();
    });

    /* setting changes re-render the live previews */
    ['symPref', 'xDimSelect', 'barHeight', 'optText', 'optCaption', 'optBearer', 'optFix']
      .forEach(function (id) {
        $(id).addEventListener('change', function () {
          previewCache = {};
          renderSaved();
        });
      });

    $('xDimSelect').addEventListener('change', function () {
      $('customXWrap').style.display = ($('xDimSelect').value === 'custom') ? 'flex' : 'none';
    });

    $('xDimCustom').addEventListener('input', function () {
      previewCache = {};
      renderSaved();
    });

    $('optCaption').addEventListener('change', function () {
      previewCache = {};
      renderSaved();
    });

    /* the buttons state what they will actually produce, so a designer who
       unticked PDF is never told they got a PDF */
    ['outSvg', 'outPdf', 'outPng'].forEach(function (id) {
      if ($(id)) $(id).addEventListener('change', updateGenerateLabels);
    });
    updateGenerateLabels();
  }

  function selectedOutputs() {
    var out = [];
    if ($('outSvg') && $('outSvg').checked) out.push('SVG');
    if ($('outPdf') && $('outPdf').checked) out.push('PDF');
    if ($('outPng') && $('outPng').checked) out.push('PNG');
    return out;
  }

  function updateGenerateLabels() {
    var out = selectedOutputs();
    var list = out.length === 1 ? out[0] : (out.length ? out.slice(0, -1).join(' + ') + ' + ' + out[out.length - 1] : 'nothing');
    var g = $('generateBtn');
    if (g) g.textContent = 'Generate UPCs only (' + list + ', named MODEL_UPC)';
  }

  async function init() {
    wire();

    /* expose the export list and helpers so the QR batch module can reuse the
       same rows and the same filename rules without duplicating state */
    LW.__getSavedRows = function () { return savedRows; };
    LW.__parsePastedList = parsePastedList;
    LW.__findMatches = findMatches;
    LW.__renderSaved = renderSaved;
    LW.__saveSavedRows = saveSavedRows;

    try {
      db = await openDB();
      masterRows = (await dbGet('masterRows')) || [];
      savedRows = (await dbGet('savedRows')) || [];
    } catch (err) {
      console.warn('IndexedDB unavailable, running in-memory only.', err);
      masterRows = []; savedRows = [];
    }

    masterRows = masterRows.map(function (row) {
      if (!row.searchable) row.searchable = normalizeSearch([row.item, row.description, row.upc].join(' '));
      return row;
    });

    updateCounts();
    renderSaved();
    renderResults();
    await showWeeklyReminder();

    if (masterRows.length) {
      var lastUploadISO = await getLastUploadDate();
      var dateText = lastUploadISO ? ' Last uploaded: ' + new Date(lastUploadISO).toLocaleDateString() + '.' : '';
      setUploadStatus('<strong>Master restored:</strong> ' + masterRows.length.toLocaleString() +
        ' rows loaded from this browser.' + dateText, true);
    }
  }

  init();
})();
