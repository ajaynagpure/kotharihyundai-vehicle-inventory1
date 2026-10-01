"use strict";
/* =====================================================================
   INVENTORY: dashboard, vehicle stock, timeline, delivery, reports
   ===================================================================== */

const col = (h, k, t = "text") => ({h, k, t});

const STOCK_COLS = [col("Total Vehicles","vehicle_count","num"), col("Available Stock","stock_count","num"), col("In Transit","in_transit_count","num"), col("Pending Order","pending_count","num"), col("Sales / Not Delivered","bill_count","num"), col("Available Value","stock_value","money"), col("In Transit Value","in_transit_value","money")];
const REPORTS = {
  "location-report": {title:"Location wise Stock", source:"location_stock_report", totals:true, sort:["vehicle_count","desc"],
    cols:[col("Location","location_name"), ...STOCK_COLS]},
  "model-report": {title:"Model Stock", source:"model_stock_report", totals:true, sort:["vehicle_count","desc"],
    cols:[col("Model","model"), ...STOCK_COLS]},
  "finance-report": {title:"Finance wise Available Stock", source:"finance_stock_report", totals:true, sort:["vehicle_count","desc"],
    cols:[col("Financier Name","finance_company"), ...STOCK_COLS]},
  "dealer-report": {title:"Dealer Code wise Available Stock", source:"dealer_code_stock_report", totals:true, sort:["vehicle_count","desc"],
    cols:[col("Dealer","dealer_code"), ...STOCK_COLS]},
  "aging-report": {title:"Aging Report", source:"aging_report", sort:["aging_days","desc"],
    cols:[col("VIN No.","vin"), col("Model","model"), col("Status","status"), col("Purchase Date","purchase_date","date"), col("Aging Days","aging_days","num"), col("Bucket","aging_bucket")]},
  "delivery-report": {title:"Delivery Report", source:"delivery_report", sort:["delivery_date","desc"],
    cols:[col("Delivery No","delivery_no"), col("Date","delivery_date","date"), col("VIN","vin"), col("Model","model"), col("Customer","customer_name"), col("Finance","finance_company")]},
  "pending-report": {title:"Pending Order Report", source:"pending_order_report", sort:["order_date","desc"],
    cols:[col("Order No","order_no"), col("Order Date","order_date","date"), col("PIS No","pis_no"), col("Model","model"), col("Variant","variant"), col("Color","color"), col("Qty","quantity","num"), col("Status","status")]},
  "transit-report": {title:"In Transit Report", source:"in_transit_report",
    cols:[col("Order No","order_no"), col("VIN No.","vin"), col("Engine No","engine_no"), col("Model","model"), col("Variant","variant"), col("Color","color"), col("Dealer","dealer_code"), col("Financier Name","finance_company"), col("HMI Invoice Date","hmi_invoice_date","date"), col("HMI Invoice No","hmi_invoice_no"), col("HMI Invoice Amount","hmi_invoice_amount","money")]},
  "gate-report": {title:"Gate Movement Report", source:"gate_movement_report", sort:["movement_time","desc"],
    cols:[col("Date","movement_time","datetime"), col("Type","movement_type"), col("VIN","vin"), col("From","from_location"), col("To","to_location"), col("Gate","gate_name")]}
};

/* ---------------------------------------------------------------- Dashboard */
const vAmt = v => vValue(v) || Number(v.order_amount || 0);            // Pending Order rows carry the order amount
const STAGES = [["stock","Available Stock"],["transit","In Transit"],["pending","Pending Order"],["bill","Sales / Not Delivered"],["delivered","Delivered"]];
const emptyStageSet = () => ({stock:0, transit:0, pending:0, bill:0, delivered:0, total:0});
function stageGroup(all, keyOf){          // per key: n = counts, v = values, split by stage
  const m = new Map();
  all.forEach(v => { const k = keyOf(v) || "Not Available"; let g = m.get(k); if(!g){ g = {key:k, n:emptyStageSet(), v:emptyStageSet()}; m.set(k, g); }
    const st = vStage(v), amt = vAmt(v); g.n[st]++; g.v[st] += amt; g.n.total++; g.v.total += amt; });
  return [...m.values()];
}
const DIMS = {
  finance:{label:"Financier", of:v => v.finance_company || "Not Financed"},
  dealer:{label:"Dealer", of:v => v.dealer_code || "Not Available"},
  location:{label:"Location", of:v => v.location_id ? locName(v.location_id) : "Not Assigned"},
  model:{label:"Model", of:v => v.model || "Not Available"},
  status:{label:"Status", of:v => v.status || "UNKNOWN"}
};
const PIE_COLORS = ["#0b63ce","#12b76a","#f79009","#7a5af8","#ee46bc","#06aed4","#f04438","#84cc16","#667085","#0e9384"];
const dimNum = (n, dim, key, stage) => n ? raw(`<button type="button" class="link-num" data-dim="${dim}" data-key="${esc(key)}" data-stage="${stage}">${Number(n).toLocaleString("en-IN")}</button>`) : 0;
const B = t => raw(`<b>${esc(String(t))}</b>`), N = t => B(Number(t).toLocaleString("en-IN")), MS = t => B(moneyShort(t));

