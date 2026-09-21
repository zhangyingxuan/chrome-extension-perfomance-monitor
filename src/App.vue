<template>
  <div class="monitor">
    <!-- 标题栏 -->
    <div class="header">
      <span class="header-title">性能监控</span>
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
            :disabled="selectedIds.size === 0 || batchDiscarding"
            @click="batchDiscard"
          >
            {{ batchDiscarding ? '处理中...' : `批量休眠 (${selectedIds.size})` }}
          </button>
        </div>
      </div>

      <div class="data-tip">数据仅为 JS 堆内存，不含渲染进程开销、GPU 内存等</div>

      <div class="tab-list">
        <div
          v-for="tab in sortedTabs"
          :key="tab.tabId"
          class="tab-item"
          :class="{
            'is-active': tab.isActive,
            'is-discarded': tab.discarded
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
              @error="(e: Event) => { const t = e.target as HTMLImageElement; if (t) t.style.visibility = 'hidden' }"
            />
            <span v-else class="favicon-placeholder">&#127760;</span>
            <span class="domain">{{ tab.domain || '--' }}</span>
          </div>

          <div class="tab-center">
            <span class="tab-title" :title="tab.title">{{ tab.title }}</span>
            <span class="memory-value" :class="{ 'memory-na': tab.memoryBytes == null }">
              {{ tab.discarded ? formatMemory(tab.memoryBytes) + ' (已休眠)' : formatMemory(tab.memoryBytes) }}
            </span>
          </div>

          <div class="tab-right">
            <button
              class="btn-discard"
              :disabled="!canDiscardTab(tab)"
              :title="getDiscardTooltip(tab)"
              @click="discardTab(tab.tabId)"
            >
              {{ tab.discarded ? '已休眠' : '休眠' }}
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- 底部汇总 -->
    <div class="summary">
      已勾选 {{ selectedIds.size }} 个 &middot;
      共 {{ sortedTabs.length }} 个标签页 &middot;
      总计 {{ totalMemoryDisplay }} &middot;
      可释放 ~{{ reclaimableDisplay }}
    </div>

    <!-- 批量操作结果提示 -->
    <div v-if="batchResultMessage" class="batch-result" :class="batchResultType">
      {{ batchResultMessage }}
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, ref, computed, onMounted, onUnmounted } from 'vue'

interface TabInfo {
  tabId: number
  title: string
  url: string
  domain: string
  favIconUrl: string
  memoryBytes: number | null
  discarded: boolean
  lastUpdated: number
  isActive: boolean
  pinned: boolean
  audible: boolean
}

