require('dotenv').config(); // load env vars from .env
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const webpush = require('web-push');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const path = require('path');
const rateLimit = require('express-rate-limit');
const Joi = require('joi');

const app = express();
app.set('trust proxy',1)

// CORS config - match your frontend URL exactly
app.use(cors({
  origin: 'https://notification.edgeone.app',
  credentials: true,
}));

app.use(bodyParser.json());

// Load secrets from env vars (set in your environment or .env)
const JWT_SECRET = process.env.JWT_SECRET;
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;

if (!JWT_SECRET || !VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
  console.error('Missing critical environment variables! Exiting.');
  process.exit(1);
}

// Setup web-push with VAPID keys
webpush.setVapidDetails(
  'mailto:you@example.com',
  VAPID_PUBLIC_KEY,
  VAPID_PRIVATE_KEY
);

// Rate limiter for login endpoint to prevent brute force
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,
  message: "Too many login attempts. Please try again later.",
});

// File paths for user and subscription persistence
const USERS_FILE = path.resolve(__dirname, 'users.json');
const SUBSCRIPTIONS_FILE = path.resolve(__dirname, 'subscriptions.json');

// Load or initialize users and subscriptions
let users = {};
let subscriptions = {};
try {
  users = JSON.parse(fs.readFileSync(USERS_FILE));
} catch {
  users = {
    kanna: "pellam",
    pellam: "kanna",
    admin: "admin123",
    user1: "meow",
    user2: "meow",
    user3: "meow"
  };
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}
try {
  subscriptions = JSON.parse(fs.readFileSync(SUBSCRIPTIONS_FILE));
} catch {
  subscriptions = {};
  fs.writeFileSync(SUBSCRIPTIONS_FILE, JSON.stringify(subscriptions, null, 2));
}

// JWT token blacklist to handle logout token revocation
const tokenBlacklist = new Set();

// Helpers to save files
function saveSubscriptions() {
  fs.writeFileSync(SUBSCRIPTIONS_FILE, JSON.stringify(subscriptions, null, 2));
}
function saveUsers() {
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

// Middleware to authenticate JWT and check blacklist
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  if (!authHeader) return res.status(401).send("Missing authorization header");

  const token = authHeader.split(' ')[1];
  if (!token) return res.status(401).send("Missing token");

  if (tokenBlacklist.has(token)) return res.status(401).send("Token revoked, please login again");

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).send("Invalid token");
    req.user = user;
    req.token = token; // save token for logout blacklist
    next();
  });
}

// Input validation schemas using Joi
const loginSchema = Joi.object({
  username: Joi.string().alphanum().min(3).max(30).required(),
  password: Joi.string().min(3).max(100).required(),
});
const subscribeSchema = Joi.object({
  subscription: Joi.object().required()
});
const sendSchema = Joi.object({
  recipient: Joi.string().alphanum().min(3).max(30).required(),
  message: Joi.string().min(1).max(500).required()
});

// Routes

// Login with rate limiter
app.post('/login', loginLimiter, (req, res) => {
  const { error, value } = loginSchema.validate(req.body);
  if (error) return res.status(400).send(error.details[0].message);

  const { username, password } = value;

  if (!users[username]) return res.status(401).send("User does not exist");
  if (users[username] !== password) return res.status(403).send("Incorrect password");

  const token = jwt.sign({ username }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ token });
});

// Logout blacklists token so it can’t be used anymore
app.post('/logout', authenticateToken, (req, res) => {
  tokenBlacklist.add(req.token);
  res.json({ success: true, message: "Logged out successfully" });
});

// Subscribe push notifications for authenticated user
app.post('/subscribe', authenticateToken, (req, res) => {
  const { error, value } = subscribeSchema.validate(req.body);
  if (error) return res.status(400).send(error.details[0].message);

  const user = req.user.username;
  const { subscription } = value;

  subscriptions[user] = subscription;
  saveSubscriptions();

  console.log(`User ${user} subscribed for push notifications.`);
  res.status(201).json({ success: true });
});

// Send push notification to recipient
app.post('/send', authenticateToken, async (req, res, next) => {
  const { error, value } = sendSchema.validate(req.body);
  if (error) return res.status(400).send(error.details[0].message);

  const from = req.user.username;
  const { recipient, message } = value;

  if (!subscriptions[recipient]) {
    return res.status(404).send("Recipient not subscribed");
  }

  const payload = JSON.stringify({
    title: `Message from ${from}`,
    body: message
  });

  try {
    await webpush.sendNotification(subscriptions[recipient], payload);
    console.log(`Notification sent to ${recipient} from ${from}`);
    res.json({ success: true });
  } catch (err) {
    console.error("Failed to send notification:", err);
    next(err);
  }
});

// Central error handler
app.use((err, req, res, next) => {
  console.error("Unhandled error:", err);
  res.status(500).send("Internal Server Error");
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