function renderDashboard(){
  const stats = [["Total Order Stock","stat0","total"],["Available Stock","stat1","stock"],["In Transit","stat2","transit"],["Pending Order","stat3","pending"],["Sales / Not Delivered","stat4","bill"],["Delivered","stat5","delivered"]];
  const link = (page, label) => `<button class="secondary-btn" type="button" onclick="navigate('${page}')" ${can(page) ? "" : "hidden"}>${label}</button>`;
  $("content").innerHTML = `
  <div class="cards dashboard-cards">
    ${stats.map(([x,id,kind]) => `<button type="button" class="stat-card stat-card-button" data-stat="${kind}" title="Click to view vehicles"><div class="stat-title">${x}</div><div class="stat-value" id="${id}">0</div><div class="stat-money" id="${id}v">₹ 0</div><div class="stat-note">Click to view list ›</div></button>`).join("")}
  </div>
  <div class="grid-2">
    <div class="panel"><div class="panel-head"><h3>Finance wise available stock</h3>${link("finance-report","View Report")}</div><div id="financeDash" class="table-wrap">${emptyState("Loading...")}</div></div>
    <div class="panel"><div class="panel-head"><h3>Dealer code wise available stock</h3>${link("dealer-report","View Report")}</div><div id="dealerDash" class="table-wrap">${emptyState("Loading...")}</div></div>
  </div>
  <div class="grid-2">
    <div class="panel"><div class="panel-head"><h3>Status wise stock</h3>${link("status","Open")}</div><div id="statusDash" class="pie-wrap">${emptyState("Loading...")}</div></div>
    <div class="panel"><div class="panel-head"><h3>Recent Vehicle Movements</h3>${link("gate-report","View All")}</div><div id="gateTable" class="table-wrap">${emptyState("Loading...")}</div></div>
  </div>
  <div class="panel"><div class="panel-head"><h3>Location wise stock</h3>${link("location-report","View Report")}</div><div id="locationTable" class="table-wrap">${emptyState("Loading...")}</div></div>
  <div class="panel"><div class="panel-head"><h3>Stock Ageing — Available Stock</h3>${link("aging-report","View Report")}</div><p id="ageNote" class="form-help"></p><div id="ageDash" class="age-cards">${emptyState("Loading...")}</div></div>
  <div class="panel"><div class="panel-head"><h3>Model wise available stock &amp; ageing</h3>${link("model-report","View Report")}</div><div id="modelDash" class="table-wrap">${emptyState("Loading...")}</div></div>`;
  document.querySelectorAll(".stat-card-button").forEach(b => b.addEventListener("click", () => openStatModal(b.dataset.stat)));
  if(state.supabase) return loadDashboardData();
}

async function getStatusSummary(){
  const rows = await allVehicles();
  const groups = {};
  rows.forEach(v => { const k = v.status || "UNKNOWN"; groups[k] ??= {count:0, value:0}; groups[k].count++; groups[k].value += Number(v.stock_value || 0); });
  return Object.entries(groups).map(([status,v]) => ({status, ...v})).sort((a,b) => b.count - a.count);
}

function pieHtml(items){                   // donut chart (inline SVG) + clickable legend
  const total = items.reduce((t, i) => t + i.count, 0); if(!total) return emptyState("No stock data yet. Import the Order / Purchase report to begin.");
  const cx = 90, cy = 90, R = 84, r = 50; let a0 = -Math.PI / 2;
  const paths = items.map((it, i) => { const fr = it.count / total, col = PIE_COLORS[i % PIE_COLORS.length], tip = `${it.status}: ${it.count} (${(fr*100).toFixed(1)}%)`;
    if(fr >= 0.9999) return `<path d="M${cx} ${cy-R} A${R} ${R} 0 1 1 ${cx-.01} ${cy-R} L${cx-.01} ${cy-r} A${r} ${r} 0 1 0 ${cx} ${cy-r} Z" fill="${col}" data-dim="status" data-key="${esc(it.status)}" data-stage="all"><title>${esc(tip)}</title></path>`;
    const a1 = a0 + fr * 2 * Math.PI, p = (rad, a) => `${(cx + rad * Math.cos(a)).toFixed(2)} ${(cy + rad * Math.sin(a)).toFixed(2)}`, big = fr > 0.5 ? 1 : 0;
    const d = `M${p(R,a0)} A${R} ${R} 0 ${big} 1 ${p(R,a1)} L${p(r,a1)} A${r} ${r} 0 ${big} 0 ${p(r,a0)} Z`; a0 = a1;
    return `<path d="${d}" fill="${col}" stroke="#fff" stroke-width="1.5" data-dim="status" data-key="${esc(it.status)}" data-stage="all" class="pie-slice"><title>${esc(tip)}</title></path>`; }).join("");
  return `<div class="pie-box"><svg viewBox="0 0 180 180" class="pie-svg" role="img" aria-label="Status wise stock">${paths}<text x="90" y="86" text-anchor="middle" class="pie-total">${total.toLocaleString("en-IN")}</text><text x="90" y="103" text-anchor="middle" class="pie-sub">vehicles</text></svg>
    <div class="pie-legend">${items.map((it, i) => `<button type="button" class="pie-row" data-dim="status" data-key="${esc(it.status)}" data-stage="all"><i style="background:${PIE_COLORS[i % PIE_COLORS.length]}"></i><span class="pie-name">${esc(it.status)}</span><b>${it.count.toLocaleString("en-IN")}</b><em>${((it.count/total)*100).toFixed(1)}%</em><span class="pie-val">${moneyShort(it.value)}</span></button>`).join("")}</div></div>`;
}

