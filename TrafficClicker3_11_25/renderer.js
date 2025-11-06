/**
 * CRClicker - Renderer Process
 * 
 * Main renderer process handling UI interactions, video playback,
 * entry management, recap mode, and data export.
 */

const { ipcRenderer } = require('electron');

// ============================================================================
// MODULE IMPORTS (if available)
// ============================================================================
let stateModule, utilsModule, recapModule, videoControlsModule;

try {
  stateModule = require('./js/modules/state.js');
  utilsModule = require('./js/modules/utils.js');
  recapModule = require('./js/modules/recap.js');
  videoControlsModule = require('./js/modules/video-controls.js');
} catch (e) {
  // Modules not available, use inline definitions
  log('Modules not loaded, using inline code');
}

// ============================================================================
// LOGGING
// ============================================================================
/**
 * Send log message to main process for file logging
 * @param {...any} args - Arguments to log
 */
function log(...args) {
  ipcRenderer.send('renderer-log', ...args);
}

// ============================================================================
// TOAST NOTIFICATION SYSTEM
// ============================================================================
/**
 * Display a toast notification to the user
 * @param {string} message - Message to display
 * @param {string} type - Toast type: 'info', 'success', 'error', 'warning'
 * @param {number} duration - Display duration in milliseconds (0 = persistent)
 * @returns {HTMLElement} The created toast element
 */
function showToast(message, type = 'info', duration = 3000) {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  
  const info = document.createElement('div');
  info.className = 'toast-info';
  info.textContent = message;
  
  const closeBtn = document.createElement('button');
  closeBtn.className = 'toast-close';
  closeBtn.innerHTML = '×';
  closeBtn.onclick = () => removeToast(toast);
  
  toast.appendChild(info);
  toast.appendChild(closeBtn);
  container.appendChild(toast);
  
  if (duration > 0) {
    setTimeout(() => removeToast(toast), duration);
  }
  
  return toast;
}

/**
 * Remove a toast notification with fade-out animation
 * @param {HTMLElement} toast - Toast element to remove
 */
function removeToast(toast) {
  if (!toast || !toast.parentNode) return;
  toast.classList.add('fade-out');
  setTimeout(() => {
    if (toast.parentNode) {
      toast.parentNode.removeChild(toast);
    }
  }, 300);
}

/**
 * Sanitize a value for CSV export
 * Escapes quotes and wraps in quotes if needed
 * @param {any} value - Value to sanitize
 * @returns {string} Sanitized CSV-safe string
 */
function sanitizeForCSV(value) {
  if (value === null || value === undefined) return '';
  const str = String(value);
  // Replace quotes with double quotes and wrap in quotes if contains comma, quote, or newline
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

// ============================================================================
// CONFIG VALIDATION
// ============================================================================
/**
 * Validate configuration JSON structure and content
 * Checks for required fields, valid step definitions, and conditional logic
 * @param {Object} config - Configuration object to validate
 * @returns {Object} Validation result with valid flag and errors array
 */
function validateConfig(config) {
  const errors = [];
  
  if (!config) {
    return { valid: false, errors: ['Config is null or undefined'] };
  }
  
  if (!Array.isArray(config.steps)) {
    errors.push('Config must have a "steps" array');
    return { valid: false, errors };
  }
  
  if (config.steps.length === 0) {
    errors.push('Config must have at least one step');
  }
  
  config.steps.forEach((step, index) => {
    if (!step.step_id) {
      errors.push(`Step ${index + 1}: Missing step_id`);
    }
    
    // Accept either 'question' or 'title' field
    if (!step.question && !step.title && step.type !== 'text') {
      errors.push(`Step ${index + 1} (${step.step_id || 'unknown'}): Missing question or title`);
    }
    
    if (step.type === 'choice' && (!Array.isArray(step.choices) || step.choices.length === 0)) {
      errors.push(`Step ${index + 1} (${step.step_id || 'unknown'}): Choice type must have a non-empty choices array`);
    }
    
    if (step.condition) {
      // Support both 'field' and 'step_id' for backward compatibility
      const conditionField = step.condition.field || step.condition.step_id;
      if (!conditionField) {
        errors.push(`Step ${index + 1} (${step.step_id || 'unknown'}): Condition missing field or step_id`);
      }
      // Operator is optional (defaults to '==' in evaluateStepCondition)
      // Value can be undefined for some operators like 'in' with 'values' array
      if (step.condition.operator && step.condition.operator !== '==' && step.condition.operator !== '=' && 
          (step.condition.value === undefined || step.condition.value === null) && 
          (!Array.isArray(step.condition.values) || step.condition.values.length === 0)) {
        errors.push(`Step ${index + 1} (${step.step_id || 'unknown'}): Condition missing value or values array`);
      }
      // For default equality operator, value is required
      if (!step.condition.operator || step.condition.operator === '==' || step.condition.operator === '=') {
        if (step.condition.value === undefined || step.condition.value === null) {
          errors.push(`Step ${index + 1} (${step.step_id || 'unknown'}): Condition missing value`);
        }
      }
    }
    
    // Check for circular dependencies in conditions
    const conditionField = step.condition ? (step.condition.field || step.condition.step_id) : null;
    if (step.condition && conditionField === step.step_id) {
      errors.push(`Step ${index + 1} (${step.step_id || 'unknown'}): Condition references itself (circular dependency)`);
    }
  });
  
  // Check that all condition fields reference valid step_ids
  config.steps.forEach((step, index) => {
    if (step.condition) {
      const conditionField = step.condition.field || step.condition.step_id;
      if (conditionField) {
        const referencedStep = config.steps.find(s => s.step_id === conditionField);
        if (!referencedStep) {
          errors.push(`Step ${index + 1} (${step.step_id || 'unknown'}): Condition references non-existent step_id "${conditionField}"`);
        }
        // Check that referenced step comes before current step
        const referencedIndex = config.steps.findIndex(s => s.step_id === conditionField);
        if (referencedIndex >= index) {
          errors.push(`Step ${index + 1} (${step.step_id || 'unknown'}): Condition references step "${conditionField}" which comes after or at the same position`);
        }
      }
    }
  });
  
  return {
    valid: errors.length === 0,
    errors: errors
  };
}

// ============================================================================
// APPLICATION STATE
// ============================================================================
let state = stateModule?.state || {
  config: null,
  configPath: null,
  videoPath: null,
  videoElement: null,
  videoContainer: null,
  setupData: {
    streetName: '',
    guid: '',
    siteDescription: '',
    videoStartTime: null
  },
  masterLog: [],
  currentEntry: null,
  currentStepIndex: 0,
  spacePressed: false,
  playbackSpeed: 1.0,
  speedSequence: [8, 6, 4, 2, 1.0, 0.75, 0.5, 0.25],
  directionIndicators: {
    north: null,
    south: null,
    east: null,
    west: null
  },
  entryCounter: 0,
  // Dot system: { entryId -> { color: 'green'|'orange'|'red', startTime, phase, entryTime } }
  // color: 'green' = new entry click, 'orange' = rewind/undo indicator, 'red' = finalized
  // phase: 'waiting' = waiting for choices, 'finalized' = choices done, 'rewind' = showing in rewind
  activeDots: new Map(),
  dotTimeouts: new Map(), // entryId -> timeoutId for cleanup
  isRewinding: false, // Track if we're in rewind mode
  rewindStartTime: null, // Track when rewind started (to pause when we reach it)
  recapEndTime: null, // Track when recap should end (latest entry time)
  recapCompleted: false, // Track if recap has completed (paused at latest entry, waiting for SPACE to exit)
  mode: 'entry', // 'entry' or 'audit'
  auditCsvPath: null, // Path to loaded CSV in audit mode
  originalEntries: [], // Original entries from CSV in audit mode
  deletedEntryIds: new Set(), // Entry IDs marked for deletion in audit mode
  newEntries: [], // New entries added during audit
  // Undo/Redo stack
  undoStack: [], // History of state snapshots for undo
  redoStack: [], // History of state snapshots for redo
  maxUndoHistory: 50, // Maximum number of undo operations
  // Video streaming/download state
  videoUrl: null, // URL of streamed video
  downloadPath: null, // Path to downloaded video file
  downloadCompleted: false, // Whether download is complete
  isStreaming: false, // Whether video is currently streaming
  downloadProgressListenerSet: false, // Whether download progress listener has been set up
  // Event listener references for cleanup
  eventListeners: {
    keydown: null,
    videoClick: null,
    shortcutsClick: null,
    timeupdate: null,
    loadedmetadata: null,
    seeked: null,
    pause: null
  }
};

// Ensure undoStack and redoStack are always initialized (in case stateModule provided state)
if (!state.undoStack) {
  state.undoStack = [];
}
if (!state.redoStack) {
  state.redoStack = [];
}
if (!state.maxUndoHistory) {
  state.maxUndoHistory = 50;
}
// Ensure eventListeners is always initialized
if (!state.eventListeners) {
  state.eventListeners = {
    keydown: null,
    videoClick: null,
    shortcutsClick: null,
    timeupdate: null,
    loadedmetadata: null,
    seeked: null,
    pause: null
  };
}

// ============================================================================
// DOM ELEMENTS
// ============================================================================
const elements = stateModule?.elements || {
  setupScreen: document.getElementById('setup-screen'),
  countingScreen: document.getElementById('counting-screen'),
  loadConfigBtn: document.getElementById('load-config-btn'),
  loadVideoBtn: document.getElementById('load-video-btn'),
  loadVideoUrlBtn: document.getElementById('load-video-url-btn'),
  loadSessionBtn: document.getElementById('load-session-btn'),
  loadCsvBtn: document.getElementById('load-csv-btn'),
  configStatus: document.getElementById('config-status'),
  videoStatus: document.getElementById('video-status'),
  csvStatus: document.getElementById('csv-status'),
  modeEntry: document.getElementById('mode-entry'),
  modeAudit: document.getElementById('mode-audit'),
  csvLoaderGroup: document.getElementById('csv-loader-group'),
  startAuditBtn: document.getElementById('start-audit-btn'),
  streetName: document.getElementById('street-name'),
  guid: document.getElementById('guid'),
  siteDescription: document.getElementById('site-description'),
  videoStartTime: document.getElementById('video-start-time'),
  startCountingBtn: document.getElementById('start-counting-btn'),
  videoPlayer: document.getElementById('video-player'),
  videoContainer: document.getElementById('video-container'),
  canvasOverlay: document.getElementById('canvas-overlay'),
  instructionMessage: document.getElementById('instruction-message'),
  choiceModal: document.getElementById('choice-modal'),
  modalQuestion: document.getElementById('modal-question'),
  modalStepInfo: document.getElementById('modal-step-info'),
  choiceButtons: document.getElementById('choice-buttons'),
  logsContent: document.getElementById('logs-content'),
  exportBtn: document.getElementById('export-btn'),
  videoTimeDisplay: document.getElementById('video-time-display'),
  speedDisplay: document.getElementById('speed-display'),
  entryCountBadge: document.getElementById('entry-count-badge'),
  shortcutToggle: document.getElementById('shortcut-toggle'),
  shortcutsPanel: document.getElementById('shortcuts-panel'),
  logsCount: document.getElementById('logs-count'),
  modalProgressBar: document.getElementById('modal-progress-bar'),
  dirN: document.getElementById('dir-n'),
  dirS: document.getElementById('dir-s'),
  dirE: document.getElementById('dir-e'),
  dirW: document.getElementById('dir-w'),
  closeVideoBtn: document.getElementById('close-video-btn'),
  urlInputModal: document.getElementById('url-input-modal'),
  urlInputField: document.getElementById('url-input-field'),
  urlInputSubmitBtn: document.getElementById('url-input-submit-btn'),
  urlInputCancelBtn: document.getElementById('url-input-cancel-btn')
};

// ============================================================================
// MODULE INITIALIZATION
// ============================================================================
// Initialize module instances if available
let recapManager = null;
let videoControls = null;

if (recapModule) {
  recapManager = recapModule(state, elements, log);
}

if (videoControlsModule) {
  videoControls = videoControlsModule(state, elements, log);
}


// ============================================================================
// INITIALIZATION
// ============================================================================
document.addEventListener('DOMContentLoaded', () => {
  // Re-initialize elements after DOM is loaded (in case they weren't found earlier)
  if (!elements.loadVideoUrlBtn) {
    elements.loadVideoUrlBtn = document.getElementById('load-video-url-btn');
  }
  if (!elements.urlInputModal) {
    elements.urlInputModal = document.getElementById('url-input-modal');
  }
  if (!elements.urlInputField) {
    elements.urlInputField = document.getElementById('url-input-field');
  }
  if (!elements.urlInputSubmitBtn) {
    elements.urlInputSubmitBtn = document.getElementById('url-input-submit-btn');
  }
  if (!elements.urlInputCancelBtn) {
    elements.urlInputCancelBtn = document.getElementById('url-input-cancel-btn');
  }
  
  initializeSetup();
  initializeCounting();
  loadDirectionIndicators();
  
  
  // Listen for command-line URL argument
  ipcRenderer.on('load-video-url-command', (event, videoUrl) => {
    if (videoUrl) {
      // Automatically load the URL
      loadVideoFromUrl(videoUrl);
    }
  });
});

// ============================================================================
// VIDEO URL LOADING
// ============================================================================

function loadVideoFromUrl(videoUrl) {
  if (!videoUrl || !videoUrl.trim()) {
    showToast('Please enter a video URL', 'error');
    return;
  }
  
  const url = videoUrl.trim();
  
  // Validate URL
  try {
    new URL(url);
  } catch (e) {
    showToast('Invalid URL format', 'error');
    return;
  }
  
  // Close modal if open
  if (elements.urlInputModal) {
    elements.urlInputModal.classList.remove('active');
  }
  
  // Cancel any existing download for this URL (shouldn't happen, but safety check)
  if (state.videoUrl && state.videoUrl === url && state.isStreaming) {
    ipcRenderer.invoke('cancel-download', url).catch(() => {
      // Ignore errors when cancelling
    });
  }
  
  // Set streaming state
  state.videoUrl = url;
  state.isStreaming = true;
  state.downloadCompleted = false;
  state.downloadPath = null;
  
  // Set video source to URL for streaming
  state.videoPath = url; // Use URL as path for now
  elements.videoStatus.textContent = `Streaming: ${url.substring(0, 50)}...`;
  elements.videoStatus.classList.add('loaded');
  
  // Start download in background
  showToast('Starting download...', 'info');
  
  ipcRenderer.invoke('download-video-from-url', url).then((result) => {
    if (result.success) {
      state.downloadPath = result.path;
      state.downloadCompleted = true;
      showToast('Download completed! Video will switch to downloaded file on next pause.', 'success', 5000);
    } else {
      if (result.error && result.error.includes('already in progress')) {
        showToast('Download already in progress for this URL', 'info', 3000);
      } else {
        showToast(`Download failed: ${result.error}`, 'error', 5000);
      }
      state.downloadCompleted = false;
    }
  }).catch((error) => {
    showToast(`Download error: ${error.message || error}`, 'error', 5000);
    state.downloadCompleted = false;
  });
  
  // Listen for download progress (only once, reuse existing listener)
  if (!state.downloadProgressListenerSet) {
    const downloadProgressHandler = (event, progressData) => {
      // Could show progress in UI if needed
      // For now, just log it
      if (progressData && progressData.totalBytes > 0) {
        log(`Download progress: ${progressData.progress.toFixed(1)}%`);
      }
    };
    ipcRenderer.on('download-progress', downloadProgressHandler);
    state.downloadProgressListenerSet = true;
    // Store handler reference for potential cleanup (though IPC listeners persist)
    state.downloadProgressHandler = downloadProgressHandler;
  }
  
  checkStartButton();
}

// ============================================================================
// SETUP SCREEN
// ============================================================================

function initializeSetup() {
  // Mode toggle
  elements.modeEntry.addEventListener('change', () => {
    if (elements.modeEntry.checked) {
      state.mode = 'entry';
      elements.csvLoaderGroup.style.display = 'none';
      elements.startCountingBtn.style.display = 'block';
      elements.startAuditBtn.style.display = 'none';
      checkStartButton();
    }
  });

  elements.modeAudit.addEventListener('change', () => {
    if (elements.modeAudit.checked) {
      state.mode = 'audit';
      elements.csvLoaderGroup.style.display = 'block';
      elements.startCountingBtn.style.display = 'none';
      elements.startAuditBtn.style.display = 'block';
      checkStartButton();
    }
  });

  elements.loadConfigBtn.addEventListener('click', async () => {
    const result = await ipcRenderer.invoke('select-config-file');
    if (result.success) {
      // Validate config
      const validationResult = validateConfig(result.config);
      if (!validationResult.valid) {
        showToast(`Config validation failed: ${validationResult.errors.join(', ')}`, 'error', 5000);
        elements.configStatus.textContent = 'Invalid config file';
        elements.configStatus.classList.remove('loaded');
        state.config = null;
        checkStartButton();
        return;
      }
      
      state.config = result.config;
      state.configPath = result.path;
      elements.configStatus.textContent = `Loaded: ${result.path.split('/').pop()}`;
      elements.configStatus.classList.add('loaded');
      checkStartButton();
      showToast('Config file loaded successfully', 'success');
    } else if (!result.canceled) {
      showToast(`Failed to load config: ${result.error || 'Unknown error'}`, 'error');
    }
  });

  elements.loadCsvBtn.addEventListener('click', async () => {
    const result = await ipcRenderer.invoke('select-csv-file');
    if (result.success) {
      state.auditCsvPath = result.path;
      // Parse CSV
      const parsed = parseCSV(result.data);
      state.originalEntries = parsed.entries;

      // Extract metadata from CSV and populate form fields
      if (parsed.metadata) {
        if (parsed.metadata.streetName) {
          elements.streetName.value = parsed.metadata.streetName;
        }
        if (parsed.metadata.guid) {
          elements.guid.value = parsed.metadata.guid;
        }
        if (parsed.metadata.siteDescription) {
          elements.siteDescription.value = parsed.metadata.siteDescription;
        }
        if (parsed.metadata.videoStartTime) {
          elements.videoStartTime.value = parsed.metadata.videoStartTime;
        }
      }

      elements.csvStatus.textContent = `Loaded: ${result.path.split('/').pop()} (${parsed.entries.length} entries)`;
      elements.csvStatus.classList.add('loaded');
      checkStartButton();
    }
  });

  elements.loadVideoBtn.addEventListener('click', async () => {
    const result = await ipcRenderer.invoke('select-video-file');
    if (result.success) {
      // Check if this is a different video from auto-save before setting new path
      const oldVideoPath = state.videoPath;
      
      state.videoPath = result.path;
      // Extract filename without extension for screenshot naming
      const fullPath = result.path;
      const filename = fullPath.split('/').pop().split('\\').pop();
      state.videoFileName = filename.replace(/\.[^/.]+$/, ''); // Remove extension
      elements.videoStatus.textContent = `Loaded: ${result.path.split('/').pop()}`;
      elements.videoStatus.classList.add('loaded');
      
      // Reset streaming state
      state.videoUrl = null;
      state.downloadPath = null;
      state.downloadCompleted = false;
      state.isStreaming = false;
      
      checkStartButton();
    }
  });

  // Load Session button - re-check for element in case it wasn't found initially
  const loadSessionBtn = elements.loadSessionBtn || document.getElementById('load-session-btn');
  if (loadSessionBtn) {
    loadSessionBtn.addEventListener('click', () => {
      loadSession();
    });
  } else {
    log('Load Session button not found');
  }

  // Load video from URL - re-check for elements in case they weren't found initially
  const loadVideoUrlBtn = elements.loadVideoUrlBtn || document.getElementById('load-video-url-btn');
  const urlInputModal = elements.urlInputModal || document.getElementById('url-input-modal');
  const urlInputField = elements.urlInputField || document.getElementById('url-input-field');
  const urlInputSubmitBtn = elements.urlInputSubmitBtn || document.getElementById('url-input-submit-btn');
  const urlInputCancelBtn = elements.urlInputCancelBtn || document.getElementById('url-input-cancel-btn');
  
  if (loadVideoUrlBtn) {
    loadVideoUrlBtn.addEventListener('click', () => {
      // Show URL input modal
      if (urlInputModal) {
        if (urlInputField) {
          urlInputField.value = '';
          urlInputField.focus();
        }
        urlInputModal.classList.add('active');
      } else {
        log('URL input modal not found');
        showToast('URL input modal not found', 'error');
      }
    });
  } else {
    log('Load Video URL button not found');
    showToast('Load Video URL button not found', 'error');
  }

  // URL input modal handlers
  if (urlInputSubmitBtn) {
    urlInputSubmitBtn.addEventListener('click', async () => {
      const videoUrl = urlInputField ? urlInputField.value.trim() : '';
      if (videoUrl) {
        loadVideoFromUrl(videoUrl);
      } else {
        showToast('Please enter a video URL', 'error');
      }
    });
  } else {
    log('URL input submit button not found');
  }

  if (urlInputCancelBtn) {
    urlInputCancelBtn.addEventListener('click', () => {
      if (urlInputModal) {
        urlInputModal.classList.remove('active');
      }
    });
  } else {
    log('URL input cancel button not found');
  }

  // Allow Enter key to submit URL
  if (urlInputField) {
    urlInputField.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && urlInputSubmitBtn) {
        urlInputSubmitBtn.click();
      }
    });
  }

  elements.startCountingBtn.addEventListener('click', () => {
    state.setupData.streetName = elements.streetName.value.trim();
    state.setupData.guid = elements.guid.value.trim();
    state.setupData.siteDescription = elements.siteDescription.value.trim();

    // Parse and store video start time
    const startTimeStr = elements.videoStartTime.value.trim();
    if (startTimeStr) {
      state.setupData.videoStartTime = parseTimestampToSeconds(startTimeStr);
      if (state.setupData.videoStartTime === null) {
        showToast('Invalid video start time format. Please use format like "7:00:00 AM" or "07:00:00"', 'error');
        return;
      }
    } else {
      state.setupData.videoStartTime = 0; // Default to midnight if not specified
    }

    if (!state.config || !state.videoPath) {
      showToast('Please load config file and video file', 'error');
      return;
    }

    // Restore session data if available, otherwise clear (new session)
    if (state.pendingSessionData) {
      state.masterLog = state.pendingSessionData.entries || [];
      state.newEntries = state.pendingSessionData.newEntries || [];
      state.deletedEntryIds = state.pendingSessionData.deletedEntryIds || new Set();
      state.originalEntries = state.pendingSessionData.originalEntries || [];
      state.playbackSpeed = state.pendingSessionData.playbackSpeed || 1.0;
      state.entryCounter = state.pendingSessionData.entryCounter || 0;
      state.savedVideoPosition = state.pendingSessionData.videoPosition || 0;
      state.pendingSessionData = null; // Clear after use
    } else {
      // Clear previous session data (new session)
      state.masterLog = [];
      state.newEntries = [];
      state.deletedEntryIds.clear();
      state.originalEntries = [];
      state.entryCounter = 0;
      state.savedVideoPosition = 0;
    }
    
    state.currentEntry = null;
    state.currentStepIndex = 0;
    state.activeDots.clear();
    state.dotTimeouts.forEach(timeout => clearTimeout(timeout));
    state.dotTimeouts.clear();
    state.isRewinding = false;
    state.recapEndTime = null;
    state.recapCompleted = false;
    state.rewindStartTime = null;
    // Reset spacePressed - will be set to true when space is pressed or when session is restored
    if (!state.pendingSessionData || state.savedVideoPosition === 0) {
      state.spacePressed = false;
    }

    // Close any open modal
    if (elements.choiceModal) {
      elements.choiceModal.classList.remove('active');
    }
    
    // Close URL input modal if open
    const urlInputModal = document.getElementById('url-input-modal');
    if (urlInputModal) {
      urlInputModal.classList.remove('active');
    }

    // Update logs panel and entry count
    updateLogsPanel();
    if (elements.entryCountBadge) {
      elements.entryCountBadge.textContent = `Entries: ${state.masterLog.length}`;
    }

    elements.setupScreen.style.display = 'none';
    elements.countingScreen.classList.add('active');

    // Show instruction message initially (only if no entries to restore)
    if (elements.instructionMessage && state.masterLog.length === 0) {
      elements.instructionMessage.classList.remove('hidden');
    } else if (elements.instructionMessage) {
      elements.instructionMessage.classList.add('hidden');
    }

    initializeVideo();
    
    // Restore video position and entries if session was loaded
    if (state.savedVideoPosition > 0 && state.videoElement) {
      // Enable rewind mode to show dots for existing entries
      state.isRewinding = true;
      
      // Wait for video metadata to be loaded
      const restorePosition = () => {
        if (state.videoElement.readyState >= 2) {
          // Video metadata is loaded
          const seekTime = Math.max(0, Math.min(state.savedVideoPosition, state.videoElement.duration));
          log(`Restoring video position to ${seekTime.toFixed(2)}s (saved: ${state.savedVideoPosition.toFixed(2)}s, duration: ${state.videoElement.duration.toFixed(2)}s)`);
          state.videoElement.currentTime = seekTime;
          
          state.videoElement.addEventListener('seeked', function onSeeked() {
            state.videoElement.removeEventListener('seeked', onSeeked);
            
            // Verify we're at the correct position
            const actualTime = state.videoElement.currentTime;
            log(`Video seeked to ${actualTime.toFixed(2)}s (target was ${seekTime.toFixed(2)}s)`);
            
            // Update UI
            updateVideoTimeDisplay();
            updateLogsPanel();
            if (elements.entryCountBadge) {
              elements.entryCountBadge.textContent = `Entries: ${state.masterLog.length}`;
            }
            
            // Draw dots for all existing entries
            drawRedDots();
            
            // Hide instruction message
            if (elements.instructionMessage) {
              elements.instructionMessage.classList.add('hidden');
            }
            
            // Automatically start playing from saved position
            state.spacePressed = true; // Enable clicks
            enableVideoClicks(); // CRITICAL: Enable click handler
            state.videoElement.play();
            state.videoElement.playbackRate = state.playbackSpeed;
            
            showToast(`Session restored: Playing from ${formatTime(seekTime)}`, 'success', 3000);
            log(`Session restored: Video position ${seekTime.toFixed(2)}s, ${state.masterLog.length} entries`);
          }, { once: true });
        } else {
          // Wait for metadata to load
          log('Waiting for video metadata to load before restoring position...');
          state.videoElement.addEventListener('loadedmetadata', function onLoadedMetadata() {
            state.videoElement.removeEventListener('loadedmetadata', onLoadedMetadata);
            log('Video metadata loaded, restoring position...');
            restorePosition();
          }, { once: true });
        }
      };
      
      // Start restore process
      restorePosition();
    } else if (state.masterLog.length > 0) {
      // Session loaded but no saved position - just restore entries
      // Enable rewind mode to show dots for existing entries
      state.isRewinding = true;
      
      // Still need to enable clicks if space was pressed in the saved session
      if (state.savedVideoPosition > 0) {
        // If there was a saved position, assume space was pressed
        state.spacePressed = true;
        enableVideoClicks();
      }
      updateLogsPanel();
      if (elements.entryCountBadge) {
        elements.entryCountBadge.textContent = `Entries: ${state.masterLog.length}`;
      }
      
      // Wait for video to be ready before drawing dots
      if (state.videoElement) {
        const drawDotsWhenReady = () => {
          if (state.videoElement.readyState >= 2) {
            drawRedDots();
          } else {
            state.videoElement.addEventListener('loadedmetadata', () => {
              drawRedDots();
            }, { once: true });
          }
        };
        drawDotsWhenReady();
      } else {
        drawRedDots();
      }
      showToast('Session restored', 'success', 2000);
    }
  });

  elements.startAuditBtn.addEventListener('click', () => {
    state.setupData.streetName = elements.streetName.value.trim();
    state.setupData.guid = elements.guid.value.trim();
    state.setupData.siteDescription = elements.siteDescription.value.trim();

    // Parse and store video start time
    const startTimeStr = elements.videoStartTime.value.trim();
    if (startTimeStr) {
      state.setupData.videoStartTime = parseTimestampToSeconds(startTimeStr);
      if (state.setupData.videoStartTime === null) {
        showToast('Invalid video start time format. Please use format like "7:00:00 AM" or "07:00:00"', 'error');
        return;
      }
    } else {
      state.setupData.videoStartTime = 0; // Default to midnight if not specified
    }

    if (!state.config || !state.videoPath || !state.auditCsvPath) return;

    // Restore session data if available, otherwise clear (new session)
    if (state.pendingSessionData) {
      state.masterLog = state.pendingSessionData.entries || [];
      state.newEntries = state.pendingSessionData.newEntries || [];
      state.deletedEntryIds = state.pendingSessionData.deletedEntryIds || new Set();
      state.originalEntries = state.pendingSessionData.originalEntries || state.originalEntries;
      state.playbackSpeed = state.pendingSessionData.playbackSpeed || 1.0;
      state.entryCounter = state.pendingSessionData.entryCounter || 0;
      state.savedVideoPosition = state.pendingSessionData.videoPosition || 0;
      state.pendingSessionData = null; // Clear after use
    } else {
      // Clear previous session data (except original entries from CSV)
      state.newEntries = [];
      state.deletedEntryIds.clear();
      state.entryCounter = 0;
      state.savedVideoPosition = 0;
      // Load original entries into masterLog for audit
      state.masterLog = [...state.originalEntries];
    }

    state.currentEntry = null;
    state.currentStepIndex = 0;
    state.activeDots.clear();
    state.dotTimeouts.forEach(timeout => clearTimeout(timeout));
    state.dotTimeouts.clear();
    state.isRewinding = false;
    state.recapEndTime = null;
    state.recapCompleted = false;
    state.rewindStartTime = null;
    // Reset spacePressed - will be set to true when space is pressed or when session is restored
    if (!state.pendingSessionData || state.savedVideoPosition === 0) {
      state.spacePressed = false;
    }

    // Close any open modal
    if (elements.choiceModal) {
      elements.choiceModal.classList.remove('active');
    }

    // Update logs panel
    updateLogsPanel();

    elements.setupScreen.style.display = 'none';
    elements.countingScreen.classList.add('active');

    // Update instruction message for audit mode
    if (elements.instructionMessage) {
      const title = elements.instructionMessage.querySelector('h3');
      const step2 = elements.instructionMessage.querySelectorAll('p')[1];
      if (title) {
        title.textContent = '🚦 Ready to Audit Traffic';
      }
      if (step2) {
        step2.innerHTML = '<span class="highlight">Step 2:</span> Press <span class="highlight">SPACE</span> to start playing and begin audit';
      }
      // Show instruction message initially (will be hidden when space is pressed)
      elements.instructionMessage.classList.remove('hidden');
    }
    if (elements.timestampSelector) {
      elements.timestampSelector.style.display = 'none';
    }

    initializeVideo();

    // In audit mode, wait for user to press SPACE before playing
    // Don't auto-play - let the instruction dialog stay visible
    // Video should be paused until user presses SPACE
    // initializeVideo will pause it at 1 second, we just need to set up state
    state.isRewinding = true; // Enable rewind mode for dots
    state.spacePressed = false; // Don't enable clicks until SPACE is pressed

    // Restore video position if session was loaded
    if (state.savedVideoPosition > 0 && state.videoElement) {
      state.videoElement.addEventListener('loadedmetadata', function onLoadedMetadata() {
        state.videoElement.removeEventListener('loadedmetadata', onLoadedMetadata);
        
        // Seek to exact saved position
        const seekTime = Math.max(0, Math.min(state.savedVideoPosition, state.videoElement.duration));
        state.videoElement.currentTime = seekTime;
        
        state.videoElement.addEventListener('seeked', function onSeeked() {
          state.videoElement.removeEventListener('seeked', onSeeked);
          
          // Update UI
          updateVideoTimeDisplay();
          updateLogsPanel();
          if (elements.entryCountBadge) {
            elements.entryCountBadge.textContent = `Entries: ${state.masterLog.length}`;
          }
          drawRedDots();
          
          // Hide instruction message
          if (elements.instructionMessage) {
            elements.instructionMessage.classList.add('hidden');
          }
          
          // Automatically start playing from saved position
          state.spacePressed = true; // Enable clicks
          enableVideoClicks(); // CRITICAL: Enable click handler
          state.videoElement.play();
          state.videoElement.playbackRate = state.playbackSpeed;
          
          showToast(`Session restored: Playing from ${formatTime(seekTime)}`, 'success', 3000);
          log(`Session restored (audit): Video position ${seekTime.toFixed(2)}s, ${state.masterLog.length} entries`);
        }, { once: true });
      }, { once: true });
    } else {
      // Wait for video to be ready, then ensure it's paused
      let ensurePausedRetryCount = 0;
      const MAX_ENSURE_PAUSED_RETRIES = 50; // Max 5 seconds (50 * 100ms)
      
      const ensurePaused = () => {
        if (state.videoElement && state.videoElement.readyState >= 2) {
          // Video metadata is loaded
          if (!state.videoElement.paused) {
            state.videoElement.pause();
          }
          updateLogsPanel(); // Show original entries in log
        } else {
          // Wait a bit and try again, with retry limit
          if (ensurePausedRetryCount < MAX_ENSURE_PAUSED_RETRIES) {
            ensurePausedRetryCount++;
            setTimeout(ensurePaused, 100);
          } else {
            log('Warning: Video pause check timeout - video metadata may not be loaded');
          }
        }
      };
      ensurePaused();
    }
  });

  // Update start button state
  elements.streetName.addEventListener('input', checkStartButton);
  elements.guid.addEventListener('input', checkStartButton);
  elements.siteDescription.addEventListener('input', checkStartButton);
  elements.videoStartTime.addEventListener('input', checkStartButton);
}

