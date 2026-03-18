// DOM elements
const $bvid = document.getElementById("bvid");
const $mainCount = document.getElementById("mainCount");
const $subCount = document.getElementById("subCount");
const $totalCount = document.getElementById("totalCount");
const $dataSize = document.getElementById("dataSize");
const $exportTime = document.getElementById("exportTime");
const $duration = document.getElementById("duration");
const $downloadJsonBtn = document.getElementById("downloadJsonBtn");
const $downloadGzipBtn = document.getElementById("downloadGzipBtn");
const $aiSummaryBtn = document.getElementById("aiSummaryBtn");
const $openSettings = document.getElementById("openSettings");
const $statusCard = document.getElementById("statusCard");
const $statusIcon = document.getElementById("statusIcon");
const $statusText = document.getElementById("statusText");
const $aiConfigHint = document.getElementById("aiConfigHint");

// Global data
let exportData = null;

// 两阶段分析开关：true = 使用发现+深度分析流水线；false = 原有单次调用
// 修改此值即可切换模式，无需改动其他代码
const USE_TWO_STAGE_ANALYSIS = true;

// Utility functions
function formatBytes(bytes) {
  if (bytes === 0) return "0 Bytes";
  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round(bytes / Math.pow(k, i) * 100) / 100 + " " + sizes[i];
}

function formatTime(isoString) {
  return new Date(isoString).toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
}

function formatDuration(ms) {
  if (!ms || ms < 0) return "--";

  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    const m = minutes % 60;
    const s = seconds % 60;
    return `${hours} 小时 ${m} 分钟 ${s} 秒`;
  } else if (minutes > 0) {
    const s = seconds % 60;
    return `${minutes} 分钟 ${s} 秒`;
  } else {
    return `${seconds} 秒`;
  }
}

function showStatus(icon, text, type = "normal") {
  $statusIcon.textContent = icon;
  $statusText.textContent = text;
  $statusCard.classList.remove("success", "error");
  if (type === "success") $statusCard.classList.add("success");
  if (type === "error") $statusCard.classList.add("error");
  $statusCard.style.display = "block";
}

function hideStatus() {
  $statusCard.style.display = "none";
}

// Download functions (copied from background.js)
async function gzipBytesFromString(str) {
  if (typeof CompressionStream === "undefined") {
    throw new Error("当前浏览器环境不支持 CompressionStream，无法 gzip 压缩（请更新 Chrome）");
  }
  const enc = new TextEncoder();
  const bytes = enc.encode(str);

  const cs = new CompressionStream("gzip");
  const stream = new Blob([bytes]).stream().pipeThrough(cs);
  const ab = await new Response(stream).arrayBuffer();
  return new Uint8Array(ab);
}

function downloadFile({ bytes, filename, mime }) {
  const blob = new Blob([bytes], { type: mime });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);

  // Release the blob URL to free memory
  URL.revokeObjectURL(url);
}

function downloadTextAsJson({ text, filename }) {
  const enc = new TextEncoder();
  const bytes = enc.encode(text);
  downloadFile({ bytes, filename, mime: "application/json;charset=utf-8" });
}

async function downloadGzip({ text, filename }) {
  const gzBytes = await gzipBytesFromString(text);
  downloadFile({ bytes: gzBytes, filename, mime: "application/gzip" });
}

// AI Summary functions
async function loadSystemPrompt(name) {
  const url = chrome.runtime.getURL(`scenes/${encodeURIComponent(name)}/system_prompt.md`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`system_prompt.md 不存在：scenes/${name}/`);
  return res.text();
}

async function loadSystemPromptStage1(name) {
  const url = chrome.runtime.getURL(`scenes/${encodeURIComponent(name)}/system_prompt_stage1.md`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`system_prompt_stage1.md 不存在：scenes/${name}/`);
  return res.text();
}

async function loadSystemPromptStage2(name) {
  const url = chrome.runtime.getURL(`scenes/${encodeURIComponent(name)}/system_prompt_stage2.md`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`system_prompt_stage2.md 不存在：scenes/${name}/`);
  return res.text();
}

async function loadUserPrompt(name) {
  // 优先使用用户自定义（storage）
  const key = `userPrompt_${name}`;
  const stored = await new Promise(r =>
    chrome.storage.local.get({ [key]: null }, res => r(res[key]))
  );
  if (stored !== null) return stored;
  // fallback 到文件
  const url = chrome.runtime.getURL(`scenes/${encodeURIComponent(name)}/user_prompt.md`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`user_prompt.md 不存在：scenes/${name}/`);
  return res.text();
}

