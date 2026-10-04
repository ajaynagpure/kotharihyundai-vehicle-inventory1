"use strict";
/* =====================================================================
   DELIVERY: Delivery Entry (auto-fill by VIN, every field editable / manual) |
             Delivered Vehicles + Delivery History (date / location filter, Excel export, edit, delete)
  Auto-fill: Engine No, Model, Variant, Colour, Finance Name  <- Purchase report
          Customer Name, Bill Inv No, Bill Location <- Sales report
   ===================================================================== */
const DEL = {vehicle:null, rows:[], from:"", to:"", loc:"", q:""};
// [key, label, input type, source hint]
const DEL_FIELDS = [
  ["engine_no","ENGINE NO","text","Purchase report"], ["model","MODEL","text","Purchase report"], ["variant","VARIANT","text","Purchase report"],
  ["color","COLOUR","text","Purchase report"], ["finance_company","FINANCE NAME","text","Purchase report"], ["customer_name","CUSTOMER NAME","text","Sales report"],
  ["bill_no","TALLY INVOICE NO","text","Sales report"]
];
const DEL_ENTRY_FIELDS = [
  ["main_dealer",FIELD_HEADING.main_dealer,"Purchase report"],["dealer_code",FIELD_HEADING.dealer_code,"Purchase report"],["excise_invoice_no",FIELD_HEADING.excise_invoice_no,"Purchase report"],
  ["hmi_invoice_no",FIELD_HEADING.hmi_invoice_no,"Purchase report"],["order_date",FIELD_HEADING.order_date,"Purchase report","date"],["order_no",FIELD_HEADING.order_no,"Purchase report"],
  ["hmi_invoice_date",FIELD_HEADING.hmi_invoice_date,"Purchase report","date"],["hmi_invoice_amount",FIELD_HEADING.hmi_invoice_amount,"Purchase report","money"],
  ["bhilarwadi_in_date","BHILARWADI VEHICLE IN DT","Bhilarwadi IN"],["model","Model","Purchase report"],["variant","Variant","Purchase report"],
  ["color",FIELD_HEADING.color,"Purchase report"],["vin",FIELD_HEADING.vin,"Vehicle Stock"],["basic_price",FIELD_HEADING.basic_price,"Purchase report","money"],
  ["freight_insurance",FIELD_HEADING.freight_insurance,"Purchase report","money"],["total_invoice_value",FIELD_HEADING.total_invoice_value,"Purchase report","money"],
  ["gst","GST","Purchase report","money"],["comp_cess","Comp Cess","Purchase report","money"],["engine_no","Engine No","Purchase report"],
  ["finance_company",FIELD_HEADING.finance_company,"Purchase report"],["delivery_date",FIELD_HEADING.delivery_date,"manual","date"],
  ["delivery_location",FIELD_HEADING.sales_location,"Sales report"],["bill_date",FIELD_HEADING.bill_date,"Sales report","date"],
  ["bill_no",FIELD_HEADING.bill_no,"Sales report"],["customer_name",FIELD_HEADING.customer_name,"Sales report"]
];
const DEL_COLS = [
  ["Delivery Date","delivery_date","date"],["VIN No.","vin"],["Engine No","engine_no"],["Model","model"],["Variant","variant"],["Colour","color"],
  ["Customer Name","customer_name"],["Tally Invoice No","bill_no"],["Financier Name","finance_company"],["Delivery Location","dloc"]
];
const delClean = v => { const t = String(v ?? "").trim(); return t === "" ? null : t; };
const delVin = v => String(v || "").replace(/\s+/g, "").toUpperCase();

/** Exact VIN, or last 6+ digits when only one vehicle ends with them. */
async function delFindVehicle(vinRaw){
  const vin = delVin(vinRaw), sb = state.supabase;
  if(!vin) return {error:"Enter the VIN."};
  let r = await sb.from("vehicles").select("*").eq("vin", vin).maybeSingle();
  if(r.error) return {error:r.error.message};
  if(r.data) return {v:r.data};
  if(vin.length >= 6){
    const f = await sb.from("vehicles").select("*").ilike("vin", `%${vin}`).limit(2);
    if(f.data?.length === 1) return {v:f.data[0]};
    if(f.data?.length > 1) return {error:"More than one vehicle ends with these digits — enter more of the VIN."};
  }
  return {error:"VIN not found in vehicle stock. Import the Purchase report first."};
}
function delLocOptions(selected){
  const names = (state.locations || []).filter(l => l.active !== false).map(l => l.location_name);
  if(selected && !names.some(n => n.toLowerCase() === selected.toLowerCase())) names.push(selected);
  const sel = names.find(n => n.toLowerCase() === String(selected || "").toLowerCase()) || "";
  return `<option value="">— Select location —</option>` + names.map(n => `<option value="${esc(n)}" ${n === sel ? "selected" : ""}>${esc(n)}</option>`).join("");
}
const delInput = (k, label, val, hint, id = "d_") => `<div><label for="${id}${k}">${label}${hint ? ` <small style="font-weight:400;color:#98a2b3">(${hint})</small>` : ""}</label><input id="${id}${k}" name="${k}" value="${esc(val ?? "")}" autocomplete="off"></div>`;

