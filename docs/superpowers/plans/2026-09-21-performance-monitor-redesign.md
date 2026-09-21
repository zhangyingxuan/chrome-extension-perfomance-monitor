# 内存监控插件重新设计 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将现有 Chrome 内存监控扩展重新设计为轻量级 popover，核心功能为浏览器工具入口 + 全 Tab 内存排行榜（含单个/批量休眠）。

**Architecture:** 去掉 content script 和 inject script，background service worker 直接通过 `chrome.scripting.executeScript`（MAIN world）注入各 tab 采集 `performance.memory`。1s 定时器采集 active tab 更新 badge，3s 定时器采集全部 tab 更新排行榜缓存。Popup 为 Vue 3 组件，每 1s 轮询 background 获取最新数据。

**Tech Stack:** Vue 3 + TypeScript + Vite + Chrome Extension Manifest V3 + 纯手写 CSS

**Spec:** `docs/superpowers/specs/2026-09-21-performance-monitor-redesign-design.md`

## Global Constraints

- Manifest V3，不使用 Manifest V2 API
- `performance.memory` 为 Chrome-only 非标准 API，仅在 MAIN world 可用
- Badge 文本格式：`XXXMB` 或 `X.XGB`，不可用时显示 `--`
- Badge 颜色阈值：<200MB 绿 `#4CAF50`，200-500MB 橙 `#FF9800`，>500MB 红 `#F44336`，不可用灰 `#9E9E9E`
- Popover 宽度 450px，最大高度 550px
- 批量休眠间隔 200ms，按内存从高到低排序执行
- Active tab 每 1s 采集，其他 tab 每 3s 采集

## Review Focus

1. `chrome.scripting.executeScript` 在 chrome:// 和 edge:// 等受保护页面会抛异常 — 必须 try/catch 并标记为不可用
2. `chrome.tabs.discard` 对 active/pinned/audible tab 返回 false — UI 必须提前禁用按钮，不能仅依赖 API 返回值
3. Service worker 可能被 Chrome 休眠后唤醒 — 定时器和缓存会丢失，需通过 `chrome.alarms` 或 `onStartup` 恢复
4. 高频 `chrome.scripting.executeScript` 调用（1s/次）可能造成性能压力 — 需确保单次采集完成后才安排下一次
5. Popup 关闭后定时器仍在 background 运行 — 需确保不会因为 popup 不存在而报错

---

## File Structure

| 操作 | 文件                   | 职责                                                    |
| ---- | ---------------------- | ------------------------------------------------------- |
| 删除 | `src/content.ts`       | 不再需要 content script                                 |
| 删除 | `src/inject.ts`        | 不再需要页面注入脚本                                    |
| 删除 | `src/App.vue`          | 完全重写                                                |
| 删除 | `popup.css`            | 完全重写                                                |
| 重写 | `public/background.js` | 持续采集、badge 更新、discard 处理、消息响应            |
| 重写 | `popup.html`           | 450px popover 基础 HTML                                 |
| 重写 | `popup.css`            | 全新样式                                                |
| 重写 | `src/App.vue`          | 全新 Vue 组件：工具入口 + 排行榜 + 批量操作             |
| 修改 | `public/manifest.json` | 移除 content_scripts/web_accessible_resources/downloads |
| 修改 | `vite.config.ts`       | 移除 content/inject 入口                                |
| 修改 | `package.json`         | 移除 chart.js 依赖                                      |

---

### Task 1: 清理项目结构

**Files:**

- Delete: `src/content.ts`
- Delete: `src/inject.ts`
- Modify: `public/manifest.json`
- Modify: `vite.config.ts`
- Modify: `package.json`

- [ ] **Step 1: 删除不再需要的文件**

```bash
rm src/content.ts src/inject.ts
```

- [ ] **Step 2: 更新 manifest.json**

用以下内容替换 `public/manifest.json`：

