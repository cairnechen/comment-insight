// 可用模板列表（文件名不含 .md 扩展名，顺序即下拉顺序）
const SCENES = [
  "美食探店",
];

// 支持 thinkingConfig 的模型列表
const THINKING_MODELS = ["gemini-2.5-flash", "gemini-2.5-pro"];

// DOM 元素
const $apiEndpoint = document.getElementById("apiEndpoint");
const $apiKey = document.getElementById("apiKey");
const $toggleApiKey = document.getElementById("toggleApiKey");
const $modelName = document.getElementById("modelName");
const $temperature = document.getElementById("temperature");
const $temperatureValue = document.getElementById("temperatureValue");
const $saveConfigBtn = document.getElementById("saveConfigBtn");
const $testApiBtn = document.getElementById("testApiBtn");
const $testResult = document.getElementById("testResult");
const $promptTemplate = document.getElementById("promptTemplate");
const $promptPreview = document.getElementById("promptPreview");
const $savePromptBtn = document.getElementById("savePromptBtn");
const $disableThinking = document.getElementById("disableThinking");
const $thinkingRow = document.getElementById("thinkingRow");

// 加载并显示模板内容（只读预览）
async function loadPromptPreview(name) {
  try {
    const url = chrome.runtime.getURL(`scenes/${encodeURIComponent(name)}/system_prompt.md`);
    const res = await fetch(url);
    $promptPreview.value = res.ok ? await res.text() : "（模板文件未找到）";
  } catch {
    $promptPreview.value = "（加载失败）";
  }
}

// 动态填充模板下拉列表
function buildPromptSelect() {
  $promptTemplate.innerHTML = "";
  for (const name of SCENES) {
    const opt = document.createElement("option");
    opt.value = name;
    opt.textContent = name;
    $promptTemplate.appendChild(opt);
  }
}

// 加载配置
function loadConfig() {
  chrome.storage.local.get({
    apiEndpoint: "https://generativelanguage.googleapis.com/v1beta/models/",
    apiKey: "",
    modelName: "gemini-2.5-flash",
    temperature: 0.1,
    disableThinking: true,
    promptTemplate: SCENES[0] ?? ""
  }, (res) => {
    $apiEndpoint.value = res.apiEndpoint;
    $apiKey.value = res.apiKey;
    $modelName.value = res.modelName;
    $temperature.value = res.temperature;
    $temperatureValue.textContent = res.temperature;
    $disableThinking.checked = res.disableThinking;
    updateThinkingVisibility();
    // 若已保存的模板仍在列表中则还原，否则回退到第一个
    if (SCENES.includes(res.promptTemplate)) {
      $promptTemplate.value = res.promptTemplate;
    }
  });
}

// 根据所选模型显示/隐藏思考模式开关
function updateThinkingVisibility() {
  $thinkingRow.style.display = THINKING_MODELS.includes($modelName.value) ? "" : "none";
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

// 保存所选模板
function savePrompt() {
  chrome.storage.local.set({
    promptTemplate: $promptTemplate.value
  }, () => {
    showResult("✓ 模板已保存", "success");
  });
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

// 显示结果提示
function showResult(message, type) {
  $testResult.textContent = message;
  $testResult.className = `result ${type}`;
  $testResult.style.display = "block";
}

// 事件监听
$toggleApiKey.addEventListener("click", () => {
  $apiKey.type = $apiKey.type === "password" ? "text" : "password";
});

$temperature.addEventListener("input", () => {
  $temperatureValue.textContent = $temperature.value;
});

$modelName.addEventListener("change", updateThinkingVisibility);
$saveConfigBtn.addEventListener("click", saveConfig);
$testApiBtn.addEventListener("click", testConnection);
$savePromptBtn.addEventListener("click", savePrompt);
$promptTemplate.addEventListener("change", () => loadPromptPreview($promptTemplate.value));

// 初始化
buildPromptSelect();
loadConfig();
loadPromptPreview(SCENES[0]);
