// ═══════════════════════════════════════════════════════════════════════════
// background.js — Service Worker (MV3)
// Corre en el contexto de la extensión: sin restricciones de CSP.
// Maneja: cola de registros, reintentos, fetch a Google Apps Script.
// ═══════════════════════════════════════════════════════════════════════════

const APP_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbzPPWk9YXjLf4WiQlwkXVQtrtuYAD72MCuf1docjnEIwDNqobfot50z1-gfOWHh1dbe/exec";

let cola = [];
let enviando = false;
let estadisticas = {
  registros_enviados: 0,
  registros_fallidos: 0,
  intentos_totales: 0
};

// ═══════════════════════════════════════════════════════════════════════════
// PROCESADOR DE COLA
// ═══════════════════════════════════════════════════════════════════════════
async function procesarCola() {
  if (enviando || cola.length === 0) return;
  enviando = true;

  while (cola.length > 0) {
    const item = cola[0];
    try {
      estadisticas.intentos_totales++;

      const respuesta = await fetch(APP_SCRIPT_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(item.datos)
      });

      if (!respuesta.ok) {
        throw new Error(`HTTP ${respuesta.status}`);
      }

      cola.shift();
      estadisticas.registros_enviados++;
      item.resolve({ ok: true, mensaje: "Registrado en Google Sheets" });

    } catch (error) {
      item.intentos = (item.intentos || 0) + 1;

      if (item.intentos >= 3) {
        cola.shift();
        estadisticas.registros_fallidos++;
        item.resolve({
          ok: false,
          error: `Falló tras 3 intentos: ${error.message}`
        });
      } else {
        await new Promise(r => setTimeout(r, 2000));
      }
    }
  }

  enviando = false;
}

// ═══════════════════════════════════════════════════════════════════════════
// ESCUCHADOR DE MENSAJES
// ═══════════════════════════════════════════════════════════════════════════
chrome.runtime.onMessage.addListener((mensaje, sender, responder) => {
  if (mensaje.action === "guardar") {
    const datos = {
      ...mensaje.datos,
      fecha: mensaje.datos.fecha || new Date().toISOString(),
      timestamp: Date.now()
    };

    cola.push({
      datos: datos,
      resolve: responder,
      intentos: 0
    });

    procesarCola();
    return true;
  }

  if (mensaje.action === "stats") {
    responder({
      ok: true,
      stats: estadisticas,
      cola_pendiente: cola.length
    });
    return true;
  }

  if (mensaje.action === "estado_extension") {
    responder({
      ok: true,
      activo: true,
      version: "1.0.0",
      endpoint: APP_SCRIPT_URL
    });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// INICIALIZACIÓN
// ═══════════════════════════════════════════════════════════════════════════
console.log("[uBot Background] Service Worker iniciado — listo para recibir registros");
