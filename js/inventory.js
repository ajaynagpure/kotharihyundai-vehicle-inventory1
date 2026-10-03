"use strict";
/* =====================================================================
   INVENTORY: dashboard, vehicle stock, timeline, delivery, reports
   ===================================================================== */

const col = (h, k, t = "text") => ({h, k, t});

const STOCK_COLS = [col("Total Vehicles","vehicle_count","num"), col("Free Stock","stock_count","num"), col("In Transit","in_transit_count","num"), col("Pending Order","pending_count","num"), col("Tally Done","bill_count","num"), col("Free Stock Value","stock_value","money"), col("In Transit Value","in_transit_value","money")];
const REPORTS = {
  "location-report": {title:"Location wise Stock", source:"location_stock_report", totals:true, sort:["total_count","desc"], dim:"location",
    cols:[col("Location","location_name"), col("Free Stock","stock_count","num"), col("Free Stock Value","stock_value","money"), col("Tally Done","bill_count","num"), col("Tally Done Value","bill_value","money"), col("In Transit","in_transit_count","num"), col("In Transit Value","in_transit_value","money"), col("Total Count","total_count","num"), col("Grand Total Value","total_value","money")]},
  "model-report": {title:"Model Stock", source:"model_stock_report", totals:true, sort:["vehicle_count","desc"], dim:"model",
    cols:[col("Model","model"), ...STOCK_COLS]},
  "finance-report": {title:"Finance-wise Free Stock", source:"finance_stock_report", totals:true, sort:["vehicle_count","desc"], dim:"finance",
    cols:[col("Financier Name","finance_company"), col("Free Stock","stock_count","num"), col("Free Stock Value","stock_value","money"), col("In Transit","in_transit_count","num"), col("In Transit Value","in_transit_value","money"), col("Tally Done","bill_count","num"), col("Tally Done Value","bill_value","money"), col("Grand Total Value","total_value","money")]},
  "dealer-report": {title:"Dealer Code-wise Free Stock", source:"dealer_code_stock_report", totals:true, sort:["vehicle_count","desc"], dim:"dealer",
    cols:[col("Dealer","dealer_code"), ...STOCK_COLS]},
  "aging-report": {editable:true, title:"Aging Report", source:"aging_report", sort:["aging_days","desc"],
    cols:[col("VIN No.","vin"), col("Model","model"), col("Status","status"), col("Purchase Date","purchase_date","date"), col("Aging Days","aging_days","num"), col("Bucket","aging_bucket")]},
  "delivery-report": {editable:true, title:"Delivery Report", source:"delivery_report", sort:["delivery_date","desc"],
    cols:[col("Delivery No","delivery_no"), col("Date","delivery_date","date"), col("VIN","vin"), col("Model","model"), col("Customer","customer_name"), col("Finance","finance_company")]},
  "pending-report": {editable:true, title:"Pending Order Report", source:"pending_order_report", sort:["order_date","desc"],
    cols:[col("Order No","order_no"), col("Order Date","order_date","date"), col("PIS No","pis_no"), col("Model","model"), col("Variant","variant"), col("Color","color"), col("Qty","quantity","num"), col("Status","status")]},
  "transit-report": {editable:true, title:"In Transit Report", source:"in_transit_report",
    cols:[col("Order No","order_no"), col("VIN No.","vin"), col("Engine No","engine_no"), col("Model","model"), col("Variant","variant"), col("Color","color"), col("Dealer","dealer_code"), col("Financier Name","finance_company"), col("HMI Invoice Date","hmi_invoice_date","date"), col("HMI Invoice No","hmi_invoice_no"), col("HMI Invoice Amount","hmi_invoice_amount","money")]},
  "arriving-report": {title:"Arriving Vehicles — OUT, awaiting IN", source:"awaiting_arrival_report", sort:["movement_time","desc"],
    cols:[col("OUT Date","movement_time","datetime"), col("VIN / Vehicle No.","vin"), col("Model","model"), col("Stock Status","status"), col("IN Location","in_location"), col("OUT Location","out_location"), col("Gate","gate_name")]},
  "gate-report": {title:"Gate Movement Report", source:"gate_movement_report", sort:["movement_time","desc"],
    cols:[col("Date","movement_time","datetime"), col("Type","movement_type"), col("VIN","vin"), col("From","from_location"), col("To","to_location"), col("Gate","gate_name")]}
};

/* ---------------------------------------------------------------- Dashboard */
const vAmt = v => vValue(v) || Number(v.order_amount || 0);            // Pending Order rows carry the order amount
const STAGES = [["stock","Free Stock"],["transit","In Transit"],["pending","Pending Order"],["bill","Tally Done"],["delivered","Delivered"]];
const emptyStageSet = () => ({stock:0, transit:0, pending:0, bill:0, delivered:0, cancelled:0, total:0});
function stageGroup(all, keyOf){          // per key: n = counts, v = values, split by stage
  const m = new Map();
  all.forEach(v => { const k = keyOf(v) || "Not Available"; let g = m.get(k); if(!g){ g = {key:k, n:emptyStageSet(), v:emptyStageSet()}; m.set(k, g); }
    const st = vStage(v), amt = vAmt(v); g.n[st]++; g.v[st] += amt; g.n.total++; g.v.total += amt; });
  return [...m.values()];
}
const DIMS = {
  finance:{label:"Financier", of:v => v.finance_company || "Not Financed"},
  dealer:{label:"Dealer", of:v => v.dealer_code || "Not Available"},
  location:{label:"Location", of:v => vLocName(v)},
  model:{label:"Model", of:v => v.model || "Not Available"},
  status:{label:"Status", of:v => v.status || "UNKNOWN"}
};
const PIE_COLORS = ["#12b76a","#f79009","#f04438","#7a5af8","#ee46bc","#06aed4","#0b63ce","#84cc16","#667085","#0e9384"];
const dimNum = (n, dim, key, stage) => n ? raw(`<button type="button" class="link-num" data-dim="${dim}" data-key="${esc(key)}" data-stage="${stage}">${Number(n).toLocaleString("en-IN")}</button>`) : 0;
const B = t => raw(`<b>${esc(String(t))}</b>`), N = t => B(Number(t).toLocaleString("en-IN")), MS = t => B(moneyShort(t));
const dashboardFilters = () => ({from:$("dashDateFrom")?.value || "", to:$("dashDateTo")?.value || "", location:$("dashLocation")?.value || ""});
function dashboardAssignedLocation(){
  if(state.isAdmin) return null;
  const id = state.profile?.location_id;
  return id ? (state.locations || []).find(l => String(l.id) === String(id))?.location_name || "" : "";
}
function dashboardMatchesVehicle(v){
  const f = dashboardFilters(), loc = vLocName(v);
  const assignedLocation = dashboardAssignedLocation();
  if(assignedLocation !== null && (!assignedLocation || loc !== assignedLocation)) return false;
  if(f.location && loc !== f.location) return false;
  if(f.from || f.to){
    const stage = vStage(v), d = stage === "pending" ? (v.order_date || v.created_at) : stage === "delivered" ? (v.delivery_date || v.bill_date || v.purchase_date || v.hmi_invoice_date) : stage === "bill" ? (v.bill_date || v.hmi_invoice_date || v.purchase_date) : (v.purchase_date || v.hmi_invoice_date || v.order_date || v.created_at);
    const day = String(d || "").slice(0,10);
    if(!day || (f.from && day < f.from) || (f.to && day > f.to)) return false;
  }
  return true;
}

