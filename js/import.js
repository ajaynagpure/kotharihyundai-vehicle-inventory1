"use strict";
/* =====================================================================
   IMPORT: Order report -> Pending Order | Purchase report -> In Transit
           Sales report -> Tally Done | Import history
   Column mapping comes from EXCEL_FIELDS (js/fields.js) = Excel headings.
   ===================================================================== */
const IMPORT_TYPES = {
  "order-import":    {key:"ORDER",    status:"Pending Order", title:"Order Report Import"},
  "purchase-import": {key:"PURCHASE", status:"In Transit",    title:"Purchase Report Import"},
  "sales-import":    {key:"SALES",    status:"Tally Done", title:"Sales Report Import"},
  "delivery-import": {key:"DELIVERY", status:"Delivered", title:"Delivery Report Import"}
};
const IMPORT_COLUMNS = {
  ORDER:["order_date","order_no","pis_no","model","variant","color","order_amount","order_type","assigned_date","confirm_date","vin","order_status","customer_id","customer_name"],
  PURCHASE:["main_dealer","dealer_code","hmi_invoice_date","hmi_invoice_no","excise_invoice_no","order_date","order_no","model","variant","color","vin","fsc","variant_code","engine_no","finance_company","departure_date","lot_number","transporter_name","transporter_vehicle_no","basic_price","freight_insurance","total_invoice_value","igst_pct","igst","cgst_pct","cgst","sgst_pct","sgst","comp_cess_pct","comp_cess","tcs_pct","tcs_value","hmi_invoice_amount","hsn_code","emission_type","quantity","grn_no","grn_date","sale_tax","fob_key"],
  SALES:["bill_date","vin","engine_no","customer_name","bill_no","sales_location","model","variant","color","total_invoice_value"],
  DELIVERY:["main_dealer","dealer_code","excise_invoice_no","hmi_invoice_no","order_date","order_no","hmi_invoice_date","hmi_invoice_amount","bhilarwadi_in_date","model","variant","color","vin","basic_price","freight_insurance","total_invoice_value","gst","comp_cess","engine_no","finance_company","delivery_date","delivery_location","bill_date","bill_no","customer_name"]
};
const DELIVERY_COLUMN_LABELS = Object.fromEntries(IMPORT_COLUMNS.DELIVERY.map(k => [k,
  k === "bhilarwadi_in_date" ? "BHILARWADI VEHICLE IN DT" : k === "gst" ? "GST" : k === "delivery_location" ? FIELD_HEADING.sales_location : FIELD_HEADING[k]
]));
let importHubPage = "";
const STATUS_MOVABLE = ["", "pending order", "in transit", "cancelled order"];   // purchase import never pulls later stages back
const SQL_HINT = "Database columns are missing. Run IMPORT_COLUMNS_FIX.sql once in Supabase SQL Editor, then import again.";
let importRows = [];
const importDropped = new Set();                              // columns the database does not have (skipped safely)

function importNorm(h){ return String(h ?? "").toLowerCase().replace(/%/g," pct ").replace(/[^a-z0-9]+/g," ").trim(); }
const IMPORT_HEADER_MAP = (() => {                            // normalised Excel header -> [db column, type]
  const m = new Map();
  [...EXCEL_FIELDS, ...DERIVED_FIELDS].forEach(([k, heading, type, extra = []]) => [heading, ...extra].forEach(a => { if(!m.has(importNorm(a))) m.set(importNorm(a), [k, type]); }));
  m.set(importNorm("GST"), ["gst", "money"]);
  m.set(importNorm("BHILARWADI VEHICLE IN DT"), ["bhilarwadi_in_date", "date"]);
  m.set(importNorm("HMI INV. DATE"), ["hmi_invoice_date", "date"]);
  m.set(importNorm("HMI INV AMOUNT"), ["hmi_invoice_amount", "money"]);
  m.set(importNorm("Customer's Name"), ["customer_name", "text"]);
  return m;
})();
function importDate(v){
  if(v instanceof Date) return isNaN(v) ? null : `${v.getFullYear()}-${String(v.getMonth()+1).padStart(2,"0")}-${String(v.getDate()).padStart(2,"0")}`;
  const s = String(v ?? "").trim();
  let m = /^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/.exec(s);           // portal exports use dd/mm/yyyy
  if(m){ const [d, mo, y] = [+m[1], +m[2], +m[3]]; return (y < 1900 || mo < 1 || mo > 12 || d < 1 || d > 31) ? null : `${y}-${String(mo).padStart(2,"0")}-${String(d).padStart(2,"0")}`; }
  m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}
function importNum(v){ const n = Number(String(v ?? "").replace(/[^\d.\-]/g,"")); return isFinite(n) ? n : 0; }

