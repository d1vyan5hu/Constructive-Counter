/**
 * CRClicker - Main Process
 * 
 * Electron main process handling window management, IPC communications,
 * file system operations, and video downloads.
 */

const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');
const http = require('http');
const { URL } = require('url');
const os = require('os');

let mainWindow;
let appLogsPath;
let moviesTrafficClickerPath;
let documentsTrafficClickerPath;
let activeDownloads = new Map(); // Track active downloads by URL to prevent duplicates

/**
 * Initialize writable paths outside ASAR archive
 * Creates user data directory for logs and application data
 */
function initializePaths() {
  const userDataPath = app.getPath('userData'); // ~/Library/Application Support/CRClicker
  appLogsPath = path.join(userDataPath, 'app-logs.txt');

  // Create user data directory structure
  try {
    if (!fs.existsSync(userDataPath)) {
      fs.mkdirSync(userDataPath, { recursive: true });
    }
    log(`User data directory: ${userDataPath}`);
  } catch (error) {
    log(`Failed to create directories: ${error.message}`);
  }
}

/**
 * Ensure CRClicker folders exist in Movies and Documents
 * Requests permissions if folder creation fails
 * @returns {Promise<Object>} Object with paths and existence status
 */
async function ensureTrafficClickerFolders() {
  try {
    // Get paths - use home directory as fallback if specific paths fail
    let moviesPath;
    let documentsPath;
    
    try {
      moviesPath = app.getPath('movies');
    } catch (error) {
      log(`Could not get movies path, using home directory: ${error.message}`);
      moviesPath = path.join(app.getPath('home'), 'Movies');
    }
    
    try {
      documentsPath = app.getPath('documents');
    } catch (error) {
      log(`Could not get documents path, using home directory: ${error.message}`);
      documentsPath = path.join(app.getPath('home'), 'Documents');
    }
    
    moviesTrafficClickerPath = path.join(moviesPath, 'CRClicker');
    documentsTrafficClickerPath = path.join(documentsPath, 'CRClicker');
    
    // Try to create Movies/CRClicker
    try {
      if (!fs.existsSync(moviesTrafficClickerPath)) {
        fs.mkdirSync(moviesTrafficClickerPath, { recursive: true });
        log(`Created folder: ${moviesTrafficClickerPath}`);
      }
    } catch (error) {
      log(`Failed to create Movies/CRClicker: ${error.message}`);
      // Request permissions
      const result = await dialog.showMessageBox(mainWindow, {
        type: 'warning',
        title: 'Permission Required',
        message: 'CRClicker needs access to your Movies folder',
        detail: 'Please grant access to create the CRClicker folder in Movies.',
        buttons: ['Open System Preferences', 'Cancel']
      });
      if (result.response === 0) {
        shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles');
      }
    }
    
    // Try to create Documents/CRClicker
    try {
      if (!fs.existsSync(documentsTrafficClickerPath)) {
        fs.mkdirSync(documentsTrafficClickerPath, { recursive: true });
        log(`Created folder: ${documentsTrafficClickerPath}`);
      }
    } catch (error) {
      log(`Failed to create Documents/CRClicker: ${error.message}`);
      // Request permissions
      const result = await dialog.showMessageBox(mainWindow, {
        type: 'warning',
        title: 'Permission Required',
        message: 'CRClicker needs access to your Documents folder',
        detail: 'Please grant access to create the CRClicker folder in Documents.',
        buttons: ['Open System Preferences', 'Cancel']
      });
      if (result.response === 0) {
        shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles');
      }
    }
    
    return {
      moviesPath: moviesTrafficClickerPath,
      documentsPath: documentsTrafficClickerPath,
      moviesExists: fs.existsSync(moviesTrafficClickerPath),
      documentsExists: fs.existsSync(documentsTrafficClickerPath)
    };
  } catch (error) {
    log(`Error ensuring CRClicker folders: ${error.message}`);
    return {
      moviesPath: moviesTrafficClickerPath,
      documentsPath: documentsTrafficClickerPath,
      moviesExists: false,
      documentsExists: false,
      error: error.message
    };
  }
}

/**
 * Logging utility - writes to both file and console
 * @param {string} message - Log message to write
 */
