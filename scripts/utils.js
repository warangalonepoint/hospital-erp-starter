/* =========================
   PHARMACY HOOKS (Sell / Purchase / Reports)
   ========================= */

// ---- tiny guard ----
ERP._num = (v)=> Number.isFinite(+v) ? +v : 0;
ERP._pct = (v)=> ERP._num(v) / 100;

// ========= SELL: cart =========
/**
 * cart rows shape (minimum):
 * { code, name, batch, qty, mrp, gst }  // gst in %
 * Optional: { rate }  // if you sell below MRP; defaults to mrp
 */
ERP.calcCartTotals = function(cart = [], opts = {}) {
  const o = { discount: 0, roundTo: 2, ...opts };
  const money = (n)=> +n.toFixed(o.roundTo);

  let items = 0, subtotal = 0, gst = 0;
  for (const r of cart) {
    const qty = ERP._num(r.qty);
    const rate = ERP._num(r.rate ?? r.mrp);
    const line = qty * rate;
    const lineGST = line * ERP._pct(r.gst || 0);
    items += qty;
    subtotal += line;
    gst += lineGST;
  }
  const gross = subtotal + gst;
  const discount = ERP._num(o.discount);
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

/** Render cart KPIs to DOM ids (all optional) */
ERP.renderCartTotals = function(t, ids = {}) {
  const set = (id, v) => { if (!id) return; const el = document.getElementById(id); if (el) el.textContent = v; };
  set(ids.itemsId, t.items);
  set(ids.subtotalId, t.subtotal.toFixed(2));
  set(ids.gstId, t.gst.toFixed(2));
  set(ids.discountId, t.discount.toFixed(2));
  set(ids.totalId, t.total.toFixed(2));
};

/** Add/update one cart row (merge by code+batch) */
ERP.addToCart = function(cart, row) {
  const key = (r)=> `${r.code || r.name}@@${r.batch || ''}`;
  const idx = cart.findIndex(r => key(r) === key(row));
  if (idx >= 0) {
    cart[idx].qty = ERP._num(cart[idx].qty) + ERP._num(row.qty || 1);
    // allow override of price/tax if passed
    if (row.mrp) cart[idx].mrp = row.mrp;
    if (row.rate) cart[idx].rate = row.rate;
    if (row.gst != null) cart[idx].gst = row.gst;
  } else {
    cart.push({ qty: 1, ...row });
  }
  return cart;
};

// ========= PURCHASE: inventory updates =========
/**
 * purchaseRows: [{ code, name, batch, qty, mrp, gst, expiry }]
 * Merges into inventory by (code+batch).
 */
ERP.applyPurchaseRows = function(inventory, purchaseRows = []) {
  const key = (r)=> `${r.code || r.name}@@${r.batch || ''}`;
  const byKey = new Map(inventory.map(r => [key(r), r]));

  for (const p of purchaseRows) {
    const k = key(p);
    if (byKey.has(k)) {
      const cur = byKey.get(k);
      cur.qty = ERP._num(cur.qty) + ERP._num(p.qty || 0);
      if (p.mrp) cur.mrp = p.mrp;
      if (p.gst != null) cur.gst = p.gst;
      if (p.expiry) cur.expiry = p.expiry;
      if (p.name && !cur.name) cur.name = p.name;
      if (p.code && !cur.code) cur.code = p.code;
    } else {
      byKey.set(k, {
        qty: 0, gst: 0,
        ...p,
        qty: ERP._num(p.qty || 0)
      });
    }
  }

  const merged = Array.from(byKey.values());
  ERP.save('inventory', merged);
  return merged;
};

// ========= REPORTS: date filters + KPIs =========
ERP._asDate = (d)=> (d instanceof Date ? d : new Date(d));
ERP._fmtYMD = (d)=> {
  const x = ERP._asDate(d);
  return `${x.getFullYear()}-${String(x.getMonth()+1).padStart(2,'0')}-${String(x.getDate()).padStart(2,'0')}`;
};

/** Filter invoices by [from, to] inclusive (invoice.date is ISO or dd/mm/yyyy) */
ERP.filterInvoicesByDate = function(invoices = [], from, to) {
  if (!from && !to) return invoices;
  const f = from ? ERP._asDate(from) : null;
  const t = to ? ERP._asDate(to) : null;
  return invoices.filter(inv => {
    const d = ERP._asDate(inv.date || inv.createdAt || Date.now());
    if (f && d < f) return false;
    if (t && d > t) return false;
    return true;
  });
};

/**
 * Build KPIs from invoices & invoice_items for a range
 * invoices: [{ id, date, paid, total, balance }]
 * invoiceItems: [{ invoice_id, qty, rate, gst }]
 */
ERP.buildSalesKPIs = function(invoices = [], invoiceItems = []) {
  const money = (n)=> +ERP._num(n).toFixed(2);

  const invCount = invoices.length;
  const totals = invoices.reduce((a,c)=> {
    a.total += ERP._num(c.total ?? 0);
    a.paid  += ERP._num(c.paid ?? 0);
    a.balance += ERP._num(c.balance ?? ((c.total ?? 0) - (c.paid ?? 0)));
    return a;
  }, { total:0, paid:0, balance:0 });

  // items sold + gst from line items (fallback if invoices don’t have tax split)
  let items = 0, gst = 0, sub = 0;
  for (const it of invoiceItems) {
    const qty  = ERP._num(it.qty);
    const rate = ERP._num(it.rate);
    const line = qty * rate;
    items += qty;
    sub += line;
    gst += line * ERP._pct(it.gst || 0);
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

/** Group daily revenue from invoice_items: returns [{date, amount}] */
ERP.dailyRevenue = function(invoiceItems = [], invoicesById = new Map()) {
  const map = new Map(); // yyy-mm-dd -> amount
  for (const it of invoiceItems) {
    const inv = invoicesById.get(it.invoice_id);
    const d = inv?.date ? ERP._fmtYMD(inv.date) : ERP._fmtYMD(Date.now());
    const amt = ERP._num(it.qty) * ERP._num(it.rate) * (1 + ERP._pct(it.gst || 0));
    map.set(d, ERP._num(map.get(d) || 0) + amt);
  }
  return Array.from(map.entries())
              .sort((a,b)=> a[0] < b[0] ? -1 : 1)
              .map(([date, amount]) => ({ date, amount:+amount.toFixed(2) }));
};

/** Top items by amount (invoice_items) */
ERP.topItems = function(invoiceItems = [], limit = 10) {
  const map = new Map(); // name -> {qty, amount}
  for (const it of invoiceItems) {
    const name = it.name || it.code || 'Unknown';
    const amt = ERP._num(it.qty) * ERP._num(it.rate) * (1 + ERP._pct(it.gst || 0));
    const row = map.get(name) || { qty:0, amount:0 };
    row.qty += ERP._num(it.qty);
    row.amount += amt;
    map.set(name, row);
  }
  return Array.from(map.entries())
    .map(([name, r]) => ({ name, qty: r.qty, amount: +r.amount.toFixed(2) }))
    .sort((a,b)=> b.amount - a.amount)
    .slice(0, limit);
};

// ========= CSV helpers for Admin imports/exports =========
/** Merge inventory from CSV text (columns can be: code,name,batch,qty,mrp,gst,expiry) */
ERP.mergeInventoryCSVText = async function(csvText) {
  const rows = await ERP.csvToObjects(csvText);
  const clean = rows.map(r => ({
    code: r.code || r.Code || r.item_code || '',
    name: r.name || r.Item || r.item || '',
    batch: r.batch || r.Batch || '',
    qty: ERP._num(r.qty || r.Qty || r.quantity || 0),
    mrp: ERP._num(r.mrp || r.MRP || r.price || 0),
    gst: ERP._num(r.gst || r.GST || 0),
    expiry: r.expiry || r.Expiry || r.exp || ''
  }));
  const inv = ERP.load('inventory', []);
  const merged = ERP.applyPurchaseRows(inv, clean);
  return merged.length;
};

/** Download any array of objects as CSV */
ERP.downloadCSV = function(filename, rows) {
  const csv = ERP.objectsToCSV(rows);
  const blob = new Blob([csv], {type:'text/csv;charset=utf-8;'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
};
