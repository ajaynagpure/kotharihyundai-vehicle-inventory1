"use strict";
/* =====================================================================
   UI HELPERS (loaded right after core.js)
   - mountPaged : "Showing 51–100 of 136  ‹ Prev  Page 2 / 3  Next ›" on every list
   - filterBtn / filterPanel : one neat Filter button used on every screen
   - openScanner : camera barcode / QR scan for VIN fields
   - globalVinSearch : VIN search in the top bar (opens vehicle details)
   - storage helpers : signed URLs + download for gate photos / gate passes
   ===================================================================== */

/* ---------------------------------------------------------------- Pagination */
const pageSize = () => parseInt(state.settings?.sys?.vehicle_page_size, 10) || 50;

function pagerHtml(total, page, size){
  const pages = Math.max(1, Math.ceil(total / size)), from = total ? page * size + 1 : 0, to = Math.min(total, (page + 1) * size);
  return `<div class="pager"><span>Showing ${from.toLocaleString("en-IN")}–${to.toLocaleString("en-IN")} of ${total.toLocaleString("en-IN")}</span>
    <span><button class="secondary-btn" type="button" data-pg="prev" ${page === 0 ? "disabled" : ""}>‹ Prev</button>
    <span class="pager-page">Page ${page + 1} / ${pages}</span>
    <button class="secondary-btn" type="button" data-pg="next" ${page + 1 >= pages ? "disabled" : ""}>Next ›</button></span></div>`;
}
/** Draws a paged table into `el`.
 *  cfg = { headers, rows: array | () => array (each row = array of cells), footer: cells | (allRows) => cells,
 *          size, empty, onDraw(el, pageRows, offset) }   Returns {draw(), reset()} */
function mountPaged(el, cfg){
  let page = 0;
  let sortIndex = -1, sortDirection = 1;
  const size = cfg.size || pageSize();
  const draw = () => {
    if(!el.isConnected) return;
    const allRows = typeof cfg.rows === "function" ? cfg.rows() : cfg.rows;
    const rows = sortIndex < 0 ? allRows : [...allRows].map((row,i) => ({row,i})).sort((a,b) => compareTableValues(a.row[sortIndex],b.row[sortIndex],cfg.headers[sortIndex],sortDirection) || a.i-b.i).map(x => x.row);
    const pages = Math.max(1, Math.ceil(rows.length / size)); page = Math.min(page, pages - 1);
    const slice = rows.slice(page * size, page * size + size);
    if(!rows.length){ el.innerHTML = emptyState(cfg.empty || "No records found."); cfg.onDraw?.(el, [], 0); return; }
    const foot = cfg.footer ? (typeof cfg.footer === "function" ? cfg.footer(rows) : cfg.footer) : null;
    el.innerHTML = `<div class="table-scroll">${table(cfg.headers, slice, foot)}</div>${pagerHtml(rows.length, page, size)}`;
    const tableEl = el.querySelector("table");
    if(tableEl){
      tableEl.querySelectorAll("thead th").forEach(th => {
        if(Number(th.dataset.sortIndex) === sortIndex && sortIndex >= 0){ th.dataset.sortDirection = sortDirection > 0 ? "asc" : "desc"; th.setAttribute("aria-sort", sortDirection > 0 ? "ascending" : "descending"); }
      });
      PAGED_TABLE_SORT.set(tableEl, {setSort(index,direction){ sortIndex=index; sortDirection=direction; page=0; draw(); }});
    }
    el.querySelector('[data-pg="prev"]').onclick = () => { page--; draw(); };
    el.querySelector('[data-pg="next"]').onclick = () => { page++; draw(); };
    cfg.onDraw?.(el, slice, page * size);
  };
  draw();
  return {draw, reset(){ page = 0; draw(); }};
}