export default defineComponent({
  name: 'App',
  setup() {
    const tabs = ref<TabInfo[]>([])
    const activeTabId = ref<number | null>(null)
    const selectedIds = ref<Set<number>>(new Set())
    const batchDiscarding = ref(false)
    const batchResultMessage = ref('')
    const batchResultType = ref<'success' | 'error'>('success')
    let pollTimer: number | null = null
    let batchResultTimer: number | null = null

    // ===== 数据获取 =====

    async function fetchTabs() {
      return new Promise<{ tabs: TabInfo[]; activeTabId: number | null }>((resolve) => {
        chrome.runtime.sendMessage({ type: 'GET_ALL_TABS' }, (response) => {
          if (chrome.runtime.lastError) {
            resolve({ tabs: [], activeTabId: null })
            return
          }
          resolve(response || { tabs: [], activeTabId: null })
        })
      })
    }

    async function refreshData() {
      const data = await fetchTabs()
      tabs.value = data.tabs
      activeTabId.value = data.activeTabId
    }

    // ===== 排序后的 tab 列表 =====

    const sortedTabs = computed(() => {
      return [...tabs.value].sort((a, b) => {
        const aMem = a.memoryBytes ?? -1
        const bMem = b.memoryBytes ?? -1
        return bMem - aMem
      })
    })

    // ===== 显示值 =====

    const activeTabMemoryDisplay = computed(() => {
      const active = tabs.value.find(t => t.isActive)
      return formatMemory(active?.memoryBytes ?? null)
    })

    const totalMemoryDisplay = computed(() => {
      const total = tabs.value.reduce((sum, t) => sum + (t.memoryBytes || 0), 0)
      return formatMemory(total || null)
    })

    const reclaimableDisplay = computed(() => {
      let total = 0
      for (const id of selectedIds.value) {
        const tab = tabs.value.find(t => t.tabId === id)
        if (tab) total += tab.memoryBytes || 0
      }
      return formatMemory(total || null)
    })

    function formatMemory(bytes: number | null): string {
      if (bytes == null || bytes === 0) return '--'
      const mb = bytes / (1024 * 1024)
      if (mb >= 1024) return (mb / 1024).toFixed(1) + 'GB'
      return Math.round(mb) + 'MB'
    }

    // ===== 选择逻辑 =====

    const discardableTabs = computed(() => {
      return tabs.value.filter(t => isDiscardable(t))
    })

    const allDiscardableSelected = computed(() => {
      const discardable = discardableTabs.value
      if (discardable.length === 0) return false
      return discardable.every(t => selectedIds.value.has(t.tabId))
    })

    function isDiscardable(tab: TabInfo): boolean {
      return !tab.isActive && !tab.pinned && !tab.audible && !tab.discarded && tab.memoryBytes != null
    }

    function toggleSelect(tabId: number) {
      const newSet = new Set(selectedIds.value)
      if (newSet.has(tabId)) {
        newSet.delete(tabId)
      } else {
        newSet.add(tabId)
      }
      selectedIds.value = newSet
    }

    function toggleSelectAll() {
      if (allDiscardableSelected.value) {
        selectedIds.value = new Set()
      } else {
        selectedIds.value = new Set(discardableTabs.value.map(t => t.tabId))
      }
    }

    // ===== 休眠逻辑 =====

    function canDiscardTab(tab: TabInfo): boolean {
      return !tab.isActive && !tab.pinned && !tab.audible && !tab.discarded
    }

    function getDiscardTooltip(tab: TabInfo): string {
      if (tab.isActive) return '无法休眠当前标签页'
      if (tab.pinned) return '无法休眠固定标签页'
      if (tab.audible) return '无法休眠正在播放音频的标签页'
      if (tab.discarded) return '已休眠'
      return '点击休眠此标签页'
    }

    async function discardTab(tabId: number) {
      const result = await new Promise<{ success: boolean; error?: string }>((resolve) => {
        chrome.runtime.sendMessage({ type: 'DISCARD_TAB', tabId }, (response) => {
          if (chrome.runtime.lastError) {
            resolve({ success: false, error: '通信失败' })
            return
          }
          resolve(response || { success: false, error: '无响应' })
        })
      })

      if (result.success) {
        const tab = tabs.value.find(t => t.tabId === tabId)
        if (tab) tab.discarded = true
        selectedIds.value.delete(tabId)
        selectedIds.value = new Set(selectedIds.value)
      } else {
        showBatchResult(result.error || '休眠失败', 'error')
      }
    }

    async function batchDiscard() {
      if (selectedIds.value.size === 0) return
      batchDiscarding.value = true

      const result = await new Promise<{ results: { tabId: number; success: boolean; error?: string }[] }>((resolve) => {
        chrome.runtime.sendMessage({ type: 'BATCH_DISCARD', tabIds: Array.from(selectedIds.value) }, (response) => {
          if (chrome.runtime.lastError) {
            resolve({ results: [] })
            return
          }
          resolve(response || { results: [] })
        })
      })

      const successCount = result.results.filter(r => r.success).length
      const failCount = result.results.length - successCount

      if (failCount === 0) {
        showBatchResult(`成功休眠 ${successCount} 个标签页`, 'success')
      } else {
        showBatchResult(`成功休眠 ${successCount} 个，失败 ${failCount} 个`, 'error')
      }

      selectedIds.value = new Set()
      batchDiscarding.value = false
      await refreshData()
    }

    function showBatchResult(message: string, type: 'success' | 'error') {
      batchResultMessage.value = message
      batchResultType.value = type
      if (batchResultTimer) clearTimeout(batchResultTimer)
      batchResultTimer = window.setTimeout(() => {
        batchResultMessage.value = ''
      }, 3000)
    }

    // ===== 工具入口 =====

    function openTool(tool: string) {
      switch (tool) {
        case 'performance':
          chrome.tabs.create({ url: 'chrome://inspect/#monitors' })
          break
        case 'taskManager':
          navigator.clipboard.writeText('Shift+Esc').then(() => {
            showBatchResult('快捷键 Shift+Esc 已复制到剪贴板', 'success')
          })
          break
        case 'rendering':
          showBatchResult('请按 F12 打开 DevTools → Ctrl+Shift+P → 输入 "Rendering"', 'success')
          break
      }
    }

    // ===== 生命周期 =====

    onMounted(async () => {
      await refreshData()
      pollTimer = window.setInterval(refreshData, 1000)
    })

    onUnmounted(() => {
      if (pollTimer) clearInterval(pollTimer)
      if (batchResultTimer) clearTimeout(batchResultTimer)
    })

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
    }
  }
})
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
  transition: background 0.15s, opacity 0.15s;
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
  from { opacity: 0; transform: translateX(-50%) translateY(4px); }
  to { opacity: 1; transform: translateX(-50%) translateY(0); }
}
</style>
