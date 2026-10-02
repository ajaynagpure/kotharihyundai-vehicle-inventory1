"use strict";
/* =====================================================================
   COMPUTED REPORTS: dashboard + reports are calculated straight from the
   `vehicles` table, so they always match imported data and never depend on
   database views that may be missing or filtered differently.
   ===================================================================== */
const VCACHE = {t:0, rows:null};
async function allVehicles(force = false){
  if(!force && VCACHE.rows && Date.now() - VCACHE.t < 15000) return VCACHE.rows;
  VCACHE.rows = await fetchAll(() => state.supabase.from("vehicles").select("*").order("id"), {max:50000});
  VCACHE.t = Date.now();
  return VCACHE.rows;
}
function vStage(v){
  const s = String(v.status || "").toLowerCase();
  if(s.includes("cancel")) return "cancelled";
  if(s.includes("tally")) return "bill";                                  // "Tally Done" = billed, not yet delivered
  if(/not[\s\-_\/]*deliver|undeliver/.test(s)) return "bill";          // "Tally Done" must not count as Delivered
  if(s.includes("deliver")) return "delivered";
  if(s.includes("pending")) return "pending";
  if(s.includes("transit")) return "transit";
  if(s.includes("bill")) return "bill";
  return "stock";
}
const vValue = v => Number(v.stock_value || 0);
// Tally Done vehicles stay in their location until delivery. Unassigned In Transit vehicles are awaiting Bhilarwadi arrival.
function vLocName(v){
  if(vStage(v) === "delivered" && v.delivery_location) return v.delivery_location;
  if(v.location_id) return locName(v.location_id);
  if(vStage(v) === "bill" && v.sales_location){
    const k = String(v.sales_location).trim().toLowerCase(), l = (state.locations || []).find(x => String(x.location_name).trim().toLowerCase() === k);
    if(l) return l.location_name;
  }
  if(vStage(v) === "transit") return "Bhilarwadi Stock Arriving";
  return "Not Assigned";
}
// Location-wise Free Stock, In Transit and Tally Done counts and values.
function locationRows(all){
  const m = new Map();
  all.forEach(v => { const k = vLocName(v), st = vStage(v);
    if(!["stock","transit","bill"].includes(st)) return;
    const x = m.get(k) || {key:k, location_name:k, stock_count:0, stock_value:0, in_transit_count:0, in_transit_value:0, bill_count:0, bill_value:0};
    if(st === "stock"){ x.stock_count++; x.stock_value += vValue(v); }
    else if(st === "transit"){ x.in_transit_count++; x.in_transit_value += vValue(v); }
    else if(st === "bill"){ x.bill_count++; x.bill_value += vValue(v); }
    m.set(k, x); });
  return [...m.values()]
    .map(x => ({...x, available_count:x.stock_count + x.bill_count,
      total_count:x.stock_count + x.in_transit_count + x.bill_count,
      total_value:x.stock_value + x.in_transit_value + x.bill_value}))
    .sort((a,b) => compareLocationNames(a.location_name,b.location_name));
}
function groupStock(vehicles, keyOf){
  // Free Stock = stage "stock" only. In Transit, Pending Order and Tally Done are counted separately; Delivered is left out.
  const g = new Map();
  vehicles.filter(v => !["delivered","cancelled"].includes(vStage(v))).forEach(v => {
    const k = keyOf(v) || "Not Available";
    const x = g.get(k) || {key:k, stock_count:0, in_transit_count:0, pending_count:0, bill_count:0, stock_value:0, in_transit_value:0, bill_value:0};
    const st = vStage(v);
    if(st === "pending") x.pending_count++;
    else if(st === "bill"){ x.bill_count++; x.bill_value += vValue(v); }
    else if(st === "transit"){ x.in_transit_count++; x.in_transit_value += vValue(v); }
    else { x.stock_count++; x.stock_value += vValue(v); }
    g.set(k, x);
  });
  return [...g.values()].map(x => ({...x, vehicle_count: x.stock_count + x.in_transit_count + x.pending_count + x.bill_count, total_value: x.stock_value + x.in_transit_value + x.bill_value}));
}
// Ageing limits come from System Settings (default 30 / 60 / 90 days).
function ageLimits(){ const s = (typeof state !== "undefined" && state.settings?.sys) || {}, n = (k, d) => { const x = parseInt(s[k], 10); return x > 0 ? x : d; };
  const a = n("age_limit_1", 30), b = Math.max(a + 1, n("age_limit_2", 60)), c = Math.max(b + 1, n("age_limit_3", 90)); return [a, b, c]; }
