const CONFIG = {
  firebaseHost: "tendedero-inteligente-df4a2-default-rtdb.firebaseio.com",
  deviceId: "tendedero_01",
  refreshMs: 5000
};

const $ = (id) => document.getElementById(id);

const ui = {
  connectionText: $("connectionText"),
  climateText: $("climateText"),
  mainTitle: $("mainTitle"),
  mainDetail: $("mainDetail"),
  positionSummary: $("positionSummary"),
  clothesState: $("clothesState"),
  clothesDetail: $("clothesDetail"),
  drynessBar: $("drynessBar"),
  dryingCommandText: $("dryingCommandText"),
  installButton: $("installButton"),
  notifyButton: $("notifyButton"),
  refreshButton: $("refreshButton"),
  positionValue: $("positionValue"),
  rainValue: $("rainValue"),
  lightValue: $("lightValue"),
  nightValue: $("nightValue"),
  ipValue: $("ipValue"),
  rssiValue: $("rssiValue"),
  updatedValue: $("updatedValue"),
  deviceValue: $("deviceValue"),
  historyList: $("historyList")
};

let lastAlertKey = "";
let timer = null;
let installPromptEvent = null;

// ================================================================
//  CONTADOR DE SECADO
//
//  Vive en la app (localStorage). Corre en tiempo real cada segundo.
//  Velocidad según estado del tendedero (clima Arequipa ~50% HR nocturna):
//    EXTENDIDO día seco  → velocidad 1.0  (normal)
//    RETRAIDO de noche   → velocidad 0.5  (mitad, +~2h extra en noche típica)
//    LLUVIA activa       → velocidad 0.0  (pausado, no seca con lluvia)
// ================================================================

const DRYING = {
  tendederoPosition: "EXTENDIDO",
  isRaining: false,
  isNight:   false,

  active:      false,
  label:       "",
  totalMs:     0,
  remainingMs: 0,
  lastTick:    0,
  tickTimer:   null,

  STORAGE_KEY: "tendedero:drying",

  DURATIONS: {
    CHORREANDO:   480,
    HUMEDA:       180,
    CENTRIFUGADA: 120,
    SEMI_SECA:    45
  },

  speedFactor() {
    if (this.isRaining) return 0;
    if (this.isNight)   return 0.5;
    return 1;
  },

  save() {
    if (!this.active) { localStorage.removeItem(this.STORAGE_KEY); return; }
    localStorage.setItem(this.STORAGE_KEY, JSON.stringify({
      label:       this.label,
      totalMs:     this.totalMs,
      remainingMs: this.remainingMs,
      lastTick:    Date.now()
    }));
  },

  load() {
    const raw = localStorage.getItem(this.STORAGE_KEY);
    if (!raw) return false;
    try {
      const data    = JSON.parse(raw);
      const elapsed = Date.now() - (data.lastTick || Date.now());
      const remaining = Math.max(0, data.remainingMs - elapsed);
      if (remaining <= 0) { localStorage.removeItem(this.STORAGE_KEY); return false; }
      this.label       = data.label;
      this.totalMs     = data.totalMs;
      this.remainingMs = remaining;
      this.active      = true;
      this.lastTick    = Date.now();
      return true;
    } catch {
      localStorage.removeItem(this.STORAGE_KEY);
      return false;
    }
  },

  start(label) {
    const minutes = this.DURATIONS[label];
    if (!minutes) return;
    this.active      = true;
    this.label       = label;
    this.totalMs     = minutes * 60 * 1000;
    this.remainingMs = this.totalMs;
    this.lastTick    = Date.now();
    this.save();
    this.startTick();
    renderDryingTimer();
  },

  cancel() {
    this.active = false;
    this.label  = "";
    if (this.tickTimer) clearInterval(this.tickTimer);
    this.tickTimer = null;
    localStorage.removeItem(this.STORAGE_KEY);
    renderDryingTimer();
  },

  startTick() {
    if (this.tickTimer) clearInterval(this.tickTimer);
    this.tickTimer = setInterval(() => this.tick(), 1000);
  },

  tick() {
    if (!this.active) return;
    const now     = Date.now();
    const elapsed = now - this.lastTick;
    this.lastTick = now;
    this.remainingMs = Math.max(0, this.remainingMs - elapsed * this.speedFactor());
    this.save();
    renderDryingTimer();
    if (this.remainingMs <= 0) {
      this.active = false;
      if (this.tickTimer) clearInterval(this.tickTimer);
      this.tickTimer = null;
      localStorage.removeItem(this.STORAGE_KEY);
      onDryingComplete();
    }
  }
};