```json
{
  "manifest_version": 3,
  "name": "内存监控",
  "version": "2.0.0",
  "description": "Tab 内存监控与一键休眠",
  "permissions": ["activeTab", "tabs", "scripting", "storage"],
  "host_permissions": ["<all_urls>"],
  "icons": {
    "16": "sources/memory16.png",
    "64": "sources/memory64.png",
    "128": "sources/tabs128.png",
    "256": "sources/tabs256.png"
  },
  "action": {
    "default_popup": "popup.html",
    "default_title": "内存监控",
    "default_icon": {
      "16": "sources/memory16.png",
      "64": "sources/memory64.png"
    }
  },
  "background": {
    "service_worker": "background.js"
  }
}
```

变更点：

- 移除 `downloads` 和 `contextMenus` 权限
- 移除 `content_scripts` 配置
- 移除 `web_accessible_resources`
- 版本升至 2.0.0

- [ ] **Step 3: 更新 vite.config.ts**

用以下内容替换 `vite.config.ts`：

```typescript
import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import { fileURLToPath } from "node:url";

export default defineConfig({
  base: "./",
  plugins: [vue()],
  build: {
    rollupOptions: {
      input: {
        popup: "popup.html",
      },
      output: {
        entryFileNames: "[name].js",
        chunkFileNames: "[name].js",
        assetFileNames: "[name].[ext]",
      },
    },
    outDir: "dist",
    emptyOutDir: true,
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
```

- [ ] **Step 4: 更新 package.json**

移除 `chart.js` 依赖，更新描述：

```json
{
  "name": "chrome-extension-performance-monitor",
  "version": "2.0.0",
  "description": "Tab 内存监控与一键休眠 Chrome 扩展",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vue-tsc --noEmit && vite build",
    "watch": "vue-tsc --noEmit && vite build --watch",
    "build:extension": "node build.js",
    "preview": "vite preview"
  },
  "dependencies": {
    "vue": "^3.3.0"
  },
  "devDependencies": {
    "@types/chrome": "^0.0.268",
    "@vitejs/plugin-vue": "^4.2.3",
    "typescript": "^5.0.0",
    "vite": "^4.3.0",
    "vue-tsc": "^3.3.11"
  }
}
```

- [ ] **Step 5: 重新安装依赖**

```bash
pnpm install
```

- [ ] **Step 6: 验证构建通过**

```bash
pnpm build
```

Expected: 构建成功，dist/ 下只有 popup.html、popup.js、popup.css（无 content.js、inject.js）

- [ ] **Step 7: 提交**

```bash
git add -A
git commit -m "refactor: 清理项目结构，移除 content/inject script 和 chart.js"
```

---

### Task 2: 重写 Background Service Worker

**Files:**

- Rewrite: `public/background.js`

**Interfaces:**

- Produces: background 消息协议（供 popup 调用）
  - `GET_ALL_TABS` → `{ tabs: TabInfo[], activeTabId: number }`
  - `DISCARD_TAB` `{ tabId }` → `{ success, error? }`
  - `BATCH_DISCARD` `{ tabIds: number[] }` → `{ results: {tabId, success, error?}[] }`

- [ ] **Step 1: 重写 public/background.js**

用以下内容完整替换 `public/background.js`：

```javascript
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
  if (mb >= 1024) return (mb / 1024).toFixed(1) + "GB";
  return Math.round(mb) + "MB";
}

function getBadgeColor(bytes) {
  if (bytes == null) return "#9E9E9E";
  const mb = bytes / (1024 * 1024);
  if (mb < 200) return "#4CAF50";
  if (mb < 500) return "#FF9800";
  return "#F44336";
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
  if (activeTabId == null) {
    await chrome.action.setBadgeText({ text: "--" });
    await chrome.action.setBadgeBackgroundColor({ color: "#9E9E9E" });
    return;
  }

  const cached = tabCache.get(activeTabId);
  if (cached && cached.memoryBytes != null) {
    await chrome.action.setBadgeText({
      text: formatBadgeText(cached.memoryBytes),
    });
    await chrome.action.setBadgeBackgroundColor({
      color: getBadgeColor(cached.memoryBytes),
    });
  } else {
    await chrome.action.setBadgeText({ text: "--" });
    await chrome.action.setBadgeBackgroundColor({ color: "#9E9E9E" });
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
        pinned: t.tabId ? false : false,
        audible: t.tabId ? false : false,
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

chrome.runtime.onStartup.addListener(async () => {
  await initExtension();
});

async function initExtension() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab) activeTabId = tab.id;

  await collectActiveTab();
  await collectAllTabs();
}

chrome.runtime.onInstalled.addListener(async () => {
  await initExtension();
});

// 立即初始化（service worker 首次启动）
initExtension();
```