async function loadDashboardData(){
  const safe = p => Promise.resolve(p).then(data => ({data, error:null}), error => ({error, data:null}));
  const [allRes, gate] = await Promise.all([safe(allVehicles()), safe(computedRows("gate_movement_report"))]);
  await getLocations();
  const box = id => $(id), fail = msg => ["financeDash","dealerDash","statusDash","locationTable","ageDash","modelDash"].forEach(i => { if(box(i)) box(i).innerHTML = emptyState("Could not load: " + msg); });
  if(allRes.error){ fail(allRes.error.message || allRes.error); }
  else {
    const all = allRes.data, sum = {total:{n:0, v:0}};
    STAGES.forEach(([k]) => { sum[k] = {n:0, v:0}; });
    all.forEach(v => { const st = vStage(v), a = vAmt(v); sum[st].n++; sum[st].v += a; if(st !== "delivered"){ sum.total.n++; sum.total.v += a; } });
    [["total","stat0"],["stock","stat1"],["transit","stat2"],["pending","stat3"],["bill","stat4"],["delivered","stat5"]].forEach(([k,id]) => {
      if(box(id)) box(id).textContent = sum[k].n.toLocaleString("en-IN"); if(box(id + "v")) box(id + "v").textContent = moneyShort(sum[k].v); });
    const bindDim = el => el?.querySelectorAll("[data-dim]").forEach(b => b.addEventListener("click", () => openDimModal(b.dataset.dim, b.dataset.key, b.dataset.stage)));
    const draw = (id, headers, groups, mapper, footer) => { const el = box(id); if(!el) return;
      el.innerHTML = groups.length ? table(headers, groups.map(mapper), footer(groups)) : emptyState("No records found."); bindDim(el); };
    const tot = (gs, set, k) => gs.reduce((t, g) => t + g[set][k], 0);

    // 6. Finance wise available stock: count + short value
    const fin = stageGroup(all, DIMS.finance.of).filter(g => g.n.stock).sort((a,b) => b.n.stock - a.n.stock);
    draw("financeDash", ["Financier Name","Available Stock","Value"], fin, g => [g.key, dimNum(g.n.stock,"finance",g.key,"stock"), moneyShort(g.v.stock)],
      gs => [B("Total"), N(tot(gs,"n","stock")), MS(tot(gs,"v","stock"))]);
    // 7. Dealer code wise: available, in transit, bill / not delivered (count + short value)
    const dea = stageGroup(all, DIMS.dealer.of).filter(g => g.n.stock + g.n.transit + g.n.bill).sort((a,b) => b.n.stock - a.n.stock || b.n.transit - a.n.transit);
    draw("dealerDash", ["Dealer","Available","Value","In Transit","Value","Sales / Not Delivered","Value"], dea,
      g => [g.key, dimNum(g.n.stock,"dealer",g.key,"stock"), moneyShort(g.v.stock), dimNum(g.n.transit,"dealer",g.key,"transit"), moneyShort(g.v.transit), dimNum(g.n.bill,"dealer",g.key,"bill"), moneyShort(g.v.bill)],
      gs => [B("Total"), N(tot(gs,"n","stock")), MS(tot(gs,"v","stock")), N(tot(gs,"n","transit")), MS(tot(gs,"v","transit")), N(tot(gs,"n","bill")), MS(tot(gs,"v","bill"))]);
    // 9. Location wise stock: available, bill / not delivered, delivered (count + short value)
    const loc = stageGroup(all, DIMS.location.of).filter(g => g.n.stock + g.n.bill + g.n.delivered).sort((a,b) => b.n.stock - a.n.stock);
    draw("locationTable", ["Location","Available Stock","Value","Sales / Not Delivered","Value","Delivered","Value"], loc,
      g => [g.key, dimNum(g.n.stock,"location",g.key,"stock"), moneyShort(g.v.stock), dimNum(g.n.bill,"location",g.key,"bill"), moneyShort(g.v.bill), dimNum(g.n.delivered,"location",g.key,"delivered"), moneyShort(g.v.delivered)],
      gs => [B("Total"), N(tot(gs,"n","stock")), MS(tot(gs,"v","stock")), N(tot(gs,"n","bill")), MS(tot(gs,"v","bill")), N(tot(gs,"n","delivered")), MS(tot(gs,"v","delivered"))]);

    // 8. Status wise stock: pie chart
    const st = {}; all.forEach(v => { const k = v.status || "UNKNOWN"; (st[k] ??= {status:k, count:0, value:0}); st[k].count++; st[k].value += vAmt(v); });
    if(box("statusDash")){ box("statusDash").innerHTML = pieHtml(Object.values(st).sort((a,b) => b.count - a.count)); bindDim(box("statusDash")); }

    // Ageing = Available Stock only (In Transit, Sales / Not Delivered, Pending Order and Delivered are not aged)
    const ageRows = ageInfo(all), names = ageBucketNames(), buckets = [...names, ...(ageRows.some(a => a.b === AGE_NODATE) ? [AGE_NODATE] : [])];
    const nf = x => Number(x).toLocaleString("en-IN");
    if(box("ageNote")) box("ageNote").textContent = `Ageing is calculated on Available Stock only: ${nf(ageRows.length)} vehicles.`;
    if(box("ageDash")){
      box("ageDash").innerHTML = ageRows.length ? buckets.map(bk => { const l = ageRows.filter(a => a.b === bk);
        return `<button type="button" class="stat-card stat-card-button age-card" data-age-b="${esc(bk)}"><div class="stat-title">${esc(bk)}</div><div class="stat-value">${l.length.toLocaleString("en-IN")}</div><div class="stat-note">${moneyShort(l.reduce((t,a) => t + vAmt(a.v), 0))}</div></button>`; }).join("")
        + `<div class="stat-card age-card age-total"><div class="stat-title">Total Available Stock</div><div class="stat-value">${ageRows.length.toLocaleString("en-IN")}</div><div class="stat-note">${moneyShort(ageRows.reduce((t,a) => t + vAmt(a.v), 0))}</div></div>`
        : emptyState("No available stock yet. Vehicles appear here after Bhilarwadi / Branch IN.");
      box("ageDash").querySelectorAll("[data-age-b]").forEach(b => b.addEventListener("click", () => openAgeModal(null, b.dataset.ageB)));
    }
    // Model wise available stock (Sales / Not Delivered, Delivered, Pending and In Transit are excluded) with ageing count + value
    const ageBy = {}; ageRows.forEach(a => { const m = DIMS.model.of(a.v), o = ((ageBy[m] ??= {})[a.b] ??= {n:0, v:0}); o.n++; o.v += vAmt(a.v); });
    const mod = stageGroup(all, DIMS.model.of).filter(g => g.n.stock).sort((a,b) => b.n.stock - a.n.stock);
    if(box("modelDash")){
      const bCell = (m, bk) => { const o = ageBy[m]?.[bk]; return o ? `<td class="num"><button type="button" class="link-num" data-age-m="${esc(m)}" data-age-b="${esc(bk)}">${nf(o.n)}</button></td><td class="num">${moneyShort(o.v)}</td>` : `<td class="num">0</td><td class="num">-</td>`; };
      const bTot = bk => { const l = ageRows.filter(a => a.b === bk); return `<td class="num"><b>${nf(l.length)}</b></td><td class="num"><b>${moneyShort(l.reduce((t,a) => t + vAmt(a.v), 0))}</b></td>`; };
      box("modelDash").innerHTML = mod.length ? `<table class="age-table"><thead><tr><th rowspan="2">Model</th><th rowspan="2">Available Stock</th><th rowspan="2">Stock Value</th>${buckets.map(b => `<th colspan="2" class="grp">${esc(b)}</th>`).join("")}</tr>
        <tr>${buckets.map(() => "<th>Qty</th><th>Value</th>").join("")}</tr></thead><tbody>${mod.map(g => `<tr><td>${esc(g.key)}</td><td class="num">${cell(dimNum(g.n.stock,"model",g.key,"stock"))}</td><td class="num">${moneyShort(g.v.stock)}</td>${buckets.map(bk => bCell(g.key, bk)).join("")}</tr>`).join("")}</tbody>
        <tfoot><tr><td><b>Total</b></td><td class="num"><b>${nf(tot(mod,"n","stock"))}</b></td><td class="num"><b>${moneyShort(tot(mod,"v","stock"))}</b></td>${buckets.map(bTot).join("")}</tr></tfoot></table>` : emptyState("No available stock yet.");
      bindDim(box("modelDash"));
      box("modelDash").querySelectorAll("[data-age-m]").forEach(b => b.addEventListener("click", () => openAgeModal(b.dataset.ageM, b.dataset.ageB)));
    }
  }
  const rows = Math.max(1, parseInt(state.settings?.sys?.dashboard_recent_rows, 10) || 8);
  if(box("gateTable")) box("gateTable").innerHTML = gate.error ? emptyState("Could not load: " + (gate.error.message || gate.error)) :
    table(["Date","Type","VIN No.","Location"], (gate.data || []).slice(0, rows).map(r => [fmtDT(r.movement_time), r.movement_type, r.vin, r.to_location || r.from_location]));
}