function checkStartButton() {
  const hasConfig = state.config !== null;
  const hasVideo = state.videoPath !== null;
  const hasFormData = elements.streetName.value.trim() &&
                     elements.guid.value.trim() &&
                     elements.siteDescription.value.trim();

  if (state.mode === 'entry') {
    elements.startCountingBtn.disabled = !(hasConfig && hasVideo && hasFormData);
  } else if (state.mode === 'audit') {
    const hasCsv = state.auditCsvPath !== null;
    elements.startAuditBtn.disabled = !(hasConfig && hasVideo && hasCsv && hasFormData);
  }
}

// Parse CSV file
function parseCSV(csvData) {
  const lines = csvData.split('\n').filter(line => line.trim());
  if (lines.length < 2) return { entries: [], metadata: null };

  // Parse header
  const header = lines[0].split(',').map(h => h.replace(/^"|"$/g, '').trim());

  // Extract metadata from first data row (Street Name, GUID, Site Description, Video File)
  const metadata = {};
  if (lines.length > 1) {
    const firstRow = lines[1].split(',').map(v => v.replace(/^"|"$/g, '').trim());
    const streetNameIndex = header.indexOf('Street Name');
    const guidIndex = header.indexOf('GUID');
    const siteDescIndex = header.indexOf('Site Description');
    const videoFileIndex = header.indexOf('Video File');

    if (streetNameIndex >= 0 && firstRow[streetNameIndex]) {
      metadata.streetName = firstRow[streetNameIndex];
    }
    if (guidIndex >= 0 && firstRow[guidIndex]) {
      metadata.guid = firstRow[guidIndex];
    }
    if (siteDescIndex >= 0 && firstRow[siteDescIndex]) {
      metadata.siteDescription = firstRow[siteDescIndex];
    }

    // Try to extract video start time from first entry's ocr_timestamp
    // Or look for a Video Start Time column if it exists
    const videoStartTimeIndex = header.indexOf('Video Start Time');
    if (videoStartTimeIndex >= 0 && firstRow[videoStartTimeIndex]) {
      metadata.videoStartTime = firstRow[videoStartTimeIndex];
    } else {
      // Try to extract from first entry's ocr_timestamp and playback_time
      const ocrIndex = header.indexOf('ocr_timestamp');
      const playbackIndex = header.indexOf('playback_time_seconds');
      if (ocrIndex >= 0 && playbackIndex >= 0 && firstRow[ocrIndex] && firstRow[playbackIndex]) {
        const ocrTime = firstRow[ocrIndex];
        const playbackTime = parseFloat(firstRow[playbackIndex]) || 0;
        // Calculate start time: ocr_time - playback_time
        const ocrSeconds = parseTimestampToSeconds(ocrTime);
        if (ocrSeconds !== null) {
          const startSeconds = ocrSeconds - playbackTime;
          metadata.videoStartTime = formatSecondsToTimestamp(startSeconds);
        }
      }
    }
  }

  // Find index of playback_time_seconds
  const playbackTimeIndex = header.indexOf('playback_time_seconds');
  const clickXIndex = header.indexOf('click_x');
  const clickYIndex = header.indexOf('click_y');

  // Get config fields
  const configFields = state.config ? state.config.steps.map(s => s.step_id) : [];

  // Parse entries (skip first row which is header)
  const entries = [];
  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(',').map(v => v.replace(/^"|"$/g, '').trim());
    if (values.length < header.length) continue;

    const entry = {
      entryId: `csv_entry_${i}_${Date.now()}`,
      playback_time_seconds: parseFloat(values[playbackTimeIndex]) || 0,
      click_x: parseFloat(values[clickXIndex]) || 0,
      click_y: parseFloat(values[clickYIndex]) || 0,
      ocr_timestamp: values[header.indexOf('ocr_timestamp')] || ''
    };

    // Add config field values
    configFields.forEach(fieldId => {
      const fieldIndex = header.indexOf(fieldId);
      if (fieldIndex >= 0) {
        entry[fieldId] = values[fieldIndex] || '';
      }
    });

    entries.push(entry);
  }

  return { entries, header, metadata };
}

// ============================================================================
// VIDEO INITIALIZATION
// ============================================================================

