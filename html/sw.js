const CACHE_NAME = 'localtranscribe-v12';
const ASSETS = [
  './',
  'index.html',
  'app.js',
  'manifest.json',
  'icon-192-v12.png',
  'icon-512-v12.png',
  'https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.0'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.map((key) => {
        if (key !== CACHE_NAME && key !== 'share-target-cache' && key !== 'transformers-cache') {
          return caches.delete(key);
        }
      })
    ))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Handle Share Target POST request to root
  if (event.request.method === 'POST') {
    event.respondWith((async () => {
      try {
        const formData = await event.request.formData();
        const file = formData.get('audio_file');
        
        if (file) {
          const cache = await caches.open('share-target-cache');
          await cache.put('./shared-audio', new Response(file, {
            headers: { 
              'x-filename': encodeURIComponent(file.name || 'Shared Audio'),
              'Content-Type': file.type
            }
          }));
        }
      } catch (err) {
        console.error('SW: Share target form data error:', err);
      }
      return Response.redirect('./?share=1', 303);
    })());
    return;
  }

  event.respondWith(
    caches.match(event.request).then((response) => {
      return response || fetch(event.request);
    })
  );
});
