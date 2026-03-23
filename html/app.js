import { pipeline, env } from 'https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.0';

// Global State
let transcriber = null;
let currentAudioBuffer = null;
let currentFile = null;
let isTranscribing = false;
let deferredPrompt = null;
let db = null;

// Preferences
const PREFS = {
  selectedModel: 'Xenova/whisper-tiny.en',
  historyEnabled: true,
  theme: 'system',
};

const MODELS = [
  { id: 'Xenova/whisper-tiny.en', name: 'Tiny (English only)', size: '75 MB' },
  { id: 'Xenova/whisper-base.en', name: 'Base (English only)', size: '145 MB' },
  { id: 'Xenova/whisper-small.en', name: 'Small (English only)', size: '465 MB' },
  { id: 'Xenova/whisper-tiny', name: 'Tiny (Multilingual)', size: '75 MB' },
  { id: 'Xenova/whisper-base', name: 'Base (Multilingual)', size: '145 MB' },
  { id: 'Xenova/whisper-small', name: 'Small (Multilingual)', size: '465 MB' },
];

// UI Elements - Direct selection
const els = {
  audioArea: document.getElementById('audio-area'),
  fileUpload: document.getElementById('file-upload'),
  audioInfo: document.getElementById('audio-info'),
  audioFilename: document.getElementById('audio-filename'),
  transcribeBtn: document.getElementById('transcribe-btn'),
  flushBtnX: document.getElementById('flush-btn-x'),
  progressBar: document.getElementById('progress-bar'),
  progressContainer: document.getElementById('progress-container'),
  statusText: document.getElementById('status-text'),
  statAudioLen: document.getElementById('stat-audio-len'),
  statTranscribeTime: document.getElementById('stat-transcribe-time'),
  historyToggle: document.getElementById('history-toggle'),
  themeSelect: document.getElementById('theme-select'),
  historyList: document.getElementById('history-list'),
  modelsList: document.getElementById('models-list'),
  installBtn: document.getElementById('install-btn'),
  welcomeBanner: document.getElementById('welcome-banner'),
  closeWelcome: document.getElementById('close-welcome'),
  infoIcon: document.getElementById('info-icon')
};

// --- Initialization ---

async function init() {
  try {
    loadPrefs();
    applyTheme();
    setupEventListeners();
    
    // Non-critical background init
    initDB()
      .then(() => {
        updateModelsUI();
        loadCachedAudio();
        renderHistory();
      })
      .catch(e => console.error('DB Init Error:', e));

    if (localStorage.getItem('welcome_dismissed')) {
      if (els.welcomeBanner) els.welcomeBanner.style.display = 'none';
      if (els.infoIcon) els.infoIcon.style.display = 'inline';
    }

    // Check for shared file
    setTimeout(checkSharedFile, 500);
    
  } catch (err) {
    console.error('Initialization error:', err);
    if (els.statusText) {
      els.statusText.textContent = "Initialization error. Please reload.";
      els.statusText.style.color = 'var(--danger)';
    }
  }
}

function loadPrefs() {
  try {
    const saved = localStorage.getItem('localtranscribe_prefs');
    if (saved) Object.assign(PREFS, JSON.parse(saved));
  } catch (e) {
    console.warn('Could not load preferences:', e);
  }
  
  if (els.historyToggle) els.historyToggle.checked = PREFS.historyEnabled;
  if (els.themeSelect) els.themeSelect.value = PREFS.theme || 'system';
}

function savePrefs() {
  try {
    localStorage.setItem('localtranscribe_prefs', JSON.stringify(PREFS));
  } catch (e) {
    console.warn('Could not save preferences:', e);
  }
}

function applyTheme() {
  const theme = PREFS.theme || 'system';
  if (theme === 'system') {
    document.documentElement.removeAttribute('data-theme');
  } else {
    document.documentElement.setAttribute('data-theme', theme);
  }
}

