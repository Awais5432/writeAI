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

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) {
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

const webRoot = path.join(__dirname, 'web', 'public');

app.get('/login', (req, res) => {
  res.sendFile(path.join(webRoot, 'login.html'));
});

app.get(/^\/app(\/.*)?$/, (req, res) => {
  res.sendFile(path.join(webRoot, 'app.html'));
});

app.get('/', (req, res) => {
  res.sendFile(path.join(webRoot, 'index.html'));
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
