self.addEventListener('fetch', (event) => {
  if (event.request.method === 'POST' && event.request.url.endsWith('/transcribe/')) {
    event.respondWith((async () => {
      const formData = await event.request.formData();
      const file = formData.get('audio_file');
      
      // Store the file temporarily in the Cache API
      if (file) {
        const cache = await caches.open('share-target-cache');
        await cache.put('/shared-audio', new Response(file));
      }
      
      // Redirect to reload the page cleanly
      return Response.redirect('/transcribe/', 303);
    })());
  }
});

