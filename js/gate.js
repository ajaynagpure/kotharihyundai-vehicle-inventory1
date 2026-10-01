"use strict";
/* =====================================================================
   GATE: Bhilarwadi / Branch In-Out, In-Out Register, Gate Pass, scanner
   ===================================================================== */

const GATE_HELP = "";
const GATE_COLS_ALL = ["#","Date","Movement","Location","VIN Number","Engine No.","Variant","Color","Finance Bank","Reason","Driver","Remarks"];
// Bhilarwadi has no driver details; Branch and the register keep them.
const gateCols = gate => gate === "Bhilarwadi" ? GATE_COLS_ALL.filter(c => c !== "Driver") : GATE_COLS_ALL;
const GATE_COLS = GATE_COLS_ALL;

// Location dropdown: all active locations (Bhilarwadi always present). blankLabel => adds an empty first option.
function gateLocNames(){
  const names = (state.locations || []).filter(l => l.active !== false).map(l => l.location_name).filter(Boolean);
  if(!names.some(n => n.toLowerCase() === "bhilarwadi")) names.unshift("Bhilarwadi");
  return names;
}
function locSelect(id, name, cur, blankLabel, required){
  const names = gateLocNames(); if(cur && !names.includes(cur)) names.push(cur);
  return `<select id="${id}" name="${name}"${required ? " required" : ""}>${blankLabel !== undefined ? `<option value="">${esc(blankLabel)}</option>` : ""}${names.map(n => `<option ${n === cur ? "selected" : ""}>${esc(n)}</option>`).join("")}</select>`;
}
const gateLocOf = x => x.location_name || (x.gate_name === "Bhilarwadi" ? "Bhilarwadi" : "");

async function renderGate(page){
  if(page === "register") return renderGateRegister();
  if(page === "gate-pass") return renderGatePass();
  const title = page === "bhilarwadi" ? "Bhilarwadi In / Out" : "Branch Vehicle In / Out";
  const gateName = page === "bhilarwadi" ? "Bhilarwadi" : "Branch";
  state.gateSelectedVehicleId = null;
  const showDriver = gateName !== "Bhilarwadi";
  if(state.supabase) await getLocations();
  const locField = gateName === "Bhilarwadi" ? locSelect("gateLocation","location_name","Bhilarwadi") : locSelect("gateLocation","location_name","","— Select Location —",true);
  $("content").innerHTML = `
  <div class="gate-page gate-compact-shared">
    <div class="panel gate-entry-panel">
      <div class="gate-panel-head"><h3>${esc(title)}</h3>
        <div class="gate-tabs"><button type="button" id="tabSingle" class="gate-tab active">Single Entry</button><button type="button" id="tabBulk" class="gate-tab">Bulk In / Out</button></div></div>
      <div id="gateSingle">
      <form id="gateForm" class="gate-form-grid">
        <input type="hidden" name="gate_name" value="${esc(gateName)}">
        <div class="gate-field"><label for="gateLocation">LOCATION <span>*</span></label>${locField}</div>
        <div class="gate-field gate-vin-field"><label for="gateVin">VIN NUMBER <span>*</span></label><div class="gate-input-icon"><input name="vin" id="gateVin" required autocomplete="off" maxlength="17" inputmode="text" autocapitalize="characters" placeholder="Enter VIN / last 6 digits"><button type="button" id="gateScan" title="Scan VIN barcode" aria-label="Scan VIN barcode">📷 Scan</button></div><div id="gateVinSuggestions" class="gate-suggestions"></div></div>
        <div class="gate-field"><label for="gateEngineNo">ENGINE NO.</label><input name="engine_no" id="gateEngineNo" placeholder="Auto / Manual"></div>
        <div class="gate-field"><label for="gateVariant">VARIANT</label><input name="variant" id="gateVariant" placeholder="Auto / Manual"></div>
        <div class="gate-field"><label for="gateColor">COLOR</label><input name="color" id="gateColor" placeholder="Auto / Manual"></div>
        <div class="gate-field"><label for="gateFinanceBank">FINANCE BANK</label><input name="finance_bank" id="gateFinanceBank" placeholder="Auto / Manual"></div>
        <div class="gate-field"><label for="gateMovementType">MOVEMENT <span>*</span></label><select name="movement_type" id="gateMovementType" required><option value="IN">IN</option><option value="OUT">OUT</option></select></div>
        <div class="gate-field"><label for="gateReason">REASON <span>*</span></label><select name="movement_reason" id="gateReason" required><option value="NEW VEHICLE">NEW VEHICLE</option></select></div>
        <div class="gate-field"><label for="gateReceiptDate">RECEIPT DATE <span>*</span></label><input name="receipt_dt" id="gateReceiptDate" type="date" required></div>
        ${showDriver ? `<div class="gate-field"><label for="gateDriver">DRIVER NAME</label><input name="driver_name" id="gateDriver" autocomplete="off"></div>
        <div class="gate-field"><label for="gateDriverMobile">DRIVER MOBILE</label><input name="driver_mobile" id="gateDriverMobile" inputmode="tel" autocomplete="off"></div>` : ""}
        <div class="gate-field gate-remarks-field"><label for="gateRemarks">REMARKS</label><textarea name="remarks" id="gateRemarks" placeholder="Enter remarks"></textarea></div>
        <div class="gate-field gate-pass-field"><label for="gatePassFile">GATE PASS (PHOTO)</label><input type="file" accept="image/*" id="gatePassFile" class="in-file"><small id="gatePassFile_n" class="in-note"></small></div>
        ${gateName === "Bhilarwadi" ? `<div class="gate-in-wrap">${inBlockHtml("gi")}</div>` : ""}
        <div class="gate-form-actions"><span id="purchaseLookupMsg" class="form-help">${GATE_HELP}</span><div class="gate-action-buttons"><button class="secondary-btn" type="button" id="gateClear">↻ Clear</button><button class="primary-btn" type="submit" id="gateSave">▣ Save Gate Movement</button></div></div>
      </form></div>
      <div id="gateBulk" hidden>${bulkHtml(showDriver, gateName)}</div>
    </div>
    <div class="panel gate-recent-panel"><div class="gate-recent-head"><h3>Recent Gate Movements</h3>${gateFiltersHtml()}</div>${gateFilterPanel()}<div id="recentGateMovements" class="table-wrap"></div></div>
    <div id="modal"></div>
  </div>`;
  $("gateReceiptDate").value = todayLocal();
  $("gateForm").addEventListener("submit", saveGate);
  $("gateScan").addEventListener("click", () => openScanner(v => { $("gateVin").value = v; $("gateVin").dispatchEvent(new Event("input")); toast("Scanned " + v, "success"); }));
  $("gateClear").addEventListener("click", clearGateForm);
  let lookupTimer;
  $("gateVin").addEventListener("input", () => { clearTimeout(lookupTimer); lookupTimer = setTimeout(() => loadPurchaseVehicleDetails($("gateVin").value.trim(), true), 250); });
  $("gateVin").addEventListener("blur", () => setTimeout(hideGateSuggestions, 180));
  bindGateFilters(loadRecentGateMovements);
  bindGateIn();
  initBulk(gateName, showDriver);
  return loadRecentGateMovements();
}

