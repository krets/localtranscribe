import { pipeline, env } from 'https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.0';

// Global State
let transcriber = null;
let currentAudioBuffer = null;
let currentFile = null;
let isTranscribing = false;
let deferredPrompt = null;

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

// UI Elements
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
};

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  els.installBtn.style.display = 'inline-block';
});

// --- Initialization ---

async function init() {
  loadPrefs();
  applyTheme();
  setupEventListeners();
  updateModelsUI();
  await initDB();
  await loadCachedAudio();
  await renderHistory();

  // Short delay to ensure SW is settled before checking cache
  setTimeout(checkSharedFile, 500);
}

function loadPrefs() {
  const saved = localStorage.getItem('localtranscribe_prefs');
  if (saved) Object.assign(PREFS, JSON.parse(saved));
  els.historyToggle.checked = PREFS.historyEnabled;
  els.themeSelect.value = PREFS.theme || 'system';
}

function savePrefs() {
  localStorage.setItem('localtranscribe_prefs', JSON.stringify(PREFS));
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
  els.audioArea.onclick = () => els.fileUpload.click();
  els.fileUpload.onchange = (e) => handleFileSelect(e.target.files[0], false);

  els.audioArea.ondragover = (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; };
  els.audioArea.ondrop = (e) => {
    e.preventDefault();
    if (e.dataTransfer.files.length) handleFileSelect(e.dataTransfer.files[0], false);
  };

  els.transcribeBtn.onclick = () => startTranscription();
  els.flushBtnX.onclick = () => flushAudio();
  
  els.installBtn.onclick = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      els.installBtn.style.display = 'none';
    }
    deferredPrompt = null;
  };
  
  els.historyToggle.onchange = (e) => {
    PREFS.historyEnabled = e.target.checked;
    savePrefs();
  };

  els.themeSelect.onchange = (e) => {
    PREFS.theme = e.target.value;
    savePrefs();
    applyTheme();
  };

  // Tabs
  document.getElementById('tab-btn-transcribe').onclick = (e) => showTab('transcribe-tab', e.target);
  document.getElementById('tab-btn-settings').onclick = (e) => showTab('settings-tab', e.target);
}

function showTab(id, btn) {
  document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  btn.classList.add('active');
}

// --- DB Operations ---
let db;
async function initDB() {
  return new Promise((resolve) => {
    const request = indexedDB.open('localtranscribe_db', 2);
    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('history')) db.createObjectStore('history', { keyPath: 'id', autoIncrement: true });
      if (!db.objectStoreNames.contains('cache')) db.createObjectStore('cache', { keyPath: 'key' });
    };
    request.onsuccess = (e) => { db = e.target.result; resolve(); };
  });
}

async function saveToHistory(text, autoExpand = false) {
  if (!PREFS.historyEnabled) return null;
  const item = { text, date: new Date().toISOString() };
  const tx = db.transaction('history', 'readwrite');
  const store = tx.objectStore('history');
  const request = store.add(item);
  
  return new Promise(resolve => {
    tx.oncomplete = () => {
      renderHistory(request.result); // Pass the new ID to auto-expand
      resolve(request.result);
    };
  });
}

