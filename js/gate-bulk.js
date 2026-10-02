"use strict";
/* =====================================================================
   GATE BULK IN/OUT (Bhilarwadi + Branch) and table actions:
   edit / delete (single + selected rows). Loaded after gate.js.
   ===================================================================== */
const canEditGate = () => state.isAdmin;   // DB: UPDATE/DELETE = Admin only (GATE_BULK_EDIT_DELETE.sql)
const BULK = {gate:"", items:[], pick:[], driver:true};
const gateOfPage = () => state.page === "bhilarwadi" ? "Bhilarwadi" : state.page === "gate" ? "Branch" : "";
const nz = v => { const t = String(v ?? "").trim(); return t === "" ? null : t; };
const toItem = (v, fromMove) => ({vehicle_id: fromMove ? (v.vehicle_id || null) : v.id, vin:v.vin, engine_no:v.engine_no || "",
  variant:v.variant || "", color:v.color || "", finance_bank:v.finance_bank || v.finance_company || "", model:v.model || ""});

/* ---------------- Bulk In / Out ---------------- */
const BULK_LOC = gate => gate === "Bhilarwadi" ? locSelect("bkLocation","bkLocation","Bhilarwadi") : locSelect("bkLocation","bkLocation","","— Select Location —");
function bulkHtml(showDriver = true, gate = ""){ return `<div class="bulk-wrap">
  <div class="gate-form-grid">
    <div class="gate-field"><label>MOVEMENT <span>*</span></label><select id="bkType"><option>IN</option><option>OUT</option></select></div>
    <div class="gate-field"><label>LOCATION <span>*</span></label>${BULK_LOC(gate)}</div>
    <div class="gate-field"><label>REASON <span>*</span></label><select id="bkReason"><option>NEW VEHICLE</option></select></div>
    <div class="gate-field"><label>RECEIPT DATE <span>*</span></label><input id="bkDate" type="date"></div>
    ${showDriver ? `<div class="gate-field"><label>DRIVER NAME</label><input id="bkDriver"></div>` : ""}
    <div class="gate-field gate-remarks-field"><label>REMARKS</label><textarea id="bkRemarks"></textarea></div>
    <div class="gate-field gate-pass-field"><label>GATE PASS (PHOTO) — applies to all selected vehicles</label><input type="file" accept="image/*" id="bkPassFile" class="in-file"><small id="bkPassFile_n" class="in-note"></small></div>
  </div>
  <div class="bulk-block"><b>1. Chassis निवडा</b>
    <div class="gate-filters"><input id="bkSearch" type="search" placeholder="VIN / last 6 digits" style="width:180px"><button class="primary-btn" type="button" id="bkFind">⌕ Search</button><button class="secondary-btn" type="button" id="bkScan">📷 Scan</button><button class="secondary-btn" type="button" id="bkInside">Currently IN (this gate)</button></div>
    <textarea id="bkPaste" class="bulk-paste" placeholder="किंवा multiple VIN / last 6 digits paste करा (line / comma ने वेगळे)"></textarea>
    <button class="secondary-btn" type="button" id="bkPasteAdd">＋ Add pasted list</button>
    <div id="bkResults" class="table-wrap"></div></div>
  <div class="bulk-block"><b>2. Selected vehicles (<span id="bkCount">0</span>)</b><div id="bkList" class="table-wrap"></div>
    <div class="gate-action-buttons"><button class="secondary-btn" type="button" id="bkClear">↻ Clear list</button><button class="primary-btn" type="button" id="bkSave">▣ Save Bulk Movement</button></div></div></div>`; }

