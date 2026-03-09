# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Chrome Manifest V3 extension that exports Bilibili video comments to JSON format and performs AI-powered analysis via Gemini API. The extension fetches all comments (including nested replies) from a Bilibili video page, stores them in IndexedDB, and provides a results page for downloading or analyzing comments with scene-specific prompts.

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
- Clicking "一键导出" (Export) to trigger comment extraction
- After export, clicking "查看结果" or navigating to the results page to download / run AI analysis

## Architecture

### Core Components

**popup.html + popup.js + popup.css**
- Two-tab UI: "导出" tab (current video export) and "下载管理" tab (cached exports library)
- Detects the current Bilibili video's BVID from the active tab URL
- Sends `{type: "EXPORT", bvid}` message to background service worker when export button clicked
- Listens for `PROGRESS`, `DONE`, and `ERROR` messages to update progress bar and status text
- "下载管理" tab calls `idbGetAll()` to list cached exports; each BV number is a clickable link (`chrome.tabs.create`) to the video page
- On switching back to "导出" tab, `refreshCacheStatus()` re-checks IndexedDB so deleted records don't linger
- Key module-level variable: `currentBvid` (tracks the active tab's BV ID for cache status display)

**background.js (Service Worker)**
- Receives `EXPORT` messages from popup and orchestrates the entire export process
- Main export flow in `exportAllComments()`:
  1. Fetches video metadata (aid/oid) from BVID using Bilibili's `/x/web-interface/view` API
  2. Obtains WBI signing keys from `/x/web-interface/nav` API (required for anti-scraping)
  3. Paginates through main comments using `/x/v2/reply/wbi/main` API with WBI signing
  4. For each main comment with replies, probes and fetches nested replies using `/x/v2/reply/reply` API
  5. Builds a nested tree structure with `buildNestedChildren()`
  6. Saves result to IndexedDB via `idbSave()` (replaces old chrome.storage approach)
  7. Sends `DONE` message with `{bvid}` so popup can offer a link to results page
- `exportingBvid` (string, null when idle) replaces the old `isExporting` boolean — encodes both state and which video is exporting

**results.html + results.js**
- Opened via `results.html?bvid=BVxxx` (or without param to load latest)
- Loads export data from IndexedDB by BVID; displays metadata (comment counts, size, duration)
- Three action buttons: download JSON, download gzip, AI Summary (Gemini)
- AI Summary flow:
  1. Reads Gemini config from `chrome.storage.local` (endpoint, API key, model, scene)
  2. Loads `system_prompt.md` + `user_prompt.md` from the selected scene directory
  3. Filters comments via `filterThreadsByKeywords()` using scene's `poi_keywords.txt`
  4. Calls Gemini API and downloads result as JSON
  5. Supports **two-stage pipeline** (see below) for scenes with `user_prompt_stage1.md`

**options.html + options.js + options.css**
- Settings page: Gemini API endpoint, API key, model selector, temperature, disableThinking toggle
- Scene selector: 2×2 card grid (美食探店 / 网文小说 / 影视动漫 / UP主推荐) with animated selection indicator
- `user_prompt` is editable per scene; custom text persisted to `chrome.storage.local` under key `userPrompt_{sceneName}`; "↺ 恢复默认" button resets to file content
- Two separate notification areas: `#testResult` (API test) and `#promptResult` (prompt save confirmation)

### Scene System (`scenes/` directory)

Each scene subdirectory contains:
- `system_prompt.md` — detailed instruction set passed as Gemini `system_instruction`
- `user_prompt.md` — task-specific instructions; user-editable via options page; used as Stage 2 prompt in two-stage mode
- `poi_keywords.txt` — one keyword per line (lines starting with `#` are comments); used to filter comment threads before sending to Gemini
- `user_prompt_stage1.md` *(optional)* — if present, enables two-stage AI analysis for this scene

Current scenes: `美食探店`, `网文小说`, `影视动漫`, `UP主推荐`

The `美食探店` scene is the most developed, with a detailed shop extraction schema (see `system_prompt.md`) and Stage 1 discovery prompt.

### Two-Stage AI Analysis Pipeline

Controlled by `USE_TWO_STAGE_ANALYSIS` constant in `results.js` (default: `true`).

**Problem**: Gemini 2.5 Flash hard output limit is 65,536 tokens. For scenes with many entities (e.g., 食美探店 with 30+ shops), full analysis exceeds the limit and truncates JSON.

**Solution**:
- **Stage 1** — send all `filteredComments` to Gemini with `user_prompt_stage1.md`; output is only `{shops/omitted_shops/low_confidence_mentions: [{name, rpids: [...]}]}` — compact, never truncates
- **Client-side lookup** — `buildRpidMap(comments)` flattens the comment tree to a `Map<rpid, comment>`; each shop's `rpids` array is resolved to actual comment objects
- **Stage 2** — shops are batched (`STAGE2_BATCH_SIZE = 8`); each batch sends `[{shop_name, comments:[...]}]` to Gemini with `user_prompt.md` for full analysis; 8 shops × full analysis ≈ 10,000–20,000 output tokens (well under 65k)
- **Assembly** — all batch results are merged into `{shops, omitted_shops, low_confidence_mentions}` and downloaded as a single JSON file

If `USE_TWO_STAGE_ANALYSIS = true` but the current scene has no `user_prompt_stage1.md`, an error is thrown (no silent fallback).

If `USE_TWO_STAGE_ANALYSIS = false`, the original single-call path is used unchanged.

### Key Technical Details

**WBI Signing (Anti-Scraping)**
- Bilibili requires WBI signature for main comment API requests
- Process: fetch `img_key` + `sub_key` from nav API → apply `MIXIN_KEY_ENC_TAB` transformation → compute MD5 hash with query params + wts timestamp
- Self-contained MD5 implementation (no external dependencies)

**Comment Pagination**
- Main comments: uses `pagination_str.offset` from cursor response; continues until `cursor.is_end === true`
- Sub-replies: traditional page number pagination (`pn`/`ps`); probes first to get total count

**Data Structure**
Each comment node contains (simplified to only essential fields):
- `rpid`: reply ID (unique identifier)
- `mid`: user member ID
- `uname`: username
- `message`: comment text content
- `like`: like count
- `ctime`: unix timestamp (seconds)
- `location`: IP location string (e.g., "IP属地：北京")
- `root`: root comment rpid (0 for main comments)
- `parent`: parent comment rpid
- `dialog`: dialog ID for conversation tracking (0 if not part of a dialog)
- `replies[]`: nested array of child replies (null if no replies)

Fields like `avatar`, `time_desc`, and all `*_str` variants are intentionally excluded to reduce file size.

**IndexedDB Storage**
- DB name: `comment-insight`, object store: `exports`, keyPath: `bvid`
- Each record: `{bvid, json, comments, time, count, meta}`
- `json`: full JSON string of the export (for download)
- `comments`: parsed comment array (for keyword filtering and Gemini input)
- `meta`: `{main_total, sub_total_fetched, all_total_fetched, duration_ms}`

**Download Mechanism (results.js)**
- Uses `Blob` + `URL.createObjectURL()` for all downloads (not data URLs)
- For gzip: `CompressionStream("gzip")` → `Blob` → object URL
- For AI JSON: `TextEncoder` → `Blob` → object URL; object URL revoked immediately after click

**Gemini API Integration**
- Endpoint: supports both Google's `generativelanguage.googleapis.com` (auto-appends model path) and custom OpenAI-compatible endpoints
- `thinkingConfig: {thinkingBudget: 0}` is applied for `gemini-2.5-flash` / `gemini-2.5-pro` when `disableThinking = true`
- 5-minute timeout via `AbortController`; `finishReason === "MAX_TOKENS"` sets `truncated: true` in response

### Rate Limiting & Safety
- 300ms sleep between API requests to avoid rate limiting
- Page iteration limit (5000 max) to prevent infinite loops
- Individual sub-reply fetch failures are caught and logged; do not abort the entire export

## Permissions

- `downloads`: Required to trigger file downloads (used by background.js for the raw JSON/gzip export)
- `storage`: Persists settings (API config, gzip preference, custom user prompts per scene)
- `tabs`: Required to read the active tab URL and open new tabs (BV links in download manager)
- `host_permissions`: `api.bilibili.com` and `www.bilibili.com` for comment API calls

## Extension Context

- Works only on Bilibili video pages with URLs matching `/video/BV[0-9A-Za-z]+`
- Requires user to be logged in to Bilibili (`credentials: "include"` on all fetch calls)
- No content scripts injected; all operations happen in popup, background, results, and options page contexts
- `web_accessible_resources` in manifest covers `scenes/*/*.md` and `scenes/*/*.txt` so they can be fetched from extension pages