function formatRemaining(ms) {
  if (ms <= 0) return "Listo";
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2,"0")}m ${String(s).padStart(2,"0")}s`;
  if (m > 0) return `${m}m ${String(s).padStart(2,"0")}s`;
  return `${s}s`;
}

function renderDryingTimer() {
  if (!DRYING.active) {
    ui.dryingCommandText.textContent = "Elige el estado de la ropa y la app enviara la orden al tendedero.";
    return;
  }
  const percent = Math.round((DRYING.remainingMs / DRYING.totalMs) * 100);
  ui.drynessBar.style.width = `${percent}%`;

  const speed = DRYING.speedFactor();
  const modeText = speed === 0 ? " ⏸ Pausado (lluvia)"
                 : speed < 1  ? " 🌙 Secado lento (noche - Arequipa)"
                 :               " ☀️ Secando";

  ui.dryingCommandText.textContent =
    `${labelDrying(DRYING.label)} · Restante: ${formatRemaining(DRYING.remainingMs)}${modeText}`;
}

async function onDryingComplete() {
  ui.dryingCommandText.textContent = "✅ Secado completo. Retrayendo el tendedero...";
  ui.drynessBar.style.width = "0%";

  if ("Notification" in window && Notification.permission === "granted") {
    navigator.serviceWorker?.ready.then((reg) => {
      reg.showNotification("Mi Tendedero", {
        body:  "¡La ropa esta seca! El tendedero se esta retrayendo.",
        icon:  "./icons/icon.svg",
        badge: "./icons/icon.svg",
        tag:   "tendedero-seco"
      });
    });
  }

  const command = {
    accion:      "SECAR_TERMINADO",
    estado_ropa: DRYING.label,
    origen:      "app_movil",
    creado_en:   new Date().toISOString(),
    procesado:   false
  };

  try {
    const res = await fetch(endpoint("comando"), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(command)
    });
    if (!res.ok) throw new Error(`Firebase ${res.status}`);
  } catch (err) {
    console.error("[Drying] Error al enviar SECAR_TERMINADO:", err);
    ui.dryingCommandText.textContent = "Secado completo, pero no se pudo enviar la orden. Revisa conexion.";
  }
}

// ================================================================
//  FUNCIONES ORIGINALES — sin cambios
// ================================================================

function endpoint(path) {
  const cleanPath = path.replace(/^\/+/, "");
  return `https://${CONFIG.firebaseHost}/tendedero/${CONFIG.deviceId}/${cleanPath}.json`;
}

function setText(node, value) {
  node.textContent = value === undefined || value === null || value === "" ? "--" : String(value);
}

function friendlyPosition(posicion, estado) {
  if (posicion) return posicion;
  if (String(estado || "").includes("RETRAIDO")) return "RETRAIDO";
  if (estado === "EXTENDIDO") return "EXTENDIDO";
  return "--";
}

function getStatusCopy(estado) {
  const rain     = estado?.lloviendo === true;
  const night    = estado?.modo_noche === true;
  const position = friendlyPosition(estado?.posicion, estado?.estado);

  if (rain)  return { climate: "LLUVIA DETECTADA", title: "Ropa protegida",      detail: "El tendedero se retrajo automaticamente por lluvia.", alert: "Lluvia detectada. Tendedero retraido automaticamente." };
  if (night) return { climate: "MODO NOCHE",       title: "Guardado por noche",  detail: "El tendedero se mantiene retraido por oscuridad.",    alert: "Modo noche activado. Tendedero retraido preventivamente." };
  if (position === "EXTENDIDO") return { climate: "CLIMA SECO", title: "Todo en orden",       detail: "La ropa esta al sol. No hay lluvia detectada.",        alert: "Ropa segura. El tendedero esta extendido." };
  return { climate: "EN ESPERA", title: "Tendedero retraido", detail: "Sistema en espera de clima seguro.", alert: "Tendedero retraido." };
}

