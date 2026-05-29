const fs = require('fs');
const axios = require('axios');
const { google } = require('googleapis');
const tokenManager = require('./tokenManager');

/**
 * Uploads a local file to tmpfiles.org to get a temporary public direct link.
 * Essential for Instagram Reels API because Meta requires a public URL to pull the video from.
 */
async function uploadToTemporaryStorage(filePath, onProgress) {
  if (onProgress) onProgress('uploading_temp', 10, 'Preparing temporary video cloud link for Instagram...');
  
  try {
    const FormData = require('form-data');
    const form = new FormData();
    form.append('file', fs.createReadStream(filePath));

    if (onProgress) onProgress('uploading_temp', 30, 'Uploading to temporary ingestion server...');

    const response = await axios.post('https://tmpfiles.org/api/v1/upload', form, {
      headers: {
        ...form.getHeaders()
      },
      maxContentLength: Infinity,
      maxBodyLength: Infinity
    });

    if (response.data && response.data.status === 'success') {
      const uploadUrl = response.data.data.url; // Format: https://tmpfiles.org/12345/filename
      // We convert this to a direct download link by inserting "/dl" after the domain
      const directUrl = uploadUrl.replace('https://tmpfiles.org/', 'https://tmpfiles.org/dl/');
      
      if (onProgress) onProgress('uploading_temp', 100, 'Temporary video cloud link ready!');
      return directUrl;
    } else {
      throw new Error('Ingestion server did not return success status.');
    }
  } catch (err) {
    console.error('Temporary storage upload failed:', err);
    throw new Error(`Failed to host video temporarily for Instagram: ${err.message}`);
  }
}

/**
 * PUBLISH TO INSTAGRAM REELS
 */
async function uploadToInstagramReels(filePath, caption, onProgress) {
  const config = tokenManager.loadConfig();
  if (config.settings.demoMode) {
    return await simulatePlatformUpload('Instagram Reels', onProgress);
  }

  const tokens = config.meta.tokens;
  if (!tokens || !tokens.instagram_business_id) {
    throw new Error('Instagram Business Account is not connected. Connect via Settings.');
  }

  const { instagram_business_id, page_access_token } = tokens;

  // 1. Upload video to temporary public host
  const publicVideoUrl = await uploadToTemporaryStorage(filePath, onProgress);

  // 2. Initialize Media Container in Instagram
  if (onProgress) onProgress('ig_initialize', 10, 'Initializing Instagram Reel container...');
  
  const createContainerUrl = `https://graph.facebook.com/v19.0/${instagram_business_id}/media`;
  const containerRes = await axios.post(createContainerUrl, null, {
    params: {
      media_type: 'REELS',
      video_url: publicVideoUrl,
      caption: caption,
      access_token: page_access_token
    }
  });

  const creationId = containerRes.data.id;
  if (!creationId) throw new Error('Failed to create Instagram video container.');

  // 3. Poll container status until FINISHED
  if (onProgress) onProgress('ig_processing', 20, 'Instagram is downloading and processing the video...');
  
  let isProcessed = false;
  let attempts = 0;
  const maxAttempts = 30; // 5 minutes max (10s intervals)
  
  while (!isProcessed && attempts < maxAttempts) {
    attempts++;
    await new Promise(resolve => setTimeout(resolve, 10000)); // wait 10 seconds

    if (onProgress) {
      const percentage = Math.min(20 + attempts * 2.5, 90);
      onProgress('ig_processing', percentage, `Processing Reel on Instagram server (Attempt ${attempts})...`);
    }

    const checkStatusUrl = `https://graph.facebook.com/v19.0/${creationId}`;
    const statusRes = await axios.get(checkStatusUrl, {
      params: {
        fields: 'status_code,failure_reason',
        access_token: page_access_token
      }
    });

    const status = statusRes.data.status_code;
    console.log(`Instagram container processing status: ${status}`);

    if (status === 'FINISHED') {
      isProcessed = true;
    } else if (status === 'ERROR') {
      const reason = statusRes.data.failure_reason || 'Unknown error';
      throw new Error(`Instagram video processing failed: ${reason}`);
    }
  }

  if (!isProcessed) {
    throw new Error('Instagram processing timed out. Try again with a smaller/shorter video.');
  }

  // 4. Publish the container
  if (onProgress) onProgress('ig_publish', 95, 'Publishing Instagram Reel live...');
  
  const publishUrl = `https://graph.facebook.com/v19.0/${instagram_business_id}/media_publish`;
  const publishRes = await axios.post(publishUrl, null, {
    params: {
      creation_id: creationId,
      access_token: page_access_token
    }
  });

  if (onProgress) onProgress('ig_done', 100, 'Instagram Reel successfully published!');
  return publishRes.data.id;
}

/**
 * PUBLISH TO FACEBOOK REELS
 */
