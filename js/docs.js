"use strict";
/* =====================================================================
   DOCUMENTS
   - Vehicle Management > Bhilarwadi Documents : search a VIN, see the photos / tyre serials /
     EV battery saved at Bhilarwadi IN, and download each photo.
   - Gate Management > Gate Pass : recent uploaded gate passes (VIN wise), download.
   ===================================================================== */
const GATEPASS_SQL_HINT = "Run NEW_FEATURES.sql once in Supabase SQL Editor (adds the gate pass column), then try again.";

/* ---------------------------------------------------------------- Bhilarwadi documents */
async function renderDocuments(){
  $("content").innerHTML = `<div class="panel"><div class="panel-head"><h3>Bhilarwadi Documents</h3></div>
    <form id="docForm" class="toolbar"><div class="searchbox"><input id="docVin" placeholder="Search VIN / last 6 digits" autocomplete="off" aria-label="Search VIN"><button type="submit">Search</button></div></form>
    <p class="form-help">Shows the details saved when the vehicle came IN at Bhilarwadi: photos, tyre serial numbers and EV battery number.</p>
    <div id="docResults">${emptyState("Search a VIN to see its Bhilarwadi documents.")}</div></div>`;
  $("docForm").addEventListener("submit", e => { e.preventDefault(); docSearch($("docVin").value); });
  if(state.docVin){ $("docVin").value = state.docVin; const v = state.docVin; state.docVin = null; docSearch(v); }
}
async function docSearch(value){
  const box = $("docResults"), q = cleanQuery(value).replace(/\s+/g, "").toUpperCase();
  if(q.length < 3){ box.innerHTML = emptyState("Enter at least 3 characters of the VIN."); return; }
  box.innerHTML = emptyState("Searching…");
  try {
    const r = await state.supabase.from("gate_movements").select("*").eq("gate_name", "Bhilarwadi").eq("movement_type", "IN").ilike("vin", `%${q}%`).order("created_at", {ascending:false}).limit(60);
    if(r.error) throw r.error;
    const rows = r.data || [], vins = [...new Set(rows.map(x => x.vin))];
    if(!rows.length){ box.innerHTML = emptyState("No Bhilarwadi IN entry found for this VIN."); return; }
    box.innerHTML = vins.map(vin => docCard(vin, rows.filter(x => x.vin === vin))).join("");
    const urls = await signedUrls(rows.flatMap(x => [...inPhotoPaths(x), x.gate_pass_file]));
    box.querySelectorAll("[data-doc-img]").forEach(img => { const u = urls[img.dataset.docImg]; if(u){ img.src = u; img.closest("a").href = u; } else img.alt = "preview unavailable"; });
    box.querySelectorAll("[data-dl]").forEach(b => b.addEventListener("click", () => downloadPath(b.dataset.dl, b.dataset.name)));
    box.querySelectorAll("[data-dl-all]").forEach(b => b.addEventListener("click", async () => {
      const paths = JSON.parse(b.dataset.dlAll); b.disabled = true;
      for(const [p, n] of paths){ await downloadPath(p, n); await new Promise(r => setTimeout(r, 400)); }
      b.disabled = false;
    }));
  } catch(err){ box.innerHTML = emptyState("Could not load: " + (err.message || err)); }
}
function docCard(vin, list){
  return list.map(x => {
    const photos = IN_PHOTOS.filter(([k]) => x[k]);
    const tyres = [1,2,3,4].map(n => x["tyre_serial_" + n]).filter(Boolean);
    const dlAll = photos.map(([k, l]) => [x[k], `${vin}_${l.replace(/^\d+\.\s*/, "").replace(/\s+/g, "_")}.${(x[k].split(".").pop() || "jpg")}`]);
    const detail = (l, v) => `<div class="doc-kv"><span>${esc(l)}</span><b>${esc(v || "-")}</b></div>`;
    return `<div class="doc-card"><div class="doc-head"><div><b class="mono">${esc(vin)}</b><span class="doc-sub">IN on ${esc(fmtD(x.receipt_dt || x.created_at))} • ${esc(gateLocOf(x) || "Bhilarwadi")}</span></div>
      ${photos.length ? `<button class="secondary-btn" type="button" data-dl-all='${esc(JSON.stringify(dlAll))}'>⬇ Download all photos (${photos.length})</button>` : ""}</div>
      <div class="doc-grid">${detail("Variant", x.variant)}${detail("Color", x.color)}${detail("Engine No.", x.engine_no)}${detail("Tyre serial nos.", tyres.join(", "))}${detail("EV battery no.", x.ev_battery_no)}${detail("Remarks", x.remarks)}</div>
      ${photos.length ? `<div class="doc-photos">${photos.map(([k, l]) => `<figure><a target="_blank" rel="noopener"><img data-doc-img="${esc(x[k])}" alt="${esc(l)}" class="doc-img"></a>
        <figcaption>${esc(l.replace(/^\d+\.\s*/, ""))}</figcaption><button class="table-icon-btn" type="button" data-dl="${esc(x[k])}" data-name="${esc(vin + "_" + l.replace(/^\d+\.\s*/, "").replace(/\s+/g, "_") + "." + (x[k].split(".").pop() || "jpg"))}">⬇ Download</button></figure>`).join("")}</div>` : `<p class="form-help">No photos were uploaded for this entry.</p>`}
      ${x.gate_pass_file ? `<div class="doc-pass"><b>Gate pass</b> <button class="table-icon-btn" type="button" data-dl="${esc(x.gate_pass_file)}" data-name="${esc("GatePass_" + vin + "_" + nameOfPath(x.gate_pass_file))}">⬇ Download</button></div>` : ""}</div>`;
  }).join("");
}

