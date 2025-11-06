# Changelog

All notable changes to CRClicker will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.0.1] - 2025-01-XX

### Added
- Session save/load functionality (Cmd+S / Ctrl+S)
- Automatic recap playback when loading saved sessions
- Video streaming from URLs with background download
- Seamless switching from stream to downloaded video
- Download cancellation when exiting video view
- Toast notification system for user feedback
- Statistics dashboard after data export
- JSON export format in addition to CSV
- Undo/Redo functionality with keyboard shortcuts (Ctrl+Z / Ctrl+Shift+Z)
- Config file validation with detailed error messages
- Support for "title" field in addition to "question" in config steps
- Text input step type for free-form data entry
- Conditional steps based on previous selections
- Restart counting functionality to reset from beginning
- Command-line URL loading support (`--url` argument)
- Glassmorphism UI for choice modal
- Dynamic modal positioning to stay within video bounds
- Log highlighting during recap and audit modes
- Entry log panel with scrollable entries list
- Comprehensive keyboard shortcuts documentation

### Changed
- Removed OCR functionality and timestamp selector rectangle
- Timestamp calculation now based on user-provided video start time
- Improved recap mode to pause at latest entry time
- Enhanced recap mode to allow adding entries during review
- Recap mode now supports multiple 60-second rewinds
- Improved dot indicator system with better visual feedback
- Refactored codebase into modular structure (state.js, utils.js, recap.js, video-controls.js)
- Improved error handling and logging throughout application
- Updated file management to use ~/Movies/CRClicker and ~/Documents/CRClicker
- Export files now organized by video name in subfolders
- Removed input validation on setup screen
- Removed state persistence on setup screen
- Improved keyboard shortcut handling to not interfere with text input
- Choice modal now displays as 2x2 grid layout
- Updated instruction messages to remove OCR references

### Fixed
- Recap mode now correctly pauses at latest entry time
- Dots appear 0.75 seconds before entry time in recap mode
- Fixed undo/redo to seek video to correct position
- Fixed config validation to accept both "question" and "title" fields
- Fixed video playback in audit mode
- Fixed export logic to correctly handle deleted entries in audit mode
- Fixed download cancellation and duplicate download prevention
- Fixed session restore to properly seek video and play recap
- Fixed modal visibility issues
- Fixed event listener cleanup to prevent memory leaks
- Fixed state initialization issues

### Removed
- OCR timestamp recognition system
- Green rectangle timestamp selector
- Auto-save/auto-load on startup
- "Manage Entries" feature from summary dashboard
- 100-day kill switch mechanism
- Input validation on setup screen
- State persistence on setup screen

### Security
- Removed all hardcoded paths and user-specific data
- Improved file permission handling
- Added proper error handling for file operations

## [1.0.2] - 2024-XX-XX

### Added
- Initial recap mode implementation
- Dot indicator system for entry visualization
- Basic undo/redo functionality

### Changed
- Improved video playback controls
- Enhanced entry management

## [1.0.1] - 2024-XX-XX

### Added
- Initial release
- Basic video counting functionality
- CSV export
- Config file support

---

## Version History Notes

- **0.0.1**: Initial open source release with session management, streaming, and improved UI
- **1.0.2**: Recap mode and visual improvements
- **1.0.1**: Initial stable release

## Future Plans

- Cross-platform support (Windows, Linux)
- Additional export formats
- Enhanced analytics and reporting
- Plugin system for custom data processors
- Cloud sync capabilities
- Multi-video batch processing