/** One Excel row -> record keyed by database column names (typed, blanks removed). */
function importMap(raw){
  const r = {};
  for(const [header, value] of Object.entries(raw)){
    const hit = IMPORT_HEADER_MAP.get(importNorm(header)); if(!hit) continue;
    const [k, type] = hit;
    if(value instanceof Date ? isNaN(value) : isBlank(String(value).trim())) continue;
    if(k in r) continue;                                       // first matching header wins
    if(type === "date"){ const d = importDate(value); if(d) r[k] = d; }
    else if(type === "money" || type === "num") r[k] = importNum(value);
    else r[k] = String(value).trim();
  }
  if(r.model && MODEL_ALIASES[r.model.toLowerCase()]) r.model = MODEL_ALIASES[r.model.toLowerCase()];
  if(r.vin) r.vin = r.vin.replace(/\s+/g,"").toUpperCase();
  if(r.engine_no) r.engine_no = r.engine_no.replace(/\s+/g,"").toUpperCase();
  if(r.order_no && /^\d+$/.test(r.order_no) && r.order_no.length < 10) r.order_no = r.order_no.padStart(10,"0");
  if(!r.dealer_code && r.pis_no) r.dealer_code = r.pis_no.slice(0,5).toUpperCase();   // PIS No W2203FH591 -> dealer W2203
  return r;
}
/** Record -> database payload. kind: ORDER | PURCHASE */
function importPayload(r, kind, status){
  const p = {};
  for(const [k] of EXCEL_FIELDS) if(r[k] !== undefined && r[k] !== null && r[k] !== "") p[k] = r[k];
  if(p.vin) p.chassis_no = p.vin;
  if(kind === "PURCHASE"){
    if(r.hmi_invoice_amount !== undefined) p.stock_value = r.hmi_invoice_amount;
    if(r.hmi_invoice_date) p.purchase_date = r.hmi_invoice_date;
  } else if(r.order_amount !== undefined) p.stock_value = r.order_amount;
  if(status) p.status = status;
  if(!state.isAdmin && state.profile?.location_id) p.location_id = state.profile.location_id;
  return p;
}
const importChunks = (arr, n) => { const out = []; for(let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out; };
const SALES_KEEP = ["vin","customer_name","bill_date","bill_no","sales_location"];   // the only Sales report columns that are imported
const importSalesOnly = r => Object.fromEntries(Object.entries(r).filter(([k]) => SALES_KEEP.includes(k)));
const importHasPurchase = v => !!v && (!isBlank(v.hmi_invoice_no) || !isBlank(v.hmi_invoice_date) || !isBlank(v.purchase_date));   // VIN is in the Purchase report
let importIgnored = [];
const importIsInvoiced = r => String(r.order_status || "").toLowerCase() === "invoiced" && (typeof sysBool !== "function" || sysBool("imp_order_invoiced_to_transit"));
const importIsCancelled = r => /cancel/i.test(String(r.order_status || ""));
function importDedupe(rows, keyOf){ const m = new Map(); rows.forEach((r, i) => m.set(keyOf(r) || "row" + i, r)); return [...m.values()]; }

/* ---- Safe writes: a column the database lacks is skipped (and reported), never a hard error ---- */
const importStrip = p => Object.fromEntries(Object.entries(p).filter(([k]) => !importDropped.has(k)));
function importMissingColumn(err){
  const msg = String(err?.message || "");
  if(!/does not exist|schema cache|could not find/i.test(msg)) return null;
  const m = /the '([a-z0-9_]+)' column/i.exec(msg) || /column "?(?:vehicles\.)?([a-z0-9_]+)"?/i.exec(msg);
  return m ? m[1] : null;
}
async function importWrite(run, payload){
  for(let i = 0; i < 80; i++){
    const r = await run(Array.isArray(payload) ? payload.map(importStrip) : importStrip(payload));
    if(!r.error) return r;
    const c = importMissingColumn(r.error);
    if(!c || importDropped.has(c) || ["vin","order_no","status"].includes(c)) return r;
    importDropped.add(c);
  }
  return {error:{message:"Too many missing columns. " + SQL_HINT}};
}

async function importFetchExisting(rows){
  const sb = state.supabase, byOrder = new Map(), byVin = new Map();
  const load = async (col, values) => {
    for(const part of importChunks([...new Set(values)], 80)){
      const {data, error} = await sb.from("vehicles").select("id,vin,order_no,status,main_dealer,dealer_code,excise_invoice_no,order_date,engine_no,model,variant,color,customer_name,hmi_invoice_no,hmi_invoice_date,purchase_date,basic_price,freight_insurance,total_invoice_value,hmi_invoice_amount,igst,cgst,sgst,comp_cess,finance_company,bill_date,bill_no,sales_location").in(col, part);
      if(error) throw error;
      (data || []).forEach(v => { if(v.order_no) byOrder.set(v.order_no, v); if(v.vin) byVin.set(v.vin, v); });
    }
  };
  await load("order_no", rows.map(r => r.order_no).filter(Boolean));
  await load("vin", rows.map(r => r.vin).filter(Boolean));
  return {byOrder, byVin};
}
async function importFetchBhilarwadiInDates(rows){
  const dates = new Map(), vins = [...new Set(rows.map(r => r.vin).filter(Boolean))];
  for(const part of importChunks(vins, 80)){
    const result = await state.supabase.from("gate_movements").select("vin,receipt_dt,created_at")
      .eq("gate_name","Bhilarwadi").eq("movement_type","IN").in("vin",part).order("created_at",{ascending:false});
    if(result.error) throw result.error;
    (result.data || []).forEach(row => { if(row.vin && !dates.has(row.vin)) dates.set(row.vin, row.receipt_dt || row.created_at || ""); });
  }
  return dates;
}
const importFind = (ex, r) => (r.order_no && ex.byOrder.get(r.order_no)) || (r.vin && ex.byVin.get(r.vin)) || null;

async function renderImport(page){
  if(page === "import-history") return renderImportHistory();
  if(page === "import-data") return renderImportedData();
  if(page === "data-import"){
    const available = Object.entries(IMPORT_TYPES).filter(([id]) => can(id));
    if(can("manual-purchase")) available.splice(available.findIndex(([id]) => id === "purchase-import") + 1, 0, ["manual-purchase", {title:"Manual Purchase Entry"}]);
    if(!available.length) return renderDenied();
    const active = available.some(([id]) => id === importHubPage) ? importHubPage : available[0][0];
    importHubPage = active;
    $("content").innerHTML = `<div class="import-hub"><div class="tabs" id="importTypeTabs">${available.map(([id,t]) => `<button type="button" class="tab-btn${id === active ? " active" : ""}" data-import-type="${id}">${esc(t.title)}</button>`).join("")}</div><div id="importTypeContent"></div></div>`;
    $("importTypeTabs").querySelectorAll("[data-import-type]").forEach(button => button.addEventListener("click", async () => {
      importHubPage = button.dataset.importType;
      $("importTypeTabs").querySelectorAll(".tab-btn").forEach(tab => tab.classList.toggle("active", tab === button));
      if(importHubPage === "manual-purchase") renderManualPurchaseEntry($("importTypeContent"));
      else await renderImportForm(importHubPage, $("importTypeContent"));
    }));
    if(active === "manual-purchase") return renderManualPurchaseEntry($("importTypeContent"));
    return renderImportForm(active, $("importTypeContent"));
  }
  if(page === "manual-purchase") return renderManualPurchaseEntry($("content"));
  return renderImportForm(page, $("content"));
}
function renderManualPurchaseEntry(target){
  if(!can("manual-purchase")){ renderDenied(); return; }
  const groups = [
    ["Hyundai Vehicle Details",["vin","model","variant","color","engine_no","hsn_code","quantity"]],
    ["Invoice and Finance Details",["finance_company","hmi_invoice_no","hmi_invoice_date"]],
    ["Purchase Values and Taxes",["basic_price","freight_insurance","total_invoice_value","hmi_invoice_amount","igst_pct","igst","cgst_pct","cgst","sgst_pct","sgst","comp_cess_pct","comp_cess","tcs_pct","tcs_value","sale_tax"]],
  ];
  const manualLabels = {hmi_invoice_no:"Other Dealer Invoice No.",hmi_invoice_date:"Other Dealer Date"};
  const blocked = state.settings?.imp?.PURCHASE === false;
  const field = key => {
    const type = FIELD_TYPE[key] || "text", inputType = type === "date" ? "date" : ["money","num"].includes(type) ? "number" : "text";
    return `<div><label for="mp_${key}">${esc(manualLabels[key] || FIELD_HEADING[key])}</label><input id="mp_${key}" name="${key}" type="${inputType}" ${inputType === "number" ? 'step="any"' : ""} ${key === "vin" ? "required" : ""}></div>`;
  };
  target.innerHTML = `<div class="panel import-panel"><div class="panel-head"><h3>Manual Purchase Entry — Other Dealer</h3></div>
    <p class="form-help">Enter the vehicle, invoice, finance and purchase value details. The vehicle is saved as In Transit; matching Pending Orders follow the existing Purchase Import rules.</p>
    ${blocked ? `<p class="message error">Purchase import is turned off in Settings → Import Configuration.</p>` : ""}
    <form id="manualPurchaseForm" class="form-grid">${groups.map(([title,keys]) => `<h4 class="full">${esc(title)}</h4>${keys.map(field).join("")}`).join("")}
      <div id="manualPurchaseMessage" class="message full"></div><div class="full form-actions"><button class="primary-btn" type="submit" ${blocked ? "disabled" : ""}>Save Purchase Entry</button></div></form></div>`;
  if(blocked) target.querySelectorAll("#manualPurchaseForm input").forEach(input => { input.disabled = true; });
  $("manualPurchaseForm").addEventListener("submit", saveManualPurchaseEntry);
}
async function saveManualPurchaseEntry(event){
  event.preventDefault();
  if(!state.supabase) return toast("Connect Supabase first.","error");
  const form = event.currentTarget, message = $("manualPurchaseMessage"), button = form.querySelector("button[type=submit]"), row = {};
  for(const key of IMPORT_COLUMNS.PURCHASE){
    const value = String(new FormData(form).get(key) || "").trim(); if(!value) continue;
    const type = FIELD_TYPE[key] || "text";
    row[key] = type === "date" ? importDate(value) : ["money","num"].includes(type) ? importNum(value) : value;
  }
  if(!row.vin) return toast("VIN No. is required.","error");
  row.vin = String(row.vin).replace(/\s+/g,"").toUpperCase();
  button.disabled = true; button.textContent = "Saving…"; message.textContent = "Saving Purchase Entry…"; message.className = "message full";
  importDropped.clear();
  try {
    const result = await importRunRows("PURCHASE",[row]);
    VCACHE.rows = null;
    const text = `${result.added} vehicle added as In Transit, ${result.updated} existing vehicle updated, ${result.failed} failed.` + (result.firstError ? ` ${result.firstError}` : "");
    message.textContent = text; message.className = `message full ${result.failed ? "error" : "success"}`;
    if(result.added || result.updated){
      try { await importWrite(b => state.supabase.from("import_batches").insert(b), {import_type:"PURCHASE",file_name:"Manual Purchase Entry",total_rows:1,successful_rows:result.added + result.updated,failed_rows:result.failed,status:result.failed ? "Partial" : "Completed"}); } catch {}
      logAudit("MANUAL_PURCHASE_ENTRY","import","vehicle",row.vin,{vin:row.vin,added:result.added,updated:result.updated});
      toast("Manual purchase entry saved.",result.failed ? "error" : "success"); form.reset();
    } else toast(result.firstError || "Purchase entry was not saved.","error");
  } catch(err){ message.textContent = importMissingColumn(err) ? SQL_HINT : err.message || "Manual purchase entry failed."; message.className = "message full error"; }
  finally { button.disabled = false; button.textContent = "Save Purchase Entry"; }
}
async function renderImportForm(page, target){
  const t = IMPORT_TYPES[page]; importRows = [];
  const rule = {
    ORDER: "File: <b>SaleDealerOrderStatus.xlsx</b>. <b>Ordered / Allocated</b> rows are added as <b>Pending Order</b>; <b>Invoiced</b> rows can be added as <b>In Transit</b>. <b>Cancelled Order</b> rows are imported with a separate status and are not counted in Pending Order or stock.",
    PURCHASE: "File: <b>VehicleDeliveryStatusReport.xlsx</b>. Imported as <b>In Transit</b>. If the <b>Order No</b> (or VIN) exists as Pending Order it moves to In Transit. Free Stock / Delivered vehicles keep their status.",
    SALES: "Only <b>Tally Invoice Date, VIN, Customer Name, Tally Invoice No and Tally Location</b> are imported; <b>Engine No, Model, Variant, Color and Total Invoice value</b> are fetched from the <b>Purchase report</b>. Matching VINs update their Sales details; Delivered vehicles stay Delivered. Rows whose VIN is not in the Purchase report are ignored.",
    DELIVERY: "Delivery rows match existing vehicles by VIN, save delivery details, and update matched vehicle status to <b>Delivered</b>. Rows without a matching vehicle or delivery date are skipped."
  }[t.key];
  const columnLabel = k => t.key === "DELIVERY" ? DELIVERY_COLUMN_LABELS[k] : FIELD_HEADING[k];
  const columns = IMPORT_COLUMNS[t.key].map(columnLabel).join(", ");
  target.innerHTML = `<div class="panel import-panel"><div class="panel-head"><h3>${esc(t.title)}</h3></div>
    <p class="form-help"><b>Columns:</b> ${esc(columns)}</p><p class="form-help">${rule}</p>
    <div class="dropzone"><input id="fileInput" type="file" accept=".csv,.xlsx,.xls"><div><button class="secondary-btn" id="importPreview" type="button">Preview</button> <button class="primary-btn" id="importGo" type="button" disabled>Import</button></div></div>
    <div id="importMsg" class="message"></div><div id="importPreviewBox" class="table-wrap"></div></div>`;
  $("importPreview").addEventListener("click", () => importPreviewFile(page));
  $("importGo").addEventListener("click", () => importRun(page));
  if(state.settings?.imp?.[t.key] === false){ $("importPreview").disabled = true; $("fileInput").disabled = true; $("importMsg").textContent = "This import is turned off in Settings → Import Configuration."; $("importMsg").className = "message error"; }
}
async function importPreviewFile(page){
  const f = $("fileInput").files[0], t = IMPORT_TYPES[page], msg = $("importMsg");
  if(!f) return toast("Select a file first.","error");
  if(!window.XLSX) return toast("Excel library not loaded (check internet).","error");
  let raw;
  try { const wb = XLSX.read(await f.arrayBuffer(), {type:"array", cellDates:true}); raw = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], {defval:""}); }
  catch { msg.textContent = "This file could not be read. Upload the original .xlsx / .csv report."; msg.className = "message error"; return; }
  const key = t.key === "SALES" ? r => r.vin : t.key === "ORDER" ? r => r.order_no : r => r.vin;
  importRows = importDedupe(raw.map(x => t.key === "SALES" ? importSalesOnly(importMap(x)) : importMap(x)).filter(r => r.order_no || r.vin), key);
  const unmapped = raw.length ? Object.keys(raw[0]).filter(h => !IMPORT_HEADER_MAP.has(importNorm(h)) && importNorm(h) !== "s no" && importNorm(h) !== "no") : [];
  const bad = importRows.filter(r => !key(r)).length;
  let info = `${importRows.length} rows read.`;
  if(t.key === "ORDER"){
    const cancelled = importRows.filter(importIsCancelled).length, inv = importRows.filter(r => !importIsCancelled(r) && importIsInvoiced(r)).length;
    info += ` ${importRows.length - cancelled - inv} → Pending Order, ${inv} Invoiced → In Transit, ${cancelled} Cancelled Order → separate status (not Pending Order).`;
  }
  let ex = null, deliveryInDates = new Map();
  try {
    ex = await importFetchExisting(importRows); const hit = importRows.filter(r => importFind(ex, r)).length;
    if(t.key === "DELIVERY") deliveryInDates = await importFetchBhilarwadiInDates(importRows);
    if(t.key === "SALES"){ const ok = importRows.filter(r => importHasPurchase(ex.byVin.get(r.vin))).length; info += ` ${ok} VIN found in Purchase report → Sales details will update. ${importRows.length - ok} VIN not in Purchase report → will be IGNORED.`; }
    else if(t.key === "DELIVERY"){ const matched = importRows.filter(r => ex.byVin.has(r.vin)).length; info += ` ${matched} VINs found in Vehicle Stock; ${importRows.length - matched} unmatched VINs will be ignored.`; }
    else info += t.key === "PURCHASE" ? ` ${hit} match existing stock, ${importRows.length - hit} new.` : ` ${hit} already in system.`;
  } catch(err){ info += " " + (importMissingColumn(err) ? SQL_HINT : "(Could not check existing stock: " + (err.message || err) + ")"); }
  if(bad) info += ` ${bad} rows have no ${t.key === "ORDER" ? "Order No" : "VIN"} and will be skipped.`;
  if(unmapped.length) info += ` Ignored columns: ${unmapped.join(", ")}.`;
  msg.textContent = info; msg.className = "message" + (bad ? " error" : " success");
  const orderCols = IMPORT_COLUMNS.ORDER, purchaseCols = IMPORT_COLUMNS.PURCHASE, salesCols = IMPORT_COLUMNS.SALES;
  const shown = IMPORT_COLUMNS[t.key];
  const matchHead = t.key === "SALES" ? ["Purchase match","After import"] : t.key === "DELIVERY" ? ["Vehicle match","After import"] : [];
  $("importPreviewBox").innerHTML = table([...shown.map(columnLabel), ...matchHead], importRows.slice(0, t.key === "SALES" ? 50 : 15).map(r => [...shown.map(c => {
    if(t.key === "DELIVERY"){
      const vehicle = ex?.byVin.get(r.vin);
      if(c === "bhilarwadi_in_date") return fmtD(deliveryInDates.get(r.vin));
      if(c === "delivery_date") return fmtD(r.delivery_date);
      if(c === "delivery_location") return vehicle?.sales_location || r.delivery_location || "-";
      if(c === "bill_date") return fmtD(vehicle?.bill_date || r.bill_date);
      if(c === "gst") return money(vehicle ? Number(vehicle.igst || 0) + Number(vehicle.cgst || 0) + Number(vehicle.sgst || 0) : r.gst);
      if(vehicle && c !== "vin") return fmtCell(FIELD_TYPE[c] || "text", vehicle[c] ?? r[c]);
      return fmtCell(FIELD_TYPE[c] || "text", r[c]);
    }
    if(c === "stock_value") return r.hmi_invoice_amount ?? r.order_amount;
    if(t.key === "SALES" && !SALES_KEEP.includes(c)){ const p = ex?.byVin.get(r.vin); return p ? (c === "total_invoice_value" ? (p.total_invoice_value ?? p.hmi_invoice_amount) : p[c]) : ""; }   // fetched from Purchase report
    return r[c];
    }), ...(t.key === "SALES" ? (() => { const p = ex?.byVin.get(r.vin), ok = importHasPurchase(p);
      return [ok ? "✓ Found" : "✗ Not in Purchase report", !ok ? "Ignored" : vStage(p) === "delivered" ? "Delivered (status kept)" : "Tally Done"]; })()
      : t.key === "DELIVERY" ? (() => { const vehicle = ex?.byVin.get(r.vin), found = !!vehicle; return [!found ? "✗ VIN not found" : vStage(vehicle) !== "bill" ? "✗ Not in Tally Done" : "✓ Tally Done", !found ? "Ignored" : vStage(vehicle) !== "bill" ? "Delivery blocked" : r.delivery_date ? "Will mark Delivered" : "Missing delivery date"]; })() : [])]));
  $("importGo").disabled = !importRows.length;
}
async function importInsertRows(rows, res){
  const sb = state.supabase;
  for(const part of importChunks(rows, 50)){
    const r = await importWrite(b => sb.from("vehicles").insert(b), part);
    if(!r.error){ res.added += part.length; continue; }
    for(const one of part){                                    // isolate the bad row(s)
      const x = await importWrite(b => sb.from("vehicles").insert(b), one);
      if(x.error){ res.failed++; res.firstError ||= x.error.message; } else res.added++;
    }
  }
}
async function importRunRows(key, rows){
  const sb = state.supabase, res = {added:0, updated:0, moved:0, skipped:0, deliveredUpdated:0, invoiced:0, cancelled:0, failed:0, ignored:0, firstError:""};
  if(key === "DELIVERY"){
    const ex = await importFetchExisting(rows), deliveryFields = ["delivery_date","customer_name","finance_company","delivery_location","engine_no","model","variant","color","bill_no"];
    const vehicleIds = [...new Set(rows.map(r => ex.byVin.get(r.vin)?.id).filter(Boolean))], existingDeliveries = new Set();
    for(const part of importChunks(vehicleIds, 80)){
      const found = await sb.from("deliveries").select("vehicle_id").in("vehicle_id", part);
      if(found.error) throw found.error;
      (found.data || []).forEach(row => existingDeliveries.add(String(row.vehicle_id)));
    }
    for(const r of rows){
      if(!r.vin){ res.failed++; res.firstError ||= "VIN missing"; continue; }
      const vehicle = ex.byVin.get(r.vin);
      if(!vehicle){ res.ignored++; importIgnored.push(r.vin); continue; }
      if(vStage(vehicle) !== "bill"){ res.failed++; res.firstError ||= `${r.vin}: Not in Tally Done. Delivery is blocked.`; continue; }
      if(!r.delivery_date){ res.failed++; res.firstError ||= `Delivery Date missing for ${r.vin}`; continue; }
      const hadDelivery = existingDeliveries.has(String(vehicle.id)), record = {vehicle_id:vehicle.id};
      if(r.delivery_no) record.delivery_no = r.delivery_no;
      const deliveryValues = {
        delivery_date:r.delivery_date,
        delivery_location:vehicle.sales_location || "",
        customer_name:vehicle.customer_name || "",
        bill_no:vehicle.bill_no || "",
        finance_company:vehicle.finance_company || "",
        engine_no:vehicle.engine_no || "",
        model:vehicle.model || "",
        variant:vehicle.variant || "",
        color:vehicle.color || ""
      };
      deliveryFields.forEach(k => { if(deliveryValues[k] !== "") record[k] = deliveryValues[k]; });
      const saveRecord = payload => hadDelivery
        ? sb.from("deliveries").update(payload).eq("vehicle_id", vehicle.id).select("vehicle_id")
        : sb.from("deliveries").insert(payload).select("vehicle_id");
      let saved = await importWrite(saveRecord, record);
      if(saved.error && !hadDelivery && /delivery_no/i.test(saved.error.message || "") && /null/i.test(saved.error.message || "")){
        saved = await importWrite(saveRecord, {...record, delivery_no:vehicle.vin.slice(-8)});
      }
      if(saved.error || !saved.data?.length){ res.failed++; res.firstError ||= saved.error?.message || `Delivery record not saved for ${r.vin}`; continue; }
      const vehiclePatch = {status:window.APP_CONFIG?.deliveredStatus || "Delivered"};
      deliveryFields.forEach(k => { if(deliveryValues[k] !== "") vehiclePatch[k] = deliveryValues[k]; });
      const updated = await importWrite(b => sb.from("vehicles").update(b).eq("id", vehicle.id).select("id"), vehiclePatch);
      if(updated.error || !updated.data?.length){ res.failed++; res.firstError ||= updated.error?.message || `Vehicle status not updated for ${r.vin}`; continue; }
      if(hadDelivery) res.updated++; else res.added++;
      res.deliveredUpdated++;
    }
    return res;
  }
  if(key === "SALES"){                                       // matched VIN -> Sales details; Delivered status stays Delivered
    const ex = await importFetchExisting(rows), now = new Date().toISOString();
    for(const r of rows.map(importSalesOnly)){
      if(!r.vin){ res.failed++; res.firstError ||= "VIN missing"; continue; }
      const cur = ex.byVin.get(r.vin);
      if(!importHasPurchase(cur)){ res.ignored++; importIgnored.push(r.vin); continue; }   // not in Purchase report -> ignore
      const delivered = vStage(cur) === "delivered";
      const patch = {sales_imported_at: now};
      if(!delivered) patch.status = IMPORT_TYPES["sales-import"].status;
      // Sales report always carries the bill details (latest report wins)
      ["customer_name","bill_date","bill_no","sales_location"].forEach(k => { if(r[k] !== undefined && r[k] !== "") patch[k] = r[k]; });
      // Engine No / Model / Variant / Color / Total Invoice value stay as per the Purchase report (not taken from the Sales file)
      const x = await importWrite(b => sb.from("vehicles").update(b).eq("id", cur.id).select("id"), patch);
      if(x.error){ res.failed++; res.firstError ||= x.error.message; }
      else if(!x.data?.length){ res.failed++; res.firstError ||= "Not saved — no permission to update vehicles (" + r.vin + ")"; }
      else { res.updated++; if(delivered) res.deliveredUpdated++; }
    }
    return res;
  }
  const ex = await importFetchExisting(rows), fresh = [], updates = [];
  if(key === "ORDER"){
    for(const r of rows){
      if(!r.order_no){ res.failed++; res.firstError ||= "Order No missing"; continue; }
      const cur = importFind(ex, r);
      if(cur){
        const curStage = vStage(cur), nextStatus = importIsCancelled(r) ? (["pending","cancelled"].includes(curStage) ? "Cancelled Order" : "") : curStage === "cancelled" ? (importIsInvoiced(r) ? "In Transit" : "Pending Order") : "";
        const patch = importPayload(r, "ORDER", nextStatus); delete patch.stock_value; delete patch.purchase_date;
        if(nextStatus === "Cancelled Order") res.cancelled++;
        updates.push({id:cur.id, patch, moved:false}); continue;
      }
      if(importIsCancelled(r)){ res.cancelled++; fresh.push(importPayload(r, "ORDER", "Cancelled Order")); continue; }
      if(importIsInvoiced(r)){ res.invoiced++; fresh.push(importPayload(r, "ORDER", "In Transit")); continue; }   // already invoiced by HMI
      fresh.push(importPayload(r, "ORDER", "Pending Order"));
    }
  } else {
    for(const r of rows){
      if(!r.vin){ res.failed++; res.firstError ||= "VIN missing"; continue; }
      const cur = importFind(ex, r);
      if(!cur){ fresh.push(importPayload(r, "PURCHASE", "In Transit")); continue; }
      const curSt = String(cur.status || "").toLowerCase(), movePending = typeof sysBool !== "function" || sysBool("imp_purchase_moves_pending");
      const movable = STATUS_MOVABLE.includes(curSt) && (curSt !== "pending order" || movePending);
      updates.push({id:cur.id, patch:importPayload(r, "PURCHASE", movable ? "In Transit" : ""), moved:movable && curSt === "pending order"});
    }
  }
  for(const part of importChunks(updates, 10)){
    await Promise.all(part.map(async u => {
      const x = await importWrite(b => sb.from("vehicles").update(b).eq("id", u.id), u.patch);
      if(x.error){ res.failed++; res.firstError ||= x.error.message; } else { res.updated++; if(u.moved) res.moved++; }
    }));
  }
  await importInsertRows(fresh, res);
  return res;
}
async function importRun(page){
  const t = IMPORT_TYPES[page], msg = $("importMsg");
  $("importGo").disabled = true; msg.className = "message"; msg.textContent = "Importing…"; importDropped.clear(); importIgnored = [];
  let res;
  try { res = await importRunRows(t.key, importRows); }
  catch(err){ msg.textContent = importMissingColumn(err) ? SQL_HINT : "Import stopped: " + (err.message || err); msg.className = "message error"; $("importGo").disabled = false; return; }
  if(typeof VCACHE !== "undefined") VCACHE.rows = null;
  const bits = t.key === "DELIVERY" ? [] : [`${res.added} added`];
  if(t.key === "PURCHASE") bits.push(`${res.updated} updated (${res.moved} moved Pending Order → In Transit)`);
  if(t.key === "ORDER") bits.push(`${res.updated} existing filled`, `${res.invoiced} of the added rows were Invoiced (In Transit)`, `${res.cancelled} marked Cancelled Order (not Pending Order)`);
  if(t.key === "SALES") bits.push(`${res.updated} VIN details updated`, `${res.deliveredUpdated} Delivered status kept`, `${res.ignored} ignored (VIN not in Purchase report)`);
  if(t.key === "DELIVERY") bits.push(`${res.added} delivery entries added`, `${res.updated} existing delivery entries updated`, `${res.deliveredUpdated} vehicles marked Delivered`, `${res.ignored} ignored (VIN not found)`);
  bits.push(`${res.failed} failed`);
  let text = bits.join(", ") + ".";
  if(res.firstError) text += ` First error: ${res.firstError}` + (importMissingColumn({message:res.firstError}) ? ` — ${SQL_HINT}` : "");
  if(importDropped.size) text += ` Not saved (no such column in database): ${[...importDropped].map(c => FIELD_HEADING[c] || c).join(", ")}. ${SQL_HINT}`;
  if(["SALES","DELIVERY"].includes(t.key) && res.ignored) text += ` Ignored VINs: ${importIgnored.slice(0, 10).join(", ")}${res.ignored > 10 ? " …" : ""}.`;
  msg.textContent = text; msg.className = "message " + (res.failed ? "error" : "success");
  if(["SALES","DELIVERY"].includes(t.key) && res.ignored){ const b = document.createElement("button"); b.type = "button"; b.className = "secondary-btn"; b.textContent = "⤓ Download ignored VINs"; b.style.marginLeft = "10px";
    const reason = t.key === "SALES" ? "VIN not in Purchase report" : "VIN not found in Vehicle Stock";
    b.onclick = () => exportSheet(t.key.toLowerCase() + "-ignored-vins", ["VIN No.","Reason"], importIgnored.map(v => [v, reason])); msg.appendChild(b); }
  try {
    await importWrite(b => state.supabase.from("import_batches").insert(b), {import_type:t.key, file_name:$("fileInput").files[0]?.name || "", total_rows:importRows.length,
      successful_rows:res.added + res.updated, failed_rows:res.failed, status:res.failed ? "Partial" : "Completed"});
  } catch { /* history is best effort */ }
  logAudit("IMPORT", "import", t.key, null, res);
  toast(`${t.title} import completed: ${res.added + res.updated} ok, ${res.failed} failed`, res.failed ? "error" : "success");
}
async function renderImportHistory(){
  $("content").innerHTML = `<div class="panel"><div class="panel-head"><h3>Import History</h3>${state.isAdmin ? `<button class="secondary-btn danger" type="button" id="clearImportHistory">Clear History</button>` : ""}</div><div id="importHistory" class="table-wrap"></div></div>`;
  const r = await state.supabase.from("import_batches").select("*").order("created_at",{ascending:false}).limit(100);
  $("importHistory").innerHTML = r.error ? emptyState("No import history yet.") :
    table(["Date","Type","File","Rows","Success","Failed","Status"], (r.data||[]).map(x => [fmtDT(x.created_at),x.import_type,x.file_name,x.total_rows,x.successful_rows,x.failed_rows,x.status]));
  const clear = $("clearImportHistory");
  if(clear){
    clear.disabled = !!r.error || !(r.data || []).length;
    clear.addEventListener("click", async () => {
      if(!confirm("Clear import history logs only? Imported vehicles and their statuses will not be changed.")) return;
      clear.disabled = true; clear.textContent = "Clearing…";
      const del = await state.supabase.from("import_batches").delete().not("id","is",null).select("id");
      if(del.error){ toast("Could not clear import history: " + del.error.message,"error"); clear.disabled = false; clear.textContent = "Clear History"; return; }
      toast(`Import history cleared (${(del.data || []).length} log${(del.data || []).length === 1 ? "" : "s"}).`,"success");
      renderImportHistory();
    });
  }
}

