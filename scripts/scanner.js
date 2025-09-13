/* =======================================================
   scanner.js — Camera barcode scanner (simple + fallback)
   Usage:
     const stop = await startScanner({
       containerId: 'videoBox',
       onDetected: (code)=>{...},
       onError: (e)=>{...}
     });
     // later: stop()
   ======================================================= */

window.startScanner = async function startScanner(opts = {}) {
  const { containerId, onDetected, onError } = opts;
  const el = document.getElementById(containerId);
  if (!el) throw new Error('Scanner container not found: '+containerId);

  // Style container
  el.innerHTML = '';
  el.style.position = 'relative';
  el.style.background = '#000';
  el.style.borderRadius = '12px';
  el.style.overflow = 'hidden';
  el.style.minHeight = '220px';

  // Fallback if no camera or no API
  const fallback = () => {
    const wrap = document.createElement('div');
    wrap.style.padding = '12px';
    wrap.style.color = '#fff';
    wrap.innerHTML = `
      <p style="margin:0 0 8px">Camera unavailable. Enter code manually:</p>
      <div style="display:flex;gap:8px">
        <input id="scan-manual" placeholder="Type barcode..." style="flex:1;border-radius:8px;border:1px solid #334; padding:8px">
        <button id="scan-ok" class="chip" style="border:0;background:#0ea5e9;color:#001;cursor:pointer;border-radius:8px;padding:8px 12px">OK</button>
      </div>`;
    el.appendChild(wrap);
    const input = wrap.querySelector('#scan-manual');
    const btn = wrap.querySelector('#scan-ok');
    btn.onclick = () => { const v = input.value.trim(); if(v && onDetected) onDetected(v); };
    return () => { /* nothing to stop */ };
  };

  // Prefer native BarcodeDetector
  let stream; let raf; let running = true;
  if (!('BarcodeDetector' in window)) {
    try { return fallback(); } catch(e){ onError?.(e); return ()=>{}; }
  }

  try {
    const BarcodeDetector = window.BarcodeDetector;
    const supported = await BarcodeDetector.getSupportedFormats?.();
    const formats = supported?.length ? supported : ['qr_code','code_128','ean_13','upc_e','upc_a'];
    const detector = new BarcodeDetector({ formats });

    const video = document.createElement('video');
    video.setAttribute('playsinline','');
    video.style.width = '100%'; video.style.height = '100%'; video.style.objectFit = 'cover';
    el.appendChild(video);

    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    video.srcObject = stream; await video.play();

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');

    async function tick(){
      if(!running) return;
      if(video.readyState >= 2){
        canvas.width = video.videoWidth; canvas.height = video.videoHeight;
        ctx.drawImage(video,0,0,canvas.width,canvas.height);
        const bitmap = await createImageBitmap(canvas);
        try{
          const codes = await detector.detect(bitmap);
          if (codes && codes.length) {
            running = false;
            const code = codes[0].rawValue || codes[0].raw || '';
            onDetected && onDetected(String(code));
          }
        }catch(e){ /* ignore per-frame errors */ }
      }
      raf = requestAnimationFrame(tick);
    }
    tick();

    const stop = ()=> {
      running = false;
      try { cancelAnimationFrame(raf); } catch {}
      try { video.pause(); } catch {}
      try { stream?.getTracks?.().forEach(t=>t.stop()); } catch {}
      try { el.innerHTML = ''; } catch {}
    };
    return stop;

  } catch (e) {
    onError?.(e);
    return fallback();
  }
};
