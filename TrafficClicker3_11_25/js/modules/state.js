/**
 * Application State Management
 * Centralized state object and state management utilities
 */

const { ipcRenderer } = require('electron');

// Logging function
function log(...args) {
  ipcRenderer.send('renderer-log', ...args);
}

// Application State
const createState = () => ({
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
  activeDots: new Map(),
  dotTimeouts: new Map(),
  isRewinding: false,
  rewindStartTime: null,
  recapEndTime: null,
  recapCompleted: false,
  mode: 'entry',
  auditCsvPath: null,
  originalEntries: [],
  deletedEntryIds: new Set(),
  newEntries: [],
  // Undo/Redo stack
  undoStack: [],
  redoStack: [],
  maxUndoHistory: 50
});

// DOM Elements cache
const createElements = () => {
  const getEl = (id) => document.getElementById(id);
  
  return {
    setupScreen: getEl('setup-screen'),
    countingScreen: getEl('counting-screen'),
    loadConfigBtn: getEl('load-config-btn'),
    loadVideoBtn: getEl('load-video-btn'),
    loadCsvBtn: getEl('load-csv-btn'),
    configStatus: getEl('config-status'),
    videoStatus: getEl('video-status'),
    csvStatus: getEl('csv-status'),
    modeEntry: getEl('mode-entry'),
    modeAudit: getEl('mode-audit'),
    csvLoaderGroup: getEl('csv-loader-group'),
    startAuditBtn: getEl('start-audit-btn'),
    streetName: getEl('street-name'),
    guid: getEl('guid'),
    siteDescription: getEl('site-description'),
    videoStartTime: getEl('video-start-time'),
    startCountingBtn: getEl('start-counting-btn'),
    videoPlayer: getEl('video-player'),
    videoContainer: getEl('video-container'),
    canvasOverlay: getEl('canvas-overlay'),
    instructionMessage: getEl('instruction-message'),
    choiceModal: getEl('choice-modal'),
    modalQuestion: getEl('modal-question'),
    modalStepInfo: getEl('modal-step-info'),
    choiceButtons: getEl('choice-buttons'),
    logsContent: getEl('logs-content'),
    exportBtn: getEl('export-btn'),
    videoTimeDisplay: getEl('video-time-display'),
    speedDisplay: getEl('speed-display'),
    entryCountBadge: getEl('entry-count-badge'),
    shortcutToggle: getEl('shortcut-toggle'),
    shortcutsPanel: getEl('shortcuts-panel'),
    logsCount: getEl('logs-count'),
    modalProgressBar: getEl('modal-progress-bar'),
    dirN: getEl('dir-n'),
    dirS: getEl('dir-s'),
    dirE: getEl('dir-e'),
    dirW: getEl('dir-w'),
    closeVideoBtn: getEl('close-video-btn')
  };
};

// State management utilities
const StateManager = {
  resetRecapState() {
    this.state.isRewinding = false;
    this.state.rewindStartTime = null;
    this.state.recapEndTime = null;
    this.state.recapCompleted = false;
  },

  resetEntryState() {
    this.state.currentEntry = null;
    this.state.currentStepIndex = 0;
  },

  resetAllState() {
    this.resetRecapState();
    this.resetEntryState();
    this.state.masterLog = [];
    this.state.activeDots.clear();
    this.state.dotTimeouts.forEach(timeout => clearTimeout(timeout));
    this.state.dotTimeouts.clear();
    this.state.entryCounter = 0;
    this.state.newEntries = [];
    this.state.deletedEntryIds.clear();
  }
};

// Initialize state and elements
const state = createState();
const elements = createElements();

// Export
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { state, elements, log, StateManager };
}