function initializeVideo() {
  state.videoElement = elements.videoPlayer;
  state.videoContainer = elements.videoContainer;

  if (!state.videoElement) {
    log('Video player element not found');
    return;
  }
  
  // Ensure eventListeners is initialized
  if (!state.eventListeners) {
    state.eventListeners = {
      keydown: null,
      videoClick: null,
      shortcutsClick: null,
      timeupdate: null,
      loadedmetadata: null,
      seeked: null,
      pause: null
    };
  }

  // Set video source - URL for streaming, file path for local files
  if (state.isStreaming && state.videoUrl) {
    state.videoElement.src = state.videoUrl;
  } else {
    state.videoElement.src = state.videoPath;
  }

  // Prevent autoplay - critical requirement
  state.videoElement.autoplay = false;
  state.videoElement.playsInline = true;
  
  // CRITICAL: Call load() to actually start loading the video metadata
  // Without this, readyState never reaches 2 and space key won't work
  state.videoElement.load();

  // Add pause event listener to check for download replacement (only once)
  // Remove existing listener if any
  if (state.eventListeners && state.eventListeners.pause) {
    state.videoElement.removeEventListener('pause', state.eventListeners.pause);
  }
  if (!state.eventListeners) {
    state.eventListeners = {
      keydown: null,
      videoClick: null,
      shortcutsClick: null,
      timeupdate: null,
      loadedmetadata: null,
      seeked: null,
      pause: null
    };
  }
  state.eventListeners.pause = checkAndOfferDownloadReplacement;
  state.videoElement.addEventListener('pause', state.eventListeners.pause);

  // Show instruction message
  if (elements.instructionMessage) {
    elements.instructionMessage.classList.remove('hidden');
  }

  // Remove existing listeners if any
  if (state.eventListeners.loadedmetadata) {
    state.videoElement.removeEventListener('loadedmetadata', state.eventListeners.loadedmetadata);
  }
  if (state.eventListeners.timeupdate) {
    state.videoElement.removeEventListener('timeupdate', state.eventListeners.timeupdate);
  }
  if (state.eventListeners.seeked) {
    state.videoElement.removeEventListener('seeked', state.eventListeners.seeked);
  }
  
  state.eventListeners.loadedmetadata = () => {
    // Wait for next frame to ensure layout is complete
    requestAnimationFrame(() => {
      if (!state.videoElement) return;
      
      // Don't set currentTime to 1.0 if we're restoring a session with a saved position
      // The session restore handler will set the correct position
      if (state.savedVideoPosition > 0) {
        // Session restore will handle positioning, just initialize overlays
        initializeOverlays();
        return;
      }
      
      // Set video to pause at 1 second (only for new sessions)
      state.videoElement.currentTime = 1.0;
      state.videoElement.pause();

      // Initialize all overlays
      initializeOverlays();
    });
  };
  
  state.videoElement.addEventListener('loadedmetadata', state.eventListeners.loadedmetadata);

  // Define timeupdate listener (outside loadedmetadata to avoid nesting)
  state.eventListeners.timeupdate = () => {
      updateVideoTimeDisplay();
      
      // Continuously redraw dots during playback (needed for recap mode)
      drawRedDots();

      // Check if we've reached the recap end time (latest entry time)
      if (state.isRewinding && state.recapEndTime !== null) {
        const currentTime = state.videoElement.currentTime;
        
        // Use recap manager if available
        if (recapManager) {
          if (recapManager.checkRecapProgress(currentTime)) {
            state.videoElement.pause();
            recapManager.completeRecap(currentTime);
            drawRedDots();
          }
        } else {
          // Inline implementation
          const latestEntry = state.masterLog.reduce((latest, entry) => {
            if (!entry || entry.playback_time_seconds === undefined) return latest;
            const entryTime = parseFloat(entry.playback_time_seconds);
            if (isNaN(entryTime)) return latest;
            const latestTime = latest !== null ? parseFloat(latest.playback_time_seconds || latest) : null;
            return (latestTime === null || entryTime > latestTime) ? entry : latest;
          }, null);
          
          // Extract time from latest entry
          const latestEntryTime = latestEntry ? parseFloat(latestEntry.playback_time_seconds) : null;

          if (latestEntryTime && latestEntryTime > state.recapEndTime) {
            state.recapEndTime = latestEntryTime;
            log(`Recap extended - new latest entry at ${latestEntryTime.toFixed(2)}s`);
          }

          if (latestEntryTime && currentTime >= state.recapEndTime - 0.5) {
            state.videoElement.pause();
            const completedEntryTime = state.recapEndTime;
            state.recapEndTime = null;
            state.isRewinding = false;
            state.recapCompleted = true;

            for (const [entryId, dotInfo] of state.activeDots.entries()) {
              if (dotInfo.phase === 'rewind') {
                state.activeDots.delete(entryId);
                if (state.dotTimeouts.has(entryId)) {
                  clearTimeout(state.dotTimeouts.get(entryId));
                  state.dotTimeouts.delete(entryId);
                }
              }
            }
            drawRedDots();
            log(`Recap completed - reached latest entry time at ${completedEntryTime.toFixed(2)}s (current: ${currentTime.toFixed(2)}s). Press SPACE to continue making entries.`);
          }
        }
      }

      // Legacy: Check if we've reached the rewind start point (for backward compatibility)
      if (state.isRewinding && state.rewindStartTime !== null && state.recapEndTime === null) {
        const currentTime = state.videoElement.currentTime;
        // If we've passed the rewind start time, pause and exit rewind mode
        if (currentTime >= state.rewindStartTime) {
          state.videoElement.pause();
          state.isRewinding = false;
          state.rewindStartTime = null;
          // Clear all rewind dots
          for (const [entryId, dotInfo] of state.activeDots.entries()) {
            if (dotInfo.phase === 'rewind') {
              state.activeDots.delete(entryId);
              if (state.dotTimeouts.has(entryId)) {
                clearTimeout(state.dotTimeouts.get(entryId));
                state.dotTimeouts.delete(entryId);
              }
            }
          }
          drawRedDots();
        }
      }
    };
    
  // Add timeupdate listener (outside loadedmetadata callback)
  state.videoElement.addEventListener('timeupdate', state.eventListeners.timeupdate);

  state.eventListeners.seeked = () => {
    updateVideoTimeDisplay();
  };
  
  state.videoElement.addEventListener('seeked', state.eventListeners.seeked);

  // Use animation frame for smooth updates (redundant with timeupdate, but kept for smoothness)
  // Note: drawRedDots() is also called from timeupdate event, so this provides additional smoothness
  let animationFrameId = null;
  let isAnimationRunning = false;
  
  function animateDots() {
    if (state.videoElement && elements.canvasOverlay) {
      drawRedDots();
      animationFrameId = requestAnimationFrame(animateDots);
      isAnimationRunning = true;
    } else {
      // Stop animation if video or canvas is removed
      isAnimationRunning = false;
      if (animationFrameId !== null) {
        cancelAnimationFrame(animationFrameId);
        animationFrameId = null;
      }
    }
  }
  
  // Start animation loop
  animateDots();
  
  // Cleanup on video unload
  state.videoElement.addEventListener('abort', () => {
    if (animationFrameId !== null) {
      cancelAnimationFrame(animationFrameId);
      animationFrameId = null;
      isAnimationRunning = false;
    }
  });

  // Also handle resize after video loads
  state.videoElement.addEventListener('loadeddata', () => {
    requestAnimationFrame(() => {
      updateAllOverlays();
    });
  });

  // Ensure video doesn't autoplay on any event (except during recap or user-initiated play)
  state.videoElement.addEventListener('play', () => {
    // Don't interfere with recap mode
    if (state.isRewinding && state.recapEndTime !== null) {
      return;
    }
    // Don't interfere if space has been pressed (user-initiated play)
    if (state.spacePressed) {
      return; // Allow playback when user pressed space
    }
    // Don't interfere in audit mode (allow playback)
    if (state.mode === 'audit') {
      return; // Allow playback in audit mode
    }
    // Only prevent autoplay if space hasn't been pressed and video is at start
    if (state.videoElement.currentTime < 1.5) {
      state.videoElement.pause();
      state.videoElement.currentTime = 1.0;
    }
  });
}

// ============================================================================
// OVERLAY INITIALIZATION
// ============================================================================

function initializeOverlays() {

  // Initialize canvas overlay
  initializeCanvasOverlay();

  // Initialize direction indicators
  initializeDirectionIndicators();

  // Initialize video time display
  updateVideoTimeDisplay();
}

function updateAllOverlays() {

  if (elements.canvasOverlay && state.videoElement) {
    const canvas = elements.canvasOverlay;
    const video = state.videoElement;
    const videoRect = video.getBoundingClientRect();
    const containerRect = state.videoContainer.getBoundingClientRect();

    if (videoRect.width > 0 && videoRect.height > 0) {
      const videoOffsetX = videoRect.left - containerRect.left;
      const videoOffsetY = videoRect.top - containerRect.top;

      canvas.width = videoRect.width;
      canvas.height = videoRect.height;
      canvas.style.width = videoRect.width + 'px';
      canvas.style.height = videoRect.height + 'px';
      canvas.style.left = videoOffsetX + 'px';
      canvas.style.top = videoOffsetY + 'px';
      drawRedDots();
    }
  }

  updateDirectionIndicators();
  updateVideoTimeDisplay();
}

// ============================================================================
// TIMESTAMP SELECTOR (REMOVED - No longer needed without OCR)
// ============================================================================

function initializeTimestampSelector() {
  // OCR and timestamp selector removed - function kept for compatibility but does nothing
  return;
}

function updateTimestampSelectorPosition() {
  // OCR and timestamp selector removed - function kept for compatibility but does nothing
  return;
}

function saveTimestampRegion() {
  // OCR and timestamp selector removed - function kept for compatibility but does nothing
  return;
}

// ============================================================================
// CANVAS OVERLAY (DOT SYSTEM)
// ============================================================================

function initializeCanvasOverlay() {
  const canvas = elements.canvasOverlay;
  const video = state.videoElement;

  if (!video || !canvas) return;

  let canvasRetryCount = 0;
  const MAX_CANVAS_RETRIES = 50; // Max 5 seconds (50 * 100ms)

  function updateCanvasSize() {
    if (!video || !canvas) return;

    const videoRect = video.getBoundingClientRect();
    const containerRect = state.videoContainer.getBoundingClientRect();

    if (videoRect.width === 0 || videoRect.height === 0) {
      // Video not ready yet, retry with limit
      if (canvasRetryCount < MAX_CANVAS_RETRIES) {
        canvasRetryCount++;
        setTimeout(updateCanvasSize, 100);
      } else {
        log('Warning: Canvas overlay initialization timeout - video dimensions not available');
      }
      return;
    }

    // Reset retry count on success
    canvasRetryCount = 0;

    const videoOffsetX = videoRect.left - containerRect.left;
    const videoOffsetY = videoRect.top - containerRect.top;

    canvas.width = videoRect.width;
    canvas.height = videoRect.height;
    canvas.style.width = videoRect.width + 'px';
    canvas.style.height = videoRect.height + 'px';
    canvas.style.left = videoOffsetX + 'px';
    canvas.style.top = videoOffsetY + 'px';

    drawRedDots();
  }

  updateCanvasSize();

  // Use ResizeObserver for better performance
  if (window.ResizeObserver && video) {
    const resizeObserver = new ResizeObserver(debounce(() => {
      updateCanvasSize();
    }, 150));
    resizeObserver.observe(video);
    resizeObserver.observe(state.videoContainer);
  } else {
    window.addEventListener('resize', debounce(() => {
      updateCanvasSize();
    }, 150));
  }
}

function drawRedDots() {
  const canvas = elements.canvasOverlay;
  if (!canvas) return;
  
  const ctx = canvas.getContext('2d');
  const video = state.videoElement;
  
  if (!video || !ctx || !video.videoWidth || !video.videoHeight) return;

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const videoRect = video.getBoundingClientRect();
  if (!videoRect.width || !videoRect.height) return;
  
  const scaleX = videoRect.width / video.videoWidth;
  const scaleY = videoRect.height / video.videoHeight;
  
  // Validate scale values
  if (!isFinite(scaleX) || !isFinite(scaleY) || scaleX <= 0 || scaleY <= 0) return;
  
  const currentTime = video.currentTime;
  if (!isFinite(currentTime) || currentTime < 0) return;
  
  const now = Date.now();

  // Draw active dots
  state.activeDots.forEach((dotInfo, entryId) => {
    const elapsed = (now - dotInfo.startTime) / 1000;

    // Find entry
    let entry = state.currentEntry?.entryId === entryId ? state.currentEntry : null;
    if (!entry) {
      entry = state.masterLog.find(e => e.entryId === entryId);
    }

    if (!entry) {
      // Entry not found, remove dot
      state.activeDots.delete(entryId);
      return;
    }

    const x = entry.click_x * scaleX;
    const y = entry.click_y * scaleY;
    let dotColor = dotInfo.color;
    let opacity = 1;

    // Handle rewind dots (orange->green->red sequence)
    if (dotInfo.phase === 'rewind' && entry.playback_time_seconds !== undefined) {
      const entryTime = entry.playback_time_seconds;
      const timeDiff = currentTime - entryTime;

      // During recap, show dots for entries that are in the future or very recent
      // Orange 0.75s before entry time
      if (timeDiff >= -0.75 && timeDiff < 0) {
        dotColor = 'orange';
        // Highlight entry in log when orange dot appears (streaming mode)
        if (state.isRewinding || state.mode === 'audit') {
          highlightEntryInLog(entryId, false);
        }
      }
      // Green at entry time
      else if (timeDiff >= 0 && timeDiff < 0.1) {
        dotColor = 'green';
        // Highlight entry in log when dot turns green (active mode)
        if (state.isRewinding || state.mode === 'audit') {
          highlightEntryInLog(entryId, true);
        }
      }
      // Red right after entry time
      else if (timeDiff >= 0.1) {
        dotColor = 'red';
        
        // Keep highlighting for a bit after entry, then fade out
        if (timeDiff < 0.5 && (state.isRewinding || state.mode === 'audit')) {
          highlightEntryInLog(entryId, false); // Streaming mode
        } else if (timeDiff >= 0.5 && (state.isRewinding || state.mode === 'audit')) {
          // Clear highlight after 0.5s
          const entryElement = elements.logsContent?.querySelector(`[data-entry-id="${entryId}"]`);
          if (entryElement) {
            entryElement.classList.remove('active', 'streaming');
          }
        }

        // Total duration: 0.75s before + 1.75s after = 2.5s total
        // After 0.1s red phase, fade out over remaining 1.65s
        const redElapsed = timeDiff - 0.1;
        if (redElapsed >= 1.75) {
          // Remove dot after 1.75s of red phase
          state.activeDots.delete(entryId);
          if (state.dotTimeouts.has(entryId)) {
            clearTimeout(state.dotTimeouts.get(entryId));
            state.dotTimeouts.delete(entryId);
          }
          // Clear log highlight when dot is removed
          if (state.isRewinding || state.mode === 'audit') {
            const entryElement = elements.logsContent?.querySelector(`[data-entry-id="${entryId}"]`);
            if (entryElement) {
              entryElement.classList.remove('active', 'streaming');
            }
          }
          return;
        }
        // Fade out in last 0.3 seconds
        if (redElapsed > 1.45) {
          opacity = 1 - ((redElapsed - 1.45) / 0.3);
        }
      } else {
        // Before -0.75s - entry is more than 0.75 seconds in the future
        // During recap, only show a very small preview (2 seconds max) with reduced opacity
        // This prevents all dots from appearing at once
        if (state.isRewinding && state.recapEndTime !== null && timeDiff < -0.75) {
          const timeUntilEntry = Math.abs(timeDiff);
          const maxPreviewTime = 2; // Only show entries up to 2 seconds in the future (reduced from 10s)
          if (timeUntilEntry <= maxPreviewTime) {
            dotColor = 'orange';
            // Fade in as we approach: full opacity at 0.75s before, 0.2 opacity at 2s before
            opacity = Math.max(0.2, 1 - ((timeUntilEntry - 0.75) / (maxPreviewTime - 0.75)) * 0.8);
          } else {
            // Too far in the future, don't show
            return;
          }
        } else {
          // Not in recap mode, or entry is too far in the future, don't show
          return;
        }
      }
    }
    // Handle new entry dots (green->red)
    else if (dotInfo.phase === 'waiting') {
      // Green dot while waiting for choices
      dotColor = 'green';
    }
    else if (dotInfo.phase === 'finalized') {
      // Red dot after choices finalized
      dotColor = 'red';

      // Fade out after 1.75 seconds
      if (elapsed >= 1.75) {
        state.activeDots.delete(entryId);
        if (state.dotTimeouts.has(entryId)) {
          clearTimeout(state.dotTimeouts.get(entryId));
          state.dotTimeouts.delete(entryId);
        }
        return;
      }
      // Fade out in last 0.3 seconds
      if (elapsed > 1.45) {
        opacity = 1 - ((elapsed - 1.45) / 0.3);
      }
    }
    // Handle undo dots (orange)
    else if (dotInfo.phase === 'undo') {
      dotColor = 'orange';
      // Will be removed when user clicks
    }

    // Draw dot with appropriate color and opacity
    ctx.save();
    ctx.globalAlpha = opacity;

    if (dotColor === 'green') {
      ctx.fillStyle = '#00ff00';
    } else if (dotColor === 'orange') {
      ctx.fillStyle = '#ff8800';
    } else if (dotColor === 'red') {
      ctx.fillStyle = '#ff0000';
    }

    ctx.beginPath();
    ctx.arc(x, y, 8, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = 'white';
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.restore();
  });

  // During rewind/recap mode, show dots for all existing entries
  if (state.isRewinding) {
    const recapStartTime = state.recapEndTime !== null ? state.recapEndTime : null;

    state.masterLog.forEach(entry => {
      if (!entry || entry.playback_time_seconds === undefined) return;

      const entryTime = entry.playback_time_seconds;

      // If recap is active, only show entries up to latest entry time
      if (recapStartTime !== null && entryTime > recapStartTime) {
        // Entry is after latest entry time, don't show it during recap
        const existingDot = state.activeDots.get(entry.entryId);
        if (existingDot && existingDot.phase === 'rewind') {
          state.activeDots.delete(entry.entryId);
        }
        return;
      }

      const timeDiff = currentTime - entryTime;

      // During recap, we want to show entries that are:
      // 1. In the future (entryTime > currentTime) - will appear when we get close
      // 2. In the past but within 1.85s (for recent entries)
      // 3. Always add entries that are in the future during recap, even if far away
      //    They will be drawn when we get within 0.75s (handled in drawing logic)

      // During recap, add ALL entries that are in the future (up to recapEndTime) to activeDots
      // This ensures they appear as the video plays forward
      // Also include entries that are very close to current time (within 2 seconds in either direction)
      if (timeDiff < 0) {
        // Entry is in the future - add it to activeDots (will be drawn when timeDiff >= -10s for preview, or -0.75s for full)
        // Don't override waiting/finalized/undo dots (temporary dots take priority)
        if (!state.activeDots.has(entry.entryId)) {
          state.activeDots.set(entry.entryId, {
            color: 'orange',
            startTime: now,
            phase: 'rewind',
            entryTime: entryTime
          });
        } else {
          // Update existing dot to ensure it has the correct phase and entryTime
          const existingDot = state.activeDots.get(entry.entryId);
          // Only override if it's not a temporary dot (waiting/finalized/undo)
          if (existingDot.phase !== 'waiting' &&
              existingDot.phase !== 'finalized' &&
              existingDot.phase !== 'undo') {
            // Update to ensure entryTime is correct
            state.activeDots.set(entry.entryId, {
              color: 'orange',
              startTime: existingDot.startTime || now, // Keep original startTime
              phase: 'rewind',
              entryTime: entryTime
            });
          }
        }
      } else if (timeDiff >= 0 && timeDiff < 1.85) {
        // Entry is in the past but within 1.85s window - show it
        // Don't override waiting/finalized dots (they take priority)
        const existingDot = state.activeDots.get(entry.entryId);
        if (!existingDot || (existingDot.phase !== 'waiting' && existingDot.phase !== 'finalized')) {
          if (!state.activeDots.has(entry.entryId)) {
            state.activeDots.set(entry.entryId, {
              color: 'orange',
              startTime: now,
              phase: 'rewind',
              entryTime: entryTime
            });
          }
        }
      } else if (timeDiff >= 1.85) {
        // Entry is more than 1.85s in the past - remove dot (unless it's a temporary dot)
        const existingDot = state.activeDots.get(entry.entryId);
        if (existingDot && existingDot.phase === 'rewind') {
          state.activeDots.delete(entry.entryId);
        }
      }
    });
  }
}

function getCurrentCorrectedTime() {
  if (!state.videoElement) return 0;
  const playbackTime = state.videoElement.currentTime;

  // Map playback time to actual footage time using videoStartTime from setup
  // If videoStartTime is set (e.g., 7:00:00 AM = 25200 seconds),
  // then when playback is at 00:00:00, actual footage time = videoStartTime
  const videoStartSeconds = state.setupData.videoStartTime || 0;
  const actualFootageTime = videoStartSeconds + playbackTime;

  // No OCR drift correction needed - we trust the user-provided start time
  return actualFootageTime;
}

function getEntryCorrectedTime(entry) {
  return getCorrectedPlaybackTime(entry);
}

// Helper function to format seconds back to timestamp string
// Always outputs 24-hour format: HH:MM:SS
function formatSecondsToTimestamp(seconds, referenceFormat) {
  if (seconds === null || seconds === undefined || isNaN(seconds)) return 'N/A';

  // Handle negative seconds (if drift is large negative)
  if (seconds < 0) {
    seconds = seconds + (24 * 60 * 60); // Add 24 hours
  }

  // Handle seconds >= 24 hours (wrap around)
  if (seconds >= 24 * 60 * 60) {
    seconds = seconds % (24 * 60 * 60);
  }

  const date = new Date();
  date.setHours(0, 0, 0, 0); // Start of day
  date.setSeconds(date.getSeconds() + Math.floor(seconds));

  const hours = date.getHours();
  const minutes = date.getMinutes();
  const secs = date.getSeconds();

  // Always return 24-hour format: HH:MM:SS
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function parseTimestampToSeconds(timestampStr) {
  if (!timestampStr) return null;

  // Parse formats like "2025-05-14 7:00:20 AM" or "7:00:20 AM" or "19:30:45"
  // Also handles incomplete formats like "2025-05-14 7:00" (no seconds)

  // Pattern 1: Full date + time with AM/PM: "2025-05-14 7:00:20 AM"
  let match = timestampStr.match(/(\d{4})[:\/-](\d{2})[:\/-](\d{2})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?/i);
  if (match) {
    let hour = parseInt(match[4], 10);
    const minute = parseInt(match[5], 10);
    const second = parseInt(match[6] || '0', 10);
    const ampm = (match[7] || '').toUpperCase();

    if (ampm === 'PM' && hour !== 12) hour += 12;
    if (ampm === 'AM' && hour === 12) hour = 0;

    return hour * 3600 + minute * 60 + second;
  }

  // Pattern 2: Time only with AM/PM: "7:00:20 AM"
  match = timestampStr.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)/i);
  if (match) {
    let hour = parseInt(match[1], 10);
    const minute = parseInt(match[2], 10);
    const second = parseInt(match[3] || '0', 10);
    const ampm = match[4].toUpperCase();

    if (ampm === 'PM' && hour !== 12) hour += 12;
    if (ampm === 'AM' && hour === 12) hour = 0;

    return hour * 3600 + minute * 60 + second;
  }

  // Pattern 3: 24-hour format: "19:30:45" or "19:30"
  match = timestampStr.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (match) {
    const hour = parseInt(match[1], 10);
    const minute = parseInt(match[2], 10);
    const second = parseInt(match[3] || '0', 10);

    return hour * 3600 + minute * 60 + second;
  }

  return null;
}