async function renderDelivery(page){
  const titles = {"delivery-entry":"Delivery Entry", delivered:"Delivered Vehicles", "delivery-history":"Delivery History"};
  if(page !== "delivery-entry") return renderDeliveryList(page, titles[page]);
  await getLocations(); DEL.vehicle = null;
  $("content").innerHTML = `<div class="panel"><div class="panel-head"><h3>Delivery Entry</h3></div>
  <p class="form-help">Enter the VIN and press <b>Fetch</b> (or Enter). Purchase details, Bhilarwadi IN date and Sales details are fetched from their reports. Enter the Delivery Date manually.</p>
  <form id="deliveryForm" class="form-grid">
    <div class="full"><label for="d_vin">VIN *</label><div class="searchbox" style="max-width:none"><input id="d_vin" name="vin" required autocomplete="off" placeholder="VIN or last 6 digits"><button type="button" id="d_fetch">Fetch</button></div><div id="d_info" class="form-help"></div></div>
    ${DEL_ENTRY_FIELDS.filter(([k]) => k !== "vin").map(([k,label,source,type]) => `<div><label for="d_${k}">${esc(label)}${source ? ` <small style="font-weight:400;color:#98a2b3">(${esc(source)})</small>` : ""}</label><input id="d_${k}" name="${k}" type="${type === "date" ? "date" : "text"}" ${source === "manual" ? "" : "readonly"} ${k === "delivery_date" ? `value="${todayLocal()}"` : ""}></div>`).join("")}
    <div class="full form-actions"><button class="primary-btn" type="submit">Complete Delivery</button></div></form></div>`;
  $("deliveryForm").addEventListener("submit", saveDelivery);
  $("d_fetch").addEventListener("click", delFetchInto);
  $("d_vin").addEventListener("keydown", e => { if(e.key === "Enter"){ e.preventDefault(); delFetchInto(); } });
  $("d_vin").addEventListener("change", delFetchInto);
}
async function delFetchInto(){
  const info = $("d_info"); if(!info || !state.supabase) return;
  if(!delVin($("d_vin").value)) return;
  const r = await delFindVehicle($("d_vin").value);
  if(r.error){ DEL.vehicle = null; info.textContent = r.error + " You can still type the details manually only after the VIN exists in stock."; info.style.color = "#b42318"; return; }
  const v = r.v; DEL.vehicle = v; $("d_vin").value = v.vin;
  const inMovement = await state.supabase.from("gate_movements").select("receipt_dt,created_at").eq("vin", v.vin).eq("gate_name", "Bhilarwadi").eq("movement_type", "IN").order("created_at", {ascending:false}).limit(1).maybeSingle();
  const values = {...v,
    bhilarwadi_in_date:inMovement.data?.receipt_dt || inMovement.data?.created_at || "",
    gst:Number(v.igst || 0) + Number(v.cgst || 0) + Number(v.sgst || 0),
    delivery_location:v.sales_location || ""
  };
  DEL_ENTRY_FIELDS.forEach(([k,,source,type]) => {
    const el = $("d_" + k); if(!el) return;
    const value = values[k] ?? "";
    el.value = type === "date" && value ? String(value).slice(0,10) : type === "money" && k === "gst" ? String(value) : value;
  });
  const purchase = !isBlank(v.hmi_invoice_no) || !isBlank(v.engine_no), sales = !isBlank(v.bill_no) || !isBlank(v.sales_imported_at);
  info.style.color = vStage(v) === "delivered" ? "#b42318" : "#027a48";
  info.textContent = `Status: ${v.status || "-"} · Purchase data: ${purchase ? "found" : "not found (type manually)"} · Sales data: ${sales ? "found" : "not found (type manually)"}` + (vStage(v) === "delivered" ? " · Already delivered — saving again will update it." : "");
}
/** Fields that go on the vehicle record. clear=true lets an empty box erase the value (edit). */
function delVehiclePatch(f, clear){
  const p = {};
  [...DEL_FIELDS.map(x => x[0]), "delivery_date", "delivery_location"].forEach(k => {
    let v = f[k]; if(k === "engine_no" && v) v = delVin(v);
    if(v !== null && v !== undefined) p[k] = v; else if(clear) p[k] = null;
  });
  return p;
}
const delRowPayload = (f, vehicleId) => { const p = {vehicle_id:vehicleId}; ["delivery_date","customer_name","finance_company","delivery_location","engine_no","model","variant","color","bill_no"].forEach(k => { if(f[k] !== null && f[k] !== undefined) p[k] = f[k]; }); return p; };