function initBulk(gate, showDriver = true){
  BULK.gate = gate; BULK.items = []; BULK.pick = []; BULK.driver = showDriver; GATE_GATE = gate;
  $("bkDate").value = todayLocal();
  const show = b => { $("gateSingle").hidden = b; $("gateBulk").hidden = !b; $("tabSingle").classList.toggle("active", !b); $("tabBulk").classList.toggle("active", b); };
  $("tabSingle").onclick = () => show(false); $("tabBulk").onclick = () => show(true);
  $("bkFind").onclick = bulkSearch;
  $("bkSearch").addEventListener("keydown", e => { if(e.key === "Enter"){ e.preventDefault(); bulkSearch(); } });
  $("bkInside").onclick = bulkInside; $("bkPasteAdd").onclick = bulkPaste;
  $("bkScan").onclick = () => openScanner(bulkAddScanned);
  $("bkClear").onclick = () => { BULK.items = []; drawBulkList(); };
  $("bkSave").onclick = saveBulk;
  $("bkType").onchange = drawBulkList;
  drawBulkList();
}
async function bulkSearch(){
  const q = cleanQuery($("bkSearch").value).replace(/\s+/g,"").toUpperCase();
  if(q.length < 3){ toast("किमान 3 characters टाका.","error"); return; }
  const r = await state.supabase.from("vehicles").select("*").ilike("vin", `%${q}%`).limit(50);
  if(r.error){ toast(r.error.message,"error"); return; }
  showPick((r.data || []).map(v => toItem(v)));
}
async function bulkAddScanned(vin){       // scanned VIN: add from stock, or as a new vehicle (manual details)
  const r = await state.supabase.from("vehicles").select("*").eq("vin", vin).limit(1);
  if(!r.error && r.data?.length) addItem(toItem(r.data[0])); else addItem({vin, vehicle_id:null});
  toast("Added " + vin + (r.data?.length ? "" : " (not in stock report — new vehicle)"), "success"); drawBulkList();
}
async function bulkInside(){
  const r = await state.supabase.from("gate_movements").select("*").eq("gate_name", BULK.gate).order("created_at",{ascending:false}).limit(3000);
  if(r.error){ toast(r.error.message,"error"); return; }
  const seen = new Set(), rows = [];
  for(const x of r.data || []){ if(!x.vin || seen.has(x.vin)) continue; seen.add(x.vin); if(x.movement_type === "IN") rows.push(toItem(x, true)); }
  showPick(rows, `${BULK.gate} मध्ये सध्या IN असलेली वाहने: ${rows.length}`);
}
function showPick(items, note){
  BULK.pick = items; const box = $("bkResults");
  if(!items.length){ box.innerHTML = emptyState("No vehicles found."); return; }
  box.innerHTML = `<div class="bulk-bar"><span>${esc(note || items.length + " vehicles")}</span><button class="secondary-btn" type="button" id="bkAll">☑ Select all</button><button class="primary-btn" type="button" id="bkAdd">＋ Add checked</button></div>` +
    table(["✓","VIN","Model","Variant","Color","Finance"], items.map((it,i) => [raw(`<input type="checkbox" class="bk-chk" data-i="${i}">`), it.vin, it.model, it.variant, it.color, it.finance_bank]));
  $("bkAll").onclick = () => { const cs = [...box.querySelectorAll(".bk-chk")], on = cs.some(c => !c.checked); cs.forEach(c => { c.checked = on; }); };
  $("bkAdd").onclick = () => { box.querySelectorAll(".bk-chk:checked").forEach(c => addItem(BULK.pick[+c.dataset.i])); drawBulkList(); };
}
function addItem(it){ if(it && it.vin && !BULK.items.some(x => x.vin === it.vin)) BULK.items.push({...it}); }
async function bulkPaste(){
  const tokens = [...new Set($("bkPaste").value.toUpperCase().split(/[\s,;]+/).map(t => t.replace(/[^A-Z0-9]/g,"")).filter(t => t.length >= 6))];
  if(!tokens.length){ toast("VIN / last 6 digits paste करा.","error"); return; }
  const bad = [];
  await Promise.all(tokens.map(async t => {
    const q = state.supabase.from("vehicles").select("*");
    const r = await (t.length >= 17 ? q.eq("vin", t) : q.ilike("vin", `%${t}`)).limit(3);
    if(!r.error && r.data?.length === 1) addItem(toItem(r.data[0]));
    else if(t.length >= 17) addItem({vin:t, vehicle_id:null});          // not in stock report: manual VIN, like single entry
    else bad.push(t + (r.data?.length > 1 ? " (multiple match)" : " (not found)"));
  }));
  $("bkPaste").value = bad.join("\n");
  toast(bad.length ? `${bad.length} not added: ${bad.slice(0,3).join(", ")}` : "All added.", bad.length ? "error" : "success");
  drawBulkList();
}
function drawBulkList(){
  $("bkCount").textContent = BULK.items.length;
  const box = $("bkList"), inMode = BULK.gate === "Bhilarwadi" && $("bkType").value === "IN";
  if(!BULK.items.length){ box.innerHTML = emptyState("अजून कोणतीही chassis निवडलेली नाही."); return; }
  const inCell = (it,i) => { const d = it.inx, ph = d ? Object.keys(d.files).length : 0, tx = d ? d.tyres.filter(Boolean).length + (d.ev ? 1 : 0) : 0;
    return raw(`<button class="table-icon-btn" type="button" data-bin="${i}" title="Photos / tyre serials / EV battery">📷 ${ph}/6 · ${tx} no.</button>`); };
  box.innerHTML = table(["#","VIN","Model","Variant","Color","Finance",...(inMode ? ["IN Details"] : []),""], BULK.items.map((it,i) => [i+1, it.vin, it.model, it.variant, it.color, it.finance_bank,
    ...(inMode ? [inCell(it,i)] : []),
    raw(`<button class="table-icon-btn danger" type="button" data-rm="${i}" title="Remove">✕</button>`)]));
  box.querySelectorAll("[data-bin]").forEach(b => b.addEventListener("click", () => openBulkInModal(+b.dataset.bin)));
  box.querySelectorAll("[data-rm]").forEach(b => b.addEventListener("click", () => { BULK.items.splice(+b.dataset.rm, 1); drawBulkList(); }));
}
async function saveBulk(){
  const items = BULK.items, type = $("bkType").value, date = $("bkDate").value;
  if(!items.length){ toast("आधी chassis निवडा.","error"); return; }
  if(!date){ toast("Receipt date टाका.","error"); return; }
  const location = nz($("bkLocation")?.value);
  if(!location){ toast("Location निवडा.","error"); return; }
  const btn = $("bkSave"); btn.disabled = true;
  try {
    const vins = items.map(i => i.vin);
    const last = await state.supabase.from("gate_movements").select("vin,movement_type").eq("gate_name", BULK.gate).in("vin", vins).order("created_at",{ascending:false}).limit(5000);
    if(!last.error){
      const seen = {}; (last.data || []).forEach(x => { if(!(x.vin in seen)) seen[x.vin] = x.movement_type; });
      const dup = vins.filter(v => seen[v] === type);
      if(dup.length && !confirm(`${dup.length} वाहनांची last movement आधीच ${type} आहे. तरीही save करायचे?`)) return;
    }
    const extras = items.map(() => ({}));
    if(BULK.gate === "Bhilarwadi" && type === "IN"){
      for(const item of items){
        const missing = missingInPhotos(item.inx || {files:{}});
        if(missing.length){ toast(`${item.vin}: upload Vehicle IN photos 1–4 before saving.`,"error"); return; }
      }
      try { for(let i = 0; i < items.length; i++) if(items[i].inx){ btn.textContent = `Uploading ${i+1}/${items.length}…`; extras[i] = await inExtras(items[i].vin, date, items[i].inx); } }
      catch(err){ toast("Photo upload failed: " + err.message, "error"); return; }
    }
    let passPath = null; const passFile = $("bkPassFile")?.files?.[0];
    if(passFile){
      btn.textContent = "Uploading gate pass…";
      try { passPath = await uploadGatePass(passFile, "BULK", date, type); } catch(err){ toast("Gate pass upload failed: " + err.message, "error"); return; }
    }
    const rows = items.map((it,i) => ({vehicle_id:it.vehicle_id || null, vin:it.vin,
      engine_no:nz(it.engine_no), variant:nz(it.variant), color:nz(it.color), finance_bank:nz(it.finance_bank), movement_type:type, location_name:location,
      movement_reason:$("bkReason").value, receipt_dt:date, remarks:nz($("bkRemarks").value), gate_name:BULK.gate,
      driver_name:BULK.driver ? nz($("bkDriver")?.value) : null, ...(passPath ? {gate_pass_file:passPath} : {}), ...extras[i]}));
    const ins = await state.supabase.from("gate_movements").insert(rows);
    if(ins.error){ toast(ins.error.message + (/gate_pass_file|schema cache/i.test(ins.error.message) ? " — " + GATEPASS_SQL_HINT : ""),"error"); return; }
    await syncVehicleStock(rows);
    logAudit("BULK_GATE_MOVEMENT","gate","gate_movements",null,{gate:BULK.gate,movement:type,count:rows.length,vins});
    toast(`${rows.length} vehicles ${type} saved.`,"success");
    BULK.items = []; $("bkResults").innerHTML = ""; $("bkPassFile").value = ""; $("bkPassFile_n").textContent = ""; drawBulkList(); loadRecentGateMovements();
  } finally { btn.disabled = false; btn.textContent = "▣ Save Bulk Movement"; }
}

