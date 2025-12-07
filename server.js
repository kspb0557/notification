// server.js (final)
require('dotenv').config();
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

// ----- Trust proxy so express-rate-limit can trust X-Forwarded-For -----
app.set('trust proxy', 1); // trust first proxy (suitable for most PaaS/load-balancers)

// ----- CORS -----
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || 'https://notification.edgeone.app';
app.use(cors({
  origin: FRONTEND_ORIGIN,
  credentials: true,
}));

// ----- Body parser -----
app.use(bodyParser.json());

// ----- Environment / secrets -----
const JWT_SECRET = process.env.JWT_SECRET;
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;

if (!JWT_SECRET || !VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
  console.error('Missing environment variables: JWT_SECRET or VAPID keys. Exiting.');
  process.exit(1);
}

// ----- web-push setup -----
webpush.setVapidDetails(
  'mailto:you@example.com',
  VAPID_PUBLIC_KEY,
  VAPID_PRIVATE_KEY
);

// ----- Rate limiter for login -----
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,
  message: "Too many login attempts. Please try again later.",
});

// ----- Storage file paths -----
const USERS_FILE = path.resolve(__dirname, 'users.json');
const SUBSCRIPTIONS_FILE = path.resolve(__dirname, 'subscriptions.json');

// ----- Load or initialize users/subscriptions -----
let users = {};
let subscriptions = {};

function safeReadJSON(filePath, fallback) {
  try {
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, 'utf8');
      return JSON.parse(raw);
    }
  } catch (err) {
    console.warn(`Failed reading ${filePath}:`, err.message);
  }
  return fallback;
}

function safeWriteJSON(filePath, obj) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(obj, null, 2), 'utf8');
  } catch (err) {
    console.error(`Failed writing ${filePath}:`, err);
  }
}

users = safeReadJSON(USERS_FILE, {
  kanna: "pellam",
  pellam: "kanna",
  admin: "admin123",
  user1: "meow",
  user2: "meow",
  user3: "meow"
});
safeWriteJSON(USERS_FILE, users);

subscriptions = safeReadJSON(SUBSCRIPTIONS_FILE, {});
safeWriteJSON(SUBSCRIPTIONS_FILE, subscriptions);

// ----- Token blacklist for logout -----
const tokenBlacklist = new Set();

// ----- Helpers -----
function saveSubscriptions() {
  safeWriteJSON(SUBSCRIPTIONS_FILE, subscriptions);
}
function saveUsers() {
  safeWriteJSON(USERS_FILE, users);
}

// ----- Authentication middleware -----
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  if (!authHeader) return res.status(401).send("Missing authorization header");

  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') return res.status(401).send("Invalid authorization format");

  const token = parts[1];
  if (!token) return res.status(401).send("Missing token");

  if (tokenBlacklist.has(token)) return res.status(401).send("Token revoked, please login again");

  jwt.verify(token, JWT_SECRET, (err, payload) => {
    if (err) return res.status(403).send("Invalid token");
    req.user = payload; // { username: ... }
    req.token = token;
    next();
  });
}

// ----- Validation schemas -----
const loginSchema = Joi.object({
  username: Joi.string().alphanum().min(1).max(50).required(),
  password: Joi.string().min(1).max(200).required(),
});
const subscribeSchema = Joi.object({
  subscription: Joi.object().required()
});
const sendSchema = Joi.object({
  recipient: Joi.string().alphanum().min(1).max(50).required(),
  message: Joi.string().min(1).max(1000).required()
});

// ----- Routes -----

// health check
app.get('/health', (req, res) => res.json({ ok: true }));

// Login (rate limited)
app.post('/login', loginLimiter, (req, res) => {
  const { error, value } = loginSchema.validate(req.body);
  if (error) return res.status(400).send(error.details[0].message);

  const { username, password } = value;
  if (!users[username]) return res.status(401).send("User does not exist");
  if (users[username] !== password) return res.status(403).send("Incorrect password");

  const token = jwt.sign({ username }, JWT_SECRET, { expiresIn: '7d' });
  return res.json({ token });
});

// Logout -> blacklist token
app.post('/logout', authenticateToken, (req, res) => {
  tokenBlacklist.add(req.token);
  return res.json({ success: true, message: "Logged out" });
});

// Subscribe (authenticated)
app.post('/subscribe', authenticateToken, (req, res) => {
  const { error, value } = subscribeSchema.validate(req.body);
  if (error) return res.status(400).send(error.details[0].message);

  const user = req.user.username;
  const { subscription } = value;

  subscriptions[user] = subscription;
  saveSubscriptions();

  console.log(`Subscribed: ${user}`);
  return res.status(201).json({ success: true });
});

// Send notification (authenticated)
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
    return res.json({ success: true });
  } catch (err) {
    console.error("webpush error:", err);
    // If subscription is gone/inactive, remove it
    if (err.statusCode === 410 || err.statusCode === 404) {
      console.log(`Removing invalid subscription for ${recipient}`);
      delete subscriptions[recipient];
      saveSubscriptions();
    }
    return next(err);
  }
});

// Optionally serve frontend static files (if you want backend to host sw.js and icons)
// Put your frontend build into ./public/ and uncomment the lines below.
// Serving sw.js from same origin ensures service worker registers with correct MIME type.
const PUBLIC_DIR = path.resolve(__dirname, 'public');
if (fs.existsSync(PUBLIC_DIR)) {
  app.use(express.static(PUBLIC_DIR, {
    // ensure js files served with correct types
    setHeaders: (res, filePath) => {
      if (filePath.endsWith('.js')) res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    }
  }));
  console.log('Serving static files from /public');
} else {
  console.log('No public/ folder found — not serving static site.');
}

// ----- Centralized error handler -----
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err && err.stack ? err.stack : err);
  res.status(500).send('Internal Server Error');
});

// ----- Start server -----
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
