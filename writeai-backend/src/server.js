require('dotenv').config();

const app = require('./app');
const config = require('./config');

const PORT = config.port;

app.listen(PORT, () => {
  console.log(`WriteAI API listening on port ${PORT}`);
});
