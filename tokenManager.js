const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');
const axios = require('axios');

const CONFIG_PATH = path.join(__dirname, 'config.json');

// Initialize default config if it doesn't exist
const DEFAULT_CONFIG = {
  google: {
    clientId: '',
    clientSecret: '',
    redirectUri: 'http://localhost:3000/api/auth/google/callback',
    tokens: null
  },
  meta: {
    clientId: '',
    clientSecret: '',
    redirectUri: 'http://localhost:3000/api/auth/meta/callback',
    tokens: null
  },
  settings: {
    demoMode: true
  }
};

// Global cached config to avoid repeated IO and DB calls
global.cachedConfig = null;

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

/**
 * HELPER: Fetch config from Supabase cloud database if variables are set
 */
async function loadConfigFromSupabase() {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return null;
  try {
    const url = `${SUPABASE_URL}/rest/v1/omnipost_config?id=eq.default`;
    const response = await axios.get(url, {
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
      }
    });
    if (response.data && response.data.length > 0) {
      return response.data[0].data;
    }
  } catch (err) {
    console.error('[Supabase Config] Failed to load config:', err.message);
  }
  return null;
}

/**
 * HELPER: Save/Upsert config to Supabase cloud database
 */
async function saveConfigToSupabase(config) {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return;
  try {
    const url = `${SUPABASE_URL}/rest/v1/omnipost_config`;
    await axios.post(url, {
      id: 'default',
      data: config
    }, {
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        'Prefer': 'resolution=merge-duplicates'
      }
    });
  } catch (err) {
    console.error('[Supabase Config] Failed to save config:', err.message);
  }
}

/**
 * HELPER: Load local file-based config
 */
function loadConfigFromFile() {
  try {
    if (!fs.existsSync(CONFIG_PATH)) {
      fs.writeFileSync(CONFIG_PATH, JSON.stringify(DEFAULT_CONFIG, null, 2), 'utf-8');
      return DEFAULT_CONFIG;
    }
    const data = fs.readFileSync(CONFIG_PATH, 'utf-8');
    const parsed = JSON.parse(data);
    return {
      google: { ...DEFAULT_CONFIG.google, ...parsed.google },
      meta: { ...DEFAULT_CONFIG.meta, ...parsed.meta },
      settings: { ...DEFAULT_CONFIG.settings, ...parsed.settings },
      logs: parsed.logs || []
    };
  } catch (err) {
    console.error('Error loading config from file, resetting to default:', err);
    return DEFAULT_CONFIG;
  }
}

/**
 * HELPER: Apply environment overrides for client credentials and demo mode
 */
function applyEnvOverrides(config) {
  if (process.env.GOOGLE_CLIENT_ID) config.google.clientId = process.env.GOOGLE_CLIENT_ID;
  if (process.env.GOOGLE_CLIENT_SECRET) config.google.clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (process.env.META_CLIENT_ID) config.meta.clientId = process.env.META_CLIENT_ID;
  if (process.env.META_CLIENT_SECRET) config.meta.clientSecret = process.env.META_CLIENT_SECRET;
  if (process.env.DEMO_MODE !== undefined) config.settings.demoMode = process.env.DEMO_MODE === 'true';
}

/**
 * INITIALIZATION: Invoked on server startup to download config from Supabase or load local
 */
async function initSharedConfig() {
  const supabaseConfig = await loadConfigFromSupabase();
  if (supabaseConfig) {
    global.cachedConfig = {
      google: { ...DEFAULT_CONFIG.google, ...supabaseConfig.google },
      meta: { ...DEFAULT_CONFIG.meta, ...supabaseConfig.meta },
      settings: { ...DEFAULT_CONFIG.settings, ...supabaseConfig.settings },
      logs: supabaseConfig.logs || []
    };
    console.log('[OmniPost] Successfully loaded persistent configuration from Supabase.');
  } else {
    global.cachedConfig = loadConfigFromFile();
    console.log('[OmniPost] Running with local file configuration (config.json).');
  }
  applyEnvOverrides(global.cachedConfig);
}

function loadConfig() {
  if (!global.cachedConfig) {
    global.cachedConfig = loadConfigFromFile();
    applyEnvOverrides(global.cachedConfig);
  }
  return global.cachedConfig;
}

async function saveConfig(config) {
  global.cachedConfig = config;
  
  // 1. Save locally
  try {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8');
  } catch (err) {
    console.error('Error saving config locally:', err);
  }

  // 2. Save remotely to Supabase if configured
  await saveConfigToSupabase(config);
}

/**
 * HELPER: Resolve base url dynamically from request headers or process.env
 */
function getBaseUrl(req, configPlatform) {
  if (process.env.APP_URL) {
    return process.env.APP_URL;
  }
  if (req) {
    const protocol = req.headers['x-forwarded-proto'] || req.protocol;
    const host = req.headers['x-forwarded-host'] || req.get('host');
    return `${protocol}://${host}`;
  }
  if (configPlatform && configPlatform.redirectUri) {
    try {
      return new URL(configPlatform.redirectUri).origin;
    } catch (e) {
      // ignore
    }
  }
  return 'http://localhost:3000';
}

/**
 * GOOGLE OAUTH HELPER FUNCTIONS
 */
