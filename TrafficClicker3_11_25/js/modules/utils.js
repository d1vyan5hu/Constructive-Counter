/**
 * Utility Functions
 * Time formatting, timestamp parsing, coordinate calculations
 */

/**
 * Format seconds to MM:SS
 */
function formatTime(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

/**
 * Format seconds to 24-hour timestamp (HH:MM:SS)
 */
function formatSecondsToTimestamp(seconds, referenceFormat) {
  if (!isFinite(seconds) || seconds < 0) return 'N/A';
  
  const hours = Math.floor(seconds / 3600) % 24;
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  
  return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

/**
 * Parse timestamp string to seconds
 */
function parseTimestampToSeconds(timestampStr) {
  if (!timestampStr || typeof timestampStr !== 'string') return null;
  
  const trimmed = timestampStr.trim();
  
  // Try 12-hour format: "7:00:00 AM" or "07:00:00 AM"
  const match12 = trimmed.match(/^(\d{1,2}):(\d{2}):(\d{2})\s*(AM|PM)$/i);
  if (match12) {
    let hours = parseInt(match12[1], 10);
    const mins = parseInt(match12[2], 10);
    const secs = parseInt(match12[3], 10);
    const period = match12[4].toUpperCase();
    
    if (period === 'PM' && hours !== 12) hours += 12;
    if (period === 'AM' && hours === 12) hours = 0;
    
    return hours * 3600 + mins * 60 + secs;
  }
  
  // Try 24-hour format: "07:00:00"
  const match24 = trimmed.match(/^(\d{2}):(\d{2}):(\d{2})$/);
  if (match24) {
    const hours = parseInt(match24[1], 10);
    const mins = parseInt(match24[2], 10);
    const secs = parseInt(match24[3], 10);
    
    if (hours >= 0 && hours < 24 && mins >= 0 && mins < 60 && secs >= 0 && secs < 60) {
      return hours * 3600 + mins * 60 + secs;
    }
  }
  
  return null;
}

/**
 * Validate video dimensions and calculate scale
 */
function validateVideoDimensions(videoElement, videoRect) {
  if (!videoElement || !videoRect) {
    return { valid: false, error: 'Video element or rect missing' };
  }
  
  if (!videoElement.videoWidth || !videoElement.videoHeight || 
      !videoRect.width || !videoRect.height) {
    return { valid: false, error: 'Video dimensions not available' };
  }
  
  const scaleX = videoElement.videoWidth / videoRect.width;
  const scaleY = videoElement.videoHeight / videoRect.height;
  
  if (!isFinite(scaleX) || !isFinite(scaleY) || scaleX <= 0 || scaleY <= 0) {
    return { valid: false, error: 'Invalid scale values' };
  }
  
  return { valid: true, scaleX, scaleY };
}

/**
 * Convert click coordinates to native video dimensions
 */
function convertClickToNative(e, videoElement, videoContainer) {
  const videoRect = videoElement.getBoundingClientRect();
  const containerRect = videoContainer.getBoundingClientRect();
  const videoOffsetX = videoRect.left - containerRect.left;
  const videoOffsetY = videoRect.top - containerRect.top;
  
  const clickX = e.clientX - containerRect.left - videoOffsetX;
  const clickY = e.clientY - containerRect.top - videoOffsetY;
  
  const validation = validateVideoDimensions(videoElement, videoRect);
  if (!validation.valid) {
    return { valid: false, error: validation.error };
  }
  
  const { scaleX, scaleY } = validation;
  const nativeX = clickX * scaleX;
  const nativeY = clickY * scaleY;
  
  if (!isFinite(nativeX) || !isFinite(nativeY)) {
    return { valid: false, error: 'Invalid native coordinates' };
  }
  
  return { valid: true, nativeX, nativeY, scaleX, scaleY };
}

/**
 * Debounce function
 */
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

// Export
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    formatTime,
    formatSecondsToTimestamp,
    parseTimestampToSeconds,
    validateVideoDimensions,
    convertClickToNative,
    debounce
  };
}

