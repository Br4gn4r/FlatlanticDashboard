import express from "express";
import cors from "cors";
import fs from "fs";
import path from "path";
import { exec } from "child_process";
import { fileURLToPath } from "url";
import cookieParser from "cookie-parser";

// ================== CONFIGURAÇÃO ==================
const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const BASE       = __dirname;
const WEB_DIR = path.join(BASE, "web");
const LOG_FILE = path.join(BASE, "server-log.txt");
const AJUSTES_PATH = path.join(BASE, "ajustes.json");
const PARAGENS_OVR_PATH = path.join(BASE, "paragens_user.json");

// ================== APP ==================
const app = express();
app.use(cors());
app.use(express.json());
app.use(cookieParser());
app.use(express.urlencoded({ extended: true }));

const PASSWORD = "flatlantic";

// ================== SERVIR WEBSITE ==================
app.use(express.static(WEB_DIR, {
  etag: false,
  lastModified: false,
  cacheControl: false,
}));


// Página pública de login
app.get("/login", (req, res) => {
  res.sendFile(path.join(WEB_DIR, "login.html"));
});

// API de login (define cookie)
app.post("/api/login", (req, res) => {
  const { password } = req.body;
  if (password === PASSWORD) {
    res.cookie("auth", "ok", { httpOnly: false });
    return res.json({ ok: true });
  }
  return res.json({ ok: false });
});

// Logout (remove cookie)
app.get("/logout", (req, res) => {
  res.clearCookie("auth");
  return res.redirect("/login");
});


// ================== AUTENTICAÇÃO ==================
app.use((req, res, next) => {

  // Rotas e ficheiros permitidos sem autenticação
  const publicPaths = [
    "/login",
    "/api/login",
    "/FlatlanticLogo.jpg",
    "/favicon.ico",
    "/update",
    "/api/upload",
    "/ajuste",
    "/ajustes",
    "/paragem/editar",
    "/paragens/overrides"
  ];

  // Permitir ficheiros estáticos
  if (req.path.match(/\.(css|js|png|jpg|jpeg|gif|svg|ico|html)$/)) {
    return next();
  }

  // Permitir qualquer rota que comece por estes prefixos
  if (publicPaths.some(p => req.path.startsWith(p))) {
    return next();
  }

  // Se estiver autenticado → OK
  if (req.cookies?.auth === "ok") {
    return next();
  }

  // Caso contrário → redirecionar para login
  return res.redirect("/login");
});

// Página inicial → dashboard (protegida)
app.get("/", (req, res) => {
  res.sendFile(path.join(WEB_DIR, "dashboard.html"));
});

// ---- Helpers ----
function log(msg) {
  try {
    fs.appendFileSync(LOG_FILE, `[${new Date().toISOString()}] ${msg}\n`);
  } catch (_) {}
}
function ensureJSON(filePath, fallback = {}) {
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, JSON.stringify(fallback, null, 2), "utf8");
  }
}

// Garante ficheiros base
ensureJSON(AJUSTES_PATH, {});
ensureJSON(PARAGENS_OVR_PATH, {});

// ================== ROTAS ==================

// ✅ Upload simples para a raiz do projeto
import multer from "multer";

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, BASE), // grava na raiz C:\FlatlanticDashboard
  filename: (req, file, cb) => cb(null, file.originalname)
});
const upload = multer({ storage });

// ✅ Upload simples para a raiz do projeto (BASE)
// ✅ Remove automaticamente todos os .xlsx antes de gravar o novo ficheiro

app.post("/api/upload", (req, res, next) => {
  // 1) APAGAR TODOS OS EXCEL ANTIGOS
  try {
    const files = fs.readdirSync(BASE);
    files
      .filter(f => f.toLowerCase().endsWith(".xlsx"))
      .forEach(f => {
        try {
          fs.unlinkSync(path.join(BASE, f));
        } catch (e) {
          console.warn("Falha ao remover", f, e.message);
        }
      });
  } catch (e) {
    console.warn("Erro ao listar diretoria para limpeza:", e.message);
  }

  // 2) PROSSEGUIR PARA O UPLOAD
  upload.single("file")(req, res, function (err) {
    if (err) return res.status(500).json({ ok: false, msg: err.message });
    if (!req.file) return res.json({ ok: false });

    return res.json({ ok: true });
  });
});

