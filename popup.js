const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const intervalSelect = document.getElementById('interval');
const operadorInput = document.getElementById('operador');
const statusDiv = document.getElementById('status');
const processingLine = document.getElementById('processingLine');
const connectionAlert = document.getElementById('connectionAlert');
const enviadosDiv = document.getElementById('enviados');
const ancladosDiv = document.getElementById('anclados');
const cerradosDiv = document.getElementById('cerrados');
const erroresDiv = document.getElementById('errores');

let currentTab = null;
let statusCheckInterval = null;

startBtn.addEventListener('click', startBot);
stopBtn.addEventListener('click', stopBot);
intervalSelect.addEventListener('change', saveSettings);
operadorInput.addEventListener('change', saveSettings);

document.addEventListener('DOMContentLoaded', initializePopup);

function initializePopup() {
  loadSettings();
  findUContactTab();
  setupStatusPolling();
}

function loadSettings() {
  chrome.storage.local.get(['interval', 'operador'], (result) => {
    if (result.interval) {
      intervalSelect.value = result.interval;
    }
    if (result.operador) {
      operadorInput.value = result.operador;
    }
  });
}

function findUContactTab() {
  chrome.tabs.query({}, (tabs) => {
    const ucontactTabs = tabs.filter(tab => 
      tab.url && (tab.url.includes('ucontact.com') || tab.url.includes('ucontact.io'))
    );

    if (ucontactTabs.length === 0) {
      currentTab = null;
      updateUIForNoConnection();
      return;
    }

    currentTab = ucontactTabs[0];
    updateUIForConnection();
    updateStatusFromTab();
  });
}

function updateUIForNoConnection() {
  connectionAlert.style.display = 'block';
  startBtn.disabled = true;
  stopBtn.disabled = true;
  statusDiv.textContent = 'uContact cerrado';
  statusDiv.classList.remove('active');
  statusDiv.classList.add('inactive');
}

function updateUIForConnection() {
  connectionAlert.style.display = 'none';
  startBtn.disabled = false;
}

function setupStatusPolling() {
  if (statusCheckInterval) clearInterval(statusCheckInterval);
  statusCheckInterval = setInterval(() => {
    findUContactTab();
    if (currentTab) {
      updateStatusFromTab();
      updateStatsFromBackground();
    }
  }, 1000);
}

function saveSettings() {
  const interval = parseInt(intervalSelect.value);
  const operador = operadorInput.value || 'Sistema';

  chrome.storage.local.set({
    interval: interval,
    operador: operador
  });
}

function startBot() {
  if (!currentTab) {
    alert('Por favor abre uContact antes de iniciar el bot');
    return;
  }

  const interval = parseInt(intervalSelect.value);
  const operador = operadorInput.value || 'Sistema';

  saveSettings();

  chrome.tabs.sendMessage(currentTab.id, {
    action: 'start',
    config: {
      interval: interval,
      operador: operador
    }
  }, (response) => {
    if (chrome.runtime.lastError) {
      console.error('Error:', chrome.runtime.lastError);
      alert('Error: No se puede comunicar con uContact. Intenta recargar la página.');
    } else if (response && response.success) {
      startBtn.disabled = true;
      stopBtn.disabled = false;
      updateStatusFromTab();
    }
  });
}

function stopBot() {
  if (!currentTab) return;

  chrome.tabs.sendMessage(currentTab.id, { action: 'stop' }, (response) => {
    if (chrome.runtime.lastError) {
      console.error('Error:', chrome.runtime.lastError);
    } else if (response && response.success) {
      startBtn.disabled = false;
      stopBtn.disabled = true;
      processingLine.style.display = 'none';
      updateStatusFromTab();
    }
  });
}

function updateStatusFromTab() {
  if (!currentTab) {
    updateUIForNoConnection();
    return;
  }

  chrome.tabs.sendMessage(currentTab.id, { action: 'status' }, (response) => {
    if (chrome.runtime.lastError) {
      startBtn.disabled = false;
      stopBtn.disabled = true;
      statusDiv.textContent = 'Desconectado';
      statusDiv.classList.remove('active');
      statusDiv.classList.add('inactive');
      processingLine.style.display = 'none';
      return;
    }

    if (response) {
      if (response.running) {
        statusDiv.textContent = 'Activo';
        statusDiv.classList.add('active');
        statusDiv.classList.remove('inactive');
        startBtn.disabled = true;
        stopBtn.disabled = false;

        if (response.processing) {
          processingLine.style.display = 'flex';
        } else {
          processingLine.style.display = 'none';
        }
      } else {
        statusDiv.textContent = 'Detenido';
        statusDiv.classList.remove('active');
        statusDiv.classList.add('inactive');
        startBtn.disabled = false;
        stopBtn.disabled = true;
        processingLine.style.display = 'none';
      }

      if (response.stats) {
        enviadosDiv.textContent = response.stats.enviados || 0;
        ancladosDiv.textContent = response.stats.anclados || 0;
        cerradosDiv.textContent = response.stats.cerrados || 0;
        erroresDiv.textContent = response.stats.errores || 0;
      }
    }
  });
}

function updateStatsFromBackground() {
  chrome.runtime.sendMessage({ action: 'getStats' }, (response) => {
    if (chrome.runtime.lastError) {
      return;
    }

    if (response) {
      enviadosDiv.textContent = response.enviados || 0;
      ancladosDiv.textContent = response.anclados || 0;
      cerradosDiv.textContent = response.cerrados || 0;
      erroresDiv.textContent = response.errores || 0;
    }
  });
}

window.addEventListener('beforeunload', () => {
  if (statusCheckInterval) clearInterval(statusCheckInterval);
});