function gateFiltersHtml(){
  return `<div class="filter-wrap">${filterBtn("gateFilter")}<button class="secondary-btn" type="button" id="gateExport">⤓ Export</button></div>`;
}
function gateFilterPanel(){
  return filterPanel("gateFilter", `<div class="filter-grid"><label>VIN / last 6 digits<input id="gateSearchText" type="search" placeholder="VIN"></label>
    <label>Movement<select id="gateMovementFilter"><option value="ALL">All</option><option value="IN">IN</option><option value="OUT">OUT</option></select></label>
    <label>From date<input id="gateFromDate" type="date"></label><label>To date<input id="gateToDate" type="date"></label>
    <div class="filter-actions"><button class="primary-btn" type="button" id="gateSearch">Apply</button></div></div>`);
}
function bindGateFilters(loader){
  $("gateSearch").addEventListener("click", loader);
  $("gateSearchText").addEventListener("keydown", e => { if(e.key === "Enter"){ e.preventDefault(); loader(); } });
  $("gateExport").addEventListener("click", exportGateRows);
}

function hideGateSuggestions(){ const el = $("gateVinSuggestions"); if(el) el.innerHTML = ""; }
function vehicleFieldValue(v, keys){
  for(const k of keys) if(v && v[k] !== undefined && v[k] !== null && String(v[k]).trim() !== "") return v[k];
  return "";
}
function setLookupMsg(text, cls){ const el = $("purchaseLookupMsg"); if(el){ el.textContent = text; el.className = "form-help" + (cls ? " " + cls : ""); } }