/* ------------------------------------------- Dashboard: click-through windows + ageing */
const AGE_NODATE = "No date";
function ageInfo(all){      // Available Stock only (In Transit, Sales / Not Delivered, Delivered and Pending are not ageing stock)
  return all.filter(v => vStage(v) === "stock").map(v => {
    const d = daysSince(v.purchase_date ?? v.hmi_invoice_date); return {v, d, b:d === null ? AGE_NODATE : agingBucket(d)}; });
}
const vRow = v => ({...v, location_name:v.location_id ? locName(v.location_id) : "-", aging_days:daysSince(v.purchase_date ?? v.hmi_invoice_date), delivery_no_c:v.delivery_no || v.grn_no});
const DASH_COLS = {
  total:[col("Order No","order_no"),col("Order Date","order_date","date"),col("VIN No.","vin"),col("Model","model"),col("Variant","variant"),col("Color","color"),col("Status","status"),col("Location","location_name"),col("Financier Name","finance_company"),col("Order Amount","order_amount","money"),col("Stock Value","stock_value","money")],
  stock:[col("Order No","order_no"),col("VIN No.","vin"),col("Engine No","engine_no"),col("Model","model"),col("Variant","variant"),col("Color","color"),col("Location","location_name"),col("Dealer","dealer_code"),col("Financier Name","finance_company"),col("HMI Invoice Date","hmi_invoice_date","date"),col("Aging Days","aging_days","days"),col("Stock Value","stock_value","money")],
  transit:[col("Order No","order_no"),col("VIN No.","vin"),col("Engine No","engine_no"),col("Model","model"),col("Variant","variant"),col("Color","color"),col("Dealer","dealer_code"),col("Financier Name","finance_company"),col("HMI Invoice Date","hmi_invoice_date","date"),col("HMI Invoice No","hmi_invoice_no"),col("HMI Invoice Amount","hmi_invoice_amount","money")],
  pending:[col("Order No","order_no"),col("Order Date","order_date","date"),col("PIS No","pis_no"),col("Model","model"),col("Variant","variant"),col("Color","color"),col("Order Type","order_type"),col("Status","status"),col("Order Amount","order_amount","money")],
  bill:[col("Order No","order_no"),col("VIN No.","vin"),col("Model","model"),col("Variant","variant"),col("Color","color"),col("Customer","customer_name"),col("Financier Name","finance_company"),col("Location","location_name"),col("Status","status"),col("Stock Value","stock_value","money")],
  delivered:[col("Delivery No","delivery_no_c"),col("Delivery Date","delivery_date","date"),col("VIN No.","vin"),col("Model","model"),col("Variant","variant"),col("Customer","customer_name"),col("Financier Name","finance_company"),col("Location","location_name"),col("Stock Value","stock_value","money")]
};
const DASH_KIND = {
  total:{title:"Total Order Stock — Available + Pending Order + In Transit + Sales / Not Delivered", f:v => vStage(v) !== "delivered"},
  stock:{title:"Available Stock", f:v => vStage(v) === "stock"},
  transit:{title:"In Transit", f:v => vStage(v) === "transit"},
  pending:{title:"Pending Order", f:v => vStage(v) === "pending"},
  bill:{title:"Sales / Not Delivered", f:v => vStage(v) === "bill"},
  delivered:{title:"Delivered", f:v => vStage(v) === "delivered"}
};
async function openStatModal(kind){
  const def = DASH_KIND[kind]; if(!def) return;
  if(!state.supabase){ toast("Connect Supabase first.","error"); return; }
  try {
    const all = await allVehicles(); await getLocations();
    const rows = all.filter(def.f).map(vRow);
    // Total Order Stock window: stage-wise breakdown so the totals reconcile (order → delivery)
    const chips = kind === "total" ? STAGES.filter(([k]) => k !== "delivered").map(([k,label]) => { const l = rows.filter(r => vStage(r) === k); return `<span class="dm-chip dm-stage">${label}: <b>${l.length.toLocaleString("en-IN")}</b> · ${moneyShort(l.reduce((t,r) => t + vAmt(r), 0))}</span>`; }) : [];
    openVehicleModal(def.title, rows, DASH_COLS[kind], kind, chips);
  } catch(err){ toast("Could not load: " + (err.message || err), "error"); }
}
const STAGE_TITLE = {stock:"Available Stock", transit:"In Transit", bill:"Sales / Not Delivered", delivered:"Delivered", pending:"Pending Order", all:"All vehicles"};
async function openDimModal(dim, key, stage){          // click on a count in a dashboard table / pie
  const d = DIMS[dim]; if(!d) return;
  try {
    const all = await allVehicles(); await getLocations();
    const rows = all.filter(v => d.of(v) === key && (stage === "all" || vStage(v) === stage)).map(vRow);
    openVehicleModal(`${d.label}: ${key} — ${STAGE_TITLE[stage] || stage}`, rows, DASH_COLS[stage === "all" ? "total" : stage] || DASH_COLS.total, "dashboard-" + dim);
  } catch(err){ toast("Could not load: " + (err.message || err), "error"); }
}
async function openAgeModal(model, bucket){
  try {
    const all = await allVehicles(); await getLocations();
    const rows = ageInfo(all).filter(a => a.b === bucket && (model === null || (a.v.model || "Not Available") === model)).map(a => vRow(a.v));
    openVehicleModal(`${model === null ? "All models" : model} — Ageing ${bucket}`, rows, DASH_COLS.stock, "ageing");
  } catch(err){ toast("Could not load: " + (err.message || err), "error"); }
}
// Window with a filterable, paged vehicle list, summary totals, a Total row and Excel export.
function openVehicleModal(title, rows, cols, fileKey, chips = []){
  const sums = cols.filter(c => c.t === "money");
  openModal(`<div class="modal-bg" id="dmBg"><div class="modal wide" role="dialog" aria-modal="true" aria-label="${esc(title)}">
    <div class="panel-head"><h3>${esc(title)}</h3><div class="report-tools">${filterBtn("dmFilterBox")}<button class="secondary-btn" type="button" id="dmExport">⤓ Export</button><button class="icon-btn" type="button" id="modalClose" aria-label="Close">×</button></div></div>
    ${filterPanel("dmFilterBox", `<div class="filter-grid"><label>Search rows<input id="dmFilter" type="search" placeholder="VIN, model, order no…" aria-label="Filter rows"></label></div>`)}
    <div id="dmSummary" class="dm-summary"></div><div id="dmTable" class="table-wrap"></div></div></div>`);
  const shown = () => { const q = ($("dmFilter").value || "").trim().toLowerCase();
    return q ? rows.filter(r => cols.some(c => String(fmtCell(c.t === "days" ? "num" : c.t, r[c.k]) ?? "").toLowerCase().includes(q))) : rows; };
  const draw = () => {
    const list = shown(), tot = c => list.reduce((t, r) => t + Number(r[c.k] || 0), 0);
    $("dmSummary").innerHTML = `<span class="dm-chip"><b>${list.length.toLocaleString("en-IN")}</b> vehicles</span>` + sums.map(c => `<span class="dm-chip">${esc(c.h)}: <b>${money(tot(c))}</b></span>`).join("") + (list.length === rows.length ? chips.join("") : "");
    const footer = list.length ? cols.map((c,i) => i === 0 ? raw(`<b>Total (${list.length.toLocaleString("en-IN")})</b>`) : c.t === "money" ? raw(`<b>${money(tot(c))}</b>`) : "") : null;
    mountPaged($("dmTable"), {headers:cols.map(c => c.h), footer, rows:list.map(r => cols.map(c => c.k === "status" ? statusBadge(r[c.k]) : fmtCell(c.t === "days" ? "num" : c.t, r[c.k])))});
  };
  const shut = () => { closeModal(); document.removeEventListener("keydown", onKey); };
  const onKey = e => { if(e.key === "Escape") shut(); };
  document.addEventListener("keydown", onKey);
  $("modalClose").onclick = shut; $("dmBg").addEventListener("mousedown", e => { if(e.target.id === "dmBg") shut(); });
  $("dmFilter").addEventListener("input", draw);
  $("dmExport").onclick = () => { const l = shown(); if(!l.length){ toast("Nothing to export.","error"); return; }
    exportSheet("dashboard-" + fileKey, cols.map(c => c.h), l.map(r => cols.map(c => (c.t === "money" || c.t === "num" || c.t === "days") ? Number(r[c.k] || 0) : (r[c.k] ?? "")))); };
  draw();
}