- [ ] **Step 2: 提交**

```bash
git add public/background.js
git commit -m "feat: 重写 background service worker，支持持续内存采集和 discard"
```

---

### Task 3: 重写 Popup UI

**Files:**

- Rewrite: `popup.html`
- Rewrite: `popup.css`
- Rewrite: `src/App.vue`

**Interfaces:**

- Consumes: background 消息协议
  - `chrome.runtime.sendMessage({ type: 'GET_ALL_TABS' })` → `{ tabs, activeTabId }`
  - `chrome.runtime.sendMessage({ type: 'DISCARD_TAB', tabId })` → `{ success, error? }`
  - `chrome.runtime.sendMessage({ type: 'BATCH_DISCARD', tabIds })` → `{ results }`

- [ ] **Step 1: 重写 popup.html**

```html
<!DOCTYPE html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>内存监控</title>
    <link rel="stylesheet" href="popup.css" />
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/popup.ts"></script>
  </body>
</html>
```

- [ ] **Step 2: 重写 popup.css**

```css
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

body {
  width: 450px;
  max-height: 550px;
  overflow-y: auto;
  font-family:
    -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  background: #f8f9fa;
  color: #333;
  font-size: 13px;
}

#app {
  width: 100%;
}
```

- [ ] **Step 3: 重写 src/App.vue**

完整替换 `src/App.vue`，包含 template、script、style 三部分：

