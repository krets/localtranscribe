const CACHE_NAME = 'localtranscribe-v3';
const ASSETS = [
  '/',
  '/index.html',
  '/app.js',
  '/manifest.json',
  '/icon-192-v3.png',
  '/icon-512-v3.png',
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
  if (event.request.method === 'POST' && (url.pathname === '/' || url.pathname === '/index.html')) {
    event.respondWith((async () => {
      try {
        const formData = await event.request.formData();
        const file = formData.get('audio_file');
        
        if (file) {
          const cache = await caches.open('share-target-cache');
          await cache.put('/shared-audio', new Response(file, {
            headers: { 'x-filename': encodeURIComponent(file.name || 'Shared Audio') }
          }));
        }
      } catch (err) {
        console.error('Share target error:', err);
      }
      return Response.redirect('/?share=1', 303);
    })());
    return;
  }

  event.respondWith(
    caches.match(event.request).then((response) => {
      return response || fetch(event.request);
    })
  );
});