function log(message) {
  try {
    if (!appLogsPath) {
      console.log(message);
      return;
    }
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] ${message}\n`;
    fs.appendFileSync(appLogsPath, logMessage);
    console.log(logMessage.trim());
  } catch (error) {
    console.error('Failed to write log:', error);
    console.log(message);
  }
}

/**
 * Create and configure the main application window
 * Opens DevTools in development mode only
 */
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  mainWindow.loadFile('index.html');

  // Open DevTools only in development (not in production builds)
  if (process.env.NODE_ENV === 'development' || !app.isPackaged) {
    mainWindow.webContents.openDevTools();
  }

  // Log renderer process errors
  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
    log(`Renderer failed to load: ${errorCode} - ${errorDescription}`);
  });

  mainWindow.webContents.on('console-message', (event, level, message, line, sourceId) => {
    log(`Renderer Console [${level}]: ${message} (${sourceId}:${line})`);
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  log('Application started');
}

// Initialize paths when app is ready
app.whenReady().then(async () => {
  initializePaths();
  
  createWindow();
  
  // Ensure CRClicker folders exist
  await ensureTrafficClickerFolders();
  
  // Check for command-line arguments (URL)
  const args = process.argv.slice(2);
  const urlIndex = args.indexOf('--url');
  if (urlIndex !== -1 && args[urlIndex + 1]) {
    const videoUrl = args[urlIndex + 1];
    // Wait for window to be ready, then send URL to renderer
    mainWindow.webContents.once('did-finish-load', () => {
      mainWindow.webContents.send('load-video-url-command', videoUrl);
    });
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

/**
 * IPC handler to receive logs from renderer process
 * Forwards renderer logs to main process log file
 */
ipcMain.on('renderer-log', (event, ...args) => {
  const logMessage = `[Renderer] ${args.join(' ')}`;
  log(logMessage);
});

/**
 * Error handlers for uncaught exceptions and unhandled rejections
 * Logs errors to file for debugging
 */
process.on('uncaughtException', (error) => {
  log(`Uncaught Exception: ${error.message}\n${error.stack}`);
  console.error('Uncaught Exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
  log(`Unhandled Rejection: ${reason}`);
  console.error('Unhandled Rejection:', reason);
});

// ============================================================================
// IPC HANDLERS - File Operations
// ============================================================================

/**
 * Open file dialog to select configuration JSON file
 * @returns {Promise<Object>} Config data and path, or error
 */
ipcMain.handle('select-config-file', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [
      { name: 'JSON Files', extensions: ['json'] },
      { name: 'All Files', extensions: ['*'] }
    ]
  });

  if (!result.canceled && result.filePaths.length > 0) {
    try {
      const configPath = result.filePaths[0];
      const configData = fs.readFileSync(configPath, 'utf8');
      const config = JSON.parse(configData);
      log(`Config file loaded: ${configPath}`);
      return { success: true, config, path: configPath };
    } catch (error) {
      log(`Error loading config: ${error.message}`);
      return { success: false, error: error.message };
    }
  }
  return { success: false };
});

/**
 * Open file dialog to select video file
 * @returns {Promise<Object>} Video file path or error
 */
ipcMain.handle('select-video-file', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [
      { name: 'Video Files', extensions: ['mp4', 'avi', 'mov', 'mkv', 'webm'] },
      { name: 'All Files', extensions: ['*'] }
    ]
  });

  if (!result.canceled && result.filePaths.length > 0) {
    log(`Video file selected: ${result.filePaths[0]}`);
    return { success: true, path: result.filePaths[0] };
  }
  return { success: false };
});

/**
 * Open file dialog to select CSV file for audit mode
 * @returns {Promise<Object>} CSV data and path, or error
 */
ipcMain.handle('select-csv-file', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [
      { name: 'CSV Files', extensions: ['csv'] },
      { name: 'All Files', extensions: ['*'] }
    ]
  });

  if (!result.canceled && result.filePaths.length > 0) {
    try {
      const csvPath = result.filePaths[0];
      const csvData = fs.readFileSync(csvPath, 'utf8');
      log(`CSV file loaded: ${csvPath}`);
      return { success: true, path: csvPath, data: csvData };
    } catch (error) {
      log(`Error loading CSV: ${error.message}`);
      return { success: false, error: error.message };
    }
  }
  return { success: false };
});

/**
 * Save session file to Documents/CRClicker/<Video Name> folder
 * Creates video-specific subfolder if videoName is provided
 * @param {Object} sessionData - Session state to save
 * @param {string} filename - Filename for session file
 * @param {string} videoName - Optional video name for subfolder
 * @returns {Promise<Object>} Success status and file path
 */
ipcMain.handle('save-session-file', async (event, sessionData, filename, videoName) => {
  try {
    await ensureTrafficClickerFolders();
    const basePath = documentsTrafficClickerPath || path.join(app.getPath('documents'), 'CRClicker');
    
    // Create video-specific folder if videoName is provided
    let targetPath = basePath;
    if (videoName) {
      const safeVideoName = videoName.replace(/[^a-zA-Z0-9_-]/g, '_');
      targetPath = path.join(basePath, safeVideoName);
      if (!fs.existsSync(targetPath)) {
        fs.mkdirSync(targetPath, { recursive: true });
      }
    }
    
    const sessionPath = path.join(targetPath, filename);
    
    // Ensure filename ends with .json
    const finalPath = sessionPath.endsWith('.json') ? sessionPath : sessionPath + '.json';
    
    fs.writeFileSync(finalPath, JSON.stringify(sessionData, null, 2), 'utf8');
    log(`Session saved: ${finalPath}`);
    return { success: true, path: finalPath };
  } catch (error) {
    log(`Error saving session: ${error.message}`);
    return { success: false, error: error.message };
  }
});

/**
 * Open file dialog to load session file
 * @returns {Promise<Object>} Session data and path, or error
 */
ipcMain.handle('load-session-file', async () => {
  try {
    log('Opening session file dialog...');
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile'],
      filters: [
        { name: 'Session Files', extensions: ['json'] },
        { name: 'All Files', extensions: ['*'] }
      ],
      title: 'Load Session File'
    });

    if (!result.canceled && result.filePaths.length > 0) {
      try {
        const sessionPath = result.filePaths[0];
        const sessionData = fs.readFileSync(sessionPath, 'utf8');
        const session = JSON.parse(sessionData);
        log(`Session loaded: ${sessionPath}`);
        return { success: true, session, path: sessionPath };
      } catch (error) {
        log(`Error loading session: ${error.message}`);
        return { success: false, error: error.message };
      }
    }
    return { success: false };
  } catch (error) {
    log(`Error opening file dialog: ${error.message}`);
    return { success: false, error: error.message };
  }
});

/**
 * Load configuration file from specified path
 * Used when loading session files that reference a config
 * @param {string} configPath - Path to config file
 * @returns {Promise<Object>} Config data and path, or error
 */
ipcMain.handle('load-config-from-path', async (event, configPath) => {
  try {
    if (fs.existsSync(configPath)) {
      const configData = fs.readFileSync(configPath, 'utf8');
      const config = JSON.parse(configData);
      log(`Config file loaded from path: ${configPath}`);
      return { success: true, config, path: configPath };
    }
    return { success: false, error: 'File not found' };
  } catch (error) {
    log(`Error loading config from path: ${error.message}`);
    return { success: false, error: error.message };
  }
});

/**
 * Check if a file exists at the given path
 * @param {string} filePath - Path to check
 * @returns {Promise<Object>} Existence status
 */
ipcMain.handle('check-file-exists', async (event, filePath) => {
  try {
    return { exists: fs.existsSync(filePath) };
  } catch (error) {
    return { exists: false, error: error.message };
  }
});

/**
 * Load CSV file from specified path
 * Used when loading session files that reference a CSV
 * @param {string} csvPath - Path to CSV file
 * @returns {Promise<Object>} CSV data and path, or error
 */
ipcMain.handle('load-csv-from-path', async (event, csvPath) => {
  try {
    if (fs.existsSync(csvPath)) {
      const csvData = fs.readFileSync(csvPath, 'utf8');
      log(`CSV file loaded from path: ${csvPath}`);
      return { success: true, path: csvPath, data: csvData };
    }
    return { success: false, error: 'File not found' };
  } catch (error) {
    log(`Error loading CSV from path: ${error.message}`);
    return { success: false, error: error.message };
  }
});

/**
 * Save CSV export to Documents/CRClicker/<Video Name> folder
 * Creates video-specific subfolder if videoName is provided
 * @param {string} csvData - CSV content to save
 * @param {string} exportType - 'normal' or 'auditor'
 * @param {string} videoName - Optional video name for subfolder
 * @returns {Promise<Object>} Success status and file path
 */
ipcMain.handle('save-csv-export', async (event, csvData, exportType = 'normal', videoName) => {
  await ensureTrafficClickerFolders();
    const basePath = documentsTrafficClickerPath || path.join(app.getPath('documents'), 'CRClicker');
  
  // Create video-specific folder if videoName is provided
  let targetPath = basePath;
  if (videoName) {
    const safeVideoName = videoName.replace(/[^a-zA-Z0-9_-]/g, '_');
    targetPath = path.join(basePath, safeVideoName);
    if (!fs.existsSync(targetPath)) {
      fs.mkdirSync(targetPath, { recursive: true });
    }
  }
  
  const defaultFilename = exportType === 'auditor' 
    ? 'traffic-data-auditor-export.csv' 
    : 'traffic-data-export.csv';
  const defaultPath = path.join(targetPath, defaultFilename);
  
  const result = await dialog.showSaveDialog(mainWindow, {
    title: exportType === 'auditor' ? 'Save Auditor CSV Export' : 'Save CSV Export',
    defaultPath: defaultPath,
    filters: [
      { name: 'CSV Files', extensions: ['csv'] },
      { name: 'All Files', extensions: ['*'] }
    ]
  });

  if (!result.canceled && result.filePath) {
    try {
      fs.writeFileSync(result.filePath, csvData, 'utf8');
      log(`CSV exported to: ${result.filePath}`);
      return { success: true, path: result.filePath };
    } catch (error) {
      log(`Error saving CSV: ${error.message}`);
      return { success: false, error: error.message };
    }
  }
  return { success: false };
});

// ============================================================================
// IPC HANDLERS - Video Download Management
// ============================================================================

/**
 * Cancel an active download for a specific URL
 * Cleans up partial files and closes connections
 * @param {string} videoUrl - URL of download to cancel
 * @returns {Promise<Object>} Success status and cancellation info
 */
ipcMain.handle('cancel-download', async (event, videoUrl) => {
  try {
    if (activeDownloads.has(videoUrl)) {
      const downloadInfo = activeDownloads.get(videoUrl);
      if (downloadInfo.request) {
        downloadInfo.request.destroy();
        log(`Download cancelled for: ${videoUrl}`);
      }
      if (downloadInfo.file) {
        downloadInfo.file.close();
      }
      if (downloadInfo.filePath && fs.existsSync(downloadInfo.filePath)) {
        try {
          fs.unlinkSync(downloadInfo.filePath);
          log(`Deleted partial download: ${downloadInfo.filePath}`);
        } catch (e) {
          log(`Error deleting partial download: ${e.message}`);
        }
      }
      activeDownloads.delete(videoUrl);
      return { success: true, cancelled: true };
    }
    return { success: true, cancelled: false, message: 'No active download found' };
  } catch (error) {
    log(`Error cancelling download: ${error.message}`);
    return { success: false, error: error.message };
  }
});

/**
 * Cancel all active downloads
 * Used when user exits video view
 * @returns {Promise<Object>} Success status and count of cancelled downloads
 */
ipcMain.handle('cancel-all-downloads', async () => {
  try {
    let cancelledCount = 0;
    for (const [url, downloadInfo] of activeDownloads.entries()) {
      if (downloadInfo.request) {
        downloadInfo.request.destroy();
      }
      if (downloadInfo.file) {
        downloadInfo.file.close();
      }
      if (downloadInfo.filePath && fs.existsSync(downloadInfo.filePath)) {
        try {
          fs.unlinkSync(downloadInfo.filePath);
        } catch (e) {
          log(`Error deleting partial download: ${e.message}`);
        }
      }
      cancelledCount++;
    }
    activeDownloads.clear();
    log(`Cancelled ${cancelledCount} download(s)`);
    return { success: true, cancelledCount };
  } catch (error) {
    log(`Error cancelling all downloads: ${error.message}`);
    return { success: false, error: error.message };
  }
});

/**
 * Download video from URL to Movies/CRClicker folder
 * Tracks download progress and prevents duplicate downloads
 * @param {string} videoUrl - URL of video to download
 * @returns {Promise<Object>} Success status, file path, and download stats
 */
ipcMain.handle('download-video-from-url', async (event, videoUrl) => {
  try {
    // Check if download is already in progress for this URL
    if (activeDownloads.has(videoUrl)) {
      log(`Download already in progress for: ${videoUrl}`);
      return {
        success: false,
        error: 'Download already in progress for this URL'
      };
    }
    
    const urlObj = new URL(videoUrl);
    const filename = urlObj.pathname.split('/').pop() || 'video.mp4';
    
    // Use Movies/CRClicker folder
    await ensureTrafficClickerFolders();
    const downloadsPath = moviesTrafficClickerPath || path.join(app.getPath('home'), 'Movies', 'CRClicker');
    
    // Create downloads directory if it doesn't exist
    if (!fs.existsSync(downloadsPath)) {
      fs.mkdirSync(downloadsPath, { recursive: true });
    }
    
    const filePath = path.join(downloadsPath, filename);
    
    // Use http or https based on URL protocol
    const client = urlObj.protocol === 'https:' ? https : http;
    
    return new Promise((resolve, reject) => {
      const file = fs.createWriteStream(filePath);
      let downloadedBytes = 0;
      let totalBytes = 0;
      let request = null;
      
      // Store download info for cancellation
      const downloadInfo = {
        request: null,
        file: file,
        filePath: filePath,
        url: videoUrl
      };
      activeDownloads.set(videoUrl, downloadInfo);
      
      request = client.get(videoUrl, (response) => {
        downloadInfo.request = request;
        
        // Handle redirects
        if (response.statusCode === 301 || response.statusCode === 302) {
          file.close();
          fs.unlinkSync(filePath);
          activeDownloads.delete(videoUrl);
          return resolve({
            success: false,
            error: 'Redirect not handled',
            redirectUrl: response.headers.location
          });
        }
        
        if (response.statusCode !== 200) {
          file.close();
          fs.unlinkSync(filePath);
          activeDownloads.delete(videoUrl);
          return resolve({
            success: false,
            error: `HTTP ${response.statusCode}: ${response.statusMessage}`
          });
        }
        
        totalBytes = parseInt(response.headers['content-length'] || '0', 10);
        
        response.on('data', (chunk) => {
          // Check if download was cancelled BEFORE writing
          if (!activeDownloads.has(videoUrl)) {
            file.close();
            try {
              if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
              }
            } catch (e) {
              log(`Error deleting cancelled download: ${e.message}`);
            }
            return;
          }
          
          downloadedBytes += chunk.length;
          try {
            file.write(chunk);
          } catch (writeError) {
            log(`Error writing chunk: ${writeError.message}`);
            file.close();
            activeDownloads.delete(videoUrl);
            if (fs.existsSync(filePath)) {
              try {
                fs.unlinkSync(filePath);
              } catch (e) {
                log(`Error deleting failed download: ${e.message}`);
              }
            }
            reject({
              success: false,
              error: writeError.message
            });
            return;
          }
          
          // Send progress updates
          const progress = totalBytes > 0 ? (downloadedBytes / totalBytes) * 100 : 0;
          event.sender.send('download-progress', {
            progress,
            downloadedBytes,
            totalBytes
          });
        });
        
        response.on('end', () => {
          file.end();
          activeDownloads.delete(videoUrl);
          log(`Video downloaded from URL: ${filePath}`);
          resolve({
            success: true,
            path: filePath,
            downloadedBytes,
            totalBytes
          });
        });
        
        response.on('error', (error) => {
          file.close();
          if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
          }
          activeDownloads.delete(videoUrl);
          reject({
            success: false,
            error: error.message
          });
        });
      });
      
      request.on('error', (error) => {
        file.close();
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
        activeDownloads.delete(videoUrl);
        reject({
          success: false,
          error: error.message
        });
      });
      
      // Store request reference
      downloadInfo.request = request;
    });
  } catch (error) {
    log(`Error downloading video: ${error.message}`);
    activeDownloads.delete(videoUrl);
    return {
      success: false,
      error: error.message
    };
  }
});
