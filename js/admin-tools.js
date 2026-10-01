"use strict";
/* =====================================================================
   ADMIN TOOLS (Admin role): saved Settings, Locations, Roles, User edit,
   Vehicle edit / delete, Data Management (bulk delete + data reset).
   Settings live in: company_settings (row id 1), system_settings (key/value),
   import_configuration (per import type). Run ADMIN_DATA_TOOLS.sql once.
   ===================================================================== */
const SETTING_DEFAULTS = {age_limit_1:"30", age_limit_2:"60", age_limit_3:"90", vehicle_page_size:"50", dashboard_recent_rows:"8",
  imp_order_invoiced_to_transit:"true", imp_purchase_moves_pending:"true"};
const SQL_TOOLS_HINT = "Run ADMIN_DATA_TOOLS.sql once in Supabase SQL Editor, then try again.";
const nzv = v => { const t = String(v ?? "").trim(); return t === "" ? null : t; };
const dbHint = err => /column|schema cache|does not exist/i.test(err?.message || "") ? ` ${SQL_TOOLS_HINT}` : /row-level|permission|policy/i.test(err?.message || "") ? " Only Admin can change this." : "";

/* ---------------------------------------------------------------- Settings load / apply */
async function loadSettings(){
  const sb = state.supabase, out = {company:{}, sys:{...SETTING_DEFAULTS}, imp:{}};
  const safe = async fn => { try { const r = await fn(); return r.error ? null : r.data; } catch { return null; } };
  const [c, s, i] = await Promise.all([
    safe(() => sb.from("company_settings").select("*").eq("id", 1).maybeSingle()),
    safe(() => sb.from("system_settings").select("setting_key,setting_value")),
    safe(() => sb.from("import_configuration").select("import_type,active"))]);
  if(c) out.company = c;
  (s || []).forEach(r => { if(r.setting_value !== null && r.setting_value !== undefined) out.sys[r.setting_key] = r.setting_value; });
  (i || []).forEach(r => { out.imp[r.import_type] = r.active !== false; });
  state.settings = out; applyBranding();
}
const companyName = () => state.settings?.company?.company_name || "Kothari Hyundai";
const sysBool = k => { const v = state.settings?.sys?.[k]; return v === undefined || v === null ? true : !["false","0","no"].includes(String(v).toLowerCase()); };
function applyBranding(){
  const name = companyName(), strong = document.querySelector(".side-brand strong");
  if(strong) strong.textContent = name.toUpperCase();
  document.querySelectorAll(".side-brand .brand-mark, .brand-mark.small").forEach(m => { m.textContent = name.trim().charAt(0).toUpperCase() || "H"; });
  document.title = `${name} — Vehicle Inventory`;
}
async function saveSysSettings(map){
  const rows = Object.entries(map).map(([k, v]) => ({setting_key:k, setting_value:String(v), updated_at:new Date().toISOString()}));
  const r = await state.supabase.from("system_settings").upsert(rows, {onConflict:"setting_key"});
  if(r.error) throw r.error;
  Object.assign(state.settings.sys, Object.fromEntries(Object.entries(map).map(([k, v]) => [k, String(v)])));
}

