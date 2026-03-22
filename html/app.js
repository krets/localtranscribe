import { pipeline, env } from 'https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.0';

env.allowLocalModels = false;

const statusEl = document.getElementById('status');
const transcriptEl = document.getElementById('transcript');
let transcriber = null;

async function init() {
  statusEl.textContent = "Loading Whisper Model...";
  transcriber = await pipeline('automatic-speech-recognition', 'Xenova/whisper-tiny.en');
  statusEl.textContent = "Ready. Share a voice note to transcribe.";
  
  // Check for shared files after the model is ready
  checkSharedFile();
}

async function checkSharedFile() {
  const cache = await caches.open('share-target-cache');
  const response = await cache.match('/shared-audio');
  
  if (response) {
    const file = await response.blob();
    await cache.delete('/shared-audio'); // Clean up the cache
    processAudio(file);
  }
}

async function processAudio(file) {
  statusEl.textContent = "Decoding audio...";
  const arrayBuffer = await file.arrayBuffer();
  
  const audioContext = new AudioContext({ sampleRate: 16000 });
  const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
  
  statusEl.textContent = "Transcribing...";
  const audioData = audioBuffer.getChannelData(0);
  
  const result = await transcriber(audioData);
  transcriptEl.textContent = result.text;
  statusEl.textContent = "Done.";
}

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js');
}

init();

