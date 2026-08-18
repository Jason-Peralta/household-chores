/* Service worker for push notifications (Firebase Cloud Messaging). No caching here on purpose —
   the app always loads fresh from the network. */
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
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(clients.claim()));