async function saveDelivery(e){
  e.preventDefault();
  if(!state.supabase){ toast("Connect Supabase first.","error"); return; }
  const btn = e.target.querySelector("button[type=submit]"); btn.disabled = true;
  try {
    const f = {}; for(const [k, v] of new FormData(e.target).entries()) f[k] = delClean(v);
    const r = await delFindVehicle(f.vin); if(r.error){ toast(r.error,"error"); return; }
    const v = r.v;
    if(vStage(v) !== "bill"){ toast("Not in Tally Done. Delivery cannot be completed.", "error"); return; }
    if(!f.delivery_date) f.delivery_date = todayLocal();
    importDropped.clear();
    let ins = await importWrite(b => state.supabase.from("deliveries").insert(b), delRowPayload(f, v.id));
    if(ins.error && /delivery_no/i.test(ins.error.message) && /null/i.test(ins.error.message))     // old database still requires a number: use the VIN tail
      ins = await importWrite(b => state.supabase.from("deliveries").insert(b), {...delRowPayload(f, v.id), delivery_no:v.vin.slice(-8)});
    if(ins.error){ toast(ins.error.message,"error"); return; }
    const up = await importWrite(b => state.supabase.from("vehicles").update(b).eq("id", v.id).select("id"), {...delVehiclePatch(f, false), status: window.APP_CONFIG.deliveredStatus});
    if(up.error || !up.data?.length){ toast("Delivery saved, but vehicle status was not updated: " + (up.error?.message || "no permission"), "error"); return; }
    VCACHE.rows = null; logAudit("DELIVERY","delivery","vehicles",v.id,{vin:v.vin});
    const skipped = [...importDropped]; 
    e.target.reset(); e.target.delivery_date.value = todayLocal(); DEL.vehicle = null; $("d_info").textContent = "";
    $("d_delivery_location").innerHTML = delLocOptions("");
    toast(skipped.length ? `Delivery completed. Not saved (run DELIVERY_ENTRY.sql): ${skipped.join(", ")}` : "Delivery completed.", skipped.length ? "error" : "success");
  } finally { btn.disabled = false; }
}

