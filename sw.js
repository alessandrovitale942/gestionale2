// Service worker di RepairPro: rete per prima (cosi gli aggiornamenti si vedono subito), copia salvata solo se sei offline.
var V = 'rp-v1', SHELL = ['./', 'index.html', 'jarvis.html', 'cloud.js', 'manifest.json', 'icon-192.png'];
self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(V).then(function (c) { return Promise.all(SHELL.map(function (u) { return c.add(u).catch(function () {}); })); }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (k) { return Promise.all(k.filter(function (x) { return x !== V; }).map(function (x) { return caches.delete(x); })); }).then(function () { return self.clients.claim(); }));
});
self.addEventListener('fetch', function (e) {
  var r = e.request, u = new URL(r.url);
  // niente cache per la pagina pubblica del cliente e per tutto cio che e esterno (Firebase, librerie)
  if (r.method !== 'GET' || u.origin !== location.origin || u.pathname.indexOf('stato.html') > -1 || u.pathname.indexOf('sw.js') > -1) return;
  e.respondWith(fetch(r.url, { cache: 'no-cache' }).then(function (res) {
    if (res && res.ok) { var cp = res.clone(); caches.open(V).then(function (c) { c.put(r.url, cp); }); }
    return res;
  }).catch(function () { return caches.match(r.url).then(function (m) { return m || caches.match('index.html'); }); }));
});