function getClothesState(estado) {
  if (DRYING.active) return null;

  const explicit = String(estado?.humedad_ropa || estado?.estado_ropa || "").toUpperCase();
  if (explicit.includes("MOJ"))                              return { css: "wet",     percent: 12, title: "Ropa mojada completamente",     detail: "Lectura desde Firebase: la ropa esta mojada." };
  if (explicit.includes("MEDIA") || explicit.includes("CENTRIF")) return { css: "mid-dry", percent: 52, title: "Ropa centrifugada / media seca", detail: "Lectura desde Firebase: la ropa aun tiene humedad." };
  if (explicit.includes("SECA"))                             return { css: "dry",     percent: 92, title: "Ropa seca",                     detail: "Lectura desde Firebase: la ropa ya esta seca." };

  const rain     = estado?.lloviendo === true;
  const night    = estado?.modo_noche === true;
  const light    = Number(estado?.nivel_luz || 0);
  const position = friendlyPosition(estado?.posicion, estado?.estado);

  if (rain)                                             return { css: "wet",     percent: 10, title: "Ropa mojada completamente",     detail: "Estimado por lluvia activa." };
  if (position === "RETRAIDO" || night || light < 350) return { css: "mid-dry", percent: 48, title: "Ropa centrifugada / media seca", detail: "Estimado por poca luz o tendedero retraido." };
  return                                                       { css: "dry",     percent: 88, title: "Ropa seca o casi seca",          detail: "Estimado por clima seco, buena luz y tendedero extendido." };
}

function updateTheme(estado, clothes) {
  document.body.classList.toggle("rainy",    estado?.lloviendo === true);
  document.body.classList.toggle("night",    estado?.modo_noche === true);
  document.body.classList.toggle("retracted", friendlyPosition(estado?.posicion, estado?.estado) === "RETRAIDO");
  if (clothes) {
    document.body.classList.toggle("wet",     clothes.css === "wet");
    document.body.classList.toggle("mid-dry", clothes.css === "mid-dry");
    document.body.classList.toggle("dry",     clothes.css === "dry");
  }
}

function maybeNotify(estado, clothes) {
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  const copy = getStatusCopy(estado);
  const key  = `${estado?.lloviendo}-${estado?.modo_noche}-${friendlyPosition(estado?.posicion, estado?.estado)}-${clothes?.title}-${estado?.ultima_act}`;
  if (key === lastAlertKey) return;
  lastAlertKey = key;
  if (document.visibilityState === "visible") return;
  navigator.serviceWorker?.ready.then((registration) => {
    registration.showNotification("Mi Tendedero", {
      body:  `${copy.alert} ${clothes?.title || ""}.`,
      icon:  "./icons/icon.svg",
      badge: "./icons/icon.svg",
      tag:   "tendedero-estado"
    });
  });
}

function renderState(data) {
  const estado   = data.estado  || {};
  const sistema  = data.sistema || {};
  const copy     = getStatusCopy(estado);
  const clothes  = getClothesState(estado);
  const position = friendlyPosition(estado.posicion, estado.estado);

  // Actualizar velocidad del contador según estado en tiempo real
  DRYING.isRaining = estado.lloviendo === true;
  DRYING.isNight   = estado.modo_noche === true;

  updateTheme(estado, clothes);
  setText(ui.connectionText,  "Online");
  setText(ui.climateText,     `• ${copy.climate}`);
  setText(ui.mainTitle,       copy.title);
  setText(ui.mainDetail,      copy.detail);
  setText(ui.positionSummary, `Tendedero ${position} — ${position === "EXTENDIDO" ? "ropa al sol" : "ropa protegida"}`);

  if (DRYING.active) {
    setText(ui.clothesState,  `Secando: ${labelDrying(DRYING.label)}`);
    setText(ui.clothesDetail, `Tiempo restante: ${formatRemaining(DRYING.remainingMs)}`);
    renderDryingTimer();
  } else if (clothes) {
    setText(ui.clothesState,  clothes.title);
    setText(ui.clothesDetail, clothes.detail);
    ui.drynessBar.style.width = `${clothes.percent}%`;
  }

  setText(ui.positionValue, position);
  setText(ui.rainValue,     estado.lloviendo ? "SI" : "NO");
  setText(ui.lightValue,    estado.nivel_luz);
  setText(ui.nightValue,    estado.modo_noche ? "SI" : "NO");
  setText(ui.ipValue,       sistema.ip);
  setText(ui.rssiValue,     sistema.rssi !== undefined ? `${sistema.rssi} dBm` : "--");
  setText(ui.updatedValue,  estado.ultima_act);
  setText(ui.deviceValue,   CONFIG.deviceId);

  localStorage.setItem("tendedero:lastData", JSON.stringify(data));
  maybeNotify(estado, clothes);
}

async function sendDryingCommand(button) {
  const estadoRopa  = button.dataset.drying;
  const duracionMin = Number(button.dataset.minutes);

  const command = {
    accion:          "SECAR_ROPA",
    estado_ropa:     estadoRopa,
    duracion_min:    duracionMin,
    angulo_objetivo: "EXTENDIDO",
    creado_en:       new Date().toISOString(),
    origen:          "app_movil",
    procesado:       false
  };

  ui.dryingCommandText.textContent = "Enviando orden al tendedero...";

  try {
    const res = await fetch(endpoint("comando"), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(command)
    });
    if (!res.ok) throw new Error(`Firebase ${res.status}`);
    DRYING.start(estadoRopa);
  } catch (error) {
    ui.dryingCommandText.textContent = "No se pudo enviar. Revisa reglas de escritura de Firebase.";
    console.error(error);
    window.setTimeout(() => renderDryingTimer(), 5000);
  }
}

