const $bvid = document.getElementById("bvid");
const $status = document.getElementById("status");
const $btn = document.getElementById("exportBtn");
const $gzip = document.getElementById("gzip");

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

async function init() {
  // restore gzip option
  chrome.storage.local.get({ gzip: true }, (res) => {
    $gzip.checked = !!res.gzip;
  });

  $gzip.addEventListener("change", () => {
    chrome.storage.local.set({ gzip: $gzip.checked });
  });

  const tab = await getActiveTab();
  const bvid = parseBvidFromUrl(tab?.url);

  if (!bvid) {
    $bvid.textContent = "未检测到（请打开 /video/BV...）";
    setStatus("打开 B 站视频页（URL 含 /video/BV...）后再导出。");
    $btn.disabled = true;
    return;
  }

  $bvid.textContent = bvid;
  setStatus("就绪。点击“一键导出”开始抓取。");
  $btn.disabled = false;

  $btn.addEventListener("click", async () => {
    $btn.disabled = true;
    setStatus("开始导出…");

    try {
      const gzip = $gzip.checked;
      await chrome.runtime.sendMessage({
        type: "EXPORT",
        bvid,
        gzip,
      });
    } catch (e) {
      setStatus(`失败：${e?.message || String(e)}`, "err");
      $btn.disabled = false;
    }
  });
}

chrome.runtime.onMessage.addListener((msg) => {
  if (!msg || typeof msg !== "object") return;

  if (msg.type === "PROGRESS") {
    // Example: "main page 3 ...", "sub root ...", etc.
    setStatus(msg.text || "处理中…");
    return;
  }

  if (msg.type === "DONE") {
    setStatus(`完成 ✅\n文件：${msg.filename}\n总评论：${msg.all_total_fetched}（主 ${msg.main_total} + 子 ${msg.sub_total_fetched}）`, "ok");
    $btn.disabled = false;
    return;
  }

  if (msg.type === "ERROR") {
    setStatus(`失败：${msg.error}`, "err");
    $btn.disabled = false;
    return;
  }
});

init();
