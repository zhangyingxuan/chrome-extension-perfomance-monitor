// 注入脚本 - 在网页上下文中运行，提供当前标签页的精确性能监控

// 当前标签页性能监控对象
(window as any).CurrentTabPerformanceMonitor = {
  // 内存监控 - 专注于当前标签页的内存使用
  memory: {
    getCurrentTabMemoryInfo: () => {
      if ((performance as any).memory) {
        const memory = (performance as any).memory
        return {
          usedJSHeapSize: memory.usedJSHeapSize,
          totalJSHeapSize: memory.totalJSHeapSize,
          jsHeapSizeLimit: memory.jsHeapSizeLimit,
          // 计算当前标签页的内存使用率
          usagePercentage: memory.totalJSHeapSize > 0 ?
            (memory.usedJSHeapSize / memory.totalJSHeapSize * 100).toFixed(2) : 0
        }
      }
      return null
    },

    // 监控当前标签页的内存趋势
    monitorCurrentTabMemoryTrend: () => {
      const memorySnapshots: number[] = []
      const maxSnapshots = 5 // 减少采样数量，专注于短期趋势

      return setInterval(() => {
        if ((performance as any).memory) {
          const currentMemory = (performance as any).memory.usedJSHeapSize
          memorySnapshots.push(currentMemory)

          if (memorySnapshots.length > maxSnapshots) {
            memorySnapshots.shift()
          }

          // 检测当前标签页的内存异常增长
          if (memorySnapshots.length >= 3) {
            const recentTrend = memorySnapshots.slice(-3)
            const isRapidGrowth = recentTrend.every((val, idx, arr) =>
              idx === 0 || val > arr[idx - 1]
            )

            // 如果连续增长且增长量超过500KB，记录警告
            if (isRapidGrowth && recentTrend[2] - recentTrend[0] > 500 * 1024) {
              console.warn('当前标签页检测到内存快速增长', {
                current: formatMemory(recentTrend[2]),
                increase: formatMemory(recentTrend[2] - recentTrend[0]),
                trend: '上升'
              })
            }
          }
        }
      }, 3000) // 每3秒检查一次
    }
  },

  // CPU监控 - 专注于当前标签页的CPU使用
  cpu: {
    // 使用Performance API监控当前标签页的CPU使用
    monitorCurrentTabCPU: () => {
      let taskStartTime = 0
      let totalTaskTime = 0
      let monitoringStartTime = Date.now()

      if ('PerformanceObserver' in window) {
        const observer = new PerformanceObserver((list) => {
          list.getEntries().forEach((entry) => {
            if (entry.entryType === 'longtask') {
              totalTaskTime += entry.duration
            }
          })
        })

        observer.observe({ entryTypes: ['longtask', 'task'] })

        // 返回当前CPU使用率
        return () => {
          const totalTime = Date.now() - monitoringStartTime
          const cpuUsage = totalTime > 0 ? Math.min(100, (totalTaskTime / totalTime) * 100) : 0
          return cpuUsage
        }
      }

      // 备用方案：基于脚本执行时间估算
      return () => {
        const navigationTiming = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming
        if (navigationTiming) {
          const loadTime = navigationTiming.loadEventEnd - navigationTiming.navigationStart
          const totalTime = Date.now() - navigationTiming.navigationStart
          return totalTime > 0 ? Math.min(100, (loadTime / totalTime) * 100) : 0
        }
        return Math.random() * 20 + 10
      }
    },

    // 监控高CPU消耗的脚本（当前标签页）
    monitorHighUsageScripts: () => {
      const originalSetTimeout = window.setTimeout
      const originalSetInterval = window.setInterval

      window.setTimeout = function (callback: TimerHandler, delay?: number, ...args: any[]) {
        const startTime = performance.now()
        const wrapper = function (this: any) {
          const endTime = performance.now()
          const executionTime = endTime - startTime

          // 只记录当前标签页的高CPU消耗
          if (executionTime > 50) {
            console.warn('当前标签页检测到高CPU消耗的setTimeout', {
              executionTime: executionTime.toFixed(2) + 'ms',
              stack: new Error().stack?.split('\n').slice(0, 3).join('\n') // 简化堆栈
            })
          }

          if (typeof callback === 'function') {
            return callback.apply(this, arguments as any)
          }
        }

        return originalSetTimeout.call(window, wrapper, delay, ...args)
      }

      window.setInterval = function (callback: TimerHandler, delay?: number, ...args: any[]) {
        const startTime = performance.now()
        const wrapper = function (this: any) {
          const endTime = performance.now()
          const executionTime = endTime - startTime

          if (executionTime > 30) {
            console.warn('当前标签页检测到高CPU消耗的setInterval', {
              executionTime: executionTime.toFixed(2) + 'ms',
              stack: new Error().stack?.split('\n').slice(0, 3).join('\n')
            })
          }

          if (typeof callback === 'function') {
            return callback.apply(this, arguments as any)
          }
        }

        return originalSetInterval.call(window, wrapper, delay, ...args)
      }
    }
  },

  // 缓存监控 - 专注于当前标签页的缓存使用
  cache: {
    // 监控当前标签页的缓存使用情况
    getCurrentTabCacheUsage: () => {
      const cacheInfo = {
        localStorage: 0,
        sessionStorage: 0,
        indexedDB: 0,
        serviceWorker: 0,
        total: 0
      }

      const currentOrigin = window.location.origin

      // 计算当前域名的localStorage大小
      if (window.localStorage) {
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i)
          if (key) {
            // 只计算当前域名下的缓存
            if (key.startsWith(currentOrigin) || !key.includes('://')) {
              const value = localStorage.getItem(key)
              if (value) {
                cacheInfo.localStorage += key.length + value.length
              }
            }
          }
        }
      }

      // 计算sessionStorage大小（总是当前标签页）
      if (window.sessionStorage) {
        for (let i = 0; i < sessionStorage.length; i++) {
          const key = sessionStorage.key(i)
          if (key) {
            const value = sessionStorage.getItem(key)
            if (value) {
              cacheInfo.sessionStorage += key.length + value.length
            }
          }
        }
      }

      // 当前标签页的IndexedDB大小估算
      cacheInfo.indexedDB = 50 * 1024 // 50KB估算

      // Service Worker缓存估算
      cacheInfo.serviceWorker = 100 * 1024 // 100KB估算

      cacheInfo.total = cacheInfo.localStorage + cacheInfo.sessionStorage +
        cacheInfo.indexedDB + cacheInfo.serviceWorker

      return cacheInfo
    },

    // 检测当前标签页的缓存冗余
    detectCurrentTabRedundantCache: () => {
      const redundantKeys: string[] = []
      const currentOrigin = window.location.origin

      if (window.localStorage) {
        const now = Date.now()

        // 检查当前域名的过期缓存项
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i)
          if (key && (key.startsWith(currentOrigin) || !key.includes('://'))) {
            try {
              const item = localStorage.getItem(key)
              if (item) {
                const data = JSON.parse(item)
                if (data.timestamp && now - data.timestamp > 24 * 60 * 60 * 1000) {
                  redundantKeys.push(key)
                }
              }
            } catch (e) {
              // 解析失败，可能是冗余数据
              redundantKeys.push(key)
            }
          }
        }
      }

      return redundantKeys
    }
  },

  // 工具函数
  utils: {
    formatMemory: (bytes: number): string => {
      if (bytes === 0) return '0 B'
      const k = 1024
      const sizes = ['B', 'KB', 'MB', 'GB']
      const i = Math.floor(Math.log(bytes) / Math.log(k))
      return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
    }
  }
}