```vue
<template>
  <div class="monitor">
    <!-- 标题栏 -->
    <div class="header">
      <span class="header-title">内存监控</span>
      <span class="header-memory">当前: {{ activeTabMemoryDisplay }}</span>
    </div>

    <!-- 浏览器工具 -->
    <div class="section">
      <div class="section-title">浏览器工具</div>
      <div class="tools-list">
        <div class="tool-item" @click="openTool('performance')">
          <span class="tool-icon">&#128269;</span>
          <span class="tool-name">性能监视器</span>
        </div>
        <div class="tool-item" @click="openTool('taskManager')">
          <span class="tool-icon">&#128203;</span>
          <span class="tool-name">任务管理器</span>
          <span class="tool-shortcut">Shift+Esc</span>
        </div>
        <div class="tool-item" @click="openTool('rendering')">
          <span class="tool-icon">&#127916;</span>
          <span class="tool-name">帧渲染统计</span>
        </div>
      </div>
    </div>

    <!-- Tab 内存排行榜 -->
    <div class="section">
      <div class="section-header">
        <span class="section-title">Tab 内存排行榜</span>
        <div class="batch-actions">
          <label class="select-all-label">
            <input
              type="checkbox"
              :checked="allDiscardableSelected"
              @change="toggleSelectAll"
            />
            <span>全选</span>
          </label>
          <button
            class="btn-batch"
            :disabled="selectedIds.length === 0 || batchDiscarding"
            @click="batchDiscard"
          >
            {{
              batchDiscarding ? "处理中..." : `批量休眠 (${selectedIds.length})`
            }}
          </button>
        </div>
      </div>

      <div class="data-tip">
        数据仅为 JS 堆内存，不含渲染进程开销、GPU 内存等
      </div>

      <div class="tab-list">
        <div
          v-for="tab in sortedTabs"
          :key="tab.tabId"
          class="tab-item"
          :class="{
            'is-active': tab.isActive,
            'is-discarded': tab.discarded,
          }"
        >
          <div class="tab-left">
            <input
              type="checkbox"
              :checked="selectedIds.has(tab.tabId)"
              :disabled="!isDiscardable(tab)"
              @change="toggleSelect(tab.tabId)"
            />
            <img
              v-if="tab.favIconUrl"
              :src="tab.favIconUrl"
              class="favicon"
              @error="(e) => (e.target.style.visibility = 'hidden')"
            />
            <span v-else class="favicon-placeholder">&#127760;</span>
            <span class="domain">{{ tab.domain || "--" }}</span>
          </div>

          <div class="tab-center">
            <span class="tab-title" :title="tab.title">{{ tab.title }}</span>
            <span
              class="memory-value"
              :class="{ 'memory-na': tab.memoryBytes == null }"
            >
              {{
                tab.discarded
                  ? formatMemory(tab.memoryBytes) + " (已休眠)"
                  : formatMemory(tab.memoryBytes)
              }}
            </span>
          </div>

          <div class="tab-right">
            <button
              class="btn-discard"
              :disabled="!canDiscardTab(tab)"
              :title="getDiscardTooltip(tab)"
              @click="discardTab(tab.tabId)"
            >
              {{ tab.discarded ? "已休眠" : "休眠" }}
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- 底部汇总 -->
    <div class="summary">
      已勾选 {{ selectedIds.size }} 个 &middot; 共
      {{ sortedTabs.length }} 个标签页 &middot; 总计
      {{ totalMemoryDisplay }} &middot; 可释放 ~{{ reclaimableDisplay }}
    </div>

    <!-- 批量操作结果提示 -->
    <div
      v-if="batchResultMessage"
      class="batch-result"
      :class="batchResultType"
    >
      {{ batchResultMessage }}
    </div>
  </div>
</template>

<script lang="ts">
import {
  defineComponent,
  ref,
  computed,
  onMounted,
  onUnmounted,
  reactive,
} from "vue";

interface TabInfo {
  tabId: number;
  title: string;
  url: string;
  domain: string;
  favIconUrl: string;
  memoryBytes: number | null;
  discarded: boolean;
  lastUpdated: number;
  isActive: boolean;
  pinned: boolean;
  audible: boolean;
}

export default defineComponent({
  name: "App",
  setup() {
    const tabs = ref<TabInfo[]>([]);
    const activeTabId = ref<number | null>(null);
    const selectedIds = ref<Set<number>>(new Set());
    const batchDiscarding = ref(false);
    const batchResultMessage = ref("");
    const batchResultType = ref<"success" | "error">("success");
    let pollTimer: number | null = null;
    let batchResultTimer: number | null = null;

    // ===== 数据获取 =====

    async function fetchTabs() {
      return new Promise<{ tabs: TabInfo[]; activeTabId: number | null }>(
        (resolve) => {
          chrome.runtime.sendMessage({ type: "GET_ALL_TABS" }, (response) => {
            if (chrome.runtime.lastError) {
              resolve({ tabs: [], activeTabId: null });
              return;
            }
            resolve(response || { tabs: [], activeTabId: null });
          });
        },
      );
    }

    async function refreshData() {
      const data = await fetchTabs();
      tabs.value = data.tabs;
      activeTabId.value = data.activeTabId;
    }

    // ===== 排序后的 tab 列表 =====

    const sortedTabs = computed(() => {
      return [...tabs.value].sort((a, b) => {
        const aMem = a.memoryBytes ?? -1;
        const bMem = b.memoryBytes ?? -1;
        return bMem - aMem;
      });
    });

    // ===== 显示值 =====

    const activeTabMemoryDisplay = computed(() => {
      const active = tabs.value.find((t) => t.isActive);
      return formatMemory(active?.memoryBytes ?? null);
    });

    const totalMemoryDisplay = computed(() => {
      const total = tabs.value.reduce(
        (sum, t) => sum + (t.memoryBytes || 0),
        0,
      );
      return formatMemory(total || null);
    });

    const reclaimableDisplay = computed(() => {
      let total = 0;
      for (const id of selectedIds.value) {
        const tab = tabs.value.find((t) => t.tabId === id);
        if (tab) total += tab.memoryBytes || 0;
      }
      return formatMemory(total || null);
    });

    function formatMemory(bytes: number | null): string {
      if (bytes == null || bytes === 0) return "--";
      const mb = bytes / (1024 * 1024);
      if (mb >= 1024) return (mb / 1024).toFixed(1) + "GB";
      return Math.round(mb) + "MB";
    }

    // ===== 选择逻辑 =====

    const discardableTabs = computed(() => {
      return tabs.value.filter((t) => isDiscardable(t));
    });

    const allDiscardableSelected = computed(() => {
      const discardable = discardableTabs.value;
      if (discardable.length === 0) return false;
      return discardable.every((t) => selectedIds.value.has(t.tabId));
    });

    function isDiscardable(tab: TabInfo): boolean {
      return (
        !tab.isActive &&
        !tab.pinned &&
        !tab.audible &&
        !tab.discarded &&
        tab.memoryBytes != null
      );
    }

    function toggleSelect(tabId: number) {
      const newSet = new Set(selectedIds.value);
      if (newSet.has(tabId)) {
        newSet.delete(tabId);
      } else {
        newSet.add(tabId);
      }
      selectedIds.value = newSet;
    }

    function toggleSelectAll() {
      if (allDiscardableSelected.value) {
        selectedIds.value = new Set();
      } else {
        selectedIds.value = new Set(discardableTabs.value.map((t) => t.tabId));
      }
    }

    // ===== 休眠逻辑 =====

    function canDiscardTab(tab: TabInfo): boolean {
      return !tab.isActive && !tab.pinned && !tab.audible && !tab.discarded;
    }

    function getDiscardTooltip(tab: TabInfo): string {
      if (tab.isActive) return "无法休眠当前标签页";
      if (tab.pinned) return "无法休眠固定标签页";
      if (tab.audible) return "无法休眠正在播放音频的标签页";
      if (tab.discarded) return "已休眠";
      return "点击休眠此标签页";
    }

    async function discardTab(tabId: number) {
      const result = await new Promise<{ success: boolean; error?: string }>(
        (resolve) => {
          chrome.runtime.sendMessage(
            { type: "DISCARD_TAB", tabId },
            (response) => {
              if (chrome.runtime.lastError) {
                resolve({ success: false, error: "通信失败" });
                return;
              }
              resolve(response || { success: false, error: "无响应" });
            },
          );
        },
      );

      if (result.success) {
        const tab = tabs.value.find((t) => t.tabId === tabId);
        if (tab) tab.discarded = true;
        selectedIds.value.delete(tabId);
        selectedIds.value = new Set(selectedIds.value);
      } else {
        showBatchResult(result.error || "休眠失败", "error");
      }
    }

    async function batchDiscard() {
      if (selectedIds.value.size === 0) return;
      batchDiscarding.value = true;

      const result = await new Promise<{
        results: { tabId: number; success: boolean; error?: string }[];
      }>((resolve) => {
        chrome.runtime.sendMessage(
          { type: "BATCH_DISCARD", tabIds: Array.from(selectedIds.value) },
          (response) => {
            if (chrome.runtime.lastError) {
              resolve({ results: [] });
              return;
            }
            resolve(response || { results: [] });
          },
        );
      });

      const successCount = result.results.filter((r) => r.success).length;
      const failCount = result.results.length - successCount;

      if (failCount === 0) {
        showBatchResult(`成功休眠 ${successCount} 个标签页`, "success");
      } else {
        showBatchResult(
          `成功休眠 ${successCount} 个，失败 ${failCount} 个`,
          "error",
        );
      }

      selectedIds.value = new Set();
      batchDiscarding.value = false;
      await refreshData();
    }

    function showBatchResult(message: string, type: "success" | "error") {
      batchResultMessage.value = message;
      batchResultType.value = type;
      if (batchResultTimer) clearTimeout(batchResultTimer);
      batchResultTimer = window.setTimeout(() => {
        batchResultMessage.value = "";
      }, 3000);
    }

    // ===== 工具入口 =====

    function openTool(tool: string) {
      switch (tool) {
        case "performance":
          chrome.tabs.create({ url: "chrome://inspect/#monitors" });
          break;
        case "taskManager":
          navigator.clipboard.writeText("Shift+Esc").then(() => {
            showBatchResult("快捷键 Shift+Esc 已复制到剪贴板", "success");
          });
          break;
        case "rendering":
          showBatchResult(
            '请按 F12 打开 DevTools → Ctrl+Shift+P → 输入 "Rendering"',
            "success",
          );
          break;
      }
    }

    // ===== 生命周期 =====

    onMounted(async () => {
      await refreshData();
      pollTimer = window.setInterval(refreshData, 1000);
    });

    onUnmounted(() => {
      if (pollTimer) clearInterval(pollTimer);
      if (batchResultTimer) clearTimeout(batchResultTimer);
    });

    return {
      tabs,
      activeTabId,
      selectedIds,
      batchDiscarding,
      batchResultMessage,
      batchResultType,
      sortedTabs,
      activeTabMemoryDisplay,
      totalMemoryDisplay,
      reclaimableDisplay,
      allDiscardableSelected,
      formatMemory,
      isDiscardable,
      canDiscardTab,
      getDiscardTooltip,
      toggleSelect,
      toggleSelectAll,
      discardTab,
      batchDiscard,
      openTool,
    };
  },
});
</script>

<style scoped>
.monitor {
  padding: 12px 16px;
}

/* 标题栏 */
.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding-bottom: 10px;
  border-bottom: 1px solid #e8e8e8;
  margin-bottom: 12px;
}

.header-title {
  font-size: 15px;
  font-weight: 600;
  color: #1a1a1a;
}

.header-memory {
  font-size: 13px;
  font-weight: 600;
  color: #333;
  background: #f0f0f0;
  padding: 2px 8px;
  border-radius: 4px;
}

/* 区块 */
.section {
  margin-bottom: 12px;
}

.section-title {
  font-size: 12px;
  font-weight: 600;
  color: #666;
  margin-bottom: 6px;
}

.section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 6px;
}

/* 工具列表 */
.tools-list {
  background: #fff;
  border-radius: 6px;
  border: 1px solid #e8e8e8;
}

.tool-item {
  display: flex;
  align-items: center;
  padding: 8px 12px;
  cursor: pointer;
  transition: background 0.15s;
}

.tool-item:hover {
  background: #f5f7fa;
}

.tool-item + .tool-item {
  border-top: 1px solid #f0f0f0;
}

.tool-icon {
  margin-right: 8px;
  font-size: 14px;
}

.tool-name {
  flex: 1;
  font-size: 13px;
  color: #333;
}

.tool-shortcut {
  font-size: 11px;
  color: #999;
  background: #f0f0f0;
  padding: 1px 6px;
  border-radius: 3px;
}

/* 批量操作 */
.batch-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.select-all-label {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: #666;
  cursor: pointer;
}

.btn-batch {
  padding: 3px 10px;
  font-size: 12px;
  border: 1px solid #1890ff;
  background: #1890ff;
  color: #fff;
  border-radius: 4px;
  cursor: pointer;
  transition: opacity 0.15s;
}

.btn-batch:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-batch:hover:not(:disabled) {
  background: #40a9ff;
}

/* 数据提示 */
.data-tip {
  font-size: 11px;
  color: #999;
  margin-bottom: 8px;
}

/* Tab 列表 */
.tab-list {
  background: #fff;
  border-radius: 6px;
  border: 1px solid #e8e8e8;
  max-height: 320px;
  overflow-y: auto;
}

.tab-item {
  display: flex;
  align-items: center;
  padding: 8px 10px;
  transition:
    background 0.15s,
    opacity 0.15s;
}

.tab-item + .tab-item {
  border-top: 1px solid #f0f0f0;
}

.tab-item.is-active {
  border-left: 3px solid #1890ff;
  padding-left: 7px;
  background: #f0f7ff;
}

.tab-item.is-discarded {
  opacity: 0.5;
}

.tab-item:hover {
  background: #fafafa;
}

.tab-item.is-active:hover {
  background: #e6f1ff;
}

/* Tab 左侧 */
.tab-left {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 120px;
  flex-shrink: 0;
}

.tab-left input[type="checkbox"] {
  width: 14px;
  height: 14px;
  cursor: pointer;
}

.favicon {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
}

.favicon-placeholder {
  width: 16px;
  height: 16px;
  font-size: 12px;
  flex-shrink: 0;
  text-align: center;
  line-height: 16px;
}

.domain {
  font-size: 11px;
  color: #999;
  max-width: 80px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Tab 中间 */
.tab-center {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 0 8px;
}

.tab-title {
  font-size: 12px;
  color: #333;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.memory-value {
  font-size: 13px;
  font-weight: 600;
  color: #333;
}

.memory-na {
  color: #999;
  font-weight: 400;
}

/* Tab 右侧 */
.tab-right {
  flex-shrink: 0;
}

.btn-discard {
  padding: 3px 10px;
  font-size: 12px;
  border: 1px solid #ff4d4f;
  background: #fff;
  color: #ff4d4f;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.15s;
}

.btn-discard:hover:not(:disabled) {
  background: #ff4d4f;
  color: #fff;
}

.btn-discard:disabled {
  border-color: #d9d9d9;
  color: #bbb;
  cursor: not-allowed;
}

/* 底部汇总 */
.summary {
  padding: 8px 0;
  font-size: 12px;
  color: #999;
  border-top: 1px solid #e8e8e8;
  text-align: center;
}

/* 批量结果提示 */
.batch-result {
  position: fixed;
  bottom: 8px;
  left: 50%;
  transform: translateX(-50%);
  padding: 6px 16px;
  border-radius: 4px;
  font-size: 12px;
  z-index: 100;
  animation: fadeIn 0.2s ease;
}

.batch-result.success {
  background: #f6ffed;
  border: 1px solid #b7eb8f;
  color: #52c41a;
}

.batch-result.error {
  background: #fff2f0;
  border: 1px solid #ffccc7;
  color: #ff4d4f;
}

@keyframes fadeIn {
  from {
    opacity: 0;
    transform: translateX(-50%) translateY(4px);
  }
  to {
    opacity: 1;
    transform: translateX(-50%) translateY(0);
  }
}
</style>
```

