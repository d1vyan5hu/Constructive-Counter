# CRClicker

An Electron application for video traffic counting and data collection. CRClicker allows users to efficiently count and categorize traffic events from video footage with customizable data collection workflows.

## Features

- **Flexible Data Collection**: Customizable JSON-based configuration for data entry workflows
- **Video Playback Control**: Adjustable playback speed, rewind, and precise seeking
- **Recap Mode**: Review past entries with automatic playback to latest entry
- **Audit Mode**: Review and edit existing data exports
- **Session Management**: Save and resume work sessions (Cmd+S / Ctrl+S)
- **Video Loading**: Load videos from local files or stream from URLs with background download
- **Conditional Steps**: Dynamic workflows based on previous selections
- **Text Input Support**: Free-form text entry in addition to choice-based steps
- **Undo/Redo**: Full undo/redo support for data entries
- **Export Options**: Export data as CSV or JSON
- **Visual Feedback**: Dot indicators for entry status, log highlighting during recap/audit
- **Keyboard Shortcuts**: Comprehensive keyboard controls for efficient workflow

## Installation

### Prerequisites

- Node.js (v14 or higher)
- npm

### Setup

1. Clone the repository:
```bash
git clone https://github.com/d1vyan5hu/Constructive-Counter.git
cd Constructive-Counter
```

2. Install dependencies:
```bash
npm install
```

3. Start the application:
```bash
npm start
```

### Building

Build a universal macOS DMG (Intel + Apple Silicon):
```bash
npm run build:mac:universal
```

Build for specific architecture:
```bash
npm run build:mac:dmg
```

## Usage

### Basic Workflow

1. **Load Config File**: Click "Load Config File" and select a JSON configuration file (see `test-config.json` for example)
2. **Load Video File**: Click "Load Video File" and select a video file (mp4, avi, mov, mkv, webm), or use "Load Video from URL" to stream from a URL
3. **Enter Information**: Fill in Street Name, GUID, Site Description, and Video Start Time
4. **Start Counting**: Click "Start Counting" button
5. **Press SPACE**: Start playback and enable counting
6. **Click on Video**: Click anywhere on the video to create an entry (video pauses automatically)
7. **Select Choices or Enter Text**: Complete the data entry workflow defined in your config
8. **Export Data**: Click "Export Data" button to save results as CSV or JSON

### Modes

#### Entry Mode
Standard mode for creating new data entries from video footage.

#### Audit Mode
Review and edit existing data exports:
- Load a CSV file with previous entries
- Review entries during playback
- Add new entries or mark existing ones for deletion
- Export updated data

### Recap Mode

Press `-` (minus key) to enter recap mode:
- Automatically rewinds 60 seconds
- Plays until the latest entry time
- Shows visual indicators for all entries
- Allows adding missing entries during recap
- Press `-` again to rewind another 60 seconds
- Press SPACE to continue making entries after recap completes

### Session Management

- **Save Session**: Press `Cmd+S` (Mac) or `Ctrl+S` (Windows/Linux) to save your current work
- **Load Session**: Use "Load Session" button on startup to resume previous work
- Sessions automatically restore video position and play a recap of the last 3 entries

## Keyboard Shortcuts

### Video Playback
- **SPACE**: Start playback (first press) / Toggle play/pause
- **← (Left Arrow)**: Decrease playback speed
- **→ (Right Arrow)**: Increase playback speed
- **↑ (Up Arrow)**: Reset speed to 1.0x (continue playing)
- **↓ (Down Arrow)**: Pause and reset speed to 1.0x
- **- (Minus)**: Rewind 60 seconds and enter recap mode

### Data Entry
- **Ctrl+Z / Cmd+Z**: Undo last entry
- **Ctrl+Shift+Z / Cmd+Shift+Z**: Redo entry

### General
- **Ctrl+S / Cmd+S**: Save session
- **Ctrl+E / Cmd+E**: Export data
- **?**: Show keyboard shortcuts
- **Esc**: Close modals

## Configuration

CRClicker uses JSON configuration files to define data collection workflows. See:
- `test-config.json` for a basic example
- `CONFIG_GUIDE.md` for detailed configuration documentation
- `CONFIG_SUPPORT.md` for advanced features (conditional steps, text input)

### Configuration Features

- **Choice Steps**: Multiple choice selections with custom labels
- **Text Input Steps**: Free-form text entry with placeholders
- **Conditional Steps**: Show/hide steps based on previous selections
- **Step Validation**: Automatic validation of configuration structure

## File Structure

```
CRClicker/
├── main.js              # Electron main process
├── renderer.js          # Renderer process (UI logic)
├── index.html           # Application UI
├── js/
│   └── modules/         # Modular code organization
│       ├── state.js      # State management
│       ├── utils.js      # Utility functions
│       ├── recap.js      # Recap mode logic
│       └── video-controls.js  # Video playback controls
├── build/               # Build resources
└── dist/                # Build output
```

## Development

See [CONTRIBUTING.md](CONTRIBUTING.md) for development guidelines and contribution instructions.

## License

GNU General Public License v3.0 (GPL-3.0) - see [LICENSE](LICENSE) file for details.

This program is free software: you can redistribute it and/or modify it under the terms of the GNU General Public License as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version.

## Support

For issues, feature requests, or questions, please open an issue on GitHub.

## Acknowledgments

Built with [Electron](https://www.electronjs.org/) and [electron-builder](https://www.electron.build/).