// 1) UPDATE → Executa o processar.mjs com (opcional) período inicio/fim
app.get("/update", (req, res) => {
  const { inicio, fim } = req.query;
  const cmd = (inicio && fim)
    ? `node processar.mjs "${inicio}" "${fim}"`
    : `node processar.mjs`;

  log(`[UPDATE] EXEC: ${cmd}`);

  exec(cmd, { cwd: BASE }, (err, stdout, stderr) => {
    if (stdout) log("[STDOUT] " + stdout);
    if (stderr) log("[STDERR] " + stderr);
    if (err) {
      log("[ERRO UPDATE] " + (err.stack || err.message));
      return res.status(500).send("Erro ao atualizar");
    }
    log("[UPDATE] OK");
    res.send("OK");
  });
});

// 2) AJUSTES — criar
app.post("/ajuste", (req, res) => {
  try {
    const { dia, tipo, peixes, kg, lote, visceras_kg, carcacas_kg, obs } = req.body || {};

    if (!dia || !/^\d{4}-\d{2}-\d{2}$/.test(dia)) {
      return res.status(400).json({ ok: false, msg: "Dia inválido (YYYY-MM-DD)" });
    }

    const tipoNorm = String(tipo || "").toLowerCase();
    const tiposValidos = ["pregado", "linguado", "filete", "posta", "eviscerado"];
    if (!tiposValidos.includes(tipoNorm)) {
      return res.status(400).json({ ok: false, msg: "Tipo inválido" });
    }

    const nPeixes = Number(peixes || 0);
    const nKg     = Number(kg || 0);

    const usaVC = (tipoNorm === "filete" || tipoNorm === "posta" || tipoNorm === "eviscerado");
    const visc  = usaVC ? Number(visceras_kg || 0) : 0;
    const carc  = usaVC ? Number(carcacas_kg || 0) : 0;

    if (tipoNorm === "eviscerado") {
      if (visc <= 0 && carc <= 0) {
        return res.status(400).json({ ok: false, msg: "Indique vísceras e/ou carcaças > 0" });
      }
    } else if (tipoNorm === "pregado" || tipoNorm === "linguado") {
      if (nPeixes <= 0 && nKg <= 0) {
        return res.status(400).json({ ok: false, msg: "Indique peixes e/ou kg > 0" });
      }
    } else if (tipoNorm === "filete" || tipoNorm === "posta") {
      if (nPeixes === 0 && nKg === 0 && visc === 0 && carc === 0) {
        return res.status(400).json({ ok: false, msg: "Indique algum valor (peixes, kg ou v/c)" });
      }
      if (!lote) {
        return res.status(400).json({ ok: false, msg: "Lote obrigatório" });
      }
    }

    if (visc < 0 || carc < 0) {
      return res.status(400).json({ ok: false, msg: "Vísceras/Carcaças inválidas" });
    }

    ensureJSON(AJUSTES_PATH, {});
    const current = JSON.parse(fs.readFileSync(AJUSTES_PATH, "utf8") || "{}");
    const arr = current[dia] || [];
    const now = new Date().toISOString();

    arr.push({
      tipo: tipoNorm,
      peixes: nPeixes,
      kg: nKg,
      lote: (tipoNorm === "filete" || tipoNorm === "posta") ? String(lote) : null,
      visceras_kg: visc,
      carcacas_kg: carc,
      obs: obs ? String(obs) : "",
      id: now,
      timestamp: now
    });

    current[dia] = arr;
    fs.writeFileSync(AJUSTES_PATH, JSON.stringify(current, null, 2), "utf8");

    res.json({ ok: true });

  } catch (e) {
    log("[ERRO /ajuste] " + (e.stack || e.message));
    res.status(500).json({ ok: false, msg: "Falha ao gravar ajuste" });
  }
});

// 3) AJUSTES — listar por dia, ou todos
app.get("/ajustes", (req, res) => {
  try {
    ensureJSON(AJUSTES_PATH, {});
    const current = JSON.parse(fs.readFileSync(AJUSTES_PATH, "utf8") || "{}");

    const { dia } = req.query;

    if (dia) {
      return res.json({
        ok: true,
        dia,
        ajustes: current[dia] || []
      });
    }

    res.json({ ok: true, all: current });

  } catch (e) {
    log("[ERRO /ajustes] " + (e.stack || e.message));
    res.status(500).json({ ok: false, msg: "Falha ao ler ajustes" });
  }
});

