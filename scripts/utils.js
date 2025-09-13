// /scripts/utils.js

// tiny CSV parser (no quotes; good for our simple data)
export function parseCSV(text) {
  const [headerLine, ...lines] = text.trim().split(/\r?\n/);
  const headers = headerLine.split(',').map(h=>h.trim());
  return lines.filter(Boolean).map(line=>{
    const cells = line.split(',').map(v=>v.trim());
    const obj = {}; headers.forEach((h,i)=>obj[h]=cells[i]); return obj;
  });
}

// cache-busted fetch (avoids stale CSV on Vercel)
export async function fetchCSV(path) {
  const u = `${path}${path.includes('?') ? '&' : '?'}v=${Date.now()}`;
  const txt = await fetch(u, { cache: 'no-store' }).then(r=>r.text());
  return parseCSV(txt);
}

export function formatINR(n) {
  return Number(n||0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// group array of rows by a key function → {key: sum}
export function sumBy(rows, keyFn, valueFn) {
  const m = new Map();
  rows.forEach(r=>{
    const k = keyFn(r);
    const v = Number(valueFn(r)) || 0;
    m.set(k, (m.get(k)||0) + v);
  });
  return m;
}

// simple SVG bar chart
export function renderBars(el, series, {height=160,pad=24}={}) {
  if (!el) return;
  const w = el.clientWidth || 600, h = height;
  const max = Math.max(1, ...series.map(s=>Number(s.value)||0));
  const barW = (w - pad*2) / Math.max(1, series.length);
  const bars = series.map((s,i)=>{
    const x = pad + i*barW + 4;
    const bh = Math.round(((Number(s.value)||0)/max) * (h - pad*2));
    const y = h - pad - bh;
    const title = s.label.replace(/"/g,'&quot;') + ' · ' + formatINR(s.value);
    return `<rect x="${x}" y="${y}" width="${Math.max(4,barW-8)}" height="${bh}" rx="6" ry="6"><title>${title}</title></rect>`;
  }).join('');
  el.innerHTML = `<svg width="100%" height="${h}" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#69b8ff"/><stop offset="100%" stop-color="#b384ff"/>
    </linearGradient></defs>
    ${bars.replaceAll("<rect", "<rect fill='url(#g)'")}
  </svg>`;
}

// quick CSV download from array of objects
export function downloadCSV(filename, rows) {
  if (!rows?.length) return;
  const headers = Object.keys(rows[0]);
  const lines = [headers.join(',')].concat(
    rows.map(r => headers.map(h => (r[h] ?? '')).join(','))
  );
  const blob = new Blob([lines.join('\n')], {type:'text/csv'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(()=>URL.revokeObjectURL(a.href), 500);
}
