/* Service worker: push notifications (Firebase Cloud Messaging) + a tiny offline fallback so the app is installable.
   The app itself is never cached — every launch loads the latest version from the network. */
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js');
firebase.initializeApp({
  apiKey: "AIzaSyDmSWISIlqtW7z_GEaAQwDoga7eCUyeYF4",
  authDomain: "household-chores-73e50.firebaseapp.com",
  databaseURL: "https://household-chores-73e50-default-rtdb.firebaseio.com",
  projectId: "household-chores-73e50",
  storageBucket: "household-chores-73e50.firebasestorage.app",
  messagingSenderId: "765182965334",
  appId: "1:765182965334:web:e8e56eeacb2083f220edf7"
});
const messaging = firebase.messaging();
messaging.onBackgroundMessage(payload => {
  const d = (payload && payload.data) || {};
  const n = (payload && payload.notification) || {};
  const title = d.title || n.title || 'Household Chores';
  return self.registration.showNotification(title, {
    body: d.body || n.body || '', icon: 'icon-192.png', badge: 'icon-192.png',
    tag: d.tag || 'chores', renotify: false, data: { url: d.url || './' }
  });
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || './', self.registration.scope).href;
  e.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then(cs => {
    for (const c of cs) { if (c.url.startsWith(self.registration.scope) && 'focus' in c) { c.navigate && c.navigate(url); return c.focus(); } }
    return clients.openWindow(url);
  }));
});

// Offline fallback (only used when the network is unreachable)
const OFFLINE_CACHE = 'chores-offline-v1';
const OFFLINE_HTML = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Chores — offline</title>
<body style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;background:#f5f5f3;color:#141413;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;text-align:center;padding:24px">
<div><div style="font-size:40px">📡</div><h1 style="font-size:20px;margin:8px 0">You're offline</h1><p style="color:#55544f">The chore board needs a connection so everyone sees the same thing. Try again when you're back online.</p><button onclick="location.reload()" style="padding:10px 16px;border-radius:10px;border:0;background:#2a78d6;color:#fff;font-weight:600">Retry</button></div></body>`;
self.addEventListener('install', e => { e.waitUntil(caches.open(OFFLINE_CACHE).then(c => c.put('offline', new Response(OFFLINE_HTML, { headers: { 'Content-Type': 'text/html; charset=utf-8' } }))).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => e.waitUntil(clients.claim()));
self.addEventListener('fetch', e => {
  if (e.request.mode !== 'navigate') return; // everything else goes straight to the network, uncached
  e.respondWith(fetch(e.request).catch(() => caches.open(OFFLINE_CACHE).then(c => c.match('offline'))));
});
