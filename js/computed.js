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
  if(/not[\s\-_\/]*deliver|undeliver/.test(s)) return "bill";          // "Sales / Not Delivered" must not count as Delivered
  if(s.includes("deliver")) return "delivered";
  if(s.includes("pending")) return "pending";
  if(s.includes("transit")) return "transit";
  if(s.includes("bill")) return "bill";
  return "stock";
}
const vValue = v => Number(v.stock_value || 0);
function groupStock(vehicles, keyOf){
  // Available Stock = stage "stock" only. In Transit, Pending Order and Sales / Not Delivered are counted separately; Delivered is left out.
  const g = new Map();
  vehicles.filter(v => vStage(v) !== "delivered").forEach(v => {
    const k = keyOf(v) || "Not Available";
    const x = g.get(k) || {key:k, stock_count:0, in_transit_count:0, pending_count:0, bill_count:0, stock_value:0, in_transit_value:0};
    const st = vStage(v);
    if(st === "pending") x.pending_count++;
    else if(st === "bill") x.bill_count++;
    else if(st === "transit"){ x.in_transit_count++; x.in_transit_value += vValue(v); }
    else { x.stock_count++; x.stock_value += vValue(v); }
    g.set(k, x);
  });
  return [...g.values()].map(x => ({...x, vehicle_count: x.stock_count + x.in_transit_count + x.pending_count + x.bill_count}));
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
  let r = await sb.from("gate_movement_report").select("*").order("movement_time",{ascending:false}).limit(1000);
  if(!r.error) return r.data || [];
  r = await sb.from("gate_movements").select("*").order("created_at",{ascending:false}).limit(1000);
  if(r.error) r = await sb.from("gate_movements").select("*").limit(1000);
  if(r.error) return [];
  return (r.data || []).map(x => ({movement_time:x.movement_time || x.created_at || x.receipt_dt, movement_type:x.movement_type, vin:x.vin,
    from_location:x.from_location || "", to_location:x.to_location || "", gate_name:x.gate_name}));
}
async function computedRows(source){
  if(source === "gate_movement_report") return gateRowsFallback();
  const all = await allVehicles();
  await getLocations();
  switch(source){
    case "dashboard_stock_summary": {
      const c = {stock:0, pending:0, transit:0, bill:0, delivered:0}; all.forEach(v => c[vStage(v)]++);
      return [{total_stock:c.stock + c.transit + c.pending + c.bill, available_stock:c.stock, in_transit:c.transit, pending_order:c.pending, bill_not_delivered:c.bill, delivered:c.delivered}];
    }
    case "location_stock_report":    return groupStock(all, v => v.location_id ? locName(v.location_id) : "Not Assigned").map(x => ({...x, location_name:x.key}));
    case "model_stock_report":       return groupStock(all, v => v.model).map(x => ({...x, model:x.key}));
    case "finance_stock_report":     return groupStock(all, v => v.finance_company || "Not Financed").map(x => ({...x, finance_company:x.key}));
    case "dealer_code_stock_report": return groupStock(all, v => v.dealer_code).map(x => ({...x, dealer_code:x.key}));
    case "aging_report": return all.filter(v => vStage(v) === "stock").map(v => {
      const d = daysSince(v.purchase_date ?? v.hmi_invoice_date); return d === null ? null : {vin:v.vin, model:v.model, status:v.status, purchase_date:v.purchase_date ?? v.hmi_invoice_date, aging_days:d, aging_bucket:agingBucket(d)};
    }).filter(Boolean);
    case "in_transit_report":    return all.filter(v => vStage(v) === "transit");
    case "pending_order_report": return all.filter(v => vStage(v) === "pending").map(v => ({order_no:v.order_no, order_date:v.order_date, model:v.model, variant:v.variant, quantity:1, expected_date:null, status:v.status, color:v.color, pis_no:v.pis_no}));
    case "delivery_report":      return all.filter(v => vStage(v) === "delivered").map(v => ({delivery_no:v.delivery_no || v.grn_no, vehicle_id:v.id, delivery_date:v.delivery_date, vin:v.vin, model:v.model, customer_name:v.customer_name, finance_company:v.finance_company, location_name:v.location_id ? locName(v.location_id) : ""}));
    default: return all;
  }
}
