const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const path = require('path');
const config = require('./config');

const authRoutes = require('./routes/auth');
const actionRoutes = require('./routes/action');
const billingRoutes = require('./routes/billing');
const userRoutes = require('./routes/user');
const adminRoutes = require('./routes/admin');

const app = express();

if (process.env.NODE_ENV === 'production') {
  app.set('trust proxy', 1);
}

app.use(helmet({
  contentSecurityPolicy: false
}));
app.use(morgan('dev'));

const allowedOrigins = [
  config.frontendUrl,
  config.extensionOrigin,
  `http://localhost:${config.port}`,
  `http://127.0.0.1:${config.port}`
].filter(Boolean);

function isAllowedOrigin(origin) {
  if (!origin) return true;
  const normalized = origin.replace(/\/$/, '');
  if (normalized.startsWith('chrome-extension://')) {
    return true;
  }
  if (allowedOrigins.some((o) => o && o.replace(/\/$/, '') === normalized)) {
    return true;
  }
  if (config.frontendUrl) {
    try {
      return new URL(origin).host === new URL(config.frontendUrl).host;
    } catch {
      return false;
    }
  }
  return false;
}

app.use(cors({
  origin: (origin, callback) => {
    if (isAllowedOrigin(origin)) {
      return callback(null, true);
    }
    callback(new Error('Not allowed by CORS'));
  },
  credentials: true
}));

app.use('/billing/webhook', express.raw({ type: 'application/json' }));
app.use(express.json());

app.use('/admin', express.static(path.join(__dirname, 'admin', 'public')));
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'admin', 'public', 'index.html'));
});

app.use('/auth', authRoutes);
app.use('/action', actionRoutes);
app.use('/billing', billingRoutes);
app.use('/user', userRoutes);
app.use('/admin/api', adminRoutes);

const webRoot = path.resolve(__dirname, 'web', 'public');

function sendWebPage(res, file, next) {
  res.sendFile(path.join(webRoot, file), (err) => {
    if (err) next(err);
  });
}

app.get('/login', (req, res, next) => {
  sendWebPage(res, 'login.html', next);
});

app.get(/^\/app(\/.*)?$/, (req, res, next) => {
  sendWebPage(res, 'app.html', next);
});

app.get('/', (req, res, next) => {
  sendWebPage(res, 'index.html', next);
});

app.use(express.static(webRoot));

app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.use((err, req, res, next) => {
  if (err.message === 'Not allowed by CORS') {
    return res.status(403).json({ error: 'cors_error', message: 'Origin not allowed' });
  }
  console.error(err);
  res.status(500).json({ error: 'internal_error', message: 'Something went wrong' });
});

module.exports = app;
