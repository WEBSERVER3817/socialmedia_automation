require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const multer = require('multer');
const fs = require('fs');

const tokenManager = require('./tokenManager');
const uploader = require('./uploader');

const app = express();
const PORT = process.env.PORT || 3000;

// Enable CORS and JSON parsing
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Authentication & Session Protection Middleware
const requireAuth = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  let token = '';
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.substring(7);
  }
  
  if (token === 'omnipost_admin_session_token') {
    return next();
  }

  res.status(401).json({ success: false, error: 'Unauthorized access. Please log in.' });
};

// Page Route Controllers (Served before static middleware to ensure custom routing behavior)
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Health check endpoint for Render and uptime monitoring services
app.get('/health', (req, res) => {
  res.json({ status: 'ok', version: '1.0.0', service: 'OmniPost' });
});

app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.get('/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

app.get('/privacy', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'privacy.html'));
});

app.get('/terms', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'terms.html'));
});

// Authentication endpoints
app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;
  const expectedUser = process.env.ADMIN_USER || 'admin';
  const expectedPass = process.env.ADMIN_PASSWORD || 'admin';

  if (username === expectedUser && password === expectedPass) {
    res.json({
      success: true,
      token: 'omnipost_admin_session_token',
      message: 'Successfully authenticated!'
    });
  } else {
    res.status(401).json({
      success: false,
      error: 'Invalid administrator credentials. Try again.'
    });
  }
});

app.post('/api/auth/logout', (req, res) => {
  res.json({ success: true, message: 'Logged out successfully.' });
});

// Serve frontend static files
app.use(express.static(path.join(__dirname, 'public')));

// Configure Multer for handling file uploads (saved to temp directory in workspace)
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    cb(null, `video_${Date.now()}_${file.originalname}`);
  }
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 500 * 1024 * 1024 } // 500MB video file limit
});

// In-memory publishing task statuses
const tasks = {};

// ----------------------------------------------------
// CONFIG & SETTINGS API ENDPOINTS
// ----------------------------------------------------

app.get('/api/config', requireAuth, (req, res) => {
  const config = tokenManager.loadConfig();
  
  // Return configuration status without exposing raw Client Secrets
  const status = {
    settings: config.settings,
    google: {
      clientId: config.google.clientId ? '••••••••' : '',
      clientSecret: config.google.clientSecret ? '••••••••' : '',
      connected: !!config.google.tokens,
      channelName: config.google.tokens ? 'Connected YouTube Channel' : null
    },
    meta: {
      clientId: config.meta.clientId ? '••••••••' : '',
      clientSecret: config.meta.clientSecret ? '••••••••' : '',
      connected: !!config.meta.tokens,
      pageName: config.meta.tokens ? config.meta.tokens.page_name : null,
      hasInstagram: config.meta.tokens ? !!config.meta.tokens.instagram_business_id : false
    }
  };
  res.json(status);
});