function renderDashboard(){
  const stats = [["Total Order Stock","stat0","total"],["Free Stock","stat1","stock","🚘"],["In Transit","stat2","transit","🚚"],["Pending Order","stat3","pending","▤"],["Tally Done","stat4","bill","▣"],["Delivered","stat5","delivered","✓"],["Arriving","stat7","arriving","↗"]];
  const link = (page, label) => `<button class="secondary-btn" type="button" onclick="navigate('${page}')" ${can(page) ? "" : "hidden"}>${label}</button>`;
  $("content").innerHTML = `
  <div class="dashboard-page">
  <div class="dashboard-filterbar">
    <label class="dashboard-filter-field">FROM DATE<input id="dashDateFrom" type="date"></label>
    <label class="dashboard-filter-field">TO DATE<input id="dashDateTo" type="date"></label>
    <label class="dashboard-filter-field">LOCATION<select id="dashLocation"><option value="">All Locations</option></select></label>
  </div>
  <div class="cards dashboard-cards dashboard-summary">
    ${stats.map(([x,id,kind,icon]) => `<button type="button" class="stat-card stat-card-button${kind === "total" ? " total-stock-card" : ` dashboard-status-card status-${kind}`}" data-stat="${kind}" title="Click to view vehicles">${kind === "total" ? `<div class="stat-title">${x}</div><div class="total-stock-chart"><div class="total-stock-visual"><svg id="totalStockPie" viewBox="0 0 180 192" role="img" aria-label="Total order stock breakdown"></svg><div class="total-stock-center"><div class="stat-value" id="${id}">0</div><div class="stat-money" id="${id}v">₹ 0</div></div></div><div id="totalStockLegend" class="total-stock-legend"></div></div>` : `<span class="dashboard-status-icon" aria-hidden="true">${icon}</span><span class="stat-title">${x}</span><div class="dashboard-status-count"><div class="stat-value" id="${id}">0</div><span class="dashboard-stat-unit">Vehicles</span></div><div class="stat-money" id="${id}v">₹ 0</div>`}</button>`).join("")}
  </div>
  <div class="dashboard-grid">
    <div class="panel dashboard-finance-panel"><div class="panel-head"><h3>Financier-wise Stock</h3>${link("finance-report","View Report")}</div><div id="financeDash" class="table-wrap dashboard-table">${emptyState("Loading...")}</div></div>
    <div class="panel dashboard-location-panel"><div class="panel-head"><h3>Location-wise Stock (All Locations)</h3>${link("location-report","View Report")}</div><div id="locationChart" class="table-wrap dashboard-table">${emptyState("Loading...")}</div></div>
    <div class="panel dashboard-model-panel"><div class="panel-head"><h3>Model-wise Stock (All Models)</h3>${link("model-report","View Report")}</div><div id="modelStockDash" class="table-wrap dashboard-table">${emptyState("Loading...")}</div></div>
    <div class="panel dashboard-extra-panel"><div class="panel-head"><h3>Dealer Code-wise Stock</h3>${link("dealer-report","View Report")}</div><div id="dealerDash" class="table-wrap dashboard-table">${emptyState("Loading...")}</div></div>
    <div class="panel dashboard-age-panel">
      <div class="panel-head"><h3>Stock Ageing (Free Stock Only)</h3></div>
      <p id="ageNote" class="form-help"></p><div id="ageDash" class="age-cards">${emptyState("Loading...")}</div>
      <div class="panel-head ageing-subhead"><h3>Model-wise Free Stock &amp; Ageing</h3>${link("model-report","View Report")}</div>
      <div id="modelDash" class="table-wrap dashboard-table">${emptyState("Loading...")}</div>
    </div>
    <div class="panel dashboard-movements-panel"><div class="panel-head"><h3>Recent Vehicle Movements</h3>${link("gate-report","View All")}</div><div id="gateTable" class="table-wrap dashboard-table">${emptyState("Loading...")}</div></div>
    <div class="panel dashboard-arriving-panel"><div class="panel-head"><h3>Arriving Vehicles — OUT, awaiting IN</h3>${link("arriving-report","View All")}</div><div id="arrivingTable" class="table-wrap dashboard-table">${emptyState("Loading...")}</div></div>
    <div class="panel dashboard-extra-panel"><div class="panel-head"><h3>Delivered by Model and Location</h3>${link("delivery-report","View Report")}</div><div id="deliveredModelLocation" class="table-wrap dashboard-table">${emptyState("Loading...")}</div></div>
  </div>
  </div>`;
  document.querySelectorAll(".stat-card-button").forEach(b => b.addEventListener("click", () => openStatModal(b.dataset.stat)));
  ["dashDateFrom","dashDateTo","dashLocation"].forEach(id => $(id)?.addEventListener("change", loadDashboardData));
  if(state.supabase) return loadDashboardData();
}

async function getStatusSummary(){
  const rows = await allVehicles();
  const groups = {};
  rows.forEach(v => { const k = v.status || "UNKNOWN"; groups[k] ??= {count:0, value:0}; groups[k].count++; groups[k].value += Number(v.stock_value || 0); });
  return Object.entries(groups).map(([status,v]) => ({status, ...v})).sort((a,b) => b.count - a.count);
}

function totalStockPieHtml(items){
  const total = items.reduce((n,item) => n + item.count, 0);
  if(!total) return {svg:`<circle class="pie-track" cx="90" cy="90" r="72"></circle>`, legend:emptyState("No stock data yet.")};
  const cx = 90, cy = 90, R = 82, r = 52;
  let a0 = -Math.PI / 2;
  const slices = items.map((item,i) => {
    if(!item.count) return "";
    const fraction = item.count / total, end = a0 + fraction * 2 * Math.PI;
    const point = (radius, angle) => `${(cx + radius * Math.cos(angle)).toFixed(2)} ${(cy + radius * Math.sin(angle)).toFixed(2)}`;
    const large = fraction > .5 ? 1 : 0;
    const path = fraction >= .9999
      ? `M${cx} ${cy-R} A${R} ${R} 0 1 1 ${cx-.01} ${cy-R} L${cx-.01} ${cy-r} A${r} ${r} 0 1 0 ${cx} ${cy-r} Z`
      : `M${point(R,a0)} A${R} ${R} 0 ${large} 1 ${point(R,end)} L${point(r,end)} A${r} ${r} 0 ${large} 0 ${point(r,a0)} Z`;
    a0 = end;
    const color = PIE_COLORS[i % PIE_COLORS.length];
    return `<path d="${path}" fill="${color}" stroke="#fff" stroke-width="1.5"><title>${esc(item.label)}: ${item.count.toLocaleString("en-IN")} (${((fraction)*100).toFixed(1)}%)</title></path>`;
  }).join("");
  const legend = items.map((item,i) => `<div class="total-stock-legend-row"><i style="background:${PIE_COLORS[i % PIE_COLORS.length]}"></i><span>${esc(item.label)}</span><b>${item.count.toLocaleString("en-IN")}</b><em>${total ? ((item.count/total)*100).toFixed(1) : "0.0"}%</em><small>${moneyShort(item.value)}</small></div>`).join("");
  return {svg:`<circle class="pie-track" cx="90" cy="90" r="82"></circle>${slices}<circle class="pie-center" cx="90" cy="90" r="48"></circle>`,legend};
}