// 加载关键词列表；文件不存在时返回 null（graceful degradation）
async function loadKeywords(sceneName) {
  try {
    const url = chrome.runtime.getURL(`scenes/${encodeURIComponent(sceneName)}/poi_keywords.txt`);
    const res = await fetch(url);
    if (!res.ok) return null;
    const text = await res.text();
    return text
      .split("\n")
      .map(line => line.trim())
      .filter(line => line && !line.startsWith("#"));
  } catch {
    return null;
  }
}

// 判断单个 thread（主评论及其所有层级 replies）是否命中任意关键词
// 短路优化：命中即立刻返回 true，无需继续遍历
function hasKeywordMatch(node, keywords) {
  if (keywords.some(kw => node.message.includes(kw))) return true;
  if (node.replies && node.replies.length > 0) {
    return node.replies.some(child => hasKeywordMatch(child, keywords));
  }
  return false;
}

// 过滤评论数组，保留命中关键词的完整 thread
function filterThreadsByKeywords(comments, keywords) {
  return comments.filter(thread => hasKeywordMatch(thread, keywords));
}

const THINKING_MODELS = ["gemini-2.5-flash", "gemini-2.5-pro", "gemini-3-flash-preview", "gemini-3.1-pro-preview"];

async function callGeminiAPI({ apiEndpoint, apiKey, modelName, temperature, disableThinking, systemPrompt, userPrompt, commentsData }) {
  let apiUrl = apiEndpoint.trim();

  // 如果API地址是Gemini官方格式，需要拼接模型名和方法
  if (apiUrl.includes("generativelanguage.googleapis.com")) {
    if (!apiUrl.endsWith("/")) apiUrl += "/";
    apiUrl = `${apiUrl}${modelName}:generateContent?key=${apiKey}`;
  }

  const requestBody = {
    system_instruction: {
      parts: [{ text: systemPrompt }]
    },
    contents: [
      {
        parts: [
          {
            text: `${userPrompt}\n\n以下是评论数据（JSON格式）：\n\n${JSON.stringify(commentsData)}`
          }
        ]
      }
    ],
    generationConfig: {
      temperature: temperature,
      topK: 40,
      topP: 0.95,
      maxOutputTokens: 65536,
      ...(THINKING_MODELS.includes(modelName) && disableThinking
        ? { thinkingConfig: { thinkingBudget: 0 } }
        : {})
    }
  };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 300000);

  try {
    const response = await fetch(apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorText = await response.text();
      let errorDetail = errorText;
      try {
        const errorJson = JSON.parse(errorText);
        const errorMsg = errorJson?.error?.message || errorText;
        const errorCode = errorJson?.error?.code || response.status;
        const errorStatus = errorJson?.error?.status || "UNKNOWN";
        errorDetail = `错误代码: ${errorCode}, 状态: ${errorStatus}, 信息: ${errorMsg}`;
      } catch (e) {
        // 如果不是JSON，直接使用原始错误文本
      }
      throw new Error(`Gemini API请求失败 (${response.status}): ${errorDetail}`);
    }

    const data = await response.json();

    const candidate = data?.candidates?.[0];
    const finishReason = candidate?.finishReason;

    if (finishReason === "SAFETY") {
      throw new Error("Gemini 安全过滤器拦截了本次请求，请检查评论内容或调整提示词");
    }
    if (!candidate?.content?.parts?.[0]?.text) {
      throw new Error(`Gemini API返回格式异常 (finishReason: ${finishReason})。响应: ${JSON.stringify(data).slice(0, 500)}`);
    }

    return {
      text: candidate.content.parts[0].text,
      truncated: finishReason === "MAX_TOKENS",
    };
  } catch (error) {
    clearTimeout(timeoutId);

    if (error.name === 'AbortError') {
      throw new Error('Gemini API请求超时（5分钟），评论数据可能过大，请稍后重试');
    }

    throw error;
  }
}

// ── 两阶段分析辅助函数 ──────────────────────────────────────────────────────

// 加载 Stage 1 prompt；文件不存在时返回 null（触发报错而非 fallback）
async function loadStage1Prompt(name) {
  try {
    const url = chrome.runtime.getURL(
      `scenes/${encodeURIComponent(name)}/user_prompt_stage1.md`
    );
    const res = await fetch(url);
    return res.ok ? await res.text() : null;
  } catch {
    return null;
  }
}