async function uploadToFacebookReels(filePath, caption, onProgress) {
  const config = tokenManager.loadConfig();
  if (config.settings.demoMode) {
    return await simulatePlatformUpload('Facebook Reels', onProgress);
  }

  const tokens = config.meta.tokens;
  if (!tokens || !tokens.page_id || !tokens.page_access_token) {
    throw new Error('Facebook Page is not connected. Connect via Settings.');
  }

  const { page_id, page_access_token } = tokens;
  const fileStats = fs.statSync(filePath);
  const fileSize = fileStats.size;

  // 1. Initialize Upload Session
  if (onProgress) onProgress('fb_initialize', 10, 'Initializing Facebook Reels upload session...');
  
  const initUrl = `https://graph.facebook.com/v19.0/${page_id}/video_reels`;
  const initRes = await axios.post(initUrl, null, {
    params: {
      upload_phase: 'initialize',
      access_token: page_access_token
    }
  });

  const { video_id, upload_url } = initRes.data;
  if (!video_id || !upload_url) throw new Error('Failed to initialize Facebook upload session.');

  // 2. Upload Video Binary
  if (onProgress) onProgress('fb_upload', 30, 'Uploading video to Facebook servers...');
  
  const videoBuffer = fs.readFileSync(filePath);
  await axios.post(upload_url, videoBuffer, {
    headers: {
      'Authorization': `OAuth ${page_access_token}`,
      'offset': '0',
      'file_size': fileSize.toString(),
      'Content-Type': 'application/octet-stream'
    },
    maxContentLength: Infinity,
    maxBodyLength: Infinity,
    onUploadProgress: (progressEvent) => {
      if (onProgress && progressEvent.total) {
        const uploadPercent = Math.round((progressEvent.loaded * 100) / progressEvent.total);
        // Map 0-100% upload to 30-85% overall status
        const totalPercent = Math.round(30 + (uploadPercent * 0.55));
        onProgress('fb_upload', totalPercent, `Uploading video to Facebook (${uploadPercent}%)...`);
      }
    }
  });

  // 3. Publish Reel
  if (onProgress) onProgress('fb_publish', 90, 'Finalizing and publishing Facebook Reel...');
  
  const publishUrl = `https://graph.facebook.com/v19.0/${page_id}/video_reels`;
  const publishRes = await axios.post(publishUrl, null, {
    params: {
      upload_phase: 'finish',
      video_state: 'PUBLISHED',
      description: caption,
      video_id: video_id,
      access_token: page_access_token
    }
  });

  if (onProgress) onProgress('fb_done', 100, 'Facebook Reel successfully published!');
  return publishRes.data.success ? video_id : 'success';
}

/**
 * PUBLISH TO YOUTUBE SHORTS
 */
async function uploadToYouTubeShorts(filePath, title, description, onProgress) {
  const config = tokenManager.loadConfig();
  if (config.settings.demoMode) {
    return await simulatePlatformUpload('YouTube Shorts', onProgress);
  }

  // 1. Authorize Google Client (token manager auto-refreshes if expired)
  if (onProgress) onProgress('yt_auth', 10, 'Authorizing Google/YouTube Client...');
  const authClient = await tokenManager.getAuthenticatedGoogleClient();

  const youtube = google.youtube({
    version: 'v3',
    auth: authClient
  });

  // 2. Upload Video
  if (onProgress) onProgress('yt_upload', 25, 'Starting upload of YouTube Short...');

  // Ensure title is within 100 chars and hashtag is included
  let finalTitle = title || 'New Short';
  if (!finalTitle.toLowerCase().includes('#shorts')) {
    finalTitle = `${finalTitle.substring(0, 90)} #shorts`;
  }

  const fileStream = fs.createReadStream(filePath);
  const fileSize = fs.statSync(filePath).size;

  const res = await youtube.videos.insert({
    part: 'snippet,status',
    requestBody: {
      snippet: {
        title: finalTitle,
        description: description || 'Published via OmniPost',
        categoryId: '22', // People & Blogs
        tags: ['shorts', 'reels', 'omnipost']
      },
      status: {
        privacyStatus: 'public', // Default to public
        selfDeclaredMadeForKids: false
      }
    },
    media: {
      body: fileStream
    }
  }, {
    // Enable progress monitoring for uploads
    onUploadProgress: (progressEvent) => {
      if (onProgress && progressEvent.bytesRead) {
        const uploadPercent = Math.round((progressEvent.bytesRead * 100) / fileSize);
        // Map 0-100% upload to 25-90% overall status
        const totalPercent = Math.round(25 + (uploadPercent * 0.65));
        onProgress('yt_upload', totalPercent, `Uploading YouTube video file (${uploadPercent}%)...`);
      }
    }
  });

  if (onProgress) onProgress('yt_done', 100, 'YouTube Short successfully published!');
  return res.data.id;
}

/**
 * SIMULATOR FOR TESTING WITHOUT LIVE API KEYS
 */
async function simulatePlatformUpload(platformName, onProgress) {
  onProgress('sim_init', 10, `[SIMULATION] Initializing ${platformName} session...`);
  await new Promise(r => setTimeout(r, 2000));
  
  onProgress('sim_upload', 40, `[SIMULATION] Uploading video stream to ${platformName} (40%)...`);
  await new Promise(r => setTimeout(r, 2500));
  
  onProgress('sim_processing', 80, `[SIMULATION] Server is rendering Reels metadata for ${platformName} (80%)...`);
  await new Promise(r => setTimeout(r, 2000));
  
  onProgress('sim_publish', 95, `[SIMULATION] Finalizing live publication on ${platformName}...`);
  await new Promise(r => setTimeout(r, 1500));
  
  onProgress('sim_done', 100, `[SIMULATION] ${platformName} published successfully!`);
  return `sim_id_${Math.random().toString(36).substring(2, 10)}`;
}

module.exports = {
  uploadToInstagramReels,
  uploadToFacebookReels,
  uploadToYouTubeShorts
};