- [ ] **Step 4: 构建验证**

```bash
pnpm build
```

Expected: 构建成功，无 TypeScript 错误

- [ ] **Step 5: 提交**

```bash
git add popup.html popup.css src/App.vue
git commit -m "feat: 重写 popup UI，实现工具入口和 Tab 内存排行榜"
```

---

### Task 4: 构建验证与手动测试

- [ ] **Step 1: 完整构建**

```bash
pnpm build
```

Expected: 构建成功

- [ ] **Step 2: 检查 dist 产物**

```bash
ls dist/
```

Expected 文件列表：

- `popup.html`
- `popup.js`
- `popup.css`
- `background.js`（从 public/ 复制）
- `sources/` 目录（图标）

确认没有 `content.js` 和 `inject.js`。

- [ ] **Step 3: 加载扩展到 Chrome**

1. 打开 `chrome://extensions/`
2. 开启「开发者模式」
3. 点击「加载已解压的扩展程序」
4. 选择项目的 `dist/` 目录

- [ ] **Step 4: 验证 Badge**

- 打开几个标签页
- 观察扩展图标上的 badge 是否显示当前 tab 的内存（如 `128MB`）
- 切换到不同 tab，badge 应在 1 秒内更新
- 切换到 chrome:// 页面，badge 应显示 `--` 灰色