/* ---------------------------------------------------------------------------------------------
   IMPORTED DATA: one window for Order / Purchase / Sales data with filter, paging and bulk delete.
   Order / Purchase: delete = the vehicle record is removed (same as Data Management).
   Sales: "remove" = the sales entry is undone, the vehicle goes back to its earlier stage.
   --------------------------------------------------------------------------------------------- */
const IDATA = {tab:"ORDER", sel:new Set(), q:"", status:""};
const IDATA_TABS = {
  ORDER:{label:"Order Data", test:v => !isBlank(v.order_no),
    cols:[col("Order No","order_no"),col("Order Date","order_date","date"),col("VIN No.","vin"),col("Model","model"),col("Variant","variant"),col("Color","color"),col("Order Status","order_status"),col("Status","status"),col("Order Amount","order_amount","money")]},
  PURCHASE:{label:"Purchase Data", test:v => !isBlank(v.hmi_invoice_no) || !isBlank(v.hmi_invoice_date) || !isBlank(v.purchase_date),
    cols:[col("VIN No.","vin"),col("Engine No","engine_no"),col("Model","model"),col("Variant","variant"),col("Color","color"),col("Dealer","dealer_code"),col("Financier Name","finance_company"),col("HMI Invoice No","hmi_invoice_no"),col("HMI Invoice Date","hmi_invoice_date","date"),col("Status","status"),col("HMI Invoice Amount","hmi_invoice_amount","money")]},
  SALES:{label:"Sales Data", test:v => ["bill","delivered"].includes(vStage(v)) || !isBlank(v.sales_imported_at),
    cols:[col("Tally Invoice Date","bill_date","date"),col("VIN No.","vin"),col("Engine No","engine_no"),col("Customer Name","customer_name"),col("Tally Invoice No","bill_no"),col("Tally Location","sales_location"),col("Model","model"),col("Variant","variant"),col("Color","color"),col("Total Invoice value","total_invoice_value","money"),col("Status","status"),col("Delivery Date","delivery_date","date")]},
  DELIVERY:{label:"Delivery Data", test:v => !!v.delivery_record_id || !!v.delivery_date,
    cols:[col("Delivery No","delivery_no"),col("Delivery Date","delivery_date","date"),col("Bhilarwadi Vehicle IN DT","bhilarwadi_in_date","date"),col("VIN No.","vin"),col("Engine No","engine_no"),col("Model","model"),col("Variant","variant"),col("Color","color"),col("Customer Name","customer_name"),col("Tally Invoice No","bill_no"),col("Financier Name","finance_company"),col("Tally Location","dloc")]}
};
const idataList = all => {
  const t = IDATA_TABS[IDATA.tab], q = IDATA.q.trim().toLowerCase();
  return all.filter(t.test).filter(v => !IDATA.status || (v.status || "UNKNOWN") === IDATA.status)
    .filter(v => !q || t.cols.some(c => String(fmtCell(c.t, v[c.k]) ?? "").toLowerCase().includes(q)));
};
async function renderImportedData(){
  if(IDATA.tab === "DELIVERY" && !can("delivery-entry")) IDATA.tab = "ORDER";
  let all = await allVehicles(true); await getLocations();
  if(IDATA.tab === "DELIVERY"){
    const deliveries = await fetchAll(() => state.supabase.from("deliveries").select("*").order("created_at",{ascending:false}), {max:50000});
    const deliveryByVehicle = new Map(deliveries.map(d => [String(d.vehicle_id),d]));
    const receiptDates = await importFetchBhilarwadiInDates(all);
    all = all.filter(v => deliveryByVehicle.has(String(v.id)) || !!v.delivery_date).map(v => {
      const d = deliveryByVehicle.get(String(v.id)) || {};
      return {...v,...d,id:v.id,delivery_record_id:d.id || null,bhilarwadi_in_date:receiptDates.get(v.vin) || "",
        dloc:d.delivery_location || v.delivery_location || v.sales_location || (v.location_id ? locName(v.location_id) : "")};
    });
  }
  const t = IDATA_TABS[IDATA.tab], statuses = [...new Set(all.filter(t.test).map(v => v.status || "UNKNOWN"))].sort();
  const tabs = Object.entries(IDATA_TABS).filter(([k]) => k !== "DELIVERY" || can("delivery-entry"));
  IDATA.sel = new Set();
  $("content").innerHTML = `<div class="panel"><div class="panel-head"><h3>Imported Data</h3></div>
    <p class="form-help">Review imported Order, Purchase, Sales and Delivery records. Filter, select, edit and export records here.</p>
    <div class="tabs">${tabs.map(([k, x]) => `<button type="button" class="tab-btn ${k === IDATA.tab ? "active" : ""}" data-itab="${k}">${x.label} (${all.filter(x.test).length.toLocaleString("en-IN")})</button>`).join("")}</div>
    <div class="report-tools idata-tools">${filterBtn("idFilter")}
      <button class="secondary-btn" type="button" id="idAll">☑ Select all (filtered)</button><button class="secondary-btn" type="button" id="idNone">☐ Clear</button>
      <button class="secondary-btn" type="button" id="idExp">⤓ Export</button>
      <button class="secondary-btn danger" type="button" id="idDel">${IDATA.tab === "SALES" ? "⟲ Remove selected sales entries" : "🗑 Delete selected"}</button></div>
    ${filterPanel("idFilter", `<div class="filter-grid"><label>Search<input id="idSearch" type="search" placeholder="VIN, order no, model…" value="${esc(IDATA.q)}"></label>
      <label>Status<select id="idStatus"><option value="">All status</option>${statuses.map(x => `<option ${x === IDATA.status ? "selected" : ""}>${esc(x)}</option>`).join("")}</select></label></div>`)}
    <div id="idInfo" class="form-help"></div><div id="idList" class="table-wrap"></div></div>`;
  document.querySelectorAll("[data-itab]").forEach(b => b.addEventListener("click", () => { IDATA.tab = b.dataset.itab; IDATA.q = ""; IDATA.status = ""; renderImportedData(); }));
  const info = () => { $("idInfo").textContent = `${idataList(all).length.toLocaleString("en-IN")} records · ${IDATA.sel.size.toLocaleString("en-IN")} selected`; };
  const draw = () => {
    const list = idataList(all); info();
    const canEditRows = state.isAdmin || (IDATA.tab === "DELIVERY" && can("delivery-entry"));
    mountPaged($("idList"), {headers:["✓", ...t.cols.map(c => c.h), ...(canEditRows ? ["Edit"] : [])], empty:"No imported records.",
      rows:list.map(v => [raw(`<input type="checkbox" class="id-chk" data-id="${esc(v.id)}" ${IDATA.sel.has(String(v.id)) ? "checked" : ""} aria-label="Select">`), ...t.cols.map(c => c.k === "status" ? statusBadge(v[c.k]) : fmtCell(c.t, v[c.k])), ...(canEditRows ? [raw(`<button type="button" class="table-icon-btn" data-idedit="${esc(v.id)}" title="Edit">✎ Edit</button>`)] : [])]),
      onDraw:el => { el.querySelectorAll(".id-chk").forEach(cb => cb.addEventListener("change", () => { cb.checked ? IDATA.sel.add(cb.dataset.id) : IDATA.sel.delete(cb.dataset.id); info(); }));
        el.querySelectorAll("[data-idedit]").forEach(b => b.addEventListener("click", () => {
          const row = all.find(x => String(x.id) === b.dataset.idedit);
          if(IDATA.tab === "DELIVERY"){ DEL.rows = all; delEdit(b.dataset.idedit, renderImportedData); }
          else openVehicleEdit(row, renderImportedData);
        })); }});
  };
  $("idSearch").addEventListener("input", e => { IDATA.q = e.target.value; draw(); });
  $("idStatus").addEventListener("change", e => { IDATA.status = e.target.value; draw(); });
  $("idAll").onclick = () => { idataList(all).forEach(v => IDATA.sel.add(String(v.id))); draw(); };
  $("idNone").onclick = () => { IDATA.sel.clear(); draw(); };
  $("idExp").onclick = () => { const l = idataList(all); if(!l.length) return toast("Nothing to export.","error");
    const cols = hasPerm("value.view") ? t.cols : t.cols.filter(c => c.t !== "money");
    exportSheet("imported-" + IDATA.tab.toLowerCase(), cols.map(c => c.h), l.map(r => cols.map(c => (c.t === "money" || c.t === "num") ? Number(r[c.k] || 0) : (r[c.k] ?? "")))); };
  $("idDel").onclick = async () => {
    const vs = all.filter(v => IDATA.sel.has(String(v.id))); if(!vs.length) return toast("Select rows first.","error");
    if(IDATA.tab === "DELIVERY") return can("delivery-entry") ? removeImportedDeliveryEntries(vs) : toast("You do not have permission to edit delivery data.", "error");
    if(IDATA.tab === "SALES") return removeSalesEntries(vs);
    deleteVehicles(vs, renderImportedData);
  };
  draw();
}
async function removeImportedDeliveryEntries(vehicles){
  if(!confirm(`Remove ${vehicles.length} selected delivery entr${vehicles.length === 1 ? "y" : "ies"}? Vehicle records will remain and their status will be restored.`)) return;
  let removed = 0, failed = 0;
  for(const vehicle of vehicles){
    const result = await deleteDeliveryRecord(vehicle);
    if(result.error) failed++; else removed++;
  }
  toast(`${removed} delivery entr${removed === 1 ? "y" : "ies"} removed${failed ? `, ${failed} failed` : ""}. Vehicle records were kept.`, failed ? "error" : "success");
  renderImportedData();
}
async function removeSalesEntries(vs){
  const back = vs.filter(v => vStage(v) === "bill");               // delivered vehicles have a Delivery Entry: undo that from Delivery Entry / Data Management
  const skipped = vs.length - back.length;
  if(!back.length) return toast("Only Tally Done rows can be removed here. Delivered vehicles have a Delivery Entry.","error");
  if(!confirm(`Remove the sales entry of ${back.length} vehicle${back.length > 1 ? "s" : ""}?\n\nThey go back to Free Stock (if they were received at a location) or In Transit.` + (skipped ? `\n${skipped} Delivered row(s) will be left unchanged.` : ""))) return;
  let done = 0, failed = 0;
  for(const v of back){
    const status = v.location_id ? "In Stock" : (!isBlank(v.hmi_invoice_no) || !isBlank(v.purchase_date)) ? "In Transit" : "Pending Order";
    const r = await importWrite(b => state.supabase.from("vehicles").update(b).eq("id", v.id).select("id"), {status, sales_imported_at:null});
    if(r.error || !r.data?.length) failed++; else done++;
  }
  VCACHE.rows = null; logAudit("REMOVE_SALES_ENTRIES","import","vehicles",null,{count:done, failed});
  toast(`${done} sales entr${done === 1 ? "y" : "ies"} removed${failed ? `, ${failed} not changed (permission)` : ""}.`, failed ? "error" : "success");
  renderImportedData();
}
