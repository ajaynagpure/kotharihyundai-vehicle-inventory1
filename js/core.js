"use strict";
/* =====================================================================
   CORE: menu, permissions, helpers, auth, navigation, page routing
   ===================================================================== */

const MENU = [
  {section:"MAIN", items:[["dashboard","Dashboard","▦"]], collapsible:false},
  {section:"VEHICLE MANAGEMENT", items:[
    ["vehicles","Vehicle Stock","▤"],["search","Search by Chassis / VIN","⌕"],
    ["status","Current Status","◉"],["timeline","View Timeline","◷"],
    ["documents","Bhilarwadi Documents","▣"]
  ]},
  {section:"DATA IMPORT", items:[
    ["order-import","Order Report Import","⇧"],["purchase-import","Purchase Report Import","⇧"],
    ["sales-import","Sales Report Import","⇧"],["import-data","Imported Data","☰"],["import-history","Import History","≡"]
  ]},
  {section:"GATE MANAGEMENT", items:[
    ["bhilarwadi","Bhilarwadi In","⇄"],["gate","Branch Vehicle In / Out","⇄"],
    ["gate-pass","Gate Pass","▣"],["register","In-Out Register","☷"]
  ]},
  {section:"DELIVERY", items:[
    ["delivery-entry","Delivery Entry","✓"],["delivered","Delivered Vehicles","✓"],["delivery-history","Delivery History","◷"]
  ]},
  {section:"REPORTS", items:[
    ["location-report","Location wise Stock","▥"],["model-report","Model wise Stock","▥"],
    ["finance-report","Finance wise Free Stock","₹"],["aging-report","Aging Report","◴"],["delivery-report","Delivery Report","✓"],
    ["pending-report","Pending Order Report","!"],["transit-report","In Transit Report","→"],["arriving-report","Arriving Vehicles","↗"],["gate-report","Gate Movement Report","⇄"],
    ["dealer-report","Dealer Code wise Free Stock","▥"]
  ]},
  {section:"ADMINISTRATION", items:[
    ["users","Users & Roles","♙"],["permissions","Permissions","⚿"],
    ["audit","Audit Logs","⌁"],
    ["data-manage","Data Management","⛁"]
  ]},
  {section:"SETTINGS", items:[
    ["company","Company","⌂"],["locations","Locations","⌖"],
    ["import-config","Import Configuration","⚙"],["system-settings","System Settings","⚙"]
  ]}
];

/* ---- Permissions -------------------------------------------------------
   Codes match public.permissions (ADMIN_FEATURES.sql). Admin always has all.
   If a role has NO rows in role_permissions, DEFAULT_PERMS below is used, so
   nobody is locked out before the Permissions screen is configured.        */
const ALL_PERMS = ["dashboard.view","vehicle.view","vehicle.update","import.order","import.purchase","import.sales",
  "gate.inout","gate.pass","delivery.manage","reports.view","value.view","users.manage","permissions.manage","settings.manage"];

const PAGE_PERM = {
  dashboard:"dashboard.view",
  vehicles:"vehicle.view", search:"vehicle.view", status:"vehicle.view", timeline:"vehicle.view", documents:"vehicle.view",
  "order-import":"import.order", "purchase-import":"import.purchase", "sales-import":"import.sales",
  "import-history":["import.order","import.purchase","import.sales"], "import-data":["import.order","import.purchase","import.sales"],
  bhilarwadi:"gate.inout", gate:"gate.inout", register:"gate.inout", "gate-pass":"gate.pass",
  "delivery-entry":"delivery.manage", delivered:"delivery.manage", "delivery-history":"delivery.manage",
  users:"users.manage", "assign-roles":"users.manage", "user-status":"users.manage", audit:"users.manage",
  permissions:"permissions.manage",
  company:"settings.manage", locations:"settings.manage", "import-config":"settings.manage", "system-settings":"settings.manage"
};
MENU.find(g => g.section === "REPORTS").items.forEach(([id]) => { PAGE_PERM[id] = "reports.view"; });

