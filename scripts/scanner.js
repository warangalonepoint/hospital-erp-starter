// /scripts/scanner.js
// Uses ZXing to read EAN/UPC/QR from the device camera
// Works offline via unpkg CDN module; no backend.
import {
  BrowserMultiFormatReader,
  NotFoundException
} from "https://unpkg.com/@zxing/library@0.20.0/esm/index.min.js";

let codeReader;
let currentDeviceId = null;

export async function startScan(videoEl, onResult, facing = "environment") {
  stopScan();
  codeReader = new BrowserMultiFormatReader();

  // Pick a camera that matches facing; fallback to first
  const devices = await BrowserMultiFormatReader.listVideoInputDevices();
  if (!devices?.length) throw new Error("No camera devices found");
  const pick =
    devices.find(d => d.label.toLowerCase().includes(facing)) || devices[0];
  currentDeviceId = pick.deviceId;

  await codeReader.decodeFromVideoDevice(currentDeviceId, videoEl, (res, err) => {
    if (res?.getText) onResult(res.getText());
    if (err && !(err instanceof NotFoundException)) {
      console.warn("Decode error:", err);
    }
  });
}

export function stopScan() {
  try { codeReader?.reset(); } catch {}
}

export async function switchCamera(videoEl, onResult) {
  const devices = await BrowserMultiFormatReader.listVideoInputDevices();
  if (!devices?.length) return;
  const idx = devices.findIndex(d => d.deviceId === currentDeviceId);
  const next = devices[(idx + 1) % devices.length];
  stopScan();
  await startScan(videoEl, onResult, next.label.toLowerCase().includes("back") ? "environment":"user");
}
