/* ════════════════════════════════════════════════════════════════
   financien.js — persoonlijke financiële administratie
   ----------------------------------------------------------------
   Alles draait LOKAAL in de browser. Er wordt niets naar een server
   gestuurd. Categorie-regels en "eigen rekening"-markeringen worden
   optioneel bewaard in localStorage van dit apparaat; de transacties
   zelf worden standaard NIET bewaard, tenzij je dat expliciet aanzet.
   ════════════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  var LS_RULES = 'fin-categorie-regels-v1';
  var LS_OWN = 'fin-eigen-rekeningen-v1';
  var LS_PERSIST_TX = 'fin-bewaar-transacties-v1';
  var LS_TX = 'fin-transacties-v1';

  var DEFAULT_RULES = [
    { kw: 'ALBERT HEIJN', cat: 'Boodschappen' },
    { kw: 'JUMBO', cat: 'Boodschappen' },
    { kw: 'LIDL', cat: 'Boodschappen' },
    { kw: 'ALDI', cat: 'Boodschappen' },
    { kw: 'PLUS ', cat: 'Boodschappen' },
    { kw: 'SPAR', cat: 'Boodschappen' },
    { kw: 'DIRK', cat: 'Boodschappen' },
    { kw: 'COOP', cat: 'Boodschappen' },
    { kw: 'BUDGET ENERGIE', cat: 'Vaste lasten - energie' },
    { kw: 'ENECO', cat: 'Vaste lasten - energie' },
    { kw: 'ESSENT', cat: 'Vaste lasten - energie' },
    { kw: 'VATTENFALL', cat: 'Vaste lasten - energie' },
    { kw: 'GREENCHOICE', cat: 'Vaste lasten - energie' },
    { kw: 'ODIDO', cat: 'Vaste lasten - telecom' },
    { kw: 'KPN', cat: 'Vaste lasten - telecom' },
    { kw: 'VODAFONE', cat: 'Vaste lasten - telecom' },
    { kw: 'T-MOBILE', cat: 'Vaste lasten - telecom' },
    { kw: 'TELE2', cat: 'Vaste lasten - telecom' },
    { kw: 'SIMYO', cat: 'Vaste lasten - telecom' },
    { kw: 'ZORG EN ZEKERHEID', cat: 'Vaste lasten - zorgverzekering' },
    { kw: 'ZILVEREN KRUIS', cat: 'Vaste lasten - zorgverzekering' },
    { kw: 'VGZ', cat: 'Vaste lasten - zorgverzekering' },
    { kw: 'MENZIS', cat: 'Vaste lasten - zorgverzekering' },
    { kw: 'INDEPENDER', cat: 'Vaste lasten - verzekering' },
    { kw: 'INTERPOLIS', cat: 'Vaste lasten - verzekering' },
    { kw: 'CENTRAAL BEHEER', cat: 'Vaste lasten - verzekering' },
    { kw: 'BELASTINGDIENST', cat: 'Belastingdienst' },
    { kw: 'NETFLIX', cat: 'Abonnementen' },
    { kw: 'SPOTIFY', cat: 'Abonnementen' },
    { kw: 'VIDEOLAND', cat: 'Abonnementen' },
    { kw: 'DISNEY', cat: 'Abonnementen' },
    { kw: 'BITVAVO', cat: 'Beleggen' },
    { kw: 'KRAKEN', cat: 'Beleggen' },
    { kw: 'DEGIRO', cat: 'Beleggen' },
    { kw: 'BINANCE', cat: 'Beleggen' },
    { kw: 'EFF.NOTA', cat: 'Beleggen' },
    { kw: 'EFF.NOTA', cat: 'Beleggen' },
    { kw: 'TIKKIE', cat: 'Overboeking (Tikkie)' },
    { kw: 'SWAPFIETS', cat: 'Vervoer' },
    { kw: 'SHELL', cat: 'Auto - brandstof' },
    { kw: 'ESSO', cat: 'Auto - brandstof' },
    { kw: 'TANGO', cat: 'Auto - brandstof' },
    { kw: 'HUUR', cat: 'Vaste lasten - huur' }
  ];

  var state = {
    transactions: [], // {id, date, amount, counterparty, description, source, ownKey}
    ownKeys: {},      // key -> true  (gemarkeerd als eigen rekening / intern)
    rules: []
  };

  // ---------- opslag ----------
  function loadJSON(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) { return fallback; }
  }
  function saveJSON(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) {}
  }

  function loadRules() {
    var stored = loadJSON(LS_RULES, null);
    state.rules = stored && stored.length ? stored : DEFAULT_RULES.slice();
  }
  function saveRules() { saveJSON(LS_RULES, state.rules); }

  function loadOwnKeys() { state.ownKeys = loadJSON(LS_OWN, {}); }
  function saveOwnKeys() { saveJSON(LS_OWN, state.ownKeys); }

  function persistEnabled() { return localStorage.getItem(LS_PERSIST_TX) === '1'; }
  function loadPersistedTx() {
    if (persistEnabled()) {
      var tx = loadJSON(LS_TX, []);
      if (tx.length) state.transactions = tx;
    }
  }
  function maybePersistTx() {
    if (persistEnabled()) saveJSON(LS_TX, state.transactions);
  }

  // ---------- csv parsing ----------
  function parseCSVLines(text) {
    // eenvoudige RFC4180-achtige parser: komma's, quotes, escaped quotes ("")
    var rows = [];
    var row = [];
    var field = '';
    var inQuotes = false;
    for (var i = 0; i < text.length; i++) {
      var c = text[i];
      if (inQuotes) {
        if (c === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; }
          else { inQuotes = false; }
        } else field += c;
      } else {
        if (c === '"') inQuotes = true;
        else if (c === ',') { row.push(field); field = ''; }
        else if (c === '\r') { /* skip */ }
        else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
        else field += c;
      }
    }
    if (field.length || row.length) { row.push(field); rows.push(row); }
    return rows.filter(function (r) { return r.length > 1 || (r.length === 1 && r[0] !== ''); });
  }

  function rowsToObjects(rows) {
    var header = rows[0];
    return rows.slice(1).map(function (r) {
      var o = {};
      header.forEach(function (h, idx) { o[h.trim()] = (r[idx] || '').trim(); });
      return o;
    });
  }

  function parseRaboAmount(s) {
    return parseFloat(s.replace(/\./g, '').replace(',', '.').replace('+', ''));
  }

  function detectFormat(headerLine) {
    if (headerLine.indexOf('IBAN/BBAN') !== -1 && headerLine.indexOf('Tegenrekening') !== -1) return 'rabobank';
    if (headerLine.indexOf('Startdatum') !== -1 && headerLine.indexOf('Beschrijving') !== -1) return 'revolut';
    return null;
  }

  function idFor(t) {
    return [t.date, t.amount, t.counterparty, t.description].join('|');
  }

  function parseFile(text, filename) {
    var firstLine = text.split(/\r?\n/, 1)[0];
    var fmt = detectFormat(firstLine);
    if (!fmt) {
      throw new Error('Onherkend CSV-formaat in ' + filename + ' (verwacht een Rabobank- of Revolut-export).');
    }
    var rows = parseCSVLines(text);
    var objs = rowsToObjects(rows);
    var out = [];
    if (fmt === 'rabobank') {
      objs.forEach(function (o) {
        if (!o['Bedrag']) return;
        var t = {
          date: o['Datum'],
          amount: parseRaboAmount(o['Bedrag']),
          counterparty: (o['Naam tegenpartij'] || '').trim() || (o['Omschrijving-1'] || '').slice(0, 40).trim(),
          description: [o['Omschrijving-1'], o['Omschrijving-2']].join(' ').trim(),
          source: 'Rabobank',
          ownRefIban: o['Tegenrekening IBAN/BBAN'] || ''
        };
        // Alleen een IBAN is betrouwbaar genoeg als "eigen rekening"-kandidaat:
        // bij pinbetalingen is de tegenrekening leeg en zou de naam van de winkel
        // anders ook als kandidaat verschijnen.
        t.ownKeyCandidates = t.ownRefIban ? [t.ownRefIban] : [];
        t.id = idFor(t);
        out.push(t);
      });
    } else {
      objs.forEach(function (o) {
        if (!o['Bedrag'] || !o['Type']) return;
        if (o['Status'] === 'IN BEHANDELING') { /* nog niet definitief, toch meenemen maar gemarkeerd */ }
        var t = {
          date: (o['Startdatum'] || '').slice(0, 10),
          amount: parseFloat(o['Bedrag']),
          counterparty: (o['Beschrijving'] || '').trim(),
          description: o['Type'] + (o['Status'] === 'IN BEHANDELING' ? ' (in behandeling)' : ''),
          source: 'Revolut',
          ownRefIban: ''
        };
        t.ownKeyCandidates = [t.counterparty];
        t.id = idFor(t);
        out.push(t);
      });
    }
    return out;
  }

  // ---------- categorisatie ----------
  function categoryFor(t) {
    if (isOwn(t)) return '__intern__';
    var hay = (t.counterparty + ' ' + t.description).toUpperCase();
    for (var i = 0; i < state.rules.length; i++) {
      if (hay.indexOf(state.rules[i].kw.toUpperCase()) !== -1) return state.rules[i].cat;
    }
    return t.amount >= 0 ? 'Inkomsten - nog te categoriseren' : 'Uitgaven - nog te categoriseren';
  }

  function ownKeyList(t) {
    return t.ownKeyCandidates || [];
  }
  function isOwn(t) {
    return ownKeyList(t).some(function (k) { return state.ownKeys[k]; });
  }

  // ---------- rendering ----------
  var $ = function (sel) { return document.querySelector(sel); };
  var fmtEUR = function (n) {
    var s = Math.abs(n).toLocaleString('nl-NL', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return (n < 0 ? '-' : '') + '€' + s;
  };

  function render() {
    renderOwnAccountsPanel();
    renderRulesPanel();
    renderDashboard();
    renderTable();
  }

  function collectUnknownCounterparties() {
    var seen = {};
    state.transactions.forEach(function (t) {
      ownKeyList(t).forEach(function (k) {
        if (!seen[k]) seen[k] = { key: k, count: 0, example: t.counterparty };
        seen[k].count++;
      });
    });
    return Object.keys(seen).map(function (k) { return seen[k]; }).sort(function (a, b) { return b.count - a.count; });
  }

  function renderOwnAccountsPanel() {
    var el = $('#own-accounts');
    if (!el) return;
    var items = collectUnknownCounterparties();
    if (!items.length) {
      el.innerHTML = '<div class="empty">Nog geen data geïmporteerd.</div>';
      return;
    }
    el.innerHTML = items.map(function (it) {
      var checked = state.ownKeys[it.key] ? 'checked' : '';
      var label = it.example && it.example !== it.key ? it.key + '  —  ' + it.example : it.key;
      return '<label class="rule-row" style="display:flex;gap:8px;align-items:center;padding:3px 0;">' +
        '<input type="checkbox" data-ownkey="' + escapeAttr(it.key) + '" ' + checked + ' />' +
        '<span style="flex:1;">' + escapeHtml(label) + '</span>' +
        '<span class="tag muted">' + it.count + 'x</span>' +
        '</label>';
    }).join('');
  }

  function renderRulesPanel() {
    var el = $('#rules-list');
    if (!el) return;
    el.innerHTML = state.rules.map(function (r, idx) {
      return '<div class="rule-row">' +
        '<input data-rule-kw="' + idx + '" value="' + escapeAttr(r.kw) + '" placeholder="trefwoord" />' +
        '<input data-rule-cat="' + idx + '" value="' + escapeAttr(r.cat) + '" placeholder="categorie" />' +
        '<button class="secondary" data-rule-del="' + idx + '">×</button>' +
        '</div>';
    }).join('');
  }

  function computeCategorized() {
    return state.transactions.map(function (t) {
      return Object.assign({}, t, { category: categoryFor(t) });
    });
  }

  function renderDashboard() {
    var dash = $('#dashboard');
    if (!dash) return;
    var tx = computeCategorized();
    if (!tx.length) {
      dash.innerHTML = '<div class="empty">Upload een CSV-export om te beginnen.</div>';
      $('#cat-table-wrap').innerHTML = '';
      $('#month-chart').innerHTML = '';
      return;
    }
    var real = tx.filter(function (t) { return t.category !== '__intern__'; });
    var income = real.filter(function (t) { return t.amount > 0; }).reduce(function (s, t) { return s + t.amount; }, 0);
    var expense = real.filter(function (t) { return t.amount < 0; }).reduce(function (s, t) { return s + t.amount; }, 0);
    var invest = real.filter(function (t) { return t.category === 'Beleggen'; }).reduce(function (s, t) { return s + t.amount; }, 0);

    dash.innerHTML =
      '<div class="cards">' +
      card('Inkomsten', income, 'pos') +
      card('Uitgaven', expense, 'neg') +
      card('Netto', income + expense, (income + expense) >= 0 ? 'pos' : 'neg') +
      card('Waarvan beleggen', invest, invest >= 0 ? 'pos' : 'neg') +
      '</div>';

    // categorie-tabel
    var byCat = {};
    real.forEach(function (t) {
      byCat[t.category] = byCat[t.category] || { sum: 0, count: 0 };
      byCat[t.category].sum += t.amount;
      byCat[t.category].count++;
    });
    var rows = Object.keys(byCat).map(function (k) { return { cat: k, sum: byCat[k].sum, count: byCat[k].count }; });
    rows.sort(function (a, b) { return Math.abs(b.sum) - Math.abs(a.sum); });
    $('#cat-table-wrap').innerHTML =
      '<table><thead><tr><th>Categorie</th><th style="text-align:right">Bedrag</th><th style="text-align:right">#</th></tr></thead><tbody>' +
      rows.map(function (r) {
        return '<tr><td>' + escapeHtml(r.cat) + '</td>' +
          '<td class="amt ' + (r.sum >= 0 ? 'pos' : 'neg') + '">' + fmtEUR(r.sum) + '</td>' +
          '<td class="amt">' + r.count + '</td></tr>';
      }).join('') + '</tbody></table>';

    // per maand
    var byMonth = {};
    real.forEach(function (t) {
      var m = t.date.slice(0, 7);
      byMonth[m] = byMonth[m] || { in: 0, out: 0 };
      if (t.amount > 0) byMonth[m].in += t.amount; else byMonth[m].out += t.amount;
    });
    var months = Object.keys(byMonth).sort();
    var maxAbs = Math.max.apply(null, months.map(function (m) { return Math.max(byMonth[m].in, Math.abs(byMonth[m].out)); }).concat([1]));
    $('#month-chart').innerHTML = months.map(function (m) {
      var d = byMonth[m];
      var inPct = (d.in / maxAbs * 100).toFixed(1);
      var outPct = (Math.abs(d.out) / maxAbs * 100).toFixed(1);
      return '<div class="bar-row"><span class="lbl">' + m + '</span>' +
        '<div class="bar-track"><div class="bar-in" style="width:' + inPct + '%"></div></div>' +
        '<span class="val pos">' + fmtEUR(d.in) + '</span></div>' +
        '<div class="bar-row"><span class="lbl"></span>' +
        '<div class="bar-track"><div class="bar-out" style="width:' + outPct + '%"></div></div>' +
        '<span class="val neg">' + fmtEUR(d.out) + '</span></div>';
    }).join('');
  }

  function card(label, val, cls) {
    return '<div class="card"><div class="label">' + label + '</div><div class="value ' + cls + '">' + fmtEUR(val) + '</div></div>';
  }

  var tableFilter = { cat: '', q: '', sortKey: 'date', sortDir: -1 };

  function renderTable() {
    var wrap = $('#tx-table-wrap');
    if (!wrap) return;
    var tx = computeCategorized();
    var cats = Array.from(new Set(tx.map(function (t) { return t.category; }))).sort();
    var filterSel = $('#filter-cat');
    if (filterSel && filterSel.dataset.built !== '1') {
      filterSel.innerHTML = '<option value="">Alle categorieën</option>' +
        cats.map(function (c) { return '<option value="' + escapeAttr(c) + '">' + escapeHtml(c) + '</option>'; }).join('');
      filterSel.dataset.built = '1';
    }

    var filtered = tx.filter(function (t) {
      if (tableFilter.cat && t.category !== tableFilter.cat) return false;
      if (tableFilter.q) {
        var hay = (t.counterparty + ' ' + t.description).toLowerCase();
        if (hay.indexOf(tableFilter.q.toLowerCase()) === -1) return false;
      }
      return true;
    });
    filtered.sort(function (a, b) {
      var k = tableFilter.sortKey;
      if (a[k] < b[k]) return -1 * tableFilter.sortDir;
      if (a[k] > b[k]) return 1 * tableFilter.sortDir;
      return 0;
    });

    var MAX_ROWS = 500;
    var shown = filtered.slice(0, MAX_ROWS);

    wrap.innerHTML = '<table><thead><tr>' +
      '<th data-sort="date">Datum</th>' +
      '<th data-sort="amount" style="text-align:right">Bedrag</th>' +
      '<th data-sort="counterparty">Tegenpartij</th>' +
      '<th>Omschrijving</th>' +
      '<th>Categorie</th>' +
      '</tr></thead><tbody>' +
      shown.map(function (t) {
        var catOptions = ['__intern__'].concat(state.rules.map(function (r) { return r.cat; }))
          .concat(['Inkomsten - nog te categoriseren', 'Uitgaven - nog te categoriseren']);
        catOptions = Array.from(new Set(catOptions));
        return '<tr>' +
          '<td>' + t.date + '</td>' +
          '<td class="amt ' + (t.amount >= 0 ? 'pos' : 'neg') + '">' + fmtEUR(t.amount) + '</td>' +
          '<td>' + escapeHtml(t.counterparty) + '</td>' +
          '<td class="desc">' + escapeHtml(t.description) + '</td>' +
          '<td>' + escapeHtml(t.category) + '</td>' +
          '</tr>';
      }).join('') + '</tbody></table>' +
      (filtered.length > MAX_ROWS ? '<div class="sub">+ ' + (filtered.length - MAX_ROWS) + ' meer, gebruik het zoekveld om te filteren.</div>' : '');
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function escapeAttr(s) { return escapeHtml(s); }

  // ---------- export ----------
  function exportCSV() {
    var tx = computeCategorized();
    var lines = ['Datum,Bedrag,Categorie,Tegenpartij,Omschrijving,Bron'];
    tx.forEach(function (t) {
      lines.push([t.date, t.amount.toFixed(2), t.category, t.counterparty, t.description, t.source]
        .map(function (v) { return '"' + String(v).replace(/"/g, '""') + '"'; }).join(','));
    });
    downloadText(lines.join('\n'), 'administratie-export.csv', 'text/csv');
  }

  function downloadText(text, filename, mime) {
    var blob = new Blob([text], { type: mime + ';charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // ---------- bestanden inlezen ----------
  function readFileAsText(file, cb) {
    var reader = new FileReader();
    reader.onload = function () {
      var buf = reader.result;
      var sniff = new TextDecoder('utf-8').decode(buf.slice(0, 400));
      var enc = sniff.indexOf('IBAN/BBAN') !== -1 ? 'windows-1252' : 'utf-8';
      var text = new TextDecoder(enc).decode(buf);
      cb(text);
    };
    reader.readAsArrayBuffer(file);
  }

  function handleFiles(fileList) {
    var files = Array.from(fileList);
    var pending = files.length;
    var messages = [];
    files.forEach(function (file) {
      readFileAsText(file, function (text) {
        try {
          var parsed = parseFile(text, file.name);
          var existingIds = new Set(state.transactions.map(function (t) { return t.id; }));
          var added = 0;
          parsed.forEach(function (t) {
            if (!existingIds.has(t.id)) { state.transactions.push(t); existingIds.add(t.id); added++; }
          });
          messages.push(file.name + ': ' + added + ' nieuwe transacties (' + parsed.length + ' gevonden).');
        } catch (e) {
          messages.push(file.name + ': FOUT — ' + e.message);
        }
        pending--;
        if (pending === 0) {
          $('#import-status').textContent = messages.join(' ');
          maybePersistTx();
          render();
        }
      });
    });
  }

  // ---------- events ----------
  function bindEvents() {
    var dz = $('#dropzone');
    var input = $('#file-input');
    dz.addEventListener('click', function () { input.click(); });
    input.addEventListener('change', function () { handleFiles(input.files); input.value = ''; });
    ['dragover', 'dragenter'].forEach(function (ev) {
      dz.addEventListener(ev, function (e) { e.preventDefault(); dz.classList.add('drag'); });
    });
    ['dragleave', 'drop'].forEach(function (ev) {
      dz.addEventListener(ev, function (e) { e.preventDefault(); dz.classList.remove('drag'); });
    });
    dz.addEventListener('drop', function (e) {
      if (e.dataTransfer.files.length) handleFiles(e.dataTransfer.files);
    });

    document.addEventListener('change', function (e) {
      if (e.target.matches('[data-ownkey]')) {
        var key = e.target.getAttribute('data-ownkey');
        if (e.target.checked) state.ownKeys[key] = true; else delete state.ownKeys[key];
        saveOwnKeys();
        render();
      }
      if (e.target.id === 'filter-cat') { tableFilter.cat = e.target.value; renderTable(); }
      if (e.target.id === 'persist-toggle') {
        localStorage.setItem(LS_PERSIST_TX, e.target.checked ? '1' : '0');
        if (e.target.checked) maybePersistTx(); else localStorage.removeItem(LS_TX);
      }
    });

    document.addEventListener('input', function (e) {
      if (e.target.id === 'search-box') { tableFilter.q = e.target.value; renderTable(); }
      if (e.target.matches('[data-rule-kw]')) {
        state.rules[+e.target.getAttribute('data-rule-kw')].kw = e.target.value;
        saveRules(); renderDashboard(); renderTable();
      }
      if (e.target.matches('[data-rule-cat]')) {
        state.rules[+e.target.getAttribute('data-rule-cat')].cat = e.target.value;
        saveRules(); renderDashboard(); renderTable();
      }
    });

    document.addEventListener('click', function (e) {
      if (e.target.matches('[data-rule-del]')) {
        state.rules.splice(+e.target.getAttribute('data-rule-del'), 1);
        saveRules(); render();
      }
      if (e.target.id === 'add-rule') {
        state.rules.push({ kw: '', cat: '' });
        renderRulesPanel();
      }
      if (e.target.id === 'export-csv') exportCSV();
      if (e.target.id === 'export-rules') downloadText(JSON.stringify(state.rules, null, 2), 'categorie-regels.json', 'application/json');
      if (e.target.id === 'clear-all') {
        if (confirm('Alle geïmporteerde transacties uit deze sessie verwijderen?')) {
          state.transactions = [];
          localStorage.removeItem(LS_TX);
          render();
        }
      }
      if (e.target.matches('th[data-sort]')) {
        var k = e.target.getAttribute('data-sort');
        if (tableFilter.sortKey === k) tableFilter.sortDir *= -1; else { tableFilter.sortKey = k; tableFilter.sortDir = -1; }
        renderTable();
      }
    });
  }

  function init() {
    loadRules();
    loadOwnKeys();
    loadPersistedTx();
    var persistToggle = $('#persist-toggle');
    if (persistToggle) persistToggle.checked = persistEnabled();
    bindEvents();
    render();
  }

  document.addEventListener('DOMContentLoaded', init);
})();
