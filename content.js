let botState = {
  isRunning: false,
  interval: 3600000,
  operador: 'Sistema',
  stats: {
    enviados: 0,
    anclados: 0,
    cerrados: 0,
    errores: 0
  },
  lastExecution: null,
  currentlyProcessing: false
};

const SELECTORS = {
  chatItems: [
    'div[role="option"][data-testid*="chat"]',
    'div[role="option"]',
    'li[role="option"]'
  ],
  unreadBadge: [
    'span[data-unread="true"]',
    'span[class*="unread"]',
    'span[class*="badge"]'
  ],
  chatName: [
    'span[class*="ChatName"]',
    'span[class*="name"]',
    'h3'
  ],
  messageInput: [
    'input[placeholder*="Mensaje"]',
    'input[placeholder*="mensaje"]',
    'textarea[placeholder*="Mensaje"]',
    'textarea[placeholder*="mensaje"]'
  ],
  sendButton: [
    'button[aria-label*="Enviar"]',
    'button[aria-label*="enviar"]',
    'button[type="submit"]'
  ],
  presetButton: [
    'button[title*="Respuestas prearmadas"]',
    'button[aria-label*="Respuestas prearmadas"]',
    'button[title*="Respuestas"]',
    'button[aria-label*="Respuestas"]'
  ],
  templateItem: [
    'div[role="option"]',
    'li[role="option"]',
    'button[role="option"]'
  ],
  anchored: [
    'button[aria-label*="Anclado"]',
    'button[aria-label*="anclado"]',
    'button[title*="Anclado"]'
  ]
};

function isUContact() {
  const url = window.location.href;
  return (url.includes('ucontact.com') || url.includes('ucontact.io')) && 
         (url.includes('/inbox') || url.includes('/chat') || url.includes('/conversations'));
}

if (isUContact()) {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'start') {
      handleStart(message.config, sendResponse);
    } else if (message.action === 'stop') {
      handleStop(sendResponse);
    } else if (message.action === 'status') {
      handleStatus(sendResponse);
    }
    return true;
  });

  console.log('✅ uContact Bot v2 content.js inyectado');
}

function handleStart(config, sendResponse) {
  if (botState.isRunning) {
    sendResponse({ success: false, message: 'Bot ya está en ejecución' });
    return;
  }

  botState.isRunning = true;
  botState.interval = (config.interval || 1) * 3600000;
  botState.operador = config.operador || 'Sistema';
  botState.lastExecution = Date.now();

  console.log('🤖 uContact Bot iniciado');
  console.log(`⏱️ Intervalo: ${config.interval}h`);
  console.log(`👤 Operador: ${botState.operador}`);

  procesarChats();
  sendResponse({ success: true, message: 'Bot iniciado' });
}

function handleStop(sendResponse) {
  botState.isRunning = false;
  botState.currentlyProcessing = false;
  console.log('🛑 uContact Bot detenido');
  sendResponse({ success: true, message: 'Bot detenido' });
}

function handleStatus(sendResponse) {
  sendResponse({
    running: botState.isRunning,
    interval: botState.interval / 3600000,
    operador: botState.operador,
    stats: botState.stats,
    processing: botState.currentlyProcessing
  });
}

async function procesarChats() {
  if (!botState.isRunning) return;
  if (botState.currentlyProcessing) return;

  botState.currentlyProcessing = true;

  try {
    const chats = obtenerChats();
    console.log(`📋 Chats encontrados: ${chats.length}`);

    for (const chat of chats) {
      if (!botState.isRunning) break;

      const nombre = extraerNombre(chat);
      if (!nombre || nombre === 'Desconocido') {
        console.warn('⚠️ No se puede extraer nombre del chat, saltando...');
        continue;
      }

      const respondio = await verificarRespuesta(chat);

      if (respondio) {
        await anclarChat(chat, nombre);
      } else {
        const telefono = await obtenerTelefono(chat);
        await enviarSeguimiento(chat, nombre, telefono);
      }

      await esperar(2000);
    }

    if (botState.isRunning) {
      console.log(`⏰ Próxima ejecución en ${botState.interval / 60000} minutos`);
      setTimeout(procesarChats, botState.interval);
    }
  } catch (error) {
    console.error('❌ Error en procesarChats:', error);
    if (botState.isRunning) {
      setTimeout(procesarChats, botState.interval);
    }
  } finally {
    botState.currentlyProcessing = false;
  }
}

function obtenerChats() {
  for (const selector of SELECTORS.chatItems) {
    const elementos = document.querySelectorAll(selector);
    if (elementos.length > 0) {
      return Array.from(elementos).filter(el => {
        const texto = el.textContent.trim();
        return texto.length > 0 && !texto.includes('Cargando');
      });
    }
  }
  return [];
}

function extraerNombre(chat) {
  for (const selector of SELECTORS.chatName) {
    const elemento = chat.querySelector(selector);
    if (elemento && elemento.textContent.trim()) {
      return elemento.textContent.trim();
    }
  }

  const texto = chat.textContent.trim().split('\n')[0];
  return texto || 'Desconocido';
}

async function verificarRespuesta(chat) {
  for (const selector of SELECTORS.unreadBadge) {
    if (chat.querySelector(selector)) {
      return false;
    }
  }
  return true;
}

