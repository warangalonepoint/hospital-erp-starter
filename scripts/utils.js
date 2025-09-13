/* ====================================================================
   utils.js — Unified helpers for Pharmacy, Reports, Admin
   - Browser-first (window.ERP) with CommonJS export fallback
   - ₹ formatting with lakh/crore, date helpers, CSV I/O
   - Inventory indexing (case-insensitive barcodes), cart math, KPIs
   ==================================================================== */

(function initERPFactory (global) {
  const ERP = {};

  /* ----------------- Storage ----------------- */
  ERP.save = (key, data) => localStorage.setItem(key, JSON.stringify(data));
  ERP.load = (key, fallback = []) => {
    try { return JSON.parse(localStorage.getItem(key)) ?? fallback; }
    catch { return fallback; }
  };

  /* ----------------- Numbers / Dates ----------------- */
  ERP.n = (v) => Number.isFinite(+v) ? +v : 0;
  ERP.round = (v, d = 2) => +ERP.n(v).toFixed(d);
  ERP.pct = (v) => ERP.n(v) / 100;
  ERP.todayISO = () => new Date().toISOString().slice(0, 10);
  ERP.asDate = (d) => (d instanceof Date ? d : new Date(d));
  ERP.ymd = (d) => {
    const x = ERP.asDate(d);
    return `${x.getFullYear()}-${String(x.getMonth()+1).padStart(2,'0')}-${String(x.getDate()).padStart(2,'0')}`;
  };
  ERP.normalize = (s) => String(s ?? '').trim().toLowerCase();

  /* ----------------- Formatting (reads Settings → erp:fmt) ----------------- */
  function getFmt() {
    try { return JSON.parse(localStorage.getItem('erp:fmt') || '{}'); }
    catch { return {}; }
  }
  function formatIndianInt(x) {
    const s = String(Math.trunc(Math.abs(x)));
    const last3 = s.slice(-3);
    const other = s.slice(0, -3);
    const withCommas = other.replace(/\B(?=(\d{2})+(?!\d))/g, ',') + (other ? ',' : '') + last3;
    return (x < 0 ? '-' : '') + withCommas;
  }
  ERP.formatNumber = (num, decimals = undefined) => {
    const cfg = getFmt();
    const d = Number.isInteger(decimals) ? decimals : (Number(cfg.decimals) ?? 2);
    const n = ERP.round(num, d);
    if (cfg.lakh) {
      const sign = n < 0 ? '-' : '';
      const abs = Math.abs(n);
      const intFmt = formatIndianInt(abs);
      const dec = d > 0 ? '.' + String(abs.toFixed(d)).split('.')[1] : '';
      return sign + intFmt + dec;
    }
    try {
      return new Intl.NumberFormat('en-IN', { minimumFractionDigits: d, maximumFractionDigits: d }).format(n);
    } catch {
      return n.toFixed(d);
    }
  };
  ERP.formatMoney = (num, decimals = undefined) => `₹ ${ERP.formatNumber(num, decimals)}`;

  /* ----------------- CSV utils ----------------- */
  ERP.csvToObjects = async function csvToObjects(text) {
    // Robust CSV parser (quotes, commas, CRLF)
    const out = [];
    let i = 0, cell = '', row = [], inQ = false;
    const push = () => { row.push(cell); cell=''; };
    for (; i < text.length; i++) {
      const c = text[i], n = text[i+1];
      if (inQ) {
        if (c === '"' && n === '"') { cell += '"'; i++; }
        else if (c === '"') inQ = false;
        else cell += c;
      } else {
        if (c === '"') inQ = true;
        else if (c === ',') push();
        else if (c === '\n' || c === '\r') {
          if (cell !== '' || row.length) { push(); out.push(row); row=[]; }
          if (c === '\r' && n === '\n') i++;
        } else cell += c;
      }
    }
    if (cell !== '' || row.length) { push(); out.push(row); }
    const cleaned = out.filter(r => r.length && r.some(c => String(c).trim() !== ''));
    const [hdr, ...data] = cleaned;
    const keys = hdr.map(h => String(h).trim());
    return data.map(r => Object.fromEntries(keys.map((k, j) => [k, (r[j] ?? '').toString().trim()])));
  };

  ERP.objectsToCSV = function objectsToCSV(rows) {
    if (!rows || !rows.length) return '';
    const cols = Array.from(rows.reduce((s, r) => { Object.keys(r).forEach(k => s.add(k)); return s; }, new Set()));
    const esc = (v) => {
      const s = String(v ?? '');
      return /[,"\n\r]/.test(s) ? `"${s.replace(/"/g,'""')}"` : s;
    };
    const head = cols.join(',');
    const body = rows.map(r => cols.map(c => esc(r[c])).join(',')).join('\n');
    return head + '\n' + body;
  };

  ERP.downloadCSV = function downloadCSV(filename, rows) {
    const csv = Array.isArray(rows) ? ERP.objectsToCSV(rows) : String(rows || '');
    const blob = new Blob([csv], {type:'text/csv;charset=utf-8;'});
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click(); URL.revokeObjectURL(a.href);
  };

  ERP.loadCSV = async function loadCSV(url, lsKey) {
    const res = await fetch(url + (url.includes('?') ? '&' : '?') + 'v=' + Date.now());
    const txt = await res.text();
    const data = await ERP.csvToObjects(txt);
    if (lsKey) ERP.save(lsKey, data);
    return data;
  };

  ERP.loadAllCSVs = async function loadAllCSVs(paths = {
    inventory: '../data/inventory.csv',
    invoices: '../data/invoices.csv',
    invoice_items: '../data/invoice_items.csv',
    patients: '../data/patients.csv'
  }) {
    const [inv, invs, items, pats] = await Promise.all([
      ERP.loadCSV(paths.inventory, 'inventory'),
      ERP.loadCSV(paths.invoices, 'invoices'),
      ERP.loadCSV(paths.invoice_items, 'invoice_items'),
      ERP.loadCSV(paths.patients, 'patients'),
    ]);
    return { inv, invs, items, pats };
  };

  /* ----------------- Inventory indexing & finders ----------------- */
  ERP.indexInventory = function indexInventory(inv = []) {
    const byBarcode = new Map();  // normalized barcode/code -> row
    const byName = new Map();     // lowercase name -> first row
    inv.forEach(it => {
      const bcKey = ERP.normalize(it.barcode || it.code || it.sku || '');
      if (bcKey) byBarcode.set(bcKey, it);
      const nm = (it.name || '').toLowerCase().trim();
      if (nm && !byName.has(nm)) byName.set(nm, it);
    });
    return { byBarcode, byName };
  };

  ERP.findInventoryByTerm = function findInventoryByTerm(term) {
    const inv = ERP.load('inventory', []);
    const idx = ERP.indexInventory(inv);
    const t = ERP.normalize(term);
    return idx.byBarcode.get(t) || idx.byName.get(t) || null;
  };

  ERP.findPatientByIdOrBarcode = function findPatientByIdOrBarcode(code) {
    const pats = ERP.load('patients', []);
    const key = ERP.normalize(code);
    return pats.find(p =>
      ERP.normalize(p.patient_id) === key ||
      ERP.normalize(p.barcode || '') === key
    ) || null;
  };

  /* ===================================================================
     SELL (Pharmacy)
     =================================================================== */

  /**
   * cart row: { code, name, batch, qty, mrp, gst, rate? }
   * - gst is percent (e.g., 12)
   * - rate defaults to mrp if missing
   */
  ERP.calcCartTotals = function calcCartTotals(cart = [], opts = {}) {
    const o = { discount: 0, roundTo: 2, ...opts };
    const money = (n) => +ERP.n(n).toFixed(o.roundTo);

    let items = 0, subtotal = 0, gst = 0;
    for (const r of cart) {
      const qty  = ERP.n(r.qty);
      const rate = ERP.n(r.rate ?? r.mrp);
      const base = qty * rate;
      const tax  = base * ERP.pct(r.gst || 0);
      items += qty;
      subtotal += base;
      gst += tax;
    }
    const gross = subtotal + gst;
    const discount = ERP.n(o.discount);
    const total = money(gross - discount);

    return {
      items,
      subtotal: money(subtotal),
      gst: money(gst),
      gross: money(gross),
      discount: money(discount),
      total
    };
  };

  ERP.renderCartTotals = function renderCartTotals(totals, ids = {}) {
    const setTxt = (id, txt) => { if (!id) return; const el = document.getElementById(id); if (el) el.textContent = txt; };
    setTxt(ids.itemsId, totals.items);
    setTxt(ids.subtotalId, ERP.formatMoney(totals.subtotal));
    setTxt(ids.gstId,      ERP.formatMoney(totals.gst));
    setTxt(ids.discountId, ERP.formatMoney(totals.discount));
    setTxt(ids.totalId,    ERP.formatMoney(totals.total));
  };

  ERP.addToCart = function addToCart(cart, row) {
    const key = (r) => `${r.code || r.barcode || r.name}@@${r.batch || ''}`;
    const i = cart.findIndex(r => key(r) === key(row));
    if (i >= 0) {
      cart[i].qty = ERP.n(cart[i].qty) + ERP.n(row.qty || 1);
      if (row.mrp)  cart[i].mrp  = ERP.n(row.mrp);
      if (row.rate) cart[i].rate = ERP.n(row.rate);
      if (row.gst != null) cart[i].gst = ERP.n(row.gst);
    } else {
      cart.push({ qty: 1, ...row });
    }
    return cart;
  };

  /* ===================================================================
     PURCHASE → STOCK
     =================================================================== */

  /**
   * purchaseRows: [{ code, barcode, name, batch, qty, mrp, gst, expiry }]
   * Merge by (code|barcode + batch), case-insensitive code/barcode
   */
  ERP.applyPurchaseRows = function applyPurchaseRows(inventory = [], purchaseRows = []) {
    const key = (r) => `${ERP.normalize(r.code || r.barcode || '')}@@${(r.batch || '').trim()}`;
    const map = new Map(inventory.map(r => [key(r), r]));

    for (const p of purchaseRows) {
      const k = key(p);
      if (!k.startsWith('@@')) { // has an identifier
        if (map.has(k)) {
          const cur = map.get(k);
          cur.qty   = String(ERP.n(cur.qty) + ERP.n(p.qty || 0));
          if (p.mrp)      cur.mrp    = String(ERP.n(p.mrp));
          if (p.gst!=null)cur.gst    = String(ERP.n(p.gst));
          if (p.expiry)   cur.expiry = p.expiry;
          if (p.name   && !cur.name)    cur.name = p.name;
          if (p.code   && !cur.code)    cur.code = p.code;
          if (p.barcode&& !cur.barcode) cur.barcode = p.barcode;
        } else {
          map.set(k, {
            name: p.name || '',
            code: p.code || p.barcode || '',
            barcode: p.barcode || p.code || '',
            batch: p.batch || '',
            expiry: p.expiry || '',
            mrp: String(ERP.n(p.mrp || 0)),
            gst: String(ERP.n(p.gst || 0)),
            qty: String(ERP.n(p.qty || 0)),
          });
        }
      }
    }

    const merged = Array.from(map.values());
    ERP.save('inventory', merged);
    return merged;
  };

  /* ===================================================================
     REPORTS
     =================================================================== */

  ERP.filterInvoicesByDate = function filterInvoicesByDate(invoices = [], from, to) {
    if (!from && !to) return invoices;
    const F = from ? ERP.asDate(from) : null;
    const T = to   ? ERP.asDate(to)   : null;
    return invoices.filter(inv => {
      const d = ERP.asDate(inv.date || inv.invoice_date || ERP.todayISO());
      if (F && d < F) return false;
      if (T && d > T) return false;
      return true;
    });
  };

  /**
   * invoices: [{ id/invoice_id, date, total, paid, balance }]
   * items:    [{ invoice_id, name, qty, rate, gst }]
   */
  ERP.buildSalesKPIs = function buildSalesKPIs(invoices = [], invoiceItems = []) {
    const money = (n) => +ERP.n(n).toFixed(2);

    const invCount = invoices.length;
    const totals = invoices.reduce((a,c)=> {
      const t = ERP.n(c.total ?? c.grand_total ?? 0);
      const p = ERP.n(c.paid  ?? 0);
      a.total   += t;
      a.paid    += p;
      a.balance += ERP.n(c.balance ?? (t - p));
      return a;
    }, { total:0, paid:0, balance:0 });

    let items = 0, gst = 0, sub = 0;
    for (const it of invoiceItems) {
      const qty  = ERP.n(it.qty);
      const rate = ERP.n(it.rate ?? it.mrp);
      const line = qty * rate;
      items += qty;
      sub   += line;
      gst   += line * ERP.pct(it.gst || 0);
    }

    return {
      invoices: invCount,
      itemsSold: items,
      subtotal: money(sub),
      gst: money(gst),
      total: money(totals.total || (sub + gst)),
      paid: money(totals.paid),
      balance: money(totals.balance)
    };
  };

  ERP.dailyRevenue = function dailyRevenue(invoiceItems = [], invoicesById = new Map()) {
    const m = new Map(); // date -> amount
    for (const it of invoiceItems) {
      const inv = invoicesById.get(it.invoice_id);
      const d = inv?.date ? ERP.ymd(inv.date) : ERP.todayISO();
      const amt = ERP.n(it.qty) * ERP.n(it.rate ?? it.mrp) * (1 + ERP.pct(it.gst || 0));
      m.set(d, ERP.n(m.get(d) || 0) + amt);
    }
    return Array.from(m.entries())
      .sort((a,b)=> a[0] < b[0] ? -1 : 1)
      .map(([date, amount]) => ({ date, amount: +ERP.n(amount).toFixed(2) }));
  };

  ERP.topItems = function topItems(invoiceItems = [], limit = 10) {
    const m = new Map(); // name -> {qty, amount}
    for (const it of invoiceItems) {
      const name = it.item_name || it.name || it.code || 'Unknown';
      const amt = ERP.n(it.qty) * ERP.n(it.rate ?? it.mrp) * (1 + ERP.pct(it.gst || 0));
      const row = m.get(name) || { qty:0, amount:0 };
      row.qty    += ERP.n(it.qty);
      row.amount += amt;
      m.set(name, row);
    }
    return Array.from(m.entries())
      .map(([name, r]) => ({ name, qty: r.qty, amount: +ERP.n(r.amount).toFixed(2) }))
      .sort((a,b)=> b.amount - a.amount)
      .slice(0, limit);
  };

  /* ----------------- Admin helpers ----------------- */
  ERP.mergeInventoryCSVText = async function mergeInventoryCSVText(csvText) {
    const rows = await ERP.csvToObjects(csvText);
    const clean = rows.map(r => ({
      code:   r.code || r.Code || r.item_code || r.sku || '',
      barcode:r.barcode || r.Barcode || r.code || '',
      name:   r.name || r.Name || r.Item || r.item || '',
      batch:  r.batch || r.Batch || '',
      qty:    ERP.n(r.qty || r.Qty || r.quantity || 0),
      mrp:    ERP.n(r.mrp || r.MRP || r.price || 0),
      gst:    ERP.n(r.gst || r.GST || 0),
      expiry: r.expiry || r.Expiry || r.exp || ''
    }));
    const inv = ERP.load('inventory', []);
    const merged = ERP.applyPurchaseRows(inv, clean);
    return merged.length;
  };

  /* ----------------- Expose ----------------- */
  global.ERP = Object.assign(global.ERP || {}, ERP);

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = ERP;
  } else {
    Object.assign(global, { ERP });
  }

})(window);
// ===== Auth helpers =====
window.ERP = window.ERP || {};

ERP.setRole = (role) => localStorage.setItem('role', role);
ERP.getRole = () => localStorage.getItem('role') || '';

/**
 * Require a role before showing the page.
 * - allowed: array of roles or '*' for any signed-in user
 * - redirect: where to send unauthenticated users
 */
ERP.requireRole = (allowed='*', redirect='login.html') => {
  // Allow manual bypass while debugging: ?dev=1
  if (new URLSearchParams(location.search).get('dev') === '1') return;

  const role = ERP.getRole();
  const ok = allowed === '*' ? !!role : Array.isArray(allowed) && allowed.includes(role);
  if (!ok) {
    // Keep original target so you can come back after login
    const target = encodeURIComponent(location.pathname + location.search + location.hash);
    location.replace(`${redirect}?next=${target}`);
  }
};

/** Build a safe page-relative URL (works whether files are in / or /pages/) */
ERP.goto = (file) => {
  const base = location.pathname.replace(/[^/]+$/, ''); // strip filename
  location.href = base + file;
};

/** Hard cache clear (SW + HTTP cache + localStorage) */
ERP.hardClear = async () => {
  try {
    if ('caches' in window) {
      const names = await caches.keys();
      await Promise.all(names.map(n => caches.delete(n)));
    }
  } catch {}
  localStorage.clear();
  location.reload(true);
};