/* --------------------------------------------------------------- Vehicles */
const VEH = {page:0, size:50, total:0, q:"", status:"", rows:[]};

async function renderVehicles(page){
  VEH.page = 0; VEH.q = ""; VEH.status = ""; VEH.size = pageSize();
  $("content").innerHTML = `
  <div class="toolbar">
    <div class="searchbox">
      <input id="vehicleSearch" placeholder="Search VIN / order no / engine / model / color" autocomplete="off" aria-label="Search vehicles">
      <button type="button" id="vehicleSearchBtn">Search</button>
    </div>
    <div class="toolbar-actions">${filterBtn("vehFilter")}<button class="secondary-btn" type="button" id="vehicleExport">⤓ Export</button></div>
  </div>
  ${filterPanel("vehFilter", `<div class="filter-grid"><label>Status<select id="vehicleStatus" aria-label="Filter by status"><option value="">All status</option></select></label></div>`, page === "status")}
  <div class="panel"><div class="table-wrap" id="vehicleResults">${emptyState(page === "search" ? "Enter a VIN / chassis / model to search." : "Loading vehicles...")}</div><div class="pager" id="vehiclePager"></div></div>
  <div id="modal"></div>`;

  const run = () => { VEH.q = cleanQuery($("vehicleSearch").value); VEH.status = $("vehicleStatus").value; VEH.page = 0; queryVehicles(); };
  $("vehicleSearchBtn").addEventListener("click", run);
  $("vehicleSearch").addEventListener("keydown", e => { if(e.key === "Enter"){ e.preventDefault(); run(); } });
  $("vehicleStatus").addEventListener("change", run);
  $("vehicleExport").addEventListener("click", exportVehicles);

  if(!state.supabase) return;
  getStatusSummary().then(groups => {
    $("vehicleStatus")?.insertAdjacentHTML("beforeend", groups.map(g => `<option value="${esc(g.status)}">${esc(g.status)} (${g.count})</option>`).join(""));
  }).catch(() => {});
  if(page !== "search") queryVehicles();
}