// Function to get corrected playback time using setup start time
function getCorrectedPlaybackTime(entry) {
  if (!entry.playback_time_seconds) {
    return 0;
  }

  // Use setup start time to calculate actual footage time
  const videoStartSeconds = state.setupData.videoStartTime || 0;
  const actualFootageTime = videoStartSeconds + entry.playback_time_seconds;

  return actualFootageTime;
}

// ============================================================================
// DIRECTION INDICATORS
// ============================================================================

function initializeDirectionIndicators() {
  const indicators = {
    north: elements.dirN,
    south: elements.dirS,
    east: elements.dirE,
    west: elements.dirW
  };

  const video = state.videoElement;
  const videoRect = video.getBoundingClientRect();
  const containerRect = state.videoContainer.getBoundingClientRect();
  const videoOffsetX = videoRect.left - containerRect.left;
  const videoOffsetY = videoRect.top - containerRect.top;

  // Default positions
  const defaults = {
    north: { x: videoOffsetX + videoRect.width / 2, y: videoOffsetY + 20 },
    south: { x: videoOffsetX + videoRect.width / 2, y: videoOffsetY + videoRect.height - 50 },
    east: { x: videoOffsetX + videoRect.width - 50, y: videoOffsetY + videoRect.height / 2 },
    west: { x: videoOffsetX + 20, y: videoOffsetY + videoRect.height / 2 }
  };

  // Load saved positions
  const savedPositions = loadDirectionIndicators();

  Object.keys(indicators).forEach(direction => {
    const indicator = indicators[direction];
    let pos = savedPositions[direction] || defaults[direction];

    // Scale position if video dimensions changed
    if (savedPositions.videoWidth && savedPositions.videoHeight) {
      const scaleX = videoRect.width / savedPositions.videoWidth;
      const scaleY = videoRect.height / savedPositions.videoHeight;
      pos = {
        x: videoOffsetX + (pos.x - videoOffsetX) * scaleX,
        y: videoOffsetY + (pos.y - videoOffsetY) * scaleY
      };
    }

    // Constrain to video bounds
    const indicatorRect = indicator.getBoundingClientRect();
    pos.x = Math.max(videoOffsetX, Math.min(pos.x, videoOffsetX + videoRect.width - indicatorRect.width));
    pos.y = Math.max(videoOffsetY, Math.min(pos.y, videoOffsetY + videoRect.height - indicatorRect.height));

    indicator.style.left = pos.x + 'px';
    indicator.style.top = pos.y + 'px';

    // Make draggable
    makeIndicatorDraggable(indicator, direction);
  });

  // Use ResizeObserver for direction indicators
  if (window.ResizeObserver && video) {
    const resizeObserver = new ResizeObserver(debounce(() => {
      updateDirectionIndicators();
    }, 150));
    resizeObserver.observe(video);
    resizeObserver.observe(state.videoContainer);
  } else {
    window.addEventListener('resize', debounce(() => {
      updateDirectionIndicators();
    }, 150));
  }
}

function makeIndicatorDraggable(indicator, direction) {
  let isDragging = false;
  let dragOffset = { x: 0, y: 0 };

  indicator.addEventListener('mousedown', (e) => {
    isDragging = true;
    const rect = indicator.getBoundingClientRect();
    const containerRect = state.videoContainer.getBoundingClientRect();
    dragOffset.x = e.clientX - rect.left;
    dragOffset.y = e.clientY - rect.top;
    indicator.classList.add('dragging');
    e.preventDefault();
  });

  document.addEventListener('mousemove', (e) => {
    if (!isDragging) return;

    const video = state.videoElement;
    const videoRect = video.getBoundingClientRect();
    const containerRect = state.videoContainer.getBoundingClientRect();
    const videoOffsetX = videoRect.left - containerRect.left;
    const videoOffsetY = videoRect.top - containerRect.top;
    const indicatorRect = indicator.getBoundingClientRect();

    let newX = e.clientX - containerRect.left - dragOffset.x;
    let newY = e.clientY - containerRect.top - dragOffset.y;

    // Constrain to video bounds
    newX = Math.max(videoOffsetX, Math.min(newX, videoOffsetX + videoRect.width - indicatorRect.width));
    newY = Math.max(videoOffsetY, Math.min(newY, videoOffsetY + videoRect.height - indicatorRect.height));

    indicator.style.left = newX + 'px';
    indicator.style.top = newY + 'px';
  });

  document.addEventListener('mouseup', () => {
    if (isDragging) {
      isDragging = false;
      indicator.classList.remove('dragging');
      saveDirectionIndicators();
    }
  });
}

function updateDirectionIndicators() {
  const indicators = [elements.dirN, elements.dirS, elements.dirE, elements.dirW];
  const video = state.videoElement;
  const videoRect = video.getBoundingClientRect();
  const containerRect = state.videoContainer.getBoundingClientRect();
  const videoOffsetX = videoRect.left - containerRect.left;
  const videoOffsetY = videoRect.top - containerRect.top;

  indicators.forEach(indicator => {
    const rect = indicator.getBoundingClientRect();
    let x = rect.left - containerRect.left;
    let y = rect.top - containerRect.top;

    // Constrain to bounds
    x = Math.max(videoOffsetX, Math.min(x, videoOffsetX + videoRect.width - rect.width));
    y = Math.max(videoOffsetY, Math.min(y, videoOffsetY + videoRect.height - rect.height));

    indicator.style.left = x + 'px';
    indicator.style.top = y + 'px';
  });
}

function saveDirectionIndicators() {
  const video = state.videoElement;
  const videoRect = video.getBoundingClientRect();
  const containerRect = state.videoContainer.getBoundingClientRect();
  const videoOffsetX = videoRect.left - containerRect.left;
  const videoOffsetY = videoRect.top - containerRect.top;

  const positions = {
    videoWidth: videoRect.width,
    videoHeight: videoRect.height,
    north: {
      x: parseFloat(elements.dirN.style.left),
      y: parseFloat(elements.dirN.style.top)
    },
    south: {
      x: parseFloat(elements.dirS.style.left),
      y: parseFloat(elements.dirS.style.top)
    },
    east: {
      x: parseFloat(elements.dirE.style.left),
      y: parseFloat(elements.dirE.style.top)
    },
    west: {
      x: parseFloat(elements.dirW.style.left),
      y: parseFloat(elements.dirW.style.top)
    }
  };

  localStorage.setItem('directionIndicators', JSON.stringify(positions));
}

function loadDirectionIndicators() {
  const saved = localStorage.getItem('directionIndicators');
  if (saved) {
    try {
      return JSON.parse(saved);
    } catch (e) {
      return {};
    }
  }
  return {};
}

// ============================================================================
// VIDEO CLICK HANDLING & ENTRY CREATION
// ============================================================================

function initializeCounting() {
  // Ensure eventListeners is initialized
  if (!state.eventListeners) {
    state.eventListeners = {
      keydown: null,
      videoClick: null,
      shortcutsClick: null,
      timeupdate: null,
      loadedmetadata: null,
      seeked: null,
      pause: null
    };
  }
  
  // Close button handler
  if (elements.closeVideoBtn) {
    elements.closeVideoBtn.addEventListener('click', () => {
      showCloseConfirmationDialog();
    });
  }

  // Space key handling - only on counting screen
  // Remove existing listener if any
  if (state.eventListeners.keydown) {
    document.removeEventListener('keydown', state.eventListeners.keydown);
  }
  
  state.eventListeners.keydown = (e) => {
    // Don't capture keys on setup screen (allow normal text input)
    // Check both display style and counting screen active state
    const isSetupScreenVisible = elements.setupScreen && 
      (elements.setupScreen.style.display !== 'none' && 
       !elements.countingScreen.classList.contains('active'));
    
    if (isSetupScreenVisible) {
      // Only prevent default for shortcuts that shouldn't work on setup screen
      if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'e')) {
        e.preventDefault();
      }
      return;
    }
    
    if (e.code === 'Space' && !state.spacePressed) {
      e.preventDefault();

      // Make sure video is initialized
      if (!state.videoElement) {
        log('Video element not initialized yet');
        return;
      }

      state.spacePressed = true;

      // In audit mode, keep rewind mode enabled; in entry mode, exit recap/rewind
      if (state.mode !== 'audit') {
        state.isRewinding = false;
        state.recapEndTime = null;
        state.rewindStartTime = null;
      }

      if (elements.instructionMessage) {
        elements.instructionMessage.classList.add('hidden');
      }

      // Play video with error handling
      if (state.videoElement) {
        // Wait for video to be ready if not already
        if (state.videoElement.readyState >= 2) {
          state.videoElement.play().catch(err => {
            log(`Error playing video on first space press: ${err.message}`);
            showToast('Error playing video. Please check the video file.', 'error');
          });
          state.videoElement.playbackRate = state.playbackSpeed;
          enableVideoClicks();
        } else {
          // Video not ready yet - wait for it to load
          log(`Video not ready when space pressed (readyState: ${state.videoElement.readyState}), waiting for metadata...`);
          
          // Check if video source is set, if not set it and call load()
          if (!state.videoElement.src || state.videoElement.src === '') {
            log('Video source not set, attempting to set it...');
            if (state.isStreaming && state.videoUrl) {
              state.videoElement.src = state.videoUrl;
              state.videoElement.load();
            } else if (state.videoPath) {
              state.videoElement.src = state.videoPath;
              state.videoElement.load();
            } else {
              log('No video source available');
              showToast('Video source not available. Please load a video.', 'error');
              return;
            }
          }
          
          let waitCount = 0;
          const MAX_WAIT_COUNT = 100; // Max 10 seconds (100 * 100ms)
          
          const waitForReady = () => {
            waitCount++;
            if (state.videoElement && state.videoElement.readyState >= 2) {
              log(`Video ready after ${waitCount * 100}ms, starting playback`);
              state.videoElement.play().catch(err => {
                log(`Error playing video after waiting: ${err.message}`);
                showToast('Error playing video. Please check the video file.', 'error');
              });
              state.videoElement.playbackRate = state.playbackSpeed;
              enableVideoClicks();
            } else if (state.videoElement && waitCount < MAX_WAIT_COUNT) {
              // Wait a bit more
              setTimeout(waitForReady, 100);
            } else {
              log(`Video still not ready after ${waitCount * 100}ms (readyState: ${state.videoElement?.readyState || 'N/A'})`);
              showToast('Video is taking too long to load. Please check your connection or video file.', 'warning');
            }
          };
          // Also listen for loadedmetadata event as backup
          const onMetadataLoaded = () => {
            if (state.videoElement) {
              log('Video metadata loaded via event listener');
              state.videoElement.removeEventListener('loadedmetadata', onMetadataLoaded);
              if (state.spacePressed && state.videoElement.paused) {
                state.videoElement.play().catch(err => {
                  log(`Error playing video after metadata loaded: ${err.message}`);
                  showToast('Error playing video. Please check the video file.', 'error');
                });
                state.videoElement.playbackRate = state.playbackSpeed;
                enableVideoClicks();
              }
            }
          };
          state.videoElement.addEventListener('loadedmetadata', onMetadataLoaded, { once: true });
          waitForReady();
        }
      } else {
        log('Video element not found when space pressed');
        showToast('Video element not initialized. Please try again.', 'error');
      }
    } else if (e.code === 'Space' && state.spacePressed) {
      e.preventDefault();

      // Hide instruction message if still visible (can happen in audit mode)
      if (elements.instructionMessage && !elements.instructionMessage.classList.contains('hidden')) {
        elements.instructionMessage.classList.add('hidden');
      }

      // Check if recap has completed (paused at latest entry, waiting to exit)
      if (state.recapCompleted && !state.isRewinding && state.recapEndTime === null) {
        // Exit recap mode and resume normal playback
        if (recapManager) {
          recapManager.exitRecap();
        } else {
          state.recapCompleted = false;
          state.isRewinding = false;
          state.recapEndTime = null;
          state.rewindStartTime = null;
          for (const [entryId, dotInfo] of state.activeDots.entries()) {
            if (dotInfo.phase === 'rewind') {
              state.activeDots.delete(entryId);
              if (state.dotTimeouts.has(entryId)) {
                clearTimeout(state.dotTimeouts.get(entryId));
                state.dotTimeouts.delete(entryId);
              }
            }
          }
          log('Recap mode exited - continuing normal playback');
        }
        clearLogHighlights(); // Clear all highlights when exiting recap
        drawRedDots();
        state.videoElement.play();
        state.videoElement.playbackRate = state.playbackSpeed;
        return;
      }

      // If in recap mode (isRewinding and recapEndTime set), toggle play/pause
      if (state.isRewinding && state.recapEndTime !== null) {
        if (state.videoElement.paused) {
          const currentTime = state.videoElement.currentTime;
          if (recapManager && recapManager.shouldContinueRecap(currentTime)) {
            state.videoElement.play();
            state.videoElement.playbackRate = state.playbackSpeed;
            log(`Recap: Continuing playback from ${currentTime.toFixed(2)}s until ${state.recapEndTime.toFixed(2)}s`);
          } else if (currentTime < state.recapEndTime - 0.5) {
            state.videoElement.play();
            state.videoElement.playbackRate = state.playbackSpeed;
            log(`Recap: Continuing playback from ${currentTime.toFixed(2)}s until ${state.recapEndTime.toFixed(2)}s`);
          } else {
            state.recapCompleted = true;
            state.isRewinding = false;
            state.recapEndTime = null;
            log(`Recap: Already at latest entry time, marking as completed`);
          }
        } else {
          state.videoElement.pause();
        }
        return;
      }

      // Normal play/pause toggle (not in recap mode)
      // In audit mode, keep rewind mode enabled; in entry mode, exit recap/rewind only if not in recap
      if (state.mode !== 'audit' && !state.isRewinding) {
        state.isRewinding = false;
        state.recapEndTime = null;
        state.rewindStartTime = null;
        state.recapCompleted = false;
      }

      // Normal play/pause toggle - always work if video element exists
      if (state.videoElement) {
        // Check if video is ready, if not wait a bit
        if (state.videoElement.readyState >= 2) {
          if (state.videoElement.paused) {
            state.videoElement.play().catch(err => {
              log(`Error playing video: ${err.message}`);
            });
            state.videoElement.playbackRate = state.playbackSpeed;
          } else {
            state.videoElement.pause();
          }
        } else {
          // Video not ready yet, but user pressed space - try to load it
          log(`Video not ready when space pressed for pause/play (readyState: ${state.videoElement.readyState})`);
          if (!state.videoElement.src || state.videoElement.src === '') {
            // Set source if missing
            if (state.isStreaming && state.videoUrl) {
              state.videoElement.src = state.videoUrl;
              state.videoElement.load();
            } else if (state.videoPath) {
              state.videoElement.src = state.videoPath;
              state.videoElement.load();
            }
          }
          // Wait for metadata and then toggle
          const onMetadataLoaded = () => {
            state.videoElement.removeEventListener('loadedmetadata', onMetadataLoaded);
            if (state.videoElement.paused) {
              state.videoElement.play().catch(err => {
                log(`Error playing video after metadata loaded: ${err.message}`);
              });
              state.videoElement.playbackRate = state.playbackSpeed;
            } else {
              state.videoElement.pause();
            }
          };
          state.videoElement.addEventListener('loadedmetadata', onMetadataLoaded, { once: true });
        }
      }
    }

    // Arrow keys for speed control
    if (e.code === 'ArrowLeft') {
      e.preventDefault();
      decreaseSpeed();
    } else if (e.code === 'ArrowRight') {
      e.preventDefault();
      increaseSpeed();
    } else if (e.code === 'ArrowUp') {
      e.preventDefault();
      resetSpeed();
    } else if (e.code === 'ArrowDown') {
      e.preventDefault();
      state.videoElement.pause();
      resetSpeed();
    }

    // Minus key (-) for 60-second rewind and recap (works during recap too)
    if (e.code === 'Minus' && state.spacePressed) {
      e.preventDefault();
      // If in recap mode, rewind another 60 seconds from current position
      // Recap will always go until latest entry time regardless of how many times "-" is pressed
      startRecap();
    }

    // Undo (Ctrl+Z / Cmd+Z)
    if ((e.ctrlKey || e.metaKey) && e.code === 'KeyZ' && !e.shiftKey) {
      e.preventDefault();
      undoLastEntry();
    }
    
    // Redo (Ctrl+Shift+Z / Cmd+Shift+Z)
    if ((e.ctrlKey || e.metaKey) && e.code === 'KeyZ' && e.shiftKey) {
      e.preventDefault();
      redoLastEntry();
    }
  };
  
  document.addEventListener('keydown', state.eventListeners.keydown);

  // Export button
  elements.exportBtn.addEventListener('click', () => {
    exportToCSV();
  });

  // Restart counting button
  const restartBtn = document.getElementById('restart-counting-btn');
  if (restartBtn) {
    restartBtn.addEventListener('click', () => {
      if (confirm('Are you sure you want to restart counting from 0? All current entries will be cleared.')) {
        restartCounting();
      }
    });
  }

  // Initialize keyboard shortcuts
  initializeKeyboardShortcuts();
}

