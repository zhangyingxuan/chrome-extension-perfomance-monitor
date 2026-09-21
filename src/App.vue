<template>
  <div class="monitor">
    <!-- 自动休眠（单行） -->
    <div class="auto-discard-row">
      <span class="auto-discard-label">自动休眠</span>
      <input
        type="range"
        class="time-slider"
        min="1"
        max="180"
        :value="autoDiscardMinutes"
        :disabled="!autoDiscardEnabled"
        :style="{ '--fill': autoDiscardFill + '%' }"
        @input="onSliderInput"
      />
      <span
        class="time-display"
        :class="{ 'is-disabled': !autoDiscardEnabled }"
      >
        {{ formatAutoDiscardTime(autoDiscardMinutes) }}
      </span>
      <label class="switch">
        <input
          type="checkbox"
          :checked="autoDiscardEnabled"
          @change="toggleAutoDiscard"
        />
        <span class="switch-slider"></span>
      </label>
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
            :disabled="selectedIds.size === 0 || batchDiscarding"
            @click="batchDiscard"
          >
            {{
              batchDiscarding ? "处理中..." : `批量休眠 (${selectedIds.size})`
            }}
          </button>
          <button
            class="btn-help"
            :class="{ 'is-active': helpOpen }"
            title="浏览器工具"
            aria-label="浏览器工具"
            @click.stop="toggleHelp"
          >
            ?
          </button>
        </div>

        <!-- 浏览器工具 popover -->
        <div v-if="helpOpen" class="tools-popover" @click.stop>
          <div class="tools-popover-title">浏览器工具</div>
          <div class="tools-popover-item">
            <span class="popover-item-name">性能监视器</span>
            <span class="popover-item-instr"
              >F12 → Ctrl+Shift+P → "Show Performance Monitor"</span
            >
          </div>
          <div class="tools-popover-item">
            <span class="popover-item-name">帧渲染统计</span>
            <span class="popover-item-instr"
              >F12 → Ctrl+Shift+P → "Rendering"</span
            >
          </div>
          <div class="tools-popover-item">
            <span class="popover-item-name">任务管理器</span>
            <span class="popover-item-instr">Shift+Esc 右上角... 更多工具</span>
          </div>
        </div>
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
            @error="
              (e: Event) => {
                const t = e.target as HTMLImageElement;
                if (t) t.style.visibility = 'hidden';
              }
            "
          />
          <span v-else class="favicon-placeholder">&#127760;</span>
          <span class="tab-title" :title="tab.title">{{ tab.title }}</span>
          <span
            class="memory-value"
            :class="{ 'memory-na': tab.memoryBytes == null }"
          >
            {{ formatMemory(tab.memoryBytes) }}
          </span>
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

    <!-- 底部汇总 -->
    <div class="summary">
      已勾选 {{ selectedIds.size }} 个 &middot; 共 {{ sortedTabs.length }} 个
      &middot; 总计 {{ totalMemoryDisplay }} &middot; 可释放 ~{{
        reclaimableDisplay
      }}
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
import { defineComponent, ref, computed, onMounted, onUnmounted } from "vue";

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
    const selectedIds = ref<Set<number>>(new Set());
    const batchDiscarding = ref(false);
    const batchResultMessage = ref("");
    const batchResultType = ref<"success" | "error">("success");
    const autoDiscardEnabled = ref(false);
    const autoDiscardMinutes = ref(30);
    let pollTimer: number | null = null;
    let batchResultTimer: number | null = null;
    const helpOpen = ref(false);

    // 滑块已填充比例（1–180 映射到 0–100%）
    const autoDiscardFill = computed(() => {
      return ((autoDiscardMinutes.value - 1) / (180 - 1)) * 100;
    });

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

    // ===== 自动休眠 =====

    async function fetchAutoDiscardSettings() {
      return new Promise<{ enabled: boolean; thresholdMinutes: number }>(
        (resolve) => {
          chrome.runtime.sendMessage(
            { type: "GET_AUTO_DISCARD" },
            (response) => {
              if (chrome.runtime.lastError) {
                resolve({ enabled: false, thresholdMinutes: 30 });
                return;
              }
              resolve(response || { enabled: false, thresholdMinutes: 30 });
            },
          );
        },
      );
    }

    async function toggleAutoDiscard() {
      const newEnabled = !autoDiscardEnabled.value;
      const result = await new Promise<{
        enabled: boolean;
        thresholdMinutes: number;
      }>((resolve) => {
        chrome.runtime.sendMessage(
          { type: "SET_AUTO_DISCARD", enabled: newEnabled },
          (response) => {
            if (chrome.runtime.lastError) {
              resolve({
                enabled: newEnabled,
                thresholdMinutes: autoDiscardMinutes.value,
              });
              return;
            }
            resolve(
              response || {
                enabled: newEnabled,
                thresholdMinutes: autoDiscardMinutes.value,
              },
            );
          },
        );
      });
      autoDiscardEnabled.value = result.enabled;
    }

    function onSliderInput(e: Event) {
      const value = Number((e.target as HTMLInputElement).value);
      autoDiscardMinutes.value = value;
      debouncedSaveAutoDiscard(value);
    }

    let saveTimer: number | null = null;
    function debouncedSaveAutoDiscard(minutes: number) {
      if (saveTimer) clearTimeout(saveTimer);
      saveTimer = window.setTimeout(() => {
        chrome.runtime.sendMessage({
          type: "SET_AUTO_DISCARD",
          thresholdMinutes: minutes,
        });
      }, 300);
    }

    function formatAutoDiscardTime(minutes: number): string {
      if (minutes < 60) return `${minutes} 分钟`;
      const h = Math.floor(minutes / 60);
      const m = minutes % 60;
      if (m === 0) return `${h} 小时`;
      return `${h} 小时 ${m} 分钟`;
    }

    // ===== 帮助 popover =====

    function toggleHelp() {
      helpOpen.value = !helpOpen.value;
    }

    function closeHelp() {
      helpOpen.value = false;
    }

    // ===== 生命周期 =====

    onMounted(async () => {
      const settings = await fetchAutoDiscardSettings();
      autoDiscardEnabled.value = settings.enabled;
      autoDiscardMinutes.value = settings.thresholdMinutes;
      await refreshData();
      pollTimer = window.setInterval(refreshData, 1000);
      document.addEventListener("click", closeHelp);
    });

    onUnmounted(() => {
      if (pollTimer) clearInterval(pollTimer);
      if (batchResultTimer) clearTimeout(batchResultTimer);
      document.removeEventListener("click", closeHelp);
    });

    return {
      tabs,
      selectedIds,
      batchDiscarding,
      batchResultMessage,
      batchResultType,
      sortedTabs,
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
      autoDiscardEnabled,
      autoDiscardMinutes,
      autoDiscardFill,
      toggleAutoDiscard,
      onSliderInput,
      formatAutoDiscardTime,
      helpOpen,
      toggleHelp,
      closeHelp,
    };
  },
});
</script>