/* ---------------------------------------------------------------- Settings pages */
function renderSettingsPage(page){
  const c = $("content"), ro = !state.isAdmin, dis = ro ? "disabled" : "";
  const notice = ro ? `<div class="notice"><b>View only</b><p>Only Admin can change settings.</p></div>` : "";
  const save = ro ? "" : `<div class="full form-actions"><button class="primary-btn" type="submit" id="setSave">Save Settings</button></div>`;
  const S = state.settings || {company:{}, sys:{...SETTING_DEFAULTS}, imp:{}};
  const field = (id, label, val, extra = "") => `<div><label for="${id}">${label}</label><input id="${id}" name="${id}" value="${esc(val ?? "")}" ${extra} ${dis}></div>`;
  if(page === "company"){
    const co = S.company;
    c.innerHTML = `<div class="company-settings-page"><div class="company-settings-card">
      <div class="company-settings-header"><h3>Company Settings</h3><p>Manage the company information used across the vehicle inventory system and gate passes.</p></div>
      <form id="setForm" class="company-settings-body">${notice ? `<div class="company-settings-note">${notice}</div>` : ""}
        <div class="company-settings-grid">
          <div class="company-settings-field"><label for="company_name">COMPANY NAME</label><input id="company_name" name="company_name" value="${esc(co.company_name || "Kothari Hyundai")}" required ${dis}></div>
          <div class="company-settings-field"><label for="brand">BRAND / SHORT NAME</label><input id="brand" name="brand" value="${esc(co.brand || "")}" ${dis}></div>
          <div class="company-settings-field"><label for="gstin">GSTIN</label><input id="gstin" name="gstin" value="${esc(co.gstin || "")}" maxlength="15" ${dis}></div>
          <div class="company-settings-field"><label for="phone">PHONE</label><input id="phone" name="phone" value="${esc(co.phone || "")}" ${dis}></div>
          <div class="company-settings-field"><label for="email">EMAIL</label><input id="email" name="email" type="email" value="${esc(co.email || "")}" ${dis}></div>
          <div class="company-settings-field company-settings-full"><label for="address">ADDRESS</label><textarea id="address" name="address" rows="3" ${dis}>${esc(co.address || "")}</textarea></div>
          <div class="company-settings-field company-settings-full"><label for="gate_pass_note">GATE PASS FOOTER NOTE</label><textarea id="gate_pass_note" name="gate_pass_note" rows="3" placeholder="Printed at the bottom of every gate pass" ${dis}>${esc(co.gate_pass_note || "")}</textarea></div>
        </div>
        ${ro ? "" : `<div class="company-settings-actions"><button class="primary-btn" type="submit" id="setSave">Save Settings</button></div>`}
      </form></div></div>`;
    $("setForm").addEventListener("submit", async e => {
      e.preventDefault(); const f = Object.fromEntries(new FormData(e.target).entries()), btn = $("setSave"); btn.disabled = true;
      const row = {id:1, company_name:nzv(f.company_name), brand:nzv(f.brand), gstin:nzv(f.gstin)?.toUpperCase() || null, address:nzv(f.address), phone:nzv(f.phone), email:nzv(f.email), gate_pass_note:nzv(f.gate_pass_note), updated_at:new Date().toISOString()};
      const r = await state.supabase.from("company_settings").upsert(row);
      btn.disabled = false;
      if(r.error) return toast(r.error.message + dbHint(r.error), "error");
      state.settings.company = row; applyBranding(); logAudit("UPDATE_SETTINGS","settings","company",1,{company_name:row.company_name}); toast("Company details saved.","success");
    });
    return;
  }
  if(page === "import-config"){
    const types = [["ORDER","Order Report Import"],["PURCHASE","Purchase Report Import"],["SALES","Sales Report Import"]];
    c.innerHTML = `<div class="panel"><div class="panel-head"><h3>Import Configuration</h3></div>${notice}<form id="setForm" class="settings-form">
      <div class="full"><b>Enable / disable imports</b><p class="form-help">A disabled import cannot be run from the Data Import menu.</p>
        ${types.map(([k,l]) => `<label class="check-row"><input type="checkbox" name="imp_${k}" ${S.imp[k] === false ? "" : "checked"} ${dis}> ${l}</label>`).join("")}</div>
      <div class="full"><b>Import rules</b>
        <label class="check-row"><input type="checkbox" name="imp_order_invoiced_to_transit" ${sysBool("imp_order_invoiced_to_transit") ? "checked" : ""} ${dis}> Order import: rows already <i>Invoiced</i> are added as <b>In Transit</b> (off = added as Pending Order)</label>
        <label class="check-row"><input type="checkbox" name="imp_purchase_moves_pending" ${sysBool("imp_purchase_moves_pending") ? "checked" : ""} ${dis}> Purchase import: <b>Pending Order</b> vehicles move to <b>In Transit</b> (off = status is left unchanged)</label></div>
      ${save}</form></div>`;
    $("setForm").addEventListener("submit", async e => {
      e.preventDefault(); const fd = new FormData(e.target), on = k => fd.has(k), btn = $("setSave"); btn.disabled = true;
      try {
        const rows = types.map(([k]) => ({import_type:k, active:on("imp_" + k), updated_at:new Date().toISOString()}));
        const r = await state.supabase.from("import_configuration").upsert(rows, {onConflict:"import_type"}); if(r.error) throw r.error;
        rows.forEach(x => { state.settings.imp[x.import_type] = x.active; });
        await saveSysSettings({imp_order_invoiced_to_transit:on("imp_order_invoiced_to_transit"), imp_purchase_moves_pending:on("imp_purchase_moves_pending")});
        logAudit("UPDATE_SETTINGS","settings","import-config",null,Object.fromEntries(rows.map(x => [x.import_type, x.active]))); toast("Import configuration saved.","success");
      } catch(err){ toast(err.message + dbHint(err), "error"); } finally { btn.disabled = false; }
    });
    return;
  }
  // system-settings
  const sy = S.sys;
  c.innerHTML = `<div class="panel"><div class="panel-head"><h3>System Settings</h3></div>${notice}<form id="setForm" class="settings-form">
    <div class="full"><b>Stock ageing buckets (days)</b><p class="form-help">Used on the Dashboard and the Aging Report. Example 30 / 60 / 90 gives 0-30, 31-60, 61-90 and 90+.</p></div>
    ${field("age_limit_1","BUCKET 1 UP TO",sy.age_limit_1,'type="number" min="1" required')}${field("age_limit_2","BUCKET 2 UP TO",sy.age_limit_2,'type="number" min="2" required')}${field("age_limit_3","BUCKET 3 UP TO",sy.age_limit_3,'type="number" min="3" required')}
    <div><label for="vehicle_page_size">VEHICLE STOCK ROWS PER PAGE</label><select id="vehicle_page_size" name="vehicle_page_size" ${dis}>${[25,50,100,200].map(n => `<option ${String(n) === String(sy.vehicle_page_size) ? "selected" : ""}>${n}</option>`).join("")}</select></div>
    ${field("dashboard_recent_rows","DASHBOARD: RECENT MOVEMENTS SHOWN",sy.dashboard_recent_rows,'type="number" min="3" max="30" required')}
    ${save}</form></div>`;
  $("setForm").addEventListener("submit", async e => {
    e.preventDefault(); const f = Object.fromEntries(new FormData(e.target).entries()), btn = $("setSave");
    const a = +f.age_limit_1, b = +f.age_limit_2, d = +f.age_limit_3;
    if(!(a >= 1 && b > a && d > b)) return toast("Ageing limits must increase, e.g. 30 / 60 / 90.", "error");
    btn.disabled = true;
    try {
      await saveSysSettings({age_limit_1:a, age_limit_2:b, age_limit_3:d, vehicle_page_size:f.vehicle_page_size, dashboard_recent_rows:Math.min(30, Math.max(3, +f.dashboard_recent_rows || 8))});
      logAudit("UPDATE_SETTINGS","settings","system-settings",null,f); toast("System settings saved.","success");
    } catch(err){ toast(err.message + dbHint(err), "error"); } finally { btn.disabled = false; }
  });
}

