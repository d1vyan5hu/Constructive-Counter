/**
 * Recap Mode Management
 * Handles rewind/recap functionality for reviewing entries
 */

function createRecapManager(state, elements, log) {
  return {
    /**
     * Start recap mode - rewind 60 seconds and play until latest entry
     */
    startRecap() {
      const videoPlayer = state.videoElement;
      if (!videoPlayer) {
        log('Video not initialized');
        return;
      }
      
      // If no entries exist, just rewind 10 seconds and pause
      if (state.masterLog.length === 0) {
        const currentTime = videoPlayer.currentTime;
        const rewindSeconds = 10;
        const newPlaybackTime = Math.max(0, currentTime - rewindSeconds);
        videoPlayer.currentTime = newPlaybackTime;
        
        videoPlayer.addEventListener('seeked', function onSeeked() {
          videoPlayer.removeEventListener('seeked', onSeeked);
          videoPlayer.pause();
          log(`Rewound 10 seconds (no entries to recap)`);
        }, { once: true });
        return;
      }
      
      const currentTime = videoPlayer.currentTime;
      const rewindSeconds = 10;
      
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
      state.recapCompleted = false;
      
      // Log all entries for debugging
      const allEntryTimes = state.masterLog
        .filter(e => e && e.playback_time_seconds !== undefined)
        .map(e => e.playback_time_seconds.toFixed(2))
        .sort((a, b) => parseFloat(a) - parseFloat(b));
      log(`Recap: Found ${allEntryTimes.length} entries at times: ${allEntryTimes.join(', ')}s. Latest: ${latestEntry.toFixed(2)}s`);
      
      // Calculate new playback time (rewind 10 seconds from current position)
      const newPlaybackTime = Math.max(0, currentTime - rewindSeconds);
      videoPlayer.currentTime = newPlaybackTime;
      
      // Wait for seek to complete
      videoPlayer.addEventListener('seeked', function onSeeked() {
        videoPlayer.removeEventListener('seeked', onSeeked);
        
        videoPlayer.pause();
        state.isRewinding = true;
        
        const currentTimeAfterSeek = videoPlayer.currentTime;
        log(`Recap: Rewound to ${currentTimeAfterSeek.toFixed(2)}s, will play until latest entry at ${state.recapEndTime.toFixed(2)}s. Press SPACE to start recap.`);
        
        // Pre-add all future entries to activeDots
        const now = Date.now();
        let addedCount = 0;
        state.masterLog.forEach(entry => {
          if (!entry || entry.playback_time_seconds === undefined) return;
          const entryTime = entry.playback_time_seconds;
          
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
        
        // Trigger redraw if drawRedDots is available
        if (typeof drawRedDots === 'function') {
          drawRedDots();
        }
      }, { once: true });
    },

    /**
     * Check if recap should continue or pause
     */
    checkRecapProgress(currentTime) {
      if (!state.isRewinding || state.recapEndTime === null) return false;
      
      // Update recap end time if new entry was added
      // Ensure we convert to numbers for proper comparison
      const latestEntry = state.masterLog.reduce((latest, entry) => {
        if (!entry || entry.playback_time_seconds === undefined) return latest;
        const entryTime = parseFloat(entry.playback_time_seconds);
        if (isNaN(entryTime)) return latest;
        const latestTime = latest !== null ? parseFloat(latest) : null;
        return (latestTime === null || entryTime > latestTime) ? entryTime : latestTime;
      }, null);
      
      if (latestEntry && latestEntry > state.recapEndTime) {
        state.recapEndTime = latestEntry;
        log(`Recap extended - new latest entry at ${latestEntry.toFixed(2)}s`);
      }
      
      // Check if we've reached the latest entry time
      if (currentTime >= state.recapEndTime - 0.5) {
        return true; // Should pause
      }
      
      return false; // Continue playing
    },

    /**
     * Complete recap - pause and mark as completed
     */
    completeRecap(currentTime) {
      const latestEntryTime = state.recapEndTime;
      state.recapEndTime = null;
      state.isRewinding = false;
      state.recapCompleted = true;
      
      // Clear all rewind/recap dots
      for (const [entryId, dotInfo] of state.activeDots.entries()) {
        if (dotInfo.phase === 'rewind') {
          state.activeDots.delete(entryId);
          if (state.dotTimeouts.has(entryId)) {
            clearTimeout(state.dotTimeouts.get(entryId));
            state.dotTimeouts.delete(entryId);
          }
          // Clear log highlights when dots are removed
          if (typeof clearLogHighlights === 'function') {
            // Note: clearLogHighlights will be called from renderer when exiting recap
          }
        }
      }
      
      log(`Recap completed - reached latest entry time at ${latestEntryTime.toFixed(2)}s (current: ${currentTime.toFixed(2)}s). Press SPACE to continue making entries.`);
      
      return latestEntryTime;
    },

    /**
     * Exit recap mode
     */
    exitRecap() {
      state.recapCompleted = false;
      state.isRewinding = false;
      state.recapEndTime = null;
      state.rewindStartTime = null;
      
      // Clear all recap dots
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
    },

    /**
     * Check if we should continue recap after finalizing entry
     */
    shouldContinueRecap(currentTime) {
      if (!state.isRewinding || state.recapEndTime === null) return false;
      return currentTime < state.recapEndTime - 0.5;
    },

    /**
     * Extend recap if new entry is later than current end time
     */
    extendRecapIfNeeded(entryTime) {
      if (state.isRewinding && state.recapEndTime !== null && entryTime !== undefined) {
        if (entryTime > state.recapEndTime) {
          state.recapEndTime = entryTime;
          log(`Recap extended - new entry added at ${entryTime.toFixed(2)}s during recap`);
          return true;
        }
      }
      return false;
    }
  };
}

// Export
if (typeof module !== 'undefined' && module.exports) {
  module.exports = createRecapManager;
}

