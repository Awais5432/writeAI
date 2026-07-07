const config = require('../config');

function getStripe() {
  if (!config.stripe.secretKey) {
    throw new Error('Stripe secret key not configured');
  }
  return require('stripe')(config.stripe.secretKey);
}

module.exports = { getStripe };