/* ---------------- Movements table: edit / delete / bulk edit / bulk delete ---------------- */
async function loadRecentGateMovements(){
  const target = $("recentGateMovements"); if(!target) return;
  if(!state.supabase){ target.innerHTML = emptyState("Connect Supabase to view gate movements."); return; }
  try { GATE_GATE = gateOfPage(); GATE_ROWS = await fetchGateRows(100, GATE_GATE); showGateTable(target, GATE_ROWS, loadRecentGateMovements); }
  catch(err){ target.innerHTML = emptyState("Gate movements unavailable: " + err.message); }
}
function showGateTable(target, rows, reload){
  const ed = canEditGate(), bh = GATE_GATE === "Bhilarwadi";
  const cols = [...gateCols(GATE_GATE,false), ...(bh ? ["IN Details"] : []), "Gate Pass"];
  const bar = ed && rows.length ? `<div class="bulk-bar"><button class="secondary-btn" type="button" data-gt="all">☑ Select all (this page)</button><button class="secondary-btn" type="button" data-gt="edit">✎ Edit selected</button><button class="secondary-btn danger" type="button" data-gt="del">🗑 Delete selected</button></div>` : "";
  target.innerHTML = bar + `<div id="gtBody"></div>`;
  const body = target.querySelector("#gtBody");
  const cells = rows.map((x,i) => {
    const extra = [...(bh ? [x.movement_type === "IN" ? raw(`<button class="table-icon-btn" type="button" title="Photos / tyre serials / EV battery" data-in-view="${i}">📷 ${inCount(x)}/6</button>`) : ""] : []),
      x.gate_pass_file ? raw(`<button class="table-icon-btn" type="button" title="Download gate pass" data-gate-dl="${i}">⬇</button>`) : ""];
    const r = [...gatePlainRow(x, i, GATE_GATE,false), ...extra]; if(!ed) return r;
    return [raw(`<input type="checkbox" class="gt-chk" data-i="${i}">`), ...r,
      raw(`<button class="table-icon-btn" type="button" title="Edit" data-gate-edit="${i}">✎</button><button class="table-icon-btn danger" type="button" title="Delete" data-gate-del="${i}">🗑</button>`)];
  });
  mountPaged(body, {headers:ed ? ["✓", ...cols, "Action"] : cols, rows:cells, size:25, empty:"No gate movements yet.", onDraw:() => {
    body.querySelectorAll("[data-in-view]").forEach(b => b.addEventListener("click", () => openInView(rows[+b.dataset.inView], reload)));
    body.querySelectorAll("[data-gate-dl]").forEach(b => b.addEventListener("click", () => { const x = rows[+b.dataset.gateDl]; downloadPath(x.gate_pass_file, `GatePass_${x.vin}_${x.movement_type}_${x.receipt_dt || ""}.${x.gate_pass_file.split(".").pop()}`); }));
    body.querySelectorAll("[data-gate-edit]").forEach(b => b.addEventListener("click", () => openGateEdit(rows[+b.dataset.gateEdit], reload)));
    body.querySelectorAll("[data-gate-del]").forEach(b => b.addEventListener("click", () => deleteGateMovements([rows[+b.dataset.gateDel]], reload)));
  }});
  if(!ed) return;
  const picked = () => [...body.querySelectorAll(".gt-chk:checked")].map(c => rows[+c.dataset.i]);
  target.querySelector('[data-gt="all"]')?.addEventListener("click", () => { const cs = [...body.querySelectorAll(".gt-chk")], on = cs.some(c => !c.checked); cs.forEach(c => { c.checked = on; }); });
  target.querySelector('[data-gt="edit"]')?.addEventListener("click", () => { const p = picked(); if(!p.length) return toast("Select rows first.","error"); p.length === 1 ? openGateEdit(p[0], reload) : openGateBulkEdit(p, reload); });
  target.querySelector('[data-gt="del"]')?.addEventListener("click", () => { const p = picked(); if(!p.length) return toast("Select rows first.","error"); deleteGateMovements(p, reload); });
}
const gateSel = (id, name, opts, cur, blank) => `<select id="${id}" name="${name}">${blank ? '<option value="">— no change —</option>' : ""}${opts.map(o => `<option ${o === cur ? "selected" : ""}>${o}</option>`).join("")}</select>`;
function openGateEdit(x, reload = loadRecentGateMovements){
  if(!x) return;
  const inp = (n, l, v, t = "text") => `<div><label>${l}</label><input name="${n}" type="${t}" value="${esc(v || "")}"></div>`;
  openModal(`<div class="modal-bg"><div class="modal" role="dialog" aria-modal="true"><div class="panel-head"><h3>Edit Gate Movement</h3><button class="icon-btn" type="button" id="modalClose">×</button></div>
    <form id="gateEditForm" class="form-grid"><div><label>VIN</label><input value="${esc(x.vin || "")}" disabled></div>
    <div><label>LOCATION</label>${locSelect("ge_loc","location_name",gateLocOf(x),"— Select —")}</div>${inp("receipt_dt","RECEIPT DATE",x.receipt_dt,"date")}
    <div><label>MOVEMENT</label>${gateSel("ge_type","movement_type",["IN","OUT"],x.movement_type)}</div>
    <div><label>REASON</label>${gateSel("ge_reason","movement_reason",[...new Set(["NEW VEHICLE", x.movement_reason].filter(Boolean))],x.movement_reason)}</div>
    ${inp("engine_no","ENGINE NO.",x.engine_no)}${inp("variant","VARIANT",x.variant)}${inp("color","COLOR",x.color)}${inp("finance_bank","FINANCE BANK",x.finance_bank)}
    ${x.gate_name === "Bhilarwadi" ? "" : inp("driver_name","DRIVER NAME",x.driver_name)}
    <div class="full"><label>REMARKS</label><textarea name="remarks">${esc(x.remarks || "")}</textarea></div>
    <div class="full form-actions"><button type="button" class="secondary-btn" id="modalCancel">Cancel</button><button class="primary-btn" type="submit">Save Changes</button></div></form></div></div>`);
  $("modalClose").onclick = closeModal; $("modalCancel").onclick = closeModal;
  $("gateEditForm").addEventListener("submit", async e => {
    e.preventDefault(); const f = Object.fromEntries(new FormData(e.target).entries());
    const upd = {location_name:nz(f.location_name), receipt_dt:f.receipt_dt || null, movement_type:f.movement_type, movement_reason:f.movement_reason,
      engine_no:nz(f.engine_no), variant:nz(f.variant), color:nz(f.color), finance_bank:nz(f.finance_bank), remarks:nz(f.remarks)};
    if(x.gate_name !== "Bhilarwadi") upd.driver_name = nz(f.driver_name);
    const r = await state.supabase.from("gate_movements").update(upd).eq("id", x.id).select("id");
    if(r.error) return toast(r.error.message,"error");
    if(!r.data?.length) return toast("Not updated — permission नाही (GATE_BULK_EDIT_DELETE.sql run करा).","error");
    logAudit("UPDATE_GATE_MOVEMENT","gate","gate_movements",x.id,{vin:x.vin,...upd});
    toast("Gate movement updated.","success"); closeModal(); reload();
  });
}
function openGateBulkEdit(list, reload){
  openModal(`<div class="modal-bg"><div class="modal" role="dialog" aria-modal="true"><div class="panel-head"><h3>Edit ${list.length} selected movements</h3><button class="icon-btn" type="button" id="modalClose">×</button></div>
    <p class="form-help">फक्त भरलेले fields सर्व निवडलेल्या rows मध्ये बदलतील.</p>
    <form id="gateBulkEditForm" class="form-grid"><div><label>MOVEMENT</label>${gateSel("gb_type","movement_type",["IN","OUT"],"",true)}</div>
    <div><label>REASON</label>${gateSel("gb_reason","movement_reason",["NEW VEHICLE"],"",true)}</div>
    <div><label>LOCATION</label>${locSelect("gb_loc","location_name","","— no change —")}</div>
    <div><label>RECEIPT DATE</label><input name="receipt_dt" type="date"></div>
    ${GATE_GATE === "Bhilarwadi" ? "" : `<div><label>DRIVER NAME</label><input name="driver_name"></div>`}
    <div class="full"><label>REMARKS</label><textarea name="remarks"></textarea></div>
    <div class="full form-actions"><button type="button" class="secondary-btn" id="modalCancel">Cancel</button><button class="primary-btn" type="submit">Update ${list.length} rows</button></div></form></div></div>`);
  $("modalClose").onclick = closeModal; $("modalCancel").onclick = closeModal;
  $("gateBulkEditForm").addEventListener("submit", async e => {
    e.preventDefault(); const f = Object.fromEntries(new FormData(e.target).entries()), upd = {};
    for(const k of ["movement_type","movement_reason","location_name","receipt_dt","driver_name","driver_mobile","remarks"]) if(nz(f[k])) upd[k] = nz(f[k]);
    if(!Object.keys(upd).length) return toast("काहीतरी बदल भरा.","error");
    const r = await state.supabase.from("gate_movements").update(upd).in("id", list.map(x => x.id)).select("id");
    if(r.error) return toast(r.error.message,"error");
    if(!r.data?.length) return toast("Not updated — permission नाही (GATE_BULK_EDIT_DELETE.sql run करा).","error");
    logAudit("BULK_UPDATE_GATE_MOVEMENT","gate","gate_movements",null,{count:r.data.length,...upd});
    toast(`${r.data.length} rows updated.`,"success"); closeModal(); reload();
  });
}
async function deleteGateMovements(list, reload = loadRecentGateMovements){
  const l = list.filter(Boolean); if(!l.length) return;
  if(!confirm(l.length === 1 ? `Delete this ${l[0].movement_type} entry for ${l[0].vin}? This cannot be undone.` : `${l.length} entries delete करायचे? हे परत घेता येणार नाही.`)) return;
  const r = await state.supabase.from("gate_movements").delete().in("id", l.map(x => x.id)).select("id");
  if(r.error) return toast(r.error.message,"error");
  if(!r.data?.length) return toast("Not deleted — permission नाही (GATE_BULK_EDIT_DELETE.sql run करा).","error");
  removeInPhotos(l);
  logAudit("DELETE_GATE_MOVEMENT","gate","gate_movements",null,{count:r.data.length,vins:l.map(x => x.vin)});
  toast(`${r.data.length} entries deleted.`,"success"); reload();
}