/* ------------------------------------------------------------- Filter button */
const filterBtn = (id, label = "Filter") => `<button type="button" class="filter-btn" data-filter-toggle="${id}" aria-expanded="false">▽ ${esc(label)}<span class="filter-count" hidden></span></button>`;
const filterPanel = (id, inner, open = false) => `<div class="filter-panel" id="${id}" ${open ? "" : "hidden"}>${inner}</div>`;
function filterBadge(panel){
  const btn = document.querySelector(`[data-filter-toggle="${panel.id}"]`); if(!btn) return;
  const n = [...panel.querySelectorAll("input:not([type=checkbox]):not([type=file]), select")].filter(i => i.value && i.value !== "ALL").length;
  const b = btn.querySelector(".filter-count"); b.textContent = n; b.hidden = !n; btn.classList.toggle("on", n > 0);
}
document.addEventListener("click", e => {
  const b = e.target.closest?.("[data-filter-toggle]"); if(!b) return;
  const p = document.getElementById(b.dataset.filterToggle); if(!p) return;
  p.hidden = !p.hidden; b.setAttribute("aria-expanded", String(!p.hidden));
});
["input", "change"].forEach(ev => document.addEventListener(ev, e => { const p = e.target.closest?.(".filter-panel"); if(p) filterBadge(p); }));

/* ----------------------------------------------------------- Storage helpers */
const nameOfPath = p => String(p || "").split("/").pop() || "file.jpg";
async function signedUrls(paths, expires = 3600){
  const list = [...new Set((paths || []).filter(Boolean))], out = {};
  if(!list.length || !state.supabase) return out;
  const r = await state.supabase.storage.from(GATE_BUCKET).createSignedUrls(list, expires);
  (r.data || []).forEach(o => { if(o.signedUrl) out[o.path] = o.signedUrl; });
  return out;
}
async function downloadPath(path, fileName){
  try {
    const r = await state.supabase.storage.from(GATE_BUCKET).createSignedUrl(path, 300, {download: fileName || nameOfPath(path)});
    if(r.error || !r.data?.signedUrl) return toast("Download failed: " + (r.error?.message || "file not found"), "error");
    const a = document.createElement("a"); a.href = r.data.signedUrl; a.download = fileName || nameOfPath(path); document.body.appendChild(a); a.click(); a.remove();
  } catch(err){ toast("Download failed: " + (err.message || err), "error"); }
}

