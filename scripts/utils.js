/* ================== AppUtils: unified hooks ================== */
(function () {
  const LS = {
    INV: 'inv',
    INVOICES: 'invoices',
    INVOICE_ITEMS: 'invoice_items',
    PATIENTS: 'patients',
  };

  // ---------- helpers ----------
  const qs = (sel, root = document) => root.querySelector(sel);
  const qsa = (sel, root = document) => [...root.querySelectorAll(sel)];
  const money = (n) => (isFinite(n) ? Number(n).toFixed(2) : '0.00');
  const todayISO = () => new Date().toISOString().slice(0, 10);

  const readLS = (k, fallback = []) => {
    try { return JSON.parse(localStorage.getItem(k)) ?? fallback; }
    catch { return fallback; }
  };
  const writeLS = (k, v) => localStorage.setItem(k, JSON.stringify(v));

  const parseCSV = (text) => {
    // Tiny, robust CSV (supports quoted commas & newlines)
    const rows = [];
    let i = 0, cur = '', inQ = false, row = [];
    const push = () => { row.push(cur); cur=''; };
    for (; i < text.length; i++) {
      const c = text[i], n = text[i+1];
      if (inQ) {
        if (c === '"' && n === '"') { cur += '"'; i++; }
        else if (c === '"') { inQ = false; }
        else { cur += c; }
      } else {
        if (c === '"') inQ = true;
        else if (c === ',') { push(); }
        else if (c === '\n' || c === '\r') {
          if (cur !== '' || row.length) { push(); rows.push(row); row = []; }
          if (c === '\r' && n === '\n') i++;
        } else cur += c;
      }
    }
    if (cur !== '' || row.length) { push(); rows.push(row); }
    const [hdr, ...data] = rows.filter(r => r.length && r.join('').trim() !== '');
    const keys = hdr.map(h => h.trim());
    return data.map(r => Object.fromEntries(keys.map((k, j) => [k, (r[j] ?? '').trim()])));
  };

  async function loadCSV(url, lsKey) {
    const res = await fetch(url + (url.includes('?') ? '&' : '?') + 'v=' + Date.now());
    const txt = await res.text();
    const data = parseCSV(txt);
    writeLS(lsKey, data);
    return data;
  }

  // Public: load all CSVs in one go (optional)
  async function loadAllCSVs(paths = {
    inventory: 'inventory.csv',
    invoices: 'invoices.csv',
    invoice_items: 'invoice_items.csv',
    patients: 'patients.csv'
  }) {
    const [inv, invs, items, pats] = await Promise.all([
      loadCSV(paths.inventory, LS.INV),
      loadCSV(paths.invoices, LS.INVOICES),
      loadCSV(paths.invoice_items, LS.INVOICE_ITEMS),
      loadCSV(paths.patients, LS.PATIENTS),
    ]);
    return { inv, invs, items, pats };
  }

  // ---------- Inventory index ----------
  function indexInventory(inv) {
    const byBarcode = new Map();
    const byName = new Map();
    inv.forEach(it => {
      const key = (it.barcode || it.sku || '').trim();
      if (key) byBarcode.set(key, it);
      const nm = (it.name || '').toLowerCase();
      if (nm && !byName.has(nm)) byName.set(nm, it);
    });
    return { byBarcode, byName };
  }

  // ================== PHARMACY: SELL CART ==================
  function wireSellCart(opts = {}) {
    const S = Object.assign({
      cartBody: '#cart-body',
      subtotal: '#sum-subtotal',
      gst: '#sum-gst',
      grand: '#sum-grand',
      items: '#sum-items',
      itemSearch: '#item-search',
      scanBtn: '#btn-scan-item',
    }, opts.selectors || {});

    let cart = []; // {id, name, barcode, qty, mrp, gst, batch}
    let inv = readLS(LS.INV, []);
    let idx = indexInventory(inv);

    // render
    const $body = qs(S.cartBody);
    const $sub = qs(S.subtotal), $gst = qs(S.gst), $gr = qs(S.grand), $cnt = qs(S.items);

    function lineTotals(it) {
      const price = Number(it.mrp || 0);
      const qty = Number(it.qty || 1);
      const gstPct = Number(it.gst || it.gst_pct || 0);
      const base = price * qty;
      const gstAmt = base * (gstPct / 100);
      return { base, gstAmt, total: base + gstAmt };
    }

    function renderCart() {
      if (!$body) return;
      if (cart.length === 0) {
        $body.innerHTML = `<tr><td colspan="7" class="muted">Cart is empty</td></tr>`;
      } else {
        $body.innerHTML = cart.map((it, i) => {
          const { base, gstAmt, total } = lineTotals(it);
          return `
            <tr data-i="${i}">
              <td>${it.name || ''}</td>
              <td>${it.batch || ''}</td>
              <td><input type="number" class="qty" value="${it.qty || 1}" min="1" style="width:72px"></td>
              <td class="num">${money(it.mrp || 0)}</td>
              <td class="num">${money(gstAmt)}</td>
              <td class="num">${money(total)}</td>
              <td><button class="chip action remove">✕</button></td>
            </tr>
          `;
        }).join('');
      }
      recalcTotals();
    }

    function recalcTotals() {
      let base = 0, gst = 0, tot = 0, items = 0;
      cart.forEach(it => {
        const t = lineTotals(it);
        base += t.base; gst += t.gstAmt; tot += t.total; items += Number(it.qty || 1);
      });
      if ($sub) $sub.textContent = money(base);
      if ($gst) $gst.textContent = money(gst);
      if ($gr)  $gr.textContent  = money(tot);
      if ($cnt) $cnt.textContent = String(items);
    }

    function addItem(invItem, qty = 1) {
      const existing = cart.find(c => (c.barcode && c.barcode === invItem.barcode));
      if (existing) existing.qty = Number(existing.qty || 1) + Number(qty || 1);
      else {
        cart.push({
          id: invItem.id || invItem.sku || invItem.barcode || crypto.randomUUID(),
          name: invItem.name,
          barcode: invItem.barcode || '',
          batch: invItem.batch || '',
          expiry: invItem.expiry || '',
          mrp: Number(invItem.mrp || 0),
          gst: Number(invItem.gst || invItem.gst_pct || 0),
          qty: Number(qty || 1),
        });
      }
      renderCart();
    }

    // events (qty / remove)
    $body?.addEventListener('input', (e) => {
      if (e.target.classList.contains('qty')) {
        const tr = e.target.closest('tr');
        const i = Number(tr?.dataset.i);
        const val = Math.max(1, Number(e.target.value || 1));
        if (!isNaN(i)) { cart[i].qty = val; recalcTotals(); }
      }
    });
    $body?.addEventListener('click', (e) => {
      if (e.target.classList.contains('remove')) {
        const tr = e.target.closest('tr'); const i = Number(tr?.dataset.i);
        if (!isNaN(i)) { cart.splice(i, 1); renderCart(); }
      }
    });

    // search add
    qs(S.itemSearch)?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const term = e.currentTarget.value.trim().toLowerCase();
        const byBC = idx.byBarcode.get(term);
        const byName = idx.byName.get(term);
        const found = byBC || byName;
        if (found) addItem(found, 1);
        e.currentTarget.value = '';
      }
    });

    // scan button (via global Scanner from scanner.js)
    qs(S.scanBtn)?.addEventListener('click', async () => {
      if (!window.Scanner || !window.Scanner.ensureLoaded) {
        alert('Scanner library not loaded. Check network / script tag.');
        return;
      }
      await window.Scanner.ensureLoaded();
      window.Scanner.start({
        containerId: 'scan-overlay',
        onDecode: (code) => {
          const invItem = idx.byBarcode.get(String(code).trim());
          if (invItem) addItem(invItem, 1);
        },
        onClose: () => {}
      });
    });

    // expose minimal API
    return {
      addByBarcode: (code, qty=1) => {
        const it = idx.byBarcode.get(String(code).trim());
        if (it) addItem(it, qty);
      },
      getCart: () => cart.slice(),
      clearCart: () => { cart = []; renderCart(); },
      recalcTotals,
      renderCart,
      reloadInventory: () => { inv = readLS(LS.INV, []); idx = indexInventory(inv); }
    };
  }

  // ================== PURCHASE → STOCK UPDATE ==================
  function commitPurchaseToStock(purchaseLines /* array of {barcode,name,batch,expiry,mrp,gst,qty} */) {
    const inv = readLS(LS.INV, []);
    const map = indexInventory(inv).byBarcode;

    purchaseLines.forEach(pl => {
      const key = (pl.barcode || '').trim();
      if (!key) return;
      const existing = map.get(key);
      if (existing) {
        // Update qty (and refresh batch/expiry if newer)
        existing.qty = String((Number(existing.qty || 0) + Number(pl.qty || 0)));
        if (pl.batch)  existing.batch  = pl.batch;
        if (pl.expiry) existing.expiry = pl.expiry;
        if (pl.mrp)    existing.mrp    = String(pl.mrp);
        if (pl.gst != null) existing.gst = String(pl.gst);
      } else {
        inv.push({
          id: pl.id || pl.barcode,
          name: pl.name || '',
          barcode: pl.barcode || '',
          batch: pl.batch || '',
          expiry: pl.expiry || '',
          mrp: String(pl.mrp || 0),
          gst: String(pl.gst || 0),
          qty: String(pl.qty || 0),
        });
      }
    });

    writeLS(LS.INV, inv);
    return inv;
  }

  // ================== REPORTS (KPIs) ==================
  function computeAndRenderReports(opts = {}) {
    const S = Object.assign({
      from: todayISO(), to: todayISO(),
      elTotal: '#kpi-total',
      elAvg: '#kpi-avg',
      elInvoices: '#kpi-invoices',
      elPaid: '#kpi-paid',
      elTopItem: '#kpi-top-item',
    }, opts);

    const invoices = readLS(LS.INVOICES, []);
    const items = readLS(LS.INVOICE_ITEMS, []);

    const from = new Date(S.from + 'T00:00:00');
    const to = new Date(S.to + 'T23:59:59');

    const inRangeInvoices = invoices.filter(inv => {
      const d = new Date((inv.date || inv.created_at || todayISO()) + 'T12:00:00');
      return d >= from && d <= to;
    });

    const invIds = new Set(inRangeInvoices.map(i => i.id || i.invoice_id));
    const inRangeItems = items.filter(it => invIds.has(it.invoice_id || it.invoiceId || it.id));

    let total = 0, paid = 0, days = Math.max(1, Math.ceil((to - from) / 86400000) + 1);
    inRangeInvoices.forEach(i => {
      total += Number(i.total || i.grand_total || 0);
      paid  += Number(i.paid  || 0);
    });

    // top item by qty
    const byItem = new Map();
    inRangeItems.forEach(it => {
      const name = (it.item || it.name || '').trim();
      const q = Number(it.qty || it.quantity || 0);
      if (!name) return;
      byItem.set(name, (byItem.get(name) || 0) + q);
    });
    let topItem = '—', max = 0;
    byItem.forEach((q, name) => { if (q > max) { max = q; topItem = name; } });

    qs(S.elTotal)?.textContent = money(total);
    qs(S.elAvg)?.textContent = money(total / days);
    qs(S.elInvoices)?.textContent = String(inRangeInvoices.length);
    qs(S.elPaid)?.textContent = money(paid);
    qs(S.elTopItem)?.textContent = topItem;
    return { total, avg: total/days, invoices: inRangeInvoices.length, paid, topItem };
  }

  // ================== ADMIN: Scan → Upload Stock ==================
  function wireAdminStockScan(opts = {}) {
    const S = Object.assign({
      video: '#admin-scan-video',
      result: '#admin-scan-result',
      name: '#admin-name',
      barcode: '#admin-barcode',
      batch: '#admin-batch',
      expiry: '#admin-expiry',
      mrp: '#admin-mrp',
      gst: '#admin-gst',
      qty: '#admin-qty',
      saveBtn: '#admin-save-stock',
      scanBtn: '#admin-start-scan',   // optional
      stopBtn: '#admin-stop-scan',    // optional
    }, opts);

    const els = {
      result: qs(S.result),
      name: qs(S.name),
      barcode: qs(S.barcode),
      batch: qs(S.batch),
      expiry: qs(S.expiry),
      mrp: qs(S.mrp),
      gst: qs(S.gst),
      qty: qs(S.qty),
      save: qs(S.saveBtn),
      scanBtn: qs(S.scanBtn),
      stopBtn: qs(S.stopBtn),
    };

    async function start() {
      if (!window.Scanner || !window.Scanner.ensureLoaded) {
        alert('Scanner library not loaded. Check network / script tag.');
        return;
      }
      await window.Scanner.ensureLoaded();
      window.Scanner.start({
        containerId: S.video.replace('#',''),
        onDecode: (code) => {
          els.result && (els.result.textContent = `Scanned: ${code}`);
          els.barcode && (els.barcode.value = String(code).trim());
        },
        onClose: () => {}
      });
    }
    function stop() { window.Scanner?.stop?.(); }

    els.scanBtn?.addEventListener('click', start);
    els.stopBtn?.addEventListener('click', stop);

    els.save?.addEventListener('click', () => {
      const pl = {
        name: els.name?.value || '',
        barcode: els.barcode?.value || '',
        batch: els.batch?.value || '',
        expiry: els.expiry?.value || '',
        mrp: Number(els.mrp?.value || 0),
        gst: Number(els.gst?.value || 0),
        qty: Number(els.qty?.value || 0),
      };
      if (!pl.barcode) { alert('Barcode is required'); return; }
      commitPurchaseToStock([pl]);
      if (els.result) els.result.textContent = 'Saved to stock ✓';
      // clear qty only
      if (els.qty) els.qty.value = '';
    });

    return { start, stop };
  }

  // ================== Public API ==================
  window.AppUtils = {
    loadAllCSVs,
    parseCSV,
    readLS, writeLS, LS,
    wireSellCart,
    commitPurchaseToStock,
    computeAndRenderReports,
    wireAdminStockScan,
  };
})();

