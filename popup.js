const $bvid = document.getElementById("bvid");
const $status = document.getElementById("status");
const $btn = document.getElementById("exportBtn");
const $stopBtn = document.getElementById("stopBtn");
const $viewResultsBtn = document.getElementById("viewResultsBtn");
const $clearCacheBtn = document.getElementById("clearCacheBtn");
const $cacheNotice = document.getElementById("cacheNotice");
const $cacheInfo = document.getElementById("cacheInfo");

function setStatus(text, kind = "muted") {
  $status.textContent = text;
  $status.classList.remove("ok", "err");
  if (kind === "ok") $status.classList.add("ok");
  if (kind === "err") $status.classList.add("err");
}

function parseBvidFromUrl(url) {
  if (!url) return null;
  const m = url.match(/\/video\/(BV[0-9A-Za-z]+)\b/);
  return m ? m[1] : null;
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

// 检查当前视频是否有缓存
async function checkCache(bvid) {
  return new Promise((resolve) => {
    chrome.storage.local.get({
      lastExportBvid: null,
      lastExportTime: null,
      lastExportCount: 0,
      lastExportMeta: null
    }, (res) => {
      if (res.lastExportBvid === bvid && res.lastExportTime) {
        resolve({
          hasCache: true,
          bvid: res.lastExportBvid,
          time: res.lastExportTime,
          count: res.lastExportCount,
          meta: res.lastExportMeta
        });
      } else {
        resolve({ hasCache: false });
      }
    });
  });
}

// 显示缓存信息
function showCacheInfo(cacheData) {
  const timeStr = new Date(cacheData.time).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });

  const mainCount = cacheData.meta?.main_total || cacheData.count;
  const totalCount = cacheData.meta?.all_total_fetched || cacheData.count;

  $cacheInfo.textContent = `${totalCount.toLocaleString()} 条评论 | ${timeStr}`;
  $cacheNotice.classList.add("visible");
  $viewResultsBtn.classList.add("visible");
  $clearCacheBtn.style.display = "block"; // 显示清除缓存图标
  $btn.textContent = "重新导出";
}

async function init() {
  let bvid = null;

  try {
    const tab = await getActiveTab();
    console.log("[Popup] Current tab URL:", tab?.url);

    bvid = parseBvidFromUrl(tab?.url);
    console.log("[Popup] Parsed BVID:", bvid);

    if (!bvid) {
      $bvid.textContent = "未检测到（请打开 /video/BV...）";
      setStatus("打开 B 站视频页（URL 含 /video/BV...）后再导出。");
      $btn.disabled = true;
      return;
    }
  } catch (error) {
    console.error("[Popup] Init error:", error);
    $bvid.textContent = "初始化错误";
    setStatus(`错误：${error.message}`);
    $btn.disabled = true;
    return;
  }

  $bvid.textContent = bvid;

  // 检查是否正在导出
  const { isExporting } = await chrome.storage.local.get({ isExporting: false });
  if (isExporting) {
    // 正在导出，显示停止按钮
    $btn.style.display = "none";
    $stopBtn.style.display = "block";
    $stopBtn.disabled = false;
    setStatus("导出进行中...");
  }

  // 检查是否有缓存
  const cacheData = await checkCache(bvid);
  if (cacheData.hasCache) {
    showCacheInfo(cacheData);
    setStatus("检测到缓存数据。可以查看已有结果或重新导出。");
  } else {
    setStatus("就绪。点击【一键导出】开始抓取。");
  }

  $btn.disabled = false;

  // 查看结果按钮
  $viewResultsBtn.addEventListener("click", async () => {
    await chrome.tabs.create({
      url: chrome.runtime.getURL("results.html"),
      active: true
    });
  });

  // 清除缓存图标按钮
  $clearCacheBtn.addEventListener("click", async () => {
    const confirmed = confirm("确定要清除所有缓存数据吗？\n\n此操作不可恢复。");
    if (!confirmed) return;

    try {
      // 清空所有缓存
      await chrome.storage.local.clear();

      // 更新 UI
      $cacheNotice.classList.remove("visible");
      $viewResultsBtn.classList.remove("visible");
      $clearCacheBtn.style.display = "none";
      $btn.textContent = "一键导出";

      setStatus("缓存已清除");
    } catch (e) {
      setStatus(`清除失败：${e?.message || String(e)}`, "err");
    }
  });

  // 停止按钮
  $stopBtn.addEventListener("click", async () => {
    try {
      await chrome.runtime.sendMessage({ type: "STOP_EXPORT" });
      $stopBtn.disabled = true;
      setStatus("正在停止…");
    } catch (e) {
      console.error("停止失败:", e);
    }
  });

  // 导出按钮
  $btn.addEventListener("click", async () => {
    // 如果有缓存，确认是否要重新导出
    const cacheData = await checkCache(bvid);
    if (cacheData.hasCache && $btn.textContent === "重新导出") {
      const confirmed = confirm("检测到已有缓存数据，确定要重新导出吗？\n\n重新导出将覆盖现有缓存。");
      if (!confirmed) {
        return;
      }

      // 用户确认重新导出，立即清除缓存并更新 UI
      await chrome.storage.local.remove([
        'lastExportedComments',
        'lastExportedJson',
        'lastExportBvid',
        'lastExportTime',
        'lastExportCount',
        'lastExportMeta'
      ]);

      // 隐藏缓存提示、查看结果按钮和清除缓存图标
      $cacheNotice.classList.remove("visible");
      $viewResultsBtn.classList.remove("visible");
      $clearCacheBtn.style.display = "none";
      $btn.textContent = "一键导出";
    }

    // 隐藏导出按钮，显示停止按钮
    $btn.style.display = "none";
    $stopBtn.style.display = "block";
    $stopBtn.disabled = false;
    setStatus("开始导出…");

    try {
      await chrome.runtime.sendMessage({
        type: "EXPORT",
        bvid,
      });
    } catch (e) {
      setStatus(`失败：${e?.message || String(e)}`, "err");
      $btn.style.display = "block";
      $btn.disabled = false;
      $stopBtn.style.display = "none";
    }
  });
}

chrome.runtime.onMessage.addListener(async (msg) => {
  if (!msg || typeof msg !== "object") return;

  if (msg.type === "PROGRESS") {
    setStatus(msg.text || "处理中…");
    return;
  }

  if (msg.type === "DONE") {
    setStatus(`完成 ✅\n总评论：${msg.all_total_fetched}（主 ${msg.main_total} + 子 ${msg.sub_total_fetched}）\n正在打开结果页面…`, "ok");
    // 显示导出按钮，隐藏停止按钮
    $btn.style.display = "block";
    $btn.disabled = false;
    $stopBtn.style.display = "none";

    // 立即检查缓存并更新UI（不需要延迟，因为 DONE 消息时缓存已保存）
    const tab = await getActiveTab();
    const bvid = parseBvidFromUrl(tab?.url);
    if (bvid) {
      const cacheData = await checkCache(bvid);
      if (cacheData.hasCache) {
        showCacheInfo(cacheData);
      }
    }
    return;
  }

  if (msg.type === "ERROR") {
    setStatus(`失败：${msg.error}`, "err");
    // 显示导出按钮，隐藏停止按钮
    $btn.style.display = "block";
    $btn.disabled = false;
    $stopBtn.style.display = "none";
    return;
  }
});

init();
