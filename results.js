// DOM elements
const $bvid = document.getElementById("bvid");
const $mainCount = document.getElementById("mainCount");
const $subCount = document.getElementById("subCount");
const $totalCount = document.getElementById("totalCount");
const $dataSize = document.getElementById("dataSize");
const $exportTime = document.getElementById("exportTime");
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
const PROMPT_TEMPLATES = {
  summary: `请分析以下Bilibili视频的评论数据，并提供详细的总结报告。

评论数据是JSON格式，包含以下字段：
- rpid: 评论ID
- mid: 用户ID
- uname: 用户名
- message: 评论内容
- like: 点赞数
- ctime: 发布时间（Unix时间戳）
- location: IP属地（如"IP属地：北京"）
- root: 根评论ID（0表示主评论）
- parent: 父评论ID（0表示主评论）
- dialog: 对话ID（用于关联对话关系）
- replies: 子评论数组（嵌套结构，无回复时为null）

请从以下几个方面进行总结：
1. 评论总体情况（主评论数量、回复数量、活跃程度）
2. 主要讨论话题和观点
3. 用户关注的重点内容
4. 有价值的评论摘录（3-5条）

请用Markdown格式输出，结构清晰，内容简洁。`,

  sentiment: `请对以下Bilibili视频评论进行情感分析。

评论数据是JSON格式，包含用户名(uname)、评论内容(message)、评论ID(rpid)等字段，具有树状结构(replies表示回复)。

请分析：
1. 整体情感倾向（正面/中性/负面的比例）
2. 正面评论的主要内容
3. 负面评论的主要关注点
4. 争议性话题或分歧点
5. 情感强烈的典型评论示例

请用Markdown格式输出，包含数据分析和具体示例。`,

  topics: `请提取和分析以下Bilibili视频评论中的热门话题。

评论数据是JSON格式，具有树状结构，包含评论内容(message)、用户名(uname)、发布时间(ctime)等信息。

请识别：
1. Top 5-10 热门话题/关键词
2. 每个话题的讨论热度（相关评论数量）
3. 代表性评论摘录
4. 话题之间的关联关系
5. 时间趋势（如果能从评论时间看出）

请用Markdown格式输出，使用表格、列表等方式清晰呈现。`,

  controversy: `请分析以下Bilibili视频评论中的争议观点和讨论。

评论数据是JSON格式，树状结构可以显示评论和回复之间的对话关系。

请重点分析：
1. 主要争议点有哪些
2. 不同观点的阵营和论据
3. 激烈争论的典型对话串（利用parent和root字段还原对话）
4. 理性讨论 vs 情绪化争吵的比例
5. 共识观点（如果有）

请用Markdown格式输出，可以用对话形式展示争议讨论。`,

  custom: `请分析以下Bilibili视频的评论数据。

评论数据是JSON格式，包含：
- rpid: 评论ID
- mid: 用户ID
- uname: 用户名
- message: 评论内容
- like: 点赞数
- ctime: 发布时间（Unix时间戳）
- location: IP属地（如"IP属地：北京"）
- root: 根评论ID（0表示主评论）
- parent: 父评论ID（0表示主评论）
- dialog: 对话ID（用于关联对话关系）
- replies: 子评论数组（嵌套结构，无回复时为null）

请根据数据内容进行分析和总结。`
};

async function callGeminiAPI({ apiEndpoint, apiKey, modelName, temperature, prompt, commentsData }) {
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
            text: `${prompt}\n\n以下是评论数据（JSON格式）：\n\n${JSON.stringify(commentsData, null, 2)}`
          }
        ]
      }
    ],
    generationConfig: {
      temperature: temperature,
      topK: 40,
      topP: 0.95,
      maxOutputTokens: 8192,
    }
  };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 60000);

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

    if (!data?.candidates?.[0]?.content?.parts?.[0]?.text) {
      throw new Error(`Gemini API返回格式异常。响应: ${JSON.stringify(data).slice(0, 500)}`);
    }

    return data.candidates[0].content.parts[0].text;
  } catch (error) {
    clearTimeout(timeoutId);

    if (error.name === 'AbortError') {
      throw new Error('Gemini API请求超时（60秒），请检查网络连接或稍后重试');
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
      promptTemplate: "summary",
      customPrompt: ""
    }, (res) => {
      const hasEndpoint = res.apiEndpoint && res.apiEndpoint.trim();
      const hasApiKey = res.apiKey && res.apiKey.trim();

      let hasPrompt = false;
      if (res.promptTemplate === "custom") {
        hasPrompt = res.customPrompt && res.customPrompt.trim();
      } else {
        hasPrompt = true;
      }

      resolve({
        isValid: hasEndpoint && hasApiKey && hasPrompt,
        ...res
      });
    });
  });
}

// Load data from storage
async function loadData() {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get({
      lastExportedJson: null,
      lastExportedComments: null,
      lastExportBvid: null,
      lastExportTime: null,
      lastExportCount: 0,
      lastExportMeta: null
    }, (res) => {
      if (!res.lastExportedJson || !res.lastExportBvid) {
        reject(new Error("没有找到导出数据"));
        return;
      }

      exportData = {
        json: res.lastExportedJson,
        comments: res.lastExportedComments,
        bvid: res.lastExportBvid,
        time: res.lastExportTime,
        count: res.lastExportCount,
        meta: res.lastExportMeta
      };

      resolve(exportData);
    });
  });
}

// Display data
function displayData(data) {
  $bvid.textContent = data.bvid;
  $mainCount.textContent = data.meta?.main_total?.toLocaleString() || "--";
  $subCount.textContent = data.meta?.sub_total_fetched?.toLocaleString() || "--";
  $totalCount.textContent = data.meta?.all_total_fetched?.toLocaleString() || "--";
  $dataSize.textContent = formatBytes(new Blob([data.json]).size);
  $exportTime.textContent = data.time ? formatTime(data.time) : "--";
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

    // 获取prompt
    let prompt = "";
    if (config.promptTemplate === "custom") {
      prompt = config.customPrompt || PROMPT_TEMPLATES.summary;
    } else {
      prompt = PROMPT_TEMPLATES[config.promptTemplate] || PROMPT_TEMPLATES.summary;
    }

    // 调用API
    const aiResponse = await callGeminiAPI({
      apiEndpoint: config.apiEndpoint,
      apiKey: config.apiKey,
      modelName: config.modelName || "gemini-2.0-flash-exp",
      temperature: config.temperature || 0.7,
      prompt: prompt,
      commentsData: exportData.comments
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
      $aiConfigHint.innerHTML = `已配置 Gemini API，点击下方按钮开始分析`;
      $aiConfigHint.style.color = "var(--success)";
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
