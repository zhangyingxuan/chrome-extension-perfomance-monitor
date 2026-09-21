# 内存监控插件重新设计

## 概述

重新设计 Chrome 内存监控扩展，将原有的全功能监控面板（CPU/内存/缓存/图表/导出）简化为轻量级 popover，核心聚焦两个功能：浏览器内置工具快捷入口 + 全 Tab 内存排行榜（含批量休眠）。

## 目标用户

需要监控浏览器内存消耗、快速释放不活跃标签页的用户。

## 成功标准

- 插件图标直接显示当前 tab 内存消耗，无需点击即可感知
- 点击弹出 popover，提供浏览器内置性能工具入口
- 展示所有 tab 的内存排行榜，支持一键/批量休眠释放内存

## 技术栈

- Vue 3 + TypeScript + Vite
- Chrome Extension Manifest V3
- 纯手写 CSS（无框架）

---

## 架构 & 数据流

### 简化后的架构

去掉 content.ts 和 inject.ts，改为 background 直接通过 `chrome.scripting.executeScript`（`world: 'MAIN'`）注入各 tab 采集 `performance.memory`。

```
background.js (service worker)
  ├─ 1s 定时器：采集当前 active tab 内存 → 更新 badge
  ├─ 3s 定时器：采集所有非 active tab 内存 → 更新缓存
  ├─ 内存缓存 Map<tabId, {title, favIconUrl, url, domain, memoryBytes, discarded, lastUpdated}>
  ├─ 响应 popup 消息：返回全量 tab 数据 / 执行 discard
  └─ 监听 tab 生命周期事件（激活、关闭、更新）

popup (Vue 3)
  ├─ 打开后每 1s 从 background 取最新缓存
  ├─ 展示工具入口 + 内存排行榜
  └─ discard 操作 → 发消息给 background → background 调用 chrome.tabs.discard()
```

### 采集方式

对每个 tab 执行 `chrome.scripting.executeScript`，在 MAIN world 读取 `performance.memory.usedJSHeapSize`。

chrome:// 等不可注入的 tab 跳过，内存标记为不可用。

### 数据来源说明

扩展只能获取 JS 堆内存（`performance.memory.usedJSHeapSize`），不含渲染进程开销、GPU 内存等。UI 中需提示用户此限制。

---

## Icon Badge

### 显示内容

当前 active tab 的 JS 堆内存：

- 正常格式：`XXXMB`
- 超过 1024MB：`X.XGB`
- 不可注入的 tab：`--`（灰色背景）

### 更新频率

- active tab：每 1 秒采集并更新 badge
- 其他 tab：每 3 秒采集一次，更新缓存
- active tab 切换时立即触发一次采集

### Badge 背景色

| 内存范围  | 颜色           | 含义     |
| --------- | -------------- | -------- |
| < 200MB   | `#4CAF50` 绿色 | 正常     |
| 200-500MB | `#FF9800` 橙色 | 中等     |
| > 500MB   | `#F44336` 红色 | 偏高     |
| 不可用    | `#9E9E9E` 灰色 | 无法采集 |

---

## Popover UI 布局

### 尺寸

- 宽度：450px
- 高度：自适应，最大 550px，超出滚动

### 结构

```
┌─────────────────────────────────────────┐
│  🔋 内存监控              [当前: 128MB]  │  ← 标题栏，右侧显示当前tab内存
├─────────────────────────────────────────┤
│  📊 浏览器工具                            │  ← 区块标题
│  ┌───────────────────────────────────┐  │
│  │ 🔍 性能监视器                      │  │
│  │ 📋 任务管理器          Shift+Esc  │  │
│  │ 🎞️ 帧渲染统计                     │  │
│  └───────────────────────────────────┘  │
├─────────────────────────────────────────┤
│  🏆 Tab 内存排行榜          [全选] [批量休眠(3)]  │
│  ⚠️ 数据仅为JS堆内存，不含渲染进程开销    │
│  ┌───────────────────────────────────┐  │
│  │ ☐ 🌐 github.com                  │  │
│  │   GitHub - Where the...    256MB  │  │
│  │                           [休眠]  │  │
│  ├───────────────────────────────────┤  │
│  │ ☐ 🌐 youtube.com                 │  │
│  │   YouTube                 189MB  │  │
│  │                           [休眠]  │  │
│  ├───────────────────────────────────┤  │
│  │ ☐ 🌐 google.com                  │  │
│  │   Google                   45MB  │  │
│  │                           [休眠]  │  │
│  └───────────────────────────────────┘  │
│                                        │
│  已勾选 3 个 · 共 12 个 · 总计 490MB · 可释放 ~490MB  │
└─────────────────────────────────────────┘
```