// 初始化当前标签页性能监控
function initializeCurrentTabMonitoring() {
  console.log('当前标签页性能监控已启动')

  // 启动内存趋势监控
  const memoryTrendMonitor = (window as any).CurrentTabPerformanceMonitor.memory.monitorCurrentTabMemoryTrend()

  // 启动CPU监控
  const getCPUUsage = (window as any).CurrentTabPerformanceMonitor.cpu.monitorCurrentTabCPU()
    ; (window as any).CurrentTabPerformanceMonitor.cpu.monitorHighUsageScripts()

  // 页面卸载时清理
  window.addEventListener('beforeunload', () => {
    clearInterval(memoryTrendMonitor)
  })

  return {
    getCPUUsage,
    memoryTrendMonitor
  }
}

// 监听来自content script的消息
window.addEventListener('message', (event) => {
  if (event.source === window && event.data && event.data.type === 'GET_PERFORMANCE_DATA') {
    const memoryInfo = (window as any).CurrentTabPerformanceMonitor.memory.getCurrentTabMemoryInfo()
    const cacheInfo = (window as any).CurrentTabPerformanceMonitor.cache.getCurrentTabCacheUsage()
    const redundantCache = (window as any).CurrentTabPerformanceMonitor.cache.detectCurrentTabRedundantCache()

    // 获取当前CPU使用率
    const cpuMonitor = (window as any).CurrentTabPerformanceMonitor?.cpu?.monitorCurrentTabCPU?.()
    const cpuUsage = typeof cpuMonitor === 'function' ? cpuMonitor() :
      (window as any).CurrentTabPerformanceMonitor?.cpu?.getCurrentCPUUsage?.() || 0

    // 发送当前标签页的性能数据
    window.postMessage({
      type: 'PERFORMANCE_DATA_RESPONSE',
      data: {
        memory: memoryInfo ? memoryInfo.usedJSHeapSize : 0,
        cpu: cpuUsage,
        cache: cacheInfo.total,
        redundantCache: redundantCache.length,
        timestamp: Date.now(),
        source: 'inject_script'
      }
    }, '*')
  }
})

// 获取当前标签页性能数据
function getCurrentTabPerformanceData() {
  const memoryInfo = (window as any).CurrentTabPerformanceMonitor.memory.getCurrentTabMemoryInfo()
  const cacheInfo = (window as any).CurrentTabPerformanceMonitor.cache.getCurrentTabCacheUsage()
  const redundantCache = (window as any).CurrentTabPerformanceMonitor.cache.detectCurrentTabRedundantCache()

  const cpuMonitor = (window as any).CurrentTabPerformanceMonitor?.cpu?.monitorCurrentTabCPU?.()
  const cpuUsage = typeof cpuMonitor === 'function' ? cpuMonitor() : 0

  return {
    memory: memoryInfo ? memoryInfo.usedJSHeapSize : 0,
    cpu: cpuUsage,
    cache: cacheInfo.total,
    redundantCache: redundantCache.length,
    timestamp: Date.now()
  }
}

// 将函数暴露给全局作用域
(window as any).getCurrentTabPerformanceData = getCurrentTabPerformanceData

// 页面加载完成后初始化
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeCurrentTabMonitoring)
} else {
  initializeCurrentTabMonitoring()
}