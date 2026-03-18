// ── IndexedDB ────────────────────────────────────────────────
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

async function idbGetSummary(bvid) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("summaries", "readonly");
    const req = tx.objectStore("summaries").get(bvid);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

// ── Globals ───────────────────────────────────────────────────
let summaryRecord = null;

// ── Helpers ───────────────────────────────────────────────────
const SENTIMENT_LABEL = {
  positive: "推荐",
  negative: "避雷",
  mixed:    "褒贬不一",
  neutral:  "中性",
};

function formatTime(iso) {
  return new Date(iso).toLocaleString("zh-CN", {
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit"
  });
}

function scoreDotsHtml(score, max = 3) {
  const n = Math.min(Math.max(Math.round(score ?? 0), 0), max);
  return "●".repeat(n) + "○".repeat(max - n);
}

function el(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
}

// ── Overlay ───────────────────────────────────────────────────
function showError(msg) {
  const overlay = document.getElementById("loadingOverlay");
  const spinner = overlay.querySelector(".overlay-spinner");
  const text = document.getElementById("overlayMsg");
  spinner.style.display = "none";
  text.textContent = msg;
  text.style.color = "#ef4444";
}

// ── Stats strip ───────────────────────────────────────────────
function renderSummaryStats(data) {
  const shops = data.shops || [];
  const omitted = data.omitted_shops || [];
  const total = shops.length;

  const counts = { positive: 0, negative: 0, mixed: 0, neutral: 0 };
  shops.forEach(s => { if (s.overall_sentiment in counts) counts[s.overall_sentiment]++; });

  const chipsEl = document.getElementById("statsChips");
  const defs = [
    { label: "已分析店铺", value: total,              cls: "total" },
    { label: "推荐",        value: counts.positive,    cls: "pos"   },
    { label: "避雷/褒贬不一",value: counts.negative + counts.mixed, cls: "neg" },
    { label: "被略过",      value: omitted.length,     cls: "omit"  },
  ];

  defs.forEach(d => {
    const chip = el("div", "stat-chip");
    chip.innerHTML = `<span class="stat-chip-label">${d.label}</span><span class="stat-chip-value ${d.cls}">${d.value}</span>`;
    chipsEl.appendChild(chip);
  });

  // Sentiment bar
  const barEl = document.getElementById("sentimentBar");
  const sentiments = ["positive", "negative", "mixed", "neutral"];
  sentiments.forEach(s => {
    const pct = total > 0 ? (counts[s] / total) * 100 : 0;
    if (pct === 0) return;
    const seg = el("div", "sentiment-bar-seg");
    seg.dataset.s = s;
    seg.style.width = pct + "%";
    seg.title = `${SENTIMENT_LABEL[s]}: ${counts[s]}家 (${Math.round(pct)}%)`;
    barEl.appendChild(seg);
  });

  document.getElementById("summaryStats").style.display = "";
}

// ── Evidence block ────────────────────────────────────────────
function buildEvidenceQuote(ev, type) {
  const div = el("div", `evidence-quote ${type}`);
  const textEl = el("p", "quote-text");
  textEl.textContent = ev.text || "";
  const meta = el("div", "quote-meta");
  meta.innerHTML = `<span class="quote-like">♥ ${ev.like ?? 0}</span><span class="quote-score">${scoreDotsHtml(ev.info_score)}</span>`;
  div.appendChild(textEl);
  div.appendChild(meta);
  return div;
}

function buildEvidenceSection(items, type, label) {
  if (!items || items.length === 0) return null;
  const sorted = [...items].sort((a, b) => (b.like ?? 0) - (a.like ?? 0));
  const LIMIT = 5;

  const details = el("details", "evidence-details");
  const summary = el("summary", "evidence-summary");
  summary.textContent = `${label} (${sorted.length}条)`;
  details.appendChild(summary);

  const quotesWrap = el("div", "evidence-quotes");
  sorted.slice(0, LIMIT).forEach(ev => quotesWrap.appendChild(buildEvidenceQuote(ev, type)));

  if (sorted.length > LIMIT) {
    const rest = sorted.slice(LIMIT);
    const btn = el("button", "show-more-btn", `查看更多 ${rest.length} 条`);
    btn.addEventListener("click", () => {
      rest.forEach(ev => quotesWrap.insertBefore(buildEvidenceQuote(ev, type), btn));
      btn.remove();
    });
    quotesWrap.appendChild(btn);
  }

  details.appendChild(quotesWrap);
  return details;
}