async function loadPurchaseVehicleDetails(value, showSuggestions = true){
  if(!state.supabase || !value) return;
  const input = cleanQuery(value).replace(/\s+/g,"").toUpperCase();
  if(input.length < 3){ hideGateSuggestions(); return; }
  const r = await state.supabase.from("vehicles").select("*").ilike("vin", `%${input.length >= 6 ? input.slice(-6) : input}%`).limit(20);
  if(r.error){ setLookupMsg("Purchase Report lookup unavailable. Manual entry enabled.","error-text"); hideGateSuggestions(); return; }
  const rows = r.data || [];
  if(showSuggestions){
    const box = $("gateVinSuggestions");
    if(box){
      box.innerHTML = rows.length ? rows.slice(0,10).map((v,i) => {
        const desc = [vehicleFieldValue(v,["model","model_name"]), vehicleFieldValue(v,["variant","variant_name"]), vehicleFieldValue(v,["color","colour"])].filter(Boolean).join(" • ");
        return `<button type="button" class="gate-suggestion" data-suggestion-index="${i}"><strong class="mono">${esc(vehicleFieldValue(v,["vin"]))}</strong><span>${esc(desc)}</span></button>`;
      }).join("") : `<div class="gate-suggestion-empty">No Purchase Report match — manual entry enabled.</div>`;
      box.querySelectorAll(".gate-suggestion").forEach(btn => btn.addEventListener("mousedown", ev => { ev.preventDefault(); applyPurchaseVehicle(rows[Number(btn.dataset.suggestionIndex)]); }));
    }
  }
  if(rows.length === 1 && input.length >= 6) applyPurchaseVehicle(rows[0]);
}
function applyPurchaseVehicle(v){
  state.gateSelectedVehicleId = v?.id || null;
  const set = (id, keys) => { if($(id)) $(id).value = vehicleFieldValue(v, keys); };
  set("gateEngineNo", ["engine_no","engine_number","engineNo"]);
  set("gateVariant", ["variant","variant_name"]);
  set("gateColor", ["color","colour"]);
  set("gateFinanceBank", ["finance_company","finance_bank","finance","bank_name"]);
  set("gateVin", ["vin"]);
  setLookupMsg("Purchase Report match found.","success-text");
  hideGateSuggestions();
}

function clearGateForm(){
  const form = $("gateForm"); if(!form) return;
  form.reset();
  state.gateSelectedVehicleId = null;
  $("gateReceiptDate").value = todayLocal();
  document.querySelectorAll("#gateForm .in-note").forEach(n => { n.textContent = ""; });
  hideGateSuggestions();
  setLookupMsg(GATE_HELP);
  resetGateIn();
}

async function saveGate(e){
  e.preventDefault();
  if(!state.supabase){ toast("Connect Supabase first.","error"); return; }
  const btn = $("gateSave"); btn.disabled = true;
  try {
    const f = Object.fromEntries(new FormData(e.target).entries());
    const vin = (f.vin || "").trim().toUpperCase().replace(/\s+/g,"");
    if(!vin){ toast("Enter VIN number or last 6 digits.","error"); return; }
    if(!(f.location_name || "").trim()){ toast("Select Location.","error"); return; }

    let vehicleId = state.gateSelectedVehicleId || null, vehicle = null;
    const exact = await state.supabase.from("vehicles").select("id,vin").eq("vin", vin).maybeSingle();
    if(!exact.error && exact.data){ vehicleId = exact.data.id; vehicle = exact.data; }
    else if(!vehicleId && vin.length >= 6){
      const find = await state.supabase.from("vehicles").select("id,vin").ilike("vin", `%${vin.slice(-6)}%`).limit(2);
      if(!find.error && find.data?.length === 1){ vehicleId = find.data[0].id; vehicle = find.data[0]; }
    }
    const finalVin = vehicle?.vin || vin;

    // Safety net: same VIN twice in a row with the same movement is almost always a mistake.
    const last = await state.supabase.from("gate_movements").select("movement_type,receipt_dt").eq("vin", finalVin).eq("gate_name", f.gate_name).order("created_at",{ascending:false}).limit(1);
    if(!last.error && last.data?.[0]?.movement_type === f.movement_type &&
       !confirm(`Last movement for this VIN was also ${f.movement_type} (${fmtD(last.data[0].receipt_dt)}). Save anyway?`)) return;

    const nn = v => { const t = String(v ?? "").trim(); return t === "" ? null : t; };
    const payload = {vehicle_id:vehicleId, vin:finalVin, location_name:nn(f.location_name), engine_no:nn(f.engine_no), variant:nn(f.variant), color:nn(f.color),
      finance_bank:nn(f.finance_bank), movement_type:f.movement_type, movement_reason:f.movement_reason, receipt_dt:nn(f.receipt_dt),
      remarks:nn(f.remarks), gate_name:nn(f.gate_name), driver_name:nn(f.driver_name), driver_mobile:nn(f.driver_mobile)};
    if(f.gate_name === "Bhilarwadi" && f.movement_type === "IN"){
      btn.textContent = "Uploading photos…";
      try { Object.assign(payload, await inExtras(finalVin, payload.receipt_dt, readIn("gi"))); }
      catch(err){ toast("Photo upload failed: " + err.message, "error"); return; }
    }
    const passFile = $("gatePassFile")?.files?.[0];
    if(passFile){
      btn.textContent = "Uploading gate pass…";
      try { payload.gate_pass_file = await uploadGatePass(passFile, finalVin, payload.receipt_dt, payload.movement_type); }
      catch(err){ toast("Gate pass upload failed: " + err.message, "error"); return; }
    }
    const ins = await state.supabase.from("gate_movements").insert(payload);
    if(ins.error){ toast(ins.error.message + (/gate_pass_file|schema cache/i.test(ins.error.message) ? " — " + GATEPASS_SQL_HINT : ""),"error"); return; }
    await syncVehicleStock([payload]);
    toast(vehicleId ? "Gate movement saved." : "Gate movement saved with manual vehicle details.","success");
    clearGateForm();
    await loadRecentGateMovements();
  } finally { btn.disabled = false; btn.textContent = "▣ Save Gate Movement"; }
}