<style scoped>
.monitor {
  padding: 10px 12px;
}

/* 自动休眠（单行） */
.auto-discard-row {
  display: flex;
  align-items: center;
  gap: 10px;
  background: #f8f9fa;
  border: 1px solid #ececec;
  border-radius: 8px;
  padding: 8px 10px;
  margin-bottom: 10px;
}

.auto-discard-label {
  flex-shrink: 0;
  font-size: 12px;
  font-weight: 600;
  color: #666;
}

.switch {
  position: relative;
  display: inline-block;
  width: 36px;
  height: 20px;
}

.switch input {
  opacity: 0;
  width: 0;
  height: 0;
}

.switch-slider {
  position: absolute;
  cursor: pointer;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: #ccc;
  transition: 0.2s;
  border-radius: 20px;
}

.switch-slider:before {
  position: absolute;
  content: "";
  height: 16px;
  width: 16px;
  left: 2px;
  bottom: 2px;
  background-color: white;
  transition: 0.2s;
  border-radius: 50%;
}

.switch input:checked + .switch-slider {
  background-color: #1890ff;
}

.switch input:checked + .switch-slider:before {
  transform: translateX(16px);
}

.time-slider {
  flex: 1;
  min-width: 0;
  height: 18px;
  -webkit-appearance: none;
  appearance: none;
  background: transparent;
  outline: none;
  cursor: pointer;
}