// Stage 1 输出去重：合并同名店铺的 aliases
function deduplicateShops(shops) {
  const seen = new Map();
  const result = [];
  for (const shop of shops) {
    if (seen.has(shop.name)) {
      const existing = result[seen.get(shop.name)];
      for (const a of (shop.aliases || [])) {
        if (!existing.aliases.includes(a)) existing.aliases.push(a);
      }
    } else {
      seen.set(shop.name, result.length);
      result.push({ ...shop, aliases: [...(shop.aliases || [])] });
    }
  }
  return result;
}

// 将评论树展平为 rpid → comment 的 Map
function buildRpidMap(comments) {
  const map = new Map();
  function walk(list) {
    for (const c of list) {
      map.set(String(c.rpid), c);
      if (c.replies?.length) walk(c.replies);
    }
  }
  walk(comments);
  return map;
}

// 按字节数和店铺数双重限制贪心分批
function chunkByBytes(items, limitBytes, limitCount = Infinity) {
  const batches = [];
  let current = [], currentSize = 0;
  for (const item of items) {
    const size = JSON.stringify(item).length;
    if (current.length > 0 && (currentSize + size > limitBytes || current.length >= limitCount)) {
      batches.push(current);
      current = [];
      currentSize = 0;
    }
    current.push(item);
    currentSize += size;
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

const STAGE2_BATCH_SIZE_BYTES = 25 * 1024; // 每批最大字节数（25 KB）
const STAGE2_BATCH_SIZE_COUNT = 20;        // 每批最大店铺数

function stripForStage1(list) {
  return list.map(c => ({
    rpid: c.rpid,
    uname: c.uname,
    message: c.message,
    replies: c.replies?.length ? stripForStage1(c.replies) : null
  }));
}

async function runTwoStageAnalysis({
  apiConfig, systemPrompt, systemPromptStage1, userPromptStage1, userPromptStage2,
  filteredComments, bvid
}) {
  // ── Stage 1：发现 + 归一 ──────────────────────────────────
  showStatus("⏳", "第一阶段：正在发现并归一店铺名称…");
  const resp1 = await callGeminiAPI({
    ...apiConfig,
    systemPrompt: systemPromptStage1,
    userPrompt: userPromptStage1,
    commentsData: { bvid, comments: stripForStage1(filteredComments) }
  });

  if (resp1.truncated) {
    throw new Error("第一阶段输出被截断，无法获得完整店铺列表。请优化 system_prompt_stage1.md 或减少评论量。");
  }

  const stripped1 = resp1.text.trim()
    .replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  let discovery;
  try {
    discovery = JSON.parse(stripped1);
  } catch (e) {
    throw new Error(`第一阶段 JSON 解析失败：${e.message}`);
  }

  // ── 客户端重组：字符串匹配 → dialog 优先，消费对应 rpid ──
  const rpidMap = buildRpidMap(filteredComments);
  const allShops = deduplicateShops(discovery.shops || []);

  function buildShopEvidence(shop) {
    const names = [shop.name, ...(shop.aliases || [])].filter(Boolean);

    // Step 1：遍历 filteredComments，按文字匹配收集 rpid / dialog_id
    const matchedRpids = new Set();
    const matchedDialogIds = new Set();
    function scanNode(node) {
      if (names.some(n => (node.message || "").includes(n))) {
        if (node.root === 0) {
          matchedRpids.add(String(node.rpid));
        } else {
          matchedDialogIds.add(String(node.dialog || node.rpid));
        }
      }
      if (node.replies?.length) node.replies.forEach(scanNode);
    }
    filteredComments.forEach(scanNode);

    // Step 2：dialog_ids → 按 rootRpid 分组 dialogNode
    const parts = [];
    const rootToDialogs = new Map();
    for (const dialogId of matchedDialogIds) {
      const dialogNode = rpidMap.get(dialogId);
      if (!dialogNode) continue;
      const rootRpid = String(dialogNode.root);
      if (!rootToDialogs.has(rootRpid)) rootToDialogs.set(rootRpid, []);
      rootToDialogs.get(rootRpid).push(dialogNode);
    }

    // Step 3：构建嵌套结构：主评论 + 仅相关 dialog 子线程
    const consumedRpids = new Set();
    for (const [rootRpid, dialogNodes] of rootToDialogs) {
      const root = rpidMap.get(rootRpid);
      if (root) {
        parts.push({ ...root, replies: dialogNodes });
        consumedRpids.add(rootRpid);
      }
    }

    // Step 4：剩余 rpid（主评论直接提及，无相关 dialog 线程）
    for (const rpid of matchedRpids) {
      if (!consumedRpids.has(rpid)) {
        const c = rpidMap.get(rpid);
        if (c) parts.push({ ...c, replies: null });
      }
    }

    return parts;
  }

  // 重组评论，过滤掉客户端匹配不到任何评论的店铺（0节点幻觉）
  const shopEvidences = allShops
    .map(shop => ({
      shop_name: shop.name,
      aliases: shop.aliases || [],
      comments: buildShopEvidence(shop)
    }))
    .filter(s => s.comments.length > 0);

  const totalShops = shopEvidences.length;
  const bytesBatches = chunkByBytes(shopEvidences, STAGE2_BATCH_SIZE_BYTES, STAGE2_BATCH_SIZE_COUNT);
  const totalBatches = bytesBatches.length;
  showStatus("⏳", `第一阶段完成：发现 ${totalShops} 家店铺，开始第二阶段（共 ${totalBatches} 批）…`);

  // ── Stage 2：分批深度分析 ─────────────────────────────────
  const finalResult = { shops: [], omitted_shops: [], low_confidence_mentions: [] };

  for (let i = 0; i < bytesBatches.length; i++) {
    const batchEvidence = bytesBatches[i];
    showStatus("⏳", `第二阶段：正在分析第 ${i + 1} / ${totalBatches} 批店铺…`);

    const resp2 = await callGeminiAPI({
      ...apiConfig, systemPrompt,
      userPrompt: userPromptStage2,
      commentsData: batchEvidence
    });

    const stripped2 = resp2.text.trim()
      .replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
    let batchResult;
    try {
      batchResult = JSON.parse(stripped2);
    } catch (e) {
      // 本批解析失败：记录原始文本，继续处理其他批次
      console.warn(`第 ${i + 1} 批 JSON 解析失败：`, e.message);
      batchEvidence.forEach(shop => {
        finalResult.omitted_shops.push({ shop_name: shop.shop_name, reason: `JSON 解析失败：${e.message}` });
      });
      continue;
    }

    // 直接合并各批次的三个数组
    finalResult.shops.push(...(batchResult.shops || []));
    finalResult.omitted_shops.push(...(batchResult.omitted_shops || []));
    finalResult.low_confidence_mentions.push(...(batchResult.low_confidence_mentions || []));
  }

  return finalResult;
}

async function downloadMarkdown({ text, filename }) {
  const enc = new TextEncoder();
  const bytes = enc.encode(text);
  downloadFile({ bytes, filename, mime: "text/markdown;charset=utf-8" });
}

async function downloadJSON({ text, filename, truncated = false }) {
  // 剥掉模型可能包裹的 markdown 代码块（```json ... ```）
  const stripped = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  let pretty;
  try {
    pretty = JSON.stringify(JSON.parse(stripped), null, 2);
  } catch (e) {
    if (truncated) {
      throw new Error("输出已达 token 上限，JSON 被截断无法保存。请尝试减少评论数量或缩短提示词。");
    }
    throw new Error(`Gemini 返回内容不是合法 JSON：${e.message}`);
  }
  const enc = new TextEncoder();
  downloadFile({ bytes: enc.encode(pretty), filename, mime: "application/json;charset=utf-8" });
}

// Check Gemini config
async function checkGeminiConfig() {
  return new Promise((resolve) => {
    chrome.storage.local.get({
      apiEndpoint: "",
      apiKey: "",
      promptTemplate: "",
      modelName: "gemini-2.5-flash",
      disableThinking: true
    }, (res) => {
      const hasEndpoint = !!(res.apiEndpoint && res.apiEndpoint.trim());
      const hasApiKey = !!(res.apiKey && res.apiKey.trim());
      const hasPrompt = !!(res.promptTemplate && res.promptTemplate.trim());
      resolve({
        isValid: hasEndpoint && hasApiKey && hasPrompt,
        ...res
      });
    });
  });
}

// IndexedDB 辅助函数
function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("comment-insight", 2);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains("exports"))
        db.createObjectStore("exports", { keyPath: "bvid" });
      if (!db.objectStoreNames.contains("summaries"))
        db.createObjectStore("summaries", { keyPath: "bvid" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet(bvid) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("exports", "readonly");
    const req = tx.objectStore("exports").get(bvid);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

async function idbSaveSummary({ bvid, scene, data }) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("summaries", "readwrite");
    tx.objectStore("summaries").put({ bvid, timestamp: new Date().toISOString(), scene, data });
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

async function idbGetAll() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("exports", "readonly");
    const req = tx.objectStore("exports").getAll();
    req.onsuccess = () => {
      const records = req.result || [];
      records.sort((a, b) => new Date(b.time) - new Date(a.time));
      resolve(records);
    };
    req.onerror = () => reject(req.error);
  });
}

