// =======================
// MV3 Service Worker
// =======================

// 全局停止标志和中止控制器
let shouldStop = false;
let abortController = null; // 用于中止正在进行的网络请求

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === "EXPORT") {
    shouldStop = false; // 重置停止标志
    abortController = new AbortController(); // 创建新的中止控制器
    (async () => {
      try {
        // 设置导出状态为进行中
        await chrome.storage.local.set({ isExporting: true });

        const { bvid } = msg;
        await exportAllComments({ bvid });
        sendResponse({ ok: true });
      } catch (err) {
        // 导出失败，重置状态
        await chrome.storage.local.set({ isExporting: false });

        // 如果是用户手动中止，使用更友好的错误消息
        const errorMsg = err.name === "AbortError"
          ? "导出已被用户手动停止"
          : err?.message || String(err);

        chrome.runtime.sendMessage({
          type: "ERROR",
          error: errorMsg,
        });
        sendResponse({ ok: false, error: errorMsg });
      }
    })();
    return true; // keep channel open for async
  }

  if (msg?.type === "STOP_EXPORT") {
    sendProgress("❌ 用户手动停止导出"); // 先发送停止消息
    shouldStop = true; // 再设置标志，阻止后续 PROGRESS 消息
    if (abortController) {
      abortController.abort(); // 中止所有正在进行的网络请求
    }
    sendResponse({ ok: true });
    return true;
  }

});

// -----------------------
// Utilities
// -----------------------

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 随机延迟，增加 ±30% 的随机波动
function randomSleep(baseMs) {
  const variance = 0.3;
  const min = baseMs * (1 - variance);
  const max = baseMs * (1 + variance);
  const ms = min + Math.random() * (max - min);
  return sleep(Math.round(ms));
}

function sendProgress(text) {
  if (shouldStop) return; // 已停止，不再发送后续进度消息
  chrome.runtime.sendMessage({ type: "PROGRESS", text });
}

function parseAidFromViewApi(respJson) {
  // https://api.bilibili.com/x/web-interface/view?bvid=...
  const data = respJson?.data;
  const aid = data?.aid || data?.cid ? data?.aid : data?.aid;
  if (!aid) throw new Error("无法从 view api 获取 aid/oid");
  return aid;
}

function pickLocation(reply) {
  // e.g. "IP属地：北京"
  return reply?.reply_control?.location || "";
}

// -----------------------
// WBI signing (common snippet)
// -----------------------

// from community-known wbi mixin table
const MIXIN_KEY_ENC_TAB = [
  46, 47, 18, 2, 53, 8, 23, 32,
  15, 50, 10, 31, 58, 3, 45, 35,
  27, 43, 5, 49, 33, 9, 42, 19,
  29, 28, 14, 39, 12, 38, 41, 13,
  37, 48, 7, 16, 24, 55, 40, 61,
  26, 17, 0, 1, 60, 51, 30, 4,
  22, 25, 54, 21, 56, 59, 6, 63,
  57, 62, 11, 36, 20, 34, 44, 52
];

function getMixinKey(orig) {
  let str = "";
  for (const i of MIXIN_KEY_ENC_TAB) str += orig[i] || "";
  return str.slice(0, 32);
}