// ============================================================================
// SHORTCUTS PANEL
// ============================================================================

function initializeShortcuts() {
  if (elements.shortcutToggle && elements.shortcutsPanel) {
    elements.shortcutToggle.addEventListener('click', () => {
      elements.shortcutsPanel.classList.toggle('visible');
    });

    // Close on outside click
    // Remove existing listener if any
    if (state.eventListeners.shortcutsClick) {
      document.removeEventListener('click', state.eventListeners.shortcutsClick);
    }
    
    state.eventListeners.shortcutsClick = (e) => {
      if (elements.shortcutsPanel && elements.shortcutsPanel.classList.contains('visible')) {
        if (!elements.shortcutsPanel.contains(e.target) &&
            !elements.shortcutToggle.contains(e.target)) {
          elements.shortcutsPanel.classList.remove('visible');
        }
      }
    };
    
    document.addEventListener('click', state.eventListeners.shortcutsClick);
  }
}

function enableVideoClicks() {
  if (!state.videoElement) return;
  
  // Remove existing listener if any
  if (state.eventListeners.videoClick) {
    state.videoElement.removeEventListener('click', state.eventListeners.videoClick);
  }
  
  state.eventListeners.videoClick = handleVideoClick;
  state.videoElement.addEventListener('click', state.eventListeners.videoClick);
}

function disableVideoClicks() {
  if (state.videoElement && state.eventListeners.videoClick) {
    state.videoElement.removeEventListener('click', state.eventListeners.videoClick);
    state.eventListeners.videoClick = null;
  }
}

function handleVideoClick(e) {
  // Normal click - create new entry
  // Allow clicks if space has been pressed OR if we're in recap mode (to add missing entries)
  if (!state.spacePressed && !(state.isRewinding && state.recapEndTime !== null)) return;

  // Remove any undo dots (orange) when user clicks anywhere on the screen
  const undoDotsToRemove = [];
  for (const [entryId, dotInfo] of state.activeDots.entries()) {
    if (dotInfo.phase === 'undo') {
      undoDotsToRemove.push(entryId);
    }
  }
  undoDotsToRemove.forEach(entryId => {
    state.activeDots.delete(entryId);
    if (state.dotTimeouts.has(entryId)) {
      clearTimeout(state.dotTimeouts.get(entryId));
      state.dotTimeouts.delete(entryId);
    }
  });
  if (undoDotsToRemove.length > 0) {
    drawRedDots(); // Redraw to remove undo dots
  }

  // Pause video
  state.videoElement.pause();

  // Get click coordinates in native video dimensions
  const videoRect = state.videoElement.getBoundingClientRect();
  const containerRect = state.videoContainer.getBoundingClientRect();
  const videoOffsetX = videoRect.left - containerRect.left;
  const videoOffsetY = videoRect.top - containerRect.top;

  const clickX = e.clientX - containerRect.left - videoOffsetX;
  const clickY = e.clientY - containerRect.top - videoOffsetY;

  // Validate video dimensions
  if (!state.videoElement.videoWidth || !state.videoElement.videoHeight || 
      !videoRect.width || !videoRect.height) {
    log('Error: Video dimensions not available');
    return;
  }

  const scaleX = state.videoElement.videoWidth / videoRect.width;
  const scaleY = state.videoElement.videoHeight / videoRect.height;

  // Validate scale values
  if (!isFinite(scaleX) || !isFinite(scaleY) || scaleX <= 0 || scaleY <= 0) {
    log('Error: Invalid scale values for coordinate conversion');
    return;
  }

  const nativeX = clickX * scaleX;
  const nativeY = clickY * scaleY;

  // Validate coordinates
  if (!isFinite(nativeX) || !isFinite(nativeY)) {
    log('Error: Invalid native coordinates calculated');
    return;
  }

  // Create entry
  const entryId = `entry_${Date.now()}_${state.entryCounter++}`;
  const playbackTime = state.videoElement.currentTime;

  state.currentEntry = {
    entryId,
    playback_time_seconds: playbackTime,
    ocr_timestamp: '', // Will be calculated from startTime when finalized
    click_x: nativeX,
    click_y: nativeY
  };

  // Store click position in screen coordinates for modal positioning
  state.lastClickPosition = {
    x: e.clientX,
    y: e.clientY
  };

  // Show green dot immediately (waiting for choices)
  state.activeDots.set(entryId, {
    color: 'green',
    startTime: Date.now(),
    phase: 'waiting'
  });
  drawRedDots();

  // Show modal immediately
  showChoiceModal();
}

// ============================================================================
// TIMESTAMP CALCULATION
// ============================================================================

// ============================================================================
// CHOICE MODAL & STEP NAVIGATION
// ============================================================================

function showChoiceModal() {
  // Find the next valid step (that passes conditions)
  const nextStepIndex = findNextValidStepIndex(state.currentStepIndex);

  if (nextStepIndex === -1 || !state.config || nextStepIndex >= state.config.steps.length) {
    finalizeEntry();
    return;
  }

  // Update current step index to the valid step
  state.currentStepIndex = nextStepIndex;

  const step = state.config.steps[state.currentStepIndex];
  
  // Ensure elements exist
  if (!elements.modalQuestion || !elements.choiceButtons || !elements.choiceModal) {
    log('Modal elements not found:', {
      modalQuestion: !!elements.modalQuestion,
      choiceButtons: !!elements.choiceButtons,
      choiceModal: !!elements.choiceModal
    });
    return;
  }
  
  elements.modalQuestion.textContent = step.question || step.title || step.step_id;

  // Calculate total valid steps for progress
  // We need to simulate the full flow to count total steps
  let totalValidSteps = 0;
  let currentValidStep = 0;
  const simulatedEntry = { ...state.currentEntry };

  // Count total valid steps by simulating the flow
  for (let i = 0; i < state.config.steps.length; i++) {
    const step = state.config.steps[i];
    if (evaluateStepCondition(step, i, simulatedEntry)) {
      totalValidSteps++;
      // If we've reached this step, increment current step counter
      if (i <= state.currentStepIndex) {
        currentValidStep++;
        // Simulate selecting a value for this step to see subsequent steps
        if (!simulatedEntry[step.step_id] && i < state.currentStepIndex) {
          simulatedEntry[step.step_id] = 'simulated';
        }
      }
    }
  }

  elements.modalStepInfo.textContent = `Step ${currentValidStep} of ${totalValidSteps}`;

  // Update progress bar
  if (elements.modalProgressBar) {
    const progress = totalValidSteps > 0 ? (currentValidStep / totalValidSteps) * 100 : 0;
    elements.modalProgressBar.style.width = progress + '%';
  }

  // Add back button above progress bar (always show - cancel on first step, back on later steps)
  let backButtonContainer = document.getElementById('modal-back-button-container');
  if (!backButtonContainer) {
    backButtonContainer = document.createElement('div');
    backButtonContainer.id = 'modal-back-button-container';
    backButtonContainer.style.marginBottom = '1rem';
    // Insert before progress bar
    const progressBar = elements.modalProgressBar?.parentElement;
    if (progressBar) {
      progressBar.parentElement.insertBefore(backButtonContainer, progressBar);
    }
  }
  backButtonContainer.innerHTML = '';

  // Always show back button - cancel on first step, go back on later steps
  const backButton = document.createElement('button');
  backButton.className = 'choice-button';
  backButton.style.background = 'linear-gradient(135deg, #666 0%, #555 100%)';
  backButton.style.width = '100%';

  if (state.currentStepIndex === 0 || findPreviousValidStepIndex(state.currentStepIndex) === -1) {
    // First step: cancel button to deregister the click
    backButton.textContent = '✕ Cancel';
    backButton.addEventListener('click', () => {
      cancelCurrentEntry();
    });
  } else {
    // Later steps: back button to go to previous step
    backButton.textContent = '← Back';
    backButton.addEventListener('click', () => {
      goBackToPreviousStep();
    });
  }

  backButtonContainer.appendChild(backButton);

  elements.choiceButtons.innerHTML = '';

  // Check if this step uses text input or choices
  if (step.type === 'text') {
    // Render text input
    const inputContainer = document.createElement('div');
    inputContainer.style.width = '100%';
    inputContainer.style.marginBottom = '1rem';

    const textInput = document.createElement('input');
    textInput.type = 'text';
    textInput.className = 'text-input';
    textInput.placeholder = step.placeholder || 'Enter text...';
    textInput.style.width = '100%';
    textInput.style.padding = '1rem';
    textInput.style.fontSize = '1rem';
    textInput.style.border = '2px solid #444';
    textInput.style.borderRadius = '8px';
    textInput.style.background = '#222';
    textInput.style.color = '#fff';
    textInput.style.marginBottom = '1rem';

    // Pre-fill with existing value if going back
    if (state.currentEntry && state.currentEntry[step.step_id]) {
      textInput.value = state.currentEntry[step.step_id];
    }

    // Handle Enter key
    textInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && textInput.value.trim()) {
        handleChoiceSelection(textInput.value.trim(), step.step_id);
      }
    });

    // Auto-focus
    setTimeout(() => textInput.focus(), 100);

    inputContainer.appendChild(textInput);

    // Submit button
    const submitButton = document.createElement('button');
    submitButton.className = 'choice-button';
    submitButton.textContent = step.submitLabel || 'Submit';
    submitButton.style.width = '100%';
    submitButton.style.marginTop = '0.5rem';
    submitButton.disabled = !textInput.value.trim();

    // Update button state based on input
    textInput.addEventListener('input', () => {
      submitButton.disabled = !textInput.value.trim();
    });

    submitButton.addEventListener('click', () => {
      if (textInput.value.trim()) {
        handleChoiceSelection(textInput.value.trim(), step.step_id);
      }
    });

    inputContainer.appendChild(submitButton);
    elements.choiceButtons.appendChild(inputContainer);
  } else {
    // Render choice buttons (default behavior)
    if (step.choices && Array.isArray(step.choices) && step.choices.length > 0) {
      step.choices.forEach(choice => {
        const button = document.createElement('button');
        button.className = 'choice-button';
        button.textContent = choice.label || choice.value || choice;
        button.addEventListener('click', () => {
          handleChoiceSelection(choice.value || choice, step.step_id);
        });
        elements.choiceButtons.appendChild(button);
      });
    } else {
      log('Step has no choices:', step);
      // Show error message
      const errorMsg = document.createElement('div');
      errorMsg.textContent = 'No choices available for this step';
      errorMsg.style.color = '#ff6b6b';
      errorMsg.style.padding = '1rem';
      errorMsg.style.textAlign = 'center';
      elements.choiceButtons.appendChild(errorMsg);
    }
  }

  // Position modal near click position
  if (state.lastClickPosition && elements.choiceModal) {
    const modal = elements.choiceModal;
    const videoRect = state.videoElement.getBoundingClientRect();
    
    // Set position first (before showing to avoid flash)
    // Smaller offset - closer to click (avoid covering the dot which is ~10px radius)
    const offsetX = 25; // pixels to the right
    const offsetY = 25; // pixels down
    
    // Estimate modal size (will adjust after rendering if needed)
    const estimatedWidth = 320;
    const estimatedHeight = 300;
    
    // Calculate desired position
    let left = state.lastClickPosition.x + offsetX;
    let top = state.lastClickPosition.y + offsetY;
    
    // Ensure modal stays within video bounds (with padding)
    const padding = 10;
    const videoLeft = videoRect.left;
    const videoRight = videoRect.right;
    const videoTop = videoRect.top;
    const videoBottom = videoRect.bottom;
    
    // Adjust if too far right - try left side first
    if (left + estimatedWidth > videoRight - padding) {
      left = state.lastClickPosition.x - estimatedWidth - offsetX;
      // If still out of bounds, position at edge
      if (left < videoLeft + padding) {
        left = Math.max(videoLeft + padding, videoRight - estimatedWidth - padding);
      }
    }
    
    // Adjust if too far left
    if (left < videoLeft + padding) {
      left = videoLeft + padding;
    }
    
    // Adjust if too far down - try above first
    if (top + estimatedHeight > videoBottom - padding) {
      top = state.lastClickPosition.y - estimatedHeight - offsetY;
      // If still out of bounds, position at edge
      if (top < videoTop + padding) {
        top = Math.max(videoTop + padding, videoBottom - estimatedHeight - padding);
      }
    }
    
    // Adjust if too far up
    if (top < videoTop + padding) {
      top = videoTop + padding;
    }
    
    // Set position
    modal.style.left = left + 'px';
    modal.style.top = top + 'px';
    modal.style.transform = 'none'; // Remove center transform
    
    // Show modal
    modal.classList.add('active');
    
    // Fine-tune position after modal is visible and measured
    requestAnimationFrame(() => {
      const modalRect = modal.getBoundingClientRect();
      const actualWidth = modalRect.width;
      const actualHeight = modalRect.height;
      
      // Re-check bounds with actual size
      let adjustedLeft = parseFloat(modal.style.left);
      let adjustedTop = parseFloat(modal.style.top);
      
      if (adjustedLeft + actualWidth > videoRight - padding) {
        adjustedLeft = Math.max(videoLeft + padding, videoRight - actualWidth - padding);
        modal.style.left = adjustedLeft + 'px';
      }
      
      if (adjustedTop + actualHeight > videoBottom - padding) {
        adjustedTop = Math.max(videoTop + padding, videoBottom - actualHeight - padding);
        modal.style.top = adjustedTop + 'px';
      }
    });
  } else {
    // Fallback if no click position - center it
    if (elements.choiceModal) {
      elements.choiceModal.style.left = '50%';
      elements.choiceModal.style.top = '50%';
      elements.choiceModal.style.transform = 'translate(-50%, -50%)';
      elements.choiceModal.classList.add('active');
    }
  }
}

// Find the next valid step index that passes conditions
function findNextValidStepIndex(startIndex) {
  if (!state.config || !state.config.steps) return -1;

  for (let i = startIndex; i < state.config.steps.length; i++) {
    const step = state.config.steps[i];
    if (evaluateStepCondition(step, i, state.currentEntry)) {
      return i;
    }
  }
  return -1; // No more valid steps
}

// Find the previous valid step index
function findPreviousValidStepIndex(currentIndex) {
  if (!state.config || !state.config.steps || currentIndex <= 0) return -1;

  for (let i = currentIndex - 1; i >= 0; i--) {
    const step = state.config.steps[i];
    if (evaluateStepCondition(step, i, state.currentEntry)) {
      return i;
    }
  }
  return -1;
}

// Evaluate if a step's condition is met
function evaluateStepCondition(step, stepIndex, currentEntry) {
  // If no condition, step is always valid
  if (!step.condition) {
    return true;
  }

  // If condition exists but no entry data yet, evaluate based on previous steps
  if (!currentEntry) {
    return stepIndex === 0; // First step is always valid
  }

  // Evaluate condition
  // Condition format: { "step_id": "VehicleType", "value": "Pedestrian" }
  // or: { "step_id": "VehicleType", "operator": "in", "values": ["Pedestrian", "Bicycle"] }
  // or: { "step_id": "VehicleType", "operator": "!=", "value": "Bus" }

  if (step.condition.step_id && currentEntry[step.condition.step_id] !== undefined) {
    const previousValue = currentEntry[step.condition.step_id];
    const operator = step.condition.operator || '==';

    switch (operator) {
      case '==':
      case '=':
        return previousValue == step.condition.value;

      case '!=':
        return previousValue != step.condition.value;

      case 'in':
        if (Array.isArray(step.condition.values)) {
          return step.condition.values.includes(previousValue);
        }
        return false;

      case 'not in':
        if (Array.isArray(step.condition.values)) {
          return !step.condition.values.includes(previousValue);
        }
        return true;

      default:
        // Default to equality check
        return previousValue == step.condition.value;
    }
  }

  // If condition references a step that hasn't been answered yet, step is not valid
  return false;
}

function goBackToPreviousStep() {
  if (!state.currentEntry || state.currentStepIndex === 0) return;

  // Find the previous valid step
  const previousValidIndex = findPreviousValidStepIndex(state.currentStepIndex);

  if (previousValidIndex === -1) {
    // No previous valid step, cancel entry
    cancelCurrentEntry();
    return;
  }

  // Remove all choices from current step onwards
  const currentStep = state.config.steps[state.currentStepIndex];
  if (currentStep && state.currentEntry[currentStep.step_id]) {
    delete state.currentEntry[currentStep.step_id];
  }

  // Remove any subsequent step data that might be invalid now
  for (let i = state.currentStepIndex + 1; i < state.config.steps.length; i++) {
    const step = state.config.steps[i];
    if (step && state.currentEntry[step.step_id]) {
      // Check if this step would still be valid
      if (!evaluateStepCondition(step, i, state.currentEntry)) {
        delete state.currentEntry[step.step_id];
      }
    }
  }

  // Go back to previous valid step
  state.currentStepIndex = previousValidIndex;

  // Show previous step's modal
  showChoiceModal();
}

function cancelCurrentEntry() {
  if (!state.currentEntry) return;

  const entryId = state.currentEntry.entryId;

  // Remove the green dot
  if (state.activeDots.has(entryId)) {
    state.activeDots.delete(entryId);
    if (state.dotTimeouts.has(entryId)) {
      clearTimeout(state.dotTimeouts.get(entryId));
      state.dotTimeouts.delete(entryId);
    }
  }

  // Delete the screenshot if it exists

  // Clear current entry
  state.currentEntry = null;
  state.currentStepIndex = 0;

  // Close modal
  elements.choiceModal.classList.remove('active');

  // Resume video playback
  if (state.videoElement && state.videoElement.paused) {
    state.videoElement.play();
    state.videoElement.playbackRate = state.playbackSpeed;
  }

  // Redraw dots (to remove the cancelled dot)
  drawRedDots();

  log('Entry cancelled - click deregistered');
}

