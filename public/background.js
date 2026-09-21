// Tab 内存缓存
const tabCache = new Map();
let activeTabId = null;

// ===== 工具函数 =====

function getDomain(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

function formatBadgeText(bytes) {
  if (bytes == null || bytes === 0) return "--";
  const mb = bytes / (1024 * 1024);
  if (mb >= 1024) return (mb / 1024).toFixed(1);
  return String(Math.round(mb));
}

function getBadgeColor(bytes) {
  if (bytes == null) return "#9E9E9E";
  const mb = bytes / (1024 * 1024);
  if (mb < 200) return "#4CAF50";
  if (mb < 500) return "#FF9800";
  return "#F44336";
}

function drawIcon(text, bgColor) {
  try {
    const size = 128;
    const canvas = new OffscreenCanvas(size, size);
    const ctx = canvas.getContext("2d");

    ctx.fillStyle = bgColor;
    ctx.beginPath();
    ctx.roundRect(0, 0, size, size, 20);
    ctx.fill();

    ctx.fillStyle = "#fff";
    ctx.font = "bold 48px -apple-system, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, size / 2, size / 2);

    return canvas.transferToImageBitmap();
  } catch {
    return null;
  }
}

// ===== 内存采集 =====

async function collectTabMemory(tabId) {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        if (performance.memory && performance.memory.usedJSHeapSize) {
          return performance.memory.usedJSHeapSize;
        }
        return null;
      },
      world: "MAIN",
    });
    if (results && results[0] && results[0].result != null) {
      return results[0].result;
    }
    return null;
  } catch {
    return null;
  }
}

async function updateBadge() {
  let text, color;
  if (activeTabId == null) {
    text = "--";
    color = "#9E9E9E";
  } else {
    const cached = tabCache.get(activeTabId);
    if (cached && cached.memoryBytes != null) {
      text = formatBadgeText(cached.memoryBytes);
      color = getBadgeColor(cached.memoryBytes);
    } else {
      text = "--";
      color = "#9E9E9E";
    }
  }

  await chrome.action.setBadgeText({ text: "" });

  const icon = drawIcon(text, color);
  if (icon) {
    await chrome.action.setIcon({ imageData: { 128: icon } });
  }
}

async function collectActiveTab() {
  if (activeTabId == null) return;

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || tab.id !== activeTabId) return;

  const memory = await collectTabMemory(activeTabId);
  const existing = tabCache.get(activeTabId) || {};

  tabCache.set(activeTabId, {
    tabId: activeTabId,
    title: tab.title || "",
    url: tab.url || "",
    domain: getDomain(tab.url || ""),
    favIconUrl: tab.favIconUrl || "",
    memoryBytes:
      memory != null
        ? memory
        : existing.discarded
          ? existing.memoryBytes
          : null,
    discarded: existing.discarded || false,
    lastUpdated: Date.now(),
  });

  await updateBadge();
}

async function collectAllTabs() {
  const allTabs = await chrome.tabs.query({});

  for (const tab of allTabs) {
    if (tab.id === activeTabId) continue;

    const memory = await collectTabMemory(tab.id);
    const existing = tabCache.get(tab.id) || {};

    tabCache.set(tab.id, {
      tabId: tab.id,
      title: tab.title || "",
      url: tab.url || "",
      domain: getDomain(tab.url || ""),
      favIconUrl: tab.favIconUrl || "",
      memoryBytes:
        memory != null
          ? memory
          : existing.discarded
            ? existing.memoryBytes
            : null,
      discarded: existing.discarded || false,
      lastUpdated: Date.now(),
    });
  }

  // 清理已关闭的 tab
  const openTabIds = new Set(allTabs.map((t) => t.id));
  for (const id of tabCache.keys()) {
    if (!openTabIds.has(id)) {
      tabCache.delete(id);
    }
  }
}

// ===== 消息处理 =====

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  switch (request.type) {
    case "GET_ALL_TABS": {
      const tabs = Array.from(tabCache.values()).map((t) => ({
        ...t,
        isActive: t.tabId === activeTabId,
      }));

      // 补充 pinned/audible 实时状态
      chrome.tabs.query({}, (allTabs) => {
        const tabMap = new Map(allTabs.map((t) => [t.id, t]));
        const enrichedTabs = tabs.map((t) => {
          const liveTab = tabMap.get(t.tabId);
          return {
            ...t,
            pinned: liveTab?.pinned || false,
            audible: liveTab?.audible || false,
          };
        });
        sendResponse({ tabs: enrichedTabs, activeTabId });
      });
      return true;
    }

    case "DISCARD_TAB": {
      const tabId = request.tabId;
      handleDiscardTab(tabId).then(sendResponse);
      return true;
    }

    case "BATCH_DISCARD": {
      handleBatchDiscard(request.tabIds).then(sendResponse);
      return true;
    }
  }
});

async function handleDiscardTab(tabId) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab && tab.id === tabId) {
    return { success: false, error: "无法休眠当前标签页" };
  }

  const tabInfo = await chrome.tabs.get(tabId).catch(() => null);
  if (!tabInfo) return { success: false, error: "标签页已关闭" };
  if (tabInfo.pinned) return { success: false, error: "无法休眠固定标签页" };
  if (tabInfo.audible)
    return { success: false, error: "无法休眠正在播放音频的标签页" };

  const result = await chrome.tabs.discard(tabId).catch(() => false);
  if (result) {
    const cached = tabCache.get(tabId);
    if (cached) {
      cached.discarded = true;
      tabCache.set(tabId, cached);
    }
    return { success: true };
  }
  return { success: false, error: "休眠失败" };
}

async function handleBatchDiscard(tabIds) {
  const results = [];
  const sorted = tabIds
    .map((id) => ({ id, memory: tabCache.get(id)?.memoryBytes || 0 }))
    .sort((a, b) => b.memory - a.memory);

  for (const item of sorted) {
    const result = await handleDiscardTab(item.id);
    results.push({ tabId: item.id, ...result });
    await new Promise((r) => setTimeout(r, 200));
  }

  return { results };
}

// ===== Tab 生命周期 =====

chrome.tabs.onActivated.addListener((activeInfo) => {
  activeTabId = activeInfo.tabId;
  collectActiveTab();
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === "complete") {
    const cached = tabCache.get(tabId);
    if (cached) {
      cached.discarded = false;
      tabCache.set(tabId, cached);
    }
    if (tabId === activeTabId) {
      collectActiveTab();
    }
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  tabCache.delete(tabId);
  if (tabId === activeTabId) {
    activeTabId = null;
    updateBadge();
  }
});

chrome.windows?.onFocusChanged?.addListener((windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) return;
  chrome.tabs.query({ active: true, windowId }, (tabs) => {
    if (tabs[0]) {
      activeTabId = tabs[0].id;
      collectActiveTab();
    }
  });
});

// ===== 定时器 =====

let activeCollecting = false;
let allCollecting = false;

setInterval(async () => {
  if (activeCollecting) return;
  activeCollecting = true;
  try {
    await collectActiveTab();
  } finally {
    activeCollecting = false;
  }
}, 1000);

setInterval(async () => {
  if (allCollecting) return;
  allCollecting = true;
  try {
    await collectAllTabs();
  } finally {
    allCollecting = false;
  }
}, 3000);

// ===== 初始化 =====

async function initExtension() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab) activeTabId = tab.id;

  await collectActiveTab();
  await collectAllTabs();
}

chrome.runtime.onInstalled.addListener(() => initExtension());

// service worker 首次启动或从休眠唤醒
initExtension();
