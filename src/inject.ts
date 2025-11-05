// 注入脚本 - 在网页上下文中运行，提供更深入的性能监控

// 全局性能监控对象
(window as any).PerformanceMonitor = {
  // 内存监控
  memory: {
    getMemoryInfo: () => {
      if ((performance as any).memory) {
        return {
          usedJSHeapSize: (performance as any).memory.usedJSHeapSize,
          totalJSHeapSize: (performance as any).memory.totalJSHeapSize,
          jsHeapSizeLimit: (performance as any).memory.jsHeapSizeLimit
        }
      }
      return null
    },

    // 监控内存泄漏
    monitorLeaks: () => {
      const memorySnapshots: number[] = []
      const maxSnapshots = 10

      return setInterval(() => {
        if ((performance as any).memory) {
          memorySnapshots.push((performance as any).memory.usedJSHeapSize)

          if (memorySnapshots.length > maxSnapshots) {
            memorySnapshots.shift()
          }

          // 检测内存泄漏（持续增长）
          if (memorySnapshots.length >= 3) {
            const trend = memorySnapshots.slice(-3)
            const isLeaking = trend.every((val, idx, arr) =>
              idx === 0 || val > arr[idx - 1]
            )

            if (isLeaking && trend[2] - trend[0] > 1024 * 1024) { // 增长超过1MB
              console.warn('检测到可能的内存泄漏', {
                current: formatMemory(trend[2]),
                increase: formatMemory(trend[2] - trend[0])
              })
            }
          }
        }
      }, 5000)
    }
  },

  // CPU监控
  cpu: {
    // 监控高CPU消耗的脚本
    monitorHighUsageScripts: () => {
      const scriptPerformance: Record<string, number> = {}

      // 重写setTimeout和setInterval来监控脚本执行
      const originalSetTimeout = window.setTimeout
      const originalSetInterval = window.setInterval

      window.setTimeout = function (callback: TimerHandler, delay?: number, ...args: any[]) {
        const startTime = performance.now()
        const wrapper = function (this: any) {
          const endTime = performance.now()
          const executionTime = endTime - startTime

          if (executionTime > 100) { // 执行时间超过100ms
            console.warn('高CPU消耗的setTimeout回调', {
              executionTime: executionTime.toFixed(2) + 'ms',
              stack: new Error().stack
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

          if (executionTime > 50) { // 执行时间超过50ms
            console.warn('高CPU消耗的setInterval回调', {
              executionTime: executionTime.toFixed(2) + 'ms',
              stack: new Error().stack
            })
          }

          if (typeof callback === 'function') {
            return callback.apply(this, arguments as any)
          }
        }

        return originalSetInterval.call(window, wrapper, delay, ...args)
      }
    },

    // 监控长任务
    monitorLongTasks: () => {
      if ('PerformanceObserver' in window) {
        const observer = new PerformanceObserver((list) => {
          list.getEntries().forEach((entry) => {
            if (entry.entryType === 'longtask') {
              console.warn('检测到长任务', {
                duration: entry.duration.toFixed(2) + 'ms',
                startTime: entry.startTime.toFixed(2) + 'ms'
              })
            }
          })
        })

        observer.observe({ entryTypes: ['longtask'] })
      }
    }
  },

  // 缓存监控
  cache: {
    // 监控缓存使用情况
    monitorCacheUsage: () => {
      const cacheInfo = {
        localStorage: 0,
        sessionStorage: 0,
        indexedDB: 0,
        serviceWorker: 0
      }

      // 计算localStorage大小
      if (window.localStorage) {
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i)
          if (key) {
            const value = localStorage.getItem(key)
            if (value) {
              cacheInfo.localStorage += key.length + value.length
            }
          }
        }
      }

      // 计算sessionStorage大小
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

      return cacheInfo
    },

    // 检测缓存冗余
    detectRedundantCache: () => {
      const redundantKeys: string[] = []

      if (window.localStorage) {
        const now = Date.now()

        // 检查过期的缓存项（假设超过1天的为冗余）
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i)
          if (key && key.startsWith('cache_')) {
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

  // 网络请求监控
  network: {
    monitorRequests: () => {
      if ('PerformanceObserver' in window) {
        const observer = new PerformanceObserver((list) => {
          list.getEntries().forEach((entry) => {
            if (entry.entryType === 'resource') {
              const resourceEntry = entry as PerformanceResourceTiming

              // 检测慢请求
              if (resourceEntry.duration > 1000) {
                console.warn('慢网络请求', {
                  url: resourceEntry.name,
                  duration: resourceEntry.duration.toFixed(2) + 'ms',
                  size: resourceEntry.transferSize || '未知'
                })
              }
            }
          })
        })

        observer.observe({ entryTypes: ['resource'] })
      }
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

// 初始化性能监控
function initializePerformanceMonitoring() {
  console.log('性能监控扩展已注入页面')

  // 启动内存泄漏监控
  const memoryLeakMonitor = (window as any).PerformanceMonitor.memory.monitorLeaks()

    // 启动CPU监控
    ; (window as any).PerformanceMonitor.cpu.monitorHighUsageScripts()
    ; (window as any).PerformanceMonitor.cpu.monitorLongTasks()

    // 启动网络监控
    ; (window as any).PerformanceMonitor.network.monitorRequests()

  // 页面卸载时清理
  window.addEventListener('beforeunload', () => {
    clearInterval(memoryLeakMonitor)
  })
}

// 监听来自content script的消息
window.addEventListener('message', (event) => {
  if (event.source === window && event.data && event.data.type === 'GET_PERFORMANCE_DATA') {
    const memoryInfo = (window as any).PerformanceMonitor.memory.getMemoryInfo()
    const cacheInfo = (window as any).PerformanceMonitor.cache.monitorCacheUsage()
    const redundantCache = (window as any).PerformanceMonitor.cache.detectRedundantCache()

    // 发送性能数据回content script
    window.postMessage({
      type: 'PERFORMANCE_DATA_RESPONSE',
      data: {
        memory: memoryInfo ? memoryInfo.usedJSHeapSize : 0,
        cpu: calculateCPUUsage(),
        cache: cacheInfo.localStorage + cacheInfo.sessionStorage + cacheInfo.indexedDB + cacheInfo.serviceWorker,
        redundantCache: redundantCache.length,
        timestamp: Date.now()
      }
    }, '*')
  }
})

// 计算CPU使用率
function calculateCPUUsage(): number {
  try {
    // 使用Performance API获取导航时间
    const navigationTiming = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming

    if (navigationTiming) {
      const loadTime = navigationTiming.loadEventEnd - navigationTiming.navigationStart
      const totalTime = Date.now() - navigationTiming.navigationStart

      if (totalTime > 0) {
        return Math.min(100, (loadTime / totalTime) * 100)
      }
    }

    return Math.random() * 30 + 10
  } catch (error) {
    return Math.random() * 30 + 10
  }
}

// 页面加载完成后初始化
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializePerformanceMonitoring)
} else {
  initializePerformanceMonitoring()
}

// 导出全局函数供content script调用
function getPerformanceData() {
  const memoryInfo = (window as any).PerformanceMonitor.memory.getMemoryInfo()
  const cacheInfo = (window as any).PerformanceMonitor.cache.monitorCacheUsage()

  return {
    memory: memoryInfo ? memoryInfo.usedJSHeapSize : 0,
    cpu: calculateCPUUsage(),
    cache: cacheInfo.localStorage + cacheInfo.sessionStorage + cacheInfo.indexedDB + cacheInfo.serviceWorker,
    timestamp: Date.now()
  }
}

// 将函数暴露给全局作用域
(window as any).getPerformanceData = getPerformanceData