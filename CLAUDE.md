# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Chrome Manifest V3 extension that exports Bilibili video comments to JSON format. The extension fetches all comments (including nested replies) from a Bilibili video page and downloads them as JSON, with optional gzip compression.

## Key Commands

### Loading the Extension
1. Open Chrome and navigate to `chrome://extensions/`
2. Enable "Developer mode" in the top right
3. Click "Load unpacked" and select this directory
4. The extension will appear in the browser toolbar

### Testing
No automated tests are present. Manual testing requires:
- Opening a Bilibili video page (URL must contain `/video/BV...`)
- Clicking the extension icon to open the popup
- Clicking "一键导出" (Export) button to trigger comment extraction

## Architecture

### Core Components

**popup.html + popup.js + popup.css**
- Simple UI that detects the current Bilibili video's BVID from the active tab URL
- Provides a checkbox to enable gzip compression (persisted to chrome.storage.local)
- Sends an "EXPORT" message to the background service worker when the export button is clicked
- Listens for "PROGRESS", "DONE", and "ERROR" messages to update the UI status

**background.js (Service Worker)**
- Receives "EXPORT" messages from the popup and orchestrates the entire export process
- Main export flow in `exportAllComments()`:
  1. Fetches video metadata (aid/oid) from BVID using Bilibili's `/x/web-interface/view` API
  2. Obtains WBI signing keys from `/x/web-interface/nav` API (required for anti-scraping)
  3. Paginates through main comments using `/x/v2/reply/wbi/main` API with WBI signing
  4. For each main comment with replies, probes and fetches nested replies using `/x/v2/reply/reply` API
  5. Builds a nested tree structure with `buildNestedChildren()` that properly handles multi-level reply hierarchies
  6. Generates JSON output with metadata (total counts, timestamps, etc.)
  7. Optionally compresses with gzip using CompressionStream API
  8. Downloads file via chrome.downloads API using data URLs

### Key Technical Details

**WBI Signing (Anti-Scraping)**
- Bilibili requires WBI signature for main comment API requests
- Process: fetch img_key + sub_key from nav API → apply MIXIN_KEY_ENC_TAB transformation → compute MD5 hash with query params + wts timestamp
- Implementation includes a minimal self-contained MD5 function (no external dependencies)

**Comment Pagination**
- Main comments: uses `pagination_str.offset` from cursor response; continues until `cursor.is_end === true`
- Sub-replies: traditional page number pagination (pn/ps parameters); probes first to get total count

**Data Structure**
Each comment node contains:
- `rpid`: reply ID (unique identifier)
- `mid`: user member ID
- `uname`: username
- `avatar`: avatar URL
- `message`: comment text content
- `like`: like count
- `ctime`: unix timestamp (seconds)
- `time_desc`: human-readable time (e.g., "142天前发布")
- `location`: IP location string (e.g., "IP属地：北京")
- `root`: root comment rpid (0 for main comments)
- `parent`: parent comment rpid
- `children[]`: nested array of child replies

**Tree Building Algorithm**
- Sub-replies are fetched flat from API (each has `root` and `parent` fields)
- `buildNestedChildren()` constructs a proper tree by:
  1. Creating a Map of rpid → node
  2. Linking each node to its parent based on the `parent` field
  3. Nodes with `parent === mainRpid` become direct children
  4. Recursively sorting by `ctime` ascending

**Download Mechanism**
- Uses data URLs with base64 encoding (`uint8ToBase64()` with chunking to avoid call stack limits)
- For gzip: creates gzipped bytes via CompressionStream → base64 → data:application/gzip URL
- For plain JSON: encodes to UTF-8 bytes → base64 → data:application/json URL
- Large uncompressed files (>8MB) may fail due to browser data URL limits; warning shown to user

### Rate Limiting & Safety
- 300ms sleep between API requests to avoid rate limiting
- Page iteration limits (5000 max) to prevent infinite loops
- Individual sub-reply failures are caught and logged rather than aborting the entire export
- Credentials included in all fetch requests to ensure user is authenticated

## Permissions

- `downloads`: Required to trigger file downloads
- `storage`: Persists gzip checkbox preference
- `host_permissions`: Access to api.bilibili.com and www.bilibili.com for API calls and tab URL parsing

## Extension Context

- Works only on Bilibili video pages with URLs matching `/video/BV[0-9A-Za-z]+`
- Requires user to be logged in to Bilibili (uses credentials: "include")
- No content scripts injected; all operations happen in popup + background contexts