async function loadDashboardData(){
  const safe = p => Promise.resolve(p).then(data => ({data, error:null}), error => ({error, data:null}));
  const [allRes, gate] = await Promise.all([safe(allVehicles()), safe(computedRows("gate_movement_report"))]);
  await getLocations();
  const locationSelect = $("dashLocation");
  if(locationSelect && !locationSelect.dataset.ready){
    const assignedLocation = dashboardAssignedLocation();
    locationSelect.innerHTML = assignedLocation === null
      ? `<option value="">All Locations</option>` + (state.locations || []).map(l => `<option value="${esc(l.location_name)}">${esc(l.location_name)}</option>`).join("")
      : assignedLocation
        ? `<option value="${esc(assignedLocation)}">${esc(assignedLocation)}</option>`
        : `<option value="">Assigned location unavailable</option>`;
    if(assignedLocation !== null){
      locationSelect.value = assignedLocation;
      locationSelect.disabled = true;
    }
    locationSelect.dataset.ready = "true";
  }
  const box = id => $(id), fail = msg => ["financeDash","dealerDash","locationTable","locationChart","modelStockDash","deliveredModelLocation","ageDash","modelDash","arrivingTable"].forEach(i => { if(box(i)) box(i).innerHTML = emptyState("Could not load: " + msg); });
  if(dashboardAssignedLocation() === ""){
    fail("No assigned location is available for this user. Contact Admin.");
    ["stat0","stat1","stat2","stat3","stat4","stat5"].forEach(id => { if(box(id)) box(id).textContent = "—"; if(box(id + "v")) box(id + "v").textContent = "—"; });
    if(box("stat7")) box("stat7").textContent = "0";
    if(box("stat7v")) box("stat7v").textContent = moneyShort(0);
    if(box("arrivingTable")) box("arrivingTable").innerHTML = emptyState("No vehicles are awaiting arrival.");
    if(box("totalStockLegend")) box("totalStockLegend").innerHTML = emptyState("No assigned location is available.");
    return;
  }
  if(allRes.error){ fail(allRes.error.message || allRes.error); }
  else {
    const all = allRes.data.filter(dashboardMatchesVehicle), sum = {total:{n:0, v:0}};
    STAGES.forEach(([k]) => { sum[k] = {n:0, v:0}; });
    sum.cancelled = {n:0, v:0};
    all.forEach(v => { const st = vStage(v), a = vAmt(v); sum[st].n++; sum[st].v += a; if(st !== "delivered" && st !== "cancelled"){ sum.total.n++; sum.total.v += a; } });
    [["total","stat0"],["stock","stat1"],["transit","stat2"],["pending","stat3"],["bill","stat4"],["delivered","stat5"]].forEach(([k,id]) => {
      if(box(id)) box(id).textContent = sum[k].n.toLocaleString("en-IN"); if(box(id + "v")) box(id + "v").textContent = moneyShort(sum[k].v); });
    const totalPie = totalStockPieHtml([["stock","Free Stock"],["transit","In Transit"],["pending","Pending Order"],["bill","Tally Done"]].map(([key,label]) => ({label,count:sum[key].n,value:sum[key].v})));
    if(box("totalStockPie")) box("totalStockPie").innerHTML = totalPie.svg;
    if(box("totalStockLegend")) box("totalStockLegend").innerHTML = totalPie.legend;
    const bindDim = el => el?.querySelectorAll("[data-dim]").forEach(b => b.addEventListener("click", () => openDimModal(b.dataset.dim, b.dataset.key, b.dataset.stage)));
    const draw = (id, headers, groups, mapper, footer) => { const el = box(id); if(!el) return;
      el.innerHTML = groups.length ? table(headers, groups.map(mapper), footer(groups)) : emptyState("No records found."); bindDim(el); };
    const tot = (gs, set, k) => gs.reduce((t, g) => t + g[set][k], 0);

    // 6. Finance wise stock: counts and combined value for Free Stock, In Transit and Tally Done
    const fin = stageGroup(all, DIMS.finance.of).filter(g => g.n.stock + g.n.transit + g.n.bill).sort((a,b) => (b.n.stock + b.n.transit + b.n.bill) - (a.n.stock + a.n.transit + a.n.bill));
    const financeTotalValue = g => g.v.stock + g.v.transit + g.v.bill;
    const financeTotalCount = g => g.n.stock + g.n.transit + g.n.bill;
    draw("financeDash", ["Financier\nName","Free\nStock","Free Stock\nValue","In\nTransit","Transit\nValue","Total\nCount","Total\nValue"], fin,
      g => [g.key, dimNum(g.n.stock,"finance",g.key,"stock"), moneyShort(g.v.stock), dimNum(g.n.transit,"finance",g.key,"transit"), moneyShort(g.v.transit), dimNum(financeTotalCount(g),"finance",g.key,"stock-transit-bill"), moneyShort(financeTotalValue(g))],
      gs => [B("Grand Total"), N(tot(gs,"n","stock")), MS(tot(gs,"v","stock")), N(tot(gs,"n","transit")), MS(tot(gs,"v","transit")), N(gs.reduce((t,g) => t + financeTotalCount(g), 0)), MS(gs.reduce((t,g) => t + financeTotalValue(g), 0))]);
    // 7. Dealer code wise: available, in transit, bill / not delivered (count + short value)
    const dealerPriority = ["W2203","W2230","W2A08","W2281","W2283"], dealerRank = new Map(dealerPriority.map((name,i) => [name,i]));
    const dea = stageGroup(all, DIMS.dealer.of).filter(g => g.n.stock + g.n.transit + g.n.bill).sort((a,b) => {
      const ai = dealerRank.get(a.key), bi = dealerRank.get(b.key);
      if(ai !== undefined || bi !== undefined) return (ai ?? Infinity) - (bi ?? Infinity);
      return b.n.stock - a.n.stock || b.n.transit - a.n.transit;
    });
    draw("dealerDash", ["Dealer","Free Stock","Value","In Transit","Value","Tally Done","Value","Total Count","Grand Total Value"], dea,
      g => [g.key, dimNum(g.n.stock,"dealer",g.key,"stock"), moneyShort(g.v.stock), dimNum(g.n.transit,"dealer",g.key,"transit"), moneyShort(g.v.transit), dimNum(g.n.bill,"dealer",g.key,"bill"), moneyShort(g.v.bill), dimNum(g.n.stock + g.n.transit + g.n.bill,"dealer",g.key,"stock-transit-bill"), moneyShort(g.v.stock + g.v.transit + g.v.bill)],
      gs => [B("Total"), N(tot(gs,"n","stock")), MS(tot(gs,"v","stock")), N(tot(gs,"n","transit")), MS(tot(gs,"v","transit")), N(tot(gs,"n","bill")), MS(tot(gs,"v","bill")), N(gs.reduce((t,g) => t + g.n.stock + g.n.transit + g.n.bill, 0)), MS(gs.reduce((t,g) => t + g.v.stock + g.v.transit + g.v.bill, 0))]);
    // 9. Location wise available stock: Free Stock + Tally Done count and value
    const loc = stageGroup(all, DIMS.location.of).filter(g => g.n.stock + g.n.transit + g.n.bill).sort((a,b) => compareLocationNames(a.key,b.key));
    const locationTotalCount = g => g.n.stock + g.n.transit + g.n.bill;
    const locationTotalValue = g => g.v.stock + g.v.transit + g.v.bill;
    const locationsByName = new Map(loc.map(g => [g.key,g]));
    const allLocationNames = [...new Set([...(state.locations || []).map(l => l.location_name), ...loc.map(g => g.key)].filter(Boolean))]
      .sort(compareLocationNames);
    const allLocations = allLocationNames.map(key => locationsByName.get(key) || {key,n:emptyStageSet(),v:emptyStageSet()});
    draw("locationTable", ["Location","Free Stock","Free Stock Value","Tally Done","Tally Done Value","In Transit","In Transit Value","Total Count","Grand Total Value"], loc,
      g => [g.key, dimNum(g.n.stock,"location",g.key,"stock"), moneyShort(g.v.stock), dimNum(g.n.bill,"location",g.key,"bill"), moneyShort(g.v.bill), dimNum(g.n.transit,"location",g.key,"transit"), moneyShort(g.v.transit), dimNum(locationTotalCount(g),"location",g.key,"stock-transit-bill"), moneyShort(locationTotalValue(g))],
      gs => [B("Total"), N(tot(gs,"n","stock")), MS(tot(gs,"v","stock")), N(tot(gs,"n","bill")), MS(tot(gs,"v","bill")), N(tot(gs,"n","transit")), MS(tot(gs,"v","transit")), N(gs.reduce((t,g) => t + locationTotalCount(g), 0)), MS(gs.reduce((t,g) => t + locationTotalValue(g), 0))]);
    if(box("locationChart")){
      box("locationChart").innerHTML = allLocations.length
        ? table(["Location","Total Count","Value"],
          allLocations.map(g => [g.key, dimNum(locationTotalCount(g),"location",g.key,"stock-transit-bill"), moneyShort(locationTotalValue(g))]),
          [B("Grand Total"), N(allLocations.reduce((n,g) => n + locationTotalCount(g), 0)), MS(allLocations.reduce((n,g) => n + locationTotalValue(g), 0))])
        : emptyState("No location stock found.");
      bindDim(box("locationChart"));
    }

    const deliveredGroups = new Map();
    all.filter(v => vStage(v) === "delivered").forEach(v => {
      const model = v.model || "Not Available", location = vLocName(v), key = JSON.stringify([model,location]);
      const g = deliveredGroups.get(key) || {model, location, count:0, value:0};
      g.count++; g.value += vValue(v); deliveredGroups.set(key, g);
    });
    const deliveredByModelLocation = [...deliveredGroups.values()].sort((a,b) => compareLocationNames(a.location,b.location) || a.model.localeCompare(b.model));
    draw("deliveredModelLocation", ["Model","Location","Delivered","Purchase Value"], deliveredByModelLocation,
      g => [g.model,g.location,g.count,moneyShort(g.value)],
      gs => [B("Total"),"",N(gs.reduce((t,g) => t + g.count, 0)),MS(gs.reduce((t,g) => t + g.value, 0))]);

    // Ageing = Free Stock only (In Transit, Tally Done, Pending Order and Delivered are not aged)
    const ageRows = ageInfo(all), names = ageBucketNames(), buckets = [...names, ...(ageRows.some(a => a.b === AGE_NODATE) ? [AGE_NODATE] : [])];
    const nf = x => Number(x).toLocaleString("en-IN");
    if(box("ageNote")) box("ageNote").textContent = `Ageing is calculated on Free Stock only: ${nf(ageRows.length)} vehicles.`;
    if(box("ageDash")){
      box("ageDash").innerHTML = ageRows.length ? buckets.map(bk => { const l = ageRows.filter(a => a.b === bk);
        return `<button type="button" class="stat-card stat-card-button age-card" data-age-b="${esc(bk)}"><div class="stat-title">${esc(bk)}</div><div class="stat-value">${l.length.toLocaleString("en-IN")}</div><div class="stat-note">${moneyShort(l.reduce((t,a) => t + vAmt(a.v), 0))}</div></button>`; }).join("")
        : emptyState("No free stock yet. Vehicles appear here after Bhilarwadi / Branch IN.");
      box("ageDash").querySelectorAll("[data-age-b]").forEach(b => b.addEventListener("click", () => openAgeModal(null, b.dataset.ageB)));
    }
    // Model wise free stock (Tally Done, Delivered, Pending and In Transit are excluded) with ageing count + value
    const ageBy = {}; ageRows.forEach(a => { const m = DIMS.model.of(a.v), o = ((ageBy[m] ??= {})[a.b] ??= {n:0, v:0}); o.n++; o.v += vAmt(a.v); });
    const mod = stageGroup(all, DIMS.model.of).filter(g => g.n.stock).sort((a,b) => b.n.stock - a.n.stock);
    if(box("modelStockDash")){
      const modelCount = g => g.n.stock + g.n.transit + g.n.pending + g.n.bill;
      const modelValue = g => g.v.stock + g.v.transit + g.v.pending + g.v.bill;
      const models = stageGroup(all, DIMS.model.of).filter(g => modelCount(g))
        .sort((a,b) => modelCount(b) - modelCount(a));
      box("modelStockDash").innerHTML = models.length
        ? table(["Model","Total Count","Value"], models.map(g => [g.key, N(modelCount(g)), moneyShort(modelValue(g))]),
          [B("Grand Total"), N(models.reduce((n,g) => n + modelCount(g), 0)), MS(models.reduce((n,g) => n + modelValue(g), 0))])
        : emptyState("No model stock found.");
      bindDim(box("modelStockDash"));
    }
    if(box("modelDash")){
      const bCell = (m, bk) => { const o = ageBy[m]?.[bk]; return `<td class="num"><div class="age-cell">${o ? `<button type="button" class="link-num" data-age-m="${esc(m)}" data-age-b="${esc(bk)}">${nf(o.n)}</button><span>${moneyShort(o.v)}</span>` : `<span>0</span><span>-</span>`}</div></td>`; };
      const bTot = bk => { const l = ageRows.filter(a => a.b === bk); return `<td class="num"><div class="age-cell"><b>${nf(l.length)}</b><b>${moneyShort(l.reduce((t,a) => t + vAmt(a.v), 0))}</b></div></td>`; };
      box("modelDash").innerHTML = mod.length ? `<table class="age-table"><thead><tr><th>Model</th><th>Free Stock</th><th>Stock Value</th>${buckets.map(b => `<th class="grp">${esc(b)}<span class="age-head-sub">Qty / Value</span></th>`).join("")}</tr></thead>
        <tbody>${mod.map(g => `<tr><td>${esc(g.key)}</td><td class="num">${cell(dimNum(g.n.stock,"model",g.key,"stock"))}</td><td class="num">${moneyShort(g.v.stock)}</td>${buckets.map(bk => bCell(g.key, bk)).join("")}</tr>`).join("")}</tbody>
        <tfoot><tr><td><b>Total</b></td><td class="num"><b>${nf(tot(mod,"n","stock"))}</b></td><td class="num"><b>${moneyShort(tot(mod,"v","stock"))}</b></td>${buckets.map(bTot).join("")}</tr></tfoot></table>` : emptyState("No free stock yet.");
      bindDim(box("modelDash"));
      box("modelDash").querySelectorAll("[data-age-m]").forEach(b => b.addEventListener("click", () => openAgeModal(b.dataset.ageM, b.dataset.ageB)));
    }
  }
  const rows = Math.max(1, parseInt(state.settings?.sys?.dashboard_recent_rows, 10) || 8);
  const f = dashboardFilters(), allMovements = gate.data || [], movements = allMovements.filter(r => {
    const day = String(r.movement_time || "").slice(0,10), loc = r.to_location || r.from_location || "";
    return (!f.from || day >= f.from) && (!f.to || day <= f.to) && (!f.location || loc === f.location);
  });
  if(box("stat7")) box("stat7").textContent = "0";
  if(box("stat7v")) box("stat7v").textContent = moneyShort(0);
  if(box("arrivingTable")) box("arrivingTable").innerHTML = emptyState("No vehicles are awaiting arrival.");
  if(box("gateTable")) box("gateTable").innerHTML = gate.error ? emptyState("Could not load: " + (gate.error.message || gate.error)) :
    table(["Date & Time","Type","VIN No.","From","To","Status"], movements.slice(0, rows).map(r => {
      const type = String(r.movement_type || "").toUpperCase();
      const movementBadge = ["IN","OUT"].includes(type)
        ? raw(`<span class="badge dashboard-movement-${type.toLowerCase()}">${type}</span>`)
        : esc(r.movement_type || "-");
      return [fmtDT(r.movement_time), movementBadge, r.vin, r.from_location, r.to_location, movementBadge];
    }));
}

