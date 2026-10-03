"use strict";
/* =====================================================================
   BHILARWADI "VEHICLE IN" DETAILS (8 photos + 4 tyre serials + EV battery)
   and the Gate Pass print bar shown right after a save. Loaded after gate-bulk.js.
   ===================================================================== */
const GATE_BUCKET = "gate-photos";
const IN_PHOTOS = [["photo_front","1. Vehicle Front Photo"],["photo_chassis_no","2. Vehicle Chassis No. Photo"],["photo_chassis_plate","3. Vehicle Chassis Plate Photo"],
  ["photo_form22","4. FORM 22 Photo"],["photo_cng_cert","5. Vehicle CNG Certificate Photo"],["photo_cng_kit","6. Vehicle CNG Kit Photo"],
  ["photo_ecu","7. Vehicle ECU Photo"],["photo_right_side_qr","8. Vehicle Right Side QR Photo"]];
const IN_REQUIRED_PHOTOS = [...IN_PHOTOS.slice(0,4), IN_PHOTOS[7]];
const inCount = x => IN_PHOTOS.filter(([k]) => x && x[k]).length;
const inPhotoPaths = x => IN_PHOTOS.map(([k]) => x?.[k]).filter(Boolean);
const inPdfPath = path => String(path || "").replace(/\.[^.\/]+$/, ".pdf");
const inPhotoBaseName = label => label.replace(/^\d+\.\s*/, "").trim();
const inPhotoPdfAvailable = (path, label) => nameOfPath(path) === `${inPhotoBaseName(label)}.jpg`;
const missingInPhotos = d => IN_REQUIRED_PHOTOS.filter(([k]) => !d?.files?.[k]).map(([,label]) => label);

function inBlockHtml(p){
  return `<div id="${p}Block" class="gate-in-block"><div class="gate-in-title">Vehicle IN Details</div><div class="gate-in-grid">
    ${IN_PHOTOS.map(([k,l]) => `<div class="gate-field"><label>${l}${IN_REQUIRED_PHOTOS.some(([required]) => required === k) ? ' <span>*</span>' : ""}</label><button type="button" class="gate-in-capture" data-photo-capture="${p}_${k}">📷 Click Photo</button><input type="file" accept="image/*" capture="environment" id="${p}_${k}" class="in-file" hidden><small id="${p}_${k}_n" class="in-note"></small></div>`).join("")}
    ${[1,2,3,4].map(n => `<div class="gate-field"><label>9. TYRE SERIAL NO. ${n}</label><input id="${p}_tyre${n}" autocomplete="off" placeholder="Tyre ${n} serial no."></div>`).join("")}
    <div class="gate-field"><label>10. EV BATTERY NO.</label><input id="${p}_ev" autocomplete="off" placeholder="Battery no."></div></div></div>`;
}
// Read the fields of an IN block. `keep` = files already chosen earlier (bulk modal), so re-opening does not lose them.
function readIn(p, keep = {}){
  const files = {...keep};
  for(const [k] of IN_PHOTOS){ const f = document.getElementById(`${p}_${k}`)?.files?.[0]; if(f) files[k] = f; }
  return {files, tyres:[1,2,3,4].map(n => document.getElementById(`${p}_tyre${n}`)?.value.trim() || ""), ev:document.getElementById(`${p}_ev`)?.value.trim() || ""};
}
function setIn(p, d){
  if(!d) return;
  d.tyres.forEach((t,i) => { const el = document.getElementById(`${p}_tyre${i+1}`); if(el) el.value = t; });
  const ev = document.getElementById(`${p}_ev`); if(ev) ev.value = d.ev || "";
  for(const [k,label] of IN_PHOTOS){ const n = document.getElementById(`${p}_${k}_n`); if(n && d.files[k]) n.textContent = "✔ " + inPhotoBaseName(label) + ".jpg"; }
}
function resetGateIn(){
  document.querySelectorAll("#giBlock .in-note").forEach(n => { n.textContent = ""; });
  const b = document.getElementById("giBlock"), m = document.getElementById("gateMovementType");
  if(b && m) b.hidden = m.value !== "IN";
}
function bindGateIn(){
  const m = document.getElementById("gateMovementType"); if(!m) return;
  m.addEventListener("change", resetGateIn);
}
document.addEventListener("change", e => {          // show chosen file name under every photo input
  const t = e.target; if(!t.classList?.contains("in-file")) return;
  const photo = IN_PHOTOS.find(([k]) => t.id.endsWith("_" + k));
  const n = document.getElementById(t.id + "_n");
  if(n) n.textContent = t.files[0] ? "✔ " + (photo ? inPhotoBaseName(photo[1]) + ".jpg" : t.files[0].name) : "";
});
document.addEventListener("click", e => {
  const b = e.target.closest?.("[data-photo-capture]"); if(!b) return;
  document.getElementById(b.dataset.photoCapture)?.click();
});