/* ---- Shared movement query (recent list, register, gate pass) ---------------- */
let GATE_ROWS = [], GATE_GATE = "";
async function fetchGateRows(limit = 100, gate = ""){
  const q = cleanQuery($("gateSearchText")?.value).replace(/\s+/g,"");
  const from = $("gateFromDate")?.value, to = $("gateToDate")?.value, movement = $("gateMovementFilter")?.value;
  let query = state.supabase.from("gate_movements").select("*").order("created_at",{ascending:false}).limit(limit);
  if(from) query = query.gte("receipt_dt", from);
  if(to) query = query.lte("receipt_dt", to);
  if(movement && movement !== "ALL") query = query.eq("movement_type", movement);
  if(gate) query = query.eq("gate_name", gate);
  if(q) query = query.ilike("vin", `%${q}%`);
  const r = await query;
  if(r.error) throw r.error;
  const rows = r.data || [];
  const ids = [...new Set(rows.map(x => x.vehicle_id).filter(Boolean))];
  const vmap = {};
  if(ids.length){
    const vr = await state.supabase.from("vehicles").select("id,vin,vehicle_no,engine_no,variant,color,finance_company").in("id", ids);
    (vr.data || []).forEach(v => { vmap[v.id] = v; });
  }
  return rows.map(x => { const v = vmap[x.vehicle_id] || {}; return {...x,
    vin: x.vin || v.vin, vehicle_no: x.vehicle_no || v.vehicle_no, engine_no: x.engine_no || v.engine_no,
    variant: x.variant || v.variant, color: x.color || v.color, finance_bank: x.finance_bank || v.finance_company}; });
}
function gatePlainRow(x, i, gate = ""){
  const row = [i + 1, fmtD(x.receipt_dt || x.created_at), x.movement_type, gateLocOf(x), x.vin, x.engine_no, x.variant, x.color, x.finance_bank, x.movement_reason,
    [x.driver_name, x.driver_mobile].filter(Boolean).join(" / "), x.remarks];
  return gate === "Bhilarwadi" ? row.filter((_, k) => k !== 10) : row;
}
function exportGateRows(){
  if(!GATE_ROWS.length){ toast("Nothing to export.","error"); return; }
  const g = GATE_GATE || ""; exportSheet("gate-movements", gateCols(g), GATE_ROWS.map((x,i) => gatePlainRow(x, i, g)));
}

/* ---- In-Out Register ------------------------------------------------------------ */
async function renderGateRegister(){
  $("content").innerHTML = `<div class="panel gate-recent-panel"><div class="gate-recent-head"><h3>In-Out Register</h3>${gateFiltersHtml()}</div>${gateFilterPanel()}<div id="gateRegister" class="table-wrap">${emptyState("Loading...")}</div></div>`;
  bindGateFilters(loadGateRegister);
  return loadGateRegister();
}
async function loadGateRegister(){
  const box = $("gateRegister"); if(!box) return;
  if(!state.supabase){ box.innerHTML = emptyState("Connect Supabase to view the register."); return; }
  try {
    GATE_GATE = ""; GATE_ROWS = await fetchGateRows(500);
    mountPaged(box, {headers:GATE_COLS_ALL, rows:GATE_ROWS.map((x,i) => gatePlainRow(x, i)), size:50, empty:"No gate movements yet."});
  } catch(err){ box.innerHTML = emptyState("Register unavailable: " + err.message); }
}