function getGoogleOAuthClient(config, req) {
  const { clientId, clientSecret } = config.google;
  if (!clientId || !clientSecret) return null;
  
  const baseUrl = getBaseUrl(req, config.google);
  const redirectUri = `${baseUrl}/api/auth/google/callback`;
  
  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

function getGoogleAuthUrl(req) {
  const config = loadConfig();
  const oauth2Client = getGoogleOAuthClient(config, req);
  if (!oauth2Client) {
    throw new Error('Please configure Google Client ID and Client Secret in Settings first.');
  }
  
  return oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: [
      'https://www.googleapis.com/auth/youtube.upload',
      'https://www.googleapis.com/auth/youtube.readonly'
    ]
  });
}

async function handleGoogleCallback(code, req) {
  const config = loadConfig();
  const oauth2Client = getGoogleOAuthClient(config, req);
  if (!oauth2Client) throw new Error('Google client is not configured.');
  
  const { tokens } = await oauth2Client.getToken(code);
  config.google.tokens = tokens;
  await saveConfig(config);
  return tokens;
}

async function getAuthenticatedGoogleClient() {
  const config = loadConfig();
  const oauth2Client = getGoogleOAuthClient(config, null);
  if (!oauth2Client) throw new Error('Google credentials not configured.');
  if (!config.google.tokens) throw new Error('YouTube account is not connected.');

  oauth2Client.setCredentials(config.google.tokens);

  // Check if token needs refresh
  const isExpired = config.google.tokens.expiry_date ? Date.now() >= config.google.tokens.expiry_date - 60000 : true;
  if (isExpired && config.google.tokens.refresh_token) {
    console.log('Refreshing Google OAuth Token...');
    try {
      const { credentials } = await oauth2Client.refreshAccessToken();
      // Ensure we keep the refresh token if the server didn't send a new one
      config.google.tokens = {
        ...config.google.tokens,
        ...credentials
      };
      await saveConfig(config);
      oauth2Client.setCredentials(config.google.tokens);
    } catch (err) {
      console.error('Failed to refresh Google Token:', err);
      throw new Error('Google authentication expired. Please reconnect your channel.');
    }
  }

  return oauth2Client;
}

/**
 * META (FACEBOOK/INSTAGRAM) HELPER FUNCTIONS
 */
function getMetaAuthUrl(req) {
  const config = loadConfig();
  const { clientId } = config.meta;
  if (!clientId) {
    throw new Error('Please configure Meta Client ID in Settings first.');
  }

  const baseUrl = getBaseUrl(req, config.meta);
  const redirectUri = `${baseUrl}/api/auth/meta/callback`;

  // Scopes needed for posting Reels to Instagram & Pages
  const scopes = [
    'public_profile',
    'pages_show_list',
    'pages_read_engagement',
    'pages_manage_posts',
    'instagram_basic',
    'instagram_content_publish'
  ].join(',');

  return `https://www.facebook.com/v19.0/dialog/oauth?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${scopes}&response_type=code`;
}

async function handleMetaCallback(code, req) {
  const config = loadConfig();
  const { clientId, clientSecret } = config.meta;
  if (!clientId || !clientSecret) throw new Error('Meta App Credentials not configured.');

  const baseUrl = getBaseUrl(req, config.meta);
  const redirectUri = `${baseUrl}/api/auth/meta/callback`;

  // 1. Exchange short-lived auth code for User Access Token
  const tokenExchangeUrl = `https://graph.facebook.com/v19.0/oauth/access_token?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&client_secret=${clientSecret}&code=${code}`;
  
  const tokenRes = await axios.get(tokenExchangeUrl);
  const shortLivedToken = tokenRes.data.access_token;

  // 2. Exchange short-lived token for Long-Lived User Access Token (~60 days)
  const longLivedTokenUrl = `https://graph.facebook.com/v19.0/oauth/access_token?grant_type=fb_exchange_token&client_id=${clientId}&client_secret=${clientSecret}&fb_exchange_token=${shortLivedToken}`;
  const longLivedRes = await axios.get(longLivedTokenUrl);
  const userAccessToken = longLivedRes.data.access_token;
  const expiry = Date.now() + (longLivedRes.data.expires_in ? longLivedRes.data.expires_in * 1000 : 5184000 * 1000); // default 60 days

  // 3. Retrieve Page list & Linked Instagram accounts
  const pagesUrl = `https://graph.facebook.com/v19.0/me/accounts?fields=name,access_token,id,instagram_business_account&access_token=${userAccessToken}`;
  const pagesRes = await axios.get(pagesUrl);
  
  const pages = pagesRes.data.data;
  if (!pages || pages.length === 0) {
    throw new Error('No Facebook Pages found linked to this profile. Please create a page first.');
  }

  let targetPage = pages.find(p => p.instagram_business_account) || pages[0];

  config.meta.tokens = {
    user_access_token: userAccessToken,
    page_access_token: targetPage.access_token,
    page_id: targetPage.id,
    page_name: targetPage.name,
    instagram_business_id: targetPage.instagram_business_account ? targetPage.instagram_business_account.id : null,
    expiry_date: expiry
  };

  await saveConfig(config);
  return config.meta.tokens;
}

module.exports = {
  loadConfig,
  saveConfig,
  initSharedConfig,
  getGoogleAuthUrl,
  handleGoogleCallback,
  getAuthenticatedGoogleClient,
  getMetaAuthUrl,
  handleMetaCallback
};
