"use strict";
/* =====================================================================
   GATE: Bhilarwadi / Branch In-Out, In-Out Register, Gate Pass, scanner
   ===================================================================== */

const GATE_HELP = "";
const GATE_COLS_ALL = ["Date","Sr No","Movement","Location","VIN Number","Engine No.","Variant","Color","Finance Bank","Reason","Driver","Remarks"];
const GATE_RECENT_COLS_ALL = GATE_COLS_ALL.filter(c => c !== "Sr No");
// Bhilarwadi has no driver details; Branch and the register keep them.
const gateCols = (gate, includeSerial = true) => {
  const cols = includeSerial ? GATE_COLS_ALL : GATE_RECENT_COLS_ALL;
  return gate === "Bhilarwadi" ? cols.filter(c => c !== "Driver") : cols;
};
const GATE_COLS = GATE_COLS_ALL;
let GATE_DESTINATION_LOCATIONS = [];

// Location dropdown: all active locations (Bhilarwadi always present). blankLabel => adds an empty first option.
function gateLocNames(){
  const names = (state.locations || []).filter(l => l.active !== false).map(l => l.location_name).filter(Boolean);
  if(state.isAdmin && !names.some(n => n.toLowerCase() === "bhilarwadi")) names.unshift("Bhilarwadi");
  return names;
}
function assignedGateLocation(){
  if(state.isAdmin) return null;
  const id = state.profile?.location_id;
  return id ? (state.locations || []).find(l => String(l.id) === String(id))?.location_name || "" : "";
}
function gateMovementLocationNames(gate, movement){
  if(gate === "Bhilarwadi") return ["Bhilarwadi"];
  const assigned = assignedGateLocation();
  if(assigned === null) return gateLocNames();
  if(!assigned) return [];
  return movement === "OUT"
    ? GATE_DESTINATION_LOCATIONS.filter(l => String(l.location_name).trim().toLowerCase() !== assigned.trim().toLowerCase()).map(l => l.location_name)
    : [assigned];
}
function gateMovementLocationSelect(gate, movement){
  if(gate === "Bhilarwadi") return '<select id="gateLocation" name="location_name" required><option value="Bhilarwadi" selected>Bhilarwadi</option></select>';
  const assigned = assignedGateLocation();
  const current = assigned === null ? "" : movement === "IN" ? assigned : "";
  const blank = current ? "" : '<option value="">— Select Location —</option>';
  const names = gateMovementLocationNames(gate,movement);
  return `<select id="gateLocation" name="location_name" required>${blank}${names.map(n => `<option value="${esc(n)}" ${n === current ? "selected" : ""}>${esc(n)}</option>`).join("")}</select>`;
}
function updateGateMovementLocation(gate, movement){
  const select = $("gateLocation"); if(!select) return;
  const current = movement === "IN" ? assignedGateLocation() || "" : "";
  const names = gateMovementLocationNames(gate,movement);
  select.innerHTML = `${current ? "" : '<option value="">— Select Location —</option>'}` + names.map(n => `<option value="${esc(n)}" ${n === current ? "selected" : ""}>${esc(n)}</option>`).join("");
  select.value = current;
}
function gateMovementLocationAllowed(gate, movement, location){
  const assigned = assignedGateLocation();
  if(assigned === null) return gateLocNames().includes(location);
  if(!assigned) return false;
  if(gate === "Bhilarwadi") return movement === "IN" && location === "Bhilarwadi" && assigned === "Bhilarwadi";
  return movement === "IN"
    ? location === assigned
    : movement === "OUT" && location !== assigned && GATE_DESTINATION_LOCATIONS.some(l => l.location_name === location);
}
function locSelect(id, name, cur, blankLabel, required){
  const names = gateLocNames(); if(cur && !names.includes(cur)) names.push(cur);
  return `<select id="${id}" name="${name}"${required ? " required" : ""}>${blankLabel !== undefined ? `<option value="">${esc(blankLabel)}</option>` : ""}${names.map(n => `<option ${n === cur ? "selected" : ""}>${esc(n)}</option>`).join("")}</select>`;
}
const gateLocOf = x => x.location_name || (x.gate_name === "Bhilarwadi" ? "Bhilarwadi" : "");
const gateOutBlocked = (latest, movement) => movement === "OUT" && String(latest?.movement_type || "").toUpperCase() === "OUT";
async function latestGateMovement(vin){
  const normalizedVin = String(vin || "").trim().toUpperCase().replace(/\s+/g,"");
  const result = await state.supabase.from("gate_movements").select("movement_type,receipt_dt,location_name,gate_name")
    .eq("vin", normalizedVin).order("created_at",{ascending:false}).limit(1);
  if(result.error) throw result.error;
  return result.data?.[0] || null;
}

