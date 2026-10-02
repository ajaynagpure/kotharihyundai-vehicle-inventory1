"use strict";
/* ADMIN: users, permissions, roles, status, audit, settings */
async function renderAdmin(page){
  const sb = state.supabase, c = $("content");
  const head = t => `<div class="panel-head"><h3>${esc(t)}</h3></div>`;
  if(page === "users"){
    c.innerHTML = `<div class="panel">${head("Create User")}<form id="createUserForm" class="form-grid">
      <div><label>USERNAME</label><input name="username" required placeholder="accounts01"></div>
      <div><label>FULL NAME</label><input name="full_name" required></div>
      <div><label>PASSWORD</label><div class="password-field"><input id="newUserPassword" name="password" required type="password" minlength="6" maxlength="12" placeholder="6 to 12 characters"><button type="button" class="password-eye" data-password-toggle="newUserPassword" aria-label="Show password" title="Show password">👁</button></div></div>
      <div><label>ROLE</label><select name="role_id" id="newUserRole" required></select></div>
      <div><label>LOCATION</label><select name="location_id" id="newUserLocation" required></select></div>
      <div><label>STATUS</label><select name="active"><option value="true">Active</option><option value="false">Inactive</option></select></div>
      <div class="full form-actions"><button class="primary-btn" type="submit">Create User</button></div></form><div id="createUserMessage" class="message"></div></div>
      <div class="panel"><div class="panel-head"><h3>Users</h3></div><div id="usersTable" class="table-wrap"></div></div>
      <div class="panel" id="rolesPanel"></div><div id="modal"></div>`;
    const [roles, locs] = await Promise.all([sb.from("roles").select("id,name").order("name"), getLocations()]);
    $("newUserRole").innerHTML = `<option value="">Select role</option>` + (roles.data||[]).map(r => `<option value="${esc(r.id)}">${esc(r.name)}</option>`).join("");
    $("newUserLocation").innerHTML = `<option value="">All Locations</option>` + locs.filter(l => l.active !== false).map(l => `<option value="${esc(l.id)}">${esc(l.location_name)}</option>`).join("");
    const syncLocationRequirement = () => {
      const selectedRole = (roles.data || []).find(r => String(r.id) === $("newUserRole").value);
      const isAdminRole = String(selectedRole?.name || "").trim().toLowerCase() === "admin";
      $("newUserLocation").required = !isAdminRole;
      $("newUserLocation").options[0].textContent = isAdminRole ? "All Locations" : "Select Location";
    };
    $("newUserRole").addEventListener("change", syncLocationRequirement);
    syncLocationRequirement();
    $("createUserForm").addEventListener("submit", createUser);
    renderRolesPanel();
    return loadUsers();
  }
  if(page === "assign-roles" || page === "user-status") return renderUserEditor(page);
  if(page === "permissions") return renderPermissions();
  if(page === "audit"){
    const r = await sb.from("audit_logs").select("*").order("created_at",{ascending:false}).limit(200);
    c.innerHTML = `<div class="panel">${head("Audit Logs")}<div class="table-wrap">${r.error ? emptyState(r.error.message) :
      table(["Time","User","Action","Module","Entity","Details"], (r.data||[]).map(x => [fmtDT(x.created_at),x.actor_username,x.action,x.module,x.entity_type,x.details]))}</div></div>`;
    return;
  }
  if(page === "locations") return renderLocationsAdmin();
  if(page === "data-manage") return renderDataManage();
  if(page === "backup-restore") return renderBackupRestore();
  if(["company","import-config","system-settings"].includes(page)) return renderSettingsPage(page);
  const t = {company:"Company","import-config":"Import Configuration","system-settings":"System Settings"}[page] || "Settings";
  c.innerHTML = `<div class="panel">${head(t)}<div class="notice"><b>Kothari Hyundai</b><p>No configurable options are defined for this section yet.</p></div></div>`;
}
async function createUser(e){
  e.preventDefault();
  const f = Object.fromEntries(new FormData(e.target).entries()), msg = $("createUserMessage");
  const say = (t, cls) => { msg.textContent = t; msg.className = "message " + (cls||""); };
  if(f.password.length < 6 || f.password.length > 12) return say("Password must be 6 to 12 characters.","error");
  const roleName = $("newUserRole").selectedOptions[0]?.textContent.trim().toLowerCase();
  if(roleName !== "admin" && !f.location_id) return say("Select a location for this user.","error");
  const {data:{session}} = await state.supabase.auth.getSession();
  if(!session) return say("Session expired. Please login again.","error");
  say("Creating user…");
  try {
    const res = await fetch(`${SUPABASE_CONFIG.url}/functions/v1/create-user`, {method:"POST",
      headers:{"Content-Type":"application/json", "Authorization":`Bearer ${session.access_token}`, "apikey":SUPABASE_CONFIG.anonKey},
      body:JSON.stringify({username:normalizeUsername(f.username), full_name:f.full_name.trim(), password:f.password, role_id:f.role_id, location_id:f.location_id||null, active:f.active==="true"})});
    const out = await res.json().catch(() => ({}));
    if(!res.ok) return say(out.error || "Unable to create user.","error");
    
    const createdId = out.user?.id;
    if(createdId){
      const savePwd = await state.supabase.from("user_profiles").update({password_display:f.password}).eq("id", createdId).select("id");
      if(savePwd.error) console.warn("Password display could not be saved:", savePwd.error.message);
    }
    say(`User ${out.user?.username || f.username} created.`,"success"); toast("User created.","success"); e.target.reset(); logAudit("CREATE_USER","users","user",out.user?.id,{username:f.username}); loadUsers();
  } catch { say("Cannot reach the create-user function. Is it deployed?","error"); }
}
async function loadUsers(){
  if(!$("usersTable")) return;
  await getLocations();
  const [r, rl] = await Promise.all([state.supabase.from("user_profiles").select("id,username,full_name,password_display,active,created_at,role_id,roles(name),location_id").order("created_at",{ascending:false}),
    state.supabase.from("roles").select("id,name").order("name")]);
  const ad = state.isAdmin, list = r.data || [], roles = rl.data || [];
  const roleSel = x => raw(`<select class="inline-sel" data-u-role="${esc(x.id)}" ${ad ? "" : "disabled"}>${roles.map(o => `<option value="${esc(o.id)}" ${o.id === x.role_id ? "selected" : ""}>${esc(o.name)}</option>`).join("")}</select>`);
  const statSel = x => raw(`<select class="inline-sel" data-u-active="${esc(x.id)}" ${ad ? "" : "disabled"}><option value="true" ${x.active === false ? "" : "selected"}>Active</option><option value="false" ${x.active === false ? "selected" : ""}>Inactive</option></select>`);
  const pwdCell = x => raw(`<div class="password-field table-password"><input id="pwd_${esc(x.id)}" type="password" value="${esc(x.password_display || "")}" placeholder="Not available" readonly><button type="button" class="password-eye" data-password-toggle="pwd_${esc(x.id)}" aria-label="Show password" title="Show password">👁</button></div>`);
  $("usersTable").innerHTML = r.error ? emptyState(r.error.message) :
    table(["Username","Name","Password","Role","Location","Status","Created",...(ad ? ["Action"] : [])], list.map((x,i) => [x.username,x.full_name,pwdCell(x),roleSel(x),x.location_id?locName(x.location_id):"All Locations",statSel(x),fmtDT(x.created_at),
      ...(ad ? [raw(`<button class="table-icon-btn" type="button" data-user-edit="${i}" title="Edit">✎</button><button class="table-icon-btn danger" type="button" data-user-del="${i}" title="Delete user">🗑</button>`)] : [])]));
  const box = $("usersTable");
  box.querySelectorAll("[data-password-toggle]").forEach(b => b.addEventListener("click", () => {
    const input = document.getElementById(b.dataset.passwordToggle);
    if(!input) return;
    input.type = input.type === "password" ? "text" : "password";
    b.setAttribute("aria-label", input.type === "password" ? "Show password" : "Hide password");
    b.title = input.type === "password" ? "Show password" : "Hide password";
  }));
  box.querySelectorAll("[data-user-edit]").forEach(b => b.addEventListener("click", () => openUserEdit(list[+b.dataset.userEdit])));
  box.querySelectorAll("[data-user-del]").forEach(b => b.addEventListener("click", () => deleteUser(list[+b.dataset.userDel])));
  // Assign role / user status right in the list (saves instantly)
  const quick = (sel, mk) => box.querySelectorAll(sel).forEach(s => s.addEventListener("change", async () => {
    const id = s.dataset.uRole || s.dataset.uActive, patch = mk(s.value);
    if(state.user?.id === id && patch.active === false){ toast("You cannot deactivate yourself.","error"); return loadUsers(); }
    const x = await state.supabase.from("user_profiles").update(patch).eq("id", id).select("id");
    if(x.error || !x.data?.length){ toast(x.error ? x.error.message : "Not saved — only Admin can edit users.","error"); return loadUsers(); }
    logAudit("UPDATE_USER","users","user",id,patch); toast("Saved.","success");
  }));
  quick("[data-u-role]", v => ({role_id:v}));
  quick("[data-u-active]", v => ({active:v === "true"}));
}
async function deleteUser(u){
  if(!u) return;
  if(state.user?.id === u.id) return toast("You cannot delete yourself.","error");
  if(!confirm(`Delete user "${u.username}"?\n\nThe login is removed permanently. This cannot be undone.\n(To stop access but keep the user, set Status to Inactive instead.)`)) return;
  const {data:{session}} = await state.supabase.auth.getSession();
  if(!session) return toast("Session expired. Please login again.","error");
  try {
    // Delete the Supabase Auth account through the admin-only database RPC.
    // This removes auth.users and cascades to public.user_profiles.
    const {data, error} = await state.supabase.rpc("delete_user_account", {target_user_id: u.id});
    if(error) return toast(error.message || "Unable to delete user.","error");
    if(data !== true) return toast("User was not deleted. Only Admin can delete users.","error");
  } catch (err) {
    return toast("Unable to delete user: " + (err?.message || "unknown error"),"error");
  }
  logAudit("DELETE_USER","users","user",u.id,{username:u.username}); toast(`User ${u.username} deleted.`,"success"); loadUsers();
}
async function renderUserEditor(page){
  const sb = state.supabase, byRole = page === "assign-roles";
  const [u, roles] = await Promise.all([sb.from("user_profiles").select("id,username,full_name,active,role_id,roles(name)").order("username"), sb.from("roles").select("id,name").order("name")]);
  if(u.error) { $("content").innerHTML = `<div class="panel">${emptyState(u.error.message)}</div>`; return; }
  const opts = id => (roles.data||[]).map(r => `<option value="${esc(r.id)}" ${r.id===id?"selected":""}>${esc(r.name)}</option>`).join("");
  $("content").innerHTML = `<div class="panel"><div class="panel-head"><h3>${byRole?"Assign Roles":"User Status"}</h3></div><div class="table-wrap"><table><thead><tr><th>Username</th><th>Name</th><th>${byRole?"Role":"Status"}</th></tr></thead><tbody>${
    (u.data||[]).map(x => `<tr><td>${esc(x.username)}</td><td>${esc(x.full_name||"-")}</td><td>${byRole ?
      `<select data-uid="${esc(x.id)}">${opts(x.role_id)}</select>` :
      `<select data-uid="${esc(x.id)}"><option value="true" ${x.active!==false?"selected":""}>Active</option><option value="false" ${x.active===false?"selected":""}>Inactive</option></select>`}</td></tr>`).join("")}</tbody></table></div></div>`;
  $("content").querySelectorAll("select[data-uid]").forEach(s => s.addEventListener("change", async () => {
    const patch = byRole ? {role_id:s.value} : {active:s.value==="true"};
    if(state.user?.id === s.dataset.uid && !byRole && !patch.active){ toast("You cannot deactivate yourself.","error"); return renderUserEditor(page); }
    const {error} = await sb.from("user_profiles").update(patch).eq("id", s.dataset.uid);
    if(error) toast(error.message,"error"); else { toast("Saved.","success"); logAudit("UPDATE_USER","users","user",s.dataset.uid,patch); }
  }));
}
async function renderPermissions(){
  const sb = state.supabase;
  const [roles, perms, rp] = await Promise.all([sb.from("roles").select("id,name").order("name"), sb.from("permissions").select("id,code,description").order("code"), sb.from("role_permissions").select("role_id,permission_id")]);
  const err = roles.error || perms.error || rp.error;
  if(err){ $("content").innerHTML = `<div class="panel">${emptyState(err.message)}</div>`; return; }
  const grantsByRole = new Map();
  (rp.data||[]).forEach(x => {
    if(!grantsByRole.has(x.role_id)) grantsByRole.set(x.role_id, new Set());
    grantsByRole.get(x.role_id).add(x.permission_id);
  });
  const editable = (roles.data||[]).filter(r => String(r.name).toLowerCase() !== "admin");
  const defaultsForRole = role => DEFAULT_PERMS[String(role.name).toLowerCase()] || DEFAULT_PERMS.viewer;
  const roleHasPermission = (role, permission) => {
    const grants = grantsByRole.get(role.id);
    if(grants?.size) return grants.has(permission.id);
    return defaultsForRole(role).includes(permission.code);
  };
  $("content").innerHTML = `<div class="panel"><div class="panel-head"><h3>Permissions</h3></div><p class="form-help">Admin always has full access. Tick to allow; changes save instantly.</p><div class="table-wrap"><table><thead><tr><th>Permission</th>${editable.map(r => `<th>${esc(r.name)}</th>`).join("")}</tr></thead><tbody>${
    (perms.data||[]).map(p => `<tr><td title="${esc(p.description||"")}">${esc(p.code)}</td>${editable.map(r => `<td><input type="checkbox" data-r="${esc(r.id)}" data-p="${esc(p.id)}" ${roleHasPermission(r,p)?"checked":""}></td>`).join("")}</tr>`).join("")}</tbody></table></div></div>`;
  $("content").querySelectorAll("input[data-r]").forEach(cb => cb.addEventListener("change", async () => {
    const role = editable.find(r => r.id === cb.dataset.r), permission = (perms.data||[]).find(p => p.id === cb.dataset.p);
    if(!role || !permission) return;
    const grants = grantsByRole.get(role.id);
    let q, seededGrants = null;
    if(grants?.size){
      q = cb.checked ? sb.from("role_permissions").insert({role_id:role.id, permission_id:permission.id})
        : sb.from("role_permissions").delete().eq("role_id",role.id).eq("permission_id",permission.id);
    } else {
      const effective = new Set(defaultsForRole(role));
      if(cb.checked) effective.add(permission.code); else effective.delete(permission.code);
      const rows = [...effective].map(code => (perms.data||[]).find(p => p.code === code))
        .filter(Boolean).map(p => ({role_id:role.id, permission_id:p.id}));
      seededGrants = new Set(rows.map(p => p.permission_id));
      q = sb.from("role_permissions").insert(rows);
    }
    const {error} = await q;
    if(error){ toast(error.message,"error"); cb.checked = !cb.checked; }
    else {
      if(seededGrants) grantsByRole.set(role.id,seededGrants);
      else if(cb.checked) grantsByRole.get(role.id).add(permission.id);
      else grantsByRole.get(role.id).delete(permission.id);
      logAudit("PERMISSION","permissions","role",cb.dataset.r,{permission:permission.code, allowed:cb.checked});
      toast("Permission saved.","success");
    }
  }));
}
