/**
 * Caller ID Lookup - TESTBED
 *
 * Simple endpoint for Retell AI inbound webhooks
 * Looks up caller by phone number, returns customer info for dynamic variables
 */

const express = require('express');
const axios = require('axios');

const app = express();
app.use(express.json());

// TESTBED Meevo API Configuration
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

// Normalize phone to 10 digits
function normalizePhone(phone) {
  let clean = (phone || '').replace(/\D/g, '');
  if (clean.length === 11 && clean.startsWith('1')) {
    clean = clean.substring(1);
  }
  return clean;
}

app.post('/lookup', async (req, res) => {
  try {
    // Handle Retell AI inbound webhook format OR direct phone call
    const { event, call_inbound } = req.body;
    const phone = call_inbound?.from_number || req.body.phone;

    if (!phone) {
      if (event === 'call_inbound') {
        return res.json({
          call_inbound: {
            dynamic_variables: {
              existing_customer: 'false',
              first_name: '',
              last_name: '',
              client_id: '',
              email: ''
            }
          }
        });
      }
      return res.json({
        existing_customer: false,
        first_name: null,
        last_name: null,
        client_id: null,
        email: null,
        phone: null
      });
    }

    const cleanPhone = normalizePhone(phone);
    const authToken = await getToken();

    // Search Meevo clients
    const clientsRes = await axios.get(
      `${CONFIG.API_URL}/clients?TenantId=${CONFIG.TENANT_ID}&LocationId=${CONFIG.LOCATION_ID}`,
      { headers: { Authorization: `Bearer ${authToken}` }}
    );

    const clients = clientsRes.data.data || clientsRes.data;

    const client = clients.find(c => {
      const clientPhone = normalizePhone(c.primaryPhoneNumber);
      return clientPhone === cleanPhone;
    });

    if (!client) {
      // New customer
      if (event === 'call_inbound') {
        return res.json({
          call_inbound: {
            dynamic_variables: {
              existing_customer: 'false',
              first_name: '',
              last_name: '',
              client_id: '',
              email: '',
              phone: phone
            }
          }
        });
      }
      return res.json({
        existing_customer: false,
        first_name: null,
        last_name: null,
        client_id: null,
        email: null,
        phone: phone
      });
    }

    // Existing customer found
    console.log('Found existing customer:', client.firstName, client.lastName);

    if (event === 'call_inbound') {
      return res.json({
        call_inbound: {
          dynamic_variables: {
            existing_customer: 'true',
            first_name: client.firstName || '',
            last_name: client.lastName || '',
            client_id: client.clientId || '',
            email: client.emailAddress || '',
            phone: client.primaryPhoneNumber || phone
          }
        }
      });
    }

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
    const { event, call_inbound } = req.body;
    const phone = call_inbound?.from_number || req.body.phone;

    if (event === 'call_inbound') {
      return res.json({
        call_inbound: {
          dynamic_variables: {
            existing_customer: 'false',
            first_name: '',
            last_name: '',
            client_id: '',
            email: '',
            phone: phone || ''
          }
        }
      });
    }

    res.json({
      existing_customer: false,
      first_name: null,
      last_name: null,
      client_id: null,
      email: null,
      phone: phone || null,
      error: error.message
    });
  }
});

app.get('/health', (req, res) => res.json({ status: 'ok', environment: 'TESTBED' }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Caller ID lookup running on port ${PORT}`));