/* ---------------------------------------------------------------- Delivered Vehicles / Delivery History */
const delCell = (v, [, k, t]) => t === "date" ? fmtD(v[k]) : (v[k] ?? "");
function delFiltered(){
  const q = delVin(DEL.q);
  return DEL.rows.filter(v => {
    const d = String(v.delivery_date || "").slice(0, 10);
    if(DEL.from && (!d || d < DEL.from)) return false;
    if(DEL.to && (!d || d > DEL.to)) return false;
    if(DEL.loc && v.dloc !== DEL.loc) return false;
    return !q || delVin(v.vin).includes(q);
  });
}
async function renderDeliveryList(page, title){
  DEL.from = DEL.to = DEL.loc = DEL.q = "";
  $("content").innerHTML = `<div class="panel"><div class="panel-head"><h3>${esc(title)}</h3>
    <div class="report-tools"><button class="secondary-btn" type="button" id="delExport" title="Export delivery records">⤓ Export</button></div></div>
    <div class="delivery-filter-row">
      <label class="delivery-vin-search">Search VIN<input id="delQ" type="search" placeholder="Enter VIN / last 6 digits" autocomplete="off"></label>
      <label class="delivery-location-filter">Delivery location<select id="delLoc"><option value="">All locations</option></select></label>
      <div class="delivery-date-filters"><label>From date<input id="delFrom" type="date"></label><label>To date<input id="delTo" type="date"></label></div>
      <button class="secondary-btn delivery-clear-filter" type="button" id="delClear">Clear</button>
    </div>
    <p id="delMeta" class="form-help"></p><div id="deliveryResults">${emptyState("Loading...")}</div></div>`;
  await loadDeliveries();
}
async function loadDeliveries(){
  const box = $("deliveryResults"); if(!box || !state.supabase) return;
  try {
    const all = await allVehicles(true); await getLocations();
    const vehiclesById = new Map(all.map(v => [String(v.id),v]));
    const deliveryRecords = await fetchAll(() => state.supabase.from("deliveries").select("*").order("created_at",{ascending:false}), {max:50000});
    const seenVehicles = new Set();
    const fromDeliveries = deliveryRecords.map(d => {
      const vehicle = vehiclesById.get(String(d.vehicle_id));
      if(!vehicle || seenVehicles.has(String(vehicle.id))) return null;
      seenVehicles.add(String(vehicle.id));
      return {...vehicle,...d,id:vehicle.id,delivery_record_id:d.id,status:vStage(vehicle) === "delivered" ? vehicle.status : window.APP_CONFIG.deliveredStatus,
        delivery_date:d.delivery_date || vehicle.delivery_date || d.created_at,dno:d.delivery_no || vehicle.delivery_no || vehicle.grn_no || "",
        dloc:d.delivery_location || vehicle.delivery_location || vehicle.sales_location || (vehicle.location_id ? locName(vehicle.location_id) : "")};
    }).filter(Boolean);
    const withoutDeliveryRecord = all.filter(v => vStage(v) === "delivered" && !seenVehicles.has(String(v.id)))
      .map(v => ({...v,dno:v.delivery_no || v.grn_no || "",dloc:v.delivery_location || v.sales_location || (v.location_id ? locName(v.location_id) : "")}));
    DEL.rows = [...fromDeliveries,...withoutDeliveryRecord]
      .sort((a,b) => String(b.delivery_date || b.created_at || "").localeCompare(String(a.delivery_date || a.created_at || "")));
    const locs = sortLocationNames(new Set([...(state.locations || []).map(l => l.location_name), ...DEL.rows.map(v => v.dloc).filter(Boolean)]));
    $("delLoc").innerHTML = `<option value="">All locations</option>` + locs.map(n => `<option ${n === DEL.loc ? "selected" : ""}>${esc(n)}</option>`).join("");
    const pg = mountPaged(box, {headers:[...DEL_COLS.map(c => c[0]), ""], empty:"No delivered vehicles for this filter.",
      rows:() => delFiltered().map(v => [...DEL_COLS.map(c => c[1] === "vin" ? raw(`<b class="mono">${esc(v.vin)}</b>`) : delCell(v, c)),
        raw(`<button type="button" class="table-icon-btn" data-dedit="${esc(v.id)}" title="Edit delivery">✎</button><button type="button" class="table-icon-btn danger" data-ddel="${esc(v.id)}" title="Delete delivery entry">🗑</button>`)]),
      onDraw:el => {
        el.querySelectorAll("[data-dedit]").forEach(b => b.addEventListener("click", () => delEdit(b.dataset.dedit)));
        el.querySelectorAll("[data-ddel]").forEach(b => b.addEventListener("click", () => delDelete(b.dataset.ddel)));
      }});
    const meta = () => { $("delMeta").textContent = `${delFiltered().length.toLocaleString("en-IN")} of ${DEL.rows.length.toLocaleString("en-IN")} delivered vehicles`; };
    const apply = () => { DEL.from = $("delFrom").value; DEL.to = $("delTo").value; DEL.loc = $("delLoc").value; DEL.q = $("delQ").value; meta(); pg.reset(); };
    ["delFrom","delTo","delLoc","delQ"].forEach(id => { $(id).oninput = apply; $(id).onchange = apply; });
    $("delClear").onclick = () => { ["delFrom","delTo","delLoc","delQ"].forEach(id => { $(id).value = ""; }); apply(); };
    $("delExport").onclick = () => {
      const l = delFiltered(); if(!l.length) return toast("Nothing to export.","error");
      exportSheet("delivered-vehicles", DEL_COLS.map(c => c[0]), l.map(v => DEL_COLS.map(c => c[2] === "date" ? String(v[c[1]] || "").slice(0, 10) : (v[c[1]] ?? ""))));
    };
    apply();
  } catch(err){ box.innerHTML = emptyState("Could not load: " + (err.message || err)); }
}
/* ---------------------------------------------------------------- Edit / Delete delivery entry */
async function delEdit(id, reload = loadDeliveries){
  const v = DEL.rows.find(x => String(x.id) === String(id)); if(!v) return;
  const sb = state.supabase;
  const d = (await sb.from("deliveries").select("*").eq("vehicle_id", v.id).limit(1)).data?.[0] || {};
  await getLocations();
  const val = k => v[k] ?? d[k] ?? "";
  openModal(`<div class="modal-bg"><div class="modal wide" role="dialog" aria-modal="true"><div class="panel-head"><h3>Edit Delivery — <span class="mono">${esc(v.vin)}</span></h3><button class="icon-btn" type="button" id="modalClose">×</button></div>
    <form id="delEditForm"><div class="edit-scroll"><div class="edit-grid">
    ${DEL_FIELDS.map(([k, l]) => delInput(k, l, val(k), "", "de_")).join("")}
    <div><label for="de_delivery_location">DELIVERY LOCATION</label><select id="de_delivery_location" name="delivery_location">${delLocOptions(v.dloc)}</select></div>
    <div><label for="de_delivery_date">DELIVERY DATE</label><input id="de_delivery_date" name="delivery_date" type="date" value="${esc(String(v.delivery_date || "").slice(0, 10))}"></div>
</div></div>
    <div class="form-actions"><button type="button" class="secondary-btn" id="modalCancel">Cancel</button><button class="primary-btn" type="submit">Save Changes</button></div></form></div></div>`);
  $("modalClose").onclick = closeModal; $("modalCancel").onclick = closeModal;
  $("delEditForm").addEventListener("submit", async e => {
    e.preventDefault();
    const f = {}; for(const [k, x] of new FormData(e.target).entries()) f[k] = delClean(x);
    importDropped.clear();
    const up = await importWrite(b => sb.from("vehicles").update(b).eq("id", v.id).select("id"), delVehiclePatch(f, true));
    if(up.error) return toast(up.error.message, "error");
    if(!up.data?.length) return toast("Not saved — no permission to edit.", "error");
    const payload = delRowPayload(f, v.id); ["delivery_date","customer_name","finance_company","delivery_location","engine_no","model","variant","color","bill_no"].forEach(k => { if(!(k in payload)) payload[k] = null; });
    delete payload.vehicle_id;
    const has = (await sb.from("deliveries").select("vehicle_id").eq("vehicle_id", v.id).limit(1)).data?.length;
    const x = has ? await importWrite(b => sb.from("deliveries").update(b).eq("vehicle_id", v.id), payload)
                  : await importWrite(b => sb.from("deliveries").insert(b), {...payload, vehicle_id:v.id});
    if(x.error) toast("Vehicle updated, delivery record not updated: " + x.error.message, "error");
    else toast("Delivery updated.", "success");
    VCACHE.rows = null; logAudit("UPDATE_DELIVERY","delivery","vehicles",v.id,f); closeModal(); reload();
  });
}
async function deleteDeliveryRecord(v){
  if(!v) return {error:"Vehicle not found."};
  const back = (!isBlank(v.bill_no) || !isBlank(v.sales_imported_at)) ? "Tally Done" : v.location_id ? "In Stock" : (!isBlank(v.hmi_invoice_no) || !isBlank(v.purchase_date)) ? "In Transit" : "Pending Order";
  const sb = state.supabase; importDropped.clear();
  const d = await sb.from("deliveries").delete().eq("vehicle_id", v.id).select("vehicle_id");
  if(d.error) return {error:d.error.message};
  const up = await importWrite(b => sb.from("vehicles").update(b).eq("id", v.id).select("id"), {status:back, delivery_date:null, delivery_location:null});
  if(up.error || !up.data?.length) return {error:up.error?.message || "Not changed — no permission to edit / delete."};
  VCACHE.rows = null; logAudit("DELETE_DELIVERY","delivery","vehicles",v.id,{vin:v.vin, back});
  return {back};
}
async function delDelete(id, reload = loadDeliveries){
  const v = DEL.rows.find(x => String(x.id) === String(id)); if(!v) return;
  const back = (!isBlank(v.bill_no) || !isBlank(v.sales_imported_at)) ? "Tally Done" : v.location_id ? "In Stock" : (!isBlank(v.hmi_invoice_no) || !isBlank(v.purchase_date)) ? "In Transit" : "Pending Order";
  if(!confirm(`Delete the delivery entry of ${v.vin}?\n\nThe vehicle goes back to "${statusLabel(back)}". The vehicle record itself is kept.`)) return;
  const result = await deleteDeliveryRecord(v);
  if(result.error) return toast(result.error, "error");
  toast("Delivery entry deleted.", "success"); reload();
}
