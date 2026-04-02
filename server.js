import express from "express";
import cors from "cors";
import fs from "fs";
import path from "path";
import { exec } from "child_process";
import { fileURLToPath } from "url";
import cookieParser from "cookie-parser";
import multer from "multer";

// ================== BASE DIRS ==================
const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const BASE       = __dirname;

// ✅ Diretório persistente no Railway Volume
const DATA_DIR = "/data";

// Criar diretoria persistente caso ainda não exista
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const AJUSTES_PATH = path.join(DATA_DIR, "ajustes.json");
const PARAGENS_OVR_PATH = path.join(DATA_DIR, "paragens_user.json");

// Função para garantir JSON existente
function ensureJSON(filePath, fallback = {}) {
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, JSON.stringify(fallback, null, 2), "utf8");
  }
}

ensureJSON(AJUSTES_PATH, {});
ensureJSON(PARAGENS_OVR_PATH, {});

// ================== WEB DIR ==================
const WEB_DIR = path.join(BASE, "web");
const LOG_FILE = path.join(BASE, "server-log.txt");

// ================== APP ==================
const app = express();
app.use(cors());
app.use(express.json({ limit: "50mb" }));
app.use(cookieParser());
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

const PASSWORD = "flatlantic";

// ================== SERVIR SITE ==================
app.use(express.static(WEB_DIR, {
  etag: false,
  lastModified: false,
  cacheControl: false,
}));

// ================== LOGIN ==================
app.get("/login", (req, res) => {
  res.sendFile(path.join(WEB_DIR, "login.html"));
});

app.post("/api/login", (req, res) => {
  const { password } = req.body;
  if (password === PASSWORD) {
    res.cookie("auth", "ok", { httpOnly: false });
    return res.json({ ok: true });
  }
  return res.json({ ok: false });
});

app.get("/logout", (req, res) => {
  res.clearCookie("auth");
  return res.redirect("/login");
});

// ================== AUTENTICAÇÃO ==================
app.use((req, res, next) => {
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

  if (req.path.match(/\.(css|js|png|jpg|jpeg|gif|svg|ico|html)$/)) {
    return next();
  }

  if (publicPaths.some(p => req.path.startsWith(p))) {
    return next();
  }

  if (req.cookies?.auth === "ok") {
    return next();
  }

  return res.redirect("/login");
});

// ================== HOME ==================
app.get("/", (req, res) => {
  res.sendFile(path.join(WEB_DIR, "dashboard.html"));
});

// ================== UPLOAD ==================
// ✅ Limpa excels antigos antes de gravar o novo
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, BASE),
  filename: (req, file, cb) => cb(null, file.originalname)
});
const upload = multer({ storage });

app.post("/api/upload", (req, res, next) => {
  try {
    const files = fs.readdirSync(BASE);
    files
      .filter(f => f.toLowerCase().endsWith(".xlsx"))
      .forEach(f => fs.unlinkSync(path.join(BASE, f)));
  } catch (e) {
    console.warn("Falha ao limpar excels:", e.message);
  }

  upload.single("file")(req, res, err => {
    if (err) return res.status(500).json({ ok: false, msg: err.message });
    if (!req.file) return res.json({ ok: false });
    return res.json({ ok: true });
  });
});

// ================== UPDATE (processar.mjs) ==================
function log(msg) {
  try {
    fs.appendFileSync(LOG_FILE, `[${new Date().toISOString()}] ${msg}\n`);
  } catch (_) {}
}

