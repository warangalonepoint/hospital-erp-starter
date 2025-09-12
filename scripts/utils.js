// /scripts/utils.js

// tiny CSV parser
export function parseCSV(text) {
  const [headerLine, ...lines] = text.trim().split(/\r?\n/);
  const headers = headerLine.split(',').map(h=>h.trim());
  return lines.filter(Boolean).map(line=>{
    const cells = line.split(',').map(v=>v.trim());
    const obj = {}; headers.forEach((h,i)=>obj[h]=cells[i]); return obj;
  });
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
    return `<rect x='${x}' y='${y}' width='${Math.max(4,barW-8)}' height='${bh}' rx='6' ry='6' />`;
  }).join('');
  el.innerHTML = `<svg width='100%' height='${h}' viewBox='0 0 ${w} ${h}' preserveAspectRatio='none'>
    <defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'>
      <stop offset='0%' stop-color='#69b8ff'/><stop offset='100%' stop-color='#b384ff'/>
    </linearGradient></defs>
    ${bars.replaceAll("<rect", "<rect fill='url(#g)'")}
  </svg>`;
}
