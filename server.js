const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const webpush = require('web-push');

const app = express();

app.use(cors({
  origin: 'https://notification.edgeone.app'
}));
app.use(bodyParser.json());

// Users
const users = {
  kanna: "pellam",
  pellam: "kanna",
  admin: "admin123"
};

// VAPID keys
const vapidKeys = {
  publicKey: "BD1_aWv6bt4ai9B_2OxDYVdn2axZC7_5s2cOXMMgt2XR5X8ZBbXvM-X6kKFinke4WkNh5FEejE51Ru5Mm6QfYGQ",
  privateKey: "b-10HxCuao3jiO8oRYxAta7d7vm-fkdaWTR42CZaD9U"
};

webpush.setVapidDetails(
  'mailto:you@example.com',
  vapidKeys.publicKey,
  vapidKeys.privateKey
);

let subscriptions = {};

// LOGIN route
app.post("/login", (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).send("Missing username or password");
  }

  if (!users[username]) {
    return res.status(401).send("User does not exist");
  }

  if (users[username] !== password) {
    return res.status(403).send("Incorrect password");
  }

  res.send({ success: true });
});

// SUBSCRIBE route
app.post('/subscribe', (req, res) => {
  const { user, subscription } = req.body;

  if (!user || !subscription) {
    return res.status(400).send("User or subscription missing");
  }

  subscriptions[user] = subscription;
  console.log("Subscribed:", user);
  res.status(201).json({ success: true });
});

// SEND notification route
app.post('/send', async (req, res) => {
  const { recipient, message, from } = req.body;

  if (!recipient || !message) {
    return res.status(400).send("Recipient or message missing");
  }

  const subscription = subscriptions[recipient];

  if (!subscription) {
    return res.status(404).send("Recipient not subscribed");
  }

  const payload = JSON.stringify({
    title: `Message from ${from}`,
    body: message
  });

  try {
    await webpush.sendNotification(subscription, payload);
    console.log("Notification sent to:", recipient);
    res.send("Notification sent");
  } catch (err) {
    console.error("Error sending notification:", err);
    res.status(500).send("Failed to send notification");
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server started on port ${PORT}`));