/* ---------------------------------------------------------------- Locations (add / edit / delete) */
async function renderLocationsAdmin(){
  const ad = state.isAdmin, l = await getLocations(true);
  $("content").innerHTML = `<div class="panel"><div class="panel-head"><h3>Locations</h3>${ad ? `<button class="primary-btn" type="button" id="locAdd">+ Add Location</button>` : ""}</div>
    <div class="table-wrap">${table(["Location","Code","Active",...(ad ? ["Action"] : [])], l.map((x, i) => [x.location_name, x.location_code, x.active === false ? "No" : "Yes",
      ...(ad ? [raw(`<button class="table-icon-btn" type="button" data-loc-edit="${i}" title="Edit">✎</button><button class="table-icon-btn danger" type="button" data-loc-del="${i}" title="Delete">🗑</button>`)] : [])]))}</div></div>`;
  if(!ad) return;
  $("locAdd").onclick = () => openLocationForm(null);
  document.querySelectorAll("[data-loc-edit]").forEach(b => b.addEventListener("click", () => openLocationForm(l[+b.dataset.locEdit])));
  document.querySelectorAll("[data-loc-del]").forEach(b => b.addEventListener("click", async () => {
    const x = l[+b.dataset.locDel];
    if(!confirm(`Delete location "${x.location_name}"?`)) return;
    const r = await state.supabase.from("locations").delete().eq("id", x.id).select("id");
    if(r.error) return toast(/foreign key|violates/i.test(r.error.message) ? "This location is in use. Mark it Inactive instead." : r.error.message + dbHint(r.error), "error");
    if(!r.data?.length) return toast("Not deleted — only Admin can delete.", "error");
    logAudit("DELETE_LOCATION","settings","locations",x.id,{name:x.location_name}); toast("Location deleted.","success"); renderLocationsAdmin();
  }));
}
function openLocationForm(x){
  openModal(`<div class="modal-bg"><div class="modal" role="dialog" aria-modal="true"><div class="panel-head"><h3>${x ? "Edit" : "Add"} Location</h3><button class="icon-btn" type="button" id="modalClose">×</button></div>
    <form id="locForm" class="form-grid"><div><label>LOCATION NAME *</label><input name="location_name" required value="${esc(x?.location_name || "")}"></div>
    <div><label>CODE</label><input name="location_code" value="${esc(x?.location_code || "")}"></div>
    <div><label>STATUS</label><select name="active"><option value="true" ${x?.active === false ? "" : "selected"}>Active</option><option value="false" ${x?.active === false ? "selected" : ""}>Inactive</option></select></div>
    <div class="full form-actions"><button type="button" class="secondary-btn" id="modalCancel">Cancel</button><button class="primary-btn" type="submit">Save</button></div></form></div></div>`);
  $("modalClose").onclick = closeModal; $("modalCancel").onclick = closeModal;
  $("locForm").addEventListener("submit", async e => {
    e.preventDefault(); const f = Object.fromEntries(new FormData(e.target).entries());
    const row = {location_name:f.location_name.trim(), location_code:nzv(f.location_code), active:f.active === "true"};
    const r = x ? await state.supabase.from("locations").update(row).eq("id", x.id).select("id") : await state.supabase.from("locations").insert(row).select("id");
    if(r.error) return toast(r.error.message + dbHint(r.error), "error");
    if(!r.data?.length) return toast("Not saved — only Admin can change locations.", "error");
    logAudit(x ? "UPDATE_LOCATION" : "CREATE_LOCATION","settings","locations",x?.id,row); toast("Location saved.","success"); closeModal(); renderLocationsAdmin();
  });
}