function sanitizeWbiValue(v) {
  // remove characters: !'()* (and some others)
  return String(v).replace(/[!'()*]/g, "");
}

// Minimal MD5 implementation (small & self-contained)
// Source style: classic JS MD5 pattern (no external deps)
function md5(str) {
  function cmn(q, a, b, x, s, t) {
    a = add32(add32(a, q), add32(x, t));
    return add32((a << s) | (a >>> (32 - s)), b);
  }
  function ff(a, b, c, d, x, s, t) { return cmn((b & c) | (~b & d), a, b, x, s, t); }
  function gg(a, b, c, d, x, s, t) { return cmn((b & d) | (c & ~d), a, b, x, s, t); }
  function hh(a, b, c, d, x, s, t) { return cmn(b ^ c ^ d, a, b, x, s, t); }
  function ii(a, b, c, d, x, s, t) { return cmn(c ^ (b | ~d), a, b, x, s, t); }

  function md5cycle(x, k) {
    let [a, b, c, d] = x;

    a = ff(a, b, c, d, k[0], 7, -680876936);
    d = ff(d, a, b, c, k[1], 12, -389564586);
    c = ff(c, d, a, b, k[2], 17, 606105819);
    b = ff(b, c, d, a, k[3], 22, -1044525330);
    a = ff(a, b, c, d, k[4], 7, -176418897);
    d = ff(d, a, b, c, k[5], 12, 1200080426);
    c = ff(c, d, a, b, k[6], 17, -1473231341);
    b = ff(b, c, d, a, k[7], 22, -45705983);
    a = ff(a, b, c, d, k[8], 7, 1770035416);
    d = ff(d, a, b, c, k[9], 12, -1958414417);
    c = ff(c, d, a, b, k[10], 17, -42063);
    b = ff(b, c, d, a, k[11], 22, -1990404162);
    a = ff(a, b, c, d, k[12], 7, 1804603682);
    d = ff(d, a, b, c, k[13], 12, -40341101);
    c = ff(c, d, a, b, k[14], 17, -1502002290);
    b = ff(b, c, d, a, k[15], 22, 1236535329);

    a = gg(a, b, c, d, k[1], 5, -165796510);
    d = gg(d, a, b, c, k[6], 9, -1069501632);
    c = gg(c, d, a, b, k[11], 14, 643717713);
    b = gg(b, c, d, a, k[0], 20, -373897302);
    a = gg(a, b, c, d, k[5], 5, -701558691);
    d = gg(d, a, b, c, k[10], 9, 38016083);
    c = gg(c, d, a, b, k[15], 14, -660478335);
    b = gg(b, c, d, a, k[4], 20, -405537848);
    a = gg(a, b, c, d, k[9], 5, 568446438);
    d = gg(d, a, b, c, k[14], 9, -1019803690);
    c = gg(c, d, a, b, k[3], 14, -187363961);
    b = gg(b, c, d, a, k[8], 20, 1163531501);
    a = gg(a, b, c, d, k[13], 5, -1444681467);
    d = gg(d, a, b, c, k[2], 9, -51403784);
    c = gg(c, d, a, b, k[7], 14, 1735328473);
    b = gg(b, c, d, a, k[12], 20, -1926607734);

    a = hh(a, b, c, d, k[5], 4, -378558);
    d = hh(d, a, b, c, k[8], 11, -2022574463);
    c = hh(c, d, a, b, k[11], 16, 1839030562);
    b = hh(b, c, d, a, k[14], 23, -35309556);
    a = hh(a, b, c, d, k[1], 4, -1530992060);
    d = hh(d, a, b, c, k[4], 11, 1272893353);
    c = hh(c, d, a, b, k[7], 16, -155497632);
    b = hh(b, c, d, a, k[10], 23, -1094730640);
    a = hh(a, b, c, d, k[13], 4, 681279174);
    d = hh(d, a, b, c, k[0], 11, -358537222);
    c = hh(c, d, a, b, k[3], 16, -722521979);
    b = hh(b, c, d, a, k[6], 23, 76029189);
    a = hh(a, b, c, d, k[9], 4, -640364487);
    d = hh(d, a, b, c, k[12], 11, -421815835);
    c = hh(c, d, a, b, k[15], 16, 530742520);
    b = hh(b, c, d, a, k[2], 23, -995338651);

    a = ii(a, b, c, d, k[0], 6, -198630844);
    d = ii(d, a, b, c, k[7], 10, 1126891415);
    c = ii(c, d, a, b, k[14], 15, -1416354905);
    b = ii(b, c, d, a, k[5], 21, -57434055);
    a = ii(a, b, c, d, k[12], 6, 1700485571);
    d = ii(d, a, b, c, k[3], 10, -1894986606);
    c = ii(c, d, a, b, k[10], 15, -1051523);
    b = ii(b, c, d, a, k[1], 21, -2054922799);
    a = ii(a, b, c, d, k[8], 6, 1873313359);
    d = ii(d, a, b, c, k[15], 10, -30611744);
    c = ii(c, d, a, b, k[6], 15, -1560198380);
    b = ii(b, c, d, a, k[13], 21, 1309151649);
    a = ii(a, b, c, d, k[4], 6, -145523070);
    d = ii(d, a, b, c, k[11], 10, -1120210379);
    c = ii(c, d, a, b, k[2], 15, 718787259);
    b = ii(b, c, d, a, k[9], 21, -343485551);

    x[0] = add32(a, x[0]);
    x[1] = add32(b, x[1]);
    x[2] = add32(c, x[2]);
    x[3] = add32(d, x[3]);
  }

  function md5blk(s) {
    const md5blks = [];
    for (let i = 0; i < 64; i += 4) {
      md5blks[i >> 2] =
        s.charCodeAt(i) +
        (s.charCodeAt(i + 1) << 8) +
        (s.charCodeAt(i + 2) << 16) +
        (s.charCodeAt(i + 3) << 24);
    }
    return md5blks;
  }

  function md51(s) {
    let n = s.length;
    const state = [1732584193, -271733879, -1732584194, 271733878];
    let i;
    for (i = 64; i <= n; i += 64) {
      md5cycle(state, md5blk(s.substring(i - 64, i)));
    }
    s = s.substring(i - 64);
    const tail = new Array(16).fill(0);
    for (i = 0; i < s.length; i++)
      tail[i >> 2] |= s.charCodeAt(i) << ((i % 4) << 3);
    tail[i >> 2] |= 0x80 << ((i % 4) << 3);
    if (i > 55) {
      md5cycle(state, tail);
      for (i = 0; i < 16; i++) tail[i] = 0;
    }
    tail[14] = n * 8;
    md5cycle(state, tail);
    return state;
  }

  function rhex(n) {
    const s = "0123456789abcdef";
    let j, out = "";
    for (j = 0; j < 4; j++)
      out += s.charAt((n >> (j * 8 + 4)) & 0x0f) + s.charAt((n >> (j * 8)) & 0x0f);
    return out;
  }

  function hex(x) {
    for (let i = 0; i < x.length; i++) x[i] = rhex(x[i]);
    return x.join("");
  }

  function add32(a, b) { return (a + b) & 0xffffffff; }

  return hex(md51(str));
}

async function getWbiMixinKey() {
  const navUrl = "https://api.bilibili.com/x/web-interface/nav";
  const res = await fetch(navUrl, {
    method: "GET",
    credentials: "include",
    headers: {
      "accept": "application/json, text/plain, */*",
      "referer": "https://www.bilibili.com/",
      "origin": "https://www.bilibili.com",
    },
  });
  const json = await res.json();
  if (json?.code !== 0) throw new Error(`nav api error: ${json?.code} ${json?.message || ""}`);

  const imgUrl = json?.data?.wbi_img?.img_url || "";
  const subUrl = json?.data?.wbi_img?.sub_url || "";
  const imgKey = imgUrl.split("/").pop().split(".")[0];
  const subKey = subUrl.split("/").pop().split(".")[0];
  const mixinKey = getMixinKey(imgKey + subKey);
  if (!mixinKey) throw new Error("wbi mixinKey 生成失败");
  return mixinKey;
}

function signWbiParams(params, mixinKey) {
  const wts = Math.floor(Date.now() / 1000);
  const entries = Object.entries({ ...params, wts })
    .map(([k, v]) => [k, sanitizeWbiValue(v)])
    .sort(([a], [b]) => a.localeCompare(b));

  // build query string (encoded)
  const sp = new URLSearchParams();
  for (const [k, v] of entries) sp.set(k, String(v));
  const qs = sp.toString();

  const wRid = md5(qs + mixinKey);
  sp.set("w_rid", wRid);
  sp.set("wts", String(wts));
  return sp.toString();
}

// -----------------------
// Fetch APIs
// -----------------------

async function fetchJson(url) {
  const res = await fetch(url, {
    method: "GET",
    credentials: "include",
    signal: abortController?.signal, // 使用全局中止控制器
    headers: {
      "accept": "application/json, text/plain, */*",
      "accept-language": "zh-CN,zh;q=0.9,en;q=0.8",
      "referer": "https://www.bilibili.com/",
      "origin": "https://www.bilibili.com",
      "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    },
  });
  const json = await res.json();
  return json;
}

async function fetchOidByBvid(bvid) {
  const url = `https://api.bilibili.com/x/web-interface/view?bvid=${encodeURIComponent(bvid)}`;
  const json = await fetchJson(url);
  if (json?.code !== 0) throw new Error(`view api error: ${json?.code} ${json?.message || ""}`);
  return parseAidFromViewApi(json);
}

async function fetchMainPage({ oid, type, mode, offset, mixinKey }) {
  const base = "https://api.bilibili.com/x/v2/reply/wbi/main";

  // ✅ 关键：不要手动 encodeURIComponent。URLSearchParams 会自动编码。
  const pagination_str = JSON.stringify({ offset: offset || "" });

  const params = {
    oid: String(oid),
    type: String(type),
    mode: String(mode),
    pagination_str,
    plat: "1",
    seek_rpid: "",
    web_location: "1315875",
  };

  const signed = signWbiParams(params, mixinKey);
  const url = `${base}?${signed}`;

  const json = await fetchJson(url);
  if (json?.code !== 0) throw new Error(`main api error: ${json?.code} ${json?.message || ""}`);
  return json;
}

async function fetchSubPage({ oid, type, root, ps, pn }) {
  const url =
    `https://api.bilibili.com/x/v2/reply/reply?` +
    `oid=${encodeURIComponent(String(oid))}` +
    `&type=${encodeURIComponent(String(type))}` +
    `&root=${encodeURIComponent(String(root))}` +
    `&ps=${encodeURIComponent(String(ps))}` +
    `&pn=${encodeURIComponent(String(pn))}` +
    `&web_location=333.788`;

  const json = await fetchJson(url);
  if (json?.code !== 0) throw new Error(`sub api error(root=${root}): ${json?.code} ${json?.message || ""}`);
  return json;
}

// -----------------------
// Data shaping
// -----------------------

function shapeReplyNode(reply) {
  return {
    rpid: Number(reply?.rpid),
    mid: Number(reply?.mid),
    uname: reply?.member?.uname || "",
    message: reply?.content?.message || "",
    like: Number(reply?.like || 0),
    ctime: Number(reply?.ctime || 0),
    location: pickLocation(reply),
    root: Number(reply?.root || 0),
    parent: Number(reply?.parent || 0),
    dialog: Number(reply?.dialog || 0),
    replies: [],
  };
}

function buildNestedChildren(mainRpid, subReplies) {
  // subReplies are items from /reply/reply API: each has root + parent.
  // We need to build a tree:
  // - parent == root -> direct child of main
  // - parent == some rpid -> nested under that reply

  const map = new Map();
  for (const r of subReplies) {
    const node = shapeReplyNode(r);
    map.set(node.rpid, node);
  }

  const roots = [];
  for (const node of map.values()) {
    if (node.parent === mainRpid) {
      roots.push(node);
      continue;
    }
    const p = map.get(node.parent);
    if (p) p.replies.push(node);
    else roots.push(node); // fallback (in case parent not in current set)
  }

  // sort replies by ctime ascending (like bilibili default)
  function sortRec(list) {
    list.sort((a, b) => a.ctime - b.ctime);
    for (const it of list) sortRec(it.replies);
  }
  sortRec(roots);

  return roots;
}

function normalizeReplies(comments) {
  // 将空的 replies 数组转换为 null，与 Bilibili API 保持一致
  function processNode(node) {
    if (node.replies && Array.isArray(node.replies)) {
      if (node.replies.length === 0) {
        node.replies = null;
      } else {
        node.replies.forEach(processNode);
      }
    }
    return node;
  }

  return comments.map(processNode);
}

// -----------------------
// gzip + download
// -----------------------

async function gzipBytesFromString(str) {
  // Use CompressionStream if available
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

function uint8ToBase64(u8) {
  // chunked btoa to avoid call stack / argument limits
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < u8.length; i += chunkSize) {
    const chunk = u8.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

async function downloadBytes({ bytes, filename, mime }) {
  const base64 = uint8ToBase64(bytes);
  const url = `data:${mime};base64,${base64}`;

  const downloadId = await chrome.downloads.download({
    url,
    filename,
    saveAs: true,
    conflictAction: "uniquify",
  });

  return downloadId;
}

async function downloadTextAsJson({ text, filename }) {
  const enc = new TextEncoder();
  const bytes = enc.encode(text);
  return downloadBytes({ bytes, filename, mime: "application/json;charset=utf-8" });
}

// -----------------------
// Main export flow
// -----------------------

async function exportAllComments({ bvid }) {
  const startTime = Date.now(); // 记录开始时间

  const oid = await fetchOidByBvid(bvid);
  const type = 1;
  const mode = 2;
  const mainSleepMs = 400; // 主评论延迟 400ms（实际 280-520ms 随机）
  const subSleepMs = 400;  // 子评论延迟 400ms（实际 280-520ms 随机）
  const subPageSize = 20;
  const maxConsecutiveFailures = 3; // 连续失败 3 次后自动停止
  let consecutiveFailures = 0; // 连续失败计数器

  sendProgress(`aid/oid = ${oid}\n获取 wbi keys…`);
  const mixinKey = await getWbiMixinKey();
  sendProgress(`wbi keys ok.\n开始抓取主评论…`);

  let page = 0;
  let offset = ""; // pagination_str.offset
  let isEnd = false;

  const mainItems = []; // shaped main nodes
  const mainIndexByRpid = new Map(); // rpid -> node
  const rcountMap = new Map(); // rpid -> 直接子回复数（rcount），用于判断是否有子评论
  const countMap = new Map();  // rpid -> 全部子回复数（count），用于计算分页
  let cursorAllCount = 0;

  while (!isEnd) {
    page += 1;

    const json = await fetchMainPage({ oid, type, mode, offset, mixinKey });
    const data = json?.data || {};
    const cursor = data?.cursor || {};
    const replies = data?.replies || [];

    cursorAllCount = Number(cursor?.all_count || cursorAllCount || 0);

    for (const r of replies) {
      const node = shapeReplyNode(r);
      mainItems.push(node);
      mainIndexByRpid.set(node.rpid, node);
      rcountMap.set(node.rpid, Number(r?.rcount || 0));
      countMap.set(node.rpid, Number(r?.count || 0));
    }

    offset = cursor?.pagination_reply?.next_offset || "";
    isEnd = !!cursor?.is_end;

    sendProgress(
      `正在获取评论... 已获取 ${mainItems.length} 条（第 ${page} 页）`
    );

    await randomSleep(mainSleepMs); // 主评论使用 500ms 延迟

    // 每 10 页暂停 10 秒，避免累积请求触发限制
    if (page % 10 === 0) {
      sendProgress(`已获取 ${page} 页评论，暂停 10 秒以避免触发限制...`);
      await sleep(10000); // 固定暂停 10 秒
    }

    if (page > 5000) throw new Error("主评论翻页异常：page 超限（防死循环）");
  }

  sendProgress(`评论抓取完成: ${mainItems.length} 条\n开始抓取回复...`);

  let subTotalFetched = 0;

  const enriched = [];
  for (let i = 0; i < mainItems.length; i++) {
    enriched.push({ ...mainItems[i], replies: [] });
  }
  mainIndexByRpid.clear();
  for (const node of enriched) mainIndexByRpid.set(node.rpid, node);

  for (let i = 0; i < enriched.length; i++) {
    if (shouldStop) throw new Error("导出已被用户手动停止");

    const main = enriched[i];

    // 用主评论 API 返回的 rcount 判断是否有子评论，无则直接跳过（不发请求）
    if ((rcountMap.get(main.rpid) || 0) <= 0) continue;

    // 用 count 计算总页数（包含嵌套层级的全部子回复数）
    const subCount = countMap.get(main.rpid) || 0;
    const pages = Math.ceil(subCount / subPageSize);
    const allSubRaw = [];

    for (let pn = 1; pn <= pages; pn++) {
      if (shouldStop) throw new Error("导出已被用户手动停止");

      try {
        const subJson = await fetchSubPage({ oid, type, root: main.rpid, ps: subPageSize, pn });
        const subReplies = subJson?.data?.replies || [];
        allSubRaw.push(...subReplies);
        subTotalFetched += subReplies.length;
        sendProgress(`正在获取回复... 已获取 ${subTotalFetched} 条`);
        consecutiveFailures = 0;
      } catch (e) {
        consecutiveFailures++;
        sendProgress(`⚠️ 子评论获取失败 (${consecutiveFailures}/${maxConsecutiveFailures}) root=${main.rpid}: ${e?.message || String(e)}`);
        if (consecutiveFailures >= maxConsecutiveFailures) {
          throw new Error(`连续失败 ${consecutiveFailures} 次，疑似触发反爬虫机制，已自动停止。建议等待 10-30 分钟后重试。`);
        }
      }

      await randomSleep(subSleepMs);
      if (pn > 5000) throw new Error(`子评论翻页异常 root=${main.rpid}：pn 超限（防死循环）`);
    }

    main.replies = buildNestedChildren(main.rpid, allSubRaw);
  }

  // 将空的 replies 数组转换为 null
  normalizeReplies(enriched);

  // final output
  const out = {
    meta: {
      bvid,
      oid,
      type,
      mode,
      main_total: enriched.length,
      sub_total_fetched: subTotalFetched,
      all_total_fetched: enriched.length + subTotalFetched,
      cursor_all_count: cursorAllCount,
      sub_page_size: subPageSize,
      main_sleep_ms: mainSleepMs,
      sub_sleep_ms: subSleepMs,
      generated_at: new Date().toISOString(),
    },
    comments: enriched,
  };

  const jsonText = JSON.stringify(out, null, 2);

  // 计算导出耗时
  const endTime = Date.now();
  const durationMs = endTime - startTime;

  // 保存评论数据到chrome.storage.local
  sendProgress("正在保存数据…");
  try {
    // 准备简化的评论数据（只保留AI需要的字段，减小存储大小）
    const simplifiedComments = prepareCommentsForAI(enriched);

    // 保存到storage，包含元数据和完整JSON
    await chrome.storage.local.set({
      lastExportedComments: simplifiedComments,
      lastExportedJson: jsonText,
      lastExportBvid: bvid,
      lastExportTime: new Date().toISOString(),
      lastExportCount: enriched.length,
      lastExportMeta: { ...out.meta, duration_ms: durationMs }, // 添加耗时
      isExporting: false // 导出完成，重置状态
    });

    // 发送完成消息到popup
    chrome.runtime.sendMessage({
      type: "DONE",
      main_total: out.meta.main_total,
      sub_total_fetched: out.meta.sub_total_fetched,
      all_total_fetched: out.meta.all_total_fetched,
    });

    // 打开结果页面
    await chrome.tabs.create({
      url: chrome.runtime.getURL("results.html"),
      active: true
    });
  } catch (err) {
    // 如果存储失败（可能是数据太大），仍然尝试打开结果页面
    console.error("保存评论数据到storage失败:", err);

    chrome.runtime.sendMessage({
      type: "ERROR",
      error: `数据保存失败：${err?.message || String(err)}。数据可能过大，请尝试导出较少评论的视频。`
    });
  }
}

// 准备评论数据：只保留AI分析需要的字段
function prepareCommentsForAI(comments) {
  function simplifyNode(node) {
    const replies = node.replies;
    return {
      rpid: node.rpid,
      mid: node.mid,
      uname: node.uname,
      message: node.message,
      like: node.like,
      ctime: node.ctime,
      location: node.location,
      root: node.root,
      parent: node.parent,
      dialog: node.dialog,
      replies: replies && replies.length > 0 ? replies.map(simplifyNode) : null
    };
  }

  return comments.map(simplifyNode);
}
