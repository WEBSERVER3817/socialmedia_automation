// Intercept all API fetches to add Authorization headers and catch unauthorized states
(function() {
  const originalFetch = window.fetch;
  window.fetch = async function(...args) {
    let [resource, config] = args;
    
    if (typeof resource === 'string' && resource.startsWith('/api/')) {
      if (!config) config = {};
      if (!config.headers) config.headers = {};
      
      const token = localStorage.getItem('omnipost_session');
      if (token) {
        if (config.headers instanceof Headers) {
          config.headers.set('Authorization', `Bearer ${token}`);
        } else {
          config.headers['Authorization'] = `Bearer ${token}`;
        }
      }
    }
    
    try {
      const response = await originalFetch(resource, config);
      if (response.status === 401 && typeof resource === 'string' && resource.startsWith('/api/')) {
        console.warn('Session expired. Redirecting to login page...');
        localStorage.removeItem('omnipost_session');
        window.location.replace('/login');
      }
      return response;
    } catch (err) {
      throw err;
    }
  };
})();

// State variables
let activeVideoFile = null;
let currentConfig = null;
let statusInterval = null;
let accountPollInterval = null;

// DOM Elements
const navItems = document.querySelectorAll('.nav-item');
const tabPanes = document.querySelectorAll('.tab-pane');
const pageTitle = document.getElementById('pageTitle');
const pageSubtitle = document.getElementById('pageSubtitle');
const demoModeIndicator = document.getElementById('demoModeIndicator');

// Publish Tab Elements
const dropzone = document.getElementById('dropzone');
const videoInput = document.getElementById('videoInput');
const uploadPrompt = document.getElementById('uploadPrompt');
const previewWrapper = document.getElementById('previewWrapper');
const videoPreview = document.getElementById('videoPreview');
const videoNameLabel = document.getElementById('videoNameLabel');
const videoSizeLabel = document.getElementById('videoSizeLabel');
const btnRemoveVideo = document.getElementById('btnRemoveVideo');
const postTitle = document.getElementById('postTitle');
const postCaption = document.getElementById('postCaption');
const titleCharCount = document.getElementById('titleCharCount');
const captionCharCount = document.getElementById('captionCharCount');
const btnPublish = document.getElementById('btnPublish');

// Platform Selector Elements
const channelYt = document.getElementById('channel-yt');
const channelIg = document.getElementById('channel-ig');
const channelFb = document.getElementById('channel-fb');
const checkYt = document.getElementById('check-yt');
const checkIg = document.getElementById('check-ig');
const checkFb = document.getElementById('check-fb');
const statusYt = document.getElementById('status-label-yt');
const statusIg = document.getElementById('status-label-ig');
const statusFb = document.getElementById('status-label-fb');

// Connected Accounts Elements
const descYt = document.getElementById('account-desc-yt');
const descMeta = document.getElementById('account-desc-meta');
const btnConnectYt = document.getElementById('btnConnectYt');
const btnDisconnectYt = document.getElementById('btnDisconnectYt');
const btnConnectMeta = document.getElementById('btnConnectMeta');
const btnDisconnectMeta = document.getElementById('btnDisconnectMeta');

// Settings Elements
const settingsForm = document.getElementById('settingsForm');
const settingsDemoMode = document.getElementById('settingsDemoMode');
const googleClientId = document.getElementById('googleClientId');
const googleClientSecret = document.getElementById('googleClientSecret');
const metaClientId = document.getElementById('metaClientId');
const metaClientSecret = document.getElementById('metaClientSecret');

// Logs Elements
const logsTableBody = document.getElementById('logsTableBody');

// Progress Overlay Console Elements
const progressOverlay = document.getElementById('progressOverlay');
const progressVideoTitle = document.getElementById('progressVideoTitle');
const progressRows = document.getElementById('progressRows');
const btnCloseConsole = document.getElementById('btnCloseConsole');

// ----------------------------------------------------
// INITIALIZATION & TAB NAVIGATION
// ----------------------------------------------------

document.addEventListener('DOMContentLoaded', () => {
  setupNavigation();
  setupDragAndDrop();
  setupFormListeners();
  loadConfiguration();
  loadLogs();
  setupAuthListeners();

  // Periodically poll configuration when accounts tab is active
  // This automatically detects when the OAuth popups are closed/successful
  accountPollInterval = setInterval(() => {
    const activeNav = document.querySelector('.nav-item.active');
    if (activeNav) {
      const activeTab = activeNav.dataset.tab;
      if (activeTab === 'accounts' || activeTab === 'publish') {
        loadConfiguration(true); // silent load
      }
    }
  }, 4000);
});

