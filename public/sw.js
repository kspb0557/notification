// sw.js

// Install + activate logs
self.addEventListener("install", event => {
  console.log("Service Worker installed");
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  console.log("Service Worker activated");
});

// Handle push events
self.addEventListener("push", event => {
  let data = {};
  try {
    data = event.data.json();
  } catch (e) {
    data = { title: "Hurry Up", body: "The Time's up" };
  }

  const options = {
    body: data.body,
    icon: "/8a041aff-fcfb-4a97-a819-e07363564079.jpg", // local icon in public/
    badge: "/heart.png" // optional badge, add a monochrome PNG in public/
  };

  event.waitUntil(
    self.registration.showNotification(data.title, options)
  );
});

// Optional: click handler
self.addEventListener("notificationclick", event => {
  event.notification.close();
  event.waitUntil(
    clients.openWindow("/") // open your site when notification is clicked
  );
});