async function obtenerTelefono(chat) {
  chat.click();
  await esperar(1500);

  let telefono = '';

  const inputs = document.querySelectorAll('input');
  for (const input of inputs) {
    const valor = input.value || input.placeholder || '';
    if (valor.match(/\+?\d{1,3}\s?[\d\s\-\(\)]{6,}/)) {
      telefono = valor.replace(/[\s\-\(\)]/g, '').trim();
      if (telefono.match(/^\d{6,}/)) {
        break;
      }
    }
  }

  if (!telefono) {
    const textContent = document.body.innerText;
    const matches = textContent.match(/(\+?\d{1,3}\s?[\d\s\-\(\)]{6,})/g);
    if (matches) {
      for (const match of matches) {
        const limpio = match.replace(/[\s\-\(\)]/g, '').trim();
        if (limpio.match(/^\d{6,}$/) || limpio.match(/^\+\d{1,}/)) {
          telefono = limpio;
          break;
        }
      }
    }
  }

  return telefono;
}

async function anclarChat(chat, nombre) {
  try {
    chat.click();
    await esperar(800);

    let anchorBtn = null;
    for (const selector of SELECTORS.anchored) {
      anchorBtn = document.querySelector(selector);
      if (anchorBtn) break;
    }

    if (anchorBtn) {
      anchorBtn.click();
      await esperar(500);
      botState.stats.anclados += 1;
    }

    await registrarAccion({
      nombre,
      telefono: '',
      estado: 'Anclado (respondió)',
      comentario: 'Chat anclado automáticamente'
    });

    console.log(`✅ Chat anclado: ${nombre}`);
  } catch (error) {
    console.error(`❌ Error anclando chat ${nombre}:`, error);
    botState.stats.errores += 1;
  }
}

async function enviarSeguimiento(chat, nombre, telefono) {
  try {
    chat.click();
    await esperar(1500);

    let presetBtn = null;
    for (const selector of SELECTORS.presetButton) {
      presetBtn = document.querySelector(selector);
      if (presetBtn) break;
    }

    if (!presetBtn) {
      console.warn(`⚠️ Botón de respuestas prearmadas no encontrado para ${nombre}`);
      botState.stats.errores += 1;
      await registrarAccion({
        nombre,
        telefono,
        estado: 'Error',
        comentario: 'Botón de respuestas prearmadas no encontrado'
      });
      return;
    }

    presetBtn.click();
    await esperar(1000);

    const templates = obtenerTemplates();
    let templateEncontrada = false;

    for (const template of templates) {
      if (template.textContent.includes('¡Hola! dando seguimiento') || 
          template.textContent.includes('dando seguimiento')) {
        template.click();
        templateEncontrada = true;
        await esperar(600);
        break;
      }
    }

    if (!templateEncontrada) {
      console.warn(`⚠️ Plantilla no encontrada para ${nombre}`);
      botState.stats.errores += 1;
      await registrarAccion({
        nombre,
        telefono,
        estado: 'Error',
        comentario: 'Plantilla "¡Hola! dando seguimiento" no encontrada'
      });
      return;
    }

    let messageInput = null;
    for (const selector of SELECTORS.messageInput) {
      messageInput = document.querySelector(selector);
      if (messageInput) break;
    }

    if (messageInput) {
      const textoActual = messageInput.value || messageInput.textContent;
      const textoNuevo = textoActual.replace(/\{\{1\}\}/g, nombre).replace(/\{\{nombre\}\}/g, nombre);
      
      if (messageInput.tagName === 'TEXTAREA') {
        messageInput.textContent = textoNuevo;
      } else {
        messageInput.value = textoNuevo;
      }
      
      messageInput.dispatchEvent(new Event('input', { bubbles: true }));
      messageInput.dispatchEvent(new Event('change', { bubbles: true }));
      await esperar(400);
    }

    let sendBtn = null;
    for (const selector of SELECTORS.sendButton) {
      sendBtn = document.querySelector(selector);
      if (sendBtn && sendBtn.offsetParent !== null) break;
    }

    if (sendBtn) {
      sendBtn.click();
      await esperar(800);
    }

    botState.stats.enviados += 1;
    await registrarAccion({
      nombre,
      telefono,
      estado: 'Enviado seguimiento',
      comentario: 'Plantilla enviada automáticamente'
    });

    console.log(`📨 Seguimiento enviado a: ${nombre}`);
  } catch (error) {
    console.error(`❌ Error enviando seguimiento a ${nombre}:`, error);
    botState.stats.errores += 1;
    await registrarAccion({
      nombre,
      telefono,
      estado: 'Error',
      comentario: `Error: ${error.message}`
    });
  }
}

function obtenerTemplates() {
  const templates = [];
  for (const selector of SELECTORS.templateItem) {
    const elementos = document.querySelectorAll(selector);
    if (elementos.length > 0) {
      return Array.from(elementos);
    }
  }
  return templates;
}

async function registrarAccion(data) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({
      action: 'guardar',
      data: {
        nombre: data.nombre,
        telefono: data.telefono,
        estado: data.estado,
        comentario: data.comentario,
        operador: botState.operador
      }
    }, (response) => {
      resolve(response);
    });
  });
}

function esperar(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}