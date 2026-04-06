import fs from "fs";
import * as XLSX from "xlsx/xlsx.mjs";
XLSX.set_fs(fs);

import path from "path";
import { fileURLToPath } from "url";

// -----------------------------------------------------------
// ✅ Diretórios (Railway Volume)
// -----------------------------------------------------------
const AJUSTES_PATH = "/data/ajustes.json";
const PARAGENS_OVR_PATH = "/data/paragens_user.json";

if (!fs.existsSync(AJUSTES_PATH)) fs.writeFileSync(AJUSTES_PATH, "{}", "utf8");
if (!fs.existsSync(PARAGENS_OVR_PATH)) fs.writeFileSync(PARAGENS_OVR_PATH, "{}", "utf8");

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const BASE_DIR = __dirname;
const RAW_DIR  = BASE_DIR;
const WEB_DIR  = path.join(BASE_DIR, "web");

fs.mkdirSync(WEB_DIR, { recursive: true });

// -----------------------------------------------------------
// ✅ Convert Excel serial → { dateKey, minutes }
//   !!! SEM usar Date — ZERO DST BUGS
// -----------------------------------------------------------
function excelSerialToParts(sn) {
  if (typeof sn !== "number") return null;

  const days = Math.floor(sn);
  const frac = sn - days;

  // Excel epoch 1899‑12‑30 (UTC)
  const base = new Date(Date.UTC(1899, 11, 30));
  base.setUTCDate(base.getUTCDate() + days);

  const dateKey = base.toISOString().slice(0,10);
  const totalMinutes = Math.round(frac * 1440); // 24*60

  return { dateKey, minutes: totalMinutes };
}

// HH:MM a partir de minutos (sem Date)
function minToHHMM(m) {
  const h = Math.floor(m/60);
  const mm = m % 60;
  return String(h).padStart(2,"0")+":"+String(mm).padStart(2,"0");
}

// -----------------------------------------------------------
// ✅ Utils
// -----------------------------------------------------------
function roundHalfUp(n,dec=2){ const p=10**dec; return Math.sign(n)*Math.round(Math.abs(n)*p+1e-8)/p; }
function roundInt(n){ return Math.sign(n)*Math.round(Math.abs(n)+1e-8); }

function isBlank(v){ return !v || String(v).trim()==="" }
function minutesBetween(a,b){ return b - a; } // simples

function normLotExact(s){
  return String(s ?? "")
    .normalize("NFKC")
    .replace(/[\u00A0\u2000-\u200D]/g, "")
    .trim();
}

// -----------------------------------------------------------
// ✅ Período filtro
// -----------------------------------------------------------
const argInicio = process.argv[2];
const argFim    = process.argv[3];