app.get("/update", (req, res) => {
  const { inicio, fim } = req.query;
  const cmd = (inicio && fim)
    ? `node processar.mjs "${inicio}" "${fim}"`
    : `node processar.mjs`;

  log("[UPDATE] EXEC: " + cmd);

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

// ================== AJUSTES ==================
app.post("/ajuste", (req, res) => {
  try {
    const { dia, tipo, peixes, kg, lote, visceras_kg, carcacas_kg, obs } = req.body || {};

    if (!dia || !/^\d{4}-\d{2}-\d{2}$/.test(dia))
      return res.status(400).json({ ok: false, msg: "Dia inválido" });

    const tipoNorm = String(tipo || "").toLowerCase();

    ensureJSON(AJUSTES_PATH, {});
    const current = JSON.parse(fs.readFileSync(AJUSTES_PATH, "utf8"));
    const arr = current[dia] || [];
    const now = new Date().toISOString();

    arr.push({
      tipo: tipoNorm,
      peixes: Number(peixes || 0),
      kg: Number(kg || 0),
      lote: lote || null,
      visceras_kg: Number(visceras_kg || 0),
      carcacas_kg: Number(carcacas_kg || 0),
      obs: obs || "",
      id: now,
      timestamp: now
    });

    current[dia] = arr;
    fs.writeFileSync(AJUSTES_PATH, JSON.stringify(current, null, 2));

    res.json({ ok: true });

  } catch (e) {
    log("[ERRO /ajuste] " + e.message);
    res.status(500).json({ ok: false });
  }
});

app.get("/ajustes", (req, res) => {
  ensureJSON(AJUSTES_PATH, {});
  const data = JSON.parse(fs.readFileSync(AJUSTES_PATH, "utf8"));
  const { dia } = req.query;
  if (dia) return res.json({ ok: true, dia, ajustes: data[dia] || [] });
  res.json({ ok: true, all: data });
});

app.delete("/ajuste/:dia/:id", (req, res) => {
  try {
    const { dia, id } = req.params;

    ensureJSON(AJUSTES_PATH, {});
    const data = JSON.parse(fs.readFileSync(AJUSTES_PATH, "utf8"));
    const arr = data[dia] || [];

    const novo = arr.filter(a => a.id !== id);

    if (novo.length === arr.length)
      return res.status(404).json({ ok: false });

    if (novo.length) data[dia] = novo;
    else delete data[dia];

    fs.writeFileSync(AJUSTES_PATH, JSON.stringify(data, null, 2));
    res.json({ ok: true });

  } catch (e) {
    res.status(500).json({ ok: false });
  }
});

// ================== IMPORTAR DADOS PARA O VOLUME ==================
app.post("/importar-dados", (req, res) => {
  try {
    const { ajustes, paragens } = req.body || {};

    // Importar AJUSTES (se fornecido)
    if (ajustes && typeof ajustes === "object") {
      fs.writeFileSync(AJUSTES_PATH, JSON.stringify(ajustes, null, 2), "utf8");
    }

    // Importar PARAGENS (se fornecido)
    if (paragens && typeof paragens === "object") {
      fs.writeFileSync(PARAGENS_OVR_PATH, JSON.stringify(paragens, null, 2), "utf8");
    }

    return res.json({ ok: true, msg: "Dados importados com sucesso." });

  } catch (e) {
    console.error("Erro /importar-dados:", e);
    return res.status(500).json({ ok: false, erro: e.message });
  }
});

// ================== PARAGENS ==================
app.post("/paragem/editar", (req, res) => {
  try {
    const { dia, id, tipo } = req.body;

    ensureJSON(PARAGENS_OVR_PATH, {});
    const data = JSON.parse(fs.readFileSync(PARAGENS_OVR_PATH, "utf8"));

    const map = data[dia] || {};
    map[id] = tipo;
    data[dia] = map;

    fs.writeFileSync(PARAGENS_OVR_PATH, JSON.stringify(data, null, 2));

    res.json({ ok: true });

  } catch (e) {
    res.status(500).json({ ok: false });
  }
});

app.delete("/paragem/editar/:dia/:id", (req, res) => {
  const { dia, id } = req.params;

  ensureJSON(PARAGENS_OVR_PATH, {});
  const data = JSON.parse(fs.readFileSync(PARAGENS_OVR_PATH, "utf8"));

  if (!data[dia] || !data[dia][id])
    return res.status(404).json({ ok: false });

  delete data[dia][id];
  if (!Object.keys(data[dia]).length) delete data[dia];

  fs.writeFileSync(PARAGENS_OVR_PATH, JSON.stringify(data, null, 2));

  res.json({ ok: true });
});

app.get("/paragens/overrides", (req, res) => {
  ensureJSON(PARAGENS_OVR_PATH, {});
  const data = JSON.parse(fs.readFileSync(PARAGENS_OVR_PATH, "utf8"));
  res.json({ ok: true, overrides: data });
});

// ================== START ==================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor iniciado na porta ${PORT}`);
});
