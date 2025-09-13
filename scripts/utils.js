/* ====================================================================
   utils.js — Unified helpers for Pharmacy, Reports, Admin
   - ES module exports + window.ERP global fallback
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
  ERP.pct = (v) => ERP.n(v) / 100;
  ERP.todayISO = () => new Date().toISOString().slice(0, 10);
  ERP.asDate = (d) => (d instanceof Date ? d : new Date(d));
  ERP.ymd = (d) => {
    const x = ERP.asDate(d);
    return `${x.getFullYear()}-${String(x.getMonth()+1).padStart(2,'0')}-${String(x.getDate()).padStart(2,'0')}`;
  };

  /* ----------------- CSV utils ----------------- */
  ERP.csvToObjects = async function csvToObjects(text) {
    // Robust CSV parser (quotes, commas, newlines)
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

  /* ----------------- Inventory indexing ----------------- */
  ERP.indexInventory = function indexInventory(inv = []) {
    const byBarcode = new Map();
    const byName = new Map();
    inv.forEach(it => {
      const bc = (it.barcode || it.code || it.sku || '').trim();
      if (bc) byBarcode.set(bc, it);
      const nm = (it.name || '').toLowerCase().trim();
      if (nm && !byName.has(nm)) byName.set(nm, it);
    });
    return { byBarcode, byName };
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
    const set = (id, v) => { if (!id) return; const el = document.getElementById(id); if (el) el.textContent = v; };
    set(ids.itemsId, totals.items);
    set(ids.subtotalId, totals.subtotal.toFixed(2));
    set(ids.gstId, totals.gst.toFixed(2));
    set(ids.discountId, totals.discount.toFixed(2));
    set(ids.totalId, totals.total.toFixed(2));
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
   * Merge by (code|barcode + batch)
   */
  ERP.applyPurchaseRows = function applyPurchaseRows(inventory = [], purchaseRows = []) {
    const key = (r) => `${(r.code || r.barcode || '').trim()}@@${(r.batch || '').trim()}`;
    const map = new Map(inventory.map(r => [key(r), r]));

    for (const p of purchaseRows) {
      const k = key(p);
      if (!k.startsWith('@@')) { // has an identifier
        if (map.has(k)) {
          const cur = map.get(k);
          cur.qty   = String(ERP.n(cur.qty) + ERP.n(p.qty || 0));
          if (p.mrp)    cur.mrp    = String(ERP.n(p.mrp));
          if (p.gst!=null) cur.gst = String(ERP.n(p.gst));
          if (p.expiry) cur.expiry = p.expiry;
          if (p.name   && !cur.name) cur.name = p.name;
          if (p.code   && !cur.code) cur.code = p.code;
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
  // attach to window (for non-module pages)
  global.ERP = Object.assign(global.ERP || {}, ERP);

  // support ESM import (if used as <script type="module">)
  try { if (typeof export !== 'undefined') {} } catch {}
  // eslint-disable-next-line no-undef
  if (typeof window !== 'undefined' && window.define === undefined) {
    // we’re in browser; optionally no-op
  }

  // Provide named exports when imported as a module
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = ERP;
  } else {
    // Create ESM-friendly exports
    // (Some bundlers will ignore this; browsers using native modules will still access via window.ERP)
    Object.assign(global, { ERP });
  }

})(window);