/* ---------------------------------------------------------------- Roles + user edit (Users page) */
async function renderRolesPanel(){
  const box = $("rolesPanel"); if(!box) return;
  const r = await state.supabase.from("roles").select("id,name").order("name");
  if(r.error){ box.innerHTML = emptyState(r.error.message); return; }
  const roles = r.data || [], isAdminRole = x => String(x.name).toLowerCase() === "admin";
  box.innerHTML = `<div class="panel-head"><h3>Roles</h3><button class="primary-btn" type="button" id="roleAdd">+ Add Role</button></div>
    <div class="table-wrap">${table(["Role","Action"], roles.map((x, i) => [x.name, isAdminRole(x) ? "Full access (fixed)" : raw(`<button class="table-icon-btn" type="button" data-role-edit="${i}" title="Rename">✎</button><button class="table-icon-btn danger" type="button" data-role-del="${i}" title="Delete">🗑</button>`)]))}</div>`;
  $("roleAdd").onclick = async () => {
    const name = (prompt("New role name") || "").trim(); if(!name) return;
    const x = await state.supabase.from("roles").insert({name}).select("id");
    if(x.error) return toast(x.error.message + dbHint(x.error), "error");
    logAudit("CREATE_ROLE","users","roles",x.data?.[0]?.id,{name}); toast("Role added. Set its permissions on the Permissions page.","success"); renderRolesPanel();
  };
  box.querySelectorAll("[data-role-edit]").forEach(b => b.addEventListener("click", async () => {
    const x = roles[+b.dataset.roleEdit], name = (prompt("Role name", x.name) || "").trim(); if(!name || name === x.name) return;
    const u = await state.supabase.from("roles").update({name}).eq("id", x.id).select("id");
    if(u.error) return toast(u.error.message + dbHint(u.error), "error");
    logAudit("UPDATE_ROLE","users","roles",x.id,{name}); toast("Role renamed.","success"); renderRolesPanel(); loadUsers();
  }));
  box.querySelectorAll("[data-role-del]").forEach(b => b.addEventListener("click", async () => {
    const x = roles[+b.dataset.roleDel]; if(!confirm(`Delete role "${x.name}"?`)) return;
    const d = await state.supabase.from("roles").delete().eq("id", x.id).select("id");
    if(d.error) return toast(/foreign key|violates/i.test(d.error.message) ? "Users still have this role. Assign them another role first." : d.error.message + dbHint(d.error), "error");
    if(!d.data?.length) return toast("Not deleted — only Admin can delete roles.", "error");
    logAudit("DELETE_ROLE","users","roles",x.id,{name:x.name}); toast("Role deleted.","success"); renderRolesPanel();
  }));
}
async function openUserEdit(u){
  const [roles, locs] = await Promise.all([state.supabase.from("roles").select("id,name").order("name"), getLocations()]);
  openModal(`<div class="modal-bg"><div class="modal" role="dialog" aria-modal="true"><div class="panel-head"><h3>Edit User — ${esc(u.username)}</h3><button class="icon-btn" type="button" id="modalClose">×</button></div>
    <form id="userEditForm" class="form-grid"><div><label>FULL NAME</label><input name="full_name" value="${esc(u.full_name || "")}"></div>
    <div><label>ROLE</label><select name="role_id">${(roles.data || []).map(r => `<option value="${esc(r.id)}" ${r.id === u.role_id ? "selected" : ""}>${esc(r.name)}</option>`).join("")}</select></div>
    <div><label>LOCATION</label><select name="location_id"><option value="">All Locations</option>${locs.filter(l => l.active !== false || l.id === u.location_id).map(l => `<option value="${esc(l.id)}" ${l.id === u.location_id ? "selected" : ""}>${esc(l.location_name)}</option>`).join("")}</select></div>
    <div><label>STATUS</label><select name="active"><option value="true" ${u.active === false ? "" : "selected"}>Active</option><option value="false" ${u.active === false ? "selected" : ""}>Inactive</option></select></div>
    <div class="full form-actions"><button type="button" class="secondary-btn" id="modalCancel">Cancel</button><button class="primary-btn" type="submit">Save</button></div></form></div></div>`);
  $("modalClose").onclick = closeModal; $("modalCancel").onclick = closeModal;
  $("userEditForm").addEventListener("submit", async e => {
    e.preventDefault(); const f = Object.fromEntries(new FormData(e.target).entries());
    if(state.user?.id === u.id && f.active === "false") return toast("You cannot deactivate yourself.","error");
    const patch = {full_name:nzv(f.full_name), role_id:f.role_id || null, location_id:f.location_id || null, active:f.active === "true"};
    const r = await state.supabase.from("user_profiles").update(patch).eq("id", u.id).select("id");
    if(r.error) return toast(r.error.message + dbHint(r.error), "error");
    if(!r.data?.length) return toast("Not saved — only Admin can edit users.", "error");
    logAudit("UPDATE_USER","users","user",u.id,patch); toast("User updated.","success"); closeModal(); loadUsers();
  });
}

