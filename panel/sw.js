// Roy Panel hizmet çalışanı (elle yazıldı, paketsiz). Kapsam: /panel/ — site sayfaları etkilenmez.
//
// Stratejiler
//  - Gezinme (HTML): önce ağ; ağ yoksa önbellekteki sayfa; o da yoksa /panel/ kabuğu; o da yoksa kısa çevrimdışı sayfası.
//  - /_next/static/ (içerik karmalı, değişmez), /fonts/, /panel/icons/: önce önbellek.
//  - Diğer /panel/ GET istekleri (sayfa veri dosyaları, manifest): önce ağ, olmazsa önbellek.
//  - Supabase alan adına giden her istek, her yazma isteği (POST/PATCH/PUT/DELETE…) ve yetkili (Authorization / apikey)
//    istekler ASLA ele alınmaz: tarayıcı doğrudan ağa gider, hiçbir şey önbelleğe yazılmaz ya da önbellekten dönmez.
//
// Sürüm: VERSION her derlemede `scripts/stamp-sw.mjs` (postbuild) ile panelin dayandığı dosyaların özetinden
// damgalanır; her dağıtımda sw.js bayt olarak değişir, önbellek adları değişir ve eski önbellekler `activate`'te
// topluca silinir (böylece /_next/static girdileri sürümler boyunca birikmez). Yeni sürüm kendini hemen
// etkinleştirir (skipWaiting + clients.claim); sayfa `controllerchange`i görüp "Yeni sürüm hazır — yenile" der.
const VERSION = "7237eb9aff3b";
const PAGES_CACHE = `roy-panel-pages-${VERSION}`;
const STATIC_CACHE = `roy-panel-static-${VERSION}`;
const CURRENT = [PAGES_CACHE, STATIC_CACHE];

// Aynı sürüm içinde de sınırsız büyümesin: statik önbellek bu sayıyı aşarsa en eskiler (ekleme sırasıyla) silinir
const MAX_STATIC_ENTRIES = 400;
const MAX_PAGE_ENTRIES = 100;
// Yavaş ağda (bağlantı "var" ama cevap yok) gezinme beklemesin: bu süreden sonra önbellekteki sayfa sunulur
const NAV_TIMEOUT_MS = 4000;

const SHELL = "/panel/";
const PRECACHE_PAGES = [
  "/panel/",
  "/panel/teklifler/",
  "/panel/teklifler/detay/",
  "/panel/projeler/",
  "/panel/projeler/detay/",
  "/panel/basvurular/",
  "/panel/basvurular/detay/",
  "/panel/ekip/",
  "/panel/giris/",
  "/panel/sifre/",
];
const PRECACHE_FILES = [
  "/panel/manifest.webmanifest",
  "/panel/icons/icon-192.png",
  "/panel/icons/icon-512.png",
  "/panel/icons/maskable-512.png",
  "/panel/icons/apple-touch-180.png",
  "/panel/icons/favicon.svg",
];

const OFFLINE_HTML =
  '<!doctype html><html lang="tr"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
  "<title>Çevrimdışı · Roy Panel</title>" +
  '<body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#0C0C0D;color:#F1EEE8;font:16px system-ui,sans-serif;text-align:center">' +
  "<div><h1 style=\"font-size:22px\">Çevrimdışısın</h1><p style=\"color:#A7A39B\">Bağlantı gelince sayfayı yenile.</p></div></body></html>";

/** Sorgu ve parçası atılmış anahtar: /panel/giris/?next=… ve /panel/teklifler/detay/?id=… aynı HTML'dir. */
const keyOf = (url) => {
  const u = new URL(url, self.location.origin);
  return u.origin + u.pathname;
};

const isSupabase = (url) => url.hostname === "supabase.co" || url.hostname.endsWith(".supabase.co") || url.hostname.endsWith(".supabase.in");

const STATIC_PREFIXES = ["/_next/static/", "/fonts/", "/panel/icons/"];

async function fetchOk(url) {
  // `reload`: HTTP önbelleğinden eski sürüm gelmesin
  const res = await fetch(new Request(url, { cache: "reload", credentials: "same-origin" }));
  if (res.status !== 200 || res.redirected) throw new Error(`${url} → ${res.status}`);
  return res;
}

/** Metindeki /_next/static/… ve /fonts/… adreslerini toplar (HTML ve CSS içinden). */
function assetUrls(text) {
  const found = new Set();
  const re = /\/(?:_next\/static|fonts)\/[A-Za-z0-9_.~%!@$&*+,;=:-]+(?:\/[A-Za-z0-9_.~%!@$&*+,;=:-]+)*/g;
  for (const m of text.matchAll(re)) found.add(m[0]);
  return found;
}

