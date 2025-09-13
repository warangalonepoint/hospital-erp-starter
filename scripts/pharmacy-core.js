// scripts/pharmacy-core.js
// Version-agnostic wiring for Pharmacy (Sell / Purchase / Stock / Reports)
// Relies on window.ERP (utils.js) and optional window.startScanner (scanner.js)

(function(global){
  const $$ = (sel, scope=document) => Array.from(scope.querySelectorAll(sel));
  const $  = (sel, scope=document) => scope.querySelector(sel);

  // Helpers to find controls via data-attrs with fallbacks
  const pick = (...sels) => sels.map(s => $(s)).find(Boolean);

  function parseNum(v){ const n = Number(v); return Number.isFinite(n) ? n : 0; }

  // ================= SELL =================
  function wireSell(root=document){
    const cartBody   = $('[data-sell="cart-body"]', root) || $('#cart-body', root);
    const inpSearch  = $('[data-sell="search"]', root)    || $('#item-search', root);
    const btnScan    = $('[data-sell="scan-item"]', root) || $('#btn-scan-item', root);
    const btnDemo    = $('[data-sell="demo"]', root)      || $('#btnDemo', root);
    const inpDisc    = $('[data-sell="discount"]', root)  || $('#discount', root);
    const btnSave    = $('[data-sell="save"]', root)      || $('#btnSave', root);

    const patScan    = $('[data-patient="scan"]', root)   || $('#btnScanPatient', root);
    const patNew     = $('[data-patient="new"]', root)    || $('#btnNewPatient', root);
    const patStatus  = $('[data-patient="status"]', root) || $('#patientStatus', root);

    const kpi = {
      itemsId:     ( $('[data-kpi="items"]', root)     || $('#sum-items', root)     )?.id,
      subtotalId:  ( $('[data-kpi="subtotal"]', root)  || $('#sum-subtotal', root)  )?.id,
      gstId:       ( $('[data-kpi="gst"]', root)       || $('#sum-gst', root)       )?.id,
      discountId:  ( $('[data-kpi="discount"]', root)  || $('#sum-discount', root)  )?.id,
      totalId:     ( $('[data-kpi="total"]', root)     || $('#sum-grand', root)     )?.id,
    };

    let CART = [];
    let LINKED = null;

    function renderCart(){
      if(!cartBody) return;
      if(!CART.length){
        cartBody.innerHTML = `<tr><td class="muted" colspan="7">Cart is empty</td></tr>`;
      }else{
        cartBody.innerHTML = CART.map((it,i)=>{
          const rate = parseNum(it.rate ?? it.mrp);
          const line = (parseNum(it.qty||1) * rate);
          const gstA = line * (parseNum(it.gst||0)/100);
          const total = line + gstA;
          return `<tr data-i="${i}">
            <td>${it.name||''}</td>
            <td>${it.batch||''}</td>
            <td><input class="qty" type="number" min="1" value="${it.qty||1}" style="width:80px"></td>
            <td>₹ ${rate.toFixed(2)}</td>
            <td>₹ ${gstA.toFixed(2)}</td>
            <td>₹ ${total.toFixed(2)}</td>
            <td><button class="chip remove">✕</button></td>
          </tr>`;
        }).join('');
      }
      recompute();
    }

    function recompute(){
      const discount = parseNum(inpDisc?.value || 0);
      const t = ERP.calcCartTotals(CART, { discount });
      ERP.renderCartTotals(t, kpi);
    }

    cartBody?.addEventListener('input', (e)=>{
      if(e.target.classList.contains('qty')){
        const i = +e.target.closest('tr').dataset.i;
        CART[i].qty = Math.max(1, parseNum(e.target.value||1));
        recompute();
      }
    });
    cartBody?.addEventListener('click', (e)=>{
      if(e.target.classList.contains('remove')){
        const i = +e.target.closest('tr').dataset.i;
        CART.splice(i,1); renderCart();
      }
    });
    inpDisc?.addEventListener('input', recompute);

    // Search by barcode or name
    inpSearch?.addEventListener('keydown', (e)=>{
      if(e.key!=='Enter') return;
      const term = e.target.value.trim().toLowerCase();
      if(!term) return;
      const inv = ERP.load('inventory', []);
      const { byBarcode, byName } = ERP.indexInventory(inv);
      const hit = byBarcode.get(term) || byName.get(term);
      if(!hit) return alert('Not found in inventory');
      CART = ERP.addToCart(CART, {
        code: hit.barcode||hit.code||'',
        name: hit.name,
        batch: hit.batch,
        qty: 1,
        mrp: parseNum(hit.mrp||0),
        gst: parseNum(hit.gst||0)
      });
      renderCart(); e.target.value='';
    });

    // Scan item
    btnScan?.addEventListener('click', async ()=>{
      if(typeof window.startScanner!=='function' && !(window.Scanner?.start)){
        alert('Scanner not available'); return;
      }
      const stop = await (window.startScanner ? startScanner({
        modal:true,
        onDetected:(code)=>{
          const inv = ERP.load('inventory', []);
          const { byBarcode } = ERP.indexInventory(inv);
          const hit = byBarcode.get(String(code).trim().toLowerCase());
          if(hit){
            CART = ERP.addToCart(CART, {
              code: hit.barcode||hit.code||'',
              name: hit.name,
              batch: hit.batch,
              qty:1,
              mrp: parseNum(hit.mrp||0),
              gst: parseNum(hit.gst||0)
            });
            renderCart();
          }
        }
      }) : window.Scanner.start({ onDecode:(code)=>{/* same pattern */} }));
      void stop; // if your scanner provides a stop() use it on modal close
    });

    // Demo fill
    btnDemo?.addEventListener('click', ()=>{
      const inv = ERP.load('inventory', []);
      CART = [];
      inv.slice(0,3).forEach(x=>{
        CART = ERP.addToCart(CART, {
          code:x.barcode||x.code||'',
          name:x.name, batch:x.batch, qty:1, mrp:parseNum(x.mrp||0), gst:parseNum(x.gst||0)
        });
      });
      renderCart();
    });

    // Patient link
    patNew?.addEventListener('click', ()=>{
      const id='P'+Date.now().toString().slice(-6);
      LINKED={ patient_id:id, name:'New Patient' };
      if(patStatus) patStatus.textContent = `Linked: ${id} (new)`;
    });
    patScan?.addEventListener('click', async ()=>{
      if(typeof window.startScanner!=='function' && !(window.Scanner?.start)){
        alert('Scanner not available'); return;
      }
      await (window.startScanner ? startScanner({
        modal:true,
        onDetected:(code)=>{
          const pats = ERP.load('patients', []);
          const p = pats.find(r => String(r.patient_id)===String(code));
          if(!p) return alert('Patient not found');
          LINKED = p;
          if(patStatus) patStatus.textContent = `Linked: ${p.name} (${p.patient_id})`;
        }
      }) : window.Scanner.start({ onDecode:(code)=>{/* same */} }));
    });

    // Save invoice
    btnSave?.addEventListener('click', ()=>{
      if(!CART.length) return alert('Cart empty');
      const totals = ERP.calcCartTotals(CART, { discount: parseNum(inpDisc?.value||0) });
      const invId = 'INV'+Date.now();
      const invoice = {
        id:invId,
        date: new Date().toISOString().slice(0,10),
        patient_id: LINKED?.patient_id || '',
        patient_name: LINKED?.name || '',
        total: totals.total,
        paid: totals.total
      };
      const items = CART.map(l=>({
        invoice_id: invId,
        item_name: l.name, qty: l.qty,
        rate: parseNum(l.rate ?? l.mrp),
        gst: parseNum(l.gst||0)
      }));
      const allInv = ERP.load('invoices', []); allInv.push(invoice); ERP.save('invoices', allInv);
      const allItems = ERP.load('invoice_items', []); ERP.save('invoice_items', allItems.concat(items));
      alert('Saved ✓');
      CART=[]; renderCart();
    });

    // initial render
    renderCart();
  }

  // ================= PURCHASE → STOCK =================
  function wirePurchase(root=document){
    const get = (k) => (
      $(`[data-purchase="${k}"]`, root) || $(`#pur${k[0].toUpperCase()+k.slice(1)}`, root)
    );
    const btnAdd = $('[data-purchase="add"]', root) || $('#btnAddPurchase', root);
    const msg =   $('[data-purchase="msg"]', root) || $('#purMsg', root);

    btnAdd?.addEventListener('click', ()=>{
      const pl = [{
        name:   get('name')?.value?.trim()   || '',
        barcode:get('code')?.value?.trim()   || '',
        code:   get('code')?.value?.trim()   || '',
        batch:  get('batch')?.value?.trim()  || '',
        expiry: get('expiry')?.value?.trim() || '',
        qty:    parseNum(get('qty')?.value || 0),
        mrp:    parseNum(get('mrp')?.value || 0),
        gst:    parseNum(get('gst')?.value || 0),
      }];
      if(!pl[0].barcode && !pl[0].name) { msg && (msg.textContent='Need name or barcode'); return; }
      const inv = ERP.load('inventory', []);
      ERP.applyPurchaseRows(inv, pl);
      msg && (msg.textContent='Added to stock ✅');
      if(get('qty')) get('qty').value='';
    });
  }

  // ================= STOCK LIST =================
  function wireStock(root=document){
    const search = $('[data-stock="search"]', root) || $('#stockSearch', root);
    const filter = $('[data-stock="filter"]', root) || $('#stockFilter', root);
    const body   = $('[data-stock="body"]', root)   || $('#stockBody', root);
    const btnExp = $('[data-stock="export"]', root) || $('#btnExportStock', root);

    function expiryState(expiry){
      if(!expiry) return 'ok';
      const d = new Date(expiry.length===7? expiry+'-01' : expiry);
      const now = new Date();
      const diff = (d - now)/86400000;
      if(diff < -1) return 'expired';
      if(diff <= 60) return 'near';
      return 'ok';
    }
    function render(){
      const inv = ERP.load('inventory', []);
      const q = (search?.value||'').toLowerCase();
      const rows = inv.filter(r=>{
        if(q && !((r.name||'').toLowerCase().includes(q) || (r.batch||'').toLowerCase().includes(q))) return false;
        const st = expiryState(r.expiry);
        const f = filter?.value || 'all';
        if(f==='near') return st==='near';
        if(f==='expired') return st==='expired';
        if(f==='low') return parseNum(r.qty||0) <= parseNum(r.min||r.min_qty||5);
        return true;
      }).map(r=>{
        const st = expiryState(r.expiry);
        const label = st==='ok' ? 'OK' : (st==='near'?'Near':'Expired');
        return `<tr>
          <td>${r.name||''}</td>
          <td>${r.batch||''}</td>
          <td>${r.expiry||''}</td>
          <td>${r.qty||0}</td>
          <td>₹ ${(parseNum(r.mrp||0)).toFixed(2)}</td>
          <td>${label}</td>
        </tr>`;
      }).join('');
      if(body) body.innerHTML = rows || '<tr><td class="muted" colspan="6">No rows</td></tr>';
    }
    search?.addEventListener('input', render);
    filter?.addEventListener('change', render);
    btnExp?.addEventListener('click', ()=> ERP.downloadCSV('stock_export.csv', ERP.load('inventory', [])));
    render();
  }

  // ================= REPORTS =================
  function wireReports(root=document){
    const from = $('[data-reports="from"]', root) || $('#repFrom', root);
    const to   = $('[data-reports="to"]', root)   || $('#repTo', root);
    const btn  = $('[data-reports="run"]', root)  || $('#btnRunReports', root);
    const quicks = $$('[data-q]', root);

    const rpTotal = $('[data-kpi="rpTotal"]', root) || $('#rpTotal', root);
    const rpAvg   = $('[data-kpi="rpAvg"]', root)   || $('#rpAvg', root);
    const rpInv   = $('[data-kpi="rpInv"]', root)   || $('#rpInv', root);
    const rpPaid  = $('[data-kpi="rpPaid"]', root)  || $('#rpPaid', root);
    const topBody = $('[data-reports="top-body"]', root) || $('#topItemsBody', root);

    function setRange(days){
      const t=new Date(); t.setHours(0,0,0,0);
      const f=new Date(t); f.setDate(t.getDate()-days+1);
      if(from) from.value=f.toISOString().slice(0,10);
      if(to)   to.value=t.toISOString().slice(0,10);
    }
    function MTD(){
      const d=new Date();
      if(from) from.value=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-01`;
      if(to)   to.value=new Date().toISOString().slice(0,10);
    }

    quicks.forEach(b=> b.addEventListener('click', ()=>{
      const q=b.dataset.q; if(q==='today') setRange(1); if(q==='7d') setRange(7); if(q==='30d') setRange(30); if(q==='mtd') MTD();
      run();
    }));

    function run(){
      const invsAll = ERP.load('invoices', []);
      const itemsAll = ERP.load('invoice_items', []);
      const invs = ERP.filterInvoicesByDate(invsAll, from?.value, to?.value);
      const ids = new Set(invs.map(i=> i.id||i.invoice_id));
      const items = itemsAll.filter(x=> ids.has(x.invoice_id));

      const k = ERP.buildSalesKPIs(invs, items);
      if(rpTotal) rpTotal.textContent = k.total.toFixed(2);
      const days = Math.max(1, Math.ceil((new Date(to?.value) - new Date(from?.value))/86400000) + 1);
      if(rpAvg)   rpAvg.textContent   = (k.total/days).toFixed(2);
      if(rpInv)   rpInv.textContent   = String(k.invoices);
      if(rpPaid)  rpPaid.textContent  = k.paid.toFixed(2);

      const top = ERP.topItems(items, 10);
      if(topBody) topBody.innerHTML = top.length
        ? top.map(r=> `<tr><td>${r.name}</td><td>${r.qty}</td><td>₹ ${r.amount.toFixed(2)}</td></tr>`).join('')
        : '<tr><td class="muted" colspan="3">—</td></tr>';
    }

    // defaults
    setRange(7); run();
    btn?.addEventListener('click', run);
  }

  // ================= PUBLIC API =================
  function initPharmacy(root=document){
    try { wireSell(root); } catch(e){ console.warn('Sell wiring skipped:', e); }
    try { wirePurchase(root); } catch(e){ console.warn('Purchase wiring skipped:', e); }
    try { wireStock(root); } catch(e){ console.warn('Stock wiring skipped:', e); }
    try { wireReports(root); } catch(e){ console.warn('Reports wiring skipped:', e); }
  }

  global.PharmacyCore = { initPharmacy };

})(window);
