const express = require('express');
const axios = require('axios');

const app = express();

// CORS middleware for Retell AI
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

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

// Shared lookup handler for both /lookup and / routes
async function handleLookup(req, res) {
  try {
    const { event, call_inbound } = req.body;

    // Detect request type:
    // 1. Inbound webhook: has event='call_inbound' and call_inbound.from_number
    // 2. Mid-call function: has phone field directly (E.164 format like +1...)
    const isInboundWebhook = event === 'call_inbound';
    const phone = call_inbound?.from_number || req.body.phone;

    console.log(`[Caller ID Lookup] Request type: ${isInboundWebhook ? 'INBOUND_WEBHOOK' : 'MID_CALL_FUNCTION'}, Phone: ${phone || 'none'}`);

    if (!phone) {
      console.log('[Caller ID Lookup] No phone provided');
      if (isInboundWebhook) {
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
      // Mid-call function format - simple flat response
      return res.json({
        existing_customer: false,
        first_name: null,
        last_name: null,
        client_id: null,
        email: null,
        phone: null,
        message: 'No phone number provided'
      });
    }

    const authToken = await getToken();

    // Clean phone: remove non-digits, then strip leading 1 if 11 digits (US country code)
    let cleanPhone = phone.replace(/\D/g, '');
    if (cleanPhone.length === 11 && cleanPhone.startsWith('1')) {
      cleanPhone = cleanPhone.substring(1);
    }

    // Look up client by phone - PAGINATE through ALL pages
    let client = null;
    let pageNumber = 1;
    const maxPages = 100; // Safety limit

    while (!client && pageNumber <= maxPages) {
      const clientsRes = await axios.get(
        `${CONFIG.API_URL}/clients?TenantId=${CONFIG.TENANT_ID}&LocationId=${CONFIG.LOCATION_ID}&PageNumber=${pageNumber}`,
        { headers: { Authorization: `Bearer ${authToken}`, Accept: 'application/json' }}
      );

      const clients = clientsRes.data.data || clientsRes.data;

      if (!clients || clients.length === 0) {
        console.log(`[Caller ID Lookup] No more clients at page ${pageNumber}`);
        break;
      }

      console.log(`[Caller ID Lookup] Searching page ${pageNumber} (${clients.length} clients)`);

      client = clients.find(c => {
        let clientPhone = (c.primaryPhoneNumber || '').replace(/\D/g, '');
        if (clientPhone.length === 11 && clientPhone.startsWith('1')) {
          clientPhone = clientPhone.substring(1);
        }
        return clientPhone === cleanPhone;
      });

      pageNumber++;
    }

    if (!client) {
      console.log(`[Caller ID Lookup] No existing customer found for phone: ${phone}`);
      if (isInboundWebhook) {
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
      // Mid-call function format
      return res.json({
        existing_customer: false,
        first_name: null,
        last_name: null,
        client_id: null,
        email: null,
        phone: phone,
        message: 'New customer - no profile found'
      });
    }

    // Existing customer found
    console.log(`[Caller ID Lookup] Found existing customer: ${client.firstName} ${client.lastName} (ID: ${client.clientId})`);

    if (isInboundWebhook) {
      return res.json({
        call_inbound: {
          dynamic_variables: {
            existing_customer: 'true',
            first_name: client.firstName || '',
            last_name: client.lastName || '',
            client_id: String(client.clientId) || '',
            email: client.emailAddress || '',
            phone: client.primaryPhoneNumber || phone
          }
        }
      });
    }

    // Mid-call function format - simple flat response for Retell custom function
    res.json({
      existing_customer: true,
      first_name: client.firstName || null,
      last_name: client.lastName || null,
      client_id: client.clientId,
      email: client.emailAddress || null,
      phone: client.primaryPhoneNumber || phone,
      message: 'Existing customer found'
    });

  } catch (error) {
    console.error('[Caller ID Lookup] Error:', error.message);
    const { event, call_inbound } = req.body;
    const phone = call_inbound?.from_number || req.body.phone;
    const isInboundWebhook = event === 'call_inbound';

    if (isInboundWebhook) {
      return res.json({
        call_inbound: {
          dynamic_variables: {
            existing_customer: 'false',
            first_name: '',
            last_name: '',
            client_id: '',
            email: '',
            phone: phone || '',
            error: error.message
          }
        }
      });
    }

    // Mid-call function format
    res.json({
      existing_customer: false,
      first_name: null,
      last_name: null,
      client_id: null,
      email: null,
      phone: phone || null,
      error: error.message,
      message: 'Lookup failed - treating as new customer'
    });
  }
}

// Route handlers - both / and /lookup use the same handler
app.post('/lookup', handleLookup);
app.post('/', handleLookup);

app.get('/health', (req, res) => res.json({ status: 'ok' }));

// Catch-all for debugging unknown routes
app.use((req, res) => {
  console.log(`[Caller ID Lookup] 404 - Unknown route: ${req.method} ${req.path}`);
  res.status(404).json({
    error: 'Not found',
    path: req.path,
    method: req.method,
    hint: 'Use POST /lookup with { "phone": "+1..." }'
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Caller ID lookup server running on port ${PORT}`));
