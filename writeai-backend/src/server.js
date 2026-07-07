require('dotenv').config();

const app = require('./app');
const config = require('./config');

const PORT = config.port;
const HOST = process.env.HOST || '0.0.0.0';

app.listen(PORT, HOST, () => {
  console.log(`WriteAI API listening on ${HOST}:${PORT}`);
});
