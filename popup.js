const $bvid = document.getElementById("bvid");
const $status = document.getElementById("status");
const $btn = document.getElementById("exportBtn");
const $stopBtn = document.getElementById("stopBtn");
const $viewResultsBtn = document.getElementById("viewResultsBtn");
const $clearCacheBtn = document.getElementById("clearCacheBtn");
const $cacheNotice = document.getElementById("cacheNotice");
const $cacheInfo = document.getElementById("cacheInfo");
const $tabExport = document.getElementById("tabExport");
const $tabLibrary = document.getElementById("tabLibrary");
const $contentExport = document.getElementById("contentExport");
const $contentLibrary = document.getElementById("contentLibrary");
const $libraryList = document.getElementById("libraryList");

// 当前视频页的 bvid（init 后赋值，供 switchTab 等函数使用）
let currentBvid = null;

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

async function idbGet(bvid) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("exports", "readonly");
    const req = tx.objectStore("exports").get(bvid);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

async function idbDelete(bvid) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("exports", "readwrite");
    tx.objectStore("exports").delete(bvid);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

async function idbClear() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("exports", "readwrite");
    tx.objectStore("exports").clear();
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

// 检查当前视频是否有缓存
async function checkCache(bvid) {
  const record = await idbGet(bvid);
  if (record) {
    return {
      hasCache: true,
      bvid: record.bvid,
      time: record.time,
      count: record.count,
      meta: record.meta
    };
  }
  return { hasCache: false };
}

// 检查是否有任何缓存（不限制 bvid），用于控制清除缓存按钮显示
async function checkAnyCache() {
  const records = await idbGetAll();
  return records.length > 0;
}

// 刷新导出 tab 的缓存状态（切回 export tab 时调用）
async function refreshCacheStatus(bvid) {
  const cacheData = await checkCache(bvid);
  if (cacheData.hasCache) {
    showCacheInfo(cacheData);
    setStatus("检测到缓存数据。可以查看已有结果或重新导出。");
  } else {
    $cacheNotice.classList.remove("visible");
    $viewResultsBtn.classList.remove("visible");
    $btn.textContent = "一键导出";
    setStatus("就绪。点击【一键导出】开始抓取。");
  }
  $clearCacheBtn.style.display = (await checkAnyCache()) ? "block" : "none";
}

// 显示缓存信息
function showCacheInfo(cacheData) {
  const timeStr = new Date(cacheData.time).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });

  const totalCount = cacheData.meta?.all_total_fetched || cacheData.count;

  $cacheInfo.textContent = `${totalCount.toLocaleString()} 条评论 | ${timeStr}`;
  $cacheNotice.classList.add("visible");
  $viewResultsBtn.classList.add("visible");
  $clearCacheBtn.style.display = "block";
  $btn.textContent = "重新导出";
}

// 更新进行中条目的进度（只更新 DOM，不重渲染整个列表）
async function updateProgressCard() {
  if (!$contentLibrary.classList.contains("active")) return;
  const item = $libraryList.querySelector(".library-item-active");
  if (!item) return;

  const { progressFetched, progressTotal } = await chrome.storage.local.get({
    progressFetched: 0,
    progressTotal: 0
  });

  if (progressTotal <= 0) return;

  const pct = Math.min(100, Math.round(progressFetched / progressTotal * 100));
  item.querySelector(".library-item-progress-text").textContent =
    `${progressFetched.toLocaleString()} / ${progressTotal.toLocaleString()} 条`;
  const pctEl = item.querySelector(".library-item-pct");
  pctEl.textContent = `${pct}%`;
  pctEl.style.color = "";
  pctEl.style.fontSize = "";
  item.querySelector(".progress-fill").style.width = `${pct}%`;
}

