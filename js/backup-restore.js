"use strict";

const BACKUP_FORMAT = "KH_VEHICLE_INVENTORY_BACKUP";
const BACKUP_VERSION = 2;
const BACKUP_NULL = "__KH_NULL__";
const BACKUP_JSON = "__KH_JSON__";
const BACKUP_STRING = "__KH_STRING__";
const BACKUP_ENCRYPTED = "__KH_AES256GCM__";
const BACKUP_KDF = "PBKDF2-SHA256/AES-256-GCM/310000";
const BACKUP_KDF_ITERATIONS = 310000;
const BACKUP_BATCH_SIZE = 200;
const BACKUP_TABLES = [
  {name:"locations", key:["id"]},
  {name:"roles", key:["id"]},
  {name:"permissions", key:["id"]},
  {name:"role_permissions", key:["role_id","permission_id"]},
  {name:"company_settings", key:["id"]},
  {name:"system_settings", key:["id"]},
  {name:"import_configuration", key:["id"]},
  {name:"vehicles", key:["id"]},
  {name:"deliveries", key:["id"]},
  {name:"gate_movements", key:["id"]},
  {name:"vehicle_timeline", key:["id"]},
  {name:"import_batches", key:["id"]},
  {name:"audit_logs", key:["id"]},
  {name:"user_profiles", key:["id"]}
];
let RESTORE_PREVIEW = null;

function renderBackupRestore(){
  if(!state.isAdmin){ renderDenied(); return; }
  $("content").innerHTML = `<div class="panel backup-panel">
    <div class="panel-head"><h3>Backup & Restore</h3></div>
    <p class="form-help">Backup includes application data, settings and user profile rows. Stored profile password fields are encrypted in the workbook with your passphrase. Photos, PDFs, gate-pass files and actual Supabase login passwords are not included. Restoring profiles does not create login accounts; reset login passwords separately.</p>
    <label class="backup-label" for="backupExportPass">Backup passphrase (minimum 12 characters)</label><input id="backupExportPass" type="password" autocomplete="new-password" minlength="12">
    <label class="backup-label" for="backupExportConfirm">Confirm backup passphrase</label><input id="backupExportConfirm" type="password" autocomplete="new-password" minlength="12">
    <div class="backup-actions"><button class="primary-btn" type="button" id="backupDownload">⬇ Download Excel Backup</button></div>
    <div class="backup-restore-section"><h4>Restore from Excel backup</h4>
      <p class="form-help">Restore adds missing rows and updates matching rows. It never deletes existing records. Enter the same passphrase used to create the workbook.</p>
      <label for="backupFile">Select backup workbook (.xlsx)</label><input id="backupFile" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet">
      <label class="backup-label" for="backupRestorePass">Backup passphrase</label><input id="backupRestorePass" type="password" autocomplete="current-password">
      <div id="backupMessage" class="message" aria-live="polite"></div><div id="backupPreview"></div>
      <div class="backup-actions"><button class="secondary-btn" type="button" id="backupPreviewButton">Validate backup</button><button class="primary-btn" type="button" id="backupRestore" disabled>Restore (add/update only)</button></div>
    </div></div>`;
  $("backupDownload").addEventListener("click", createDataBackup);
  $("backupPreviewButton").addEventListener("click", previewDataBackup);
  $("backupRestore").addEventListener("click", restoreDataBackup);
  $("backupFile").addEventListener("change", () => {
    RESTORE_PREVIEW = null;
    $("backupRestore").disabled = true;
    $("backupRestorePass").value = "";
    $("backupPreview").innerHTML = "";
    $("backupMessage").textContent = "";
    $("backupMessage").className = "message";
  });
}

