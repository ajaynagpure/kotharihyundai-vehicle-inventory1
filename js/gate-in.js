"use strict";
/* =====================================================================
   BHILARWADI "VEHICLE IN" DETAILS (6 photos + 4 tyre serials + EV battery)
   and the Gate Pass print bar shown right after a save. Loaded after gate-bulk.js.
   ===================================================================== */
const GATE_BUCKET = "gate-photos";
const IN_PHOTOS = [["photo_front","1. Vehicle Front Photo"],["photo_chassis_no","2. Vehicle Chassis No. Photo"],["photo_chassis_plate","3. Vehicle Chassis Plate Photo"],
  ["photo_form22","4. FORM 22 Photo"],["photo_cng_cert","5. Vehicle CNG Certificate Photo"],["photo_cng_kit","6. Vehicle CNG Kit Photo"]];
const inCount = x => IN_PHOTOS.filter(([k]) => x && x[k]).length;
const inPhotoPaths = x => IN_PHOTOS.map(([k]) => x?.[k]).filter(Boolean);

function inBlockHtml(p){
  return `<div id="${p}Block" class="gate-in-block"><div class="gate-in-title">Vehicle IN Details</div><div class="gate-in-grid">
    ${IN_PHOTOS.map(([k,l]) => `<div class="gate-field"><label>${l}</label><input type="file" accept="image/*" id="${p}_${k}" class="in-file"><small id="${p}_${k}_n" class="in-note"></small></div>`).join("")}
    ${[1,2,3,4].map(n => `<div class="gate-field"><label>7. TYRE SERIAL NO. ${n}</label><input id="${p}_tyre${n}" autocomplete="off" placeholder="Tyre ${n} serial no."></div>`).join("")}
    <div class="gate-field"><label>8. EV BATTERY NO.</label><input id="${p}_ev" autocomplete="off" placeholder="Battery no."></div></div></div>`;
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
  for(const [k] of IN_PHOTOS){ const n = document.getElementById(`${p}_${k}_n`); if(n && d.files[k]) n.textContent = "✔ " + d.files[k].name; }
}
function resetGateIn(){
  document.querySelectorAll("#giBlock .in-note").forEach(n => { n.textContent = ""; });
  const b = document.getElementById("giBlock"), m = document.getElementById("gateMovementType");
  if(b && m) b.hidden = m.value !== "IN";
}
function bindGateIn(){
  const m = document.getElementById("gateMovementType"); if(!m) return;
  m.addEventListener("change", () => { const b = document.getElementById("giBlock"); if(b) b.hidden = m.value !== "IN"; });
}
document.addEventListener("change", e => {          // show chosen file name under every photo input
  const t = e.target; if(!t.classList?.contains("in-file")) return;
  const n = document.getElementById(t.id + "_n"); if(n) n.textContent = t.files[0] ? "✔ " + t.files[0].name : "";
});

async function compressImage(file, max = 1600, quality = 0.72){
  try {
    const bmp = await createImageBitmap(file), sc = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const c = document.createElement("canvas"); c.width = Math.round(bmp.width * sc); c.height = Math.round(bmp.height * sc);
    c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
    const blob = await new Promise(r => c.toBlob(r, "image/jpeg", quality));
    if(blob) return blob;
  } catch { /* fall back to the original file */ }
  if(file.size > 5 * 1024 * 1024) throw new Error(`Photo too large (max 5 MB): ${file.name}`);
  return file;
}
// Uploads the chosen photos and returns the gate_movements columns to save (photo paths + tyre serials + EV battery).
async function inExtras(vin, date, d){
  const out = {}, safe = String(vin).replace(/[^A-Z0-9_-]/gi, "_");
  d.tyres.forEach((t,i) => { out["tyre_serial_" + (i+1)] = nz(t); });
  out.ev_battery_no = nz(d.ev);
  for(const [k,label] of IN_PHOTOS){
    const f = d.files[k]; if(!f) continue;
    const blob = await compressImage(f), ext = blob.type === "image/jpeg" ? "jpg" : (blob.type.split("/")[1] || "jpg");
    const path = `${safe}/${date || "nodate"}/${k}.${ext}`;
    const up = await state.supabase.storage.from(GATE_BUCKET).upload(path, blob, {contentType:blob.type || "image/jpeg", upsert:true});
    if(up.error) throw new Error(`${label}: ${up.error.message}`);
    out[k] = path;
  }
  return out;
}
async function removeInPhotos(rows){       // best effort, Admin only (storage policy)
  const paths = rows.flatMap(inPhotoPaths); if(!paths.length) return;
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
  if(!ed) document.querySelectorAll("#ivBlock input").forEach(el => { el.disabled = true; });
  const paths = inPhotoPaths(x);
  if(paths.length){
    const r = await state.supabase.storage.from(GATE_BUCKET).createSignedUrls(paths, 3600), url = {};
    (r.data || []).forEach(o => { if(o.signedUrl) url[o.path] = o.signedUrl; });
    for(const [k] of IN_PHOTOS){
      const n = $(`iv_${k}_n`), u = x[k] && url[x[k]];
      if(n && x[k]) n.innerHTML = u ? `<a href="${esc(u)}" target="_blank" rel="noopener"><img class="in-thumb" src="${esc(u)}" alt="${esc(k)}"></a>` : "Photo uploaded (preview unavailable)";
    }
  }
  if(!ed) return;
  $("ivSave").onclick = async () => {
    const btn = $("ivSave"); btn.disabled = true; btn.textContent = "Saving…";
    try {
      const d = readIn("iv"), upd = await inExtras(x.vin, x.receipt_dt, d);
      const r = await state.supabase.from("gate_movements").update(upd).eq("id", x.id).select("id");
      if(r.error) return toast(r.error.message, "error");
      if(!r.data?.length) return toast("Not updated — permission नाही.", "error");
      logAudit("UPDATE_GATE_IN_DETAILS","gate","gate_movements",x.id,{vin:x.vin, photos:Object.keys(upd).filter(k => k.startsWith("photo_"))});
      toast("IN details updated.","success"); closeModal(); reload();
    } catch(err){ toast("Upload failed: " + err.message, "error"); }
    finally { btn.disabled = false; btn.textContent = "Save Changes"; }
  };
}

/* ---- Gate pass photo upload (no printing) ---- */
async function uploadGatePass(file, key, date, type){
  const blob = await compressImage(file), ext = blob.type === "image/jpeg" ? "jpg" : (blob.type.split("/")[1] || "jpg");
  const path = `gatepass/${String(key || "NA").replace(/[^A-Z0-9_-]/gi, "_")}/${date || "nodate"}/${type || "PASS"}_${Date.now()}.${ext}`;
  const up = await state.supabase.storage.from(GATE_BUCKET).upload(path, blob, {contentType:blob.type || "image/jpeg", upsert:false});
  if(up.error) throw new Error(up.error.message);
  return path;
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
