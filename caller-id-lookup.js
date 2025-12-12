const express = require('express');
const axios = require('axios');

const app = express();
app.use(express.json());

const CONFIG = {
  AUTH_URL: 'https://d18devmarketplace.meevodev.com/oauth2/token',
  API_URL: 'https://d18devpub.meevodev.com/publicapi/v1',
  CLIENT_ID: 'a7139b22-775f-4938-8ecb-54aa23a1948d',
  CLIENT_SECRET: 'b566556f-e65d-47dd-a27d-dd1060d9fe2d',
  TENANT_ID: '4',
  LOCATION_ID: '5'
};

let token = null;
let tokenExpiry = null;

async function getToken() {
  if (token && tokenExpiry && Date.now() < tokenExpiry - 300000) return token;

  const res = await axios.post(CONFIG.AUTH_URL, {
    client_id: CONFIG.CLIENT_ID,
    client_secret: CONFIG.CLIENT_SECRET
  });

  token = res.data.access_token;
  tokenExpiry = Date.now() + (res.data.expires_in * 1000);
  return token;
}

app.post('/lookup', async (req, res) => {
  try {
    const { phone } = req.body;

    if (!phone) {
      return res.json({
        existing_customer: false,
        first_name: null,
        last_name: null,
        client_id: null,
        email: null,
        phone: null
      });
    }

    const authToken = await getToken();

    // Look up client by phone
    const clientsRes = await axios.get(
      `${CONFIG.API_URL}/clients?TenantId=${CONFIG.TENANT_ID}&LocationId=${CONFIG.LOCATION_ID}`,
      { headers: { Authorization: `Bearer ${authToken}` }}
    );

    const clients = clientsRes.data.data || clientsRes.data;

    // Clean phone: remove non-digits, then strip leading 1 if 11 digits (US country code)
    let cleanPhone = phone.replace(/\D/g, '');
    if (cleanPhone.length === 11 && cleanPhone.startsWith('1')) {
      cleanPhone = cleanPhone.substring(1);
    }

    const client = clients.find(c => {
      let clientPhone = (c.primaryPhoneNumber || '').replace(/\D/g, '');
      if (clientPhone.length === 11 && clientPhone.startsWith('1')) {
        clientPhone = clientPhone.substring(1);
      }
      return clientPhone === cleanPhone;
    });

    if (!client) {
      // New customer - return null values
      return res.json({
        existing_customer: false,
        first_name: null,
        last_name: null,
        client_id: null,
        email: null,
        phone: phone
      });
    }

    // Existing customer - return their info for Retell dynamic variables
    console.log('Found existing customer:', client.firstName, client.lastName);

    res.json({
      existing_customer: true,
      first_name: client.firstName || null,
      last_name: client.lastName || null,
      client_id: client.clientId,
      email: client.emailAddress || null,
      phone: client.primaryPhoneNumber || phone
    });

  } catch (error) {
    console.error('Caller ID lookup error:', error.message);
    // On error, return as new customer to not block the call
    res.json({
      existing_customer: false,
      first_name: null,
      last_name: null,
      client_id: null,
      email: null,
      phone: req.body.phone || null,
      error: error.message
    });
  }
});

app.get('/health', (req, res) => res.json({ status: 'ok' }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Caller ID lookup server running on port ${PORT}`));
