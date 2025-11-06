/**
 * Video Controls Module
 * Handles playback speed, time display, and video state
 */

function createVideoControls(state, elements, log) {
  return {
    /**
     * Update video time display
     */
    updateVideoTimeDisplay() {
      const video = state.videoElement;
      if (!video || !video.duration) return;
      
      const playbackTime = video.currentTime;
      const total = video.duration;
      const remaining = total - playbackTime;
      
      // Calculate actual footage time
      const videoStartSeconds = state.setupData.videoStartTime || 0;
      const actualFootageTime = videoStartSeconds + playbackTime;
      
      // Format as 24-hour timestamp
      const actualTimeFormatted = this.formatSecondsToTimestamp(actualFootageTime);
      
      if (elements.videoTimeDisplay) {
        elements.videoTimeDisplay.textContent = 
          `Playback: ${this.formatTime(playbackTime)} / ${this.formatTime(total)} (Left: ${this.formatTime(remaining)}) | Actual: ${actualTimeFormatted}`;
      }
    },

    /**
     * Decrease playback speed
     */
    decreaseSpeed() {
      const currentIndex = state.speedSequence.indexOf(state.playbackSpeed);
      if (currentIndex < state.speedSequence.length - 1) {
        state.playbackSpeed = state.speedSequence[currentIndex + 1];
      } else {
        state.playbackSpeed = state.speedSequence[state.speedSequence.length - 1];
      }
      if (!state.videoElement.paused) {
        state.videoElement.playbackRate = state.playbackSpeed;
      }
      this.updateSpeedDisplay();
    },

    /**
     * Increase playback speed
     */
    increaseSpeed() {
      const currentIndex = state.speedSequence.indexOf(state.playbackSpeed);
      if (currentIndex > 0) {
        state.playbackSpeed = state.speedSequence[currentIndex - 1];
      } else {
        state.playbackSpeed = state.speedSequence[0];
      }
      if (!state.videoElement.paused) {
        state.videoElement.playbackRate = state.playbackSpeed;
      }
      this.updateSpeedDisplay();
    },

    /**
     * Reset speed to 1.0x
     */
    resetSpeed() {
      state.playbackSpeed = 1.0;
      if (!state.videoElement.paused) {
        state.videoElement.playbackRate = state.playbackSpeed;
      }
      this.updateSpeedDisplay();
    },

    /**
     * Update speed display
     */
    updateSpeedDisplay() {
      if (elements.speedDisplay) {
        elements.speedDisplay.textContent = `Speed: ${state.playbackSpeed}x`;
      }
    },

    /**
     * Format time helper
     */
    formatTime(seconds) {
      const mins = Math.floor(seconds / 60);
      const secs = Math.floor(seconds % 60);
      return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    },

    /**
     * Format seconds to timestamp helper
     */
    formatSecondsToTimestamp(seconds) {
      if (!isFinite(seconds) || seconds < 0) return 'N/A';
      const hours = Math.floor(seconds / 3600) % 24;
      const mins = Math.floor((seconds % 3600) / 60);
      const secs = Math.floor(seconds % 60);
      return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    }
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = createVideoControls;
}