function setupAuthListeners() {
  const btnSignOut = document.getElementById('btnSignOut');
  if (btnSignOut) {
    btnSignOut.addEventListener('click', async () => {
      if (confirm('Are you sure you want to sign out of the administrator session?')) {
        try {
          await fetch('/api/auth/logout', { method: 'POST' });
        } catch(e) {}
        localStorage.removeItem('omnipost_session');
        window.location.replace('/');
      }
    });
  }
}

function setupNavigation() {
  navItems.forEach(item => {
    item.addEventListener('click', () => {
      const targetTab = item.dataset.tab;
      if (!targetTab) return; // Skip items without tabs (like logout)

      // Toggle nav items active
      navItems.forEach(nav => nav.classList.remove('active'));
      item.classList.add('active');

      // Toggle tab panes active
      tabPanes.forEach(pane => pane.classList.remove('active'));
      document.getElementById(`tab-${targetTab}`).classList.add('active');

      // Update header headings
      updateHeader(targetTab);
    });
  });
}

function updateHeader(tab) {
  const titles = {
    publish: { title: 'Publish Desk', desc: 'Create and distribute video content to multiple networks simultaneously.' },
    accounts: { title: 'Connected Accounts', desc: 'Connect and authorize your YouTube and Meta profiles.' },
    logs: { title: 'Activity Logs', desc: 'Monitor the success and output links of your published videos.' },
    settings: { title: 'API Configuration', desc: 'Configure developer portal secrets and adjust system parameters.' }
  };

  const headerInfo = titles[tab];
  if (headerInfo) {
    pageTitle.textContent = headerInfo.title;
    pageSubtitle.textContent = headerInfo.desc;
  }
}

// ----------------------------------------------------
// DYNAMIC APP CONFIGURATION
// ----------------------------------------------------

async function loadConfiguration(silent = false) {
  try {
    const response = await fetch('/api/config');
    currentConfig = await response.json();
    
    updateAppView(silent);
  } catch (err) {
    console.error('Failed to load configuration status:', err);
  }
}

function updateAppView(silent = false) {
  const isDemo = currentConfig.settings.demoMode;
  
  // Update Demo Mode indicators
  if (isDemo) {
    demoModeIndicator.classList.remove('hidden');
  } else {
    demoModeIndicator.classList.add('hidden');
  }

  // Update Settings inputs
  if (!silent) {
    settingsDemoMode.checked = isDemo;
    googleClientId.value = currentConfig.google.clientId;
    googleClientSecret.value = currentConfig.google.clientSecret;
    metaClientId.value = currentConfig.meta.clientId;
    metaClientSecret.value = currentConfig.meta.clientSecret;
  }

  // Update redirect URIs dynamically based on the current origin
  const currentOrigin = window.location.origin;
  const ytUri = document.getElementById('ytRedirectUri');
  const metaUri = document.getElementById('metaRedirectUri');
  if (ytUri) ytUri.textContent = `${currentOrigin}/api/auth/google/callback`;
  if (metaUri) metaUri.textContent = `${currentOrigin}/api/auth/meta/callback`;

  // Update YouTube integration indicators
  const googleConnected = currentConfig.google.connected || isDemo;
  if (googleConnected) {
    channelYt.classList.remove('disabled');
    channelYt.classList.add('connected-channel');
    checkYt.disabled = false;
    statusYt.textContent = isDemo ? 'Mock Channel Connected' : 'Channel Ready';
    
    descYt.innerHTML = `<span style="color: var(--accent-success);">Connected</span> • ${isDemo ? 'Simulation Channel' : 'YouTube Channel Linked'}`;
    btnConnectYt.style.display = 'none';
    btnDisconnectYt.style.display = 'block';
  } else {
    channelYt.classList.add('disabled');
    channelYt.classList.remove('connected-channel');
    checkYt.disabled = true;
    checkYt.checked = false;
    statusYt.textContent = 'Not Linked';
    
    descYt.textContent = 'Channel not linked';
    btnConnectYt.style.display = 'block';
    btnDisconnectYt.style.display = 'none';
  }

  // Update Meta (Facebook & Instagram) integration indicators
  const metaConnected = currentConfig.meta.connected || isDemo;
  if (metaConnected) {
    descMeta.innerHTML = `<span style="color: var(--accent-success);">Connected</span> • Page: <strong>${isDemo ? 'Demo Page' : currentConfig.meta.pageName}</strong>`;
    btnConnectMeta.style.display = 'none';
    btnDisconnectMeta.style.display = 'block';

    // Facebook channel status
    channelFb.classList.remove('disabled');
    channelFb.classList.add('connected-channel');
    checkFb.disabled = false;
    statusFb.textContent = isDemo ? 'Simulation Page Ready' : 'Facebook Page Ready';

    // Instagram channel status (Only available if Page has connected IG business profile)
    if (isDemo || currentConfig.meta.hasInstagram) {
      channelIg.classList.remove('disabled');
      channelIg.classList.add('connected-channel');
      checkIg.disabled = false;
      statusIg.textContent = isDemo ? 'Simulation Account Ready' : 'Instagram Reels Ready';
      descMeta.innerHTML += ` (Linked to Instagram)`;
    } else {
      channelIg.classList.add('disabled');
      channelIg.classList.remove('connected-channel');
      checkIg.disabled = true;
      checkIg.checked = false;
      statusIg.textContent = 'Instagram profile not connected to Facebook Page';
    }
  } else {
    channelFb.classList.add('disabled');
    channelFb.classList.remove('connected-channel');
    channelIg.classList.add('disabled');
    channelIg.classList.remove('connected-channel');
    checkFb.disabled = true;
    checkFb.checked = false;
    checkIg.disabled = true;
    checkIg.checked = false;
    statusFb.textContent = 'Not Linked';
    statusIg.textContent = 'Not Linked';
    
    descMeta.textContent = 'Profiles not linked';
    btnConnectMeta.style.display = 'block';
    btnDisconnectMeta.style.display = 'none';
  }

  validatePublishRequirements();
}

