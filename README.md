# Gemini Nano Chat

A Chrome extension for local chat powered by Chrome's built-in AI (Gemini Nano).

## Overview

Gemini Nano Chat is a Chrome extension that provides a local chat interface powered by Gemini Nano, Chrome's on-device AI model. The extension runs entirely in the browser with no server dependencies.

## Features

- **Local AI Chat**: Powered by Chrome's Gemini Nano for on-device inference
- **Markdown Support**: Renders Markdown messages beautifully
- **Side Panel Interface**: Conveniently accessible from the browser's side panel

## File Structure

- [`manifest.json`](manifest.json) - Chrome extension manifest (Manifest V3)
- [`background.js`](background.js) - Background service worker
- [`popup.html`](popup.html) - Side panel UI (HTML)
- [`popup.js`](popup.js) - Side panel logic (JavaScript)
- [`popup.css`](popup.css) - Side panel styling (CSS)
- [`marked.min.js`](marked.min.js) - Markdown parser library

## Installation

1. Open Chrome and navigate to `chrome://extensions/`
2. Enable **Developer mode** (toggle in the top right)
3. Click **Load unpacked**
4. Select the `gemini-nano-chat` directory
5. The extension icon will appear in your browser toolbar

## Usage

1. Click the extension icon in the Chrome toolbar
2. The chat interface will open in the side panel
3. Start chatting with Gemini Nano!

## Requirements

- Chrome browser with Gemini Nano support (most recent versions)
- Developer mode enabled for extension installation

## Permissions

- `storage` - For storing extension settings
- `sidePanel` - For displaying the chat interface