// Load data from IndexedDB
async function loadData() {
  // 从 URL 参数解析 bvid
  const params = new URLSearchParams(location.search);
  const bvidParam = params.get("bvid");

  let record = null;
  if (bvidParam) {
    record = await idbGet(bvidParam);
  } else {
    // 无参数时取最新一条
    const all = await idbGetAll();
    record = all.length > 0 ? all[0] : null;
  }

  if (!record) {
    throw new Error("没有找到导出数据");
  }

  exportData = {
    json: record.json,
    comments: record.comments,
    bvid: record.bvid,
    time: record.time,
    count: record.count,
    meta: record.meta
  };

  return exportData;
}

// Display data
function displayData(data) {
  $bvid.textContent = data.bvid;
  $mainCount.textContent = data.meta?.main_total?.toLocaleString() || "--";
  $subCount.textContent = data.meta?.sub_total_fetched?.toLocaleString() || "--";
  $totalCount.textContent = data.meta?.all_total_fetched?.toLocaleString() || "--";
  $dataSize.textContent = formatBytes(new Blob([data.json]).size);
  $exportTime.textContent = data.time ? formatTime(data.time) : "--";
  $duration.textContent = formatDuration(data.meta?.duration_ms);
}

// Event handlers
$downloadJsonBtn.addEventListener("click", async () => {
  if (!exportData) return;

  try {
    $downloadJsonBtn.disabled = true;
    showStatus("⏳", "正在准备下载...");

    const filename = `comments_${exportData.bvid}_plain.json`;
    downloadTextAsJson({ text: exportData.json, filename });

    showStatus("✅", `下载成功！\n文件：${filename}`, "success");
    setTimeout(hideStatus, 3000);
  } catch (error) {
    showStatus("❌", `下载失败：${error.message}`, "error");
  } finally {
    $downloadJsonBtn.disabled = false;
  }
});