async function precache() {
  const pages = await caches.open(PAGES_CACHE);
  const statics = await caches.open(STATIC_CACHE);
  const assets = new Set();

  const addPage = async (path, required) => {
    try {
      const res = await fetchOk(path);
      const text = await res.clone().text();
      await pages.put(keyOf(path), res);
      for (const a of assetUrls(text)) assets.add(a);
    } catch (err) {
      if (required) throw err;
    }
  };
  // Kabuk (/panel/) olmadan kurulum anlamsız: başarısızsa kurulum düşer, tarayıcı sonra yeniden dener
  await addPage(SHELL, true);
  await Promise.all(PRECACHE_PAGES.filter((p) => p !== SHELL).map((p) => addPage(p, false)));
  await Promise.all(
    PRECACHE_FILES.map(async (f) => {
      try {
        await (f.endsWith(".webmanifest") ? pages : statics).put(keyOf(f), await fetchOk(f));
      } catch {
        /* ikon eksikse kurulum bozulmasın */
      }
    }),
  );

  // Sayfaların istediği betik/stil/yazı tipi dosyaları; CSS içindeki url(...) adresleri de
  const addAsset = async (a) => {
    const key = keyOf(a);
    if (await statics.match(key)) return;
    try {
      const res = await fetchOk(a);
      if (a.endsWith(".css")) {
        const css = await res.clone().text();
        for (const inner of assetUrls(css)) if (!assets.has(inner)) await addAsset(inner);
      }
      await statics.put(key, res);
    } catch {
      /* tek varlık eksikse kurulum düşmesin; çalışma anında önbelleğe girer */
    }
  };
  await Promise.all([...assets].map(addAsset));
}

self.addEventListener("install", (event) => {
  event.waitUntil(precache().then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const name of await caches.keys()) {
        if (name.startsWith("roy-panel-") && !CURRENT.includes(name)) await caches.delete(name);
      }
      await self.clients.claim();
    })(),
  );
});

/** Önbelleğe yazılabilir yanıt: yalnız 200, aynı kaynak, yönlendirilmemiş (206/404/hata/opaque yazılmaz). */
const cacheable = (res) => res.status === 200 && res.type === "basic" && !res.redirected;

/** En eski girdileri sil (Cache.keys ekleme sırasıyla döner). */
async function trim(cache, max) {
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - max; i++) await cache.delete(keys[i]);
}

/**
 * Yanıtı sayfaya DÖNDÜKTEN bağımsız olarak, arka planda (event.waitUntil) önbelleğe yazar. Yazma hatası
 * (kota dolu, vb.) asla yanıtı ya da respondWith'i etkilemez. `res` yazma için KLONLANMIŞ olmalı.
 */
function putLater(event, cacheName, key, res, max) {
  event.waitUntil(
    (async () => {
      try {
        const cache = await caches.open(cacheName);
        await cache.put(key, res);
        await trim(cache, max);
      } catch {
        /* önbellek yazılamadı: yok say */
      }
    })(),
  );
}

async function networkFirst(event, { html }) {
  const request = event.request;
  const key = keyOf(request.url);
  const net = fetch(request);
  // Klon, gövde sayfaya verilmeden ÖNCE (kayıt sırasıyla ilk işleyici) alınır; yazma arka planda yapılır
  event.waitUntil(
    net.then(
      (res) => {
        if (cacheable(res)) putLater(event, PAGES_CACHE, key, res.clone(), MAX_PAGE_ENTRIES);
      },
      () => {},
    ),
  );
  const cache = () => caches.open(PAGES_CACHE);
  const offline = async () => {
    const hit = await (await cache()).match(key);
    if (hit) return hit;
    if (html) {
      const shell = await (await cache()).match(keyOf(SHELL));
      if (shell) return shell;
      return new Response(OFFLINE_HTML, { status: 503, headers: { "content-type": "text/html; charset=utf-8" } });
    }
    return Response.error();
  };

  if (!html) {
    try {
      return await net;
    } catch {
      return offline();
    }
  }
  // Gezinme: ağ NAV_TIMEOUT_MS içinde yanıt vermezse ve bu sayfa önbellekteyse önbellekten sun
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve(null), NAV_TIMEOUT_MS);
  });
  try {
    const res = await Promise.race([net, timeout]);
    if (res) return res;
    const hit = await (await cache()).match(key);
    if (hit) return hit;
    return await net; // önbellekte yok: beklemeye devam
  } catch {
    return offline();
  } finally {
    clearTimeout(timer);
  }
}

async function cacheFirst(event) {
  const request = event.request;
  const key = keyOf(request.url);
  try {
    const hit = await (await caches.open(STATIC_CACHE)).match(key);
    if (hit) return hit;
  } catch {
    /* önbellek okunamadı: ağa git */
  }
  const res = await fetch(request);
  if (cacheable(res)) putLater(event, STATIC_CACHE, key, res.clone(), MAX_STATIC_ENTRIES);
  return res;
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  // Yazma istekleri: hiç ele alınmaz (tarayıcı doğrudan ağa gider)
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  // Başka kaynak (Supabase dâhil), yetkili ve aralıklı istekler ele alınmaz
  if (isSupabase(url) || url.origin !== self.location.origin) return;
  if (request.headers.has("authorization") || request.headers.has("apikey") || request.headers.has("range")) return;
  // Hizmet çalışanının kendisi her zaman ağdan
  if (url.pathname === "/panel/sw.js") return;

  if (STATIC_PREFIXES.some((p) => url.pathname.startsWith(p))) {
    event.respondWith(cacheFirst(event));
    return;
  }
  if (!url.pathname.startsWith("/panel/")) return;
  event.respondWith(networkFirst(event, { html: request.mode === "navigate" }));
});