async function renderGate(page){
  if(page === "register") return renderGateRegister();
  if(page === "gate-pass") return renderGatePass();
  const isBhilarwadi = page === "bhilarwadi";
  const title = isBhilarwadi ? "Bhilarwadi In" : "Branch Vehicle In / Out";
  const gateName = page === "bhilarwadi" ? "Bhilarwadi" : "Branch";
  state.gateSelectedVehicleId = null;
  const showDriver = gateName !== "Bhilarwadi";
  if(state.supabase) await getLocations();
  GATE_DESTINATION_LOCATIONS = [];
  if(!state.isAdmin && gateName === "Branch" && !assignedGateLocation()){
    toast("Your assigned location could not be resolved. Contact an administrator.","error");
  }
  if(state.supabase && !state.isAdmin && gateName === "Branch" && assignedGateLocation()){
    const destinations = await state.supabase.rpc("gate_destination_locations");
    if(destinations.error) toast("Could not load OUT destinations. Run the LOCATION_ACCESS_SECURITY section in database.sql, then reload. " + destinations.error.message,"error");
    else if(!Array.isArray(destinations.data)) toast("OUT destinations returned an invalid response. Check the LOCATION_ACCESS_SECURITY SQL function.","error");
    else {
      GATE_DESTINATION_LOCATIONS = destinations.data.filter(l => l?.location_name);
      if(!GATE_DESTINATION_LOCATIONS.length) toast("No other active locations were returned. Check that the LOCATION_ACCESS_SECURITY SQL is applied and other locations are active.","error");
    }
  }
  const locField = gateMovementLocationSelect(gateName,"IN");
  $("content").innerHTML = `
  <div class="gate-page gate-compact-shared">
    <div class="panel gate-entry-panel">
      <div class="gate-panel-head"><h3>${esc(title)}</h3>
        <div class="gate-tabs"><button type="button" id="tabSingle" class="gate-tab active">Single Entry</button>${state.isAdmin ? `<button type="button" id="tabBulk" class="gate-tab">${isBhilarwadi ? "Bulk In" : "Bulk In / Out"}</button>` : ""}</div></div>
      <div id="gateSingle">
      <form id="gateForm" class="gate-form-grid">
        <input type="hidden" name="gate_name" value="${esc(gateName)}">
        <div class="gate-field"><label for="gateLocation">LOCATION <span>*</span></label>${locField}</div>
        <div class="gate-field gate-vin-field"><label for="gateVin">VIN NUMBER <span>*</span></label><div class="gate-input-icon"><input name="vin" id="gateVin" required autocomplete="off" maxlength="17" inputmode="text" autocapitalize="characters" placeholder="Enter VIN / last 6 digits"><button type="button" id="gateScan" title="Scan VIN barcode" aria-label="Scan VIN barcode">📷 Scan</button></div><div id="gateVinSuggestions" class="gate-suggestions"></div></div>
        <div class="gate-field"><label for="gateEngineNo">ENGINE NO.</label><input name="engine_no" id="gateEngineNo" placeholder="Auto / Manual"></div>
        <div class="gate-field"><label for="gateVariant">VARIANT</label><input name="variant" id="gateVariant" placeholder="Auto / Manual"></div>
        <div class="gate-field"><label for="gateColor">COLOR</label><input name="color" id="gateColor" placeholder="Auto / Manual"></div>
        <div class="gate-field"><label for="gateFinanceBank">FINANCE BANK</label><input name="finance_bank" id="gateFinanceBank" placeholder="Auto / Manual"></div>
        <div class="gate-field"><label for="gateMovementType">MOVEMENT <span>*</span></label><select name="movement_type" id="gateMovementType" required>${isBhilarwadi ? '<option value="IN" selected>IN</option>' : '<option value="IN">IN</option><option value="OUT">OUT</option>'}</select></div>
        <div class="gate-field"><label for="gateReason">REASON <span>*</span></label><select name="movement_reason" id="gateReason" required><option value="NEW VEHICLE">NEW VEHICLE</option></select></div>
        <div class="gate-field"><label for="gateReceiptDate">RECEIPT DATE <span>*</span></label><input name="receipt_dt" id="gateReceiptDate" type="date" required></div>
        ${showDriver ? `<div class="gate-field"><label for="gateDriver">DRIVER NAME</label><input name="driver_name" id="gateDriver" autocomplete="off"></div>` : ""}
        <div class="gate-field gate-remarks-field"><label for="gateRemarks">REMARKS</label><textarea name="remarks" id="gateRemarks" placeholder="Enter remarks"></textarea></div>
        <div class="gate-field gate-pass-field"><label for="gatePassFile">GATE PASS (PHOTO) <span>*</span></label><input type="file" accept="image/*" id="gatePassFile" class="in-file" required><small id="gatePassFile_n" class="in-note"></small></div>
        ${gateName === "Bhilarwadi" ? `<div class="gate-in-wrap">${inBlockHtml("gi")}</div>` : ""}
        <div class="gate-form-actions"><span id="purchaseLookupMsg" class="form-help">${GATE_HELP}</span><div class="gate-action-buttons"><button class="secondary-btn" type="button" id="gateClear">↻ Clear</button><button class="primary-btn" type="submit" id="gateSave">▣ Save Gate Movement</button></div></div>
      </form></div>
      ${state.isAdmin ? `<div id="gateBulk" hidden>${bulkHtml(showDriver, gateName)}</div>` : ""}
    </div>
    <div class="panel gate-recent-panel"><div class="gate-recent-head"><h3>Recent Gate Movements</h3>${gateFiltersHtml()}</div>${gateFilterPanel()}<div id="recentGateMovements" class="table-wrap"></div></div>
    <div id="modal"></div>
  </div>`;
  $("gateReceiptDate").value = todayLocal();
  $("gateMovementType").addEventListener("change", () => updateGateMovementLocation(gateName,$("gateMovementType").value));
  $("gateForm").addEventListener("submit", saveGate);
  $("gateScan").addEventListener("click", () => openScanner(v => { $("gateVin").value = v; $("gateVin").dispatchEvent(new Event("input")); toast("Scanned " + v, "success"); }));
  $("gateClear").addEventListener("click", clearGateForm);
  let lookupTimer;
  $("gateVin").addEventListener("input", () => { clearTimeout(lookupTimer); lookupTimer = setTimeout(() => loadPurchaseVehicleDetails($("gateVin").value.trim(), true), 250); });
  $("gateVin").addEventListener("blur", () => setTimeout(hideGateSuggestions, 180));
  bindGateFilters(loadRecentGateMovements);
  bindGateIn();
  if(state.isAdmin) initBulk(gateName, showDriver);
  return loadRecentGateMovements();
}