app.post('/api/config/secrets', requireAuth, (req, res) => {
  try {
    const { googleClientId, googleClientSecret, metaClientId, metaClientSecret, demoMode } = req.body;
    const config = tokenManager.loadConfig();

    if (googleClientId !== undefined) config.google.clientId = googleClientId;
    if (googleClientSecret !== undefined) config.google.clientSecret = googleClientSecret;
    
    if (metaClientId !== undefined) config.meta.clientId = metaClientId;
    if (metaClientSecret !== undefined) config.meta.clientSecret = metaClientSecret;
    
    if (demoMode !== undefined) config.settings.demoMode = !!demoMode;

    tokenManager.saveConfig(config);
    res.json({ success: true, message: 'Configuration saved successfully!' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/auth/disconnect', requireAuth, (req, res) => {
  const { platform } = req.body;
  try {
    const config = tokenManager.loadConfig();
    if (platform === 'google') {
      config.google.tokens = null;
    } else if (platform === 'meta') {
      config.meta.tokens = null;
    }
    tokenManager.saveConfig(config);
    res.json({ success: true, message: `${platform === 'google' ? 'YouTube' : 'Meta'} account disconnected.` });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ----------------------------------------------------
// OAUTH FLOWS ENDPOINTS
// ----------------------------------------------------

// Google OAuth Links
app.get('/api/auth/google', (req, res) => {
  try {
    const url = tokenManager.getGoogleAuthUrl(req);
    res.redirect(url);
  } catch (err) {
    res.status(400).send(`<h1>Configuration Error</h1><p>${err.message}</p><p><a href="/">Back to Settings</a></p>`);
  }
});

app.get('/api/auth/google/callback', async (req, res) => {
  const { code } = req.query;
  try {
    await tokenManager.handleGoogleCallback(code, req);
    res.send(`
      <html>
        <body style="font-family: sans-serif; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; background: #0c0a0f; color: #fff;">
          <h1 style="color: #4ade80;">✓ YouTube Successfully Connected!</h1>
          <p>This tab will close automatically in a moment...</p>
          <script>
            setTimeout(() => { window.close(); }, 3000);
          </script>
        </body>
      </html>
    `);
  } catch (err) {
    res.status(500).send(`<h1>Authentication Failed</h1><p>${err.message}</p>`);
  }
});

// Meta OAuth Links
app.get('/api/auth/meta', (req, res) => {
  try {
    const url = tokenManager.getMetaAuthUrl(req);
    res.redirect(url);
  } catch (err) {
    res.status(400).send(`<h1>Configuration Error</h1><p>${err.message}</p><p><a href="/">Back to Settings</a></p>`);
  }
});

app.get('/api/auth/meta/callback', async (req, res) => {
  const { code } = req.query;
  try {
    await tokenManager.handleMetaCallback(code, req);
    res.send(`
      <html>
        <body style="font-family: sans-serif; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; background: #0c0a0f; color: #fff;">
          <h1 style="color: #4ade80;">✓ Facebook & Instagram Connected!</h1>
          <p>This tab will close automatically in a moment...</p>
          <script>
            setTimeout(() => { window.close(); }, 3000);
          </script>
        </body>
      </html>
    `);
  } catch (err) {
    res.status(500).send(`<h1>Authentication Failed</h1><p>${err.message}</p>`);
  }
});

// ----------------------------------------------------
// MULTI-POST PUBLISHING ENGINE
// ----------------------------------------------------

app.post('/api/publish', requireAuth, upload.single('video'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ success: false, error: 'Please upload a video file.' });
  }

  const { title, caption } = req.body;
  const platforms = JSON.parse(req.body.platforms || '[]'); // Expects: ['youtube', 'instagram', 'facebook']

  if (platforms.length === 0) {
    fs.unlinkSync(req.file.path); // clean up file
    return res.status(400).json({ success: false, error: 'Please select at least one publishing channel.' });
  }

  const taskId = `task_${Date.now()}`;
  tasks[taskId] = {
    id: taskId,
    videoName: req.file.originalname,
    title,
    caption,
    platforms: {},
    completed: false
  };

  // Initialize status tracker for each chosen platform
  platforms.forEach(p => {
    tasks[taskId].platforms[p] = { percent: 0, step: 'queued', message: 'Waiting in queue...' };
  });

  // Return immediately with 202 Accepted and Task ID
  res.status(202).json({ success: true, taskId, message: 'Publishing tasks started in background.' });

  // Process uploads concurrently in background
  const videoPath = req.file.path;
  
  (async () => {
    const uploadPromises = [];

    if (platforms.includes('youtube')) {
      uploadPromises.push(
        uploader.uploadToYouTubeShorts(
          videoPath, 
          title, 
          caption, 
          (step, percent, message) => {
            tasks[taskId].platforms.youtube = { step, percent, message };
          }
        ).then(id => {
          tasks[taskId].platforms.youtube = { step: 'done', percent: 100, message: 'YouTube Short published!', link: `https://youtube.com/shorts/${id}` };
        }).catch(err => {
          tasks[taskId].platforms.youtube = { step: 'error', percent: 0, message: `Failed: ${err.message}` };
        })
      );
    }

    if (platforms.includes('facebook')) {
      uploadPromises.push(
        uploader.uploadToFacebookReels(
          videoPath, 
          caption, 
          (step, percent, message) => {
            tasks[taskId].platforms.facebook = { step, percent, message };
          }
        ).then(id => {
          tasks[taskId].platforms.facebook = { step: 'done', percent: 100, message: 'Facebook Reel published!' };
        }).catch(err => {
          tasks[taskId].platforms.facebook = { step: 'error', percent: 0, message: `Failed: ${err.message}` };
        })
      );
    }

    if (platforms.includes('instagram')) {
      uploadPromises.push(
        uploader.uploadToInstagramReels(
          videoPath, 
          caption, 
          (step, percent, message) => {
            tasks[taskId].platforms.instagram = { step, percent, message };
          }
        ).then(id => {
          tasks[taskId].platforms.instagram = { step: 'done', percent: 100, message: 'Instagram Reel published!' };
        }).catch(err => {
          tasks[taskId].platforms.instagram = { step: 'error', percent: 0, message: `Failed: ${err.message}` };
        })
      );
    }

    // Wait for all publishing routines to resolve
    await Promise.all(uploadPromises);

    tasks[taskId].completed = true;

    // Append this upload to our historical log in config.json
    try {
      const config = tokenManager.loadConfig();
      if (!config.logs) config.logs = [];
      
      const logEntry = {
        taskId,
        date: new Date().toISOString(),
        videoName: req.file.originalname,
        title,
        caption,
        results: {}
      };
      
      Object.keys(tasks[taskId].platforms).forEach(p => {
        logEntry.results[p] = {
          success: tasks[taskId].platforms[p].step === 'done',
          message: tasks[taskId].platforms[p].message,
          link: tasks[taskId].platforms[p].link || null
        };
      });

      config.logs.unshift(logEntry);
      // Keep only last 50 entries
      if (config.logs.length > 50) config.logs.pop();
      tokenManager.saveConfig(config);
    } catch (err) {
      console.error('Failed to append log:', err);
    }

    // Clean up uploaded file
    try {
      if (fs.existsSync(videoPath)) {
        fs.unlinkSync(videoPath);
      }
    } catch (err) {
      console.error('Failed to clean up video file:', err);
    }
  })();
});

app.get('/api/publish/status/:taskId', requireAuth, (req, res) => {
  const { taskId } = req.params;
  const task = tasks[taskId];
  if (!task) {
    return res.status(404).json({ error: 'Publishing task not found.' });
  }
  res.json(task);
});

// Logs Endpoint
app.get('/api/logs', requireAuth, (req, res) => {
  const config = tokenManager.loadConfig();
  res.json(config.logs || []);
});

// Custom 404 handler — must be last route
app.use((req, res) => {
  res.status(404).sendFile(path.join(__dirname, 'public', '404.html'));
});

// ----------------------------------------------------
// PORT BINDING & SERVER LAUNCH
// ----------------------------------------------------
// Start server after initializing configuration
(async () => {
  try {
    await tokenManager.initSharedConfig();
  } catch (err) {
    console.error('Failed to initialize configuration:', err);
  }
  
  app.listen(PORT, () => {
    console.log(`==================================================`);
    console.log(` OmniPost Server successfully started!`);
    console.log(` Dashboard URL: http://localhost:${PORT}`);
    console.log(`==================================================`);
  });
})();
