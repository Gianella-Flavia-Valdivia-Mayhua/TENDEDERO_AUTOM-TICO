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
  const rain = estado?.lloviendo === true;
  const night = estado?.modo_noche === true;
  const position = friendlyPosition(estado?.posicion, estado?.estado);

  if (rain) {
    return {
      climate: "LLUVIA DETECTADA",
      title: "Ropa protegida",
      detail: "El tendedero se retrajo automaticamente por lluvia.",
      alert: "Lluvia detectada. Tendedero retraido automaticamente."
    };
  }

  if (night) {
    return {
      climate: "MODO NOCHE",
      title: "Guardado por noche",
      detail: "El tendedero se mantiene retraido por oscuridad.",
      alert: "Modo noche activado. Tendedero retraido preventivamente."
    };
  }

  if (position === "EXTENDIDO") {
    return {
      climate: "CLIMA SECO",
      title: "Todo en orden",
      detail: "La ropa esta al sol. No hay lluvia detectada.",
      alert: "Ropa segura. El tendedero esta extendido."
    };
  }

  return {
    climate: "EN ESPERA",
    title: "Tendedero retraido",
    detail: "Sistema en espera de clima seguro.",
    alert: "Tendedero retraido."
  };
}

function getClothesState(estado) {
  const explicit = String(estado?.humedad_ropa || estado?.estado_ropa || "").toUpperCase();
  if (explicit.includes("MOJ")) {
    return {
      css: "wet",
      percent: 12,
      title: "Ropa mojada completamente",
      detail: "Lectura recibida desde Firebase: la ropa esta mojada."
    };
  }
  if (explicit.includes("MEDIA") || explicit.includes("CENTRIF")) {
    return {
      css: "mid-dry",
      percent: 52,
      title: "Ropa centrifugada / media seca",
      detail: "Lectura recibida desde Firebase: la ropa aun conserva humedad."
    };
  }
  if (explicit.includes("SECA")) {
    return {
      css: "dry",
      percent: 92,
      title: "Ropa seca",
      detail: "Lectura recibida desde Firebase: la ropa ya esta seca."
    };
  }

  const rain = estado?.lloviendo === true;
  const night = estado?.modo_noche === true;
  const light = Number(estado?.nivel_luz || 0);
  const position = friendlyPosition(estado?.posicion, estado?.estado);

  if (rain) {
    return {
      css: "wet",
      percent: 10,
      title: "Ropa mojada completamente",
      detail: "Estimado por lluvia activa. Se recomienda mantener el tendedero retraido."
    };
  }

  if (position === "RETRAIDO" || night || light < 350) {
    return {
      css: "mid-dry",
      percent: 48,
      title: "Ropa centrifugada / media seca",
      detail: "Estimado por poca luz o tendedero retraido. Todavia puede conservar humedad."
    };
  }

  return {
    css: "dry",
    percent: 88,
    title: "Ropa seca o casi seca",
    detail: "Estimado por clima seco, buena luz y tendedero extendido."
  };
}

function updateTheme(estado, clothes) {
  document.body.classList.toggle("rainy", estado?.lloviendo === true);
  document.body.classList.toggle("night", estado?.modo_noche === true);
  document.body.classList.toggle("retracted", friendlyPosition(estado?.posicion, estado?.estado) === "RETRAIDO");
  document.body.classList.toggle("wet", clothes.css === "wet");
  document.body.classList.toggle("mid-dry", clothes.css === "mid-dry");
  document.body.classList.toggle("dry", clothes.css === "dry");
}

function maybeNotify(estado, clothes) {
  if (!("Notification" in window) || Notification.permission !== "granted") return;

  const copy = getStatusCopy(estado);
  const key = `${estado?.lloviendo}-${estado?.modo_noche}-${friendlyPosition(estado?.posicion, estado?.estado)}-${clothes.title}-${estado?.ultima_act}`;
  if (key === lastAlertKey) return;
  lastAlertKey = key;

  if (document.visibilityState === "visible") return;

  navigator.serviceWorker?.ready.then((registration) => {
    registration.showNotification("Mi Tendedero", {
      body: `${copy.alert} ${clothes.title}.`,
      icon: "./icons/icon.svg",
      badge: "./icons/icon.svg",
      tag: "tendedero-estado"
    });
  });
}

