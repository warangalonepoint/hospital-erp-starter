// /scripts/scanner.js
(function () {
  function getReader() {
    if (window.ZXingBrowser?.BrowserMultiFormatReader) {
      return new window.ZXingBrowser.BrowserMultiFormatReader();
    }
    if (window.ZXing?.BrowserMultiFormatReader) {
      return new window.ZXing.BrowserMultiFormatReader();
    }
    return null;
  }

  window.startScanner = function (callback) {
    const reader = getReader();
    if (!reader) {
      alert("Scanner library not loaded. Check network / script tag.");
      return;
    }

    const overlay = document.createElement("div");
    overlay.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.85);display:flex;align-items:center;justify-content:center;z-index:9999;padding:16px";
    const box = document.createElement("div");
    box.style.cssText = "background:#0f1117;border-radius:16px;padding:12px;max-width:560px;width:100%;color:#fff";
    box.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
        <b>Scan barcode</b>
        <button id="scanClose" style="background:#fff;border:none;border-radius:10px;padding:6px 10px;font-weight:700">Close</button>
      </div>
      <video id="scanPreview" playsinline style="width:100%;max-height:360px;border-radius:12px;background:#000"></video>
      <div style="opacity:.7;margin-top:6px;font-size:.9rem">Allow camera permission. Aim at the code.</div>
    `;
    overlay.appendChild(box);
    document.body.appendChild(overlay);

    const video = box.querySelector("#scanPreview");
    let closed = false;

    const shutdown = () => {
      if (closed) return;
      closed = true;
      try { reader.reset(); } catch {}
      overlay.remove();
    };

    try {
      reader.decodeFromVideoDevice(null, video, (result) => {
        if (result) {
          shutdown();
          callback(String(result.text || "").trim());
        }
      });
    } catch (e) {
      alert("Camera access failed: " + e.message);
      shutdown();
    }

    box.querySelector("#scanClose").onclick = shutdown;
  };
})();
