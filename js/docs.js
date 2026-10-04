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
    <form id="docForm" class="doc-search-form"><div class="searchbox doc-search-box"><input id="docVin" placeholder="Enter VIN / last 6 digits to view documents" autocomplete="off" aria-label="Search VIN"><button type="submit">Search VIN</button></div></form>
    <p class="form-help">Search a VIN to open its Bhilarwadi documents, or choose View Documents from the vehicle list.</p>
    <div id="docResults"></div>
    <section class="timeline-recent"><h3>Vehicles IN at Bhilarwadi (Not Delivered)</h3><div id="docBhilarwadiStock" class="table-wrap">${emptyState("Loading vehicles...")}</div></section>
    <p class="form-help">The vehicle list excludes delivered vehicles. Documents include Bhilarwadi IN photos, tyre serial numbers and EV battery number.</p></div>`;
  $("docForm").addEventListener("submit", e => { e.preventDefault(); docSearch($("docVin").value); });
  loadBhilarwadiVehicleList();
  if(state.docVin){ $("docVin").value = state.docVin; const v = state.docVin; state.docVin = null; docSearch(v); }
}
async function loadBhilarwadiVehicleList(){
  const box = $("docBhilarwadiStock");
  if(!box) return;
  if(!state.supabase){ box.innerHTML = emptyState("Connect to Supabase to load Bhilarwadi vehicles."); return; }
  try {
    const [movements, vehicles] = await Promise.all([
      fetchAll(() => state.supabase.from("gate_movements").select("*")
        .eq("gate_name","Bhilarwadi").eq("movement_type","IN").order("created_at",{ascending:false}), {max:50000}),
      allVehicles(true)
    ]);
    const vehicleById = new Map(vehicles.map(v => [String(v.id),v]));
    const vehicleByVin = new Map(vehicles.filter(v => v.vin).map(v => [String(v.vin).toUpperCase(),v]));
    const latestByVin = new Map();
    movements.forEach(m => {
      const vin = String(m.vin || vehicleById.get(String(m.vehicle_id))?.vin || "").trim().toUpperCase();
      if(!vin || latestByVin.has(vin)) return;
      const vehicle = vehicleById.get(String(m.vehicle_id)) || vehicleByVin.get(vin);
      if(vehicle && vStage(vehicle) === "delivered") return;
      latestByVin.set(vin,{...m,vin,vehicle});
    });
    const entries = [...latestByVin.values()];
    mountPaged(box,{
      headers:["IN Date","VIN","Location","Model","Status",""],
      rows:entries.map((x,i) => [
        fmtD(x.receipt_dt || x.created_at),
        raw(`<b class="mono">${esc(x.vin)}</b>`),
        gateLocOf(x) || "Bhilarwadi",
        x.vehicle?.model || x.variant || "-",
        statusBadge(x.vehicle?.status || "In Stock"),
        raw(`<button type="button" class="table-icon-btn doc-status-btn ${IN_REQUIRED_PHOTOS.every(([key]) => Boolean(x[key])) ? "doc-status-complete" : "doc-status-missing"}" data-doc-stock="${i}" title="${IN_REQUIRED_PHOTOS.every(([key]) => Boolean(x[key])) ? "Mandatory photos complete" : "Mandatory photos missing"}">View Documents</button>`)
      ]),
      size:25,empty:"No undelivered vehicles received at Bhilarwadi.",
      onDraw:el => el.querySelectorAll("[data-doc-stock]").forEach(button => button.addEventListener("click",() => {
        const entry = entries[Number(button.dataset.docStock)];
        if(!entry) return;
        $("docVin").value = entry.vin;
        docSearch(entry.vin);
      }))
    });
  } catch(err){
    box.innerHTML = emptyState("Could not load Bhilarwadi vehicles: " + err.message);
  }
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
    const urls = await signedUrls(rows.flatMap(x => [...inPhotoPaths(x), ...inPhotoPaths(x).filter(p => {
      const photo = IN_PHOTOS.find(([k]) => x[k] === p);
      return photo && inPhotoPdfAvailable(p, photo[1]);
    }).map(inPdfPath), x.gate_pass_file]));
    box.querySelectorAll("[data-doc-img]").forEach(img => { const u = urls[img.dataset.docImg]; if(u){ img.src = u; img.closest("a").href = u; } else img.alt = "preview unavailable"; });
    box.querySelectorAll("[data-dl]").forEach(b => b.addEventListener("click", () => downloadPath(b.dataset.dl, b.dataset.name)));
    box.querySelectorAll("[data-pdf]").forEach(b => b.addEventListener("click", () => downloadPath(b.dataset.pdf, b.dataset.name)));
    box.querySelectorAll("[data-pdf-all]").forEach(b => b.addEventListener("click", async () => {
      const paths = JSON.parse(b.dataset.pdfAll); b.disabled = true;
      for(const [p, n] of paths){ await downloadPath(p, n); await new Promise(r => setTimeout(r, 400)); }
      b.disabled = false;
    }));
  } catch(err){ box.innerHTML = emptyState("Could not load: " + (err.message || err)); }
}
function docCard(vin, list){
  return list.map(x => {
    const photos = IN_PHOTOS.filter(([k]) => x[k]);
    const pdfs = photos.filter(([k,l]) => inPhotoPdfAvailable(x[k], l)).map(([k,l]) => [inPdfPath(x[k]), `${inPhotoBaseName(l)}.pdf`]);
    const tyres = [1,2,3,4].map(n => x["tyre_serial_" + n]).filter(Boolean);
    const detail = (l, v) => `<div class="doc-kv"><span>${esc(l)}</span><b>${esc(v || "-")}</b></div>`;
    return `<div class="doc-card"><div class="doc-head"><div><b class="mono">${esc(vin)}</b><span class="doc-sub">IN on ${esc(fmtD(x.receipt_dt || x.created_at))} • ${esc(gateLocOf(x) || "Bhilarwadi")}</span></div>
      ${pdfs.length ? `<button class="secondary-btn" type="button" data-pdf-all='${esc(JSON.stringify(pdfs))}'>⬇ Download All PDFs (${pdfs.length})</button>` : ""}</div>
      <div class="doc-grid">${detail("Variant", x.variant)}${detail("Color", x.color)}${detail("Engine No.", x.engine_no)}${detail("Tyre serial nos.", tyres.join(", "))}${detail("EV battery no.", x.ev_battery_no)}${detail("Remarks", x.remarks)}</div>
      ${photos.length ? `<div class="doc-photos">${photos.map(([k, l]) => `<figure><a target="_blank" rel="noopener"><img data-doc-img="${esc(x[k])}" alt="${esc(l)}" class="doc-img"></a>
        <figcaption>${esc(inPhotoBaseName(l))}</figcaption>${inPhotoPdfAvailable(x[k], l) ? `<button class="table-icon-btn" type="button" data-pdf="${esc(inPdfPath(x[k]))}" data-name="${esc(inPhotoBaseName(l) + ".pdf")}">⬇ Download PDF</button>` : ""}</figure>`).join("")}</div>` : `<p class="form-help">No photos were uploaded for this entry.</p>`}
      ${x.gate_pass_file ? `<div class="doc-pass"><b>Gate pass</b> <button class="table-icon-btn" type="button" data-dl="${esc(x.gate_pass_file)}" data-name="${esc("GatePass_" + vin + "_" + nameOfPath(x.gate_pass_file))}">⬇ Download</button></div>` : ""}</div>`;
  }).join("");
}

/* ---------------------------------------------------------------- Gate pass (uploaded photos) */
async function renderGatePass(){
  $("content").innerHTML = `<div class="panel gate-recent-panel"><div class="gate-recent-head"><h3>Gate Pass</h3>
    <div class="filter-wrap">${filterBtn("gpFilter")}<button class="secondary-btn" type="button" id="gpRefresh" aria-label="Refresh" title="Refresh">↻</button></div></div>
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
    const cells = rows.map(x => [raw(`<a target="_blank" rel="noopener"><img class="gp-thumb" data-gp-img="${esc(x.gate_pass_file)}" alt="Gate pass"></a>`), fmtD(x.receipt_dt || x.created_at), x.gate_name, movementTypeBadge(x.movement_type), gateLocOf(x), raw(`<b class="mono">${esc(x.vin)}</b>`), x.variant, x.color,
      raw(`<button class="table-icon-btn" type="button" data-gp-dl="${esc(x.gate_pass_file)}" data-gp-name="${esc("GatePass_" + x.vin + "_" + x.movement_type + "_" + (x.receipt_dt || "") + "." + (x.gate_pass_file.split(".").pop() || "jpg"))}">⬇ Download</button>`)]);
    mountPaged(box, {size:25, empty:"No uploaded gate passes yet.", headers:["Gate Pass","Date","Gate","Movement","Location","VIN No.","Variant","Color",""], rows:cells,
      onDraw:(el, slice, off) => {
        signedUrls(rows.slice(off, off + 25).map(x => x.gate_pass_file)).then(urls => el.querySelectorAll("[data-gp-img]").forEach(img => { const u = urls[img.dataset.gpImg]; if(u){ img.src = u; img.closest("a").href = u; } }));
        el.querySelectorAll("[data-gp-dl]").forEach(b => b.addEventListener("click", () => downloadPath(b.dataset.gpDl, b.dataset.gpName)));
      }});
  } catch(err){ box.innerHTML = emptyState("Could not load gate passes: " + (err.message || err) + (/column|schema cache/i.test(err.message || "") ? " " + GATEPASS_SQL_HINT : "")); }
}