function gateFiltersHtml(){
  return `<div class="filter-wrap">${filterBtn("gateFilter")}<button class="secondary-btn" type="button" id="gateExport">⤓ Export</button></div>`;
}
function gateFilterPanel(){
  const locations = gateLocNames();
  const assigned = assignedGateLocation();
  const locationOptions = assigned === null
    ? `<option value="ALL">All Locations</option>${locations.map(n => `<option value="${esc(n)}">${esc(n)}</option>`).join("")}`
    : `<option value="SCOPED" selected>${esc(assigned || "Assigned Location unavailable")}</option>`;
  return filterPanel("gateFilter", `<div class="filter-grid"><label>VIN / last 6 digits<input id="gateSearchText" type="search" placeholder="VIN"></label>
    <label>Location<select id="gateLocationFilter" ${assigned !== null ? "disabled" : ""}>${locationOptions}</select></label>
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
    if(f.gate_name === "Bhilarwadi" && f.movement_type !== "IN"){ toast("Bhilarwadi In page only allows IN movements.","error"); return; }
    const vin = (f.vin || "").trim().toUpperCase().replace(/\s+/g,"");
    if(!vin){ toast("Enter VIN number or last 6 digits.","error"); return; }
    if(!(f.location_name || "").trim()){ toast("Select Location.","error"); return; }
    if(!gateMovementLocationAllowed(f.gate_name,f.movement_type,f.location_name)){ toast("Selected location is not allowed for this movement.","error"); return; }
    if(!$("gatePassFile")?.files?.[0]){ toast("Upload the gate pass photo before saving.","error"); return; }

    let vehicleId = state.gateSelectedVehicleId || null, vehicle = null;
    const exact = await state.supabase.from("vehicles").select("id,vin").eq("vin", vin).maybeSingle();
    if(!exact.error && exact.data){ vehicleId = exact.data.id; vehicle = exact.data; }
    else if(!vehicleId && vin.length >= 6){
      const find = await state.supabase.from("vehicles").select("id,vin").ilike("vin", `%${vin.slice(-6)}%`).limit(2);
      if(!find.error && find.data?.length === 1){ vehicleId = find.data[0].id; vehicle = find.data[0]; }
    }
    const finalVin = vehicle?.vin || vin;
    if(!state.isAdmin && f.movement_type === "OUT" && !vehicleId){ toast("OUT movement requires a vehicle assigned to your location.","error"); return; }

    let last;
    try { last = await latestGateMovement(finalVin); }
    catch(err){ toast("Could not verify previous gate movement: " + err.message,"error"); return; }
    if(gateOutBlocked(last, f.movement_type)){
      toast(`This vehicle is already OUT from ${last.location_name || last.gate_name || "a location"}. Save an IN movement before another OUT.`,"error");
      return;
    }
    if(last?.movement_type === f.movement_type && last.gate_name === f.gate_name &&
       !confirm(`Last movement for this VIN was also ${f.movement_type} (${fmtD(last.receipt_dt)}). Save anyway?`)) return;

    const nn = v => { const t = String(v ?? "").trim(); return t === "" ? null : t; };
    const payload = {vehicle_id:vehicleId, vin:finalVin, location_name:nn(f.location_name), engine_no:nn(f.engine_no), variant:nn(f.variant), color:nn(f.color),
      finance_bank:nn(f.finance_bank), movement_type:f.movement_type, movement_reason:f.movement_reason, receipt_dt:nn(f.receipt_dt),
      remarks:nn(f.remarks), gate_name:nn(f.gate_name), driver_name:nn(f.driver_name)};
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
  const from = $("gateFromDate")?.value, to = $("gateToDate")?.value, movement = $("gateMovementFilter")?.value, location = $("gateLocationFilter")?.value;
  let query = state.supabase.from("gate_movements").select("*").order("created_at",{ascending:false}).limit(limit);
  if(from) query = query.gte("receipt_dt", from);
  if(to) query = query.lte("receipt_dt", to);
  if(movement && movement !== "ALL") query = query.eq("movement_type", movement);
  if(location && location !== "ALL" && location !== "SCOPED") query = query.eq("location_name", location);
  if(gate) query = query.eq("gate_name", gate);
  if(q) query = query.ilike("vin", `%${q}%`);
  const r = await query;
  if(r.error) throw r.error;
  const rows = r.data || [];
  const ids = [...new Set(rows.map(x => x.vehicle_id).filter(Boolean))];
  const vmap = {};
  if(ids.length){
    const vr = await state.supabase.from("vehicles").select("id,vin,vehicle_no,engine_no,variant,color,finance_company,location_id,delivery_location,sales_location").in("id", ids);
    (vr.data || []).forEach(v => { vmap[v.id] = v; });
  }
  const assignedName = assignedGateLocation(), assignedId = state.profile?.location_id;
  return rows.map(x => { const v = vmap[x.vehicle_id] || {}; return {...x,
    vin: x.vin || v.vin, vehicle_no: x.vehicle_no || v.vehicle_no, engine_no: x.engine_no || v.engine_no,
    variant: x.variant || v.variant, color: x.color || v.color, finance_bank: x.finance_bank || v.finance_company,
    _assignedLocationMatch: state.isAdmin || (!!assignedName && (
      String(gateLocOf(x) || "").trim().toLowerCase() === assignedName.trim().toLowerCase()
      || String(v.location_id || "") === String(assignedId || "")
      || [v.delivery_location,v.sales_location].some(name => String(name || "").trim().toLowerCase() === assignedName.trim().toLowerCase())
    ))}; }).filter(x => x._assignedLocationMatch).map(({_assignedLocationMatch, ...x}) => x);
}
function gatePlainRow(x, i, gate = "", includeSerial = true){
  const row = [fmtD(x.receipt_dt || x.created_at), ...(includeSerial ? [i + 1] : []), x.movement_type, gateLocOf(x), x.vin, x.engine_no, x.variant, x.color, x.finance_bank, x.movement_reason,
    [x.driver_name, x.driver_mobile].filter(Boolean).join(" / "), x.remarks];
  return gate === "Bhilarwadi" ? row.filter((_, k) => k !== (includeSerial ? 10 : 9)) : row;
}
function exportGateRows(){
  if(!GATE_ROWS.length){ toast("Nothing to export.","error"); return; }
  const g = GATE_GATE || ""; exportSheet("gate-movements", gateCols(g,false), GATE_ROWS.map((x,i) => gatePlainRow(x, i, g, false)));
}

/* ---- In-Out Register ------------------------------------------------------------ */
async function renderGateRegister(){
  if(state.supabase) await getLocations();
  $("content").innerHTML = `<div class="panel gate-recent-panel"><div class="gate-recent-head"><h3>In-Out Register</h3>${gateFiltersHtml()}</div>${gateFilterPanel()}<div id="gateRegister" class="table-wrap">${emptyState("Loading...")}</div></div>`;
  bindGateFilters(loadGateRegister);
  return loadGateRegister();
}
async function loadGateRegister(){
  const box = $("gateRegister"); if(!box) return;
  if(!state.supabase){ box.innerHTML = emptyState("Connect Supabase to view the register."); return; }
  try {
    GATE_GATE = ""; GATE_ROWS = await fetchGateRows(500);
    const canEdit = canEditGate();
    mountPaged(box, {
      headers:[...GATE_COLS_ALL, ...(canEdit ? ["Action"] : [])],
      rows:GATE_ROWS.map((x,i) => [...gatePlainRow(x, i), ...(canEdit ? [raw(`<button class="table-icon-btn" type="button" title="Edit" data-register-edit="${i}">✎</button><button class="table-icon-btn danger" type="button" title="Delete" data-register-delete="${i}">🗑</button>`)] : [])]),
      size:50, empty:"No gate movements yet.",
      onDraw:el => {
        el.querySelectorAll("[data-register-edit]").forEach(b => b.addEventListener("click", () => openGateEdit(GATE_ROWS[+b.dataset.registerEdit], loadGateRegister)));
        el.querySelectorAll("[data-register-delete]").forEach(b => b.addEventListener("click", () => deleteGateMovements([GATE_ROWS[+b.dataset.registerDelete]], loadGateRegister)));
      }
    });
  } catch(err){ box.innerHTML = emptyState("Register unavailable: " + err.message); }
}