/* --------------------------------------------------------------- VIN scanner */
function cleanScan(text){
  const t = String(text || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const m = /[A-HJ-NPR-Z0-9]{17}/.exec(t);          // real VINs never contain I, O, Q
  return m ? m[0] : t;
}
/** Hyundai label: barcodes carry only the 6-digit serial (e.g. "FHY 340539" / "33340539"); the first 11 chars
 *  (MALPA813LTM) are printed text. So: full VIN -> use it; 11-char prefix -> remember; trailing 6 digits -> serial. */
function parseScan(text){
  const t = String(text || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const full = /[A-HJ-NPR-Z0-9]{17}/.exec(t);
  if(full) return {vin: full[0]};
  if(/^[A-HJ-NPR-Z]{3}[A-HJ-NPR-Z0-9]{8}$/.test(t)) return {prefix: t};
  const m = /(\d{6})$/.exec(t);
  return m ? {serial: m[1]} : {};
}
/** serial (+ optional 11-char prefix) -> full 17-char VIN from stock. Returns {vin} | {need:"prefix", count} | {vin:null} */
async function resolveSerial(serial, prefix){
  if(prefix && prefix.length === 11 && !state.supabase) return {vin: prefix + serial};
  if(!state.supabase) return {vin: null};
  const r = await state.supabase.from("vehicles").select("vin").ilike("vin", `%${serial}`).limit(20);
  if(r.error) return {vin: prefix && prefix.length === 11 ? prefix + serial : null};
  let rows = (r.data || []).map(x => String(x.vin || "").toUpperCase()).filter(v => v.length === 17 && v.endsWith(serial));
  if(prefix) rows = rows.filter(v => v.startsWith(prefix));
  if(rows.length === 1) return {vin: rows[0]};
  if(rows.length > 1) return {need: "prefix", count: rows.length};
  return prefix && prefix.length === 11 ? {vin: prefix + serial} : {vin: null};
}
let zxingLoading = null;
function loadZxing(){
  if(window.ZXingBrowser) return Promise.resolve(window.ZXingBrowser);
  return zxingLoading ||= new Promise((res, rej) => {
    const s = document.createElement("script"); s.src = "https://cdn.jsdelivr.net/npm/@zxing/browser@0.1.5/umd/zxing-browser.min.js";
    s.onload = () => res(window.ZXingBrowser); s.onerror = () => { zxingLoading = null; rej(new Error("scanner library could not load")); }; document.head.appendChild(s);
  });
}
/** Opens the camera, calls onResult(vin) on the first code found. Works with the browser BarcodeDetector,
 *  falls back to ZXing, and always offers "take a photo of the barcode". */
async function openScanner(onResult, {captureImage = false} = {}){
  openModal(`<div class="modal-bg" id="scanBg"><div class="modal scan-modal" role="dialog" aria-modal="true" aria-label="Scan VIN">
    <div class="panel-head"><h3>Scan VIN No. barcode</h3><button class="icon-btn" type="button" id="scanClose" aria-label="Close">×</button></div>
    <video id="scanVideo" playsinline muted autoplay></video><p id="scanMsg" class="form-help">Point the camera at the VIN barcode or QR code.</p>
    <div id="scanPrefixBox" style="display:none;margin:6px 0"><input id="scanPrefix" maxlength="11" placeholder="VIN पहिले 11 characters (e.g. MALPA813LTM)" style="width:100%;text-transform:uppercase"></div>
    <div class="form-actions"><label class="secondary-btn scan-photo">📷 Take / choose photo<input id="scanFile" type="file" accept="image/*" capture="environment" hidden></label>
    <button type="button" class="secondary-btn" id="scanCancel">Cancel</button></div></div></div>`);
  const msg = t => { const m = $("scanMsg"); if(m) m.textContent = t; };
  let stream = null, timer = null, zxControls = null, finished = false, finishing = false, scannedImage = null;
  const stop = () => { finished = true; clearInterval(timer); try { zxControls?.stop(); } catch { /* ignore */ } stream?.getTracks().forEach(t => t.stop()); closeModal(); document.removeEventListener("keydown", onKey); };
  const onKey = e => { if(e.key === "Escape") stop(); };
  document.addEventListener("keydown", onKey);
  const captureScannedImage = async () => {
    if(!captureImage) return null;
    if(scannedImage) return scannedImage;
    const video = $("scanVideo");
    if(!video?.videoWidth || !video?.videoHeight) return null;
    const canvas = document.createElement("canvas"); canvas.width = video.videoWidth; canvas.height = video.videoHeight;
    const context = canvas.getContext("2d"); if(!context) return null;
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/jpeg", 0.92));
    return blob ? new File([blob], "Vehicle_Right_Side_QR.jpg", {type:"image/jpeg", lastModified:Date.now()}) : null;
  };
  const acc = {prefix:null, serial:null, tried:null}, finish = async vin => {
    if(finished || finishing) return;
    finishing = true;
    const image = await captureScannedImage();
    stop(); onResult(vin, image);
  };
  const showPrefixBox = () => { const b = $("scanPrefixBox"); if(b) b.style.display = "block"; };
  const resolveAcc = async () => {
    if(finished || !acc.serial) return;
    const key = acc.serial + "|" + (acc.prefix || ""); if(acc.tried === key) return; acc.tried = key;
    msg("Serial " + acc.serial + " सापडला — stock मधून full VIN शोधत आहे…");
    const r = await resolveSerial(acc.serial, acc.prefix);
    if(finished) return;
    if(r.vin) return finish(r.vin);
    showPrefixBox();
    msg(r.need ? r.count + " vehicles मध्ये " + acc.serial + " आहे — VIN चे पहिले 11 characters (MALPA813LTM) टाका."
               : acc.serial + " stock मध्ये नाही — नवीन vehicle साठी VIN चे पहिले 11 characters (MALPA813LTM) टाका.");
  };
  const found = text => {
    if(finished) return; const p = parseScan(text);
    if(p.vin) return finish(p.vin);
    if(p.prefix) acc.prefix = p.prefix; if(p.serial) acc.serial = p.serial;
    if(acc.serial) resolveAcc();
  };
  $("scanPrefix")?.addEventListener("input", e => {
    const v = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""); e.target.value = v;
    if(v.length === 11 && acc.serial){ acc.prefix = v; acc.tried = null; resolveAcc(); }
  });
  $("scanClose").onclick = stop; $("scanCancel").onclick = stop;

  let detector = null;
  if(window.BarcodeDetector){ try { detector = new BarcodeDetector({formats:["code_128","code_39","code_93","qr_code","data_matrix","pdf417","ean_13","itf","codabar"]}); } catch { try { detector = new BarcodeDetector(); } catch { detector = null; } } }

  $("scanFile").addEventListener("change", async e => {              // photo of the barcode
    const f = e.target.files[0]; if(!f) return; scannedImage = f; msg("Reading photo…");
    try {
      if(detector){ const codes = await detector.detect(await createImageBitmap(f)); if(codes.length){ codes.forEach(c => found(c.rawValue)); return; } }
      const Z = await loadZxing(), url = URL.createObjectURL(f);
      try { const r = await new Z.BrowserMultiFormatReader().decodeFromImageUrl(url); found(r.getText()); return; } finally { URL.revokeObjectURL(url); }
    } catch { msg("No barcode found in that photo. Try again closer, or type the VIN."); }
  });

  if(!navigator.mediaDevices?.getUserMedia){ msg("Camera not available here (needs https). Use “Take / choose photo” or type the VIN."); return; }
  try { stream = await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:"environment"}}, audio:false}); }
  catch { msg("Camera permission denied. Use “Take / choose photo” or type the VIN."); return; }
  if(finished){ stream.getTracks().forEach(t => t.stop()); return; }
  const video = $("scanVideo"); video.srcObject = stream; try { await video.play(); } catch { /* autoplay */ }
  if(detector){
    timer = setInterval(async () => { if(finished || video.readyState < 2) return; try { const c = await detector.detect(video); c.forEach(x => found(x.rawValue)); } catch { /* keep trying */ } }, 300);
  } else {
    try {
      const Z = await loadZxing(); stream.getTracks().forEach(t => t.stop()); stream = null;
      if(finished) return;
      zxControls = await new Z.BrowserMultiFormatReader().decodeFromVideoDevice(undefined, "scanVideo", res => { if(res) found(res.getText()); });
    } catch { msg("Live scan is not supported on this browser. Use “Take / choose photo” or type the VIN."); }
  }
}

