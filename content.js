// ═══════════════════════════════════════════════════════════════════════════
// content.js — Content Script (inyectado en uContact)
// Contiene TODA la lógica del bot. Ejecuta en el contexto de la página.
// ═══════════════════════════════════════════════════════════════════════════

// Guard: evita doble instancia
if (window.__uBotExtension) {
  console.warn("[uBot] Ya existe una instancia en esta pestaña");
} else {
  window.__uBotExtension = true;

  // ═════════════════════════════════════════════════════════════════════════
  // CONFIGURACIÓN
  // ═════════════════════════════════════════════════════════════════════════
  const CONFIG = {
    palabraClave: "¡Hola! dando seguimiento",
    pausaEntreMensajes: 600,
    pausaModal: 700,
    pausaFiltro: 600,
    pausaPostEnvio: 600,
    clickMs: 120,
    maxMensajesHora: 250,
    maxRafaga: 30,
    pausaEntreRafagas: 15000,
    timeoutElemento: 4000,
    reintentos: 3
  };

  // ═════════════════════════════════════════════════════════════════════════
  // ESTADO DEL BOT
  // ═════════════════════════════════════════════════════════════════════════
  let corriendo = false;
  let cicloActivo = false;
  let cicloHoras = 2;
  let cicloTimer = null;
  let enEjecucion = false;
  let cancelado = false;

  const SESION = {
    procesados: new Set(),
    timestamps: [],
    stats: {
      enviados: 0,
      anclados: 0,
      errores: 0,
      omitidos: 0,
      ciclos: 0
    },
    reset() {
      this.procesados.clear();
      this.timestamps = [];
      Object.keys(this.stats).forEach(k => this.stats[k] = 0);
      log("Sesión reseteada ✅");
    }
  };

  // ═════════════════════════════════════════════════════════════════════════
  // SELECTORES
  // ═════════════════════════════════════════════════════════════════════════
  const SEL = {
    itemChat: ".holderInteraction",
    previewChat: ".subTitleInteracion",
    tituloChat: ".mainTitleInteracion",
    abrirChat: ".contentInteraction",
    botonPin: "a.pinIcon",
    buscarPlantilla: ".cannedResponseFilterInput, #searchCanned, input[ng-model*='search'], input[placeholder*='Buscar']",
    itemPlantilla: "li.cannedResponse, .canned-item, [ng-repeat*='canned'], .cannedResponseItem"
  };

  // ═════════════════════════════════════════════════════════════════════════
  // UTILS
  // ═════════════════════════════════════════════════════════════════════════
  function q(sel) {
    try {
      return document.querySelector(sel);
    } catch {
      return null;
    }
  }

  function qq(sel) {
    try {
      return [...document.querySelectorAll(sel)];
    } catch {
      return [];
    }
  }

  function esVisible(el) {
    return !!(el && (el.getClientRects().length || el.offsetParent));
  }

  function esperar(ms) {
    return new Promise(r => setTimeout(r, ms));
  }

  function log(msg, tipo = "·") {
    const estilos = {
      "·": "color:#888",
      "✅": "color:#4c4",
      "⚠": "color:#fa0",
      "❌": "color:#f44",
      "🔍": "color:#4af",
      "🚀": "color:#f8f",
      "⏳": "color:#fc8"
    };
    const hora = new Date().toLocaleTimeString("es-PY");
    console.log(
      `%c[uBot ${tipo} ${hora}] ${msg}`,
      estilos[tipo] || "color:#888"
    );
  }

  // ═════════════════════════════════════════════════════════════════════════
  // CLICK SIMULADO
  // ═════════════════════════════════════════════════════════════════════════
  async function click(el) {
    if (!el) return;
    const r = el.getBoundingClientRect();
    const opts = {
      bubbles: true,
      cancelable: true,
      clientX: r.left + r.width / 2,
      clientY: r.top + r.height / 2
    };
    el.dispatchEvent(new MouseEvent("mousedown", { ...opts, button: 0 }));
    await esperar(CONFIG.clickMs);
    el.dispatchEvent(new MouseEvent("mouseup", { ...opts, button: 0 }));
    el.dispatchEvent(new MouseEvent("click", { ...opts, button: 0 }));
  }

  // ═════════════════════════════════════════════════════════════════════════
  // ASIGNAR VALOR A INPUT
  // ═════════════════════════════════════════════════════════════════════════
  function asignarValor(input, valor) {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
    if (setter) {
      setter.call(input, valor);
    } else {
      input.value = valor;
    }
    ["input", "change", "keyup"].forEach(e =>
      input.dispatchEvent(new Event(e, { bubbles: true }))
    );
  }

  // ═════════════════════════════════════════════════════════════════════════
  // ESPERAR ELEMENTO
  // ═════════════════════════════════════════════════════════════════════════
  async function esperarEl(selectorOFn, timeout = CONFIG.timeoutElemento) {
    const find = typeof selectorOFn === "function" ? selectorOFn : () => q(selectorOFn);
    const fin = Date.now() + timeout;
    while (Date.now() < fin) {
      const el = find();
      if (el) return el;
      await esperar(150);
    }
    return null;
  }

  // ═════════════════════════════════════════════════════════════════════════
  // REINTENTAR FUNCIÓN
  // ═════════════════════════════════════════════════════════════════════════
  async function reintentar(fn, veces = CONFIG.reintentos) {
    for (let i = 0; i < veces; i++) {
      const r = await fn();
      if (r) return r;
      if (i < veces - 1) await esperar(300);
    }
    return null;
  }

  // ═════════════════════════════════════════════════════════════════════════
  // WRAPPER SEGURO
  // ═════════════════════════════════════════════════════════════════════════
  async function seguro(fn, ctx = "") {
    try {
      return await fn();
    } catch (e) {
      SESION.stats.errores++;
      log(`Error${ctx ? ` [${ctx}]` : ""}: ${e?.message || e}`, "❌");
      return null;
    }
  }

  // ═════════════════════════════════════════════════════════════════════════
  // CERRAR MODALES
  // ═════════════════════════════════════════════════════════════════════════
  async function cerrarModales() {
    try {
      const sels = [".modal.in .close", ".modal.show .close", ".modal-header button.close", '[data-dismiss="modal"]'];
      for (const s of sels) {
        for (const btn of qq(s).filter(esVisible)) {
          await click(btn);
          await esperar(200);
        }
      }
      document.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Escape",
          keyCode: 27,
          which: 27,
          bubbles: true,
          cancelable: true
        })
      );
      await esperar(200);

      const modalVivo = qq(".modal.in, .modal.show").some(esVisible);
      if (!modalVivo) {
        qq(".modal-backdrop").forEach(b => {
          try {
            b.remove();
          } catch (_) {}
        });
        try {
          document.body.classList.remove("modal-open");
          document.body.style.removeProperty("overflow");
          document.body.style.removeProperty("padding-right");
        } catch (_) {}
      }
    } catch (_) {}
  }

  // ═════════════════════════════════════════════════════════════════════════
  // DETECCIÓN DE CHAT
  // ═════════════════════════════════════════════════════════════════════════
  function esSinRespuesta(preview) {
    if (!preview) return false;
    const t = preview.trim();
    return t.startsWith('{"template":') || t === "";
  }

  function estaAnclado(chatEl) {
    return chatEl.classList.contains("pinnedIcon");
  }

  function extraerNombre(titulo) {
    const idx = titulo.lastIndexOf(" - ");
    return idx !== -1 ? titulo.slice(idx + 3).trim() : titulo.trim();
  }

  function claveChat(chatEl) {
    const t = chatEl.querySelector(SEL.tituloChat)?.textContent?.trim() || "";
    const p = chatEl.querySelector(SEL.previewChat)?.textContent?.trim() || "";
    return `${t}::${p}`;
  }

  function extraerTelefono(chatEl) {
    const titulo = chatEl.querySelector(SEL.tituloChat)?.textContent?.trim() || "";
    const match = titulo.match(/\+?[\d\s\-()]{8,}/);
    return match ? match[0].trim() : "";
  }

  function extraerNombreOperador() {
    const elementos = qq('[data-username], .operator-name, .user-name, .current-user, [ng-bind*="user"]');
    for (const el of elementos) {
      const texto = el.textContent?.trim();
      if (texto && texto.length > 0 && texto.length < 50) {
        return texto;
      }
    }
    return "Sistema";
  }

  // ═════════════════════════════════════════════════════════════════════════
  // ENCONTRAR BOTÓN PLANTILLAS
  // ═════════════════════════════════════════════════════════════════════════
  let _btnPlantillasSel = null;

  function encontrarBotonPlantillas() {
    if (_btnPlantillasSel) {
      const cached = q(_btnPlantillasSel);
      if (cached) return cached;
      _btnPlantillasSel = null;
    }

    const fijos = [
      '[id$="-canned_responses"]',
      '[data-original-title="Respuestas Pre-armadas"]',
      '[data-original-title="Canned Responses"]',
      '[title="Respuestas Pre-armadas"]',
      '[ng-click*="canned"]',
      '[title*="lantilla"]'
    ];

    for (const s of fijos) {
      const el = q(s);
      if (el) {
        _btnPlantillasSel = s;
        return el;
      }
    }

    for (const el of qq("a, button")) {
      const txt = [el.id, el.className, el.title, el.getAttribute("data-original-title") || "", el.getAttribute("ng-click") || ""]
        .join(" ")
        .toLowerCase();
      if (["canned", "plantilla", "respuesta pre", "pre-arm"].some(p => txt.includes(p))) {
        return el;
      }
    }

    return null;
  }

  // ═════════════════════════════════════════════════════════════════════════
  // ANCLAR CHAT
  // ═════════════════════════════════════════════════════════════════════════
  async function anclarChat(chatEl) {
    return seguro(async () => {
      if (estaAnclado(chatEl)) return true;
      const btn = chatEl.querySelector(SEL.botonPin);
      if (!btn) {
        log("Botón pin no encontrado", "⚠");
        return false;
      }
      await click(btn);
      await esperar(200);
      SESION.stats.anclados++;
      log("Chat anclado ✅");
      return true;
    }, "anclarChat");
  }

  // ═════════════════════════════════════════════════════════════════════════
  // RATE LIMITER
  // ═════════════════════════════════════════════════════════════════════════
  function puedeEnviar() {
    const ahora = Date.now();
    SESION.timestamps = SESION.timestamps.filter(t => t > ahora - 3600000);
    if (SESION.timestamps.length >= CONFIG.maxMensajesHora) {
      const min = Math.ceil((SESION.timestamps[0] + 3600000 - ahora) / 60000);
      log(`Rate limit. Libre en ~${min}min`, "⏳");
      return false;
    }
    return true;
  }

  // ═════════════════════════════════════════════════════════════════════════
  // ENVIAR PLANTILLA
  // ═════════════════════════════════════════════════════════════════════════
  async function enviarPlantilla(nombre) {
    return seguro(async () => {
      if (!puedeEnviar()) return false;

      const btnPanel = encontrarBotonPlantillas();
      if (!btnPanel) {
        log("Botón plantillas no encontrado", "❌");
        return false;
      }

      const panelAbierto = () => {
        const inp = q(SEL.buscarPlantilla);
        return esVisible(inp) || qq(SEL.itemPlantilla).some(esVisible);
      };

      for (let i = 0; i < 3 && !panelAbierto(); i++) {
        await click(btnPanel);
        await esperar(CONFIG.pausaModal);
      }

      if (!panelAbierto()) {
        log("No se pudo abrir el panel de plantillas", "❌");
        return false;
      }

      let enviado = false;
      try {
        const inputBuscar = await esperarEl(SEL.buscarPlantilla);
        if (!inputBuscar) {
          log("Input búsqueda no apareció", "❌");
          return false;
        }

        asignarValor(inputBuscar, CONFIG.palabraClave);
        if (typeof filterCanned === "function") filterCanned(inputBuscar);
        await esperar(CONFIG.pausaFiltro);

        const kw = CONFIG.palabraClave.toLowerCase();
        const items = qq(SEL.itemPlantilla).filter(esVisible);
        const item = items.find(
          li =>
            li.textContent.toLowerCase().includes(kw) ||
            (li.dataset.response || "").toLowerCase().includes(kw)
        );

        if (!item) {
          log(`Plantilla "${CONFIG.palabraClave}" no encontrada`, "❌");
          return false;
        }

        await click(item);
        await esperar(500);

        const ambito = q(".modal.in, .modal.show") || document;

        const buscarInputVar = () => {
          const candidatos = [
            ambito.querySelector?.(
              "input.templateVariableInput, input[data-var='1'], #variableInput, input[ng-model*='variable']"
            ),
            ...(ambito.querySelectorAll?.(".modal-body input[type='text'], input[type='text']") || [])
          ].filter(Boolean);

          return (
            candidatos.find(
              i =>
                esVisible(i) &&
                !/buscar|search|filter|number|tel/i.test(
                  [i.className, i.id, i.placeholder || ""].join(" ").toLowerCase()
                )
            ) || null
          );
        };

        const inputVar = await reintentar(buscarInputVar, 6);
        if (inputVar) {
          if (!nombre.trim()) {
            log("Nombre vacío — no envío", "⚠");
            return false;
          }

          for (let i = 0; i < 3 && inputVar.value !== nombre; i++) {
            inputVar.focus();
            inputVar.select?.();
            asignarValor(inputVar, nombre);
            await esperar(250);
          }

          if (!inputVar.value.trim()) {
            log(`No pude confirmar {{1}} para "${nombre}"`, "❌");
            return false;
          }
          await esperar(200);
        }

        const btnEnviar = await reintentar(() => {
          const todos = [...(ambito.querySelectorAll?.("button, .btn, a.btn") || [])];
          return (
            todos.find(b => /^enviar$/i.test(b.textContent.trim()) && !b.disabled) ||
            todos.find(b => b.textContent.trim().toLowerCase().includes("enviar") && !b.disabled) ||
            ambito.querySelector?.(".btn-success:not([disabled])") ||
            ambito.querySelector?.('[ng-click*="send"]:not([disabled]), [ng-click*="enviar"]:not([disabled])')
          );
        });

        if (!btnEnviar) {
          log("Botón Enviar no encontrado", "❌");
          return false;
        }

        await click(btnEnviar);
        await esperar(CONFIG.pausaPostEnvio);

        SESION.timestamps.push(Date.now());
        SESION.stats.enviados++;
        log(`✓ ${nombre}`, "✅");
        enviado = true;
        return true;
      } finally {
        if (!enviado) await cerrarModales();
      }
    }, `enviarPlantilla(${nombre})`);
  }

  // ═════════════════════════════════════════════════════════════════════════
  // PROCESAR CHAT
  // ═════════════════════════════════════════════════════════════════════════
  async function procesarChat(chat) {
    const clave = claveChat(chat);
    const preview = chat.querySelector(SEL.previewChat)?.textContent?.trim() || "";
    const titulo = chat.querySelector(SEL.tituloChat)?.textContent?.trim() || "";
    const nombre = extraerNombre(titulo);
    const telefono = extraerTelefono(chat);
    const operador = extraerNombreOperador();

    if (SESION.procesados.has(clave)) {
      SESION.stats.omitidos++;
      return false;
    }

    // Respondió y no está anclado → anclar
    if (!esSinRespuesta(preview) && !estaAnclado(chat)) {
      const ok = await anclarChat(chat);
      if (ok) {
        SESION.procesados.add(clave);
        registrarEnSheets({
          nombre: nombre,
          telefono: telefono,
          estado: "Anclado (respondió)",
          comentario: "Chat respondido - anclado automáticamente",
          operador: operador,
          fecha: new Date().toISOString()
        });
      }
      return ok;
    }

    // Ya anclado → ignorar
    if (estaAnclado(chat)) {
      SESION.stats.omitidos++;
      return false;
    }

    // Sin respuesta → enviar plantilla
    if (esSinRespuesta(preview)) {
      await click(chat.querySelector(SEL.abrirChat));
      await esperar(400);
      const ok = await enviarPlantilla(nombre);
      if (ok) {
        SESION.procesados.add(clave);
        registrarEnSheets({
          nombre: nombre,
          telefono: telefono,
          estado: "Enviado seguimiento",
          comentario: CONFIG.palabraClave,
          operador: operador,
          fecha: new Date().toISOString()
        });
      }
      return ok;
    }

    return false;
  }

  // ═════════════════════════════════════════════════════════════════════════
  // REGISTRAR EN GOOGLE SHEETS
  // ═════════════════════════════════════════════════════════════════════════
  function registrarEnSheets(datos) {
    chrome.runtime.sendMessage(
      {
        action: "guardar",
        datos: datos
      },
      resp => {
        if (!resp?.ok) {
          log(`Fallo al registrar: ${resp?.error || "desconocido"}`, "⚠");
        }
      }
    );
  }

  // ═════════════════════════════════════════════════════════════════════════
  // ESCANEAR BANDEJA
  // ═════════════════════════════════════════════════════════════════════════
  async function escanearBandeja() {
    if (enEjecucion) {
      log("Ya hay un scan corriendo", "⚠");
      return;
    }

    enEjecucion = true;
    cancelado = false;

    await seguro(async () => {
      log("Escaneando bandeja...", "🔍");
      const chats = qq(SEL.itemChat);

      if (!chats.length) {
        log("No encontré chats", "⚠");
        return;
      }

      log(`${chats.length} chats encontrados`);

      let accionados = 0;
      let enRafaga = 0;

      for (const chat of chats) {
        if (cancelado || !corriendo) {
          log("Scan cancelado", "⚠");
          break;
        }

        if (enRafaga >= CONFIG.maxRafaga) {
          log(`Pausa entre ráfagas...`, "⏳");
          await esperar(CONFIG.pausaEntreRafagas);
          enRafaga = 0;
        }

        const ok = await procesarChat(chat);
        if (ok) {
          accionados++;
          enRafaga++;
        }

        await esperar(CONFIG.pausaEntreMensajes);
      }

      log(`Listo. ${accionados} chats procesados de ${chats.length}.`, "✅");
      actualizarPopup();
    }, "escanearBandeja");

    enEjecucion = false;
  }

  // ═════════════════════════════════════════════════════════════════════════
  // CICLO AUTOMÁTICO
  // ═════════════════════════════════════════════════════════════════════════
  async function tick() {
    if (!cicloActivo) return;

    const n = SESION.stats.ciclos + 1;
    log(`── Ciclo ${n} ──`, "🚀");
    SESION.procesados.clear();
    await escanearBandeja();

    if (!cicloActivo) return;

    SESION.stats.ciclos++;
    const ms = cicloHoras * 3600000;
    const proxStr = new Date(Date.now() + ms).toLocaleTimeString("es-PY");
    log(`Ciclo ${n} listo. Próximo a las ${proxStr}`, "✅");

    cicloTimer = setTimeout(tick, ms);
  }

  function iniciarCiclo(horas = 2) {
    if (cicloActivo) {
      log("Ya hay un ciclo activo", "⚠");
      return;
    }
    cicloActivo = true;
    cicloHoras = horas;
    corriendo = true;
    log(`Ciclo iniciado: cada ${horas}h 🚀`, "🚀");
    tick();
    actualizarPopup();
  }

  function detenerCiclo() {
    const habia = cicloActivo || cicloTimer;
    cicloActivo = false;
    corriendo = false;
    cancelado = true;
    if (cicloTimer) {
      clearTimeout(cicloTimer);
      cicloTimer = null;
    }
    actualizarPopup();
    if (habia) {
      log(`Ciclo detenido (${SESION.stats.ciclos} vuelta/s)`, "✅");
    } else {
      log("No había ciclo activo", "⚠");
    }
  }

  // ═════════════════════════════════════════════════════════════════════════
  // ACTUALIZAR POPUP
  // ═════════════════════════════════════════════════════════════════════════
  function actualizarPopup() {
    chrome.runtime.sendMessage({
      action: "actualizar_ui",
      stats: SESION.stats,
      cicloActivo: cicloActivo,
      corriendo: corriendo
    });
  }

  // ═════════════════════════════════════════════════════════════════════════
  // ESCUCHAR MENSAJES DEL POPUP
  // ═════════════════════════════════════════════════════════════════════════
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.action === "iniciar") {
      const horas = msg.horas || 2;
      iniciarCiclo(horas);
      sendResponse({ ok: true });
    }

    if (msg.action === "detener") {
      detenerCiclo();
      sendResponse({ ok: true });
    }

    if (msg.action === "status") {
      sendResponse({
        cicloActivo: cicloActivo,
        corriendo: corriendo,
        stats: SESION.stats,
        cicloHoras: cicloHoras
      });
    }

    if (msg.action === "escanear") {
      escanearBandeja();
      sendResponse({ ok: true });
    }

    if (msg.action === "reset") {
      SESION.reset();
      sendResponse({ ok: true });
    }
  });

  // ═════════════════════════════════════════════════════════════════════════
  // RESTAURAR ESTADO AL CARGAR
  // ═════════════════════════════════════════════════════════════════════════
  chrome.storage.local.get(["botActivo", "cicloHoras"], result => {
    if (result.botActivo) {
      cicloHoras = result.cicloHoras || 2;
      iniciarCiclo(cicloHoras);
    }
  });

  log("✅ uBot v10 inicializado en esta pestaña 🚀", "🚀");
}