function setupEventListeners() {
  if (els.audioArea) {
    els.audioArea.onclick = (e) => { e.preventDefault(); els.fileUpload && els.fileUpload.click(); };
    els.audioArea.ondragover = (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; };
    els.audioArea.ondrop = (e) => {
      e.preventDefault();
      if (e.dataTransfer.files.length) handleFileSelect(e.dataTransfer.files[0], false);
    };
  }

  if (els.fileUpload) {
    els.fileUpload.onchange = (e) => handleFileSelect(e.target.files[0], false);
  }

  if (els.transcribeBtn) els.transcribeBtn.onclick = () => startTranscription();
  if (els.flushBtnX) els.flushBtnX.onclick = () => flushAudio();
  
  if (els.installBtn) {
    els.installBtn.onclick = async () => {
      if (!deferredPrompt) return;
      deferredPrompt.prompt();
      try {
        const { outcome } = await deferredPrompt.userChoice;
        if (outcome === 'accepted') els.installBtn.style.display = 'none';
      } catch (e) {}
      deferredPrompt = null;
    };
  }

  if (els.closeWelcome) {
    els.closeWelcome.onclick = () => {
      if (els.welcomeBanner) els.welcomeBanner.style.display = 'none';
      if (els.infoIcon) els.infoIcon.style.display = 'inline';
      try { localStorage.setItem('welcome_dismissed', 'true'); } catch (e) {}
    };
  }

  if (els.infoIcon) {
    els.infoIcon.onclick = () => {
      if (els.welcomeBanner) els.welcomeBanner.style.display = 'block';
      if (els.infoIcon) els.infoIcon.style.display = 'none';
      try { localStorage.removeItem('welcome_dismissed'); } catch (e) {}
    };
  }
  
  if (els.historyToggle) {
    els.historyToggle.onchange = (e) => {
      PREFS.historyEnabled = e.target.checked;
      savePrefs();
    };
  }

  if (els.themeSelect) {
    els.themeSelect.onchange = (e) => {
      PREFS.theme = e.target.value;
      savePrefs();
      applyTheme();
    };
  }

  // Tabs
  const transcribeTabBtn = document.getElementById('tab-btn-transcribe');
  const settingsTabBtn = document.getElementById('tab-btn-settings');
  if (transcribeTabBtn) transcribeTabBtn.onclick = (e) => showTab('transcribe-tab', e.currentTarget);
  if (settingsTabBtn) settingsTabBtn.onclick = (e) => showTab('settings-tab', e.currentTarget);
}

function showTab(id, btn) {
  document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  const target = document.getElementById(id);
  if (target) target.classList.add('active');
  if (btn) btn.classList.add('active');
}

// --- DB Operations ---

async function initDB() {
  return new Promise((resolve, reject) => {
    try {
      const request = indexedDB.open('localtranscribe_db', 2);
      request.onupgradeneeded = (e) => {
        const database = e.target.result;
        if (!database.objectStoreNames.contains('history')) database.createObjectStore('history', { keyPath: 'id', autoIncrement: true });
        if (!database.objectStoreNames.contains('cache')) database.createObjectStore('cache', { keyPath: 'key' });
      };
      request.onsuccess = (e) => { db = e.target.result; resolve(); };
      request.onerror = (e) => { console.error('IndexedDB Error:', e); reject(e); };
    } catch (e) { reject(e); }
  });
}

async function saveToHistory(text, autoExpand = false) {
  if (!PREFS.historyEnabled || !db) return null;
  const item = { text, date: new Date().toISOString() };
  const tx = db.transaction('history', 'readwrite');
  const store = tx.objectStore('history');
  const request = store.add(item);
  
  return new Promise(resolve => {
    tx.oncomplete = () => {
      renderHistory(request.result); 
      resolve(request.result);
    };
  });
}

