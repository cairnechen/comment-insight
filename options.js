// 预设提示词模板
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

// DOM元素
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
const $promptText = document.getElementById("promptText");
const $savePromptBtn = document.getElementById("savePromptBtn");

// 加载配置
function loadConfig() {
  chrome.storage.local.get({
    apiEndpoint: "https://generativelanguage.googleapis.com/v1beta/models/",
    apiKey: "",
    modelName: "gemini-2.5-flash",
    temperature: 0.7,
    promptTemplate: "summary",
    customPrompt: ""
  }, (res) => {
    $apiEndpoint.value = res.apiEndpoint;
    $apiKey.value = res.apiKey;
    $modelName.value = res.modelName;
    $temperature.value = res.temperature;
    $temperatureValue.textContent = res.temperature;
    $promptTemplate.value = res.promptTemplate;

    // 加载提示词
    if (res.promptTemplate === "custom" && res.customPrompt) {
      $promptText.value = res.customPrompt;
    } else {
      $promptText.value = PROMPT_TEMPLATES[res.promptTemplate] || PROMPT_TEMPLATES.summary;
    }
  });
}

// 保存API配置
function saveConfig() {
  const config = {
    apiEndpoint: $apiEndpoint.value.trim(),
    apiKey: $apiKey.value.trim(),
    modelName: $modelName.value,
    temperature: parseFloat($temperature.value)
  };

  chrome.storage.local.set(config, () => {
    showResult("✓ API配置已保存", "success");
  });
}

// 保存提示词
function savePrompt() {
  const template = $promptTemplate.value;
  const prompt = $promptText.value.trim();

  chrome.storage.local.set({
    promptTemplate: template,
    customPrompt: template === "custom" ? prompt : ""
  }, () => {
    showResult("✓ 提示词已保存", "success");
  });
}

// 测试Gemini API连接
async function testConnection() {
  const apiEndpoint = $apiEndpoint.value.trim();
  const apiKey = $apiKey.value.trim();
  const modelName = $modelName.value;

  if (!apiEndpoint || !apiKey) {
    showResult("❌ 请先填写API地址和API Key", "error");
    return;
  }

  $testApiBtn.disabled = true;
  $testApiBtn.textContent = "测试中...";
  showResult("正在连接Gemini API...", "");

  try {
    // 构建API URL
    let apiUrl = apiEndpoint;
    if (apiUrl.includes("generativelanguage.googleapis.com")) {
      if (!apiUrl.endsWith("/")) apiUrl += "/";
      apiUrl = `${apiUrl}${modelName}:generateContent?key=${apiKey}`;
    }

    // 发送测试请求
    const response = await fetch(apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [{ text: "Hello" }]
          }
        ],
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 100,
        }
      })
    });

    const data = await response.json();

    if (!response.ok) {
      const errorMsg = data?.error?.message || `HTTP ${response.status}`;
      const errorCode = data?.error?.code || response.status;
      showResult(`❌ 连接失败 (${errorCode}): ${errorMsg}`, "error");
    } else if (data?.candidates?.[0]?.content?.parts?.[0]?.text) {
      showResult(`✓ 连接成功！模型 ${modelName} 工作正常`, "success");
    } else {
      showResult(`⚠️ 连接成功但响应格式异常`, "error");
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

$promptTemplate.addEventListener("change", () => {
  const template = $promptTemplate.value;
  if (template === "custom") {
    chrome.storage.local.get({ customPrompt: "" }, (res) => {
      $promptText.value = res.customPrompt || PROMPT_TEMPLATES.custom;
    });
  } else {
    $promptText.value = PROMPT_TEMPLATES[template] || PROMPT_TEMPLATES.summary;
  }
});

$saveConfigBtn.addEventListener("click", saveConfig);
$testApiBtn.addEventListener("click", testConnection);
$savePromptBtn.addEventListener("click", savePrompt);

// 初始化
loadConfig();