async function queryVehicles(){
  const box = $("vehicleResults"); if(!box) return;
  if(!state.supabase){ box.innerHTML = emptyState("Connect Supabase to load live vehicles."); return; }
  await getLocations();
  const from = VEH.page * VEH.size;
  let query = state.supabase.from("vehicles")
    .select("*", {count:"exact"})
    .order("id",{ascending:false}).range(from, from + VEH.size - 1);
  if(VEH.q) query = query.or(["vin","order_no","engine_no","model","color"].map(c => `${c}.ilike.%${VEH.q}%`).join(","));
  if(VEH.status) query = query.eq("status", VEH.status);
  const {data, error, count} = await query;
  if(error){ box.innerHTML = emptyState(error.message); return; }
  VEH.rows = data || []; VEH.total = count ?? VEH.rows.length;
  if(!$("vehicleResults")) return;                       // user already moved to another page
  box.innerHTML = table(["Order No","VIN No.","Engine No","Model","Variant","Color","Dealer","Financier Name","HMI Invoice Date","Status","Order Status","Stock Value",""],
    VEH.rows.map(v => [v.order_no, raw(`<b class="mono">${esc(v.vin)}</b>`), v.engine_no, v.model, v.variant, v.color, v.dealer_code, v.finance_company, fmtD(v.hmi_invoice_date ?? v.purchase_date), statusBadge(v.status), v.order_status, money(v.stock_value),
      raw(`<button type="button" class="table-icon-btn" data-vid="${esc(v.id)}">Details</button>` + (state.isAdmin ? `<button type="button" class="table-icon-btn" data-vedit="${esc(v.id)}" title="Edit">✎</button><button type="button" class="table-icon-btn danger" data-vdel="${esc(v.id)}" title="Delete">🗑</button>` : ""))]));
  box.querySelectorAll("[data-vid]").forEach(b => b.addEventListener("click", () => showVehicleDetails(b.dataset.vid)));
  const rowOf = id => VEH.rows.find(x => String(x.id) === String(id));
  box.querySelectorAll("[data-vedit]").forEach(b => b.addEventListener("click", () => openVehicleEdit(rowOf(b.dataset.vedit), queryVehicles)));
  box.querySelectorAll("[data-vdel]").forEach(b => b.addEventListener("click", () => deleteVehicles([rowOf(b.dataset.vdel)], queryVehicles)));
  const pages = Math.max(1, Math.ceil(VEH.total / VEH.size));
  const shownFrom = VEH.total ? from + 1 : 0, shownTo = from + VEH.rows.length;
  $("vehiclePager").innerHTML = `<span>Showing ${shownFrom}–${shownTo} of ${VEH.total.toLocaleString("en-IN")}</span>
    <span><button class="secondary-btn" type="button" id="vehPrev" ${VEH.page === 0 ? "disabled" : ""}>‹ Prev</button>
    <span class="pager-page">Page ${VEH.page + 1} / ${pages}</span>
    <button class="secondary-btn" type="button" id="vehNext" ${VEH.page + 1 >= pages ? "disabled" : ""}>Next ›</button></span>`;
  $("vehPrev").addEventListener("click", () => { VEH.page--; queryVehicles(); });
  $("vehNext").addEventListener("click", () => { VEH.page++; queryVehicles(); });
}

