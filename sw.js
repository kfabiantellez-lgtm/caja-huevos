// Lo que deja abrir la app en la tienda sin internet.
//
// Primero la red y, si no hay, la copia guardada. Asi, con datos o wifi el
// celular siempre trae los precios nuevos, y sin senal abre lo ultimo que vio.
// Las ventas no pasan por aqui: viven en el almacenamiento del telefono.
var CACHE = "caja-huevos";
var ARCHIVOS = ["./", "index.html", "logica.js", "catalogo.js", "manifest.json",
                "icono-192.png", "icono-512.png"];

self.addEventListener("install", function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(ARCHIVOS); }));
  self.skipWaiting();
});

self.addEventListener("activate", function (e) {
  e.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", function (e) {
  if (e.request.method !== "GET") return;
  e.respondWith(
    fetch(e.request).then(function (resp) {
      var copia = resp.clone();
      caches.open(CACHE).then(function (c) { c.put(e.request, copia); });
      return resp;
    }).catch(function () {
      return caches.match(e.request, { ignoreSearch: true });
    })
  );
});
