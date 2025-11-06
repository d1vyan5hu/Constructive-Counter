# Contributing to TrafficClicker

Thank you for your interest in contributing to TrafficClicker! This document provides guidelines and instructions for contributing.

## Getting Started

1. **Fork the repository** on GitHub
2. **Clone your fork** locally:
   ```bash
   git clone https://github.com/your-username/TrafficClicker.git
   cd TrafficClicker
   ```
3. **Install dependencies**:
   ```bash
   npm install
   ```
4. **Start the application**:
   ```bash
   npm start
   ```

## Development Guidelines

### Code Style

- Follow existing code style and formatting
- Use meaningful variable and function names
- Add JSDoc comments for new functions
- Keep functions focused and modular

### Code Organization

- Main process code: `main.js`
- Renderer process code: `renderer.js`
- Modular code: `js/modules/`
- UI: `index.html`

### Testing

- Test your changes thoroughly before submitting
- Test on both Intel and Apple Silicon Macs if possible
- Verify keyboard shortcuts work correctly
- Test with different config files

## Making Changes

1. **Create a branch** for your feature/fix:
   ```bash
   git checkout -b feature/your-feature-name
   ```

2. **Make your changes** following the guidelines above

3. **Test your changes**:
   - Run the app and verify functionality
   - Check for console errors
   - Test edge cases

4. **Commit your changes**:
   ```bash
   git add .
   git commit -m "Description of your changes"
   ```

5. **Push to your fork**:
   ```bash
   git push origin feature/your-feature-name
   ```

6. **Create a Pull Request** on GitHub

## Pull Request Guidelines

- Provide a clear description of changes
- Reference any related issues
- Include screenshots for UI changes
- Ensure code follows existing patterns
- Update documentation if needed

## Areas for Contribution

- Bug fixes
- Feature enhancements
- Documentation improvements
- Performance optimizations
- Cross-platform support (Windows, Linux)
- Accessibility improvements
- UI/UX enhancements

## Questions?

Feel free to open an issue for questions or discussions about contributions.