const VEHICLE_EXPORT_COLS = [...EXCEL_FIELDS.map(f => f[0]), "chassis_no", "stock_value", "purchase_date", "status"];
function vehicleCellValue(k, v){ const x = v[k]; return isBlank(x) ? "" : (FIELD_TYPE[k] === "money" || FIELD_TYPE[k] === "num") ? Number(x) : x; }
function exportVehicles(){
  if(!VEH.rows.length){ toast("Nothing to export — search or load vehicles first.","error"); return; }
  exportSheet("vehicle-stock", VEHICLE_EXPORT_COLS.map(k => FIELD_HEADING[k]), VEH.rows.map(v => VEHICLE_EXPORT_COLS.map(k => vehicleCellValue(k, v))));
}
function showVehicleDetails(id){
  const v = VEH.rows.find(x => String(x.id) === String(id)); if(v) openVehicleDetails(v);
}

/* --------------------------------------------------------------- Timeline */
function renderTimeline(){
  $("content").innerHTML = `<div class="panel"><div class="panel-head"><h3>Vehicle Timeline</h3>
    <div class="searchbox"><input id="timelineVin" placeholder="Enter VIN (or last 6 digits)" autocomplete="off" aria-label="VIN"><button type="button" id="timelineBtn">Search</button></div></div>
    <div id="timelineResults">${emptyState("Search a VIN to view its read-only timeline.")}</div></div>`;
  $("timelineBtn").addEventListener("click", loadTimeline);
  $("timelineVin").addEventListener("keydown", e => { if(e.key === "Enter"){ e.preventDefault(); loadTimeline(); } });
}
async function loadTimeline(){
  const vin = cleanQuery($("timelineVin").value).replace(/\s+/g,"").toUpperCase();
  const out = $("timelineResults");
  if(!vin || !state.supabase) return;
  let v = await state.supabase.from("vehicles").select("id,vin").eq("vin", vin).maybeSingle();
  if(!v.data && vin.length >= 6){
    const f = await state.supabase.from("vehicles").select("id,vin").ilike("vin", `%${vin}`).limit(2);
    if(f.data?.length === 1) v = {data:f.data[0]};
    else if(f.data?.length > 1){ out.innerHTML = emptyState("More than one vehicle ends with these digits — enter more of the VIN."); return; }
  }
  if(!v.data){ out.innerHTML = emptyState("Vehicle not found."); return; }
  const r = await state.supabase.from("vehicle_timeline").select("*").eq("vehicle_id", v.data.id).order("created_at",{ascending:false});
  if(r.error){ out.innerHTML = emptyState(r.error.message); return; }
  out.innerHTML = `<p class="mono timeline-vin">${esc(v.data.vin)}</p>` + ((r.data || []).map(x => `<div class="timeline"><div class="time">${fmtDT(x.created_at)}</div><div><b>${esc(x.event_type)}</b><p>${esc(x.description || "")}</p><small>${esc(x.old_status || "")} → ${esc(x.new_status || "")}</small></div></div>`).join("") || emptyState("No timeline events."));
}