/* ---------------------------------------------------------------- Vehicle edit / delete (Admin) */
const EDIT_TYPES = {date:"date", money:"number", num:"number", text:"text"};
async function openVehicleEdit(v, after, back){
  if(!v) return;
  const locs = (await getLocations()).filter(l => l.active !== false || l.id === v.location_id);
  const keys = [...EXCEL_FIELDS, ...DERIVED_FIELDS].map(f => f[0]).filter(k => k in v);
  const statuses = [...new Set((VCACHE.rows || []).map(x => x.status).filter(Boolean))];
  const inp = k => { const t = FIELD_TYPE[k] || "text", val = v[k] ?? "";
    return `<div><label for="ve_${k}">${esc(FIELD_HEADING[k] || k).toUpperCase()}</label><input id="ve_${k}" data-k="${k}" type="${EDIT_TYPES[t] || "text"}" ${t === "money" || t === "num" ? 'step="any"' : ""} ${k === "status" ? 'list="ve_status_list"' : ""} value="${esc(t === "date" ? String(val).slice(0, 10) : val)}" autocomplete="off"></div>`; };
  openModal(`<div class="modal-bg"><div class="modal wide" role="dialog" aria-modal="true"><div class="panel-head"><h3>Edit Vehicle — <span class="mono">${esc(v.vin || v.order_no || "")}</span></h3><button class="icon-btn" type="button" id="modalClose">×</button></div>
    <form id="vehEditForm"><div class="edit-scroll"><div class="edit-grid">${keys.map(inp).join("")}
    ${"location_id" in v ? `<div><label for="ve_location_id">LOCATION</label><select id="ve_location_id" data-k="location_id"><option value="">— None —</option>${locs.map(l => `<option value="${esc(l.id)}" ${l.id === v.location_id ? "selected" : ""}>${esc(l.location_name)}</option>`).join("")}</select></div>` : ""}</div></div>
    <datalist id="ve_status_list">${statuses.map(s => `<option value="${esc(s)}">`).join("")}</datalist>
    <div class="form-actions"><button type="button" class="secondary-btn" id="modalCancel">Cancel</button><button class="primary-btn" type="submit">Save Changes</button></div></form></div></div>`);
  const cancel = () => { closeModal(); if(back) back(); };
  $("modalClose").onclick = cancel; $("modalCancel").onclick = cancel;
  $("vehEditForm").addEventListener("submit", async e => {
    e.preventDefault(); const patch = {};
    document.querySelectorAll("#vehEditForm [data-k]").forEach(el => {
      const k = el.dataset.k, t = FIELD_TYPE[k] || "text", cur = v[k] ?? "", now = el.value.trim(), old = t === "date" ? String(cur).slice(0, 10) : String(cur);
      if(now === old) return;
      patch[k] = now === "" ? null : (t === "money" || t === "num") ? Number(now) : now;
    });
    if("vin" in patch) patch.vin = (patch.vin || "").toUpperCase().replace(/\s+/g, "");
    if("vin" in patch && !patch.vin) return toast("VIN cannot be empty.", "error");
    if(!Object.keys(patch).length){ closeModal(); return; }
    const r = await state.supabase.from("vehicles").update(patch).eq("id", v.id).select("id");
    if(r.error) return toast(r.error.code === "23505" ? "This VIN / Order No already exists." : r.error.message + dbHint(r.error), "error");
    if(!r.data?.length) return toast("Not saved — only Admin can edit vehicles.", "error");
    VCACHE.rows = null; logAudit("UPDATE_VEHICLE","vehicle","vehicles",v.id,patch); toast("Vehicle updated.","success"); closeModal(); if(after) after();
  });
}
const IDCHUNK = 100;
// Deletes vehicle rows plus the records that point to them (deliveries / timeline; gate history is kept, just unlinked).
async function deleteVehicleIds(ids, onProgress){
  const sb = state.supabase; let done = 0;
  for(let i = 0; i < ids.length; i += IDCHUNK){
    const part = ids.slice(i, i + IDCHUNK);
    await sb.from("deliveries").delete().in("vehicle_id", part);
    await sb.from("vehicle_timeline").delete().in("vehicle_id", part);
    await sb.from("gate_movements").update({vehicle_id:null}).in("vehicle_id", part);
    const r = await sb.from("vehicles").delete().in("id", part).select("id");
    if(r.error) throw new Error(r.error.message + dbHint(r.error));
    if((r.data?.length || 0) < part.length) throw new Error("Some vehicles were not deleted — only Admin can delete. " + SQL_TOOLS_HINT);
    done += r.data.length; if(onProgress) onProgress(done, ids.length);
  }
  VCACHE.rows = null; return done;
}
async function deleteVehicles(vs, after){
  if(!vs.length) return;
  if(!confirm(`Delete ${vs.length} vehicle record${vs.length > 1 ? "s" : ""}?\n\nThey disappear from Stock, Dashboard and all reports. This cannot be undone.`)) return;
  try { const n = await deleteVehicleIds(vs.map(v => v.id)); logAudit("DELETE_VEHICLES","vehicle","vehicles",null,{count:n, vins:vs.slice(0, 50).map(v => v.vin)}); toast(`${n} vehicle${n > 1 ? "s" : ""} deleted.`,"success"); if(after) after(); }
  catch(err){ toast(err.message, "error"); }
}

