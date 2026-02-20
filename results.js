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
// 从 prompts/ 文件夹加载模板内容
async function loadPromptTemplate(name) {
  const url = chrome.runtime.getURL(`prompts/${encodeURIComponent(name)}.md`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`模板文件不存在：${name}.md`);
  return res.text();
}

const THINKING_MODELS = ["gemini-2.5-flash", "gemini-2.5-pro"];

async function callGeminiAPI({ apiEndpoint, apiKey, modelName, temperature, disableThinking, prompt, commentsData }) {
  let apiUrl = apiEndpoint.trim();

  // 如果API地址是Gemini官方格式，需要拼接模型名和方法
  if (apiUrl.includes("generativelanguage.googleapis.com")) {
    if (!apiUrl.endsWith("/")) apiUrl += "/";
    apiUrl = `${apiUrl}${modelName}:generateContent?key=${apiKey}`;
  }

  const requestBody = {
    contents: [
      {
        parts: [
          {
            text: `${prompt}\n\n以下是评论数据（JSON格式）：\n\n${JSON.stringify(commentsData)}`
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
    if (finishReason === "MAX_TOKENS") {
      // 输出被截断但仍有内容，继续使用
      console.warn("Gemini 输出达到 token 上限，结果可能不完整");
    }
    if (!candidate?.content?.parts?.[0]?.text) {
      throw new Error(`Gemini API返回格式异常 (finishReason: ${finishReason})。响应: ${JSON.stringify(data).slice(0, 500)}`);
    }

    return candidate.content.parts[0].text;
  } catch (error) {
    clearTimeout(timeoutId);

    if (error.name === 'AbortError') {
      throw new Error('Gemini API请求超时（5分钟），评论数据可能过大，请稍后重试');
    }

    throw error;
  }
}

async function downloadMarkdown({ text, filename }) {
  const enc = new TextEncoder();
  const bytes = enc.encode(text);
  downloadFile({ bytes, filename, mime: "text/markdown;charset=utf-8" });
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
    const req = indexedDB.open("comment-insight", 1);
    req.onupgradeneeded = (e) => {
      e.target.result.createObjectStore("exports", { keyPath: "bvid" });
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
    showStatus("⏳", "正在调用 Gemini API 进行分析...\n这可能需要一些时间，请耐心等待");

    // 从文件加载模板内容
    const prompt = await loadPromptTemplate(config.promptTemplate);

    // 调用API
    const aiResponse = await callGeminiAPI({
      apiEndpoint: config.apiEndpoint,
      apiKey: config.apiKey,
      modelName: config.modelName || "gemini-2.5-flash",
      temperature: config.temperature || 0.1,
      disableThinking: config.disableThinking ?? true,
      prompt: prompt,
      commentsData: { bvid: exportData.bvid, comments: exportData.comments }
    });

    // 下载结果
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const filename = `ai_summary_${exportData.bvid}_${timestamp}.md`;
    await downloadMarkdown({ text: aiResponse, filename });

    showStatus("✅", `AI 总结完成！\n文件：${filename}`, "success");
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
