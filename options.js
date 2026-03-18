// 与 results.js 保持一致；切换时两处同步修改
const USE_TWO_STAGE_ANALYSIS = true;

const SCENES = [
  { name: "美食探店", icon: "🍜", desc: "识别推荐 / 避雷店铺" },
  { name: "网文小说",  icon: "📚", desc: "挖掘小说推荐与评价" },
  { name: "影视动漫",  icon: "🎬", desc: "提取剧集 / 番剧讨论" },
  { name: "UP主推荐",  icon: "👤", desc: "发现优质 UP 主推荐" },
];

// 支持 thinkingConfig 的模型列表
const THINKING_MODELS = ["gemini-2.5-flash", "gemini-2.5-pro", "gemini-3-flash-preview", "gemini-3.1-pro-preview"];

// DOM 元素
const $apiEndpoint   = document.getElementById("apiEndpoint");
const $apiKey        = document.getElementById("apiKey");
const $toggleApiKey  = document.getElementById("toggleApiKey");
const $modelName     = document.getElementById("modelName");
const $temperature   = document.getElementById("temperature");
const $temperatureValue = document.getElementById("temperatureValue");
const $saveConfigBtn = document.getElementById("saveConfigBtn");
const $testApiBtn    = document.getElementById("testApiBtn");
const $testResult    = document.getElementById("testResult");
const $sceneGrid     = document.getElementById("sceneGrid");
const $promptPreview = document.getElementById("promptPreview");
const $savePromptBtn = document.getElementById("savePromptBtn");
const $resetPromptBtn = document.getElementById("resetPromptBtn");
const $promptResult  = document.getElementById("promptResult");
const $disableThinking = document.getElementById("disableThinking");
const $thinkingRow   = document.getElementById("thinkingRow");

let currentScene = SCENES[0].name;

// 根据两阶段开关决定 storage key 和文件名
function userPromptKey(name) {
  return USE_TWO_STAGE_ANALYSIS ? `userPromptStage2_${name}` : `userPrompt_${name}`;
}
function userPromptFile(name) {
  return USE_TWO_STAGE_ANALYSIS
    ? `scenes/${encodeURIComponent(name)}/user_prompt_stage2.md`
    : `scenes/${encodeURIComponent(name)}/user_prompt.md`;
}

// 优先从 storage 读取自定义 user_prompt，fallback 到文件
async function loadUserPromptForScene(name) {
  const key = userPromptKey(name);
  const stored = await new Promise(r =>
    chrome.storage.local.get({ [key]: null }, res => r(res[key]))
  );
  if (stored !== null) {
    $promptPreview.value = stored;
    return;
  }
  try {
    const url = chrome.runtime.getURL(userPromptFile(name));
    const res = await fetch(url);
    $promptPreview.value = res.ok ? await res.text() : "（模板文件未找到）";
  } catch {
    $promptPreview.value = "（加载失败）";
  }
}

// 切换选中场景
function selectScene(name) {
  currentScene = name;
  document.querySelectorAll(".scene-card").forEach(card => {
    card.classList.toggle("selected", card.dataset.scene === name);
  });
  loadUserPromptForScene(name);
}

// 加载配置
function loadConfig() {
  chrome.storage.local.get({
    apiEndpoint: "https://generativelanguage.googleapis.com/v1beta/models/",
    apiKey: "",
    modelName: "gemini-2.5-flash",
    temperature: 0.1,
    disableThinking: true,
    promptTemplate: SCENES[0].name
  }, (res) => {
    $apiEndpoint.value = res.apiEndpoint;
    $apiKey.value = res.apiKey;
    $modelName.value = res.modelName;
    $temperature.value = res.temperature;
    $temperatureValue.textContent = res.temperature;
    $disableThinking.checked = res.disableThinking;
    updateThinkingVisibility();
    const sceneName = SCENES.some(s => s.name === res.promptTemplate)
      ? res.promptTemplate
      : SCENES[0].name;
    selectScene(sceneName);
  });
}