/* ---------------------------------------------------------------- Gate pass (uploaded photos) */
async function renderGatePass(){
  $("content").innerHTML = `<div class="panel gate-recent-panel"><div class="gate-recent-head"><h3>Gate Pass</h3>
    <div class="filter-wrap">${filterBtn("gpFilter")}<button class="secondary-btn" type="button" id="gpRefresh">↻ Refresh</button></div></div>
    ${filterPanel("gpFilter", `<div class="filter-grid"><label>VIN / last 6 digits<input id="gateSearchText" type="search" placeholder="VIN"></label>
      <label>Movement<select id="gateMovementFilter"><option value="ALL">All</option><option value="IN">IN</option><option value="OUT">OUT</option></select></label>
      <label>From date<input id="gateFromDate" type="date"></label><label>To date<input id="gateToDate" type="date"></label>
      <div class="filter-actions"><button class="primary-btn" type="button" id="gateSearch">Apply</button></div></div>`)}
    <p class="form-help gatepass-help">Gate passes uploaded at Bhilarwadi / Branch In-Out, newest first. Tap Download to save the photo.</p>
    <div id="gatePassResults" class="table-wrap">${emptyState("Loading…")}</div></div>`;
  $("gateSearch").addEventListener("click", loadGatePasses); $("gpRefresh").addEventListener("click", loadGatePasses);
  $("gateSearchText").addEventListener("keydown", e => { if(e.key === "Enter"){ e.preventDefault(); loadGatePasses(); } });
  return loadGatePasses();
}
async function loadGatePasses(){
  const box = $("gatePassResults"); if(!box) return;
  try {
    const q = cleanQuery($("gateSearchText").value).replace(/\s+/g, ""), from = $("gateFromDate").value, to = $("gateToDate").value, mv = $("gateMovementFilter").value;
    let query = state.supabase.from("gate_movements").select("*").not("gate_pass_file", "is", null).order("created_at", {ascending:false}).limit(1000);
    if(q) query = query.ilike("vin", `%${q}%`); if(from) query = query.gte("receipt_dt", from); if(to) query = query.lte("receipt_dt", to); if(mv && mv !== "ALL") query = query.eq("movement_type", mv);
    const r = await query;
    if(r.error) throw r.error;
    const rows = r.data || [];
    const cells = rows.map(x => [raw(`<a target="_blank" rel="noopener"><img class="gp-thumb" data-gp-img="${esc(x.gate_pass_file)}" alt="Gate pass"></a>`), fmtD(x.receipt_dt || x.created_at), x.gate_name, x.movement_type, gateLocOf(x), raw(`<b class="mono">${esc(x.vin)}</b>`), x.variant, x.color,
      raw(`<button class="table-icon-btn" type="button" data-gp-dl="${esc(x.gate_pass_file)}" data-gp-name="${esc("GatePass_" + x.vin + "_" + x.movement_type + "_" + (x.receipt_dt || "") + "." + (x.gate_pass_file.split(".").pop() || "jpg"))}">⬇ Download</button>`)]);
    mountPaged(box, {size:25, empty:"No uploaded gate passes yet.", headers:["Gate Pass","Date","Gate","Movement","Location","VIN No.","Variant","Color",""], rows:cells,
      onDraw:(el, slice, off) => {
        signedUrls(rows.slice(off, off + 25).map(x => x.gate_pass_file)).then(urls => el.querySelectorAll("[data-gp-img]").forEach(img => { const u = urls[img.dataset.gpImg]; if(u){ img.src = u; img.closest("a").href = u; } }));
        el.querySelectorAll("[data-gp-dl]").forEach(b => b.addEventListener("click", () => downloadPath(b.dataset.gpDl, b.dataset.gpName)));
      }});
  } catch(err){ box.innerHTML = emptyState("Could not load gate passes: " + (err.message || err) + (/column|schema cache/i.test(err.message || "") ? " " + GATEPASS_SQL_HINT : "")); }
}
