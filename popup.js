// ═══════════════════════════════════════════════════════════════════════════
// popup.js — Controlador del popup
// Comunica con content.js para iniciar/detener ciclos
// ═══════════════════════════════════════════════════════════════════════════

// Elements
const btnIniciar = document.getElementById("btnIniciar");
const btnDetener = document.getElementById("btnDetener");
const btnEscanear = document.getElementById("btnEscanear");
const btnReset = document.getElementById("btnReset");
const cicloHorasSelect = document.getElementById("cicloHoras");

const estadoIndicador = document.getElementById("estadoIndicador");
const statEnviados = document.getElementById("statEnviados");
const statAnclados = document.getElementById("statAnclados");
const statErrores = document.getElementById("statErrores");
const ciclosInfo = document.getElementById("ciclosInfo");

// ═══════════════════════════════════════════════════════════════════════════
// UTILIDADES
// ═══════════════════════════════════════════════════════════════════════════
function enviarAlContent(action, data = {}) {
  chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
    if (!tabs[0]) return;
    chrome.tabs.sendMessage(tabs[0].id, { action, ...data }, response => {
      if (chrome.runtime.lastError) {
        console.warn("Error:", chrome.runtime.lastError.message);
      }
    });
  });
}

function actualizarUI(cicloActivo = false) {
  btnIniciar.disabled = cicloActivo;
  btnDetener.disabled = !cicloActivo;

  if (cicloActivo) {
    estadoIndicador.classList.remove("inactivo");
    estadoIndicador.classList.add("activo");
    estadoIndicador.querySelector(".texto").textContent = "ACTIVO";
  } else {
    estadoIndicador.classList.remove("activo");
    estadoIndicador.classList.add("inactivo");
    estadoIndicador.querySelector(".texto").textContent = "INACTIVO";
  }
}

function actualizarStats(stats = {}, ciclos = 0) {
  statEnviados.textContent = stats.enviados || 0;
  statAnclados.textContent = stats.anclados || 0;
  statErrores.textContent = stats.errores || 0;

  if (ciclos > 0) {
    ciclosInfo.textContent = `${ciclos} ciclo(s) completado(s)`;
  } else {
    ciclosInfo.textContent = "";
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// OBTENER STATUS ACTUAL
// ═══════════════════════════════════════════════════════════════════════════
function obtenerStatus() {
  chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
    if (!tabs[0]) return;
    chrome.tabs.sendMessage(tabs[0].id, { action: "status" }, response => {
      if (response) {
        actualizarUI(response.cicloActivo);
        actualizarStats(response.stats, response.stats.ciclos);
      }
    });
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// EVENT LISTENERS
// ═══════════════════════════════════════════════════════════════════════════
btnIniciar.addEventListener("click", () => {
  const horas = parseFloat(cicloHorasSelect.value) || 2;
  enviarAlContent("iniciar", { horas });
  chrome.storage.local.set({ botActivo: true, cicloHoras: horas });
  actualizarUI(true);
});

btnDetener.addEventListener("click", () => {
  enviarAlContent("detener");
  chrome.storage.local.set({ botActivo: false });
  actualizarUI(false);
});

btnEscanear.addEventListener("click", () => {
  enviarAlContent("escanear");
});

btnReset.addEventListener("click", () => {
  if (confirm("¿Resetear estadísticas?")) {
    enviarAlContent("reset");
    actualizarStats({ enviados: 0, anclados: 0, errores: 0 }, 0);
  }
});

// Escuchar actualizaciones del content script
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === "actualizar_ui") {
    actualizarUI(msg.cicloActivo);
    actualizarStats(msg.stats, msg.stats.ciclos);
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// INICIALIZACIÓN
// ═══════════════════════════════════════════════════════════════════════════
document.addEventListener("DOMContentLoaded", () => {
  // Restaurar último ciclo guardado
  chrome.storage.local.get(["botActivo", "cicloHoras"], result => {
    if (result.cicloHoras) {
      cicloHorasSelect.value = result.cicloHoras;
    }
    actualizarUI(result.botActivo || false);
  });

  // Obtener status actual
  setTimeout(obtenerStatus, 200);
});

// Actualizar cada 2 segundos si el popup está abierto
setInterval(obtenerStatus, 2000);
