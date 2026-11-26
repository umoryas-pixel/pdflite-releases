const C='pdflite-0.8.0';
self.addEventListener('install',e=>{self.skipWaiting();e.waitUntil(caches.open(C).then(c=>c.addAll(['./','index.html','app.js','app.css','vendor/pdf-lib.min.js','vendor/tweetnacl.min.js','annots.js','forms.js','pages.js','secure.js','a11y.js','pdfjs/pdf.min.mjs','pdfjs/pdf.worker.min.mjs','manifest.webmanifest','icons/icon-192.png','icons/icon-512.png']).catch(()=>{})))});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==C).map(k=>caches.delete(k)))).then(()=>self.clients.claim()))});
self.addEventListener('fetch',e=>{
  const r=e.request;if(r.method!=='GET'||new URL(r.url).origin!==location.origin)return;
  e.respondWith(fetch(r).then(x=>{if(x.ok){const cp=x.clone();caches.open(C).then(c=>c.put(r,cp))}return x}).catch(()=>caches.match(r).then(m=>m||caches.match('index.html'))));
});