function labelDrying(value) {
  if (value === "CHORREANDO")   return "Ropa chorreando";
  if (value === "HUMEDA")       return "Ropa humeda";
  if (value === "CENTRIFUGADA") return "Ropa centrifugada";
  if (value === "SEMI_SECA")    return "Ropa semi-seca";
  return "Ropa";
}

function formatMinutes(minutes) {
  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60);
    const rest  = minutes % 60;
    return rest ? `${hours} h ${rest} min` : `${hours} h`;
  }
  return `${minutes} min`;
}

function renderHistory(historial) {
  const entries = Object.entries(historial || {})
    .sort((a, b) => String(b[0]).localeCompare(String(a[0])))
    .slice(0, 8);

  ui.historyList.innerHTML = "";
  if (!entries.length) {
    const item = document.createElement("li");
    item.textContent = "Sin eventos todavia.";
    ui.historyList.appendChild(item);
    return;
  }

  for (const [, event] of entries) {
    const item = document.createElement("li");
    const name = document.createElement("strong");
    name.textContent = event.evento || "EVENTO";
    item.appendChild(name);
    item.append(` · ${event.timestamp || "--"} · Luz ${event.nivel_luz ?? "--"}`);
    ui.historyList.appendChild(item);
  }
}

function renderCachedData() {
  const cached = localStorage.getItem("tendedero:lastData");
  if (!cached) return;
  try {
    renderState(JSON.parse(cached));
    ui.connectionText.innerHTML = "<span></span> Offline";
  } catch {
    localStorage.removeItem("tendedero:lastData");
  }
}

async function loadData() {
  try {
    ui.connectionText.innerHTML = "<span></span> Actualizando";
    const [stateRes, historyRes] = await Promise.all([
      fetch(endpoint(""), { cache: "no-store" }),
      fetch(endpoint("historial"), { cache: "no-store" })
    ]);
    if (!stateRes.ok) throw new Error(`Firebase ${stateRes.status}`);
    const data    = await stateRes.json();
    const history = historyRes.ok ? await historyRes.json() : {};
    renderState(data || {});
    renderHistory(history || {});
  } catch (error) {
    ui.connectionText.innerHTML = "<span></span> Offline";
    ui.mainTitle.textContent    = "Esperando datos";
    ui.mainDetail.textContent   = "Revisa internet, reglas de lectura de Firebase o el nombre del dispositivo.";
    renderCachedData();
    console.error(error);
  }
}

async function enableNotifications() {
  if (!("Notification" in window)) { alert("Este celular no soporta notificaciones web en este navegador."); return; }
  const permission = await Notification.requestPermission();
  ui.notifyButton.textContent = permission === "granted" ? "Notificaciones activas" : "Activar notificaciones";
}

async function installApp() {
  if (!installPromptEvent) {
    alert(
      "Para instalar la app:\n\nAndroid/Chrome: toca los 3 puntos y luego 'Instalar app'.\n\niPhone/Safari: toca Compartir y luego 'Agregar a inicio'.\n\nDebe abrirse desde HTTPS."
    );
    return;
  }
  installPromptEvent.prompt();
  await installPromptEvent.userChoice;
  installPromptEvent = null;
}

async function startApp() {
  if ("serviceWorker" in navigator) await navigator.serviceWorker.register("./sw.js");

  window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); installPromptEvent = e; });
  window.addEventListener("appinstalled", () => { installPromptEvent = null; });

  if ("Notification" in window && Notification.permission === "granted") {
    ui.notifyButton.textContent = "Notificaciones activas";
  }

  ui.installButton.addEventListener("click", installApp);
  ui.notifyButton.addEventListener("click", enableNotifications);
  ui.refreshButton.addEventListener("click", loadData);

  document.querySelectorAll("[data-drying]").forEach((btn) => {
    btn.addEventListener("click", () => sendDryingCommand(btn));
  });

  // Recuperar contador si la app se cerró con uno activo
  if (DRYING.load()) {
    DRYING.startTick();
    renderDryingTimer();
  }

  renderCachedData();
  await loadData();
  timer = window.setInterval(loadData, CONFIG.refreshMs);
}

window.addEventListener("beforeunload", () => {
  if (timer) window.clearInterval(timer);
  DRYING.save();
});

startApp();