/* ------------------------------------------- Dashboard: click-through windows + ageing */
const AGE_NODATE = "No date";
function ageInfo(all){      // Free Stock only (In Transit, Tally Done, Delivered and Pending are not ageing stock)
  return all.filter(v => vStage(v) === "stock").map(v => {
    const d = daysSince(v.purchase_date ?? v.hmi_invoice_date); return {v, d, b:d === null ? AGE_NODATE : agingBucket(d)}; });
}
const vRow = v => ({...v, location_name:vLocName(v), aging_days:daysSince(v.purchase_date ?? v.hmi_invoice_date), delivery_no_c:v.delivery_no || v.grn_no});
const DASH_PURCHASE_KEYS = ["main_dealer","dealer_code","hmi_invoice_date","hmi_invoice_no","excise_invoice_no","order_date","order_no","model","variant","color","vin","fsc","variant_code","engine_no","finance_company","departure_date","lot_number","transporter_name","transporter_vehicle_no","basic_price","freight_insurance","total_invoice_value","igst_pct","igst","cgst_pct","cgst","sgst_pct","sgst","comp_cess_pct","comp_cess","tcs_pct","tcs_value","hmi_invoice_amount","hsn_code","emission_type","quantity","grn_no","grn_date","sale_tax","fob_key"];
const DASH_PURCHASE_COLS = DASH_PURCHASE_KEYS.map(k => col(FIELD_HEADING[k],k,FIELD_TYPE[k]));
const DASH_SALES_COLS = [col("Tally Invoice Date","bill_date","date"),col("VIN No.","vin"),col("Engine No","engine_no"),col("Customer Name","customer_name"),col("Tally Invoice No","bill_no"),col("Tally Location","sales_location"),col("Model","model"),col("Variant","variant"),col("Color","color"),col("Total Invoice value","total_invoice_value","money")];
const DASH_ORDER_COLS = [col("Order Date","order_date","date"),col("Order No","order_no"),col("PIS No","pis_no"),col("Model","model"),col("Variant","variant"),col("Color","color"),col("Order Amount","order_amount","money"),col("Order Type","order_type"),col("Assigned Date","assigned_date","date"),col("Confirm Date","confirm_date","date"),col("VIN No.","vin"),col("Order Status","order_status"),col("Customer ID","customer_id"),col("Customer Name","customer_name")];
const DASH_TOTAL_COLS = [...DASH_PURCHASE_COLS, ...DASH_SALES_COLS.filter(c => !DASH_PURCHASE_KEYS.includes(c.k))];
const hasSalesReportData = v => !!(v.sales_imported_at || v.bill_date || v.bill_no || v.sales_location);
function dashboardModalCols(kind, rows){
  if(kind === "pending") return DASH_ORDER_COLS;
  const hasSales = rows.some(hasSalesReportData);
  if(["bill","delivered"].includes(kind)) return hasSales ? DASH_SALES_COLS : DASH_PURCHASE_COLS;
  if(["total","stock-bill","all"].includes(kind) && hasSales) return DASH_TOTAL_COLS;
  return DASH_PURCHASE_COLS;
}
function currentStatusColumns(rows, selectedStatus){
  const stages = selectedStatus ? [vStage({status:selectedStatus})] : [...new Set(rows.map(vStage))];
  const groups = [];
  stages.forEach(stage => {
    const stageRows = rows.filter(v => vStage(v) === stage);
    if(["pending","cancelled"].includes(stage)) groups.push(DASH_ORDER_COLS);
    else if(["stock","transit"].includes(stage)) groups.push(DASH_PURCHASE_COLS);
    else if(["bill","delivered"].includes(stage)){
      const withSales = stageRows.some(hasSalesReportData), withoutSales = stageRows.some(v => !hasSalesReportData(v));
      if(withSales) groups.push(DASH_SALES_COLS);
      if(withoutSales || !withSales) groups.push(DASH_PURCHASE_COLS);
    }
  });
  const columns = [...new Map(groups.flat().map(c => [c.k,c])).values()];
  return [col("Status","status"), col("Location","location_name"), ...columns.filter(c => !["status","location_name"].includes(c.k))];
}
const DASH_KIND = {
  total:{title:"Total Order Stock — Available + Pending Order + In Transit + Tally Done", f:v => !["delivered","cancelled"].includes(vStage(v))},
  stock:{title:"Free Stock", f:v => vStage(v) === "stock"},
  transit:{title:"In Transit", f:v => vStage(v) === "transit"},
  pending:{title:"Pending Order", f:v => vStage(v) === "pending"},
  bill:{title:"Tally Done", f:v => vStage(v) === "bill"},
  delivered:{title:"Delivered", f:v => vStage(v) === "delivered"}
};
async function openStatModal(kind){
  const def = DASH_KIND[kind]; if(!def && kind !== "arriving") return;
  if(!state.supabase){ toast("Connect Supabase first.","error"); return; }
  try {
    if(kind === "arriving"){
      openVehicleModal("Arriving Vehicles — OUT, awaiting IN", [],
        [col("OUT Date","movement_time","datetime"),col("VIN","vin"),col("Model","model"),col("Stock Status","status"),col("IN Location","in_location"),col("OUT Location","out_location"),col("Value","stock_value","money")],
        "arriving", [], () => openStatModal("arriving"));
      return;
    }
    const all = await allVehicles(); await getLocations();
    const rows = all.filter(def.f).filter(dashboardMatchesVehicle).map(vRow);
    // Total Order Stock window: stage-wise breakdown so the totals reconcile (order → delivery)
    const chips = kind === "total" ? STAGES.filter(([k]) => k !== "delivered").map(([k,label]) => { const l = rows.filter(r => vStage(r) === k); return `<span class="dm-chip dm-stage">${label}: <b>${l.length.toLocaleString("en-IN")}</b> · ${moneyShort(l.reduce((t,r) => t + vAmt(r), 0))}</span>`; }) : [];
    openVehicleModal(def.title, rows, dashboardModalCols(kind,rows), kind, chips, () => openStatModal(kind));
  } catch(err){ toast("Could not load: " + (err.message || err), "error"); }
}
const STAGE_TITLE = {stock:"Free Stock", transit:"In Transit", bill:"Tally Done", "stock-bill":"Free Stock + Tally Done", "stock-transit-bill":"Free Stock + In Transit + Tally Done", delivered:"Delivered", pending:"Pending Order", all:"All vehicles"};
async function openDimModal(dim, key, stage){          // click on a count in a dashboard table / pie
  const d = DIMS[dim]; if(!d) return;
  try {
    const all = await allVehicles(); await getLocations();
    const rows = all.filter(v => d.of(v) === key && (stage === "all" || (stage === "stock-bill" ? ["stock","bill"].includes(vStage(v)) : stage === "stock-transit-bill" ? ["stock","transit","bill"].includes(vStage(v)) : vStage(v) === stage))).map(vRow);
    openVehicleModal(`${d.label}: ${key} — ${STAGE_TITLE[stage] || stage}`, rows, dashboardModalCols(stage,rows), "dashboard-" + dim, [], () => openDimModal(dim, key, stage));
  } catch(err){ toast("Could not load: " + (err.message || err), "error"); }
}
async function openAgeModal(model, bucket){
  try {
    const all = await allVehicles(); await getLocations();
    const rows = ageInfo(all).filter(a => a.b === bucket && (model === null || (a.v.model || "Not Available") === model)).map(a => vRow(a.v));
    openVehicleModal(`${model === null ? "All models" : model} — Ageing ${bucket}`, rows, DASH_PURCHASE_COLS, "ageing", [], () => openAgeModal(model, bucket));
  } catch(err){ toast("Could not load: " + (err.message || err), "error"); }
}
// Window with a filterable, paged vehicle list, summary totals, a Total row and Excel export.
function openVehicleModal(title, rows, cols, fileKey, chips = [], reopen = null){
  const sums = cols.filter(c => c.t === "money"), canEdit = state.isAdmin && rows.some(r => r.id);
  const stageFilter = fileKey === "total" ? `<label>Status<select id="dmStageFilter"><option value="">All statuses</option><option value="stock">Free Stock</option><option value="transit">In Transit</option><option value="pending">Pending Order</option><option value="bill">Tally Done</option></select></label>` : "";
  openModal(`<div class="modal-bg" id="dmBg"><div class="modal wide" role="dialog" aria-modal="true" aria-label="${esc(title)}">
    <div class="panel-head"><h3>${esc(title)}</h3><div class="report-tools">${filterBtn("dmFilterBox")}<button class="secondary-btn" type="button" id="dmExport">⤓ Export</button><button class="icon-btn" type="button" id="modalClose" aria-label="Close">×</button></div></div>
    ${filterPanel("dmFilterBox", `<div class="filter-grid">${stageFilter}<label>Search rows<input id="dmFilter" type="search" placeholder="VIN, model, order no…" aria-label="Filter rows"></label></div>`)}
    <div id="dmSummary" class="dm-summary"></div><div id="dmTable" class="table-wrap"></div></div></div>`);
  const shown = () => { const q = ($("dmFilter").value || "").trim().toLowerCase(), stage = $("dmStageFilter")?.value || "";
    return rows.filter(r => (!stage || vStage(r) === stage) && (!q || cols.some(c => String(fmtCell(c.t === "days" ? "num" : c.t, r[c.k]) ?? "").toLowerCase().includes(q)))); };
  const draw = () => {
    const list = shown(), tot = c => list.reduce((t, r) => t + Number(r[c.k] || 0), 0);
    $("dmSummary").innerHTML = `<span class="dm-chip"><b>${list.length.toLocaleString("en-IN")}</b> vehicles</span>` + sums.map(c => `<span class="dm-chip">${esc(c.h)}: <b>${money(tot(c))}</b></span>`).join("") + (list.length === rows.length ? chips.join("") : "");
    const footer = list.length ? cols.map((c,i) => i === 0 ? raw(`<b>Total (${list.length.toLocaleString("en-IN")})</b>`) : c.t === "money" ? raw(`<b>${money(tot(c))}</b>`) : "") : null;
    mountPaged($("dmTable"), {headers:[...cols.map(c => c.h), ...(canEdit ? [""] : [])], footer: footer && canEdit ? [...footer, ""] : footer,
      rows:list.map(r => [...cols.map(c => c.k === "status" ? statusBadge(r[c.k]) : fmtCell(c.t === "days" ? "num" : c.t, r[c.k])), ...(canEdit ? [raw(`<button type="button" class="table-icon-btn" data-dmedit="${esc(r.id)}" title="Edit">✎ Edit</button>`)] : [])]),
      onDraw:el => el.querySelectorAll("[data-dmedit]").forEach(b => b.addEventListener("click", () => { shut(); editVehicleById(b.dataset.dmedit, () => { if(reopen) reopen(); if(state.page === "dashboard") renderDashboard(); }, reopen); }))});
  };
  const shut = () => { closeModal(); document.removeEventListener("keydown", onKey); };
  const onKey = e => { if(e.key === "Escape") shut(); };
  document.addEventListener("keydown", onKey);
  $("modalClose").onclick = shut; $("dmBg").addEventListener("mousedown", e => { if(e.target.id === "dmBg") shut(); });
  $("dmFilter").addEventListener("input", draw);
  $("dmStageFilter")?.addEventListener("change", draw);
  $("dmExport").onclick = () => { const l = shown(); if(!l.length){ toast("Nothing to export.","error"); return; }
    const exportCols = hasPerm("value.view") ? cols : cols.filter(c => c.t !== "money");
    exportSheet("dashboard-" + fileKey, exportCols.map(c => c.h), l.map(r => exportCols.map(c => (c.t === "money" || c.t === "num" || c.t === "days") ? Number(r[c.k] || 0) : (r[c.k] ?? "")))); };
  draw();
}