/* Delivery Entry / Delivered Vehicles / Delivery History: see js/delivery.js */

/* ---------------------------------------------------------------- Reports */
const REPORT = {key:"", rows:[]};

function reportRows(def, rows, filter){
  const f = filter.trim().toLowerCase();
  return f ? rows.filter(r => def.cols.some(c => String(r[c.k] ?? "").toLowerCase().includes(f))) : rows;
}
function drawReport(){
  const def = REPORTS[REPORT.key]; if(!def || !$("reportTable")) return;
  const rows = reportRows(def, REPORT.rows, $("reportFilter")?.value || "");
  let footer = null;
  if(def.totals && rows.length) footer = def.cols.map((c,i) => i === 0 ? raw("<b>Total</b>") : (c.t === "num" || c.t === "money")
    ? raw(`<b>${fmtCell(c.t, rows.reduce((s,r) => s + Number(r[c.k] || 0), 0))}</b>`) : "");
  mountPaged($("reportTable"), {headers:def.cols.map(c => c.h), rows:rows.map(r => def.cols.map(c => fmtCell(c.t, r[c.k]))), footer});
  $("reportMeta").textContent = `${rows.length.toLocaleString("en-IN")} of ${REPORT.rows.length.toLocaleString("en-IN")} rows`;
}
async function renderReport(page){
  const def = REPORTS[page];
  if(!def){ $("content").innerHTML = `<div class="panel">${emptyState("Unknown report.")}</div>`; return; }
  REPORT.key = page; REPORT.rows = [];
  $("content").innerHTML = `<div class="panel"><div class="panel-head"><h3>${esc(def.title)}</h3>
    <div class="report-tools">${filterBtn("repFilter")}<button class="secondary-btn" type="button" id="reportExport">⤓ Export</button><button class="secondary-btn" type="button" id="reportRefresh">↻ Refresh</button></div></div>
    ${filterPanel("repFilter", `<div class="filter-grid"><label>Search rows<input id="reportFilter" type="search" placeholder="Type to filter…" aria-label="Filter rows"></label></div>`)}
    <p id="reportMeta" class="form-help"></p>
    <div class="table-wrap" id="reportTable">${emptyState("Loading live report...")}</div></div>`;
  $("reportFilter").addEventListener("input", drawReport);
  $("reportRefresh").addEventListener("click", () => loadReport(page));
  $("reportExport").addEventListener("click", () => {
    const rows = reportRows(def, REPORT.rows, $("reportFilter").value);
    if(!rows.length){ toast("Nothing to export.","error"); return; }
    exportSheet(page, def.cols.map(c => c.h), rows.map(r => def.cols.map(c => (c.t === "num" || c.t === "money") ? Number(r[c.k] || 0) : (r[c.k] ?? ""))));
  });
  await loadReport(page);
}
async function loadReport(page){
  const def = REPORTS[page]; if(!def) return;
  if(!state.supabase){ $("reportTable").innerHTML = emptyState("Connect Supabase to load live report."); return; }
  try {
    const rows = await computedRows(def.source);
    if(def.sort){ const [k,dir] = def.sort; rows.sort((a,b) => { const x = a[k], y = b[k];
      const c = (typeof x === "number" && typeof y === "number") ? x - y : String(x ?? "").localeCompare(String(y ?? "")); return dir === "desc" ? -c : c; }); }
    REPORT.rows = rows;
    drawReport();
  } catch(err){ $("reportTable").innerHTML = emptyState(err.message); }
}