const DEFAULT_PERMS = {
  accounts: ["dashboard.view","vehicle.view","vehicle.update","import.order","import.purchase","import.sales",
             "gate.inout","gate.pass","delivery.manage","reports.view","value.view"],
  "gate operator": ["gate.inout","gate.pass"],
  "security guard": ["gate.inout"],
  viewer: ["dashboard.view","reports.view"],
  owner: ["dashboard.view","reports.view","value.view"]
};

const state = {
  page:"dashboard", user:null, profile:null, role:"", isAdmin:false, perms:new Set(),
  supabase:null, connected:false, locations:null, gateSelectedVehicleId:null
};

const ADMIN_ONLY = new Set(["data-manage"]);          // Delete / Reset tools: Admin role only
function can(page){
  if(state.isAdmin) return true;
  if(ADMIN_ONLY.has(page)) return false;
  const need = PAGE_PERM[page];
  if(!need) return false;
  return (Array.isArray(need) ? need : [need]).some(c => state.perms.has(c));
}
function hasPerm(code){ return state.isAdmin || state.perms.has(code); }

/* ---- Small helpers ------------------------------------------------------ */
const $ = id => document.getElementById(id);
const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
class Raw { constructor(html){ this.html = html; } }
const raw = html => new Raw(html);                 // mark trusted HTML for table cells
const isBlank = v => v === null || v === undefined || v === "";
const store = {
  get(k){ try { return localStorage.getItem(k); } catch { return null; } },
  set(k,v){ try { localStorage.setItem(k,v); } catch { /* private mode */ } }
};