async function renderHistory(expandId = null) {
  if (!db || !els.historyList) return;
  
  const tx = db.transaction('history', 'readonly');
  const items = await new Promise(r => {
    const req = tx.objectStore('history').getAll();
    req.onsuccess = () => r(req.result);
  });
  
  els.historyList.innerHTML = '';
  const sortedItems = items.sort((a, b) => new Date(b.date) - new Date(a.date));
  
  sortedItems.forEach((item, index) => {
    const div = document.createElement('div');
    div.className = 'history-item';
    if (item.id === expandId) div.classList.add('active');
    
    const dateObj = new Date(item.date);
    const dateStr = dateObj.toLocaleDateString() + ' ' + dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const isNew = index === 0 && (new Date() - dateObj < 60000);

    const summary = document.createElement('div');
    summary.className = 'history-summary';
    summary.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center;">
        <div class="history-date">${dateStr}</div>
        ${isNew ? '<span class="badge-success" style="font-size:0.65em; background:var(--success); color:white; padding:1px 5px; border-radius:3px;">NEW</span>' : ''}
      </div>
      <div class="history-text-preview">${item.text}</div>
    `;
    
    const details = document.createElement('div');
    details.className = 'history-details';
    
    const headerDiv = document.createElement('div');
    headerDiv.style.display = 'flex';
    headerDiv.style.justifyContent = 'space-between';
    headerDiv.style.alignItems = 'center';
    headerDiv.style.marginBottom = '10px';
    
    const dateSpan = document.createElement('span');
    dateSpan.className = 'history-date';
    dateSpan.textContent = dateStr;

    const topActions = document.createElement('div');
    topActions.style.display = 'flex';
    topActions.style.gap = '8px';
    topActions.style.alignItems = 'center';

    const collapseBtn = document.createElement('span');
    collapseBtn.style.cursor = 'pointer';
    collapseBtn.style.color = 'var(--primary)';
    collapseBtn.style.fontSize = '0.75em';
    collapseBtn.style.fontWeight = 'bold';
    collapseBtn.textContent = 'COLLAPSE ↑';
    collapseBtn.onclick = (e) => { e.stopPropagation(); div.classList.remove('active'); };

    const copyBtn = document.createElement('button');
    copyBtn.className = 'btn-ghost';
    copyBtn.title = 'Copy';
    copyBtn.innerHTML = '<svg class="icon" style="width:16px; height:16px;" viewBox="0 0 24 24"><path d="M19,21H8V7H19M19,5H8A2,2 0 0,0 6,7V21A2,2 0 0,0 8,23H19A2,2 0 0,0 21,21V7A2,2 0 0,0 19,5M16,1H4A2,2 0 0,0 2,3V17H4V3H16V1Z" /></svg>';
    copyBtn.onclick = (e) => {
      e.stopPropagation();
      navigator.clipboard.writeText(item.text);
      const original = copyBtn.innerHTML;
      copyBtn.innerHTML = '<svg class="icon" style="width:16px; height:16px; color:var(--success);" viewBox="0 0 24 24"><path d="M21,7L9,19L3.5,13.5L4.91,12.09L9,16.17L19.59,5.59L21,7Z" /></svg>';
      setTimeout(() => copyBtn.innerHTML = original, 2000);
    };
    
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'btn-ghost btn-ghost-danger';
    deleteBtn.title = 'Delete';
    deleteBtn.innerHTML = '<svg class="icon" style="width:16px; height:16px;" viewBox="0 0 24 24"><path d="M19,4H15.5L14.5,3H9.5L8.5,4H5V6H19V4M6,19A2,2 0 0,0 8,21H16A2,2 0 0,0 18,19V7H6V19Z" /></svg>';
    deleteBtn.onclick = async (e) => {
      e.stopPropagation();
      if (!confirm('Delete this transcription?')) return;
      const tx = db.transaction('history', 'readwrite');
      tx.objectStore('history').delete(item.id);
      tx.oncomplete = () => renderHistory();
    };

    topActions.appendChild(collapseBtn);
    topActions.appendChild(copyBtn);
    topActions.appendChild(deleteBtn);
    
    headerDiv.appendChild(dateSpan);
    headerDiv.appendChild(topActions);

    const fullTextDiv = document.createElement('div');
    fullTextDiv.className = 'history-full-text';
    fullTextDiv.textContent = item.text;
    
    details.appendChild(headerDiv);
    details.appendChild(fullTextDiv);
    
    summary.onclick = () => div.classList.toggle('active');
    
    div.appendChild(summary);
    div.appendChild(details);
    els.historyList.appendChild(div);
  });
}

// --- Audio Handling ---

async function handleFileSelect(file, startNow = false) {
  if (!file) return;
  currentFile = file;
  if (db) {
    try {
      const tx = db.transaction('cache', 'readwrite');
      tx.objectStore('cache').put({ key: 'currentAudio', file, name: file.name });
    } catch (e) {}
  }
  await processAudioFile(file);
  
  if (startNow) {
    startTranscription();
  }
}

async function processAudioFile(file) {
  if (els.statusText) els.statusText.textContent = "Loading audio...";
  if (els.audioFilename) els.audioFilename.textContent = file.name;
  if (els.audioInfo) els.audioInfo.classList.remove('hidden');
  if (els.audioArea) els.audioArea.classList.add('hidden');

  try {
    const arrayBuffer = await file.arrayBuffer();
    const audioContext = new AudioContext({ sampleRate: 16000 });
    currentAudioBuffer = await audioContext.decodeAudioData(arrayBuffer);
    const duration = currentAudioBuffer.duration;
    if (els.statAudioLen) els.statAudioLen.textContent = `${Math.floor(duration / 60)}:${Math.floor(duration % 60).toString().padStart(2, '0')}`;
    if (els.statusText) els.statusText.textContent = "Ready.";
  } catch (e) {
    if (els.statusText) els.statusText.textContent = "Error decoding audio.";
    console.error(e);
  }
}

async function loadCachedAudio() {
  if (!db) return;
  try {
    const tx = db.transaction('cache', 'readonly');
    const req = tx.objectStore('cache').get('currentAudio');
    req.onsuccess = async () => {
      if (req.result) {
        currentFile = req.result.file;
        await processAudioFile(currentFile);
      }
    };
  } catch (e) {}
}

function flushAudio() {
  currentAudioBuffer = null;
  currentFile = null;
  if (els.audioInfo) els.audioInfo.classList.add('hidden');
  if (els.audioArea) els.audioArea.classList.remove('hidden');
  if (els.statusText) els.statusText.textContent = "Ready.";
  if (els.statAudioLen) els.statAudioLen.textContent = "--:--";
  if (els.statTranscribeTime) els.statTranscribeTime.textContent = "--s";
  
  if (db) {
    try {
      const tx = db.transaction('cache', 'readwrite');
      tx.objectStore('cache').delete('currentAudio');
    } catch (e) {}
  }
}

// --- Model Handling ---

async function updateModelsUI() {
  if (!els.modelsList) return;
  els.modelsList.innerHTML = '';
  let cache;
  try {
    cache = await caches.open('transformers-cache');
  } catch (e) {
    console.warn('Cache API not available');
  }
  
  for (const m of MODELS) {
    const div = document.createElement('div');
    div.style.display = 'flex';
    div.style.justifyContent = 'space-between';
    div.style.alignItems = 'center';
    div.style.padding = '10px 0';
    div.style.borderBottom = '1px solid var(--border)';
    
    const isSelected = PREFS.selectedModel === m.id;
    let isCached = false;
    if (cache) {
      try {
        isCached = await cache.match(`https://huggingface.co/${m.id}/resolve/main/config.json`);
      } catch (e) {}
    }

    div.innerHTML = `
      <div style="font-size: 0.9em;">
        <strong>${m.name}</strong> <span style="font-size:0.8em; opacity:0.7;">(${m.size})</span>
        ${isSelected ? '<span style="color: var(--success); margin-left:5px;">●</span>' : ''}
        ${isCached ? '<span style="color: var(--secondary); margin-left:5px; font-size:0.8em;">(Saved)</span>' : ''}
      </div>
      <div class="controls" style="margin-top:0;">
        <button class="btn btn-secondary btn-sm" onclick="window.selectModel('${m.id}')" ${isSelected ? 'disabled' : ''}>${isSelected ? 'Selected' : 'Select'}</button>
        ${isCached ? `<button class="btn btn-danger btn-icon btn-sm" onclick="window.deleteModel('${m.id}')" title="Delete model files"><svg class="icon" style="width:14px; height:14px;" viewBox="0 0 24 24"><path d="M19,4H15.5L14.5,3H9.5L8.5,4H5V6H19V4M6,19A2,2 0 0,0 8,21H16A2,2 0 0,0 18,19V7H6V19Z" /></svg></button>` : ''}
      </div>
    `;
    els.modelsList.appendChild(div);
  }
}