/* utils.js — common helpers for Hospital ERP Starter
   Safe to replace; functions are namespaced to avoid collisions.
*/

window.ERP = window.ERP || {};
const ERP = window.ERP;

// -------- Storage helpers (local demo data) --------
ERP.saveJSON = (key, obj) => localStorage.setItem(key, JSON.stringify(obj));
ERP.loadJSON = (key, fallback = null) => {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; }
  catch { return fallback; }
};

// -------- ID & Barcode helpers --------
ERP.generatePatientId = function(seq = null, date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const n = (seq ?? Number(localStorage.getItem('pid_seq') || 0) + 1);
  localStorage.setItem('pid_seq', String(n));
  return `PID-${y}${m}${d}-${String(n).padStart(4, '0')}`;
};

// Render Code128 barcode into an <svg> element
ERP.renderBarcode = function(svgEl, text) {
  if (!svgEl) return;
  if (!window.JsBarcode) { console.warn('JsBarcode not loaded'); return; }
  try {
    JsBarcode(svgEl, text, { format: 'CODE128', displayValue: true, fontSize: 12, height: 60 });
  } catch (e) { console.warn('Barcode render failed', e); }
};

// -------- CSV helpers --------
ERP.csvStringify = function(rows) {
  const esc = (v) => {
    if (v == null) return '';
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return rows.map(r => r.map(esc).join(',')).join('\n');
};

ERP.csvParse = function(csv) {
  // Simple CSV parser for demo data (no multi-line quoted fields).
  const lines = csv.trim().split(/\r?\n/);
  const headers = lines.shift().split(',').map(h => h.trim());
  return lines.map(line => {
    const cols = [];
    let cur = '', inQ = false;
    for (let i=0;i<line.length;i++){
      const ch = line[i];
      if (inQ) {
        if (ch === '"' && line[i+1] === '"') { cur += '"'; i++; }
        else if (ch === '"') inQ = false;
        else cur += ch;
      } else {
        if (ch === '"') inQ = true;
        else if (ch === ',') { cols.push(cur); cur = ''; }
        else cur += ch;
      }
    }
    cols.push(cur);
    const obj = {};
    headers.forEach((h, i) => obj[h] = (cols[i] ?? '').trim());
    return obj;
  });
};

// Download an array of objects as CSV
ERP.downloadCSV = function(filename, headers, rows) {
  const data = [headers, ...rows.map(r => headers.map(h => r[h]))];
  const csv = ERP.csvStringify(data);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  document.body.appendChild(link); link.click(); link.remove();
};

// Money fmt
ERP.money = n => (Number(n) || 0).toFixed(2);

// Simple UID
ERP.uid = (prefix='ID') => `${prefix}-${Math.random().toString(36).slice(2,8)}`;