// Disconnect helper triggers
btnDisconnectYt.addEventListener('click', () => disconnectPlatform('google'));
btnDisconnectMeta.addEventListener('click', () => disconnectPlatform('meta'));

async function disconnectPlatform(platform) {
  if (confirm(`Are you sure you want to disconnect your ${platform === 'google' ? 'YouTube' : 'Meta'} connection?`)) {
    try {
      const response = await fetch('/api/auth/disconnect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platform })
      });
      const result = await response.json();
      if (result.success) {
        loadConfiguration();
      }
    } catch (err) {
      alert('Error disconnecting connection: ' + err.message);
    }
  }
}

// ----------------------------------------------------
// DRAG & DROP FILE LOGIC
// ----------------------------------------------------

function setupDragAndDrop() {
  ['dragenter', 'dragover'].forEach(eventName => {
    dropzone.addEventListener(eventName, (e) => {
      e.preventDefault();
      dropzone.classList.add('dragover');
    }, false);
  });

  ['dragleave', 'drop'].forEach(eventName => {
    dropzone.addEventListener(eventName, (e) => {
      e.preventDefault();
      dropzone.classList.remove('dragover');
    }, false);
  });

  dropzone.addEventListener('drop', (e) => {
    const dt = e.dataTransfer;
    const files = dt.files;
    if (files.length > 0) {
      handleSelectedVideo(files[0]);
    }
  });

  videoInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
      handleSelectedVideo(e.target.files[0]);
    }
  });

  btnRemoveVideo.addEventListener('click', () => {
    activeVideoFile = null;
    videoPreview.src = '';
    previewWrapper.style.display = 'none';
    uploadPrompt.style.display = 'flex';
    videoInput.value = '';
    validatePublishRequirements();
  });
}

function handleSelectedVideo(file) {
  // Simple validation
  const validTypes = ['video/mp4', 'video/quicktime'];
  if (!validTypes.includes(file.type) && !file.name.endsWith('.mp4') && !file.name.endsWith('.mov')) {
    alert('Please select a valid MP4 or MOV video file.');
    return;
  }

  activeVideoFile = file;
  
  // Set Preview
  const fileUrl = URL.createObjectURL(file);
  videoPreview.src = fileUrl;
  
  videoNameLabel.textContent = file.name;
  videoSizeLabel.textContent = (file.size / (1024 * 1024)).toFixed(1) + ' MB';
  
  uploadPrompt.style.display = 'none';
  previewWrapper.style.display = 'flex';
  
  // Prefill title from filename if title is empty
  if (postTitle.value.trim() === '') {
    const baseName = file.name.substring(0, file.name.lastIndexOf('.')) || file.name;
    // Replace hyphens/underscores with spaces
    postTitle.value = baseName.replace(/[-_]/g, ' ').substring(0, 90);
    titleCharCount.textContent = postTitle.value.length;
  }

  validatePublishRequirements();
}