function parseLocalYMD(s){
  if(!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  return s;
}

let dtInicio = parseLocalYMD(argInicio);
let dtFim    = parseLocalYMD(argFim);

function inPeriod(dateKey){
  if(!dtInicio||!dtFim) return true;
  return (dateKey >= dtInicio && dateKey <= dtFim);
}

// -----------------------------------------------------------
// ✅ Ler overrides de paragens
// -----------------------------------------------------------
function loadStopOverrides(){
  try{
    return JSON.parse(fs.readFileSync(PARAGENS_OVR_PATH,"utf8") || "{}");
  }catch(e){
    console.log("[AVISO] Falha overrides:", e.message);
    return {};
  }
}

// -----------------------------------------------------------
// ✅ Tipos de produto
// -----------------------------------------------------------
const RE_FILE  = /FILET/i;
const RE_POST  = /POSTA/i;
const RE_EVI   = /EVI/i;
const RE_PREG  = /(PREGADO|\bPREG\b)/i;
const RE_LING  = /(LINGUADO|\bLING\b)/i;

const isFile     = s => RE_FILE.test(s);
const isPost     = s => RE_POST.test(s);
const isEvi      = s => RE_EVI.test(s) && !isFile(s) && !isPost(s);
const isPreg     = s => RE_PREG.test(s) && !isFile(s) && !isPost(s) && !isEvi(s);
const isLing     = s => RE_LING.test(s) && !isFile(s) && !isPost(s) && !isEvi(s);

// -----------------------------------------------------------
// ✅ Leitura dos Excels (SEM Date)
// -----------------------------------------------------------
function readAll(){
  const files = fs.readdirSync(RAW_DIR)
    .filter(f=>f.toLowerCase().endsWith(".xlsx"))
    .filter(f=>!f.startsWith("~$"))
    .filter(f=>!f.startsWith("Totais_Lote_Sublotes_"))
    .map(f=>path.join(RAW_DIR,f));

  let rows=[], kept=0, raw=0;

  for (const file of files){
    try{
      const wb = XLSX.readFile(file);
      const ws = wb.Sheets[wb.SheetNames[0]];
      const arr = XLSX.utils.sheet_to_json(ws,{ defval:null });

      for (const r of arr){
        if (!(
          r["Production time"]!=null &&
          r["Product name"]   !=null &&
          r["Lot number"]     !=null &&
          r["product count"]  !=null &&
          r["Batch Weight (kg)"]!=null
        )) continue;

        const parts = excelSerialToParts(r["Production time"]);
        if(!parts) continue;
        raw++;

        if(!inPeriod(parts.dateKey)) continue;
        kept++;

        rows.push({
          dtMin: parts.minutes,
          dateKey: parts.dateKey,
          name: r["Product name"],
          lot : r["Lot number"],
          cust: r["Customer"],
          count: roundInt(Number(r["product count"])),
          kg   : roundHalfUp(Number(r["Batch Weight (kg)"]))
        });
      }

    }catch(e){
      console.log("[ERRO AO LER]", file, e.message);
    }
  }

  console.log(`[INFO] Mantidas ${kept}/${raw} linhas`);
  return rows;
}

// -----------------------------------------------------------
// ✅ Ler ajustes
// -----------------------------------------------------------
function loadAjustes(){
  try{
    return JSON.parse(fs.readFileSync(AJUSTES_PATH,"utf8")||"{}");
  }catch(e){
    console.log("[ERRO] ajustes:", e.message);
    return {};
  }
}

// -----------------------------------------------------------
// ✅ Classificar paragem
// -----------------------------------------------------------
const STOP_GAP_MIN = 10;
const LUNCH_MIN = 40;
const LUNCH_START = 11*60;
const LUNCH_END   = 14*60;

function overlapsLunch(startMin, endMin){
  return endMin > LUNCH_START && startMin < LUNCH_END;
}

function classifyStop(startMin, endMin, dur){
  return (dur >= LUNCH_MIN && overlapsLunch(startMin,endMin))
    ? "Almoço"
    : "Paragem";
}

// -----------------------------------------------------------
// ✅ LIMITE LOWER/UPPER
// -----------------------------------------------------------
function extractLimits(name) {
  if (!name) return [0,0];

  let s = String(name)
    .normalize("NFKC")
    .replace(/,/g, ".")
    .replace(/\s+/g, " ");

  const rgRange = /(\d+(?:\.\d+)?)[\s]*[-−–—][\s]*(\d+(?:\.\d+)?)/i;
  const rgLT    = /<\s*(\d+(?:\.\d+)?)/i;
  const rgPlus  = /\+\s*(\d+(?:\.\d+)?)/i;

  let lo = 0, up = 0, m = null;

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

  if (/EVI/i.test(s)) lo += 1;

  return [lo, up];
}

// -----------------------------------------------------------
// ✅ PROCESSAMENTO PRINCIPAL (SEM Date)
// -----------------------------------------------------------
function processAll(){
  const rows = readAll();
  const ajustes = loadAjustes();
  const stopOverrides = loadStopOverrides();

  if (rows.length===0){
    fs.writeFileSync(
      path.join(WEB_DIR,"indicadores.js"),
      'window.__indicadores={"data":[],"monthly":[],"totais":{},"stops":{}};',
      "utf8"
    );
    console.log("[OK] vazio");
    return;
  }

  // Agrupar por dia
  const byDate = new Map();
  for (const r of rows){
    if(!byDate.has(r.dateKey)) byDate.set(r.dateKey,[]);
    byDate.get(r.dateKey).push(r);
  }

  const indicadores=[];
  const totaisPorDia={};
  const stopsByDay={};

  // ---------------------------------------------------------
  // 🔥 PROCESSAR DIA A DIA
  // ---------------------------------------------------------
  for (const [date, arr] of byDate){
    arr.sort((a,b)=>a.dtMin - b.dtMin);

    // ---------- PARAGENS ----------
    let totalStop=0, stopCount=0;
    const stops=[];

    for (let i=1;i<arr.length;i++){
      const prev = arr[i-1].dtMin;
      const curr = arr[i].dtMin;
      const delta = curr - prev;

      if (delta > STOP_GAP_MIN){
        stopCount++;
        totalStop += delta;

        const id = `${prev}_${curr}`;
        let tipo = classifyStop(prev,curr,delta);

        const ovr = stopOverrides?.[date]?.[id];
        if (ovr && String(ovr).trim() !== "") tipo = String(ovr).trim();

        stops.push({
          id,
          start: minToHHMM(prev),
          end  : minToHHMM(curr),
          minutes: roundHalfUp(delta,2),
          type: tipo
        });
      }
    }
    stopsByDay[date] = stops;

    // ---------- BASE ----------
    const startMin = arr[0].dtMin;
    const endMin   = arr[arr.length-1].dtMin;
    const span     = endMin - startMin;

    const baseFish = arr.reduce((s,x)=>s+x.count,0);
    const baseKg   = arr.reduce((s,x)=>s+x.kg,0);

    const sumIf=(pred,type)=>
      arr.filter(x=>pred(x.name||""))
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

    // ---------- AJUSTES ----------
    const aj = Array.isArray(ajustes[date]) ? ajustes[date] : [];

    let addPregFish=0, addPregKg=0;
    let addLingFish=0, addLingKg=0;
    let addFilFish=0, addFilKg=0;
    let addPosFish=0, addPosKg=0;
    let addEviKg=0;

    let addTotalFish=0, addTotalKg=0;
    let extraKgOnly=0;

    const lotAdds=[];

    for (const a of aj){
      const tipo = String(a.tipo||"").toLowerCase();
      const p = Number(a.peixes||0);
      const k = Number(a.kg||0);
      const vc = Number(a.visceras_kg||0) + Number(a.carcacas_kg||0);
      const lote = a.lote ? String(a.lote) : null;

      if (tipo==="pregado") {
        addPregFish+=p; addPregKg+=k;
        addTotalFish+=p; addTotalKg+=k;
      }
      else if (tipo==="linguado"){
        addLingFish+=p; addLingKg+=k;
        addTotalFish+=p; addTotalKg+=k;
      }
      else if (tipo==="filete"){
        addFilFish+=p; addFilKg+=k;
        addTotalFish+=p; addTotalKg+=k;
        extraKgOnly+=vc;
        if (lote) lotAdds.push({lot:lote,count:p,kg:k});
      }
      else if (tipo==="posta"){
        addPosFish+=p; addPosKg+=k;
        addTotalFish+=p; addTotalKg+=k;
        extraKgOnly+=vc;
        if (lote) lotAdds.push({lot:lote,count:p,kg:k});
      }
      else if (tipo==="eviscerado"){
        addEviKg+=vc;
        extraKgOnly+=vc;
      }
    }

    // ---------- TOTAIS ----------
    const totalFish = baseFish + addTotalFish;
    const totalKg   = roundHalfUp(baseKg + addTotalKg + extraKgOnly,2);
    const proc = span - totalStop;
    const fpm = proc>0 ? totalFish/proc : 0;

    indicadores.push({
      date,
      span_min: span,
      total_stop_min: totalStop,
      proc_min: proc,
      total_fish: totalFish,
      total_kg: totalKg,
      pregado_fish: base.preg_fish + addPregFish,
      pregado_kg  : roundHalfUp(base.preg_kg + addPregKg,2),
      linguado_fish: base.ling_fish + addLingFish,
      linguado_kg  : roundHalfUp(base.ling_kg + addLingKg,2),
      evi_fish: base.evi_fish,
      evi_kg  : roundHalfUp(base.evi_kg + addEviKg,2),
      filete_fish: base.fil_fish + addFilFish,
      filete_kg  : roundHalfUp(base.fil_kg + addFilKg,2),
      posta_fish : base.pos_fish + addPosFish,
      posta_kg   : roundHalfUp(base.pos_kg + addPosKg,2),
      total_lots : base.lots,
      total_refs : base.refs,
      start_time : minToHHMM(startMin),
      end_time   : minToHHMM(endMin),
      fish_per_min: roundHalfUp(fpm,4),
      stops_count: stopCount
    });

    // ---------- TOTAIS POR LOTE ----------
    const withLU = arr
      .map(x=>{
        const [lo,up] = extractLimits(x.name);
        return { lot:normLotExact(x.lot), lo, up, count:x.count, kg:x.kg };
      })
      .filter(r => !(r.count===0 && r.kg===0));

    for (const la of lotAdds){
      withLU.push({ lot:normLotExact(la.lot), lo:0, up:0, count:la.count, kg:la.kg });
    }

    const m=new Map();
    for (const r of withLU){
      const key=`${r.lot}|${r.lo}|${r.up}`;
      if (!m.has(key)) m.set(key,{...r});
      else {
        m.get(key).count += r.count;
        m.get(key).kg    += r.kg;
      }
    }

    let rowsTot = [...m.values()].map(r=>({
      "Lot number": r.lot,
      "Lower (g)": r.lo,
      "Upper (g)": r.up,
      "product count": r.count,
      "Batch Weight (kg)": roundHalfUp(r.kg,2)
    }));

    rowsTot.sort((a,b)=>{
      const c = (a["Lot number"]||"").localeCompare(b["Lot number"]||"","pt",{numeric:true});
      if (c) return c;
      return (a["Lower (g)"]||0) - (b["Lower (g)"]||0);
    });

    rowsTot.push({
      "Lot number":"TOTAL",
      "Lower (g)":0,
      "Upper (g)":0,
      "product count": rowsTot.reduce((s,x)=>s+x["product count"],0),
      "Batch Weight (kg)": roundHalfUp(rowsTot.reduce((s,x)=>s+x["Batch Weight (kg)"],0),2)
    });

    totaisPorDia[date]=rowsTot;
  }

  // ---------------------------------------------------------
  // MENSAL
  // ---------------------------------------------------------
  indicadores.sort((a,b)=>a.date.localeCompare(b.date));

  const monthlyMap=new Map();

  for (const d of indicadores){
    const mk=d.date.slice(0,7);
    if (!monthlyMap.has(mk))
      monthlyMap.set(mk,{month:mk,total_fish:0,total_kg:0,total_proc_min:0,total_refs_sum:0,days_count:0});

    const m=monthlyMap.get(mk);
    m.total_fish+=d.total_fish;
    m.total_kg+=d.total_kg;
    m.total_proc_min+=d.proc_min;
    m.total_refs_sum+=d.total_refs;
    m.days_count++;
  }

  const monthly=[...monthlyMap.values()].map(m=>({
    month:m.month,
    fish_per_min:(m.total_proc_min>0? m.total_fish/m.total_proc_min : 0),
    kg_per_min  :(m.total_proc_min>0? m.total_kg/m.total_proc_min : 0),
    avg_weight  :(m.total_fish>0? m.total_kg/m.total_fish : 0),
    avg_refs:m.total_refs_sum/m.days_count,
    days:m.days_count
  }));

  const dataObj = { data: indicadores, monthly, totais: totaisPorDia, stops: stopsByDay };

  fs.writeFileSync(
    path.join(WEB_DIR,"indicadores.js"),
    "window.__indicadores = " + JSON.stringify(dataObj) + ";",
    "utf8"
  );

  console.log("[✅ OK] indicadores.js gerado sem DST.");
}

processAll();