/* ---------------------------------------------------------------- Data Management */
const DM = {tab:"ORDER", rows:[], q:"", sel:new Set(), byId:new Map()};
const DM_TABS = {
  ORDER:{label:"Order Data", test:v => !isBlank(v.order_no),
    cols:[col("Order No","order_no"),col("Order Date","order_date","date"),col("VIN No.","vin"),col("Model","model"),col("Variant","variant"),col("Color","color"),col("Status","status"),col("Order Amount","order_amount","money")]},
  PURCHASE:{label:"Purchase Data", test:v => !isBlank(v.hmi_invoice_no) || !isBlank(v.hmi_invoice_date) || !isBlank(v.purchase_date),
    cols:[col("VIN No.","vin"),col("Engine No","engine_no"),col("Model","model"),col("Variant","variant"),col("Color","color"),col("Dealer","dealer_code"),col("Financier Name","finance_company"),col("HMI Invoice No","hmi_invoice_no"),col("HMI Invoice Date","hmi_invoice_date","date"),col("Status","status"),col("HMI Invoice Amount","hmi_invoice_amount","money")]},
  SALES:{label:"Sales Data", test:v => ["bill","delivered"].includes(vStage(v)) || !isBlank(v.delivery_date) || !isBlank(v.sales_imported_at),
    cols:[col("Delivery No","delivery_no"),col("Delivery Date","delivery_date","date"),col("VIN No.","vin"),col("Model","model"),col("Customer","customer_name"),col("Financier Name","finance_company"),col("Status","status")]}
};
const DM_RESETS = [
  {k:"order", title:"Reset Order data", desc:"Deletes all vehicles still at Pending Order.", count:a => a.filter(v => vStage(v) === "pending").length},
  {k:"purchase", title:"Reset Purchase data", desc:"Deletes all In Transit and Free Stock vehicles.", count:a => a.filter(v => ["transit","stock"].includes(vStage(v))).length},
  {k:"sales", title:"Reset Sales data", desc:"Deletes all Tally Done and Delivered vehicles.", count:a => a.filter(v => ["bill","delivered"].includes(vStage(v))).length},
  {k:"gate", title:"Reset Gate movements", desc:"Deletes every Bhilarwadi / Branch In-Out entry and its IN photos.", table:"gate_movements"},
  {k:"imports", title:"Clear Import History", desc:"Deletes the import log only (vehicles stay).", table:"import_batches"},
  {k:"all", title:"Reset ALL data", desc:"Deletes every vehicle, delivery, gate movement and import log. Users, roles, locations and settings are kept.", count:a => a.length, danger:true}
];
async function renderDataManage(){
  if(!state.isAdmin){ renderDenied(); return; }
  const all = await allVehicles(true); await getLocations();
  $("content").innerHTML = `<div class="panel"><div class="panel-head"><h3>Data Management</h3></div>
    <p class="form-help">Select records and delete them in bulk. Order, Purchase and Sales reports all live in the same vehicle record, so deleting a row removes that vehicle from every report.</p>
    <div class="tabs">${Object.entries(DM_TABS).map(([k, t]) => `<button type="button" class="tab-btn ${k === DM.tab ? "active" : ""}" data-dmtab="${k}">${t.label} (${all.filter(t.test).length.toLocaleString("en-IN")})</button>`).join("")}</div>
    <div class="report-tools dm-tools"><input id="dmSearch" type="search" placeholder="Filter rows..." aria-label="Filter rows">
      <button class="secondary-btn" type="button" id="dmAll">☑ Select all (filtered)</button><button class="secondary-btn" type="button" id="dmNone">☐ Clear</button>
      <button class="secondary-btn" type="button" id="dmEdit">✎ Edit selected</button><button class="secondary-btn" type="button" id="dmExp">⤓ Export</button>
      <button class="secondary-btn danger" type="button" id="dmDel">🗑 Delete selected</button></div>
    <div id="dmInfo" class="form-help"></div><div id="dmList" class="table-wrap"></div></div>
    <div class="panel danger-zone"><div class="panel-head"><h3>Data Reset</h3></div><p class="form-help">Permanent. You must type RESET to confirm.</p>
      <div class="reset-grid">${DM_RESETS.map(x => { const n = x.count ? x.count(all) : null;
        return `<div class="reset-item"><b>${x.title}</b><span>${x.desc}</span><button class="secondary-btn danger" type="button" data-reset="${x.k}">${n === null ? "Reset…" : `Reset (${n.toLocaleString("en-IN")})`}</button></div>`; }).join("")}</div></div>`;
  DM.q = ""; DM.sel = new Set();
  document.querySelectorAll("[data-dmtab]").forEach(b => b.addEventListener("click", () => { DM.tab = b.dataset.dmtab; renderDataManage(); }));
  $("dmSearch").addEventListener("input", e => { DM.q = e.target.value; drawDM(all); });
  $("dmAll").onclick = () => { dmFiltered(all).forEach(v => DM.sel.add(String(v.id))); drawDM(all); };
  $("dmNone").onclick = () => { DM.sel.clear(); drawDM(all); };
  $("dmDel").onclick = () => { const vs = dmSelected(all); if(!vs.length) return toast("Select rows first.","error"); deleteVehicles(vs, renderDataManage); };
  $("dmEdit").onclick = () => { const vs = dmSelected(all); if(vs.length !== 1) return toast("Select exactly one row to edit.","error"); openVehicleEdit(vs[0], renderDataManage); };
  $("dmExp").onclick = () => { const t = DM_TABS[DM.tab], l = dmFiltered(all); if(!l.length) return toast("Nothing to export.","error");
    exportSheet("data-" + DM.tab.toLowerCase(), t.cols.map(c => c.h), l.map(r => t.cols.map(c => (c.t === "money" || c.t === "num") ? Number(r[c.k] || 0) : (r[c.k] ?? "")))); };
  document.querySelectorAll("[data-reset]").forEach(b => b.addEventListener("click", () => openResetConfirm(DM_RESETS.find(x => x.k === b.dataset.reset), all)));
  drawDM(all);
}
const dmFiltered = all => { const t = DM_TABS[DM.tab], q = DM.q.trim().toLowerCase(), base = all.filter(t.test);
  return q ? base.filter(v => t.cols.some(c => String(fmtCell(c.t, v[c.k]) ?? "").toLowerCase().includes(q))) : base; };