// 4) AJUSTES — remover
app.delete("/ajuste/:dia/:id", (req, res) => {
  try {
    const { dia, id } = req.params;

    if (!dia || !/^\d{4}-\d{2}-\d{2}$/.test(dia))
      return res.status(400).json({ ok: false, msg: "Dia inválido (YYYY-MM-DD)" });

    ensureJSON(AJUSTES_PATH, {});
    const current = JSON.parse(fs.readFileSync(AJUSTES_PATH, "utf8") || "{}");

    const arr = current[dia] || [];
    const novoArr = arr.filter(a => String(a.id) !== String(id));

    if (novoArr.length === arr.length)
      return res.status(404).json({ ok: false, msg: "Ajuste não encontrado" });

    if (novoArr.length > 0)
      current[dia] = novoArr;
    else
      delete current[dia];

    fs.writeFileSync(AJUSTES_PATH, JSON.stringify(current, null, 2), "utf8");

    res.json({ ok: true });

  } catch (e) {
    log("[ERRO DELETE /ajuste] " + (e.stack || e.message));
    res.status(500).json({ ok: false, msg: "Falha ao remover ajuste" });
  }
});

// 5) PARAGENS — editar tipo
app.post("/paragem/editar", (req, res) => {
  try {
    const { dia, id, tipo } = req.body || {};

    if (!dia || !/^\d{4}-\d{2}-\d{2}$/.test(dia))
      return res.status(400).json({ ok: false, msg: "Dia inválido (YYYY-MM-DD)" });

    if (!id || typeof id !== "string")
      return res.status(400).json({ ok: false, msg: "ID inválido" });

    const tipoText = String(tipo || "").trim();
    if (!tipoText) return res.status(400).json({ ok: false, msg: "Tipo em branco" });

    ensureJSON(PARAGENS_OVR_PATH, {});
    const current = JSON.parse(fs.readFileSync(PARAGENS_OVR_PATH, "utf8") || "{}");

    const mapDia = current[dia] || {};
    mapDia[id] = tipoText;
    current[dia] = mapDia;

    fs.writeFileSync(PARAGENS_OVR_PATH, JSON.stringify(current, null, 2), "utf8");

    res.json({ ok: true });
  } catch (e) {
    log("[ERRO /paragem/editar] " + (e.stack || e.message));
    res.status(500).json({ ok: false, msg: "Falha ao gravar tipo da paragem" });
  }
});

// 6) PARAGENS — repor override
app.delete("/paragem/editar/:dia/:id", (req, res) => {
  try {
    const { dia, id } = req.params;

    if (!dia || !/^\d{4}-\d{2}-\d{2}$/.test(dia))
      return res.status(400).json({ ok: false, msg: "Dia inválido (YYYY-MM-DD)" });

    ensureJSON(PARAGENS_OVR_PATH, {});
    const current = JSON.parse(fs.readFileSync(PARAGENS_OVR_PATH, "utf8") || "{}");

    const mapDia = current[dia] || {};
    if (!mapDia[id]) return res.status(404).json({ ok: false, msg: "Override não encontrado" });

    delete mapDia[id];
    if (Object.keys(mapDia).length)
      current[dia] = mapDia;
    else
      delete current[dia];

    fs.writeFileSync(PARAGENS_OVR_PATH, JSON.stringify(current, null, 2), "utf8");

    res.json({ ok: true });
  } catch (e) {
    log("[ERRO DELETE /paragem/editar] " + (e.stack || e.message));
    res.status(500).json({ ok: false, msg: "Falha ao remover override" });
  }
});

// 7) PARAGENS — obter overrides
app.get("/paragens/overrides", (req, res) => {
  try {
    if (!fs.existsSync(PARAGENS_OVR_PATH))
      return res.json({ ok: true, overrides: {} });

    const data = JSON.parse(fs.readFileSync(PARAGENS_OVR_PATH, "utf8") || "{}");
    res.json({ ok: true, overrides: data });
  } catch (e) {
    log("[ERRO GET /paragens/overrides] " + (e.stack || e.message));
    res.status(500).json({ ok: false, msg: "Falha a ler overrides" });
  }
});

// ================== START ==================
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Servidor iniciado na porta ${PORT}`);
});
