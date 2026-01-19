// =======================
// MV3 Service Worker
// =======================

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === "EXPORT") {
    (async () => {
      try {
        const { bvid, gzip } = msg;
        await exportAllComments({ bvid, gzip: !!gzip });
        sendResponse({ ok: true });
      } catch (err) {
        chrome.runtime.sendMessage({
          type: "ERROR",
          error: err?.message || String(err),
        });
        sendResponse({ ok: false, error: err?.message || String(err) });
      }
    })();
    return true; // keep channel open for async
  }
});

// -----------------------
// Utilities
// -----------------------

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function sendProgress(text) {
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

function pickTimeDesc(reply) {
  // e.g. "142天前发布" (not the unix time)
  return reply?.reply_control?.time_desc || "";
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
    headers: {
      "accept": "application/json, text/plain, */*",
      "referer": "https://www.bilibili.com/",
      "origin": "https://www.bilibili.com",
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
    avatar: reply?.member?.avatar || "",
    message: reply?.content?.message || "",
    like: Number(reply?.like || 0),
    ctime: Number(reply?.ctime || 0), // unix seconds
    time_desc: pickTimeDesc(reply),
    location: pickLocation(reply), // "IP属地：..."
    root: Number(reply?.root || 0),
    parent: Number(reply?.parent || 0),
    children: [],
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
    if (p) p.children.push(node);
    else roots.push(node); // fallback (in case parent not in current set)
  }

  // sort children by ctime ascending (like bilibili default)
  function sortRec(list) {
    list.sort((a, b) => a.ctime - b.ctime);
    for (const it of list) sortRec(it.children);
  }
  sortRec(roots);

  return roots;
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

async function exportAllComments({ bvid, gzip }) {
  const oid = await fetchOidByBvid(bvid);
  const type = 1;
  const mode = 2;
  const sleepMs = 300;
  const subPageSize = 20;

  sendProgress(`aid/oid = ${oid}\n获取 wbi keys…`);
  const mixinKey = await getWbiMixinKey();
  sendProgress(`wbi keys ok.\n开始抓取主评论…`);

  let page = 0;
  let offset = ""; // pagination_str.offset
  let isEnd = false;

  const mainItems = []; // shaped main nodes
  const mainIndexByRpid = new Map(); // rpid -> node
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
    }

    offset = cursor?.pagination_reply?.next_offset || "";
    isEnd = !!cursor?.is_end;

    sendProgress(
      `[main] page=${page} got=${replies.length} main_total=${mainItems.length} offset=${offset ? JSON.stringify(offset) : "∅"} is_end=${isEnd}`
    );

    await sleep(sleepMs);

    if (page > 5000) throw new Error("主评论翻页异常：page 超限（防死循环）");
  }

  // Fetch sub replies for roots that have rcount > 0
  sendProgress(`主评论抓取完成：${mainItems.length}\n开始抓取楼中楼…`);

  let subTotalFetched = 0;

  for (let i = 0; i < mainItems.length; i++) {
    const main = mainItems[i];
    // bilibili uses rcount as "sub reply count"
    // In some cases field may be missing; fallback: try reply_control.sub_reply_entry_text? not reliable here.
    const need = main?.rcount || 0; // we didn't store rcount in shape; so we can check by looking up raw? (not available now)
    // Workaround: We can detect using main.root==0 and main.parent==0; but count not stored.
    // Better: fetch only when needed by checking main has "sub replies" is unknown here.
    // So we do a cheap heuristic: fetch sub pages only if main.count / rcount exists in original.
    // Since we shaped node, we didn't include rcount. We'll refetch by using known field: not possible.
    // Solution: just fetch sub replies for all mains? too heavy.
    // So we reintroduce rcount by storing it during main shaping:
  }

  // Re-shape mains with rcount (fix: do another pass by re-fetching minimal? too slow).
  // Instead: we re-run mains once more? Not acceptable.
  // Therefore: store rcount during initial shape -> implement above by patching shapeReplyNode? easier now:
  // We'll do a pragmatic fallback: fetch sub replies ONLY when mainItems are likely to have replies:
  // bilibili returns "reply_control.sub_reply_entry_text" like "共39条回复" in root detail when sub exists,
  // but root reply in main list usually has reply_control too. We'll store that if present as sub_count.
  //
  // Because we already shaped without it, we cannot recover now. So we will do a second pass:
  // We will fetch sub replies only for roots that are known to have sub replies by calling /reply/reply pn=1 ps=1
  // and check page.count. That is 1 request per root, acceptable for ~300 roots with sleep.
  //
  // Let's do that.

  const enriched = [];
  for (let i = 0; i < mainItems.length; i++) {
    enriched.push({ ...mainItems[i], children: [] });
  }
  // update map
  mainIndexByRpid.clear();
  for (const node of enriched) mainIndexByRpid.set(node.rpid, node);

  for (let i = 0; i < enriched.length; i++) {
    const main = enriched[i];

    // probe: ps=1, pn=1 to get total sub count
    let subCount = 0;
    try {
      const probe = await fetchSubPage({ oid, type, root: main.rpid, ps: 1, pn: 1 });
      subCount = Number(probe?.data?.page?.count || 0);
    } catch (e) {
      // If a particular root fails, skip it rather than failing all.
      sendProgress(`⚠️ 子评论探测失败 root=${main.rpid}: ${e?.message || String(e)}`);
      await sleep(sleepMs);
      continue;
    }

    if (subCount <= 0) {
      await sleep(sleepMs);
      continue;
    }

    const pages = Math.ceil(subCount / subPageSize);
    const allSubRaw = [];

    for (let pn = 1; pn <= pages; pn++) {
      const subJson = await fetchSubPage({ oid, type, root: main.rpid, ps: subPageSize, pn });
      const subReplies = subJson?.data?.replies || [];
      allSubRaw.push(...subReplies);

      sendProgress(
        `[sub] root=${main.rpid} pn=${pn}/${pages} got=${subReplies.length} sub_total=${subTotalFetched + subReplies.length}`
      );

      subTotalFetched += subReplies.length;
      await sleep(sleepMs);
      if (pn > 5000) throw new Error(`子评论翻页异常 root=${main.rpid}：pn 超限（防死循环）`);
    }

    // build nested structure
    main.children = buildNestedChildren(main.rpid, allSubRaw);
  }

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
      sleep_ms: sleepMs,
      generated_at: new Date().toISOString(),
    },
    comments: enriched,
  };

  const jsonText = JSON.stringify(out, null, 2);

  // download
  const safeName = `comments_${bvid}_${gzip ? "gzip" : "plain"}`;
  if (gzip) {
    sendProgress("压缩中（gzip）…");
    const gzBytes = await gzipBytesFromString(jsonText);
    const filename = `${safeName}.json.gz`;
    await downloadBytes({ bytes: gzBytes, filename, mime: "application/gzip" });

    chrome.runtime.sendMessage({
      type: "DONE",
      filename,
      main_total: out.meta.main_total,
      sub_total_fetched: out.meta.sub_total_fetched,
      all_total_fetched: out.meta.all_total_fetched,
    });
  } else {
    const filename = `${safeName}.json`;
    // 大文件 data URL 可能有风险：建议用户用 gzip
    if (jsonText.length > 8_000_000) {
      sendProgress("⚠️ 文件较大，未压缩下载可能失败；建议勾选 gzip 再导出。\n继续尝试下载中…");
    }
    await downloadTextAsJson({ text: jsonText, filename });

    chrome.runtime.sendMessage({
      type: "DONE",
      filename,
      main_total: out.meta.main_total,
      sub_total_fetched: out.meta.sub_total_fetched,
      all_total_fetched: out.meta.all_total_fetched,
    });
  }
}
