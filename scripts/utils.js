/* ====================================================================
   utils.js — Unified helpers (Pharmacy + Reports + Admin)
   - INR formatting, CSV I/O, inventory merge, cart totals
   - Simple invoice helpers (save / print / share)
   ==================================================================== */

(function initERPFactory (global) {
  const ERP = {};

  /* Storage */
  ERP.save = (k, v) => localStorage.setItem(k, JSON.stringify(v));
  ERP.load = (k, fallback = []) => {
    try { return JSON.parse(localStorage.getItem(k)) ?? fallback; }
    catch { return fallback; }
  };

  /* Numbers / Dates / Format */
  ERP.n = (v) => Number.isFinite(+v) ? +v : 0;
  ERP.pct = (v) => ERP.n(v) / 100;
  ERP.round = (v, d=2) => +ERP.n(v).toFixed(d);
  ERP.asDate = (d) => (d instanceof Date ? d : new Date(d));
  ERP.todayISO = () => new Date().toISOString().slice(0,10);
  ERP.ymd = (d) => { const x=ERP.asDate(d); return `${x.getFullYear()}-${String(x.getMonth()+1).padStart(2,'0')}-${String(x.getDate()).padStart(2,'0')}`; };
  ERP.normalize = (s) => String(s ?? '').trim().toLowerCase();

  // Indian number format with optional lakh grouping
  function formatIndianInt(x){
    const s=String(Math.trunc(Math.abs(x))); const last3=s.slice(-3); const other=s.slice(0,-3);
    const withCommas=(other.replace(/\B(?=(\d{2})+(?!\d))/g, ',') + (other?',':'') + last3);
    return (x<0?'-':'') + withCommas;
  }
  ERP.formatNumber = (num, decimals=2) => {
    const n = ERP.round(num, decimals);
    try {
      return new Intl.NumberFormat('en-IN', { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(n);
    } catch {
      const dec = decimals>0 ? ('.'+String(Math.abs(n).toFixed(decimals)).split('.')[1]) : '';
      return formatIndianInt(n) + dec;
    }
  };
  ERP.formatMoney = (num, decimals=2) => `₹ ${ERP.formatNumber(num, decimals)}`;

  /* CSV */
  ERP.csvToObjects = async function (text) {
    const out=[]; let i=0, cell='', row=[], inQ=false; const push=()=>{row.push(cell);cell='';};
    for(; i<text.length; i++){
      const c=text[i], n=text[i+1];
      if(inQ){ if(c==='"'&&n==='"'){cell+='"';i++;} else if(c==='"'){inQ=false;} else cell+=c; }
      else { if(c==='"') inQ=true;
             else if(c===',') push();
             else if(c==='\n'||c==='\r'){ if(cell!==''||row.length){ push(); out.push(row); row=[]; } if(c==='\r'&&n==='\n') i++; }
             else cell+=c; }
    }
    if(cell!==''||row.length){ push(); out.push(row); }
    const cleaned = out.filter(r=>r.length && r.some(c=>String(c).trim()!==''));
    const [hdr,...data]=cleaned; const keys=hdr.map(h=>String(h).trim());
    return data.map(r=>Object.fromEntries(keys.map((k,j)=>[k,(r[j]??'').toString().trim()])));
  };
  ERP.objectsToCSV = function(rows){
    if(!rows||!rows.length) return '';
    const cols = Array.from(rows.reduce((s,r)=>{ Object.keys(r).forEach(k=>s.add(k)); return s; }, new Set()));
    const esc = (v)=>{ const s=String(v??''); return /[,"\n\r]/.test(s)?`"${s.replace(/"/g,'""')}"`:s; };
    return cols.join(',') + '\n' + rows.map(r=>cols.map(c=>esc(r[c])).join(',')).join('\n');
  };
  ERP.downloadCSV = function(filename, rows){
    const csv = Array.isArray(rows) ? ERP.objectsToCSV(rows) : String(rows||'');
    const blob = new Blob([csv], {type:'text/csv;charset=utf-8;'});
    const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=filename;
    a.click(); URL.revokeObjectURL(a.href);
  };
  ERP.loadCSV = async function(url, lsKey){
    const res = await fetch(url + (url.includes('?')?'&':'?') + 'v=' + Date.now());
    const txt = await res.text(); const data = await ERP.csvToObjects(txt);
    if(lsKey) ERP.save(lsKey, data); return data;
  };

  /* Bulk loader (paths can be overridden per page) */
  ERP.loadAllCSVs = async function(paths = {
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

  /* Inventory indexing & finders */
  ERP.indexInventory = function(inv=[]){
    const byBarcode=new Map(), byName=new Map();
    inv.forEach(it=>{
      const key=ERP.normalize(it.barcode||it.code||it.sku||''); if(key) byBarcode.set(key,it);
      const nm=(it.name||'').toLowerCase().trim(); if(nm && !byName.has(nm)) byName.set(nm,it);
    });
    return { byBarcode, byName };
  };
  ERP.findInventoryByTerm = function(term){
    const inv=ERP.load('inventory',[]); const idx=ERP.indexInventory(inv); const t=ERP.normalize(term);
    return idx.byBarcode.get(t) || idx.byName.get(t) || null;
  };

  /* Patients */
  ERP.generatePatientId = function(prefix='P'){
    const ts = Date.now().toString(36).toUpperCase();
    return `${prefix}-${ts.slice(-6)}`;
  };
  ERP.findPatientByIdOrBarcode = function(code){
    const pats=ERP.load('patients',[]); const key=ERP.normalize(code);
    return pats.find(p => ERP.normalize(p.patient_id)===key || ERP.normalize(p.barcode||'')===key) || null;
  };

  /* Pharmacy: cart math */
  ERP.calcCartTotals = function(cart=[], opts={}){
    const o={discount:0,roundTo:2,...opts};
    let items=0, subtotal=0, gst=0;
    for(const r of cart){
      const qty=ERP.n(r.qty), rate=ERP.n(r.rate ?? r.mrp), base=qty*rate, tax=base*ERP.pct(r.gst||0);
      items+=qty; subtotal+=base; gst+=tax;
    }
    const gross=subtotal+gst, discount=ERP.n(o.discount), total=+(gross-discount).toFixed(o.roundTo);
    return { items, subtotal:+subtotal.toFixed(o.roundTo), gst:+gst.toFixed(o.roundTo), gross:+gross.toFixed(o.roundTo), discount:+discount.toFixed(o.roundTo), total };
  };
  ERP.addToCart = function(cart,row){
    const key=(r)=>`${r.code||r.barcode||r.name}@@${r.batch||''}`;
    const i=cart.findIndex(r=>key(r)===key(row));
    if(i>=0){ cart[i].qty=ERP.n(cart[i].qty)+ERP.n(row.qty||1); if(row.mrp)cart[i].mrp=ERP.n(row.mrp); if(row.rate)cart[i].rate=ERP.n(row.rate); if(row.gst!=null)cart[i].gst=ERP.n(row.gst); }
    else { cart.push({ qty:1, ...row }); }
    return cart;
  };

  /* Purchase → Stock merge */
  ERP.applyPurchaseRows = function(inventory=[], purchaseRows=[]){
    const key=(r)=>`${ERP.normalize(r.code||r.barcode||'')}@@${(r.batch||'').trim()}`;
    const map=new Map(inventory.map(r=>[key(r),r]));
    for(const p of purchaseRows){
      const k=key(p); if(k.startsWith('@@')) continue;
      if(map.has(k)){
        const cur=map.get(k);
        cur.qty = String(ERP.n(cur.qty)+ERP.n(p.qty||0));
        if(p.mrp) cur.mrp=String(ERP.n(p.mrp));
        if(p.gst!=null) cur.gst=String(ERP.n(p.gst));
        if(p.expiry) cur.expiry=p.expiry;
        if(p.name && !cur.name) cur.name=p.name;
        if(p.code && !cur.code) cur.code=p.code;
        if(p.barcode && !cur.barcode) cur.barcode=p.barcode;
      } else {
        map.set(k, {
          name: p.name||'', code: p.code||p.barcode||'', barcode: p.barcode||p.code||'',
          batch: p.batch||'', expiry: p.expiry||'',
          mrp: String(ERP.n(p.mrp||0)), gst: String(ERP.n(p.gst||0)), qty: String(ERP.n(p.qty||0)),
        });
      }
    }
    const merged=Array.from(map.values()); ERP.save('inventory', merged); return merged;
  };

  /* Reports */
  ERP.filterInvoicesByDate = function(invoices=[], from, to){
    if(!from && !to) return invoices;
    const F=from?ERP.asDate(from):null, T=to?ERP.asDate(to):null;
    return invoices.filter(inv=>{
      const d=ERP.asDate(inv.date||inv.invoice_date||ERP.todayISO());
      if(F && d<F) return false; if(T && d>T) return false; return true;
    });
  };
  ERP.buildSalesKPIs = function(invoices=[], invoiceItems=[]){
    const money=(n)=>+ERP.n(n).toFixed(2);
    const invCount=invoices.length;
    const totals=invoices.reduce((a,c)=>{ const t=ERP.n(c.total??c.grand_total??0), p=ERP.n(c.paid??0);
      a.total+=t; a.paid+=p; a.balance+=ERP.n(c.balance??(t-p)); return a; },{total:0,paid:0,balance:0});
    let items=0,gst=0,sub=0;
    for(const it of invoiceItems){ const qty=ERP.n(it.qty), rate=ERP.n(it.rate??it.mrp), line=qty*rate; items+=qty; sub+=line; gst+=line*ERP.pct(it.gst||0); }
    return { invoices:invCount, itemsSold:items, subtotal:money(sub), gst:money(gst), total:money(totals.total||sub+gst), paid:money(totals.paid), balance:money(totals.balance) };
  };
  ERP.dailyRevenue = function(invoiceItems=[], invoicesById=new Map()){
    const m=new Map();
    for(const it of invoiceItems){
      const inv=invoicesById.get(it.invoice_id); const d=inv?.date?ERP.ymd(inv.date):ERP.todayISO();
      const amt=ERP.n(it.qty)*ERP.n(it.rate??it.mrp)*(1+ERP.pct(it.gst||0));
      m.set(d, ERP.n(m.get(d)||0)+amt);
    }
    return Array.from(m.entries()).sort((a,b)=>a[0]<b[0]?-1:1).map(([date,amount])=>({date,amount:+ERP.n(amount).toFixed(2)}));
  };

  /* Admin helpers */
  ERP.mergeInventoryCSVText = async function(csvText){
    const rows=await ERP.csvToObjects(csvText);
    const clean=rows.map(r=>({
      code:r.code||r.Code||r.item_code||r.sku||'',
      barcode:r.barcode||r.Barcode||r.code||'',
      name:r.name||r.Name||r.Item||r.item||'',
      batch:r.batch||r.Batch||'',
      qty:ERP.n(r.qty||r.Qty||r.quantity||0),
      mrp:ERP.n(r.mrp||r.MRP||r.price||0),
      gst:ERP.n(r.gst||r.GST||0),
      expiry:r.expiry||r.Expiry||r.exp||''
    }));
    const inv=ERP.load('inventory',[]);
    const merged=ERP.applyPurchaseRows(inv, clean);
    return merged.length;
  };

  /* Invoice helpers (save / print / share) */
  ERP.buildInvoiceFromCart = function(cart=[], meta={}){
    const totals = ERP.calcCartTotals(cart, {roundTo:2});
    const id = meta.id || 'INV-' + Date.now();
    return {
      id,
      date: ERP.todayISO(),
      patient_id: meta.patient_id || '',
      total: totals.total, gst: totals.gst, subtotal: totals.subtotal,
      paid: meta.paid ?? totals.total, balance: (totals.total - (meta.paid ?? totals.total)),
      items: cart.map(r=>({
        invoice_id: id, item_name: r.name, code: r.code||r.barcode||'',
        qty: r.qty, rate: r.rate ?? r.mrp, gst: r.gst ?? 0, batch: r.batch || ''
      }))
    };
  };
  ERP.saveInvoice = function(invoice){
    const invoices=ERP.load('invoices',[]); const items=ERP.load('invoice_items',[]);
    invoices.push({ id:invoice.id, date:invoice.date, total:invoice.total, paid:invoice.paid, balance:invoice.balance });
    items.push(...invoice.items);
    ERP.save('invoices', invoices); ERP.save('invoice_items', items);
    return invoice.id;
  };
  ERP.printInvoiceHtml = function(invoice){
    const w = window.open('', '_blank');
    w.document.write(`<pre>${JSON.stringify(invoice,null,2)}</pre>`);
    w.document.close(); w.focus(); w.print();
  };
  ERP.shareInvoice = async function(invoice){
    try {
      const text = `Invoice ${invoice.id}\nTotal: ₹ ${ERP.formatNumber(invoice.total)}\nDate: ${invoice.date}`;
      if (navigator.share) { await navigator.share({ title: 'Invoice', text }); }
      else { await navigator.clipboard.writeText(text); alert('Invoice copied to clipboard'); }
    } catch (e){ alert('Share failed: ' + e.message); }
  };

  /* Navigation / cache */
  ERP.goto = (file) => { const base=location.pathname.replace(/[^/]+$/, ''); location.href=base+file; };
  ERP.hardClear = async ()=>{
    try{ if('caches' in window){ const ks=await caches.keys(); await Promise.all(ks.map(k=>caches.delete(k))); } }catch{}
    localStorage.clear(); location.reload(true);
  };

  // expose
  global.ERP = Object.assign(global.ERP || {}, ERP);

})(window);