.time-slider::-webkit-slider-runnable-track {
  height: 6px;
  border-radius: 3px;
  background: linear-gradient(
    to right,
    #1890ff 0%,
    #1890ff var(--fill, 20%),
    #e5e5e5 var(--fill, 20%),
    #e5e5e5 100%
  );
}

.time-slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 16px;
  height: 16px;
  margin-top: -5px;
  border-radius: 50%;
  background: #fff;
  border: 2px solid #1890ff;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.15);
  transition:
    transform 0.15s,
    box-shadow 0.15s;
  cursor: grab;
}

.time-slider::-webkit-slider-thumb:active {
  cursor: grabbing;
  transform: scale(1.15);
  box-shadow: 0 2px 6px rgba(24, 144, 255, 0.35);
}

.time-slider:focus-visible::-webkit-slider-thumb {
  box-shadow: 0 0 0 3px rgba(24, 144, 255, 0.25);
}

.time-slider:disabled {
  cursor: not-allowed;
}

.time-slider:disabled::-webkit-slider-runnable-track {
  background: #ececec;
}

.time-slider:disabled::-webkit-slider-thumb {
  border-color: #d0d0d0;
  box-shadow: none;
}

.time-display {
  flex-shrink: 0;
  min-width: 76px;
  font-size: 12px;
  font-weight: 600;
  color: #333;
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.time-display.is-disabled {
  color: #bbb;
}

/* 区块 */
.section {
  margin-bottom: 8px;
}

.section-title {
  font-size: 12px;
  font-weight: 600;
  color: #666;
}

.section-header {
  position: relative;
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 6px;
}

/* 帮助按钮 */
.btn-help {
  width: 20px;
  height: 20px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 1px solid #d9d9d9;
  border-radius: 50%;
  background: #fff;
  color: #999;
  font-size: 12px;
  line-height: 1;
  cursor: pointer;
  transition: all 0.15s;
}

.btn-help:hover,
.btn-help.is-active {
  border-color: #1890ff;
  color: #1890ff;
  background: #e6f4ff;
}

/* 浏览器工具 popover */
.tools-popover {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  z-index: 20;
  width: 300px;
  background: #fff;
  border: 1px solid #e8e8e8;
  border-radius: 8px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.12);
  padding: 10px 12px 8px;
}

.tools-popover-title {
  font-size: 11px;
  font-weight: 600;
  color: #666;
  margin-bottom: 6px;
}

.tools-popover-item {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 3px 0;
}

.popover-item-name {
  flex-shrink: 0;
  font-size: 12px;
  color: #333;
}

.popover-item-instr {
  font-size: 10px;
  color: #999;
  font-family: monospace;
  text-align: right;
  min-width: 0;
  overflow-wrap: anywhere;
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

/* Tab 列表 */
.tab-list {
  background: #fff;
  border-radius: 6px;
  border: 1px solid #e8e8e8;
  max-height: 400px;
  overflow-y: auto;
}

.tab-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 7px 10px;
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

.tab-item input[type="checkbox"] {
  width: 14px;
  height: 14px;
  flex-shrink: 0;
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

.tab-title {
  flex: 1;
  min-width: 0;
  font-size: 12px;
  color: #333;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.memory-value {
  flex-shrink: 0;
  font-size: 12px;
  font-weight: 600;
  color: #333;
}

.memory-na {
  color: #999;
  font-weight: 400;
}

.btn-discard {
  flex-shrink: 0;
  padding: 2px 8px;
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
  padding: 6px 0 2px;
  font-size: 11px;
  color: #999;
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
