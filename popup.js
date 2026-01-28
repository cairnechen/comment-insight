const $bvid = document.getElementById("bvid");
const $status = document.getElementById("status");
const $btn = document.getElementById("exportBtn");
const $viewResultsBtn = document.getElementById("viewResultsBtn");
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
  $cacheNotice.style.display = "flex";
  $viewResultsBtn.style.display = "block";
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

  // 导出按钮
  $btn.addEventListener("click", async () => {
    // 如果有缓存，确认是否要重新导出
    const cacheData = await checkCache(bvid);
    if (cacheData.hasCache && $btn.textContent === "重新导出") {
      const confirmed = confirm("检测到已有缓存数据，确定要重新导出吗？\n\n重新导出将覆盖现有缓存。");
      if (!confirmed) {
        return;
      }
    }

    $btn.disabled = true;
    setStatus("开始导出…");

    try {
      await chrome.runtime.sendMessage({
        type: "EXPORT",
        bvid,
      });
    } catch (e) {
      setStatus(`失败：${e?.message || String(e)}`, "err");
      $btn.disabled = false;
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
    $btn.disabled = false;

    // 重新检查缓存并更新UI
    const tab = await getActiveTab();
    const bvid = parseBvidFromUrl(tab?.url);
    if (bvid) {
      setTimeout(async () => {
        const cacheData = await checkCache(bvid);
        if (cacheData.hasCache) {
          showCacheInfo(cacheData);
        }
      }, 1000);
    }
    return;
  }

  if (msg.type === "ERROR") {
    setStatus(`失败：${msg.error}`, "err");
    $btn.disabled = false;
    return;
  }
});

init();