window.selectModel = (modelId) => {
  PREFS.selectedModel = modelId;
  savePrefs();
  updateModelsUI();
  transcriber = null;
};

window.deleteModel = async (modelId) => {
  if (!confirm(`Delete model files for ${modelId}?`)) return;
  try {
    const cache = await caches.open('transformers-cache');
    const keys = await cache.keys();
    for (const key of keys) {
      if (key.url.includes(modelId)) await cache.delete(key);
    }
    if (PREFS.selectedModel === modelId) transcriber = null;
    updateModelsUI();
  } catch (e) {}
};

// --- Transcription ---

async function startTranscription() {
  if (isTranscribing || !currentAudioBuffer) return;
  isTranscribing = true;
  if (els.transcribeBtn) els.transcribeBtn.disabled = true;
  if (els.progressContainer) els.progressContainer.style.display = 'none'; 
  
  const startTime = performance.now();
  if (els.statTranscribeTime) els.statTranscribeTime.textContent = "...";
  
  try {
    if (!transcriber) {
      if (els.statusText) els.statusText.textContent = "Preparing model...";
      transcriber = await pipeline('automatic-speech-recognition', PREFS.selectedModel, {
        progress_callback: (p) => {
          if (p.status === 'progress' && els.progressContainer && els.progressBar && els.statusText) {
            els.progressContainer.style.display = 'block';
            els.progressBar.style.width = p.progress + '%';
            els.statusText.textContent = `Downloading model: ${Math.round(p.progress)}%`;
          } else if (p.status === 'ready' && els.progressContainer && els.statusText) {
            els.progressContainer.style.display = 'none';
            els.statusText.textContent = "Model ready.";
          }
        }
      });
    }

    if (els.statusText) els.statusText.innerHTML = 'Transcribing... <span class="spinner"></span>';
    
    await new Promise(r => setTimeout(r, 100));

    const audioData = currentAudioBuffer.getChannelData(0);
    const result = await transcriber(audioData, {
      chunk_length_s: 30,
      stride_length_s: 5,
      chunk_callback: (chunk) => {
        if (els.statusText) {
          // chunks is an array of already processed chunks
          const processedCount = chunk.chunks.length;
          // Approximate total chunks: duration / (chunk_length - stride)
          const estimatedTotal = Math.ceil(currentAudioBuffer.duration / 25);
          els.statusText.innerHTML = `Transcribing... chunk ${processedCount} / ~${estimatedTotal} <span class="spinner"></span>`;
        }
      }
    });
    
    const duration = ((performance.now() - startTime) / 1000).toFixed(1);
    if (els.statTranscribeTime) els.statTranscribeTime.textContent = `${duration}s`;
    
    if (els.statusText) els.statusText.innerHTML = '<span class="badge-success"><svg class="icon" viewBox="0 0 24 24"><path d="M21,7L9,19L3.5,13.5L4.91,12.09L9,16.17L19.59,5.59L21,7Z" /></svg> Success</span>';
    await saveToHistory(result.text, true);
    updateModelsUI(); 

  } catch (err) {
    console.error(err);
    if (els.statusText) els.statusText.textContent = "Error occurred.";
    transcriber = null;
  } finally {
    isTranscribing = false;
    if (els.transcribeBtn) els.transcribeBtn.disabled = false;
    if (els.progressContainer) els.progressContainer.style.display = 'none';
  }
}

async function checkSharedFile() {
  const urlParams = new URLSearchParams(window.location.search);
  const isShareFromUrl = urlParams.has('share');
  if (isShareFromUrl) {
    window.history.replaceState({}, document.title, window.location.pathname);
  }

  if (!('serviceWorker' in navigator)) return;

  let attempts = 0;
  const maxAttempts = isShareFromUrl ? 25 : 10; 
  
  while (attempts < maxAttempts) {
    try {
      const cache = await caches.open('share-target-cache');
      const response = await cache.match('./shared-audio');
      
      if (response) {
        if (els.statusText) els.statusText.textContent = "Detecting shared file...";
        const blob = await response.blob();
        const filenameRaw = response.headers.get('x-filename') || 'Shared Audio';
        const filename = decodeURIComponent(filenameRaw);
        const sharedFile = new File([blob], filename, { type: blob.type || 'audio/wav' });
        
        await cache.delete('./shared-audio');
        
        if (!db) await initDB();
        await handleFileSelect(sharedFile, true);
        return;
      }
    } catch (e) {}
    
    await new Promise(r => setTimeout(r, 200));
    attempts++;
  }
}

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  if (els.installBtn) els.installBtn.style.display = 'inline-block';
});

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(console.error);
}

init();
