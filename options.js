// 可用模板列表（文件名不含 .md 扩展名，顺序即下拉顺序）
const PROMPT_FILES = [
  "美食探店",
];

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
const $savePromptBtn = document.getElementById("savePromptBtn");

// 动态填充模板下拉列表
function buildPromptSelect() {
  $promptTemplate.innerHTML = "";
  for (const name of PROMPT_FILES) {
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
    temperature: 0.7,
    promptTemplate: PROMPT_FILES[0] ?? ""
  }, (res) => {
    $apiEndpoint.value = res.apiEndpoint;
    $apiKey.value = res.apiKey;
    $modelName.value = res.modelName;
    $temperature.value = res.temperature;
    $temperatureValue.textContent = res.temperature;
    // 若已保存的模板仍在列表中则还原，否则回退到第一个
    if (PROMPT_FILES.includes(res.promptTemplate)) {
      $promptTemplate.value = res.promptTemplate;
    }
  });
}

// 保存 API 配置
function saveConfig() {
  chrome.storage.local.set({
    apiEndpoint: $apiEndpoint.value.trim(),
    apiKey: $apiKey.value.trim(),
    modelName: $modelName.value,
    temperature: parseFloat($temperature.value)
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

$saveConfigBtn.addEventListener("click", saveConfig);
$testApiBtn.addEventListener("click", testConnection);
$savePromptBtn.addEventListener("click", savePrompt);

// 初始化
buildPromptSelect();
loadConfig();