function cell(v){ return v instanceof Raw ? v.html : (isBlank(v) ? "-" : esc(v)); }
function table(headers, rows, footer){
  if(!rows.length) return emptyState("No records found.");
  const foot = footer ? `<tfoot><tr>${footer.map(c => `<td>${cell(c)}</td>`).join("")}</tr></tfoot>` : "";
  return `<table><thead><tr>${headers.map((h,i) => `<th scope="col" ${String(h).trim() && !["✓","Edit","Action"].includes(String(h).trim()) ? `data-sort-index="${i}" tabindex="0" aria-sort="none"` : ""}>${esc(h)}</th>`).join("")}</tr></thead><tbody>${
    rows.map(r => `<tr>${r.map(c => `<td>${cell(c)}</td>`).join("")}</tr>`).join("")}</tbody>${foot}</table>`;
}
const PAGED_TABLE_SORT = new WeakMap();
const tableSortCollator = new Intl.Collator("en", {numeric:true, sensitivity:"base"});
function tableSortText(value){
  if(value instanceof Raw){ const t = document.createElement("template"); t.innerHTML = value.html; return t.content.textContent.trim(); }
  return String(value ?? "").trim();
}
function tableSortValue(value, heading){
  const text = tableSortText(value);
  if(!text || text === "-") return {type:0, value:""};
  if(/date|time/i.test(heading)){
    const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:,\s*(\d{1,2}):(\d{2})\s*(am|pm))?$/i.exec(text);
    if(m){ let hour = Number(m[4] || 0); const period = (m[6] || "").toLowerCase();
      if(period === "pm" && hour < 12) hour += 12; if(period === "am" && hour === 12) hour = 0;
      const d = new Date(Number(m[3]),Number(m[2])-1,Number(m[1]),hour,Number(m[5] || 0));
      if(d.getFullYear() === Number(m[3]) && d.getMonth() === Number(m[2])-1 && d.getDate() === Number(m[1])) return {type:1, value:d.getTime()}; }
    const d = Date.parse(text); if(!Number.isNaN(d)) return {type:1, value:d};
  }
  const m = /^(-?\d+(?:\.\d+)?)\s*(Cr|L|K)?%?$/i.exec(text.replace(/[₹,\s]/g,""));
  if(m){ const scale = {cr:1e7,l:1e5,k:1e3}; return {type:2, value:Number(m[1]) * (scale[(m[2] || "").toLowerCase()] || 1)}; }
  return {type:3, value:text};
}
function compareTableValues(a,b,heading,direction){
  const x = tableSortValue(a,heading), y = tableSortValue(b,heading);
  if(x.type !== y.type) return (x.type - y.type) * direction;
  const cmp = x.type === 3 ? tableSortCollator.compare(x.value,y.value) : x.value < y.value ? -1 : x.value > y.value ? 1 : 0;
  return cmp * direction;
}
function tableHeaderIndex(th){
  const explicit = Number(th.dataset.sortIndex); if(th.dataset.sortIndex !== undefined && Number.isInteger(explicit)) return explicit;
  const head = th.closest("thead"); if(!head) return th.cellIndex;
  const occupied = [];
  for(let r=0;r<head.rows.length;r++){
    occupied[r] ||= []; let c=0;
    for(const cell of head.rows[r].cells){
      while(occupied[r][c]) c++;
      const start=c, rs=cell.rowSpan || 1, cs=cell.colSpan || 1;
      for(let rr=r;rr<Math.min(head.rows.length,r+rs);rr++){ occupied[rr] ||= []; for(let cc=start;cc<start+cs;cc++) occupied[rr][cc]=true; }
      if(cell === th) return start;
      c += cs;
    }
  }
  return th.cellIndex;
}
function sortTableByHeader(th){
  const tableEl = th.closest("table"), heading = th.textContent.trim(); if(!tableEl || !heading || ["✓","edit","action"].includes(heading.toLowerCase())) return;
  const index = tableHeaderIndex(th), direction = th.dataset.sortDirection === "asc" ? "desc" : "asc", sign = direction === "asc" ? 1 : -1;
  tableEl.querySelectorAll("thead th").forEach(h => { h.removeAttribute("data-sort-direction"); h.setAttribute("aria-sort","none"); });
  th.dataset.sortIndex = String(index); th.dataset.sortDirection = direction; th.setAttribute("aria-sort", direction === "asc" ? "ascending" : "descending");
  const paged = PAGED_TABLE_SORT.get(tableEl);
  if(paged){ paged.setSort(index, sign); return; }
  const body = tableEl.tBodies[0]; if(!body) return;
  [...body.rows].map((row,i) => ({row,i})).sort((a,b) => compareTableValues(a.row.cells[index]?.textContent,b.row.cells[index]?.textContent,heading,sign) || a.i-b.i).forEach(x => body.appendChild(x.row));
}
document.addEventListener("click", e => { const th=e.target.closest?.("th"); if(th) sortTableByHeader(th); });
document.addEventListener("keydown", e => { const th=e.target.closest?.("th"); if(th && (e.key === "Enter" || e.key === " ")){ e.preventDefault(); sortTableByHeader(th); } });
function emptyState(text){ return `<div class="empty-state"><div class="empty-icon">⌁</div><p>${esc(text)}</p></div>`; }
// Short Indian format for dashboard cards: 22,06,743.96 -> ₹ 22.07 L, 1,25,00,000 -> ₹ 1.25 Cr
function moneyShort(v){
  if(!hasPerm("value.view")) return "—";
  const n = Number(v || 0), a = Math.abs(n), s = n < 0 ? "-" : "", f = (x, u) => `${s}₹ ${Number(x.toFixed(2))} ${u}`;
  if(a >= 1e7) return f(a / 1e7, "Cr"); if(a >= 1e5) return f(a / 1e5, "L"); if(a >= 1e3) return f(a / 1e3, "K");
  return `${s}₹ ${Math.round(a).toLocaleString("en-IN")}`;
}
function money(v){ return hasPerm("value.view") ? "₹ " + Number(v || 0).toLocaleString("en-IN",{minimumFractionDigits:2,maximumFractionDigits:2}) : "—"; }
function fmtDT(v){
  if(!v) return "-";
  const d = new Date(v); if(isNaN(d)) return String(v);
  return `${fmtD(d)}, ${d.toLocaleTimeString("en-IN",{hour:"2-digit",minute:"2-digit",hour12:true})}`;
}
function fmtD(v){
  if(!v) return "-";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v));
  const d = m ? new Date(+m[1], +m[2]-1, +m[3]) : new Date(v);   // date-only values must not shift with timezone
  return isNaN(d) ? String(v) : `${String(d.getDate()).padStart(2,"0")}/${String(d.getMonth()+1).padStart(2,"0")}/${d.getFullYear()}`;
}
function todayLocal(){
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}
function fmtCell(type, v){
  if(isBlank(v)) return "-";
  switch(type){
    case "money": return money(v);
    case "num": return Number(v).toLocaleString("en-IN");
    case "date": return fmtD(v);
    case "datetime": return fmtDT(v);
    default: return v;
  }
}
function statusClass(s){
  const k = String(s || "").toLowerCase();
  if(k.includes("pending")) return "warn";
  if(k.includes("transit")) return "info";
  if(k.includes("tally") || /not[\s\-_\/]*deliver|undeliver/.test(k) || k.includes("bill") || k.includes("sales") || k.includes("sold")) return "purple";   // Tally Done
  if(k.includes("deliver")) return "ok";
  return "";
}
function statusBadge(s){ return raw(`<span class="badge ${statusClass(s)}">${esc(s || "-")}</span>`); }
// PostgREST .or()/.ilike values: remove characters that break the filter grammar
function cleanQuery(q){ return String(q || "").replace(/[,()%*\\:"']/g," ").replace(/\s+/g," ").trim(); }

/* "Saved" feedback: the Save / Import / Done button that was just pressed turns into "✓ Saved" for 2.5 s after a success toast. */
let lastSaveBtn = null, lastSaveAt = 0;
document.addEventListener("click", e => { const b = e.target.closest?.("button"); if(b && /save|import|done|update|apply/i.test(b.textContent || "")){ lastSaveBtn = b; lastSaveAt = Date.now(); } }, true);
document.addEventListener("submit", e => { const b = e.submitter || e.target.querySelector?.('button[type="submit"],button:not([type])'); if(b){ lastSaveBtn = b; lastSaveAt = Date.now(); } }, true);
function markSaved(){
  const b = lastSaveBtn; if(!b || Date.now() - lastSaveAt > 60000 || b.dataset.savedShown) return;
  setTimeout(() => {                                   // after the handler's own "finally" has restored the label
    if(!b.isConnected || b.dataset.savedShown) return;
    const orig = b.textContent; b.dataset.savedShown = "1"; b.textContent = /import/i.test(orig) ? "✓ Imported" : "✓ Saved"; b.classList.add("is-saved");
    setTimeout(() => { if(b.isConnected){ b.textContent = orig; b.classList.remove("is-saved"); } delete b.dataset.savedShown; }, 2500);
  }, 80);
  lastSaveBtn = null;
}
function toast(msg, type = "info"){
  if(type === "success") markSaved();
  let box = $("toastBox");
  if(!box){
    box = document.createElement("div");
    box.id = "toastBox"; box.setAttribute("role","status"); box.setAttribute("aria-live","polite");
    document.body.appendChild(box);
  }
  const t = document.createElement("div");
  t.className = "toast " + type; t.textContent = msg;
  box.appendChild(t);
  setTimeout(() => t.remove(), type === "error" ? 7000 : 3500);
}

async function fetchAll(build, {page = 1000, max = 20000} = {}){
  const out = [];
  for(let from = 0; from < max; from += page){
    const {data, error} = await build().range(from, from + page - 1);
    if(error) throw error;
    out.push(...(data || []));
    if(!data || data.length < page) break;
  }
  return out;
}
async function getLocations(force = false){
  if(state.locations && !force) return state.locations;
  const r = await state.supabase.from("locations").select("id,location_name,location_code,active").order("location_name");
  state.locations = r.error ? [] : (r.data || []).sort((a,b) => compareLocationNames(a.location_name,b.location_name));
  return state.locations;
}
const LOCATION_PRIORITY = ["Bhilarwadi","SSRD","Kharadi","Aundh","Khedshivapur","Shirur","Fatimanagar","Kondhwa","Bhosari","Hadapsar"];
const LOCATION_RANK = new Map(LOCATION_PRIORITY.map((name,index) => [name.toLowerCase(),index]));
function compareLocationNames(a,b){
  const x = String(a || "").trim(), y = String(b || "").trim(), xi = LOCATION_RANK.get(x.toLowerCase()), yi = LOCATION_RANK.get(y.toLowerCase());
  if(xi !== undefined || yi !== undefined) return (xi ?? Infinity) - (yi ?? Infinity);
  return x.localeCompare(y);
}
const sortLocationNames = names => [...names].sort(compareLocationNames);
function locName(id){ return state.locations?.find(l => l.id === id)?.location_name || "-"; }

function exportSheet(filename, headers, rows){
  if(!window.XLSX){ toast("Excel library not loaded (check internet).","error"); return; }
  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Data");
  XLSX.writeFile(wb, `${filename}-${todayLocal()}.xlsx`);
}
// Shared by dashboard windows, gate edit dialogs, IN-details. Creates #modal if the page has none.
function openModal(html){ let m = $("modal"); if(!m){ m = document.createElement("div"); m.id = "modal"; document.body.appendChild(m); } m.innerHTML = html; }
function closeModal(){ const m = $("modal"); if(m) m.innerHTML = ""; }
async function logAudit(action, module, entityType, entityId, details){   // best effort; only Admin can insert (RLS)
  try {
    await state.supabase.from("audit_logs").insert({
      actor_id: state.user?.id, actor_username: state.profile?.username || null, action, module,
      entity_type: entityType || null, entity_id: entityId ? String(entityId) : null,
      details: details ? JSON.stringify(details) : null
    });
  } catch { /* ignore */ }
}

/* ---- Auth ---------------------------------------------------------------- */
function supabaseReady(){
  const c = window.SUPABASE_CONFIG;
  return c && c.url && c.anonKey && !c.url.startsWith("YOUR_") && !c.anonKey.startsWith("YOUR_") && window.supabase;
}
function normalizeUsername(v){ return String(v || "").trim().toLowerCase().replace(/\s+/g,""); }
function usernameToAuthEmail(username){
  const u = normalizeUsername(username);
  const map = (window.APP_CONFIG && window.APP_CONFIG.usernameEmailMap) || {};
  if(map[u]) return map[u];                              // bootstrap Admin account
  return `${u}@login.kotharihyundai.local`;              // users created by the create-user Edge Function
}
function setConnection(ok){
  $("connectionDot").className = "dot " + (ok ? "online" : "offline");
  $("connectionText").textContent = ok ? "Supabase connected" : "Supabase not configured";
}
function setLoginMessage(text, type){ const el = $("loginMessage"); el.textContent = text; el.className = "message" + (type ? " " + type : ""); }

async function init(){
  // Bind UI first: a slow getSession() must never leave the form unbound (form would reload the page).
  $("loginForm").addEventListener("submit", login);
  $("logoutBtn").addEventListener("click", logout);
  $("refreshBtn").addEventListener("click", () => loadPage(state.page));
  $("mobileMenu").addEventListener("click", () => document.querySelector(".sidebar").classList.toggle("open"));
  document.addEventListener("click", e => {
    const sb = document.querySelector(".sidebar");
    if(sb.classList.contains("open") && !e.target.closest(".sidebar, #mobileMenu")) sb.classList.remove("open");
  });

  if(!supabaseReady()){ setConnection(false); return; }
  state.supabase = window.supabase.createClient(SUPABASE_CONFIG.url, SUPABASE_CONFIG.anonKey);
  state.connected = true;
  setConnection(true);

  // Do NOT await Supabase calls inside this callback (supabase-js can deadlock) — defer with setTimeout.
  state.supabase.auth.onAuthStateChange((event, session) => {
    setTimeout(() => {
      if(event === "SIGNED_OUT") { showLogin(); return; }
      if(session && (event === "SIGNED_IN" || event === "INITIAL_SESSION") && state.user?.id !== session.user.id) showApp(session.user);
      // TOKEN_REFRESHED / USER_UPDATED intentionally do nothing: they must not reset the current page.
    }, 0);
  });
  const {data:{session}} = await state.supabase.auth.getSession();
  if(session && state.user?.id !== session.user.id) showApp(session.user);
}

async function login(e){
  e.preventDefault();
  const username = normalizeUsername($("username").value);
  const password = $("password").value;
  const btn = e.target.querySelector("button[type=submit]");
  if(!state.supabase){ setLoginMessage("Supabase is not configured. Add your project URL and publishable key in js/config.js.","error"); return; }
  if(!username || !password){ setLoginMessage("Enter username and password.","error"); return; }
  if(username === "admin2"){ setLoginMessage("This username is not allowed to login.","error"); return; }
  btn.disabled = true;
  setLoginMessage("Signing in...");
  try {
    let authEmail = usernameToAuthEmail(username);
    try {
      const lookup = await state.supabase.rpc("get_login_email", {p_username: username});
      if(!lookup.error && lookup.data) authEmail = lookup.data;
    } catch (_) {}
    const {data, error} = await state.supabase.auth.signInWithPassword({email: authEmail, password});
    if(error){
      setLoginMessage(error.status && error.status < 500 && error.status !== 0 ? "Invalid username or password." : "Cannot reach the server. Check internet and try again.","error");
      return;
    }
    $("password").value = "";
    showApp(data.user);
  } catch(err){
    setLoginMessage("Cannot reach the server. Check internet and try again.","error");
  } finally { btn.disabled = false; }
}
async function logout(){
  if(state.supabase) await state.supabase.auth.signOut();
  showLogin();
}
function showLogin(){
  state.user = null; state.profile = null; state.role = ""; state.isAdmin = false; state.perms = new Set(); state.locations = null; state.settings = null;
  $("loginView").classList.remove("hidden");
  $("appView").classList.add("hidden");
  $("content").innerHTML = "";
}

async function showApp(user){
  state.user = user;
  $("loginView").classList.add("hidden");
  $("appView").classList.remove("hidden");
  let displayName = user.user_metadata?.full_name || user.user_metadata?.username || "User";
  try {
    const p = await state.supabase.from("user_profiles")
      .select("username,full_name,active,role_id,location_id,roles(name)").eq("id", user.id).maybeSingle();
    if(p.error) console.warn(p.error.message);
    if(p.data){
      if(p.data.active === false){
        await state.supabase.auth.signOut();
        showLogin();
        setLoginMessage("This user is inactive. Contact Admin.","error");
        return;
      }
      displayName = p.data.full_name || p.data.username || displayName;
      state.profile = p.data;
      state.role = p.data.roles?.name || "";
    }
  } catch(err){ console.warn(err); }

  await loadPermissions();
  if(typeof loadSettings === "function") await loadSettings();
  $("userName").textContent = displayName;
  $("userName").title = state.role || "No role";
  renderNav();
  const first = firstAllowedPage();
  if(first) navigate(first);
  else $("content").innerHTML = `<div class="panel"><div class="notice"><b>No access</b><p>Your account has no role or permissions yet. Contact Admin.</p></div></div>`;
}

async function loadPermissions(){
  const role = String(state.role || "").trim().toLowerCase();
  state.isAdmin = role === "admin";
  if(state.isAdmin){ state.perms = new Set(ALL_PERMS); return; }
  let codes = [];
  if(state.profile?.role_id){
    const r = await state.supabase.from("role_permissions").select("permissions(code)").eq("role_id", state.profile.role_id);
    if(!r.error) codes = (r.data || []).map(x => x.permissions?.code).filter(Boolean);
  }
  if(!codes.length) codes = DEFAULT_PERMS[role] || DEFAULT_PERMS.viewer;
  state.perms = new Set(codes);
}
function firstAllowedPage(){
  for(const g of MENU) for(const [id] of g.items) if(can(id)) return id;
  return null;
}

/* ---- Navigation ---------------------------------------------------------- */
function renderNav(){
  const groups = MENU.map(g => ({...g, items: g.items.filter(([id]) => can(id))})).filter(g => g.items.length);
  $("nav").innerHTML = groups.map((group, gi) => {
    const key = "nav-open-" + group.section.replace(/\W+/g,"-").toLowerCase();
    const collapsible = group.collapsible !== false && group.items.length > 0;
    return `<div class="nav-group ${collapsible ? "nav-collapsible" : ""}" data-nav-group="${key}">
      <button class="nav-label nav-label-btn ${collapsible ? "" : "main-direct"}" type="button" data-nav-toggle="${key}" ${collapsible ? 'aria-expanded="false"' : "disabled"}>
        <span class="nav-section-title">${esc(group.section)}</span>${collapsible ? '<span class="nav-chevron">⌄</span>' : ""}
      </button>
      <div class="nav-submenu" data-nav-submenu="${key}">
        ${group.items.map(([id,label,icon]) => `<button class="nav-item" type="button" data-page="${id}" title="${esc(label)}"><span class="nav-item-icon">${icon}</span><span class="nav-item-text">${esc(label)}</span></button>`).join("")}
      </div></div>`;
  }).join("");

  const collapsibles = [...document.querySelectorAll(".nav-collapsible")];
  const setOpen = (g, open) => {
    g.classList.toggle("collapsed", !open);
    g.querySelector("[data-nav-toggle]")?.setAttribute("aria-expanded", String(open));
  };
  collapsibles.forEach(g => setOpen(g, store.get(g.dataset.navGroup) === "1"));
  collapsibles.forEach(g => g.querySelector("[data-nav-toggle]").addEventListener("click", () => {
    const willOpen = g.classList.contains("collapsed");
    collapsibles.forEach(x => { setOpen(x, x === g ? willOpen : false); store.set(x.dataset.navGroup, x === g && willOpen ? "1" : "0"); });
  }));
  document.querySelectorAll(".nav-item").forEach(btn => btn.addEventListener("click", () => navigate(btn.dataset.page)));
}
function navActive(){
  document.querySelectorAll(".nav-item").forEach(x => x.classList.toggle("active", x.dataset.page === state.page));
}
// Use navigate() (not loadPage) from buttons/links: it also syncs the sidebar highlight and open section.
function navigate(page){
  if(!can(page)){ renderDenied(); return; }
  state.page = page;
  const btn = document.querySelector(`.nav-item[data-page="${page}"]`);
  const parent = btn?.closest(".nav-collapsible");
  if(btn){                                   // Dashboard (no parent group) closes every section
    document.querySelectorAll(".nav-collapsible").forEach(g => {
      const open = g === parent;
      g.classList.toggle("collapsed", !open);
      g.querySelector("[data-nav-toggle]")?.setAttribute("aria-expanded", String(open));
      store.set(g.dataset.navGroup, open ? "1" : "0");
    });
  }
  document.querySelector(".sidebar")?.classList.remove("open");
  return loadPage(page);
}
function renderDenied(){
  $("content").innerHTML = `<div class="panel"><div class="notice"><b>Access denied</b><p>Your role does not have permission for this page.</p></div></div>`;
}

async function loadPage(page){
  state.page = page;
  navActive();
  if(!can(page)){ renderDenied(); return; }
  const item = MENU.flatMap(x => x.items).find(x => x[0] === page);
  $("pageTitle").textContent = item?.[1] || "Dashboard";
  $("pageSubtitle").textContent = "Kothari Hyundai • Live Vehicle Inventory";
  $("content").scrollTop = 0; window.scrollTo(0, 0);
  try {
    if(page === "dashboard") return await renderDashboard();
    if(["vehicles","search","status"].includes(page)) return await renderVehicles(page);
    if(page === "timeline") return await renderTimeline();
    if(page === "documents") return await renderDocuments();
    if(["order-import","purchase-import","sales-import","import-history","import-data"].includes(page)) return await renderImport(page);
    if(["bhilarwadi","gate","gate-pass","register"].includes(page)) return await renderGate(page);
    if(["delivery-entry","delivered","delivery-history"].includes(page)) return await renderDelivery(page);
    if(page.endsWith("-report")) return await renderReport(page);
    return await renderAdmin(page);
  } catch(err){
    console.error(err);
    $("content").innerHTML = `<div class="panel">${emptyState("Could not load this page: " + (err.message || err))}</div>`;
  }
}

function initPasswordEyes(){
  document.getElementById("profileBtn")?.addEventListener("click", openProfileMenu);
  document.addEventListener("click", e => {
    const b = e.target.closest("[data-password-toggle]");
    if(!b) return;
    const input = document.getElementById(b.dataset.passwordToggle);
    if(!input) return;
    input.type = input.type === "password" ? "text" : "password";
    b.textContent = input.type === "password" ? "👁" : "🙈";
    b.title = input.type === "password" ? "Show password" : "Hide password";
  });
}

function openProfileMenu(){
  const wrap = document.createElement("div");
  wrap.id = "profileMenuModal";
  const username = state.profile?.username || state.user?.user_metadata?.username || "";
  const name = state.profile?.full_name || "";
  wrap.innerHTML = `<div class="modal-bg"><div class="modal profile-menu"><div class="panel-head"><h3>Profile</h3><button class="icon-btn" type="button" id="profileClose">×</button></div><div class="profile-meta">${esc(username)}${state.role ? " • " + esc(state.role) : ""}</div><button type="button" class="profile-option" id="openProfileEdit">👤 Profile</button><button type="button" class="profile-option" id="openProfilePassword">🔒 Change Password</button></div></div>`;
  document.body.appendChild(wrap);
  const close=()=>wrap.remove();
  $("profileClose").onclick=close;
  $("openProfileEdit").onclick=()=>{ close(); openProfileEdit(); };
  $("openProfilePassword").onclick=()=>{ close(); openChangePassword(); };
}
async function openProfileEdit(){
  const wrap=document.createElement("div"); wrap.id="profileEditModal";
  const username=state.profile?.username || "", name=state.profile?.full_name || "";
  wrap.innerHTML=`<div class="modal-bg"><div class="modal"><div class="panel-head"><h3>Edit Profile</h3><button class="icon-btn" type="button" id="peClose">×</button></div><form id="peForm" class="form-grid"><div><label>USERNAME</label><input id="peUsername" value="${esc(username)}" required></div><div><label>NAME</label><input id="peName" value="${esc(name)}" required></div><div id="peMsg" class="message full"></div><div class="full form-actions"><button type="button" class="secondary-btn" id="peCancel">Cancel</button><button class="primary-btn" type="submit">Save Profile</button></div></form></div></div>`;
  document.body.appendChild(wrap);
  const close=()=>wrap.remove(); $("peClose").onclick=close; $("peCancel").onclick=close;
  $("peForm").onsubmit=async e=>{
    e.preventDefault(); const msg=$("peMsg"); const u=normalizeUsername($("peUsername").value), n=$("peName").value.trim();
    if(!u || !n){msg.textContent="Username and name are required.";msg.className="message error full";return;}
    const {data,error}=await state.supabase.rpc("update_my_profile",{p_username:u,p_full_name:n});
    if(error){msg.textContent=error.message;msg.className="message error full";return;}
    state.profile={...(state.profile||{}),username:data?.username||u,full_name:data?.full_name||n};
    $("userName").textContent=state.profile.full_name || state.profile.username;
    msg.textContent="Profile updated successfully.";msg.className="message success full";
    setTimeout(close,500);
  };
}

async function openChangePassword(){
  const wrap = document.createElement("div");
  wrap.id = "changePasswordModal";
  wrap.innerHTML = `<div class="modal-bg"><div class="modal"><div class="panel-head"><h3>Change Password</h3><button class="icon-btn" type="button" id="cpClose">×</button></div><form id="cpForm" class="form-grid"><div class="full"><label>NEW PASSWORD</label><div class="password-field"><input id="cpNew" type="password" minlength="6" required><button type="button" class="password-eye" data-password-toggle="cpNew">👁</button></div></div><div class="full"><label>CONFIRM PASSWORD</label><div class="password-field"><input id="cpConfirm" type="password" minlength="6" required><button type="button" class="password-eye" data-password-toggle="cpConfirm">👁</button></div></div><div id="cpMsg" class="message full"></div><div class="full form-actions"><button type="button" class="secondary-btn" id="cpCancel">Cancel</button><button class="primary-btn" type="submit">Change Password</button></div></form></div></div>`;
  document.body.appendChild(wrap);
  const close=()=>wrap.remove(); $("cpClose").onclick=close; $("cpCancel").onclick=close;
  $("cpForm").onsubmit=async e=>{ e.preventDefault(); const a=$("cpNew").value,b=$("cpConfirm").value,msg=$("cpMsg"); if(a.length<6){msg.textContent="Password must be at least 6 characters.";msg.className="message error full";return;} if(a!==b){msg.textContent="Passwords do not match.";msg.className="message error full";return;} const {error}=await state.supabase.auth.updateUser({password:a}); if(error){msg.textContent=error.message;msg.className="message error full";return;} msg.textContent="Password changed successfully. Please login again with your new password.";msg.className="message success full"; setTimeout(async()=>{ try{ await state.supabase.auth.signOut({scope:"global"}); }catch(_){} close(); showLogin(); setLoginMessage("Password changed successfully. Login with your new password.","success"); },900); };
}

document.addEventListener("DOMContentLoaded", () => { initPasswordEyes(); init(); });