- [ ] **Step 5: 验证 Popover**

- 点击扩展图标，popover 应弹出
- 确认包含「浏览器工具」区块（3 个入口）
- 确认包含「Tab 内存排行榜」区块
- 确认数据提示文案「数据仅为 JS 堆内存...」存在
- 确认排行榜按内存从高到低排序
- 确认底部汇总栏显示正确

- [ ] **Step 6: 验证工具入口**

- 点击「性能监视器」→ 应打开新 tab 到 `chrome://inspect/#monitors`
- 点击「任务管理器」→ 应显示提示「快捷键 Shift+Esc 已复制到剪贴板」
- 点击「帧渲染统计」→ 应显示 DevTools 操作提示

- [ ] **Step 7: 验证单个休眠**

- 找到非 active、非 pinned 的 tab
- 点击「休眠」按钮
- 该行应变为半透明，按钮变为「已休眠」
- 验证 active tab 的休眠按钮为禁用状态
- 验证 pinned tab 的休眠按钮为禁用状态

- [ ] **Step 8: 验证批量休眠**

- 勾选「全选」→ 所有可休眠 tab 应被勾选
- 取消部分 tab → 「全选」复选框应变为未勾选
- 点击「批量休眠」→ 应按内存从高到低依次休眠
- 完成后应显示结果提示

- [ ] **Step 9: 提交最终版本**

```bash
git add -A
git commit -m "feat: 内存监控插件 v2.0 重新设计完成"
```