async function renderHistory(expandId = null) {
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

    const isNew = index === 0 && (new Date() - dateObj < 60000); // New if < 1 min old

    const summary = document.createElement('div');
    summary.className = 'history-summary';
    summary.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center;">
        <div class="history-date">${dateStr}</div>
        ${isNew ? '<span class="badge-success" style="font-size:0.7em; background:var(--success); color:white; padding:2px 6px; border-radius:4px;">NEW</span>' : ''}
      </div>
      <div class="history-text-preview">${item.text}</div>
    `;
    
    const details = document.createElement('div');
    details.className = 'history-details';
    
    const headerDiv = document.createElement('div');
    headerDiv.style.display = 'flex';
    headerDiv.style.justifyContent = 'space-between';
    headerDiv.style.fontSize = '0.75em';
    headerDiv.style.marginBottom = '8px';
    headerDiv.style.color = 'var(--secondary)';
    headerDiv.style.fontWeight = 'bold';
    headerDiv.innerHTML = `<span>${dateStr}</span><span style="cursor:pointer; color:var(--primary);" onclick="this.closest('.history-item').classList.remove('active')">COLLAPSE ↑</span>`;

    const fullTextDiv = document.createElement('div');
    fullTextDiv.className = 'history-full-text';
    fullTextDiv.textContent = item.text;
    
    const actionsDiv = document.createElement('div');
    actionsDiv.className = 'controls';
    
    const copyBtn = document.createElement('button');
    copyBtn.className = 'btn btn-secondary btn-icon';
    copyBtn.title = 'Copy to clipboard';
    copyBtn.innerHTML = '<svg class="icon" viewBox="0 0 24 24"><path d="M19,21H8V7H19M19,5H8A2,2 0 0,0 6,7V21A2,2 0 0,0 8,23H19A2,2 0 0,0 21,21V7A2,2 0 0,0 19,5M16,1H4A2,2 0 0,0 2,3V17H4V3H16V1Z" /></svg>';
    copyBtn.onclick = (e) => {
      e.stopPropagation();
      navigator.clipboard.writeText(item.text);
      const original = copyBtn.innerHTML;
      copyBtn.innerHTML = '<svg class="icon" viewBox="0 0 24 24"><path d="M21,7L9,19L3.5,13.5L4.91,12.09L9,16.17L19.59,5.59L21,7Z" /></svg>';
      setTimeout(() => copyBtn.innerHTML = original, 2000);
    };
    
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'btn btn-danger btn-icon';
    deleteBtn.title = 'Delete transcription';
    deleteBtn.innerHTML = '<svg class="icon" viewBox="0 0 24 24"><path d="M19,4H15.5L14.5,3H9.5L8.5,4H5V6H19V4M6,19A2,2 0 0,0 8,21H16A2,2 0 0,0 18,19V7H6V19Z" /></svg>';
    deleteBtn.onclick = async (e) => {
      e.stopPropagation();
      if (!confirm('Delete this transcription?')) return;
      const tx = db.transaction('history', 'readwrite');
      tx.objectStore('history').delete(item.id);
      tx.oncomplete = () => renderHistory();
    };
    
    actionsDiv.appendChild(copyBtn);
    actionsDiv.appendChild(deleteBtn);
    details.appendChild(headerDiv);
    details.appendChild(fullTextDiv);
    details.appendChild(actionsDiv);
    
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
  const tx = db.transaction('cache', 'readwrite');
  tx.objectStore('cache').put({ key: 'currentAudio', file, name: file.name });
  await processAudioFile(file);
  
  if (startNow) {
    startTranscription();
  }
}

async function processAudioFile(file) {
  els.statusText.textContent = "Loading audio...";
  els.audioFilename.textContent = file.name;
  els.audioInfo.classList.remove('hidden');
  els.audioArea.classList.add('hidden');

  const arrayBuffer = await file.arrayBuffer();
  const audioContext = new AudioContext({ sampleRate: 16000 });
  
  try {
    currentAudioBuffer = await audioContext.decodeAudioData(arrayBuffer);
    const duration = currentAudioBuffer.duration;
    els.statAudioLen.textContent = `${Math.floor(duration / 60)}:${Math.floor(duration % 60).toString().padStart(2, '0')}`;
    els.statusText.textContent = "Ready.";
  } catch (e) {
    els.statusText.textContent = "Error decoding audio.";
    console.error(e);
  }
}

async function loadCachedAudio() {
  const tx = db.transaction('cache', 'readonly');
  const req = tx.objectStore('cache').get('currentAudio');
  req.onsuccess = async () => {
    if (req.result) {
      currentFile = req.result.file;
      await processAudioFile(currentFile);
    }
  };
}

function flushAudio() {
  currentAudioBuffer = null;
  currentFile = null;
  els.audioInfo.classList.add('hidden');
  els.audioArea.classList.remove('hidden');
  els.statusText.textContent = "Ready.";
  els.statAudioLen.textContent = "--:--";
  els.statTranscribeTime.textContent = "--s";
  
  const tx = db.transaction('cache', 'readwrite');
  tx.objectStore('cache').delete('currentAudio');
}

// --- Model Handling ---

async function updateModelsUI() {
  els.modelsList.innerHTML = '';
  const cache = await caches.open('transformers-cache');
  
  for (const m of MODELS) {
    const div = document.createElement('div');
    div.style.display = 'flex';
    div.style.justifyContent = 'space-between';
    div.style.alignItems = 'center';
    div.style.padding = '8px 0';
    div.style.borderBottom = '1px solid var(--border)';
    
    const isSelected = PREFS.selectedModel === m.id;
    const isCached = await cache.match(`https://huggingface.co/${m.id}/resolve/main/config.json`);

    div.innerHTML = `
      <div style="font-size: 0.9em;">
        <strong>${m.name}</strong> <span style="font-size:0.8em; opacity:0.7;">(${m.size})</span>
        ${isSelected ? '<span style="color: var(--success); margin-left:5px;">●</span>' : ''}
        ${isCached ? '<span style="color: var(--secondary); margin-left:5px; font-size:0.8em;">(Saved)</span>' : ''}
      </div>
      <div class="controls" style="margin-top:0;">
        <button class="btn btn-secondary btn-sm" onclick="window.selectModel('${m.id}')" ${isSelected ? 'disabled' : ''}>${isSelected ? 'Selected' : 'Select'}</button>
        ${isCached ? `<button class="btn btn-danger btn-sm" onclick="window.deleteModel('${m.id}')">Del</button>` : ''}
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
  const cache = await caches.open('transformers-cache');
  const keys = await cache.keys();
  for (const key of keys) {
    if (key.url.includes(modelId)) await cache.delete(key);
  }
  if (PREFS.selectedModel === modelId) transcriber = null;
  updateModelsUI();
};

// --- Transcription ---

async function startTranscription() {
  if (isTranscribing || !currentAudioBuffer) return;
  isTranscribing = true;
  els.transcribeBtn.disabled = true;
  els.progressContainer.style.display = 'none'; // Only show if downloading
  
  const startTime = performance.now();
  els.statTranscribeTime.textContent = "...";
  
  try {
    if (!transcriber) {
      els.statusText.textContent = "Preparing model...";
      transcriber = await pipeline('automatic-speech-recognition', PREFS.selectedModel, {
        progress_callback: (p) => {
          if (p.status === 'progress') {
            els.progressContainer.style.display = 'block';
            els.progressBar.style.width = p.progress + '%';
            els.statusText.textContent = `Downloading model: ${Math.round(p.progress)}%`;
          } else if (p.status === 'ready') {
            els.progressContainer.style.display = 'none';
            els.statusText.textContent = "Model ready.";
          }
        }
      });
    }

    els.statusText.innerHTML = 'Transcribing... <span class="spinner"></span>';
    
    // Give browser a moment to paint the spinner
    await new Promise(r => setTimeout(r, 100));

    const audioData = currentAudioBuffer.getChannelData(0);
    const result = await transcriber(audioData);
    
    const duration = ((performance.now() - startTime) / 1000).toFixed(1);
    els.statTranscribeTime.textContent = `${duration}s`;
    
    els.statusText.innerHTML = '<span class="badge-success"><svg class="icon" viewBox="0 0 24 24"><path d="M21,7L9,19L3.5,13.5L4.91,12.09L9,16.17L19.59,5.59L21,7Z" /></svg> Success</span>';
    await saveToHistory(result.text, true);
    updateModelsUI(); // Refresh "Saved" status

  } catch (err) {
    console.error(err);
    els.statusText.textContent = "Error occurred.";
    transcriber = null; // Reset on error
  } finally {
    isTranscribing = false;
    els.transcribeBtn.disabled = false;
    els.progressContainer.style.display = 'none';
  }
}

async function checkSharedFile() {
  const urlParams = new URLSearchParams(window.location.search);
  const isShareFromUrl = urlParams.has('share');
  if (isShareFromUrl) {
    // Clear URL param without reload
    window.history.replaceState({}, document.title, "/");
  }

  if (!('serviceWorker' in navigator)) return;

  // Poll for the shared file in the Cache Storage (up to 10 attempts over 2 seconds)
  let attempts = 0;
  while (attempts < 10) {
    const cache = await caches.open('share-target-cache');
    const response = await cache.match('/shared-audio');
    
    if (response) {
      els.statusText.textContent = "Detecting shared file...";
      const file = await response.blob();
      const filenameRaw = response.headers.get('x-filename') || 'Shared Audio';
      const filename = decodeURIComponent(filenameRaw);
      const sharedFile = new File([file], filename, { type: file.type });
      
      await cache.delete('/shared-audio');
      
      console.log('Processing shared file:', filename);
      if (!db) await initDB();
      // Share from app: start transcription immediately
      await handleFileSelect(sharedFile, true);
      return;
    }
    
    // If we have the share param, we're very likely to get a file soon, so we wait
    await new Promise(r => setTimeout(r, 200));
    attempts++;
  }
}

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js');
}

init();
