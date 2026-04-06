import fs from "fs";
import * as XLSX from "xlsx/xlsx.mjs";
XLSX.set_fs(fs);

// === PATHS FIXOS PARA RAILWAY VOLUME ===
const AJUSTES_PATH = "/data/ajustes.json";          // ✅ Correto
const PARAGENS_OVR_PATH = "/data/paragens_user.json"; // ✅ Correto

// Garantir ficheiros no volume
if (!fs.existsSync(AJUSTES_PATH)) fs.writeFileSync(AJUSTES_PATH, "{}", "utf8");
if (!fs.existsSync(PARAGENS_OVR_PATH)) fs.writeFileSync(PARAGENS_OVR_PATH, "{}", "utf8");

// === CONFIG ===
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const BASE_DIR = __dirname;
const RAW_DIR  = BASE_DIR;
const WEB_DIR  = path.join(BASE_DIR, "web");

// Criar pasta web se não existir
fs.mkdirSync(WEB_DIR, { recursive: true });

// === OVERRIDES DAS PARAGENS ===
function loadStopOverrides(){
  try{
    return JSON.parse(fs.readFileSync(PARAGENS_OVR_PATH,"utf8") || "{}");
  } catch(e){
    console.log("[AVISO] Falha a ler paragens_user.json:", e.message);
    return {};
  }
}

// === PERÍODO ===
const argInicio = process.argv[2];
const argFim    = process.argv[3];