function handleChoiceSelection(value, stepId) {
  if (!state.currentEntry) return;

  state.currentEntry[stepId] = value;

  // Find next valid step
  const nextStepIndex = findNextValidStepIndex(state.currentStepIndex + 1);

  if (nextStepIndex === -1 || nextStepIndex >= state.config.steps.length) {
    // No more valid steps, finalize entry
    finalizeEntry();
  } else {
    // Move to next valid step
    state.currentStepIndex = nextStepIndex;
    showChoiceModal();
  }
}

function finalizeEntry() {
  if (!state.currentEntry) return;

  const entryId = state.currentEntry.entryId;

  // Save state snapshot for undo before making changes
  saveStateSnapshot();

  // Calculate timestamp from user-provided start time
  state.currentEntry.ocr_timestamp = calculateTimestamp(state.currentEntry);

  // Add to master log
  const entryCopy = { ...state.currentEntry };
  state.masterLog.push(entryCopy);
  
  // Clear redo stack when new action is performed
  state.redoStack = [];
  
  // In audit mode, track as new entry
  if (state.mode === 'audit') {
    state.newEntries.push(entryCopy);
  }

  // If in recap mode and new entry is later than current recapEndTime, extend recap
  if (state.isRewinding && state.recapEndTime !== null && entryCopy.playback_time_seconds !== undefined) {
    if (entryCopy.playback_time_seconds > state.recapEndTime) {
      state.recapEndTime = entryCopy.playback_time_seconds;
      log(`Recap extended - new entry added at ${entryCopy.playback_time_seconds.toFixed(2)}s during recap`);
    }
  }

  // Reset for next entry
  state.currentEntry = null;
  state.currentStepIndex = 0;
  elements.choiceModal.classList.remove('active');

  // Update entry count badge
  if (elements.entryCountBadge) {
    elements.entryCountBadge.textContent = `Entries: ${state.masterLog.length}`;
  }

  // Update logs panel
  updateLogsPanel();

  // Change green dot to red dot (finalized)
  const now = Date.now();
  if (state.activeDots.has(entryId)) {
    state.activeDots.set(entryId, {
      color: 'red',
      startTime: now,
      phase: 'finalized'
    });

    // Set timeout to remove dot after 1.75 seconds
    if (state.dotTimeouts.has(entryId)) {
      clearTimeout(state.dotTimeouts.get(entryId));
    }

    const timeoutId = setTimeout(() => {
      state.activeDots.delete(entryId);
      state.dotTimeouts.delete(entryId);
      drawRedDots();
    }, 1750);

    state.dotTimeouts.set(entryId, timeoutId);
  }

  // Resume playback
  // If in recap mode, continue recap; otherwise resume normal playback
  if (state.isRewinding && state.recapEndTime !== null) {
    const currentTime = state.videoElement.currentTime;
    if (recapManager && recapManager.shouldContinueRecap(currentTime)) {
      state.videoElement.play();
      state.videoElement.playbackRate = state.playbackSpeed;
      log(`Recap: Resuming after entry finalized, continuing to ${state.recapEndTime.toFixed(2)}s`);
    } else if (currentTime < state.recapEndTime - 0.5) {
      state.videoElement.play();
      state.videoElement.playbackRate = state.playbackSpeed;
      log(`Recap: Resuming after entry finalized, continuing to ${state.recapEndTime.toFixed(2)}s`);
    } else {
      state.videoElement.pause();
      state.recapCompleted = true;
      state.isRewinding = false;
      state.recapEndTime = null;
      log(`Recap: Entry finalized at or past latest entry time, recap completed`);
    }
  } else {
    // Normal playback
    state.videoElement.play();
    state.videoElement.playbackRate = state.playbackSpeed;
  }

  // Redraw dots
  drawRedDots();
}

function calculateTimestamp(entry) {
  // Calculate timestamp from user-provided start time
  // User provides the time that corresponds to video playback at 00:00:01
  // So: timestamp = startTime + (playbackTime - 1 second)
  if (entry.playback_time_seconds === undefined || entry.playback_time_seconds === null) {
    return 'N/A';
  }

  const videoStartSeconds = state.setupData.videoStartTime || 0;
  // Subtract 1 second because user's start time is at 00:00:01, not 00:00:00
  const actualFootageTime = videoStartSeconds + (entry.playback_time_seconds - 1);

  // Format as 24-hour timestamp
  return formatSecondsToTimestamp(actualFootageTime);
}

// ============================================================================
// STATISTICS DASHBOARD
// ============================================================================
function showStatisticsDashboard(entries) {
  const modal = document.getElementById('stats-modal');
  const content = document.getElementById('stats-content');
  if (!modal || !content) return;

  // Calculate statistics
  const totalEntries = entries.length;
  const configFields = state.config ? state.config.steps.map(s => s.step_id) : [];
  
  // Entry count by step values
  const stepCounts = {};
  configFields.forEach(field => {
    stepCounts[field] = {};
    entries.forEach(entry => {
      const value = entry[field] || 'N/A';
      stepCounts[field][value] = (stepCounts[field][value] || 0) + 1;
    });
  });

  // Time distribution
  const timeRanges = {
    '0-5 min': 0,
    '5-10 min': 0,
    '10-15 min': 0,
    '15-30 min': 0,
    '30+ min': 0
  };
  
  entries.forEach(entry => {
    const minutes = (entry.playback_time_seconds || 0) / 60;
    if (minutes < 5) timeRanges['0-5 min']++;
    else if (minutes < 10) timeRanges['5-10 min']++;
    else if (minutes < 15) timeRanges['10-15 min']++;
    else if (minutes < 30) timeRanges['15-30 min']++;
    else timeRanges['30+ min']++;
  });

  // Entry rate
  const firstEntry = entries[0];
  const lastEntry = entries[entries.length - 1];
  const duration = lastEntry && firstEntry ? 
    (lastEntry.playback_time_seconds - firstEntry.playback_time_seconds) / 60 : 0;
  const entryRate = duration > 0 ? (totalEntries / duration).toFixed(2) : 'N/A';

  // Build HTML
  let html = '<div class="stats-grid">';
  html += `<div class="stat-card"><h3>Total Entries</h3><div class="value">${totalEntries}</div></div>`;
  html += `<div class="stat-card"><h3>Entry Rate</h3><div class="value">${entryRate}/min</div></div>`;
  html += `<div class="stat-card"><h3>Duration</h3><div class="value">${duration.toFixed(1)} min</div></div>`;
  html += '</div>';

  // Time distribution
  html += '<h3 style="margin-top: 1.5rem; margin-bottom: 0.5rem;">Time Distribution</h3>';
  html += '<div class="stats-grid">';
  Object.entries(timeRanges).forEach(([range, count]) => {
    html += `<div class="stat-card"><h3>${range}</h3><div class="value">${count}</div></div>`;
  });
  html += '</div>';

  // Step value counts
  if (configFields.length > 0) {
    html += '<h3 style="margin-top: 1.5rem; margin-bottom: 0.5rem;">Entry Counts by Category</h3>';
    configFields.forEach(field => {
      const counts = stepCounts[field];
      const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
      if (entries.length > 0) {
        html += `<h4 style="margin-top: 1rem; color: #888;">${field}</h4>`;
        html += '<table class="stats-table">';
        html += '<tr><th>Value</th><th>Count</th></tr>';
        entries.forEach(([value, count]) => {
          html += `<tr><td>${value}</td><td>${count}</td></tr>`;
        });
        html += '</table>';
      }
    });
  }

  // Add JSON export section
  html += '<div style="margin-top: 2rem; padding-top: 1.5rem; border-top: 1px solid #444;">';
  html += '<button id="stats-export-json-btn" class="stats-button secondary">Export as JSON</button>';
  html += '</div>';

  content.innerHTML = html;

  // Setup JSON export button
  const exportJsonBtn = document.getElementById('stats-export-json-btn');
  if (exportJsonBtn) {
    exportJsonBtn.onclick = () => {
      exportToJSON(entries);
    };
  }

  // Setup button handlers
  const processAnotherBtn = document.getElementById('stats-process-another-btn');
  
  if (processAnotherBtn) {
    processAnotherBtn.onclick = () => {
      modal.classList.remove('active');
      returnToSetupScreen();
    };
  }

  modal.classList.add('active');
}

// ============================================================================
// KEYBOARD SHORTCUTS
// ============================================================================
function initializeKeyboardShortcuts() {
  // Show shortcuts modal on ? key
  document.addEventListener('keydown', (e) => {
    // Don't trigger if typing in input fields
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
      if (e.key === '?' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        showShortcutsModal();
      }
      return;
    }

    // Save session shortcut (Ctrl+S or Cmd+S)
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault();
      // Only save if we're in counting mode and have entries
      if (elements.countingScreen && elements.countingScreen.classList.contains('active')) {
        saveSession();
      }
      return;
    }

    // Export shortcut (Ctrl+E or Cmd+E)
    if ((e.ctrlKey || e.metaKey) && e.key === 'e') {
      e.preventDefault();
      if (elements.exportBtn && !elements.exportBtn.disabled) {
        exportToCSV();
      }
    }

    // Shortcuts modal (press ?)
    if (e.key === '?') {
      e.preventDefault();
      showShortcutsModal();
    }

    // Close shortcuts modal on Escape
    if (e.key === 'Escape') {
      const shortcutsModal = document.getElementById('shortcuts-modal');
      if (shortcutsModal && shortcutsModal.classList.contains('active')) {
        shortcutsModal.classList.remove('active');
      }
    }
  });
}

function showShortcutsModal() {
  const modal = document.getElementById('shortcuts-modal');
  const list = document.getElementById('shortcuts-list');
  if (!modal || !list) return;

  const shortcuts = [
    { key: 'SPACE', desc: 'Start/Pause video' },
    { key: '←', desc: 'Decrease speed' },
    { key: '→', desc: 'Increase speed' },
    { key: '↑', desc: 'Reset speed to 1.0x' },
    { key: '↓', desc: 'Pause & reset speed' },
    { key: '-', desc: 'Rewind 60s & recap' },
    { key: 'Ctrl+Z', desc: 'Undo last entry' },
    { key: 'Ctrl+Shift+Z', desc: 'Redo entry' },
    { key: 'Ctrl+E', desc: 'Export data' },
    { key: '?', desc: 'Show shortcuts' },
    { key: 'Esc', desc: 'Close modals' }
  ];

  list.innerHTML = shortcuts.map(s => 
    `<div class="shortcut-item-row">
      <span class="shortcut-desc">${s.desc}</span>
      <span class="shortcut-key">${s.key}</span>
    </div>`
  ).join('');

  const closeBtn = document.getElementById('shortcuts-close-btn');
  if (closeBtn) {
    closeBtn.onclick = () => modal.classList.remove('active');
  }

  modal.classList.add('active');
}

// ============================================================================
// VIDEO CONTROLS (Speed, Time Display)
// ============================================================================

function decreaseSpeed() {
  const currentIndex = state.speedSequence.indexOf(state.playbackSpeed);
  if (currentIndex < state.speedSequence.length - 1) {
    state.playbackSpeed = state.speedSequence[currentIndex + 1];
  } else {
    state.playbackSpeed = state.speedSequence[state.speedSequence.length - 1];
  }
  if (!state.videoElement.paused) {
    state.videoElement.playbackRate = state.playbackSpeed;
  }
  updateSpeedDisplay();
}

function increaseSpeed() {
  const currentIndex = state.speedSequence.indexOf(state.playbackSpeed);
  if (currentIndex > 0) {
    state.playbackSpeed = state.speedSequence[currentIndex - 1];
  } else {
    state.playbackSpeed = state.speedSequence[0];
  }
  if (!state.videoElement.paused) {
    state.videoElement.playbackRate = state.playbackSpeed;
  }
  updateSpeedDisplay();
}

function resetSpeed() {
  state.playbackSpeed = 1.0;
  if (!state.videoElement.paused) {
    state.videoElement.playbackRate = state.playbackSpeed;
  }
  updateSpeedDisplay();
}

function updateSpeedDisplay() {
  elements.speedDisplay.textContent = `Speed: ${state.playbackSpeed}x`;
}

function updateVideoTimeDisplay() {
  const video = state.videoElement;
  if (!video || !video.duration) return;

  const playbackTime = video.currentTime;
  const total = video.duration;
  const remaining = total - playbackTime;

  // Calculate actual footage time
  const videoStartSeconds = state.setupData.videoStartTime || 0;
  const actualFootageTime = videoStartSeconds + playbackTime;

  // Format as 24-hour timestamp
  const actualTimeFormatted = formatSecondsToTimestamp(actualFootageTime);

  elements.videoTimeDisplay.textContent =
    `Playback: ${formatTime(playbackTime)} / ${formatTime(total)} (Left: ${formatTime(remaining)}) | Actual: ${actualTimeFormatted}`;
}

