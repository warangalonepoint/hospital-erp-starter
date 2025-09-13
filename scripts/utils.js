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