function backupStatus(message, type = ""){
  const el = $("backupMessage");
  if(!el) return;
  el.textContent = message;
  el.className = "message" + (type ? " " + type : "");
}
function backupCrypto(){
  if(!globalThis.crypto?.subtle || !globalThis.crypto?.getRandomValues) throw new Error("Secure encryption is unavailable in this browser. Open the app over HTTPS and try again.");
  return globalThis.crypto;
}
function backupBase64(bytes){
  let binary = "";
  for(let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}
function backupUnbase64(value){
  const binary = atob(value);
  return Uint8Array.from(binary, ch => ch.charCodeAt(0));
}
function backupRandom(length){
  const bytes = new Uint8Array(length);
  backupCrypto().getRandomValues(bytes);
  return bytes;
}
async function deriveBackupKey(passphrase, salt){
  if(typeof passphrase !== "string" || passphrase.length < 12) throw new Error("Use a backup passphrase of at least 12 characters.");
  const cryptoApi = backupCrypto(), material = await cryptoApi.subtle.importKey("raw", new TextEncoder().encode(passphrase), "PBKDF2", false, ["deriveKey"]);
  return cryptoApi.subtle.deriveKey({name:"PBKDF2", salt, iterations:BACKUP_KDF_ITERATIONS, hash:"SHA-256"}, material, {name:"AES-GCM", length:256}, false, ["encrypt","decrypt"]);
}
async function encryptProfilePassword(value, profileId, key){
  if(value === null || value === undefined || value === "") return BACKUP_NULL;
  const cryptoApi = backupCrypto(), iv = backupRandom(12), additionalData = new TextEncoder().encode(`user_profiles:${profileId}:password_display`);
  const ciphertext = new Uint8Array(await cryptoApi.subtle.encrypt({name:"AES-GCM", iv, additionalData}, key, new TextEncoder().encode(String(value))));
  const packed = new Uint8Array(iv.length + ciphertext.length); packed.set(iv); packed.set(ciphertext, iv.length);
  return BACKUP_ENCRYPTED + backupBase64(packed);
}
async function decryptProfilePassword(value, profileId, key){
  if(value === BACKUP_NULL) return null;
  if(typeof value !== "string" || !value.startsWith(BACKUP_ENCRYPTED)) throw new Error(`User profile ${profileId} contains an unencrypted password field. Create a new backup with this version.`);
  const packed = backupUnbase64(value.slice(BACKUP_ENCRYPTED.length));
  if(packed.length <= 28) throw new Error(`User profile ${profileId} has an invalid encrypted password field.`);
  const cryptoApi = backupCrypto(), iv = packed.slice(0,12), ciphertext = packed.slice(12);
  const additionalData = new TextEncoder().encode(`user_profiles:${profileId}:password_display`);
  try {
    const clear = await cryptoApi.subtle.decrypt({name:"AES-GCM", iv, additionalData}, key, ciphertext);
    return new TextDecoder("utf-8", {fatal:true}).decode(clear);
  } catch { throw new Error("Could not decrypt profile password fields. Check the passphrase and make sure the workbook was not modified."); }
}
function backupSafeRow(table, row){
  const omit = new Set(table.omit || []);
  return Object.fromEntries(Object.entries(row).filter(([key]) => !omit.has(key)));
}
function backupEncode(value){
  if(value === null || value === undefined) return BACKUP_NULL;
  if(typeof value === "string" && value.startsWith("__KH_")) return BACKUP_STRING + value;
  if(typeof value === "object") return BACKUP_JSON + JSON.stringify(value);
  return value;
}
function backupDecode(value){
  if(value === BACKUP_NULL) return null;
  if(typeof value !== "string") return value;
  if(value.startsWith(BACKUP_STRING)) return value.slice(BACKUP_STRING.length);
  if(value.startsWith(BACKUP_JSON)){
    try { return JSON.parse(value.slice(BACKUP_JSON.length)); }
    catch { throw new Error("Backup contains invalid JSON data."); }
  }
  return value;
}
async function fetchBackupTable(table){
  const rows = [];
  for(let from = 0; ; from += 1000){
    const {data, error} = await state.supabase.from(table.name).select("*").order(table.key[0]).range(from, from + 999);
    if(error) throw new Error(`${table.name}: ${error.message}`);
    const batch = data || [];
    rows.push(...batch.map(row => backupSafeRow(table, row)));
    if(batch.length < 1000) return rows;
    if(rows.length >= 1048575) throw new Error(`${table.name} exceeds Excel's per-sheet row limit.`);
  }
}
async function createDataBackup(){
  const btn = $("backupDownload");
  if(!state.isAdmin) return toast("Only Admin can create backups.","error");
  if(!window.XLSX) return toast("Excel library not loaded (check internet).","error");
  const passphrase = $("backupExportPass").value, confirmation = $("backupExportConfirm").value;
  if(passphrase.length < 12) return backupStatus("Enter a backup passphrase of at least 12 characters.", "error");
  if(passphrase !== confirmation) return backupStatus("Backup passphrases do not match.", "error");
  btn.disabled = true;
  try {
    const salt = backupRandom(16), encryptionKey = await deriveBackupKey(passphrase, salt);
    const wb = XLSX.utils.book_new(), manifest = [
      ["Kothari Hyundai Backup", BACKUP_FORMAT],
      ["Version", BACKUP_VERSION],
      ["Created at", new Date().toISOString()],
      ["Table", "Record count"],
      ["Password field encryption", BACKUP_KDF],
      ["Encryption salt", backupBase64(salt)]
    ], contents = [];
    for(let i = 0; i < BACKUP_TABLES.length; i++){
      const table = BACKUP_TABLES[i];
      btn.textContent = `Reading ${i + 1}/${BACKUP_TABLES.length}: ${table.name}…`;
      const rows = await fetchBackupTable(table);
      manifest.push([table.name, rows.length]);
      contents.push({table, rows});
    }
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(manifest), "Backup Info");
    for(const {table, rows} of contents){
      const sheetRows = [];
      for(const row of rows){
        const output = {};
        for(const [key,value] of Object.entries(row)){
          output[key] = table.name === "user_profiles" && key === "password_display"
            ? await encryptProfilePassword(value, row.id, encryptionKey)
            : backupEncode(value);
        }
        sheetRows.push(output);
      }
      const ws = sheetRows.length ? XLSX.utils.json_to_sheet(sheetRows) : XLSX.utils.aoa_to_sheet([["No records"]]);
      XLSX.utils.book_append_sheet(wb, ws, table.name);
    }
    XLSX.writeFile(wb, `kothari-hyundai-backup-${todayLocal()}.xlsx`);
    logAudit("CREATE_BACKUP","administration","backup",null,{tables:contents.length, records:contents.reduce((n,x) => n + x.rows.length,0)});
    toast("Excel backup downloaded.","success");
  } catch(err){ backupStatus("Backup failed: " + (err.message || err), "error"); toast("Backup failed: " + (err.message || err),"error"); }
  finally { btn.disabled = false; btn.textContent = "⬇ Download Excel Backup"; $("backupExportPass").value = ""; $("backupExportConfirm").value = ""; }
}
function readBackupManifest(wb){
  const ws = wb.Sheets["Backup Info"];
  if(!ws) throw new Error("Backup Info sheet is missing.");
  const rows = XLSX.utils.sheet_to_json(ws, {header:1, defval:""});
  if(rows[0]?.[1] !== BACKUP_FORMAT || Number(rows[1]?.[1]) !== BACKUP_VERSION) throw new Error("This is not a supported Kothari Hyundai backup workbook.");
  const manifest = new Map(), metadata = new Map(rows.slice(4).filter(row => ["Password field encryption","Encryption salt"].includes(String(row[0] || ""))).map(row => [String(row[0]), String(row[1] || "")]));
  if(metadata.get("Password field encryption") !== BACKUP_KDF || !metadata.get("Encryption salt")) throw new Error("Backup password encryption metadata is missing or unsupported.");
  let salt;
  try { salt = backupUnbase64(metadata.get("Encryption salt")); }
  catch { throw new Error("Backup encryption salt is invalid."); }
  if(salt.length !== 16) throw new Error("Backup encryption salt is invalid.");
  for(const row of rows.slice(4)){
    const name = String(row[0] || "");
    if(!name || metadata.has(name)) continue;
    const count = Number(row[1]);
    if(!Number.isSafeInteger(count) || count < 0 || manifest.has(name)) throw new Error("Backup table list is invalid.");
    manifest.set(name, count);
  }
  if(manifest.size !== BACKUP_TABLES.length || BACKUP_TABLES.some(t => !manifest.has(t.name))) throw new Error("Backup is incomplete or has an unsupported table list.");
  return {manifest,salt};
}
async function readBackupTable(wb, table, expectedCount, encryptionKey){
  const ws = wb.Sheets[table.name];
  if(!ws) throw new Error(`Backup sheet ${table.name} is missing.`);
  if(Object.keys(ws).some(key => !key.startsWith("!") && ws[key]?.f)) throw new Error(`${table.name} contains Excel formulas; use an unchanged backup workbook.`);
  if(expectedCount === 0) return [];
  const rows = XLSX.utils.sheet_to_json(ws, {defval:BACKUP_NULL, raw:true});
  if(rows.length !== expectedCount) throw new Error(`${table.name} row count does not match Backup Info.`);
  const decoded = [];
  for(let index = 0; index < rows.length; index++){
    const row = rows[index];
    const out = Object.fromEntries(Object.entries(row).map(([key,value]) => [key,backupDecode(value)]));
    if(table.name === "user_profiles" && Object.hasOwn(out, "password_display")) out.password_display = await decryptProfilePassword(out.password_display, out.id, encryptionKey);
    if(table.key.some(key => out[key] === null || out[key] === undefined || out[key] === "")) throw new Error(`${table.name} row ${index + 2} is missing key field ${table.key.join(", ")}.`);
    decoded.push(out);
  }
  return decoded;
}
async function parseBackupWorkbook(file, passphrase){
  const wb = XLSX.read(await file.arrayBuffer(), {type:"array", cellDates:false, dense:false});
  const {manifest,salt} = readBackupManifest(wb);
  if(passphrase.length < 12) throw new Error("Enter the backup passphrase (at least 12 characters).");
  const encryptionKey = await deriveBackupKey(passphrase, salt), data = [];
  for(const table of BACKUP_TABLES) data.push({table, rows:await readBackupTable(wb, table, manifest.get(table.name), encryptionKey)});
  return data;
}
async function previewDataBackup(){
  const file = $("backupFile").files?.[0];
  const btn = $("backupPreviewButton");
  RESTORE_PREVIEW = null; $("backupRestore").disabled = true; $("backupPreview").innerHTML = "";
  if(!file) return backupStatus("Select an Excel backup file first.", "error");
  if(!window.XLSX) return backupStatus("Excel library not loaded (check internet).", "error");
  btn.disabled = true; backupStatus("Validating workbook…");
  try {
    const data = await parseBackupWorkbook(file, $("backupRestorePass").value);
    RESTORE_PREVIEW = {file, counts:data.map(x => [x.table.name, x.rows.length])};
    const total = data.reduce((n,x) => n + x.rows.length, 0);
    $("backupPreview").innerHTML = `<div class="table-wrap">${table(["Table","Rows to add/update"],RESTORE_PREVIEW.counts)}</div><p class="form-help">${total.toLocaleString("en-IN")} rows validated. Current records not present in this workbook will remain unchanged.</p>`;
    backupStatus(`Backup validated: ${total.toLocaleString("en-IN")} rows ready.`, "success");
    $("backupRestore").disabled = false;
  } catch(err){ backupStatus("Backup validation failed: " + (err.message || err), "error"); }
  finally { btn.disabled = false; }
}
async function restoreDataBackup(){
  if(!state.isAdmin) return toast("Only Admin can restore backups.","error");
  if(!RESTORE_PREVIEW || RESTORE_PREVIEW.file !== $("backupFile").files?.[0]) return backupStatus("Validate the selected backup file before restoring.", "error");
  const total = RESTORE_PREVIEW.counts.reduce((n,x) => n + x[1], 0);
  if(!confirm(`Restore ${total.toLocaleString("en-IN")} rows from this backup? Matching rows will be updated; existing extra rows will not be deleted. Attachments and account passwords are not restored.`)) return;
  const btn = $("backupRestore"); btn.disabled = true;
  let completed = 0;
  try {
    const data = await parseBackupWorkbook(RESTORE_PREVIEW.file, $("backupRestorePass").value);
    for(const {table:meta, rows} of data){
      for(let from = 0; from < rows.length; from += BACKUP_BATCH_SIZE){
        const part = rows.slice(from, from + BACKUP_BATCH_SIZE);
        backupStatus(`Restoring ${meta.name}: ${Math.min(from + part.length, rows.length)}/${rows.length}…`);
        const {error} = await state.supabase.from(meta.name).upsert(part);
        if(error) throw new Error(`${meta.name}: ${error.message}`);
        completed += part.length;
      }
    }
    const vehicles = data.find(x => x.table.name === "vehicles")?.rows || [];
    for(let from = 0; from < vehicles.length; from += BACKUP_BATCH_SIZE){
      const part = vehicles.slice(from, from + BACKUP_BATCH_SIZE);
      backupStatus(`Restoring vehicle stock state: ${Math.min(from + part.length, vehicles.length)}/${vehicles.length}…`);
      const {error} = await state.supabase.from("vehicles").upsert(part);
      if(error) throw new Error(`vehicles: ${error.message}`);
    }
    logAudit("RESTORE_BACKUP","administration","backup",null,{records:completed});
    state.locations = null; VCACHE.rows = null;
    backupStatus(`Restore completed: ${completed.toLocaleString("en-IN")} rows added or updated. No existing rows were deleted.`, "success");
    toast("Backup restore completed.","success");
    $("backupPreview").innerHTML += `<p class="message success">Restore completed. Refreshing application data…</p>`;
    RESTORE_PREVIEW = null;
    $("backupRestorePass").value = "";
    setTimeout(() => window.location.reload(), 1800);
  } catch(err){
    backupStatus(`Restore stopped after ${completed.toLocaleString("en-IN")} rows: ${err.message || err}. You can safely retry this workbook; rows are upserted.`, "error");
    toast("Restore failed: " + (err.message || err),"error");
    btn.disabled = false;
  }
}