function formatTime(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function startRecap() {
  // Use recap manager if available
  if (recapManager) {
    recapManager.startRecap();
    return;
  }
  
  // Inline implementation (fallback)
  const videoPlayer = state.videoElement;
  if (!videoPlayer) {
    log('Video not initialized');
    return;
  }

  // If no entries exist, just rewind 60 seconds and pause
  if (state.masterLog.length === 0) {
    const currentTime = videoPlayer.currentTime;
    const rewindSeconds = 60;
    const newPlaybackTime = Math.max(0, currentTime - rewindSeconds);
    videoPlayer.currentTime = newPlaybackTime;

    videoPlayer.addEventListener('seeked', function onSeeked() {
      videoPlayer.removeEventListener('seeked', onSeeked);
      videoPlayer.pause();
      log(`Rewound 60 seconds (no entries to recap)`);
    }, { once: true });
    return;
  }

  const currentTime = videoPlayer.currentTime;
  const rewindSeconds = 60;

  // Find the latest entry time (the entry with the biggest playback_time_seconds)
  // Ensure we convert to numbers for proper comparison
  const latestEntry = state.masterLog.reduce((latest, entry) => {
    if (!entry || entry.playback_time_seconds === undefined) return latest;
    const entryTime = parseFloat(entry.playback_time_seconds);
    if (isNaN(entryTime)) return latest;
    const latestTime = latest !== null ? parseFloat(latest) : null;
    return (latestTime === null || entryTime > latestTime) ? entryTime : latestTime;
  }, null);

  if (!latestEntry) {
    log('No valid entries found for recap');
    return;
  }

  // Store the recap end time (latest entry time - video will pause here)
  state.recapEndTime = latestEntry;
  state.recapCompleted = false; // Reset completion flag

  // Log all entries for debugging
  const allEntryTimes = state.masterLog
    .filter(e => e && e.playback_time_seconds !== undefined)
    .map(e => e.playback_time_seconds.toFixed(2))
    .sort((a, b) => parseFloat(a) - parseFloat(b));
  log(`Recap: Found ${allEntryTimes.length} entries at times: ${allEntryTimes.join(', ')}s. Latest: ${latestEntry.toFixed(2)}s`);

  // Calculate new playback time (rewind 60 seconds from current position)
  const newPlaybackTime = Math.max(0, currentTime - rewindSeconds);
  videoPlayer.currentTime = newPlaybackTime;

  // Wait for seek to complete
  videoPlayer.addEventListener('seeked', function onSeeked() {
    videoPlayer.removeEventListener('seeked', onSeeked);

    // Pause the video - user must press SPACE to start recap
    videoPlayer.pause();

    // Enable rewind mode for dots (will show all entries during recap)
    state.isRewinding = true;

    const currentTimeAfterSeek = videoPlayer.currentTime;
    log(`Recap: Rewound to ${currentTimeAfterSeek.toFixed(2)}s, will play until latest entry at ${state.recapEndTime.toFixed(2)}s. Press SPACE to start recap.`);

    // Pre-add all future entries to activeDots so they're ready when video plays
    // This ensures dots appear as the video approaches each entry
    const now = Date.now();
    let addedCount = 0;
    state.masterLog.forEach(entry => {
      if (!entry || entry.playback_time_seconds === undefined) return;
      const entryTime = entry.playback_time_seconds;

      // Add ALL entries that are in the future and within the recap range
      // Use >= instead of > to ensure we include entries at the exact recap end time
      if (entryTime >= currentTimeAfterSeek && entryTime <= state.recapEndTime) {
        if (!state.activeDots.has(entry.entryId)) {
          state.activeDots.set(entry.entryId, {
            color: 'orange',
            startTime: now,
            phase: 'rewind',
            entryTime: entryTime
          });
          addedCount++;
        }
      }
    });
    log(`Recap: Pre-added ${addedCount} entries to activeDots for recap playback`);
    log(`Recap: activeDots size is now ${state.activeDots.size}, isRewinding: ${state.isRewinding}, recapEndTime: ${state.recapEndTime}`);

    // Force redraw of dots (they will be added dynamically as video plays)
    drawRedDots();
    
    // Also ensure dots are drawn continuously during playback
    // Request animation frame to ensure dots are visible immediately
    requestAnimationFrame(() => {
      drawRedDots();
    });
  }, { once: true });
}

// ============================================================================
// UNDO/REDO STACK
// ============================================================================
function saveStateSnapshot() {
  // Save a snapshot of masterLog and related state
  const snapshot = {
    masterLog: JSON.parse(JSON.stringify(state.masterLog)),
    newEntries: JSON.parse(JSON.stringify(state.newEntries)),
    deletedEntryIds: new Set(state.deletedEntryIds),
    timestamp: Date.now()
  };
  
  state.undoStack.push(snapshot);
  
  // Limit undo stack size
  if (state.undoStack.length > state.maxUndoHistory) {
    state.undoStack.shift();
  }
}

function undoLastEntry() {
  // Use undo stack if available
  if (state.undoStack.length > 0) {
    // Save current state to redo stack
    const currentSnapshot = {
      masterLog: JSON.parse(JSON.stringify(state.masterLog)),
      newEntries: JSON.parse(JSON.stringify(state.newEntries)),
      deletedEntryIds: new Set(state.deletedEntryIds),
      timestamp: Date.now()
    };
    state.redoStack.push(currentSnapshot);

    // Find the last entry that will be removed (for video jump)
    let lastRemovedEntry = null;
    if (state.masterLog.length > 0) {
      // Find entries in current state that won't be in previous state
      const previousSnapshot = state.undoStack[state.undoStack.length - 1];
      const currentEntryIds = new Set(state.masterLog.map(e => e.entryId));
      const previousEntryIds = new Set(previousSnapshot.masterLog.map(e => e.entryId));
      
      // Find the most recent entry that will be removed
      for (let i = state.masterLog.length - 1; i >= 0; i--) {
        if (!previousEntryIds.has(state.masterLog[i].entryId)) {
          lastRemovedEntry = state.masterLog[i];
          break;
        }
      }
    }

    // Restore previous state
    const previousSnapshot = state.undoStack.pop();
    state.masterLog = previousSnapshot.masterLog;
    state.newEntries = previousSnapshot.newEntries;
    state.deletedEntryIds = previousSnapshot.deletedEntryIds;

    // Jump to the undone entry's time if found
    if (lastRemovedEntry && state.videoElement && lastRemovedEntry.playback_time_seconds !== undefined) {
      const entryActualTime = getEntryCorrectedTime(lastRemovedEntry);
      const videoStartSeconds = state.setupData.videoStartTime || 0;
      const playbackTime = entryActualTime - videoStartSeconds;
      state.videoElement.currentTime = Math.max(0, playbackTime);
      state.videoElement.pause();
      
      // Show orange dot for undone entry
      const now = Date.now();
      state.activeDots.set(lastRemovedEntry.entryId, {
        color: 'orange',
        startTime: now,
        phase: 'undo'
      });
    }

    // Update UI
    updateLogsPanel();
    if (elements.entryCountBadge) {
      elements.entryCountBadge.textContent = `Entries: ${state.masterLog.length}`;
    }
    
    // Clear active dots and redraw
    if (!lastRemovedEntry) {
      state.activeDots.clear();
    }
    drawRedDots();
    
    showToast('Undone', 'success', 2000);
    return;
  }
  
  // Fallback: simple pop for backward compatibility
  if (state.masterLog.length === 0) {
    showToast('Nothing to undo', 'warning');
    return;
  }
  
  const lastEntry = state.masterLog.pop();
  
  // Update entry count badge
  if (elements.entryCountBadge) {
    elements.entryCountBadge.textContent = `Entries: ${state.masterLog.length}`;
  }

  // Jump to entry's time and pause
  if (state.videoElement && lastEntry.playback_time_seconds !== undefined) {
    const entryActualTime = getEntryCorrectedTime(lastEntry);
    const videoStartSeconds = state.setupData.videoStartTime || 0;
    const playbackTime = entryActualTime - videoStartSeconds;
    state.videoElement.currentTime = Math.max(0, playbackTime);
    state.videoElement.pause();
  }

  // Show orange dot for undone entry (will be removed when user clicks)
  const now = Date.now();
  state.activeDots.set(lastEntry.entryId, {
    color: 'orange',
    startTime: now,
    phase: 'undo'
  });

  // Clear any existing timeout
  if (state.dotTimeouts.has(lastEntry.entryId)) {
    clearTimeout(state.dotTimeouts.get(lastEntry.entryId));
  }

  updateLogsPanel();
  drawRedDots();
}

function redoLastEntry() {
  if (state.redoStack.length === 0) {
    showToast('Nothing to redo', 'warning');
    return;
  }

  // Save current state to undo stack
  const currentSnapshot = {
    masterLog: JSON.parse(JSON.stringify(state.masterLog)),
    newEntries: JSON.parse(JSON.stringify(state.newEntries)),
    deletedEntryIds: new Set(state.deletedEntryIds),
    timestamp: Date.now()
  };
  state.undoStack.push(currentSnapshot);

  // Find the last entry that will be restored (for video jump)
  let lastRestoredEntry = null;
  const redoSnapshot = state.redoStack[state.redoStack.length - 1];
  if (redoSnapshot.masterLog.length > 0) {
    // Find entries in redo state that aren't in current state
    const currentEntryIds = new Set(state.masterLog.map(e => e.entryId));
    
    // Find the most recent entry that will be added back
    for (let i = redoSnapshot.masterLog.length - 1; i >= 0; i--) {
      if (!currentEntryIds.has(redoSnapshot.masterLog[i].entryId)) {
        lastRestoredEntry = redoSnapshot.masterLog[i];
        break;
      }
    }
  }

  // Restore redo state
  state.masterLog = redoSnapshot.masterLog;
  state.newEntries = redoSnapshot.newEntries;
  state.deletedEntryIds = redoSnapshot.deletedEntryIds;
  state.redoStack.pop();

  // Jump to the redone entry's time if found
  if (lastRestoredEntry && state.videoElement && lastRestoredEntry.playback_time_seconds !== undefined) {
    const entryActualTime = getEntryCorrectedTime(lastRestoredEntry);
    const videoStartSeconds = state.setupData.videoStartTime || 0;
    const playbackTime = entryActualTime - videoStartSeconds;
    state.videoElement.currentTime = Math.max(0, playbackTime);
    state.videoElement.pause();
  }

  // Update UI
  updateLogsPanel();
  if (elements.entryCountBadge) {
    elements.entryCountBadge.textContent = `Entries: ${state.masterLog.length}`;
  }
  
  // Clear active dots and redraw
  state.activeDots.clear();
  drawRedDots();
  
  showToast('Redone', 'success', 2000);
}

// Old undoLastEntry is now handled by the undo stack system above
// This function is called from keyboard shortcut handler

// ============================================================================
// LOGS PANEL
// ============================================================================

function updateLogsPanel() {
  const logsContent = elements.logsContent;
  const previousEntryCount = state.masterLog.length - 1; // Previous count before new entry

  // Update count badge
  if (elements.logsCount) {
    elements.logsCount.textContent = state.masterLog.length;
  }

  // Clear logs
  logsContent.innerHTML = '';

  // Show ALL entries (not just last 20) - scrollable
  const allEntries = [...state.masterLog].reverse(); // Show newest first

  allEntries.forEach((entry, index) => {
    const logEntry = document.createElement('div');
    logEntry.className = 'log-entry';
    logEntry.setAttribute('data-entry-id', entry.entryId);

    const time = formatTime(entry.playback_time_seconds);
    const ocr = entry.ocr_timestamp || 'N/A';
    const choices = Object.entries(entry)
      .filter(([key]) => !['entryId', 'playback_time_seconds', 'ocr_timestamp', 'click_x', 'click_y'].includes(key))
      .map(([key, value]) => `${key}: ${value}`)
      .join(', ');

    // In audit mode, show if entry is marked for deletion
    const isDeleted = state.deletedEntryIds.has(entry.entryId);
    const isNew = state.newEntries.some(e => e.entryId === entry.entryId);

    if (isDeleted) {
      logEntry.style.opacity = '0.5';
      logEntry.style.textDecoration = 'line-through';
    }

    if (isNew) {
      logEntry.style.borderLeft = '3px solid #00ff00';
    }

    logEntry.textContent = `[${time}] ${ocr} | ${choices}`;

    // In audit mode, make entries clickable for deletion (left click) and seeking (right click)
    if (state.mode === 'audit') {
      logEntry.style.cursor = 'pointer';
      logEntry.title = isDeleted ? 'Left-click to restore entry, Right-click to seek to entry time' : 'Left-click to mark for deletion, Right-click to seek to entry time';
      
      // Left click: mark for deletion/restore
      logEntry.addEventListener('click', () => {
        // Save state for undo
        saveStateSnapshot();
        
        if (isDeleted) {
          // Restore entry
          state.deletedEntryIds.delete(entry.entryId);
        } else {
          // Mark for deletion
          state.deletedEntryIds.add(entry.entryId);
          
          // If it's a new entry, we should keep it in newEntries but marked as deleted
          // The export logic will exclude it based on deletedEntryIds
          // This allows undo to work correctly
        }
        
        // Clear redo stack when making changes
        state.redoStack = [];
        
        updateLogsPanel();
      });
      
      // Right click: seek to entry time and show green dot
      logEntry.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        
        if (!state.videoElement || entry.playback_time_seconds === undefined) {
          showToast('Cannot seek: entry has no playback time', 'warning');
          return;
        }
        
        const entryTime = parseFloat(entry.playback_time_seconds);
        if (isNaN(entryTime)) {
          showToast('Cannot seek: invalid entry time', 'warning');
          return;
        }
        
        // Seek to entry time
        state.videoElement.currentTime = entryTime;
        
        // Show green dot at entry location
        const now = Date.now();
        if (!state.activeDots.has(entry.entryId)) {
          state.activeDots.set(entry.entryId, {
            color: 'green',
            startTime: now,
            phase: 'finalized',
            entryTime: entryTime
          });
        } else {
          // Update existing dot to green
          const dotInfo = state.activeDots.get(entry.entryId);
          dotInfo.color = 'green';
          dotInfo.phase = 'finalized';
          dotInfo.startTime = now;
        }
        
        // Remove dot after 1.75 seconds (same as finalized entries)
        if (state.dotTimeouts.has(entry.entryId)) {
          clearTimeout(state.dotTimeouts.get(entry.entryId));
        }
        const timeoutId = setTimeout(() => {
          state.activeDots.delete(entry.entryId);
          state.dotTimeouts.delete(entry.entryId);
          drawRedDots();
        }, 1750);
        state.dotTimeouts.set(entry.entryId, timeoutId);
        
        // Update UI
        updateVideoTimeDisplay();
        drawRedDots();
        highlightEntryInLog(entry.entryId, true);
        
        // Pause video if playing
        if (!state.videoElement.paused) {
          state.videoElement.pause();
        }
        
        showToast(`Seeked to entry at ${formatTime(entryTime)}`, 'info', 2000);
        log(`Seeked to entry ${entry.entryId} at ${entryTime.toFixed(2)}s`);
      });
    }

    // Add highlight animation for the most recent entry
    if (index === 0 && state.masterLog.length > previousEntryCount) {
      logEntry.classList.add('new');
    }

    logsContent.appendChild(logEntry);
  });
}

// Track which entry is currently highlighted to avoid duplicate calls
let currentHighlightedEntryId = null;
let highlightTimeout = null;

// Highlight entry in log during recap/audit mode when dot appears
function highlightEntryInLog(entryId, isActive = false) {
  if (!elements.logsContent) return;
  
  // Find the entry element
  const entryElement = elements.logsContent.querySelector(`[data-entry-id="${entryId}"]`);
  if (!entryElement) return;
  
  // If this is the active highlight (green dot), remove previous and set new
  if (isActive) {
    // Clear any existing active highlights
    const previousActive = elements.logsContent.querySelector('.log-entry.active');
    if (previousActive && previousActive !== entryElement) {
      previousActive.classList.remove('active');
    }
    
    // Clear streaming class if present
    entryElement.classList.remove('streaming');
    
    // Set as active (green highlight)
    entryElement.classList.add('active');
    currentHighlightedEntryId = entryId;
    
    // Clear any pending timeout
    if (highlightTimeout) {
      clearTimeout(highlightTimeout);
      highlightTimeout = null;
    }
    
    // Scroll to show the entry
    entryElement.scrollIntoView({
      behavior: 'smooth',
      block: 'center'
    });
  } else {
    // Streaming mode (orange dot) - only add if not already active
    if (!entryElement.classList.contains('active')) {
      entryElement.classList.add('streaming');
    }
  }
}

// Clear all highlights from log
function clearLogHighlights() {
  if (!elements.logsContent) return;
  
  // Clear any pending timeout
  if (highlightTimeout) {
    clearTimeout(highlightTimeout);
    highlightTimeout = null;
  }
  
  const activeEntries = elements.logsContent.querySelectorAll('.log-entry.active, .log-entry.streaming');
  activeEntries.forEach(entry => {
    entry.classList.remove('active', 'streaming');
  });
  
  currentHighlightedEntryId = null;
}

// ============================================================================
// CSV EXPORT
// ============================================================================

async function exportToCSV() {
  if (state.masterLog.length === 0) {
    showToast('No data to export', 'warning');
    return;
  }

  // Pause video if playing
  if (state.videoElement && !state.videoElement.paused) {
    state.videoElement.pause();
  }

  // Get progress bar elements
  const progressBar = document.getElementById('export-progress');
  const progressBarFill = document.getElementById('export-progress-bar');
  const progressText = document.getElementById('export-progress-text');

  // Show progress bar
  if (progressBar) {
    progressBar.classList.add('active');
    if (progressBarFill) progressBarFill.style.width = '10%';
    if (progressText) progressText.textContent = 'Preparing export...';
  }

  // Calculate timestamps for all entries using user-provided start time
  state.masterLog.forEach(entry => {
    if (!entry.ocr_timestamp || entry.ocr_timestamp === '') {
      entry.ocr_timestamp = calculateTimestamp(entry);
    }
  });

  try {
    // Get all field names from config and entries
    const configFields = state.config.steps.map(s => s.step_id);
    const allFields = ['playback_time_seconds', 'ocr_timestamp', 'click_x', 'click_y', ...configFields];

    // Build CSV
    let csv = 'Street Name,GUID,Site Description,Export Date,Video File';
    allFields.forEach(field => {
      csv += `,${field}`;
    });
    csv += '\n';

    // Add metadata
    const exportDate = new Date().toISOString().split('T')[0];
    const videoFileName = state.videoPath ? state.videoPath.split('/').pop() : 'unknown';

    // In audit mode, export: old entries + new entries - deleted entries
    let entriesToExport = [];
    if (state.mode === 'audit') {
      // Include original entries that are NOT deleted
      state.originalEntries.forEach(entry => {
        if (!state.deletedEntryIds.has(entry.entryId)) {
          entriesToExport.push(entry);
        }
      });
      // Include all new entries that are NOT deleted
      state.newEntries.forEach(entry => {
        if (!state.deletedEntryIds.has(entry.entryId)) {
          entriesToExport.push(entry);
        }
      });
    } else {
      // Entry mode: export all entries
      entriesToExport = state.masterLog;
    }

    entriesToExport.forEach((entry, index) => {
      let row = `${sanitizeForCSV(state.setupData.streetName)},${sanitizeForCSV(state.setupData.guid)},${sanitizeForCSV(state.setupData.siteDescription)},${sanitizeForCSV(exportDate)},${sanitizeForCSV(videoFileName)}`;
      allFields.forEach(field => {
        let value = entry[field] || '';
        // Convert ocr_timestamp to 24-hour format if it exists
        if (field === 'ocr_timestamp' && value && value !== 'N/A') {
          const ocrSeconds = parseTimestampToSeconds(value);
          if (ocrSeconds !== null) {
            value = formatSecondsToTimestamp(ocrSeconds);
          }
        }
        row += `,${sanitizeForCSV(value)}`;
      });
      csv += row + '\n';
      
      // Update progress
      if (progressBarFill && progressText) {
        const progress = 50 + Math.round((index / entriesToExport.length) * 40);
        progressBarFill.style.width = `${progress}%`;
        progressText.textContent = `Building CSV... ${index + 1}/${entriesToExport.length}`;
      }
    });

    // Update progress
    if (progressBarFill && progressText) {
      progressBarFill.style.width = '90%';
      progressText.textContent = 'Saving file...';
    }

    // Get video filename for folder structure
    const videoPathParts = state.videoPath ? state.videoPath.split(/[/\\]/) : [];
    const videoFilenameWithExt = videoPathParts.length > 0 ? videoPathParts[videoPathParts.length - 1] : 'unknown';
    const videoFilename = state.videoFileName || videoFilenameWithExt.replace(/\.[^/.]+$/, '');

    // Save via IPC - use different filename for audit mode
    const exportType = state.mode === 'audit' ? 'auditor' : 'normal';
    const result = await ipcRenderer.invoke('save-csv-export', csv, exportType, videoFilename);
    
    // Complete progress
    if (progressBarFill) progressBarFill.style.width = '100%';
    if (progressText) progressText.textContent = 'Export complete!';
    if (result.success) {
      const exportCount = entriesToExport.length;
      showToast(`Export completed successfully! ${exportCount} entries exported.`, 'success', 5000);
      
      // Hide progress bar
      setTimeout(() => {
        if (progressBar) progressBar.classList.remove('active');
      }, 1000);
      
      // Show statistics dashboard
      showStatisticsDashboard(entriesToExport);
    } else if (!result.canceled) {
      showToast(`Export failed: ${result.error}`, 'error');
      if (progressBar) progressBar.classList.remove('active');
    } else {
      if (progressBar) progressBar.classList.remove('active');
    }
  } catch (error) {
    log('Export error:', error);
    showToast(`Export error: ${error.message}`, 'error');
    if (progressBar) progressBar.classList.remove('active');
  }
}