/* ------------------------------------------- Vehicle details + top-bar VIN search */
function openVehicleDetails(v){
  const keys = [...VEHICLE_EXPORT_COLS], rows = keys.filter(k => !isBlank(v[k])).map(k => [FIELD_HEADING[k], k === "status" ? statusBadge(v[k]) : fmtCell(FIELD_TYPE[k], v[k])]);
  if(v.location_id) rows.push(["Location", locName(v.location_id)]);
  openModal(`<div class="modal-bg" id="vdBg"><div class="modal" role="dialog" aria-modal="true" aria-label="Vehicle details">
    <div class="panel-head"><h3 class="mono">${esc(v.vin || v.order_no || "Vehicle")}</h3><div class="report-tools">${can("documents") ? `<button class="secondary-btn" type="button" id="vdDocs">📄 Documents</button>` : ""}<button class="icon-btn" type="button" id="modalClose" aria-label="Close">×</button></div></div>
    <div class="table-wrap">${table(["Field","Value"], rows)}</div></div></div>`);
  $("modalClose").onclick = closeModal; $("vdBg").addEventListener("mousedown", e => { if(e.target.id === "vdBg") closeModal(); });
  if($("vdDocs")) $("vdDocs").onclick = () => { state.docVin = v.vin; closeModal(); navigate("documents"); };
}
async function globalVinSearch(e){
  e?.preventDefault();
  const input = $("globalVin"), q = cleanQuery(input.value).replace(/\s+/g, "").toUpperCase();
  const suggestions = $("globalVinSuggestions"); if(suggestions) suggestions.hidden = true;
  if(q.length < 3) return toast("Enter at least 3 characters of the VIN.", "error");
  if(!state.supabase) return toast("Connect Supabase first.", "error");
  const r = await state.supabase.from("vehicles").select("*").ilike("vin", `%${q}%`).limit(30);
  if(r.error) return toast(r.error.message, "error");
  await getLocations();
  const list = r.data || [];
  if(!list.length) return toast("No vehicle found for " + q, "error");
  input.value = "";
  if(list.length === 1) return openVehicleDetails(list[0]);
  openModal(`<div class="modal-bg" id="vdBg"><div class="modal wide" role="dialog" aria-modal="true"><div class="panel-head"><h3>${list.length} vehicles match “${esc(q)}”</h3><button class="icon-btn" type="button" id="modalClose">×</button></div>
    <div class="table-wrap">${table(["VIN No.","Model","Variant","Color","Status",""], list.map((v, i) => [raw(`<b class="mono">${esc(v.vin)}</b>`), v.model, v.variant, v.color, statusBadge(v.status), raw(`<button class="table-icon-btn" type="button" data-i="${i}">Details</button>`)]))}</div></div></div>`);
  $("modalClose").onclick = closeModal; $("vdBg").addEventListener("mousedown", ev => { if(ev.target.id === "vdBg") closeModal(); });
  document.querySelectorAll("#vdBg [data-i]").forEach(b => b.addEventListener("click", () => openVehicleDetails(list[+b.dataset.i])));
}
let globalSuggestionTimer = null, globalSuggestionRequest = 0;
async function loadGlobalVinSuggestions(){
  const input = $("globalVin"), box = $("globalVinSuggestions");
  if(!input || !box) return;
  const q = cleanQuery(input.value).replace(/\s+/g, "").toUpperCase(), request = ++globalSuggestionRequest;
  if(q.length < 3 || !state.supabase){ box.hidden = true; box.innerHTML = ""; return; }
  const result = await state.supabase.from("vehicles").select("id,vin,model,variant,engine_no,color,location_id,status").ilike("vin", `%${q}%`).limit(8);
  if(request !== globalSuggestionRequest || q !== cleanQuery(input.value).replace(/\s+/g, "").toUpperCase()) return;
  if(result.error){ box.hidden = true; return; }
  const rows = result.data || [];
  if(rows.length) await getLocations();
  if(request !== globalSuggestionRequest || q !== cleanQuery(input.value).replace(/\s+/g, "").toUpperCase()) return;
  box.innerHTML = rows.length ? rows.map((v,i) => `<button type="button" class="global-vin-suggestion" data-global-vin="${i}">
    <span class="global-vin-main"><b class="mono">${esc(v.vin || "-")}</b><small>Model: ${esc(v.model || "-")} · Variant: ${esc(v.variant || "-")}</small><small>Engine No.: ${esc(v.engine_no || "-")} · Color: ${esc(v.color || "-")}</small><small>Location: ${esc(vLocName(v))}</small></span>
    ${statusBadge(v.status).html}</button>`).join("") : `<div class="global-vin-suggestion-empty">No matching vehicles.</div>`;
  box.hidden = false;
  box.querySelectorAll("[data-global-vin]").forEach(button => button.addEventListener("mousedown", async event => {
    event.preventDefault(); const vehicle = rows[Number(button.dataset.globalVin)]; if(!vehicle) return;
    box.hidden = true; input.value = ""; await getLocations(); openVehicleDetails(vehicle);
  }));
}
document.addEventListener("DOMContentLoaded", () => {
  const form = $("globalSearch"), input = $("globalVin"), box = $("globalVinSuggestions");
  form?.addEventListener("submit", globalVinSearch);
  input?.addEventListener("input", () => { clearTimeout(globalSuggestionTimer); globalSuggestionTimer = setTimeout(loadGlobalVinSuggestions, 250); });
  document.addEventListener("click", event => { if(box && !event.target.closest("#globalSearch")) box.hidden = true; });
});