const dmSelected = all => all.filter(v => DM.sel.has(String(v.id)));
function drawDM(all){
  const t = DM_TABS[DM.tab], list = dmFiltered(all), LIMIT = 300;
  $("dmInfo").textContent = `${list.length.toLocaleString("en-IN")} records · ${DM.sel.size.toLocaleString("en-IN")} selected` + (list.length > LIMIT ? ` · showing first ${LIMIT} (filter, or Select all to pick every one)` : "");
  $("dmList").innerHTML = table(["✓", ...t.cols.map(c => c.h)], list.slice(0, LIMIT).map(v => [raw(`<input type="checkbox" class="dm-chk" data-id="${esc(v.id)}" ${DM.sel.has(String(v.id)) ? "checked" : ""} aria-label="Select">`), ...t.cols.map(c => c.k === "status" ? statusBadge(v[c.k]) : fmtCell(c.t, v[c.k]))]));
  $("dmList").querySelectorAll(".dm-chk").forEach(cb => cb.addEventListener("change", () => { cb.checked ? DM.sel.add(cb.dataset.id) : DM.sel.delete(cb.dataset.id); $("dmInfo").textContent = $("dmInfo").textContent.replace(/· \d[\d,]* selected/, `· ${DM.sel.size.toLocaleString("en-IN")} selected`); }));
}
function openResetConfirm(x, all){
  const n = x.count ? x.count(all) : null;
  openModal(`<div class="modal-bg"><div class="modal" role="dialog" aria-modal="true"><div class="panel-head"><h3>${esc(x.title)}</h3><button class="icon-btn" type="button" id="modalClose">×</button></div>
    <p>${esc(x.desc)}${n !== null ? ` <b>${n.toLocaleString("en-IN")} records</b> will be deleted.` : ""}</p><p class="form-help">This cannot be undone. Type <b>RESET</b> to continue.</p>
    <input id="resetText" autocomplete="off" placeholder="RESET"><div class="form-actions"><button type="button" class="secondary-btn" id="modalCancel">Cancel</button><button class="primary-btn danger-btn" type="button" id="resetGo" disabled>Delete permanently</button></div></div></div>`);
  $("modalClose").onclick = closeModal; $("modalCancel").onclick = closeModal;
  $("resetText").addEventListener("input", e => { $("resetGo").disabled = e.target.value.trim() !== "RESET"; });
  $("resetGo").onclick = async () => {
    const btn = $("resetGo"); btn.disabled = true; btn.textContent = "Deleting…";
    try { const cnt = await runReset(x, all, (d, t) => { btn.textContent = `Deleting ${d}/${t}…`; }); closeModal(); toast(`${x.title}: done${cnt ? ` (${cnt.toLocaleString("en-IN")} deleted)` : ""}.`,"success"); renderDataManage(); }
    catch(err){ btn.disabled = false; btn.textContent = "Delete permanently"; toast(err.message, "error"); }
  };
}
async function wipeTable(name){                      // every row of a table (id is never null)
  const r = await state.supabase.from(name).delete().not("id", "is", null).select("id");
  if(r.error){ if(/does not exist|schema cache/i.test(r.error.message)) return 0; throw new Error(`${name}: ${r.error.message}${dbHint(r.error)}`); }
  return r.data?.length || 0;
}
async function wipeGate(){
  const cols = "id," + IN_PHOTOS.map(p => p[0]).join(",");
  const r = await state.supabase.from("gate_movements").select(cols);
  if(!r.error && typeof removeInPhotos === "function") for(let i = 0; i < (r.data || []).length; i += 100) await removeInPhotos(r.data.slice(i, i + 100));
  return wipeTable("gate_movements");
}
async function runReset(x, all, progress){
  let n = 0;
  const byStage = stages => deleteVehicleIds(all.filter(v => stages.includes(vStage(v))).map(v => v.id), progress);
  if(x.k === "order") n = await byStage(["pending"]);
  else if(x.k === "purchase") n = await byStage(["transit","stock"]);
  else if(x.k === "sales") n = await byStage(["bill","delivered"]);
  else if(x.k === "gate") n = await wipeGate();
  else if(x.k === "imports") n = await wipeTable("import_batches");
  else if(x.k === "all"){
    await wipeTable("deliveries"); await wipeTable("vehicle_timeline"); await wipeGate(); await wipeTable("import_batches");
    n = await wipeTable("vehicles");
  }
  VCACHE.rows = null; logAudit("DATA_RESET","data",x.k,null,{count:n}); return n;
}