// ============================================================================
// JSON EXPORT
// ============================================================================
async function exportToJSON(entries) {
  if (!entries || entries.length === 0) {
    showToast('No data to export', 'warning');
    return;
  }

  try {
    const exportData = {
      metadata: {
        streetName: state.setupData.streetName,
        guid: state.setupData.guid,
        siteDescription: state.setupData.siteDescription,
        videoStartTime: state.setupData.videoStartTime,
        videoFile: state.videoPath ? state.videoPath.split('/').pop() : 'unknown',
        exportDate: new Date().toISOString(),
        exportMode: state.mode,
        totalEntries: entries.length
      },
      entries: entries.map(entry => {
        const entryCopy = { ...entry };
        // Ensure timestamp is calculated
        if (!entryCopy.ocr_timestamp || entryCopy.ocr_timestamp === '') {
          entryCopy.ocr_timestamp = calculateTimestamp(entryCopy);
        }
        return entryCopy;
      })
    };

    const jsonString = JSON.stringify(exportData, null, 2);
    const blob = new Blob([jsonString], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    
    const a = document.createElement('a');
    a.href = url;
    a.download = `traffic-data-${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    showToast('JSON export completed!', 'success');
  } catch (error) {
    log('JSON export error:', error);
    showToast(`JSON export error: ${error.message}`, 'error');
  }
}

// ============================================================================
// ENTRY MANAGEMENT (REMOVED)
// ============================================================================
// Entry management feature has been removed for beta release

function deleteEntry(entry) {
  if (!confirm(`Are you sure you want to delete this entry?`)) return;

  // Save state for undo
  saveStateSnapshot();

  // In audit mode, handle deletion differently
  if (state.mode === 'audit') {
    // Check if it's an original entry or a new entry
    const isOriginalEntry = state.originalEntries.some(e => e.entryId === entry.entryId);
    const isNewEntry = state.newEntries.some(e => e.entryId === entry.entryId);
    
    if (isOriginalEntry) {
      // For original entries, mark for deletion (don't remove from masterLog)
      // They stay in masterLog but are excluded from export via deletedEntryIds
      state.deletedEntryIds.add(entry.entryId);
    } else if (isNewEntry) {
      // For new entries, remove from masterLog and newEntries completely
      const entryIndex = state.masterLog.findIndex(e => e.entryId === entry.entryId);
      if (entryIndex !== -1) {
        state.masterLog.splice(entryIndex, 1);
      }
      const newEntryIndex = state.newEntries.findIndex(e => e.entryId === entry.entryId);
      if (newEntryIndex !== -1) {
        state.newEntries.splice(newEntryIndex, 1);
      }
    } else {
      // Entry not found in either - shouldn't happen, but handle gracefully
      showToast('Entry not found', 'error');
      return;
    }
  } else {
    // Entry mode: remove from masterLog
    const entryIndex = state.masterLog.findIndex(e => e.entryId === entry.entryId);
    if (entryIndex === -1) {
      showToast('Entry not found', 'error');
      return;
    }
    state.masterLog.splice(entryIndex, 1);
  }

  // Clear redo stack
  state.redoStack = [];

  // Update UI
  updateLogsPanel();
  if (elements.entryCountBadge) {
    elements.entryCountBadge.textContent = `Entries: ${state.masterLog.length}`;
  }

  // Remove dot if exists
  if (state.activeDots.has(entry.entryId)) {
    state.activeDots.delete(entry.entryId);
    if (state.dotTimeouts.has(entry.entryId)) {
      clearTimeout(state.dotTimeouts.get(entry.entryId));
      state.dotTimeouts.delete(entry.entryId);
    }
  }
  drawRedDots();

  showToast('Entry deleted', 'success');
}

// ============================================================================
// RESTART COUNTING
// ============================================================================
function restartCounting() {
  // Clear all entries and reset state
  state.masterLog = [];
  state.currentEntry = null;
  state.currentStepIndex = 0;
  if (state.activeDots) state.activeDots.clear();
  if (state.dotTimeouts) {
    state.dotTimeouts.forEach(timeout => clearTimeout(timeout));
    state.dotTimeouts.clear();
  }
  state.entryCounter = 0;
  
  // In audit mode, restore original entries and clear audit-specific state
  if (state.mode === 'audit') {
    state.masterLog = [...state.originalEntries];
    state.newEntries = [];
    if (state.deletedEntryIds) state.deletedEntryIds.clear();
  } else {
    // Entry mode: clear everything
    state.newEntries = [];
    if (state.deletedEntryIds) state.deletedEntryIds.clear();
  }
  
  state.isRewinding = false;
  state.recapEndTime = null;
  state.recapCompleted = false;
  state.rewindStartTime = null;
  state.undoStack = [];
  state.redoStack = [];

  // Reset video to start
  if (state.videoElement) {
    state.videoElement.currentTime = 1.0;
    state.videoElement.pause();
  }

  // Close any open modal
  if (elements.choiceModal) {
    elements.choiceModal.classList.remove('active');
  }

  // Update UI
  updateLogsPanel();
  if (elements.entryCountBadge) {
    elements.entryCountBadge.textContent = 'Entries: 0';
  }
  if (elements.logsCount) {
    elements.logsCount.textContent = '0';
  }

  // Clear auto-save
  // Clear dots
  drawRedDots();

  showToast('Counting restarted from 0', 'success');
}

function returnToSetupScreen() {
  // Clear auto-save since we're returning to setup
  // Close any open modal first
  if (elements.choiceModal) {
    elements.choiceModal.classList.remove('active');
  }
  
  // Close URL input modal if open
  const urlInputModal = document.getElementById('url-input-modal');
  if (urlInputModal) {
    urlInputModal.classList.remove('active');
  }
  
  // Close stats modal if open
  const statsModal = document.getElementById('stats-modal');
  if (statsModal) {
    statsModal.classList.remove('active');
  }

  // Cancel any pending entry
  if (state.currentEntry) {
    const entryId = state.currentEntry.entryId;
    // Remove the green dot
    if (state.activeDots.has(entryId)) {
      state.activeDots.delete(entryId);
      if (state.dotTimeouts.has(entryId)) {
        clearTimeout(state.dotTimeouts.get(entryId));
        state.dotTimeouts.delete(entryId);
      }
    }
    state.currentEntry = null;
    state.currentStepIndex = 0;
  }

  // Cancel any ongoing downloads
  if (state.videoUrl && state.isStreaming) {
    ipcRenderer.invoke('cancel-all-downloads').then((result) => {
      if (result.success && result.cancelledCount > 0) {
        log(`Cancelled ${result.cancelledCount} download(s) when returning to setup`);
      }
    }).catch((error) => {
      log(`Error cancelling downloads: ${error.message}`);
    });
  }

  // Clean up event listeners
  disableVideoClicks();
  
  if (state.videoElement) {
    // Remove all video event listeners
    if (state.eventListeners.pause) {
      state.videoElement.removeEventListener('pause', state.eventListeners.pause);
      state.eventListeners.pause = null;
    }
    if (state.eventListeners.timeupdate) {
      state.videoElement.removeEventListener('timeupdate', state.eventListeners.timeupdate);
      state.eventListeners.timeupdate = null;
    }
    if (state.eventListeners.loadedmetadata) {
      state.videoElement.removeEventListener('loadedmetadata', state.eventListeners.loadedmetadata);
      state.eventListeners.loadedmetadata = null;
    }
    if (state.eventListeners.seeked) {
      state.videoElement.removeEventListener('seeked', state.eventListeners.seeked);
      state.eventListeners.seeked = null;
    }
    
    state.videoElement.pause();
    state.videoElement.src = '';
    state.videoElement.load();
  }
  
  // Remove document-level listeners
  if (state.eventListeners.keydown) {
    document.removeEventListener('keydown', state.eventListeners.keydown);
    state.eventListeners.keydown = null;
  }
  if (state.eventListeners.shortcutsClick) {
    document.removeEventListener('click', state.eventListeners.shortcutsClick);
    state.eventListeners.shortcutsClick = null;
  }

  // Clear state
  state.masterLog = [];
  state.currentEntry = null;
  if (state.pendingEntries) state.pendingEntries.clear();
  if (state.activeDots) state.activeDots.clear();
  if (state.dotTimeouts) {
    state.dotTimeouts.forEach(timeout => clearTimeout(timeout));
    state.dotTimeouts.clear();
  }
  state.spacePressed = false;
  state.isRewinding = false;
  state.rewindStartTime = null;
  state.recapEndTime = null;
  state.recapCompleted = false;
  state.newEntries = [];
  if (state.deletedEntryIds) state.deletedEntryIds.clear();
  state.originalEntries = [];
  state.auditCsvPath = null;
  // Clear download state
  state.videoUrl = null;
  state.isStreaming = false;
  state.downloadCompleted = false;
  state.downloadPath = null;
  state.videoPath = null;
  state.config = null;
  state.setupData = {
    streetName: '',
    guid: '',
    siteDescription: '',
    videoStartTime: 0
  };

  // Clear canvas
  if (state.canvas) {
    const ctx = state.canvas.getContext('2d');
    ctx.clearRect(0, 0, state.canvas.width, state.canvas.height);
  }

  // Hide counting screen, show setup screen
  elements.countingScreen.classList.remove('active');
  elements.setupScreen.style.display = 'flex';

  // Reset form fields
  if (elements.streetName) elements.streetName.value = '';
  if (elements.guid) elements.guid.value = '';
  if (elements.siteDescription) elements.siteDescription.value = '';
  if (elements.videoStartTime) elements.videoStartTime.value = '';
  if (elements.configStatus) elements.configStatus.textContent = 'No config file loaded';
  if (elements.videoStatus) elements.videoStatus.textContent = 'No video file loaded';
  if (elements.csvStatus) elements.csvStatus.textContent = 'No CSV file loaded';

  // Reset mode to entry
  if (elements.modeEntry) elements.modeEntry.checked = true;
  if (elements.modeAudit) elements.modeAudit.checked = false;
  state.mode = 'entry';
  if (elements.csvLoaderGroup) elements.csvLoaderGroup.style.display = 'none';
  if (elements.startCountingBtn) elements.startCountingBtn.style.display = 'block';
  if (elements.startAuditBtn) elements.startAuditBtn.style.display = 'none';
  
  // Reset streaming state
  state.videoUrl = null;
  state.downloadPath = null;
  state.downloadCompleted = false;
  state.isStreaming = false;
  downloadReplacementOffered = false;

  // Update button states
  checkStartButton();
}

function showCloseConfirmationDialog() {
  // Check if there are any new entries (new entries in audit mode, or any entries in entry mode)
  const hasNewData = state.mode === 'audit'
    ? state.newEntries.length > 0 || state.deletedEntryIds.size > 0
    : state.masterLog.length > 0;

  if (!hasNewData) {
    // No new data, just go back
    returnToSetupScreen();
    return;
  }

  // Show confirmation dialog with clear options using toast + confirm
  const message = state.mode === 'audit'
    ? `You have unsaved changes:\n\n• ${state.newEntries.length} new entries\n• ${state.deletedEntryIds.size} deleted entries\n\nWhat would you like to do?`
    : `You have ${state.masterLog.length} unsaved entries.\n\nWhat would you like to do?`;

  showToast(message, 'warning', 5000);
  
  // Use a clearer prompt - show message first, then ask for action
  const exportChoice = confirm(
    message + '\n\nClick OK to Export Data and Save\nClick Cancel to Go Back Unsaved (all data will be lost)'
  );

  if (exportChoice) {
    // User chose to export (OK button)
    exportToCSV();
  } else {
    // Clear auto-save when user explicitly chooses not to save
    // User chose to go back unsaved (Cancel button)
    // Double confirm to prevent accidental data loss
    const confirmLoss = confirm(
      '⚠️ WARNING: All unsaved data will be lost!\n\nAre you sure you want to go back without saving?'
    );
    if (confirmLoss) {
      returnToSetupScreen();
    }
    // If user cancels the second confirmation, stay on video screen
  }
}

// ============================================================================
// VIDEO STREAMING/DOWNLOAD REPLACEMENT
// ============================================================================

let downloadReplacementOffered = false;

function checkAndOfferDownloadReplacement() {
  // Only offer if: streaming, download completed, and not already offered
  if (state.isStreaming && state.downloadCompleted && state.downloadPath && !downloadReplacementOffered) {
    const currentTime = state.videoElement.currentTime;
    const replace = confirm(
      `Download completed! Replace streaming video with downloaded file?\n\n` +
      `Current position: ${formatTime(currentTime)}\n` +
      `All entries will be preserved.`
    );
    
    if (replace) {
      replaceStreamWithDownload(currentTime);
    } else {
      // Don't ask again during this session
      downloadReplacementOffered = true;
    }
  }
}

function replaceStreamWithDownload(currentPlaybackTime) {
  if (!state.downloadPath || !state.videoElement) {
    showToast('Download file not available', 'error');
    return;
  }
  
  // Save current playback time and play state
  const savedTime = currentPlaybackTime;
  const wasPlaying = !state.videoElement.paused;
  
  // Pause video before replacing to prevent autoplay issues
  state.videoElement.pause();
  
  // Temporarily disable the play event listener to prevent interference during replacement
  let playListenerDisabled = false;
  const originalPlayListener = state.eventListeners.pause;
  if (state.videoElement && state.eventListeners.pause) {
    // We'll re-enable it after replacement
    playListenerDisabled = true;
  }
  
  // Replace video source
  const oldSrc = state.videoElement.src;
  state.videoElement.src = state.downloadPath;
  state.videoPath = state.downloadPath;
  
  // Update state
  state.isStreaming = false;
  downloadReplacementOffered = false;
  
  // Extract filename without extension for screenshot naming
  const fullPath = state.downloadPath;
  const filename = fullPath.split('/').pop().split('\\').pop();
  state.videoFileName = filename.replace(/\.[^/.]+$/, ''); // Remove extension
  
  // Update status
  if (elements.videoStatus) {
    elements.videoStatus.textContent = `Loaded: ${filename}`;
  }
  
  // Prevent autoplay during replacement
  state.videoElement.autoplay = false;
  
  // Wait for video to load and seek to saved position
  state.videoElement.addEventListener('loadedmetadata', function onLoadedMetadata() {
    state.videoElement.removeEventListener('loadedmetadata', onLoadedMetadata);
    
    // Ensure video is paused before seeking
    if (!state.videoElement.paused) {
      state.videoElement.pause();
    }
    
    // Seek to saved position
    const targetTime = Math.max(0, Math.min(savedTime, state.videoElement.duration));
    state.videoElement.currentTime = targetTime;
    
    state.videoElement.addEventListener('seeked', function onSeeked() {
      state.videoElement.removeEventListener('seeked', onSeeked);
      
      // Update video time display
      updateVideoTimeDisplay();
      
      // Restore play state if video was playing before replacement
      if (wasPlaying) {
        state.videoElement.play().catch(err => {
          log(`Error resuming playback after replacement: ${err.message}`);
          showToast('Video replaced, but playback could not resume', 'warning', 3000);
        });
      } else {
        // Ensure video is paused
        state.videoElement.pause();
      }
      
      showToast(`Video replaced with downloaded file at ${formatTime(targetTime)}`, 'success', 3000);
      log(`Video replaced: stream -> ${state.downloadPath} at ${targetTime.toFixed(2)}s (was ${wasPlaying ? 'playing' : 'paused'})`);
    }, { once: true });
  }, { once: true });
  
  // Load the new source
  state.videoElement.load();
}

function formatTime(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

// ============================================================================
// SESSION SAVE/LOAD
// ============================================================================

async function saveSession() {
  if (!state.videoPath) {
    showToast('No video loaded', 'warning');
    return;
  }
  
  // In audit mode, allow saving if there are new entries or deleted entries, even if masterLog is empty
  if (state.mode === 'audit') {
    if (state.newEntries.length === 0 && state.deletedEntryIds.size === 0 && state.masterLog.length === 0) {
      showToast('No changes to save', 'warning');
      return;
    }
  } else {
    // In entry mode, require entries
    if (state.masterLog.length === 0) {
      showToast('No entries to save', 'warning');
      return;
    }
  }

  // Get last entry time in 24hr format
  const lastEntry = state.masterLog.reduce((latest, entry) => {
    if (!entry || entry.playback_time_seconds === undefined) return latest;
    const entryTime = parseFloat(entry.playback_time_seconds);
    if (isNaN(entryTime)) return latest;
    const latestTime = latest !== null ? parseFloat(latest.playback_time_seconds) : null;
    return (latestTime === null || entryTime > latestTime) ? entry : latest;
  }, null);

  let lastEntryTime = '00:00:00';
  if (lastEntry && lastEntry.ocr_timestamp) {
    lastEntryTime = lastEntry.ocr_timestamp;
  } else if (lastEntry && lastEntry.playback_time_seconds !== undefined) {
    // Calculate timestamp from playback time
    const videoStartSeconds = state.setupData.videoStartTime || 0;
    const actualFootageTime = videoStartSeconds + (lastEntry.playback_time_seconds - 1);
    lastEntryTime = formatSecondsToTimestamp(actualFootageTime);
  }

  // Get video filename (without extension)
  const videoPathParts = state.videoPath.split(/[/\\]/);
  const videoFilenameWithExt = videoPathParts[videoPathParts.length - 1];
  const videoFilename = state.videoFileName || videoFilenameWithExt.replace(/\.[^/.]+$/, '');
  const safeVideoName = videoFilename.replace(/[^a-zA-Z0-9_-]/g, '_');
  const safeTime = lastEntryTime.replace(/:/g, '-');
  
  // Create filename: videoName_session_HH-MM-SS.json
  const filename = `${safeVideoName}_session_${safeTime}.json`;

  // Prepare session data
  const sessionData = {
    version: '1.0.2',
    savedAt: new Date().toISOString(),
    videoPath: state.videoPath,
    videoFileName: state.videoFileName,
    videoUrl: state.videoUrl,
    isStreaming: state.isStreaming,
    configPath: state.configPath,
    config: state.config,
    setupData: state.setupData,
    mode: state.mode,
    entries: state.masterLog,
    newEntries: state.mode === 'audit' ? state.newEntries : [],
    deletedEntryIds: state.mode === 'audit' ? Array.from(state.deletedEntryIds) : [],
    originalEntries: state.mode === 'audit' ? state.originalEntries : [],
    auditCsvPath: state.mode === 'audit' ? state.auditCsvPath : null,
    videoPosition: state.videoElement ? state.videoElement.currentTime : 0,
    playbackSpeed: state.playbackSpeed,
    entryCounter: state.entryCounter
  };

  try {
    const result = await ipcRenderer.invoke('save-session-file', sessionData, filename, videoFilename);
    if (result.success) {
      showToast(`Session saved: ${filename}`, 'success', 3000);
      log(`Session saved to: ${result.path}`);
    } else {
      showToast(`Failed to save session: ${result.error}`, 'error');
    }
  } catch (error) {
    showToast(`Error saving session: ${error.message}`, 'error');
    log(`Error saving session: ${error.message}`);
  }
}

/**
 * Load a saved session file and restore application state
 * Restores entries, video position, and automatically plays recap
 */
async function loadSession() {
  try {
    const result = await ipcRenderer.invoke('load-session-file');
    if (result.success && result.session) {
      const session = result.session;
      
      // Load config file if path is provided
      if (session.configPath) {
        const configResult = await ipcRenderer.invoke('load-config-from-path', session.configPath);
        if (configResult.success) {
          state.config = configResult.config;
          state.configPath = configResult.path;
          elements.configStatus.textContent = `Loaded: ${configResult.path.split(/[/\\]/).pop()}`;
          elements.configStatus.classList.add('loaded');
        } else if (session.config) {
          // Use config from session file
          state.config = session.config;
          elements.configStatus.textContent = 'Loaded from session';
          elements.configStatus.classList.add('loaded');
        }
      } else if (session.config) {
        // Use config from session file
        state.config = session.config;
        elements.configStatus.textContent = 'Loaded from session';
        elements.configStatus.classList.add('loaded');
      }

      // Load video file
      if (session.videoPath) {
        // Check if file exists via IPC
        const videoResult = await ipcRenderer.invoke('check-file-exists', session.videoPath);
        if (videoResult.exists) {
          state.videoPath = session.videoPath;
          const videoPathParts = session.videoPath.split(/[/\\]/);
          const videoFilenameWithExt = videoPathParts[videoPathParts.length - 1];
          state.videoFileName = session.videoFileName || videoFilenameWithExt.replace(/\.[^/.]+$/, '');
          elements.videoStatus.textContent = `Loaded: ${videoFilenameWithExt}`;
          elements.videoStatus.classList.add('loaded');
        } else {
          showToast('Video file not found. Please select it manually.', 'warning');
        }
      } else if (session.videoUrl) {
        // Load from URL
        state.videoUrl = session.videoUrl;
        state.isStreaming = session.isStreaming || false;
        state.videoPath = session.videoUrl;
        elements.videoStatus.textContent = `Streaming: ${session.videoUrl.substring(0, 50)}...`;
        elements.videoStatus.classList.add('loaded');
      }

      // Restore setup data
      if (session.setupData) {
        state.setupData = session.setupData;
        if (elements.streetName) elements.streetName.value = session.setupData.streetName || '';
        if (elements.guid) elements.guid.value = session.setupData.guid || '';
        if (elements.siteDescription) elements.siteDescription.value = session.setupData.siteDescription || '';
        if (elements.videoStartTime && session.setupData.videoStartTime) {
          const timeStr = formatSecondsToTimestamp(session.setupData.videoStartTime);
          elements.videoStartTime.value = timeStr;
        }
      }

      // Restore mode
      if (session.mode) {
        state.mode = session.mode;
        if (session.mode === 'audit') {
          if (elements.modeAudit) elements.modeAudit.checked = true;
          if (elements.modeEntry) elements.modeEntry.checked = false;
          if (elements.csvLoaderGroup) elements.csvLoaderGroup.style.display = 'block';
          if (elements.startCountingBtn) elements.startCountingBtn.style.display = 'none';
          if (elements.startAuditBtn) elements.startAuditBtn.style.display = 'block';
          
          // Load CSV if in audit mode
          if (session.auditCsvPath) {
            const csvResult = await ipcRenderer.invoke('load-csv-from-path', session.auditCsvPath);
            if (csvResult.success) {
              const parsed = parseCSV(csvResult.data);
              state.originalEntries = parsed.entries;
              state.auditCsvPath = csvResult.path;
              elements.csvStatus.textContent = `Loaded: ${csvResult.path.split(/[/\\]/).pop()} (${parsed.entries.length} entries)`;
              elements.csvStatus.classList.add('loaded');
            }
          }
        } else {
          if (elements.modeEntry) elements.modeEntry.checked = true;
          if (elements.modeAudit) elements.modeAudit.checked = false;
        }
      }

      // Store session data to restore after starting
      state.pendingSessionData = {
        entries: session.entries || [],
        newEntries: session.newEntries || [],
        deletedEntryIds: new Set(session.deletedEntryIds || []),
        originalEntries: session.originalEntries || [],
        videoPosition: session.videoPosition || 0,
        playbackSpeed: session.playbackSpeed || 1.0,
        entryCounter: session.entryCounter || 0
      };

      showToast('Session loaded. Click "Start Counting" to continue.', 'success', 3000);
      checkStartButton();
    }
  } catch (error) {
    showToast(`Error loading session: ${error.message}`, 'error');
    log(`Error loading session: ${error.message}`);
  }
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}