$downloadGzipBtn.addEventListener("click", async () => {
  if (!exportData) return;

  try {
    $downloadGzipBtn.disabled = true;
    showStatus("⏳", "正在压缩并准备下载...");

    const filename = `comments_${exportData.bvid}_gzip.json.gz`;
    await downloadGzip({ text: exportData.json, filename });

    showStatus("✅", `下载成功！\n文件：${filename}`, "success");
    setTimeout(hideStatus, 3000);
  } catch (error) {
    showStatus("❌", `下载失败：${error.message}`, "error");
  } finally {
    $downloadGzipBtn.disabled = false;
  }
});

$aiSummaryBtn.addEventListener("click", async () => {
  if (!exportData) return;

  try {
    // 检查配置
    const config = await checkGeminiConfig();
    if (!config.isValid) {
      showStatus("⚠️", "请先在设置页面配置 Gemini API", "error");
      return;
    }

    $aiSummaryBtn.disabled = true;
    showStatus("⏳", "正在准备分析…");

    // 两阶段模式：system_prompt_stage2.md + user_prompt_stage2.md
    // 单阶段模式：system_prompt.md + user_prompt.md
    const [systemPrompt, userPromptStage2] = await Promise.all([
      USE_TWO_STAGE_ANALYSIS
        ? loadSystemPromptStage2(config.promptTemplate)
        : loadSystemPrompt(config.promptTemplate),
      USE_TWO_STAGE_ANALYSIS
        ? (async () => {
            // 优先使用用户自定义（storage），fallback 到文件
            const key = `userPromptStage2_${config.promptTemplate}`;
            const stored = await new Promise(r =>
              chrome.storage.local.get({ [key]: null }, res => r(res[key]))
            );
            if (stored !== null) return stored;
            const url = chrome.runtime.getURL(`scenes/${encodeURIComponent(config.promptTemplate)}/user_prompt_stage2.md`);
            const res = await fetch(url);
            if (!res.ok) throw new Error(`user_prompt_stage2.md 不存在：scenes/${config.promptTemplate}/`);
            return res.text();
          })()
        : loadUserPrompt(config.promptTemplate),
    ]);

    // 加载关键词并过滤（keywords 为 null 时跳过，发全量数据）
    const keywords = await loadKeywords(config.promptTemplate);
    const filteredComments = keywords
      ? filterThreadsByKeywords(exportData.comments, keywords)
      : exportData.comments;

    if (keywords) {
      const total = exportData.comments.length;
      const kept = filteredComments.length;
      showStatus("⏳", `关键词筛选：保留 ${kept} / ${total} 个话题…`);
    }

    const apiConfig = {
      apiEndpoint: config.apiEndpoint,
      apiKey: config.apiKey,
      modelName: config.modelName || "gemini-2.5-flash",
      temperature: config.temperature ?? 0.1,
      disableThinking: config.disableThinking ?? true,
    };

    if (USE_TWO_STAGE_ANALYSIS) {
      // ── 两阶段流水线 ─────────────────────────────────────────
      const [systemPromptStage1, userPromptStage1] = await Promise.all([
        loadSystemPromptStage1(config.promptTemplate),
        loadStage1Prompt(config.promptTemplate),
      ]);
      if (!userPromptStage1) {
        throw new Error(
          `已启用两阶段分析，但当前场景缺少 user_prompt_stage1.md（scenes/${config.promptTemplate}/user_prompt_stage1.md）`
        );
      }

      const result = await runTwoStageAnalysis({
        apiConfig, systemPrompt, systemPromptStage1,
        userPromptStage1, userPromptStage2,
        filteredComments, bvid: exportData.bvid
      });
      await idbSaveSummary({ bvid: exportData.bvid, scene: config.promptTemplate, data: result });
      await chrome.tabs.create({
        url: chrome.runtime.getURL("summary.html") + "?bvid=" + encodeURIComponent(exportData.bvid),
        active: true
      });
      showStatus("✅", "AI 分析完成，已在新标签页打开摘要", "success");

    } else {
      // ── 原有单次调用路径（USE_TWO_STAGE_ANALYSIS = false）────
      showStatus("⏳", "正在调用 Gemini API 进行分析…");
      const aiResponse = await callGeminiAPI({
        ...apiConfig, systemPrompt,
        userPrompt: userPromptStage2,
        commentsData: { bvid: exportData.bvid, comments: filteredComments }
      });
      const stripped = aiResponse.text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
      const data = JSON.parse(stripped);
      if (aiResponse.truncated) data._truncated = true;
      await idbSaveSummary({ bvid: exportData.bvid, scene: config.promptTemplate, data });
      await chrome.tabs.create({
        url: chrome.runtime.getURL("summary.html") + "?bvid=" + encodeURIComponent(exportData.bvid),
        active: true
      });
      showStatus(
        aiResponse.truncated ? "⚠️" : "✅",
        aiResponse.truncated ? "AI 总结完成，但输出可能不完整，已在新标签页打开摘要" : "AI 总结完成，已在新标签页打开摘要",
        aiResponse.truncated ? "warning" : "success"
      );
    }

    setTimeout(hideStatus, 5000);
  } catch (error) {
    showStatus("❌", `AI 总结失败：${error.message}`, "error");
  } finally {
    $aiSummaryBtn.disabled = false;
  }
});

$openSettings.addEventListener("click", (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});

// Initialize
async function init() {
  try {
    showStatus("⏳", "正在加载数据...");

    const data = await loadData();
    displayData(data);

    // 检查 Gemini 配置
    const config = await checkGeminiConfig();
    if (config.isValid) {
      $aiConfigHint.innerHTML = `已配置 Gemini API &nbsp;·&nbsp; <a href="#" id="openSettings">修改设置</a>`;
      $aiConfigHint.style.color = "var(--success)";
      document.getElementById("openSettings").addEventListener("click", (e) => {
        e.preventDefault();
        chrome.runtime.openOptionsPage();
      });
    }

    hideStatus();
  } catch (error) {
    showStatus("❌", `加载失败：${error.message}\n请先导出评论数据`, "error");
    $downloadJsonBtn.disabled = true;
    $downloadGzipBtn.disabled = true;
    $aiSummaryBtn.disabled = true;
  }
}

init();