// ----------------------------------------------------
// METADATA COUNTERS & VALIDATION
// ----------------------------------------------------

function setupFormListeners() {
  postTitle.addEventListener('input', () => {
    titleCharCount.textContent = postTitle.value.length;
  });

  postCaption.addEventListener('input', () => {
    captionCharCount.textContent = postCaption.value.length;
  });

  // Switch triggers
  [checkYt, checkIg, checkFb].forEach(ch => {
    ch.addEventListener('change', () => {
      const toggleItem = ch.closest('.channel-toggle-item');
      if (ch.checked) {
        toggleItem.classList.add('active-channel');
      } else {
        toggleItem.classList.remove('active-channel');
      }
      validatePublishRequirements();
    });
  });

  // Settings Save
  settingsForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const body = {
      demoMode: settingsDemoMode.checked,
      googleClientId: googleClientId.value.trim(),
      googleClientSecret: googleClientSecret.value.trim(),
      metaClientId: metaClientId.value.trim(),
      metaClientSecret: metaClientSecret.value.trim()
    };

    try {
      const response = await fetch('/api/config/secrets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const result = await response.json();
      if (result.success) {
        alert('API Credentials updated successfully!');
        loadConfiguration();
      } else {
        alert('Failed to save settings: ' + result.error);
      }
    } catch (err) {
      alert('Network error saving settings: ' + err.message);
    }
  });
}

function validatePublishRequirements() {
  const isVideoSelected = activeVideoFile !== null;
  const isAnyPlatformChecked = checkYt.checked || checkIg.checked || checkFb.checked;
  
  btnPublish.disabled = !(isVideoSelected && isAnyPlatformChecked);
  
  if (btnPublish.disabled) {
    btnPublish.classList.remove('btn-ready');
  } else {
    btnPublish.classList.add('btn-ready');
  }
}

// ----------------------------------------------------
// MULTI-CHANNEL CONCURRENT PUBLISHING
// ----------------------------------------------------

btnPublish.addEventListener('click', async () => {
  if (!activeVideoFile) return;

  const platforms = [];
  if (checkYt.checked) platforms.push('youtube');
  if (checkIg.checked) platforms.push('instagram');
  if (checkFb.checked) platforms.push('facebook');

  const formData = new FormData();
  formData.append('video', activeVideoFile);
  formData.append('title', postTitle.value.trim());
  formData.append('caption', postCaption.value.trim());
  formData.append('platforms', JSON.stringify(platforms));

  // Initialize Progress Console overlay
  progressVideoTitle.textContent = `Distributing "${activeVideoFile.name}"...`;
  progressRows.innerHTML = '';
  btnCloseConsole.disabled = true;
  progressOverlay.style.display = 'flex';

  // Inject active platform elements into Console overlay
  const brandIcons = { youtube: '🎥', instagram: '📸', facebook: '👥' };
  const brandNames = { youtube: 'YouTube Shorts', instagram: 'Instagram Reels', facebook: 'Facebook Reels' };
  
  platforms.forEach(p => {
    progressRows.innerHTML += `
      <div class="platform-progress-item" id="progress-card-${p}">
        <div class="progress-item-header">
          <span class="progress-platform-title">${brandIcons[p]} ${brandNames[p]}</span>
          <span class="progress-platform-percent" id="percent-label-${p}">0%</span>
        </div>
        <div class="progress-bar-bg">
          <div class="progress-bar-fill" id="bar-fill-${p}"></div>
        </div>
        <div class="progress-status-msg" id="status-msg-${p}">Waiting in queue...</div>
      </div>
    `;
  });

  try {
    const response = await fetch('/api/publish', {
      method: 'POST',
      body: formData
    });

    const result = await response.json();
    if (result.success && result.taskId) {
      // Begin background polling
      startPollingProgress(result.taskId);
    } else {
      progressOverlay.style.display = 'none';
      alert('Failed to initiate publish task: ' + (result.error || 'Unknown error'));
    }
  } catch (err) {
    progressOverlay.style.display = 'none';
    alert('Failed to upload video to local server: ' + err.message);
  }
});