// 根据所选模型显示/隐藏思考模式开关；切换到支持思考的模型时默认关闭思考
function updateThinkingVisibility(setDefault = false) {
  const isThinking = THINKING_MODELS.includes($modelName.value);
  $thinkingRow.style.display = isThinking ? "" : "none";
  if (isThinking && setDefault) $disableThinking.checked = true;
}

// 保存 API 配置
function saveConfig() {
  chrome.storage.local.set({
    apiEndpoint: $apiEndpoint.value.trim(),
    apiKey: $apiKey.value.trim(),
    modelName: $modelName.value,
    temperature: parseFloat($temperature.value),
    disableThinking: $disableThinking.checked
  }, () => {
    showResult("✓ API 配置已保存", "success");
  });
}

// 保存场景选择和自定义 user_prompt
function savePrompt() {
  const key = userPromptKey(currentScene);
  chrome.storage.local.set(
    { promptTemplate: currentScene, [key]: $promptPreview.value.trim() },
    () => showPromptResult("✓ 场景与提示词已保存", "success")
  );
}

// 测试 Gemini API 连接
async function testConnection() {
  const apiEndpoint = $apiEndpoint.value.trim();
  const apiKey = $apiKey.value.trim();
  const modelName = $modelName.value;

  if (!apiEndpoint || !apiKey) {
    showResult("❌ 请先填写 API 地址和 API Key", "error");
    return;
  }

  $testApiBtn.disabled = true;
  $testApiBtn.textContent = "测试中...";
  showResult("正在连接 Gemini API...", "");

  try {
    let apiUrl = apiEndpoint;
    if (apiUrl.includes("generativelanguage.googleapis.com")) {
      if (!apiUrl.endsWith("/")) apiUrl += "/";
      apiUrl = `${apiUrl}${modelName}:generateContent?key=${apiKey}`;
    }

    const response = await fetch(apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: "Hello" }] }],
        generationConfig: { temperature: 0.7, maxOutputTokens: 100 }
      })
    });

    const data = await response.json();
    if (!response.ok) {
      const errorMsg = data?.error?.message || `HTTP ${response.status}`;
      showResult(`❌ 连接失败 (${data?.error?.code || response.status}): ${errorMsg}`, "error");
    } else if (data?.candidates?.[0]?.content?.parts?.[0]?.text) {
      showResult(`✓ 连接成功！模型 ${modelName} 工作正常`, "success");
    } else {
      showResult("⚠️ 连接成功但响应格式异常", "error");
    }
  } catch (err) {
    showResult(`❌ 网络错误: ${err.message}`, "error");
  } finally {
    $testApiBtn.disabled = false;
    $testApiBtn.textContent = "🔍 测试连接";
  }
}

// 显示 API 配置区通知
function showResult(message, type) {
  $testResult.textContent = message;
  $testResult.className = `result ${type}`;
  $testResult.style.display = "block";
}

// 显示提示词模板区通知
function showPromptResult(message, type) {
  $promptResult.textContent = message;
  $promptResult.className = `result ${type}`;
  $promptResult.style.display = "block";
}

// 事件监听
$toggleApiKey.addEventListener("click", () => {
  $apiKey.type = $apiKey.type === "password" ? "text" : "password";
});

$temperature.addEventListener("input", () => {
  $temperatureValue.textContent = $temperature.value;
});

$modelName.addEventListener("change", () => updateThinkingVisibility(true));
$saveConfigBtn.addEventListener("click", saveConfig);
$testApiBtn.addEventListener("click", testConnection);
$savePromptBtn.addEventListener("click", savePrompt);

$sceneGrid.addEventListener("click", (e) => {
  const card = e.target.closest(".scene-card");
  if (card) selectScene(card.dataset.scene);
});

$resetPromptBtn.addEventListener("click", async () => {
  const key = userPromptKey(currentScene);
  await new Promise(r => chrome.storage.local.remove(key, r));
  try {
    const url = chrome.runtime.getURL(userPromptFile(currentScene));
    const res = await fetch(url);
    $promptPreview.value = res.ok ? await res.text() : "（模板文件未找到）";
    showPromptResult("↺ 已恢复默认提示词", "success");
  } catch {
    $promptPreview.value = "（加载失败）";
  }
});

// 初始化
loadConfig();