// 渲染已下载列表（含进行中条目）
async function renderLibrary() {
  const { exportingBvid, progressFetched, progressTotal } = await chrome.storage.local.get({
    exportingBvid: null,
    progressFetched: 0,
    progressTotal: 0
  });

  $libraryList.innerHTML = "";

  // 进行中条目（排在列表顶部）
  if (exportingBvid) {
    const hasProgress = progressTotal > 0;
    const pct = hasProgress
      ? Math.min(100, Math.round(progressFetched / progressTotal * 100))
      : 0;

    const activeItem = document.createElement("div");
    activeItem.className = "library-item-active";
    activeItem.innerHTML = hasProgress
      ? `<div class="library-item-active-body">
           <div class="library-item-info">
             <div class="library-item-bvid"><a href="https://www.bilibili.com/video/${exportingBvid}/" target="_blank">${exportingBvid}</a></div>
             <div class="library-item-progress-text">${progressFetched.toLocaleString()} / ${progressTotal.toLocaleString()} 条</div>
           </div>
           <div class="library-item-pct">${pct}%</div>
         </div>
         <div class="progress-track"><div class="progress-fill" style="width:${pct}%"></div></div>`
      : `<div class="library-item-active-body">
           <div class="library-item-info">
             <div class="library-item-bvid"><a href="https://www.bilibili.com/video/${exportingBvid}/" target="_blank">${exportingBvid}</a></div>
             <div class="library-item-progress-text">导出进行中
               <span class="dot-loader"><span></span><span></span><span></span></span>
             </div>
           </div>
           <div class="library-item-pct" style="color:var(--text-muted);font-size:13px;">…</div>
         </div>
         <div class="progress-track"><div class="progress-fill" style="width:0%"></div></div>`;
    activeItem.querySelector(".library-item-bvid a").addEventListener("click", async (e) => {
      e.preventDefault();
      await chrome.tabs.create({ url: `https://www.bilibili.com/video/${exportingBvid}/`, active: true });
    });
    $libraryList.appendChild(activeItem);
  }

  // 已完成条目
  const records = await idbGetAll();
  if (records.length === 0 && !exportingBvid) {
    $libraryList.innerHTML = '<div class="library-empty">暂无下载记录</div>';
    return;
  }

  for (const rec of records) {
    const timeStr = new Date(rec.time).toLocaleString('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
    const totalCount = rec.meta?.all_total_fetched || rec.count;

    const item = document.createElement("div");
    item.className = "library-item";
    item.innerHTML = `
      <div class="library-item-info">
        <div class="library-item-bvid"><a href="https://www.bilibili.com/video/${rec.bvid}/" target="_blank">${rec.bvid}</a></div>
        <div class="library-item-meta">${totalCount.toLocaleString()} 条评论 · ${timeStr}</div>
      </div>
      <div class="library-item-actions">
        <button class="lib-btn lib-btn-view" data-bvid="${rec.bvid}">查看</button>
        <button class="lib-btn lib-btn-del" data-bvid="${rec.bvid}">删除</button>
      </div>
    `;

    item.querySelector(".library-item-bvid a").addEventListener("click", async (e) => {
      e.preventDefault();
      await chrome.tabs.create({ url: `https://www.bilibili.com/video/${rec.bvid}/`, active: true });
    });

    item.querySelector(".lib-btn-view").addEventListener("click", async () => {
      const url = chrome.runtime.getURL("results.html") + "?bvid=" + encodeURIComponent(rec.bvid);
      await chrome.tabs.create({ url, active: true });
    });

    item.querySelector(".lib-btn-del").addEventListener("click", async () => {
      await idbDelete(rec.bvid);
      await renderLibrary();
      if (!(await checkAnyCache())) {
        $clearCacheBtn.style.display = "none";
      }
    });

    $libraryList.appendChild(item);
  }
}

// Tab 切换
function switchTab(tab) {
  if (tab === "export") {
    $tabExport.classList.add("active");
    $tabLibrary.classList.remove("active");
    $contentExport.classList.add("active");
    $contentLibrary.classList.remove("active");
    if (currentBvid) refreshCacheStatus(currentBvid);
  } else {
    $tabLibrary.classList.add("active");
    $tabExport.classList.remove("active");
    $contentLibrary.classList.add("active");
    $contentExport.classList.remove("active");
    renderLibrary();
  }
}

$tabExport.addEventListener("click", () => switchTab("export"));
$tabLibrary.addEventListener("click", () => switchTab("library"));

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

  currentBvid = bvid;
  $bvid.textContent = bvid;

  // 检查是否正在导出（关联 bvid）
  const { exportingBvid } = await chrome.storage.local.get({ exportingBvid: null });
  if (exportingBvid === bvid) {
    // 当前视频正在导出，显示停止按钮
    $btn.style.display = "none";
    $stopBtn.style.display = "block";
    $stopBtn.disabled = false;
    setStatus("导出进行中...");
  }

  // 检查当前视频是否有缓存（控制缓存提示和重新导出按钮）
  const cacheData = await checkCache(bvid);
  if (cacheData.hasCache) {
    showCacheInfo(cacheData);
    setStatus("检测到缓存数据。可以查看已有结果或重新导出。");
  } else {
    setStatus("就绪。点击【一键导出】开始抓取。");
  }

  // 检查是否有任何缓存（控制扫帚图标显示）
  if (await checkAnyCache()) {
    $clearCacheBtn.style.display = "block";
  }

  $btn.disabled = false;

  // 查看结果按钮
  $viewResultsBtn.addEventListener("click", async () => {
    const url = chrome.runtime.getURL("results.html") + "?bvid=" + encodeURIComponent(bvid);
    await chrome.tabs.create({ url, active: true });
  });

  // 清除缓存图标按钮
  $clearCacheBtn.addEventListener("click", async () => {
    const confirmed = confirm("确定要清除所有缓存数据吗？\n\n此操作不可恢复。");
    if (!confirmed) return;

    try {
      await idbClear();
      // 只删除旧的 lastExport* key，保留 Gemini 配置和 exportingBvid
      await chrome.storage.local.remove([
        'lastExportedComments',
        'lastExportedJson',
        'lastExportBvid',
        'lastExportTime',
        'lastExportCount',
        'lastExportMeta'
      ]);

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
    // 检查是否有其他视频正在导出
    const { exportingBvid } = await chrome.storage.local.get({ exportingBvid: null });
    if (exportingBvid && exportingBvid !== bvid) {
      alert(`当前正在导出其他视频的评论（${exportingBvid}），请稍后再试。`);
      return;
    }

    // 如果有缓存，确认是否要重新导出
    const cacheData = await checkCache(bvid);
    if (cacheData.hasCache) {
      const confirmed = confirm("检测到已有缓存数据，确定要重新导出吗？\n\n重新导出将覆盖现有缓存。");
      if (!confirmed) {
        return;
      }

      // 用户确认重新导出，从 IndexedDB 删除该 bvid 的记录，并更新 UI
      await idbDelete(bvid);

      $cacheNotice.classList.remove("visible");
      $viewResultsBtn.classList.remove("visible");
      if (!(await checkAnyCache())) {
        $clearCacheBtn.style.display = "none";
      }
      $btn.textContent = "一键导出";
    }

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
    updateProgressCard(); // 只更新进度条 DOM，不重渲染列表
    return;
  }

  if (msg.type === "DONE") {
    setStatus(`完成 ✅\n总评论：${msg.all_total_fetched}（主 ${msg.main_total} + 子 ${msg.sub_total_fetched}）\n正在打开结果页面…`, "ok");
    $btn.style.display = "block";
    $btn.disabled = false;
    $stopBtn.style.display = "none";

    const tab = await getActiveTab();
    const currentBvid = parseBvidFromUrl(tab?.url);
    if (currentBvid) {
      const cacheData = await checkCache(currentBvid);
      if (cacheData.hasCache) {
        showCacheInfo(cacheData);
      }
    }
    // 更新扫帚按钮
    if (await checkAnyCache()) {
      $clearCacheBtn.style.display = "block";
    }
    // 下载管理 tab：进行中条目消失，刷新为已完成列表
    if ($contentLibrary.classList.contains("active")) {
      renderLibrary();
    }
    return;
  }

  if (msg.type === "ERROR") {
    setStatus(`失败：${msg.error}`, "err");
    $btn.style.display = "block";
    $btn.disabled = false;
    $stopBtn.style.display = "none";
    return;
  }
});

init();
