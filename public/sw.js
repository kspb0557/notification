self.addEventListener("push", function (event) {
  let data = {};
  try {
    data = event.data.json();
  } catch (e) {
    data = { title: "Hurry Up", body: "The Time's up" };
  }

  const options = {
  body: data.body,
  icon: "/8a041aff-fcfb-4a97-a819-e07363564079.png",
  badge: "https://static.vecteezy.com/system/resources/previews/000/623/220/original/love-heart-logo-and-symbol-vector.jpg"
};


  event.waitUntil(
    self.registration.showNotification(data.title, options)
  );
});