// ── Single shop card ──────────────────────────────────────────
function buildShopCard(shop) {
  const card = el("div", "shop-card");
  const sentiment = shop.overall_sentiment || "neutral";

  // Header
  const header = el("div", "shop-header");
  const nameEl = el("span", "shop-name");
  nameEl.textContent = shop.shop_name || "未知店铺";
  const badge = el("span", `sentiment-badge ${sentiment}`, SENTIMENT_LABEL[sentiment] || sentiment);
  const mention = el("span", "mention-badge", `${shop.stats?.mention_count ?? 0} 条评论`);
  header.appendChild(nameEl);
  header.appendChild(badge);
  header.appendChild(mention);
  card.appendChild(header);

  // Stats row
  const stats = shop.stats || {};
  const statsRow = el("div", "stats-row");
  [
    { cls: "recommend", icon: "✅", label: "推荐",    val: stats.recommend_count ?? 0 },
    { cls: "warn",      icon: "⚠️", label: "避雷",    val: stats.warn_count ?? 0 },
    { cls: "neutral",   icon: "💬", label: "中性",    val: stats.neutral_count ?? 0 },
    { cls: "low-info",  icon: "ℹ️", label: "低信息量", val: stats.low_info_mention_count ?? 0 },
  ].forEach(p => {
    statsRow.appendChild(el("span", `stat-pill ${p.cls}`, `${p.icon} ${p.label} ${p.val}`));
  });
  card.appendChild(statsRow);

  // Signature dishes
  const dishes = shop.signature_dishes_or_keywords || [];
  if (dishes.length > 0) {
    const sec = el("div", "tags-section");
    sec.appendChild(el("span", "section-label", "招牌 / 特色"));
    const wrap = el("div", "tags-wrap");
    dishes.forEach(d => wrap.appendChild(el("span", "tag dish", d)));
    sec.appendChild(wrap);
    card.appendChild(sec);
  }

  // Address clues
  const clues = shop.address_clues || [];
  if (clues.length > 0) {
    const sec = el("div", "address-section");
    sec.appendChild(el("span", "section-label", "位置线索"));
    const ul = el("ul", "address-list");
    clues.forEach(c => ul.appendChild(el("li", null, c)));
    sec.appendChild(ul);
    card.appendChild(sec);
  }

  // Summary
  if (shop.summary) {
    const p = el("p", "shop-summary");
    p.textContent = shop.summary;
    card.appendChild(p);
  }

  // Evidence accordion
  const ev = shop.evidence || {};
  const evGroup = el("div", "evidence-group");
  [
    { key: "recommend",      type: "recommend", label: "✅ 推荐评论" },
    { key: "warn",           type: "warn",      label: "⚠️ 避雷评论" },
    { key: "neutral",        type: "neutral",   label: "💬 中性评论" },
    { key: "low_info_mention", type: "low-info", label: "ℹ️ 低信息量" },
  ].forEach(({ key, type, label }) => {
    const sec = buildEvidenceSection(ev[key], type, label);
    if (sec) evGroup.appendChild(sec);
  });

  if (evGroup.children.length > 0) card.appendChild(evGroup);
  return card;
}

// ── Shop list ─────────────────────────────────────────────────
function renderShopCards(shops) {
  const listEl = document.getElementById("shopList");
  const sorted = [...shops].sort((a, b) => (b.stats?.mention_count ?? 0) - (a.stats?.mention_count ?? 0));
  sorted.forEach(shop => listEl.appendChild(buildShopCard(shop)));
}

// ── Omitted shops ─────────────────────────────────────────────
function renderOmitted(shops) {
  if (!shops || shops.length === 0) return;
  document.getElementById("omittedCount").textContent = shops.length;
  document.getElementById("omittedSection").style.display = "";

  const listEl = document.getElementById("omittedList");
  shops.forEach(shop => {
    const item = el("div", "omitted-item");
    const header = el("div", "omitted-header");
    header.appendChild(el("span", "omitted-name", shop.shop_name || "?"));
    header.appendChild(el("span", "omitted-count", `${shop.mention_count ?? 0} 次提及`));
    item.appendChild(header);
    if (shop.reason) item.appendChild(el("p", "omitted-reason", shop.reason));
    if (shop.example_quotes?.length) {
      const q = el("p", "omitted-quotes", shop.example_quotes.slice(0, 2).map(s => `"${s}"`).join(" / "));
      item.appendChild(q);
    }
    listEl.appendChild(item);
  });
}

// ── Low confidence ────────────────────────────────────────────
function renderLowConf(mentions) {
  if (!mentions || mentions.length === 0) return;
  document.getElementById("lowConfCount").textContent = mentions.length;
  document.getElementById("lowConfSection").style.display = "";

  const listEl = document.getElementById("lowConfList");
  mentions.forEach(m => {
    const item = el("div", "low-conf-item");
    item.appendChild(el("span", "omitted-name", m.shop_name || "?"));
    if (m.reason) item.appendChild(el("p", "omitted-reason", m.reason));
    if (m.quote) item.appendChild(el("p", "omitted-quotes", `"${m.quote}"`));
    listEl.appendChild(item);
  });
}

// ── Download button ───────────────────────────────────────────
function initDownloadBtn() {
  document.getElementById("downloadJsonBtn").addEventListener("click", () => {
    if (!summaryRecord) return;
    const pretty = JSON.stringify(summaryRecord.data, null, 2);
    const blob = new Blob([new TextEncoder().encode(pretty)], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const ts = summaryRecord.timestamp.replace(/[:.]/g, "-").slice(0, 19);
    a.href = url;
    a.download = `ai_summary_${summaryRecord.bvid}_${ts}.json`;
    a.click();
    URL.revokeObjectURL(url);
  });
}

// ── Render page ───────────────────────────────────────────────
function renderPage(record) {
  summaryRecord = record;
  const data = record.data || {};

  // Header
  document.getElementById("headerBvid").textContent = record.bvid;
  document.getElementById("headerTime").textContent = record.timestamp ? formatTime(record.timestamp) : "--";
  document.title = `${record.bvid} · 美食探店 AI 摘要`;

  // Truncation banner
  if (data._truncated) document.getElementById("truncationBanner").style.display = "";

  renderSummaryStats(data);
  renderShopCards(data.shops || []);
  renderOmitted(data.omitted_shops || []);
  renderLowConf(data.low_confidence_mentions || []);

  // Hide loading overlay
  document.getElementById("loadingOverlay").classList.add("hidden");
}

// ── Init ──────────────────────────────────────────────────────
async function init() {
  initDownloadBtn();

  const params = new URLSearchParams(location.search);
  const bvid = params.get("bvid");
  if (!bvid) {
    showError("缺少 bvid 参数，请从结果页重新运行 AI 分析");
    return;
  }

  try {
    const record = await idbGetSummary(bvid);
    if (!record) {
      showError("未找到分析结果，请返回结果页重新运行 AI 总结");
      return;
    }
    renderPage(record);
  } catch (err) {
    showError(`加载失败：${err.message}`);
  }
}

init();