async function compressImage(file, max = 1800, quality = 0.82){
  if(typeof createImageBitmap !== "function") throw new Error("This browser cannot process photos. Please use a current browser.");
  const bmp = await createImageBitmap(file);
  try {
    const sc = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const c = document.createElement("canvas"); c.width = Math.round(bmp.width * sc); c.height = Math.round(bmp.height * sc);
    const ctx = c.getContext("2d"); if(!ctx) throw new Error("Could not prepare the photo for compression.");
    ctx.drawImage(bmp, 0, 0, c.width, c.height);
    const blob = await new Promise(resolve => c.toBlob(resolve, "image/jpeg", quality));
    if(!blob) throw new Error("Could not compress this photo.");
    return blob;
  } finally { bmp.close?.(); }
}
function jpegPhotoPdf(jpeg, width, height){
  const pageWidth = 595.28, pageHeight = 841.89, scale = Math.min(pageWidth / width, pageHeight / height);
  const drawWidth = width * scale, drawHeight = height * scale, x = (pageWidth - drawWidth) / 2, y = (pageHeight - drawHeight) / 2;
  const encoder = new TextEncoder(), chunks = []; let length = 0;
  const push = bytes => { chunks.push(bytes); length += bytes.length; };
  const text = value => push(encoder.encode(value));
  const offsets = [0];
  push(new Uint8Array([37,80,68,70,45,49,46,52,10,37,226,227,207,211,10]));
  const objects = [
    () => text("<< /Type /Catalog /Pages 2 0 R >>"),
    () => text("<< /Type /Pages /Kids [3 0 R] /Count 1 >>"),
    () => text(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`),
    () => { text(`<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`); push(jpeg); text("\nendstream"); },
    () => { const content = `q\n${drawWidth} 0 0 ${drawHeight} ${x} ${y} cm\n/Im0 Do\nQ\n`; text(`<< /Length ${encoder.encode(content).length} >>\nstream\n${content}endstream`); }
  ];
  objects.forEach((write, i) => { offsets.push(length); text(`${i + 1} 0 obj\n`); write(); text("\nendobj\n"); });
  const xref = length;
  text(`xref\n0 ${offsets.length}\n0000000000 65535 f \n`);
  offsets.slice(1).forEach(offset => text(`${String(offset).padStart(10, "0")} 00000 n \n`));
  text(`trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`);
  return new Blob(chunks, {type:"application/pdf"});
}
async function photoPdf(blob){
  const bmp = await createImageBitmap(blob);
  try { return jpegPhotoPdf(new Uint8Array(await blob.arrayBuffer()), bmp.width, bmp.height); }
  finally { bmp.close?.(); }
}
// Store a compressed JPEG and a matching single-photo PDF under the chassis number.
async function inExtras(chassisNo, d){
  const out = {}, safe = String(chassisNo || "").trim().replace(/[^A-Z0-9_-]/gi, "_");
  if(!safe) throw new Error("Chassis number is required to save Vehicle IN photos.");
  d.tyres.forEach((t,i) => { out["tyre_serial_" + (i+1)] = nz(t); });
  out.ev_battery_no = nz(d.ev);
  for(const [k,label] of IN_PHOTOS){
    const f = d.files[k]; if(!f) continue;
    const base = inPhotoBaseName(label), blob = await compressImage(f), pdf = await photoPdf(blob);
    const path = `${safe}/${base}.jpg`;
    const up = await state.supabase.storage.from(GATE_BUCKET).upload(path, blob, {contentType:"image/jpeg", upsert:true});
    if(up.error) throw new Error(`${label}: ${up.error.message}`);
    const pdfUp = await state.supabase.storage.from(GATE_BUCKET).upload(`${safe}/${base}.pdf`, pdf, {contentType:"application/pdf", upsert:true});
    if(pdfUp.error) throw new Error(`${label} PDF: ${pdfUp.error.message}`);
    out[k] = path;
  }
  return out;
}
async function inChassisFolder(item){
  if(item.chassis_no) return item.chassis_no;
  let q = state.supabase.from("vehicles").select("chassis_no");
  q = item.vehicle_id ? q.eq("id", item.vehicle_id) : q.eq("vin", item.vin);
  const r = await q.maybeSingle();
  if(r.error) throw new Error(`Could not load chassis number: ${r.error.message}`);
  return r.data?.chassis_no || item.vin;
}
async function removeInPhotos(rows){       // best effort, Admin only (storage policy)
  const paths = rows.flatMap(x => inPhotoPaths(x).flatMap(p => [p, inPdfPath(p)])); if(!paths.length) return;
  try { await state.supabase.storage.from(GATE_BUCKET).remove(paths); } catch { /* ignore */ }
}

/* ---- Bulk: per-vehicle IN details modal ---- */
function openBulkInModal(i){
  const it = BULK.items[i]; if(!it) return;
  it.inx = it.inx || {files:{}, tyres:["","","",""], ev:""};
  openModal(`<div class="modal-bg"><div class="modal" role="dialog" aria-modal="true"><div class="panel-head"><h3>IN Details — <span class="mono">${esc(it.vin)}</span></h3><button class="icon-btn" type="button" id="modalClose">×</button></div>
    ${inBlockHtml("bm")}<div class="form-actions"><button type="button" class="secondary-btn" id="modalCancel">Cancel</button><button class="primary-btn" type="button" id="bmSave">Done</button></div></div></div>`);
  setIn("bm", it.inx);
  $("modalClose").onclick = closeModal; $("modalCancel").onclick = closeModal;
  $("bmSave").onclick = () => { it.inx = readIn("bm", it.inx.files); closeModal(); drawBulkList(); };
}

/* ---- Saved row: view photos / edit details ---- */
async function openInView(x, reload = loadRecentGateMovements){
  if(!x) return;
  const ed = canEditGate();
  openModal(`<div class="modal-bg"><div class="modal" role="dialog" aria-modal="true"><div class="panel-head"><h3>IN Details — <span class="mono">${esc(x.vin || "")}</span></h3><button class="icon-btn" type="button" id="modalClose">×</button></div>
    ${inBlockHtml("iv")}<div class="form-actions"><button type="button" class="secondary-btn" id="modalCancel">${ed ? "Cancel" : "Close"}</button>${ed ? `<button class="primary-btn" type="button" id="ivSave">Save Changes</button>` : ""}</div></div></div>`);
  $("modalClose").onclick = closeModal; $("modalCancel").onclick = closeModal;
  setIn("iv", {files:{}, tyres:[1,2,3,4].map(n => x["tyre_serial_" + n] || ""), ev:x.ev_battery_no || ""});
  if(!ed) document.querySelectorAll("#ivBlock input, #ivBlock [data-photo-capture]").forEach(el => { el.disabled = true; });
  const paths = inPhotoPaths(x), pdfPaths = paths.filter(p => {
    const photo = IN_PHOTOS.find(([k]) => x[k] === p);
    return photo && inPhotoPdfAvailable(p, photo[1]);
  }).map(inPdfPath);
  if(paths.length){
    const r = await state.supabase.storage.from(GATE_BUCKET).createSignedUrls([...paths, ...pdfPaths], 3600), url = {};
    (r.data || []).forEach(o => { if(o.signedUrl) url[o.path] = o.signedUrl; });
    for(const [k,label] of IN_PHOTOS){
      const n = $(`iv_${k}_n`), u = x[k] && url[x[k]], pdfUrl = x[k] && url[inPdfPath(x[k])];
      if(n && x[k]) n.innerHTML = u ? `<a href="${esc(u)}" target="_blank" rel="noopener"><img class="in-thumb" src="${esc(u)}" alt="${esc(k)}"></a>${pdfUrl ? ` <a href="${esc(pdfUrl)}" download="${esc(inPhotoBaseName(label))}.pdf">Download PDF</a>` : ""}` : "Photo uploaded (preview unavailable)";
    }
  }
  if(!ed) return;
  $("ivSave").onclick = async () => {
    const btn = $("ivSave"); btn.disabled = true; btn.textContent = "Saving…";
    try {
      const d = readIn("iv"), chassisNo = await inChassisFolder({vehicle_id:x.vehicle_id, vin:x.vin});
      const upd = await inExtras(chassisNo, d);
      const r = await state.supabase.from("gate_movements").update(upd).eq("id", x.id).select("id");
      if(r.error) return toast(r.error.message, "error");
      if(!r.data?.length) return toast("Not updated — permission नाही.", "error");
      logAudit("UPDATE_GATE_IN_DETAILS","gate","gate_movements",x.id,{vin:x.vin, photos:Object.keys(upd).filter(k => k.startsWith("photo_"))});
      toast("IN details updated.","success"); closeModal(); reload();
    } catch(err){ toast("Upload failed: " + err.message, "error"); }
    finally { btn.disabled = false; btn.textContent = "Save Changes"; }
  };
}

/* Vehicle IN at Bhilarwadi / Branch => vehicle becomes Free Stock ("In Stock") at that location.
   Tally Done and Delivered vehicles are never moved back. The same rule also runs in the database
   (trigger in NEW_FEATURES.sql), so this call is a best-effort duplicate for databases without the trigger. */
async function syncVehicleStock(rows){
  try {
    const ins = rows.filter(r => r.vehicle_id && r.movement_type === "IN"); if(!ins.length) return;
    await getLocations();
    const cur = await state.supabase.from("vehicles").select("id,status").in("id", [...new Set(ins.map(r => r.vehicle_id))]);
    if(cur.error) return;
    const stageOf = new Map((cur.data || []).map(v => [v.id, vStage(v)])), byLoc = new Map();
    // pending / transit / stock => Free Stock at that location; Tally Done => keeps its status, only the location is recorded (until Delivery Entry)
    ins.filter(r => ["pending", "transit", "stock", "bill"].includes(stageOf.get(r.vehicle_id))).forEach(r => { const k = String(r.location_name || "").toLowerCase() + "|" + (stageOf.get(r.vehicle_id) === "bill" ? "bill" : "free"); if(!byLoc.has(k)) byLoc.set(k, []); byLoc.get(k).push(r.vehicle_id); });
    for(const [key, ids] of byLoc){
      const [k, kind] = key.split("|"), loc = (state.locations || []).find(l => String(l.location_name).toLowerCase() === k), patch = {};
      if(kind === "free") patch.status = "In Stock";
      if(loc) patch.location_id = loc.id;
      if(Object.keys(patch).length) await state.supabase.from("vehicles").update(patch).in("id", ids);
    }
    VCACHE.rows = null;
  } catch { /* best effort */ }
}
