/* scanner.js — robust camera barcode scanner overlay using ZXing UMD.
   Include one of these in the page (we already added one in pharmacy.html):
   <script src="https://unpkg.com/@zxing/browser@0.1.5/umd/index.min.js"></script>
*/
(function () {
  function getReader() {
    // Support both UMD names: ZXingBrowser and ZXing
    const NS = (window.ZXingBrowser || window.ZXing || {});
    return NS.BrowserMultiFormatReader ? new NS.BrowserMultiFormatReader() : null;
  }

  window.startScanner = function (callback) {
    const reader = getReader();
    if (!reader) {
      alert('Scanner library not loaded. Check network / script tag.');
      return;
    }

    // Overlay
    const overlay = document.createElement('div');
    overlay.style.cssText =
      'position:fixed;inset:0;background:rgba(0,0,0,.85);display:flex;align-items:center;justify-content:center;z-index:9999;padding:16px';
    const box = document.createElement('div');
    box.style.cssText =
      'background:#0f1117;border-radius:16px;padding:12px;max-width:560px;width:100%;color:#fff';
    box.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
        <b>Scan barcode</b>
        <button id="scanClose" style="background:#fff;border:none;border-radius:10px;padding:6px 10px;font-weight:700">Close</button>
      </div>
      <video id="scanPreview" playsinline style="width:100%;max-height:360px;border-radius:12px;background:#000"></video>
      <div id="scanMsg" style="opacity:.7;margin-top:6px;font-size:.9rem">Allow camera permission. Aim at the code.</div>
    `;
    overlay.appendChild(box);
    document.body.appendChild(overlay);

    const video = box.querySelector('#scanPreview');
    const msg = box.querySelector('#scanMsg');

    let closed = false;
    const shutdown = () => {
      if (closed) return;
      closed = true;
      try { reader.reset(); } catch {}
      overlay.remove();
    };

    // Start
    try {
      reader.decodeFromVideoDevice(null, video, (result, err) => {
        if (result) {
          const text = String(result.text || '').trim();
          shutdown();
          if (text) callback(text);
        }
        // ignore decode errors; they are frequent when no code in view
      });
    } catch (e) {
      msg.textContent = 'Cannot start camera. Use HTTPS and allow permission.';
      console.warn('Scanner error', e);
    }

    box.querySelector('#scanClose').onclick = shutdown;
  };
})();
