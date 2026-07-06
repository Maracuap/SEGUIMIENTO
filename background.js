const API_URL = 'https://script.google.com/macros/s/AKfycbyjVOBUQY6zKmtAHMqshp_VuwiO9KlMD-CN4-f4ui6NsYHonjxgXt0PM09TgaQv5fTjEw/exec';
const MAX_RETRIES = 3;
const RETRY_DELAY = 2000;

let recordQueue = [];
let isProcessingQueue = false;
let queueRetryCount = {};

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'guardar') {
    enqueueRecord(message.data, sendResponse);
  } else if (message.action === 'getStats') {
    getStats(sendResponse);
  }
  return true;
});

function enqueueRecord(data, sendResponse) {
  const record = {
    id: `${Date.now()}-${Math.random()}`,
    fecha: new Date().toLocaleString('es-AR'),
    nombre: data.nombre || '',
    telefono: data.telefono || '',
    estado: data.estado || '',
    comentario: data.comentario || '',
    operador: data.operador || 'Sistema',
    timestamp: Date.now()
  };

  recordQueue.push(record);
  processQueue();

  sendResponse({ success: true, queued: recordQueue.length });
}

async function processQueue() {
  if (isProcessingQueue || recordQueue.length === 0) return;

  isProcessingQueue = true;

  while (recordQueue.length > 0) {
    const record = recordQueue[0];
    const recordId = record.id;
    const attempts = queueRetryCount[recordId] || 0;

    const success = await sendToAPI(record, attempts);

    if (success) {
      recordQueue.shift();
      delete queueRetryCount[recordId];
      await incrementStat(record.estado);
    } else if (attempts < MAX_RETRIES) {
      queueRetryCount[recordId] = attempts + 1;
      await new Promise(resolve => setTimeout(resolve, RETRY_DELAY * (attempts + 1)));
    } else {
      recordQueue.shift();
      delete queueRetryCount[recordId];
      await incrementStat('errores');
    }
  }

  isProcessingQueue = false;
}

async function sendToAPI(record, attempt = 0) {
  try {
    const response = await fetch(API_URL, {
      method: 'POST',
      mode: 'no-cors',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(record)
    });

    return true;
  } catch (error) {
    console.error(`❌ Error enviando registro (intento ${attempt + 1}/${MAX_RETRIES}):`, error);
    return false;
  }
}

async function incrementStat(estado) {
  const stats = await getStorageStats();

  if (estado === 'Enviado seguimiento') {
    stats.enviados = (stats.enviados || 0) + 1;
  } else if (estado === 'Anclado (respondió)') {
    stats.anclados = (stats.anclados || 0) + 1;
  } else if (estado === 'Cerrado') {
    stats.cerrados = (stats.cerrados || 0) + 1;
  } else if (estado === 'errores') {
    stats.errores = (stats.errores || 0) + 1;
  }

  await chrome.storage.local.set({ stats });
}

async function getStorageStats() {
  return new Promise((resolve) => {
    chrome.storage.local.get('stats', (result) => {
      resolve(result.stats || {
        enviados: 0,
        anclados: 0,
        cerrados: 0,
        errores: 0
      });
    });
  });
}

function getStats(sendResponse) {
  chrome.storage.local.get('stats', (result) => {
    sendResponse(result.stats || {
      enviados: 0,
      anclados: 0,
      cerrados: 0,
      errores: 0
    });
  });
}

chrome.storage.local.get('stats', (result) => {
  if (!result.stats) {
    chrome.storage.local.set({
      stats: {
        enviados: 0,
        anclados: 0,
        cerrados: 0,
        errores: 0
      }
    });
  }
});