### 排行榜每行细节

- 左侧：checkbox + favicon（16x16）+ 域名（灰色小字）
- 中间：tab 标题（截断省略）+ 右侧内存数值（加粗）
- 最右：「休眠」按钮
- 当前 active tab 高亮标记（左边框蓝色）
- 不可注入的 tab 显示 `--`，休眠按钮禁用

### 休眠按钮状态

- 默认：可点击
- 已休眠 tab：按钮变为「已休眠」灰色，行半透明，文字变浅
- 当前 active tab：按钮禁用，hover 提示「无法休眠当前标签页」
- pinned tab：按钮禁用，hover 提示「无法休眠固定标签页」
- audible tab：按钮禁用，hover 提示「无法休眠正在播放音频的标签页」

---

## Discard 休眠功能

### 单个休眠

点击「休眠」按钮 → popup 发消息给 background → background 调用 `chrome.tabs.discard(tabId)`。

### Chrome 限制处理

| 场景        | 处理                                           |
| ----------- | ---------------------------------------------- |
| active tab  | 按钮禁用，提示「无法休眠当前标签页」           |
| pinned tab  | 按钮禁用，提示「无法休眠固定标签页」           |
| audible tab | 按钮禁用，提示「无法休眠正在播放音频的标签页」 |
| 调用失败    | 按钮短暂抖动，tooltip 显示失败原因             |
| tab 被关闭  | 从排行榜移除                                   |

### 批量休眠

排行榜区块标题栏右侧：

- **「全选」复选框**：勾选后仅选中处于「可休眠」状态的 tab（非 active、非 pinned、非 audible、非已休眠），不可休眠的 tab 的 checkbox 始终禁用
- 每行左侧 checkbox 可单独勾选/取消
- **「批量休眠」按钮**：显示选中数量 `批量休眠 (5)`，未勾选时禁用

### 执行策略

- 按内存从高到低顺序执行（先休眠最耗内存的）
- 每个 discard 调用间隔 200ms，避免并发过多
- 部分失败不中断，完成后汇总提示「成功休眠 4 个，失败 1 个」

### 休眠后 UI 反馈

- 行变为半透明，按钮文字改为「已休眠」
- 内存数值保留最后一次采集值，标注「(已休眠)」
- 下次采集时如果 tab 仍为休眠状态，内存显示为 `--`

### 底部汇总栏

```
已勾选 5 个 · 共 12 个标签页 · 总计 490MB · 可释放 ~380MB
```

- 「可释放」= 所有勾选 tab 的内存之和

---

## 浏览器工具入口

三个快捷入口，点击后打开对应工具：

| 工具       | 目标                                | 实现方式                             |
| ---------- | ----------------------------------- | ------------------------------------ |
| 性能监视器 | `chrome://inspect/#monitors`        | `chrome.tabs.create({url: '...'})`   |
| 任务管理器 | Chrome 菜单 → 更多工具 → 任务管理器 | 显示快捷键 `Shift+Esc`，点击复制提示 |
| 帧渲染统计 | DevTools → More tools → Rendering   | 提示用户通过 DevTools 打开           |

---

## 文件结构 & 变更

### 删除的文件

- `src/content.ts` — 不再需要 content script 桥接
- `src/inject.ts` — 不再需要页面注入脚本
- `src/App.vue` — 完全重写
- `popup.css` — 完全重写

### 保留的文件

- `public/manifest.json` — 更新
- `public/background.js` — 完全重写
- `popup.html` — 小幅调整
- `vite.config.ts` — 移除 content/inject 入口
- `package.json` — 保留依赖

### 新增/重写的文件

- `src/App.vue` — 全新 popover UI
- `popup.css` — 全新样式
- `public/background.js` — 全新（持续采集、badge 更新、discard 处理）

### manifest.json 变更

- 移除 `content_scripts` 配置
- 移除 `web_accessible_resources`
- 保留权限：`activeTab`, `tabs`, `scripting`, `storage`
- 移除权限：`downloads`

### vite.config.ts 变更

- 入口只保留 `popup`，移除 `content` 和 `inject`