function startPollingProgress(taskId) {
  if (statusInterval) clearInterval(statusInterval);

  statusInterval = setInterval(async () => {
    try {
      const response = await fetch(`/api/publish/status/${taskId}`);
      if (response.status === 404) {
        clearInterval(statusInterval);
        return;
      }
      
      const task = await response.json();
      updateProgressConsole(task);

      if (task.completed) {
        clearInterval(statusInterval);
        btnCloseConsole.disabled = false;
        loadLogs(); // reload history table
      }
    } catch (err) {
      console.error('Error polling status:', err);
    }
  }, 1200);
}

function updateProgressConsole(task) {
  Object.keys(task.platforms).forEach(p => {
    const data = task.platforms[p];
    const fill = document.getElementById(`bar-fill-${p}`);
    const label = document.getElementById(`percent-label-${p}`);
    const msg = document.getElementById(`status-msg-${p}`);
    const card = document.getElementById(`progress-card-${p}`);

    if (fill && label && msg && card) {
      fill.style.width = `${data.percent}%`;
      label.textContent = `${data.percent}%`;
      msg.textContent = data.message;

      if (data.step === 'done') {
        card.className = 'platform-progress-item progress-item-success';
        if (data.link) {
          msg.innerHTML = `${data.message} <a href="${data.link}" target="_blank" style="color: var(--accent-cyan); text-decoration: underline;">Watch Video</a>`;
        }
      } else if (data.step === 'error') {
        card.className = 'platform-progress-item progress-item-error';
      }
    }
  });
}

btnCloseConsole.addEventListener('click', () => {
  progressOverlay.style.display = 'none';
  
  // Clear file uploads and reset inputs
  activeVideoFile = null;
  videoPreview.src = '';
  previewWrapper.style.display = 'none';
  uploadPrompt.style.display = 'flex';
  videoInput.value = '';
  postTitle.value = '';
  postCaption.value = '';
  titleCharCount.textContent = '0';
  captionCharCount.textContent = '0';
  
  [checkYt, checkIg, checkFb].forEach(ch => {
    ch.checked = false;
    ch.closest('.channel-toggle-item').classList.remove('active-channel');
  });

  validatePublishRequirements();
});

// ----------------------------------------------------
// PUBLISH HISTORY LOGS
// ----------------------------------------------------

async function loadLogs() {
  try {
    const response = await fetch('/api/logs');
    const logs = await response.json();
    renderLogs(logs);
  } catch (err) {
    console.error('Failed to load publish history:', err);
  }
}

function renderLogs(logs) {
  if (logs.length === 0) {
    logsTableBody.innerHTML = `
      <tr>
        <td colspan="4" class="no-logs">No videos published yet.</td>
      </tr>
    `;
    return;
  }

  logsTableBody.innerHTML = '';
  
  logs.forEach(log => {
    const logDate = new Date(log.date).toLocaleString(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short'
    });

    // Generate brand output status badges
    let badgesHtml = '<div class="log-badges-list">';
    const brandBadges = { youtube: 'YouTube', instagram: 'Instagram', facebook: 'Facebook' };
    
    Object.keys(log.results).forEach(p => {
      const res = log.results[p];
      if (res.success) {
        if (res.link) {
          badgesHtml += `<a href="${res.link}" target="_blank" class="log-badge success" title="${res.message}">✓ ${brandBadges[p]}</a>`;
        } else {
          badgesHtml += `<span class="log-badge success" title="${res.message}">✓ ${brandBadges[p]}</span>`;
        }
      } else {
        badgesHtml += `<span class="log-badge failed" title="${res.message}">✗ ${brandBadges[p]}</span>`;
      }
    });
    badgesHtml += '</div>';

    logsTableBody.innerHTML += `
      <tr>
        <td style="white-space: nowrap; font-size: 0.85rem;">${logDate}</td>
        <td>
          <span class="log-video-name">${escapeHtml(log.videoName)}</span>
        </td>
        <td>
          <div class="log-meta-title">${escapeHtml(log.title || 'No Title')}</div>
          <div class="log-meta-desc">${escapeHtml(log.caption || 'No Caption')}</div>
        </td>
        <td>${badgesHtml}</td>
      </tr>
    `;
  });
}

function escapeHtml(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