function parseLocalYMD(s){
  if(!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const [y,m,d] = s.split("-").map(Number);
  return new Date(y, m-1, d);
}

let dtInicio = parseLocalYMD(argInicio);
let dtFim    = parseLocalYMD(argFim);

if (dtInicio && dtFim){
  dtFim.setHours(23,59,59,999);
  if (dtInicio > dtFim) [dtInicio, dtFim] = [dtFim, dtInicio];
  console.log(`[PERÍODO] ${argInicio} → ${argFim}`);
}else{
  dtInicio = null; dtFim = null;
  console.log("[PERÍODO] Sem filtro");
}

// === UTILS ===
const EXCEL_EPOCH = new Date(Date.UTC(1899,11,30));
function excelSerialToDate(n){
  if(typeof n === "number")
    return new Date(EXCEL_EPOCH.getTime() + Math.round(n*86400*1000));
  const d = new Date(n);
  return isNaN(+d) ? null : d;
}

function roundHalfUp(n,dec=2){ const p=10**dec; return Math.sign(n)*Math.round(Math.abs(n)*p+1e-8)/p; }
function roundInt(n){ return Math.sign(n)*Math.round(Math.abs(n)+1e-8); }
function inPeriod(dt){ if(!dtInicio||!dtFim) return true; return dt>=dtInicio && dt<=dtFim; }
function minutesBetween(a,b){ return (b-a)/60000; }
function isBlank(v){ return !v || String(v).trim()===""; }

function normLotExact(s){
  return String(s ?? "")
    .normalize("NFKC")
    .replace(/[\u00A0\u2000-\u200D]/g, "")
    .trim();
}

// === PARAGENS ===
const STOP_GAP_MIN = 10;
const LUNCH_MIN = 40, LUNCH_START=11, LUNCH_END=14;
function overlapsLunch(start,end){ 
  const y=start.getFullYear(),m=start.getMonth(),d=start.getDate();
  const L1=new Date(y,m,d,LUNCH_START,0,0), L2=new Date(y,m,d,LUNCH_END,0,0); 
  return end > L1 && start < L2; 
}
function classifyStop(start,end,dur){ 
  return (dur>=LUNCH_MIN && overlapsLunch(start,end)) ? "Almoço":"Paragem"; 
}

// === LIMITES L/U ===
function extractLimits(name) {
  if (!name) return [0,0];

  let s = String(name)
    .normalize("NFKC")
    .replace(/,/g, ".")
    .replace(/\s+/g, " ")
    .replace(/\u00A0/g, " ");

  const rgRange = /(\d+(?:\.\d+)?)[\s]*[-−–—][\s]*(\d+(?:\.\d+)?)/i;
  const rgLT    = /<\s*(\d+(?:\.\d+)?)/i;
  const rgPlus  = /\+\s*(\d+(?:\.\d+)?)/i;

  let lo=null, up=null, m=null;

  if (m = s.match(rgRange)) {
    lo = Math.round(parseFloat(m[1]) * 1000);
    up = Math.round(parseFloat(m[2]) * 1000);
  } else if (m = s.match(rgLT)) {
    lo = 0;
    up = Math.round(parseFloat(m[1]) * 1000);
  } else if (m = s.match(rgPlus)) {
    lo = Math.round(parseFloat(m[1]) * 1000);
    up = 0;
  }

  if (/EVI/i.test(s)) lo = (lo || 0) + 1;

  return [lo || 0, up || 0];
}

// === DETEÇÃO ===
const RE_FILE  = /FILET/i;
const RE_POST  = /POSTA/i;
const RE_EVI   = /EVI/i;
const RE_PREG  = /(PREGADO|\bPREG\b)/i;
const RE_LING  = /(LINGUADO|\bLING\b)/i;

function isFile(s){ return RE_FILE.test(s); }
function isPost(s){ return RE_POST.test(s); }
function isEvi(s){ return RE_EVI.test(s) && !isFile(s) && !isPost(s); }
function isPreg(s){ return RE_PREG.test(s) && !isFile(s) && !isPost(s) && !isEvi(s); }
function isLing(s){ return RE_LING.test(s) && !isFile(s) && !isPost(s) && !isEvi(s); }

// === LER EXCELS ===
function readAll(){
  const files = fs.readdirSync(RAW_DIR)
    .filter(f=>f.toLowerCase().endsWith(".xlsx"))
    .filter(f=>!f.startsWith("~$"))
    .filter(f=>!f.startsWith("Totais_Lote_Sublotes_"))
    .map(f=>path.join(RAW_DIR,f));

  let rows=[], raw=0, kept=0;

  for (const file of files){
    try{
      const wb = XLSX.readFile(file);
      const ws = wb.Sheets[wb.SheetNames[0]];
      const arr = XLSX.utils.sheet_to_json(ws,{defval:null});

      for (const r of arr){
        if (!(
          r["Production time"]!=null &&
          r["Product name"]   !=null &&
          r["Lot number"]     !=null &&
          r["product count"]  !=null &&
          r["Batch Weight (kg)"]!=null
        )) continue;

        const dt = excelSerialToDate(r["Production time"]);
        if(!dt) continue;
        raw++;

        if(!inPeriod(dt)) continue;
        kept++;

        rows.push({
          dt,
          dateKey: dt.toISOString().slice(0,10),
          name: r["Product name"],
          lot : r["Lot number"],
          cust: r["Customer"],
          count: roundInt(Number(r["product count"])),
          kg   : roundHalfUp(Number(r["Batch Weight (kg)"]))
        });
      }

    }catch(e){ console.log("[ERRO AO LER]", file, e.message); }
  }

  console.log(`[INFO] Mantidas ${kept} linhas (de ${raw})`);
  return rows;
}

// === LER AJUSTES DO VOLUME (CORRETO) ===
function loadAjustes(){
  try{
    return JSON.parse(fs.readFileSync(AJUSTES_PATH,"utf8")||"{}");
  }catch(e){
    console.log("[AVISO] Falha a ler ajustes.json:", e.message);
    return {};
  }
}

// === PROCESSAMENTO PRINCIPAL ===
function processAll(){
  const rows = readAll();
  const stopOverrides = loadStopOverrides(); 
  const ajustes = loadAjustes();

  if (rows.length===0){
    fs.writeFileSync(
      path.join(WEB_DIR,"indicadores.js"),
      'window.__indicadores = {"data":[],"monthly":[],"totais":{},"stops":{}};',
      "utf8"
    );
    console.log("[OK] Sem dados → ficheiro vazio gerado.");
    return;
  }

  const byDate = new Map();
  rows.forEach(r=>{
    if(!byDate.has(r.dateKey)) byDate.set(r.dateKey,[]);
    byDate.get(r.dateKey).push(r);
  });

  const indicadores=[];
  const totaisPorDia={};
  const stopsByDay={};

  // === PARA CADA DIA ===
  for (const [date, arr] of byDate){
    arr.sort((a,b)=>a.dt-b.dt);

    // ---------------- PARAGENS -----------------
    let totalStop=0, stopCount=0;
    const stops=[];

    for (let i=1;i<arr.length;i++){
      const delta=minutesBetween(arr[i-1].dt, arr[i].dt);

      if (delta > STOP_GAP_MIN){
        totalStop += delta; 
        stopCount++;

        const startISO = arr[i-1].dt.toISOString();
        const endISO   = arr[i].dt.toISOString();
        const id = `${startISO}_${endISO}`;

        let tipo = classifyStop(arr[i-1].dt, arr[i].dt, delta);
        const ovr = stopOverrides?.[date]?.[id];
        if (ovr && String(ovr).trim() !== "") tipo = String(ovr).trim();

        stops.push({ 
          id, 
          start: startISO, 
          end: endISO, 
          minutes: roundHalfUp(delta,2), 
          type: tipo 
        });
      }
    }
    stopsByDay[date]=stops;

    // ---------------- BASE DO DIA -----------------
    const start=arr[0].dt, end=arr[arr.length-1].dt;
    const span=minutesBetween(start,end);
    const baseFish = arr.reduce((s,x)=>s+x.count,0);
    const baseKg   = arr.reduce((s,x)=>s+x.kg,0);

    const sumIf=(pred,type)=>arr.filter(x=>pred(x.name||""))
      .reduce((s,x)=>s+(type==="kg"?x.kg:x.count),0);

    const base = {
      preg_fish: sumIf(isPreg,"count"),
      preg_kg  : roundHalfUp(sumIf(isPreg,"kg"),2),
      ling_fish: sumIf(isLing,"count"),
      ling_kg  : roundHalfUp(sumIf(isLing,"kg"),2),
      evi_fish : sumIf(isEvi,"count"),
      evi_kg   : roundHalfUp(sumIf(isEvi,"kg"),2),
      fil_fish : sumIf(isFile,"count"),
      fil_kg   : roundHalfUp(sumIf(isFile,"kg"),2),
      pos_fish : sumIf(isPost,"count"),
      pos_kg   : roundHalfUp(sumIf(isPost,"kg"),2),
      lots     : new Set(arr.filter(x=>!isBlank(x.lot)).map(x=>normLotExact(x.lot))).size,
      refs     : new Set(arr.map(x=>(x.name||"")+"|"+(x.cust||""))).size
    };

    // ---------------- AJUSTES -----------------
    const aj = Array.isArray(ajustes[date]) ? ajustes[date] : [];

    let addTotalFish=0, addTotalKg=0;
    let extraKgOnly = 0;

    let addPregFish=0, addPregKg=0;
    let addLingFish=0, addLingKg=0;
    let addFilFish=0,  addFilKg=0;
    let addPosFish=0,  addPosKg=0;
    let addEviFish=0,  addEviKg=0;

    const notas=[];
    const lotAdds=[];

    for (const a of aj){
      const tipo = String(a.tipo||"").toLowerCase();
      const p = Number(a.peixes||0);
      const k = Number(a.kg)||0;
      const lote = a.lote ? String(a.lote) : null;
      const vis  = Number(a.visceras_kg || 0);
      const car  = Number(a.carcacas_kg || 0);
      const obs  = a.obs ? String(a.obs) : "";

      if (tipo === "pregado"){
        addPregFish += p; addPregKg += k;
        addTotalFish += p; addTotalKg += k;
      }
      else if (tipo === "linguado"){
        addLingFish += p; addLingKg += k;
        addTotalFish += p; addTotalKg += k;
      }
      else if (tipo === "filete"){
        addFilFish += p; addFilKg += k;
        addTotalFish += p; addTotalKg += k;
        extraKgOnly += (vis + car);
        if (lote) lotAdds.push({ lot:lote, count:p, kg:k });
      }
      else if (tipo === "posta"){
        addPosFish += p; addPosKg += k;
        addTotalFish += p; addTotalKg += k;
        extraKgOnly += (vis + car);
        if (lote) lotAdds.push({ lot:lote, count:p, kg:k });
      }
      else if (tipo === "eviscerado"){
        addEviKg += (vis + car);
        extraKgOnly += (vis + car);
      }
    }

    // ---------------- TOTAIS DO DIA -----------------
    const totalFish = baseFish + addTotalFish;
    const totalKg   = roundHalfUp(baseKg + addTotalKg + extraKgOnly, 2);
    const proc      = span - totalStop;
    const fpm       = proc>0 ? totalFish/proc : 0;

    indicadores.push({
      date,
      span_min:       roundHalfUp(span,4),
      total_stop_min: roundHalfUp(totalStop,4),
      proc_min:       roundHalfUp(proc,4),
      total_fish:     totalFish,
      total_kg:       totalKg,
      pregado_fish:   base.preg_fish + addPregFish,
      pregado_kg:     roundHalfUp(base.preg_kg + addPregKg,2),
      linguado_fish:  base.ling_fish + addLingFish,
      linguado_kg:    roundHalfUp(base.ling_kg + addLingKg,2),
      evi_fish:       base.evi_fish + addEviFish,
      evi_kg:         roundHalfUp(base.evi_kg + addEviKg,2),
      filete_fish:    base.fil_fish + addFilFish,
      filete_kg:      roundHalfUp(base.fil_kg + addFilKg,2),
      posta_fish:     base.pos_fish + addPosFish,
      posta_kg:       roundHalfUp(base.pos_kg + addPosKg,2),
      total_lots:     base.lots,
      total_refs:     base.refs,
      start_time:     start.toISOString(),
      end_time:       end.toISOString(),
      fish_per_min:   roundHalfUp(fpm,4),
      stops_count:    stopCount
    });

    // ---------------- TOTAIS POR LOTE -----------------
    const withLU = arr
      .map(x=>{
        const [lo,up] = extractLimits(x.name);
        return { lot:normLotExact(x.lot), lo, up, count:x.count, kg:x.kg };
      })
      .filter(r => !(r.count === 0 && r.kg === 0));

    for (const la of lotAdds){
      withLU.push({ 
        lot: normLotExact(la.lot), 
        lo: 0, 
        up: 0, 
        count: la.count||0, 
        kg: la.kg||0 
      });
    }

    const m=new Map();
    for (const r of withLU){
      const k = `${r.lot}|${r.lo}|${r.up}`;
      const prev = m.get(k) || { lot:r.lot, lo:r.lo, up:r.up, count:0, kg:0 };
      prev.count += r.count;
      prev.kg    += r.kg;
      m.set(k, prev);
    }

    let rowsTot = Array.from(m.values()).map(r=>({
      "Lot number": r.lot,
      "Lower (g)": r.lo,
      "Upper (g)": r.up,
      "product count": r.count,
      "Batch Weight (kg)": roundHalfUp(r.kg,2)
    }));

    rowsTot.sort((a, b) => {
      const la = a["Lot number"] ?? "";
      const lb = b["Lot number"] ?? "";
      const c = la.localeCompare(lb, "pt", { numeric: true, sensitivity: "base" });
      if (c) return c;
      const loA = a["Lower (g)"] ?? 0;
      const loB = b["Lower (g)"] ?? 0;
      if (loA !== loB) return loA - loB;
      const upA = a["Upper (g)"] === 0 ? Number.POSITIVE_INFINITY : a["Upper (g)"];
      const upB = b["Upper (g)"] === 0 ? Number.POSITIVE_INFINITY : b["Upper (g)"];
      if (upA !== upB) return upA - upB;
      return 0;
    });

    // TOTAL
    rowsTot.push({
      "Lot number":"TOTAL",
      "Lower (g)":0,
      "Upper (g)":0,
      "product count": rowsTot.reduce((s,x)=>s+x["product count"],0),
      "Batch Weight (kg)": roundHalfUp(rowsTot.reduce((s,x)=>s+x["Batch Weight (kg)"],0),2)
    });

    totaisPorDia[date]=rowsTot;
  }

  // ---------------- MENSAL -----------------
  indicadores.sort((a,b)=>a.date.localeCompare(b.date));

  const monthlyMap=new Map();
  for (const d of indicadores){
    const mk=d.date.slice(0,7);
    const m=monthlyMap.get(mk)||{ month:mk,total_fish:0,total_kg:0,total_proc_min:0,total_refs_sum:0,days_count:0 };
    m.total_fish+=d.total_fish;
    m.total_kg+=d.total_kg;
    m.total_proc_min+=d.proc_min;
    m.total_refs_sum+=d.total_refs;
    m.days_count++;
    monthlyMap.set(mk,m);
  }

  const monthly = Array.from(monthlyMap.values()).map(m=>({
    month:m.month,
    fish_per_min:(m.total_proc_min>0)?m.total_fish/m.total_proc_min:0,
    kg_per_min:(m.total_proc_min>0)?m.total_kg/m.total_proc_min:0,
    avg_weight:(m.total_fish>0)?m.total_kg/m.total_fish:0,
    avg_refs:m.total_refs_sum/m.days_count,
    days:m.days_count
  }));

  // ---------------- GUARDAR -----------------
  const dataObj = { data: indicadores, monthly, totais: totaisPorDia, stops: stopsByDay };

  fs.writeFileSync(
    path.join(WEB_DIR,"indicadores.js"),
    "window.__indicadores = " + JSON.stringify(dataObj) + ";",
    "utf8"
  );

  console.log("[OK] indicadores.js gerado.");
}

processAll();