function renderState(data) {
  const estado = data.estado || {};
  const sistema = data.sistema || {};
  const copy = getStatusCopy(estado);
  const clothes = getClothesState(estado);
  const position = friendlyPosition(estado.posicion, estado.estado);

  updateTheme(estado, clothes);
  setText(ui.connectionText, "Online");
  setText(ui.climateText, `• ${copy.climate}`);
  setText(ui.mainTitle, copy.title);
  setText(ui.mainDetail, copy.detail);
  setText(ui.positionSummary, `Tendedero ${position} — ${position === "EXTENDIDO" ? "ropa al sol" : "ropa protegida"}`);
  setText(ui.clothesState, clothes.title);
  setText(ui.clothesDetail, clothes.detail);
  ui.drynessBar.style.width = `${clothes.percent}%`;
  setText(ui.positionValue, position);
  setText(ui.rainValue, estado.lloviendo ? "SI" : "NO");
  setText(ui.lightValue, estado.nivel_luz);
  setText(ui.nightValue, estado.modo_noche ? "SI" : "NO");
  setText(ui.ipValue, sistema.ip);
  setText(ui.rssiValue, sistema.rssi !== undefined ? `${sistema.rssi} dBm` : "--");
  setText(ui.updatedValue, estado.ultima_act);
  setText(ui.deviceValue, CONFIG.deviceId);

  localStorage.setItem("tendedero:lastData", JSON.stringify(data));
  maybeNotify(estado, clothes);
}

async function sendDryingCommand(button) {
  const estadoRopa = button.dataset.drying;
  const duracionMin = Number(button.dataset.minutes);
  const command = {
    accion: "SECAR_ROPA",
    estado_ropa: estadoRopa,
    duracion_min: duracionMin,
    angulo_objetivo: "EXTENDIDO",
    creado_en: new Date().toISOString(),
    origen: "app_movil",
    procesado: false
  };

  const previousText = ui.dryingCommandText.textContent;
  ui.dryingCommandText.textContent = "Enviando orden al tendedero...";

  try {
    const res = await fetch(endpoint("comando"), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(command)
    });

    if (!res.ok) throw new Error(`Firebase ${res.status}`);
    ui.dryingCommandText.textContent = `Orden enviada: ${labelDrying(estadoRopa)} por ${formatMinutes(duracionMin)}.`;
  } catch (error) {
    ui.dryingCommandText.textContent = "No se pudo enviar. Revisa reglas de escritura de Firebase.";
    console.error(error);
    window.setTimeout(() => {
      ui.dryingCommandText.textContent = previousText;
    }, 5000);
  }
}

function labelDrying(value) {
  if (value === "CHORREANDO") return "ropa chorreando";
  if (value === "HUMEDA") return "ropa humeda";
  if (value === "CENTRIFUGADA") return "ropa centrifugada";
  if (value === "SEMI_SECA") return "ropa semi-seca";
  return "ropa";
}

function formatMinutes(minutes) {
  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
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
    const data = await stateRes.json();
    const history = historyRes.ok ? await historyRes.json() : {};

    renderState(data || {});
    renderHistory(history || {});
  } catch (error) {
    ui.connectionText.innerHTML = "<span></span> Offline";
    ui.mainTitle.textContent = "Esperando datos";
    ui.mainDetail.textContent = "Revisa internet, reglas de lectura de Firebase o el nombre del dispositivo.";
    renderCachedData();
    console.error(error);
  }
}

async function enableNotifications() {
  if (!("Notification" in window)) {
    alert("Este celular no soporta notificaciones web en este navegador.");
    return;
  }

  const permission = await Notification.requestPermission();
  ui.notifyButton.textContent = permission === "granted" ? "Notificaciones activas" : "Activar notificaciones";
}

async function installApp() {
  if (!installPromptEvent) return;
  installPromptEvent.prompt();
  await installPromptEvent.userChoice;
  installPromptEvent = null;
}

async function startApp() {
  if ("serviceWorker" in navigator) {
    await navigator.serviceWorker.register("./sw.js");
  }

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    installPromptEvent = event;
  });

  window.addEventListener("appinstalled", () => {
    installPromptEvent = null;
  });

  if ("Notification" in window && Notification.permission === "granted") {
    ui.notifyButton.textContent = "Notificaciones activas";
  }

  ui.installButton.addEventListener("click", installApp);
  ui.notifyButton.addEventListener("click", enableNotifications);
  ui.refreshButton.addEventListener("click", loadData);
  document.querySelectorAll("[data-drying]").forEach((button) => {
    button.addEventListener("click", () => sendDryingCommand(button));
  });

  renderCachedData();
  await loadData();
  timer = window.setInterval(loadData, CONFIG.refreshMs);
}

window.addEventListener("beforeunload", () => {
  if (timer) window.clearInterval(timer);
});

startApp();