function ageBucketNames(){ const [a, b, c] = ageLimits(); return [`0-${a} days`, `${a+1}-${b} days`, `${b+1}-${c} days`, `${c}+ days`]; }
function agingBucket(d){ const [a, b, c] = ageLimits(), n = ageBucketNames(); return d <= a ? n[0] : d <= b ? n[1] : d <= c ? n[2] : n[3]; }
function daysSince(iso){
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || "")); if(!m) return null;
  return Math.max(0, Math.floor((Date.now() - new Date(+m[1], +m[2]-1, +m[3]).getTime()) / 86400000));
}
async function gateRowsFallback(){
  const sb = state.supabase;
  const rows = await fetchAll(() => sb.from("gate_movements").select("*").order("created_at",{ascending:false}), {max:50000});
  return rows.map(x => {
    const inbound = String(x.movement_type || "").toUpperCase() === "IN", loc = x.location_name || "";
    return {...x, movement_time:x.movement_time || x.created_at || x.receipt_dt,
      from_location:x.from_location || (inbound ? "" : loc), to_location:x.to_location || (inbound ? loc : "")};
  });
}
function awaitingArrivalRows(vehicles, movements){
  const vehicleById = new Map(vehicles.map(v => [String(v.id), v]));
  const vehicleByVin = new Map(vehicles.map(v => [String(v.vin || "").replace(/\s+/g,"").toUpperCase(), v]).filter(([vin]) => vin));
  const historyByVin = new Map();
  movements.forEach(r => {
    const key = String(r.vin || r.vehicle_no || "").replace(/\s+/g,"").toUpperCase();
    if(key){ if(!historyByVin.has(key)) historyByVin.set(key, []); historyByVin.get(key).push(r); }
  });
  return [...historyByVin.entries()].flatMap(([key, history]) => {
    history.sort((a,b) => String(a.created_at || a.movement_time || a.receipt_dt || "").localeCompare(String(b.created_at || b.movement_time || b.receipt_dt || "")));
    const lastIndex = history.length - 1, r = history[lastIndex];
    if(!r || String(r.movement_type || "").toUpperCase() !== "OUT") return [];
    const outLocation = String(r.location_name || r.from_location || "").trim();
    if(!outLocation) return [];
    const vehicle = (r.vehicle_id && vehicleById.get(String(r.vehicle_id))) || vehicleByVin.get(key);
    if(!vehicle || !["stock","bill"].includes(vStage(vehicle))) return [];
    return [{...r, id:vehicle.id, vin:r.vin || vehicle.vin, model:vehicle.model, status:vehicle.status,
      stock_value:vehicle.stock_value, in_location:String(r.to_location || "").trim(), out_location:outLocation}];
  });
}
async function computedRows(source){
  if(source === "gate_movement_report") return gateRowsFallback();
  if(source === "awaiting_arrival_report") return awaitingArrivalRows(await allVehicles(), await gateRowsFallback());
  const all = await allVehicles();
  await getLocations();
  switch(source){
    case "dashboard_stock_summary": {
      const c = {stock:0, pending:0, transit:0, bill:0, delivered:0, cancelled:0}; all.forEach(v => c[vStage(v)]++);
      return [{total_stock:c.stock + c.transit + c.pending + c.bill, available_stock:c.stock, in_transit:c.transit, pending_order:c.pending, bill_not_delivered:c.bill, delivered:c.delivered}];
    }
    case "location_stock_report":    return locationRows(all);
    case "model_stock_report":       return groupStock(all, v => v.model).map(x => ({...x, model:x.key}));
    case "finance_stock_report":     return groupStock(all, v => v.finance_company || "Not Financed").map(x => ({...x, finance_company:x.key}));
    case "dealer_code_stock_report": return groupStock(all, v => v.dealer_code).map(x => ({...x, dealer_code:x.key}));
    case "aging_report": return all.filter(v => vStage(v) === "stock").map(v => {
      const d = daysSince(v.purchase_date ?? v.hmi_invoice_date); return d === null ? null : {id:v.id, vin:v.vin, model:v.model, status:v.status, purchase_date:v.purchase_date ?? v.hmi_invoice_date, aging_days:d, aging_bucket:agingBucket(d)};
    }).filter(Boolean);
    case "in_transit_report":    return all.filter(v => vStage(v) === "transit");
    case "pending_order_report": return all.filter(v => vStage(v) === "pending").map(v => ({id:v.id, order_no:v.order_no, order_date:v.order_date, model:v.model, variant:v.variant, quantity:1, expected_date:null, status:v.status, color:v.color, pis_no:v.pis_no}));
    case "delivery_report":      return all.filter(v => vStage(v) === "delivered").map(v => ({delivery_no:v.delivery_no || v.grn_no, vehicle_id:v.id, delivery_date:v.delivery_date, vin:v.vin, model:v.model, customer_name:v.customer_name, finance_company:v.finance_company, location_name:v.location_id ? locName(v.location_id) : ""}));
    default: return all;
  }
}