/* --------------------------------------------------------------- Vehicles */
const VEH = {page:0, size:50, total:0, q:"", status:"", pageType:"vehicles", rows:[]};

async function renderVehicles(page){
  VEH.page = 0; VEH.q = ""; VEH.status = ""; VEH.pageType = page; VEH.size = pageSize();
  const useStatusButtons = ["status","vehicles"].includes(page);
  $("content").innerHTML = `
  <div class="toolbar">
    <div class="searchbox${page === "search" ? " vehicle-searchbox" : ""}">
      <input id="vehicleSearch" placeholder="Search VIN / order no / engine / model / color" autocomplete="off" aria-label="Search vehicles">
      ${page === "search" ? `<button type="button" id="vehicleScan" class="secondary-btn" title="Scan VIN / chassis barcode">📷 Scan</button>` : ""}
      <button type="button" id="vehicleSearchBtn">Search</button>
    </div>
    <div class="toolbar-actions">${useStatusButtons ? "" : filterBtn("vehFilter")}<button class="secondary-btn" type="button" id="vehicleExport">⤓ Export</button></div>
  </div>
  ${useStatusButtons ? `<div class="status-filter-bar" id="vehicleStatusButtons"><button type="button" class="tab-btn status-filter-btn active" data-status="">All status</button></div>` : filterPanel("vehFilter", `<div class="filter-grid"><label>Status<select id="vehicleStatus" aria-label="Filter by status"><option value="">All status</option></select></label></div>`)}
  <div class="panel"><div class="table-wrap" id="vehicleResults">${emptyState(page === "search" ? "Enter a VIN / chassis / model to search." : "Loading vehicles...")}</div><div class="pager" id="vehiclePager"></div></div>
  <div id="modal"></div>`;

  const run = () => { VEH.q = cleanQuery($("vehicleSearch").value); if(!useStatusButtons) VEH.status = $("vehicleStatus").value; VEH.page = 0; queryVehicles(); };
  $("vehicleSearchBtn").addEventListener("click", run);
  $("vehicleSearch").addEventListener("keydown", e => { if(e.key === "Enter"){ e.preventDefault(); run(); } });
  $("vehicleScan")?.addEventListener("click", () => openScanner(v => {
    $("vehicleSearch").value = v;
    run();
  }));
  $("vehicleStatus")?.addEventListener("change", run);
  $("vehicleExport").addEventListener("click", exportVehicles);

  if(!state.supabase) return;
  getStatusSummary().then(groups => {
    const statusButtons = $("vehicleStatusButtons");
    if(statusButtons){
      const total = groups.reduce((n,g) => n + g.count, 0);
      statusButtons.innerHTML = `<button type="button" class="tab-btn status-filter-btn active" data-status="">All status (${total.toLocaleString("en-IN")})</button>` + groups.map(g => `<button type="button" class="tab-btn status-filter-btn" data-status="${esc(g.status)}">${esc(statusLabel(g.status))} (${g.count.toLocaleString("en-IN")})</button>`).join("");
      statusButtons.querySelectorAll("[data-status]").forEach(b => b.addEventListener("click", () => {
        VEH.status = b.dataset.status; VEH.page = 0;
        statusButtons.querySelectorAll(".status-filter-btn").forEach(x => x.classList.toggle("active", x === b));
        run();
      }));
    } else $("vehicleStatus")?.insertAdjacentHTML("beforeend", groups.map(g => `<option value="${esc(g.status)}">${esc(statusLabel(g.status))} (${g.count})</option>`).join(""));
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
  const actions = v => raw(`<button type="button" class="table-icon-btn" data-vid="${esc(v.id)}">Details</button>` + (state.isAdmin ? `<button type="button" class="table-icon-btn" data-vedit="${esc(v.id)}" title="Edit">✎</button><button type="button" class="table-icon-btn danger" data-vdel="${esc(v.id)}" title="Delete">🗑</button>` : ""));
  if(VEH.pageType === "status"){
    const cols = currentStatusColumns(VEH.rows, VEH.status);
    box.innerHTML = table([...cols.map(c => c.h), ""], VEH.rows.map(v => [...cols.map(c => c.k === "status" ? statusBadge(v.status) : fmtCell(c.t, c.k === "location_name" ? vLocName(v) : v[c.k])), actions(v)]));
  } else {
    box.innerHTML = table(["Order No","VIN No.","Engine No","Model","Variant","Color","Dealer","Financier Name","HMI Invoice Date","Status","Location","Order Status","Stock Value",""],
      VEH.rows.map(v => [v.order_no, raw(`<b class="mono">${esc(v.vin)}</b>`), v.engine_no, v.model, v.variant, v.color, v.dealer_code, v.finance_company, fmtD(v.hmi_invoice_date ?? v.purchase_date), statusBadge(v.status), vLocName(v), v.order_status, money(v.stock_value), actions(v)]));
  }
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
  const cols = hasPerm("value.view") ? VEHICLE_EXPORT_COLS : VEHICLE_EXPORT_COLS.filter(k => FIELD_TYPE[k] !== "money");
  exportSheet("vehicle-stock", cols.map(k => FIELD_HEADING[k]), VEH.rows.map(v => cols.map(k => vehicleCellValue(k, v))));
}
function showVehicleDetails(id){
  const v = VEH.rows.find(x => String(x.id) === String(id)); if(v) openVehicleDetails(v);
}

/* --------------------------------------------------------------- Timeline */
function renderTimeline(){
  $("content").innerHTML = `<div class="panel"><div class="panel-head"><h3>Vehicle Timeline</h3>
    <div class="searchbox"><input id="timelineVin" placeholder="Enter VIN (or last 6 digits)" autocomplete="off" aria-label="VIN"><button type="button" id="timelineBtn">Search</button></div></div>
    <div id="timelineResults">${emptyState("Search a VIN to view its read-only timeline.")}</div>
    <section class="timeline-recent"><h3>Recent Vehicle IN</h3><div id="timelineRecentList" class="table-wrap">${emptyState("Loading recent vehicle IN entries...")}</div></section></div>`;
  $("timelineBtn").addEventListener("click", loadTimeline);
  $("timelineVin").addEventListener("keydown", e => { if(e.key === "Enter"){ e.preventDefault(); loadTimeline(); } });
  loadRecentTimelineIns();
}
async function loadRecentTimelineIns(){
  const box = $("timelineRecentList");
  if(!box) return;
  if(!state.supabase){ box.innerHTML = emptyState("Connect to Supabase to load recent vehicle IN entries."); return; }
  try {
    const r = await state.supabase.from("gate_movements").select("*")
      .eq("movement_type","IN").order("created_at",{ascending:false}).limit(30);
    if(r.error) throw r.error;
    const rows = r.data || [];
    const ids = [...new Set(rows.map(x => x.vehicle_id).filter(Boolean))];
    const vehicles = {};
    if(ids.length){
      const vr = await state.supabase.from("vehicles").select("id,vin").in("id",ids);
      if(vr.error) throw vr.error;
      (vr.data || []).forEach(v => { vehicles[String(v.id)] = v; });
    }
    const entries = rows.map(x => ({...x, vin:x.vin || vehicles[String(x.vehicle_id)]?.vin || ""}))
      .filter(x => x.vin);
    box.innerHTML = table(["Date","VIN","Location","Gate","Reason",""], entries.map((x,i) => [
      fmtD(x.receipt_dt || x.created_at),
      raw(`<b class="mono">${esc(x.vin)}</b>`),
      gateLocOf(x) || "-",
      x.gate_name || "-",
      x.movement_reason || "-",
      raw(`<button type="button" class="table-icon-btn" data-recent-timeline="${i}">View Timeline</button>`)
    ])) || emptyState("No recent vehicle IN entries.");
    box.querySelectorAll("[data-recent-timeline]").forEach(button => button.addEventListener("click", () => {
      const entry = entries[Number(button.dataset.recentTimeline)];
      if(!entry) return;
      $("timelineVin").value = entry.vin;
      loadTimeline();
    }));
  } catch(err){
    box.innerHTML = emptyState("Could not load recent vehicle IN entries: " + err.message);
  }
}
async function loadTimeline(){
  const vin = cleanQuery($("timelineVin").value).replace(/\s+/g,"").toUpperCase();
  const out = $("timelineResults");
  if(!vin || !state.supabase) return;
  out.innerHTML = emptyState("Loading vehicle history...");
  let v = await state.supabase.from("vehicles").select("*").eq("vin", vin).maybeSingle();
  if(v.error){ out.innerHTML = emptyState(v.error.message); return; }
  if(!v.data && vin.length >= 6){
    const f = await state.supabase.from("vehicles").select("*").ilike("vin", `%${vin}`).limit(2);
    if(f.error){ out.innerHTML = emptyState(f.error.message); return; }
    if(f.data?.length === 1) v = {data:f.data[0]};
    else if(f.data?.length > 1){ out.innerHTML = emptyState("More than one vehicle ends with these digits — enter more of the VIN."); return; }
  }
  if(!v.data){ out.innerHTML = emptyState("Vehicle not found."); return; }
  const sb = state.supabase;
  const [history, gateById, gateByVin, deliveries] = await Promise.all([
    sb.from("vehicle_timeline").select("*").eq("vehicle_id", v.data.id),
    sb.from("gate_movements").select("*").eq("vehicle_id", v.data.id),
    sb.from("gate_movements").select("*").eq("vin", v.data.vin),
    sb.from("deliveries").select("*").eq("vehicle_id", v.data.id)
  ]);
  const failed = [history, gateById, gateByVin, deliveries].find(r => r.error);
  if(failed){ out.innerHTML = emptyState(failed.error.message); return; }

  const events = [], representedStages = new Set();
  let order = 0;
  const addEvent = event => events.push({...event, order:order++});
  const noteStage = status => {
    if(!status) return;
    const stage = vStage({status});
    if(stage !== "cancelled") representedStages.add(stage);
  };
  (history.data || []).forEach(x => {
    noteStage(x.old_status); noteStage(x.new_status);
    addEvent({date:x.created_at, title:x.event_type || "Vehicle status updated", description:x.description || "",
      oldStatus:x.old_status, newStatus:x.new_status, kind:"status"});
  });
  const gateRows = new Map();
  [...(gateById.data || []), ...(gateByVin.data || [])].forEach(x => gateRows.set(String(x.id), x));
  [...gateRows.values()].forEach(x => {
    const movement = String(x.movement_type || "").toUpperCase();
    addEvent({date:x.receipt_dt || x.created_at, sortDate:x.receipt_dt || x.created_at,
      title:`Gate ${movement || "movement"} — ${x.location_name || "Location not recorded"}`,
      description:[x.gate_name && `${x.gate_name} gate`, x.movement_reason, x.remarks].filter(Boolean).join(" · "),
      kind:movement === "IN" ? "in" : movement === "OUT" ? "out" : "movement"});
  });
  const delivery = (deliveries.data || []).slice().sort((a,b) => String(a.delivery_date || a.created_at || "").localeCompare(String(b.delivery_date || b.created_at || ""))).pop();
  const gateIns = [...gateRows.values()].filter(x => String(x.movement_type || "").toUpperCase() === "IN")
    .sort((a,b) => String(a.receipt_dt || a.created_at || "").localeCompare(String(b.receipt_dt || b.created_at || "")));
  const stockReceipt = gateIns.find(x => !v.data.sales_imported_at ||
    (Date.parse(x.receipt_dt || x.created_at || "") || 0) <= (Date.parse(v.data.sales_imported_at) || 0));
  const currentStage = v.data.status ? vStage(v.data) : null;
  const milestones = [
    {stage:"pending", status:"Pending Order", date:v.data.order_date || v.data.created_at,
      description:v.data.order_no ? `Order No. ${v.data.order_no}` : "Vehicle order created"},
    {stage:"transit", status:"In Transit", date:v.data.departure_date || v.data.hmi_invoice_date || v.data.purchase_date,
      description:v.data.hmi_invoice_no ? `Invoice No. ${v.data.hmi_invoice_no}` : "Vehicle dispatched"},
    {stage:"stock", status:"Free Stock", date:stockReceipt?.receipt_dt || stockReceipt?.created_at || v.data.grn_date,
      description:stockReceipt?.location_name ? `Received at ${stockReceipt.location_name}` : v.data.location_id && locName(v.data.location_id) !== "-" ? `Current location: ${locName(v.data.location_id)}` : "Vehicle received into stock"},
    {stage:"bill", status:"Tally Done", date:v.data.sales_imported_at,
      description:v.data.sales_location ? `Sales location: ${v.data.sales_location}` : "Sales entry completed"},
    {stage:"delivered", status:"Delivered", date:v.data.delivery_date || delivery?.delivery_date || delivery?.created_at,
      description:v.data.delivery_location || delivery?.delivery_location ? `Delivery location: ${v.data.delivery_location || delivery.delivery_location}` : "Vehicle delivered"}
  ];
  milestones.forEach(m => {
    const hasEvidence = Boolean(m.date) || currentStage === m.stage;
    if(hasEvidence && !representedStages.has(m.stage)){
      addEvent({date:m.date, title:m.status, description:m.description, newStatus:m.status, kind:"status"});
      representedStages.add(m.stage);
    }
  });
  events.sort((a,b) => {
    const aDate = Date.parse(a.sortDate || a.date || "") || Number.MAX_SAFE_INTEGER;
    const bDate = Date.parse(b.sortDate || b.date || "") || Number.MAX_SAFE_INTEGER;
    return aDate - bDate || a.order - b.order;
  });
  const body = events.map((x,i) => `<div class="timeline timeline-event timeline-${esc(x.kind)}"><div class="time">${i + 1}. ${esc(x.date ? (/^\d{4}-\d{2}-\d{2}$/.test(String(x.date)) ? fmtD(x.date) : fmtDT(x.date)) : "Date not recorded")}</div><div><b>${esc(x.title)}</b>${x.description ? `<p>${esc(x.description)}</p>` : ""}${x.oldStatus || x.newStatus ? `<small class="timeline-status-change">${x.oldStatus ? statusBadge(x.oldStatus).html : ""}${x.oldStatus && x.newStatus ? " → " : ""}${x.newStatus ? statusBadge(x.newStatus).html : ""}</small>` : ""}</div></div>`).join("");
  out.innerHTML = `<p class="mono timeline-vin">${esc(v.data.vin)}</p>${body || emptyState("No timeline events.")}`;
}

/* Delivery Entry / Delivered Vehicles / Delivery History: see js/delivery.js */

/* ---------------------------------------------------------------- Reports */
const REPORT = {key:"", rows:[]};

function reportRows(def, rows, filter){
  const f = filter.trim().toLowerCase();
  return f ? rows.filter(r => def.cols.some(c => String(r[c.k] ?? "").toLowerCase().includes(f))) : rows;
}
const REPORT_STAGE = {available_count:"stock-bill", stock_count:"stock", in_transit_count:"transit", pending_count:"pending", bill_count:"bill", delivered_count:"delivered", vehicle_count:"all", total_count:"stock-transit-bill"};
function drawReport(){
  const def = REPORTS[REPORT.key]; if(!def || !$("reportTable")) return;
  const rows = reportRows(def, REPORT.rows, $("reportFilter")?.value || ""), edit = def.editable && state.isAdmin;
  let footer = null;
  if(def.totals && rows.length) footer = def.cols.map((c,i) => i === 0 ? raw("<b>Total</b>") : (c.t === "num" || c.t === "money")
    ? raw(`<b>${fmtCell(c.t, rows.reduce((s,r) => s + Number(r[c.k] || 0), 0))}</b>`) : "");
  if(edit && footer) footer = [...footer, ""];
  const cellOf = (c, r) => (def.dim && REPORT_STAGE[c.k] && Number(r[c.k]) > 0) ? dimNum(r[c.k], def.dim, r.key, REPORT_STAGE[c.k]) : fmtCell(c.t, r[c.k]);
  mountPaged($("reportTable"), {headers:[...def.cols.map(c => c.h), ...(edit ? [""] : [])],
    rows:rows.map(r => [...def.cols.map(c => cellOf(c, r)), ...(edit ? [raw(r.id || r.vehicle_id ? `<button type="button" class="table-icon-btn" data-redit="${esc(r.id || r.vehicle_id)}" title="Edit">✎ Edit</button>` : "")] : [])]), footer,
    onDraw:el => {
      el.querySelectorAll("[data-dim]").forEach(b => b.addEventListener("click", () => openDimModal(b.dataset.dim, b.dataset.key, b.dataset.stage)));
      el.querySelectorAll("[data-redit]").forEach(b => b.addEventListener("click", () => editVehicleById(b.dataset.redit, () => loadReport(REPORT.key))));
    }});
  $("reportMeta").textContent = `${rows.length.toLocaleString("en-IN")} of ${REPORT.rows.length.toLocaleString("en-IN")} rows`;
}
// Opens the Edit Vehicle window for a vehicle id (Admin). after() runs after Save, back() after Cancel.
async function editVehicleById(id, after, back){
  const v = (await allVehicles(true)).find(x => String(x.id) === String(id));
  if(!v) return toast("Vehicle not found.", "error");
  openVehicleEdit(v, after, back);
}
async function renderReport(page){
  const def = REPORTS[page];
  if(!def){ $("content").innerHTML = `<div class="panel">${emptyState("Unknown report.")}</div>`; return; }
  REPORT.key = page; REPORT.rows = [];
  $("content").innerHTML = `<div class="panel"><div class="panel-head"><h3>${esc(def.title)}</h3>
    <div class="report-tools">${filterBtn("repFilter")}<button class="secondary-btn" type="button" id="reportExport">⤓ Export</button></div></div>
    ${filterPanel("repFilter", `<div class="filter-grid"><label>Search rows<input id="reportFilter" type="search" placeholder="Type to filter…" aria-label="Filter rows"></label></div>`)}
    <p id="reportMeta" class="form-help"></p>
    <div class="table-wrap${page === "finance-report" ? " finance-report-table" : ""}" id="reportTable">${emptyState("Loading live report...")}</div></div>`;
  $("reportFilter").addEventListener("input", drawReport);
  $("reportExport").addEventListener("click", () => {
    const rows = reportRows(def, REPORT.rows, $("reportFilter").value);
    if(!rows.length){ toast("Nothing to export.","error"); return; }
    const cols = hasPerm("value.view") ? def.cols : def.cols.filter(c => c.t !== "money");
    exportSheet(page, cols.map(c => c.h), rows.map(r => cols.map(c => (c.t === "num" || c.t === "money") ? Number(r[c.k] || 0) : (r[c.k] ?? ""))));
  });
  await loadReport(page);
}
async function loadReport(page){
  const def = REPORTS[page]; if(!def) return;
  if(!state.supabase){ $("reportTable").innerHTML = emptyState("Connect Supabase to load live report."); return; }
  try {
    const rows = await computedRows(def.source);
    if(page === "finance-report"){
      REPORT.rows = rows.filter(r => r.stock_count + r.in_transit_count + r.bill_count > 0)
        .sort((a,b) => (b.stock_count + b.in_transit_count + b.bill_count) - (a.stock_count + a.in_transit_count + a.bill_count));
      drawReport();
      return;
    }
    if(def.dim === "location") rows.sort((a,b) => compareLocationNames(a.location_name,b.location_name));
    else if(def.sort){ const [k,dir] = def.sort; rows.sort((a,b) => { const x = a[k], y = b[k];
      const c = (typeof x === "number" && typeof y === "number") ? x - y : String(x ?? "").localeCompare(String(y ?? "")); return dir === "desc" ? -c : c; }); }
    REPORT.rows = rows;
    drawReport();
  } catch(err){ $("reportTable").innerHTML = emptyState(err.message); }
}
