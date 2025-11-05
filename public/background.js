// 后台服务脚本 - 处理扩展的后台逻辑，专注于当前标签页性能数据

// 存储性能数据，按标签页ID组织
let performanceData = {};
const MAX_DATA_POINTS = 500; // 每个标签页最多存储500个数据点（减少存储压力）

// 当前活跃标签页ID
let currentActiveTabId = null;

// 监听标签页激活事件
chrome.tabs.onActivated.addListener((activeInfo) => {
  currentActiveTabId = activeInfo.tabId;
  console.log(`当前活跃标签页: ${currentActiveTabId}`);
});

// 监听标签页更新
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === "complete" && tab.url) {
    // 初始化标签页数据存储
    if (!performanceData[tabId]) {
      performanceData[tabId] = {
        url: tab.url,
        title: tab.title,
        data: [],
        maxDataPoints: MAX_DATA_POINTS,
        lastUpdate: Date.now(),
        isActive: tabId === currentActiveTabId,
      };
    } else {
      // 更新URL和标题
      performanceData[tabId].url = tab.url;
      performanceData[tabId].title = tab.title;
      performanceData[tabId].lastUpdate = Date.now();
    }
  }
});

// 监听标签页关闭
chrome.tabs.onRemoved.addListener((tabId) => {
  // 清理标签页数据
  if (performanceData[tabId]) {
    delete performanceData[tabId];
  }

  // 如果关闭的是当前活跃标签页，清空活跃标签页ID
  if (tabId === currentActiveTabId) {
    currentActiveTabId = null;
  }
});

// 监听来自content script的消息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  const tabId = sender.tab?.id;

  if (!tabId) return false;

  switch (request.type) {
    case "ACTIVE_TAB_PERFORMANCE_DATA":
      // 存储活跃标签页的性能数据
      if (tabId === currentActiveTabId) {
        storeCurrentTabPerformanceData(tabId, request.data);
      }
      break;

    case "GET_PERFORMANCE_DATA":
      // 返回当前标签页的性能数据
      const currentData = getCurrentTabPerformanceData(tabId);
      sendResponse(currentData);
      break;

    case "GET_STORED_DATA":
      // 返回存储的性能数据
      sendResponse({
        data: performanceData[tabId]?.data || [],
        url: performanceData[tabId]?.url || "",
        title: performanceData[tabId]?.title || "",
      });
      break;

    case "CLEAR_STORED_DATA":
      // 清空当前标签页的存储数据
      if (performanceData[tabId]) {
        performanceData[tabId].data = [];
      }
      sendResponse({ success: true });
      break;

    case "EXPORT_DATA":
      // 导出当前标签页数据
      exportCurrentTabPerformanceData(tabId);
      break;

    case "GET_ACTIVE_TAB_DATA":
      // 返回活跃标签页的数据
      const activeTabData = currentActiveTabId
        ? performanceData[currentActiveTabId]
        : null;
      sendResponse({
        activeTabId: currentActiveTabId,
        data: activeTabData?.data || [],
        url: activeTabData?.url || "",
        title: activeTabData?.title || "",
      });
      break;
  }

  return true;
});

// 存储当前标签页性能数据
function storeCurrentTabPerformanceData(tabId, data) {
  if (!performanceData[tabId]) {
    performanceData[tabId] = {
      url: "",
      title: "",
      data: [],
      maxDataPoints: MAX_DATA_POINTS,
      lastUpdate: Date.now(),
      isActive: tabId === currentActiveTabId,
    };
  }

  // 添加新数据
  performanceData[tabId].data.push({
    timestamp: data.timestamp || Date.now(),
    memory: data.memory || 0,
    cpu: data.cpu || 0,
    cache: data.cache || 0,
    redundantCache: data.redundantCache || 0,
    source: data.source || "unknown",
  });

  // 限制数据量
  if (performanceData[tabId].data.length > MAX_DATA_POINTS) {
    performanceData[tabId].data = performanceData[tabId].data.slice(
      -MAX_DATA_POINTS
    );
  }

  performanceData[tabId].lastUpdate = Date.now();
  performanceData[tabId].isActive = tabId === currentActiveTabId;

  // 可选：将数据保存到chrome.storage
  saveToStorage();
}

// 获取当前标签页性能数据
function getCurrentTabPerformanceData(tabId) {
  const tabData = performanceData[tabId];

  if (tabData && tabData.data.length > 0) {
    // 返回最新的数据点
    return tabData.data[tabData.data.length - 1];
  }

  // 如果没有数据，返回默认值
  return {
    timestamp: Date.now(),
    memory: 0,
    cpu: 0,
    cache: 0,
    redundantCache: 0,
    source: "background_fallback",
  };
}

// 保存数据到chrome.storage
async function saveToStorage() {
  try {
    // 只保存最近活跃的标签页数据，减少存储压力
    const dataToSave = {};
    Object.keys(performanceData).forEach((tabId) => {
      const tabData = performanceData[tabId];
      if (tabData.isActive || Date.now() - tabData.lastUpdate < 5 * 60 * 1000) {
        // 只保存活跃标签页或最近5分钟内有更新的数据
        dataToSave[tabId] = {
          url: tabData.url,
          title: tabData.title,
          data: tabData.data.slice(-100), // 只保存最近100个数据点
          lastUpdate: tabData.lastUpdate,
          isActive: tabData.isActive,
        };
      }
    });

    await chrome.storage.local.set({ performanceData: dataToSave });
  } catch (error) {
    console.error("保存性能数据失败:", error);
  }
}

// 从chrome.storage加载数据
async function loadFromStorage() {
  try {
    const result = await chrome.storage.local.get("performanceData");
    if (result.performanceData) {
      // 合并存储的数据
      Object.keys(result.performanceData).forEach((tabId) => {
        const storedData = result.performanceData[tabId];
        if (
          !performanceData[tabId] ||
          storedData.lastUpdate > performanceData[tabId].lastUpdate
        ) {
          performanceData[tabId] = storedData;
        }
      });
    }
  } catch (error) {
    console.error("加载性能数据失败:", error);
  }
}

// 导出当前标签页性能数据
function exportCurrentTabPerformanceData(tabId) {
  const tabData = performanceData[tabId];
  if (!tabData || tabData.data.length === 0) {
    console.warn("没有数据可导出");
    return;
  }

  // 生成CSV内容
  const csvContent = generateCurrentTabCSV(tabData);

  // 创建下载链接
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);

  // 下载文件
  chrome.downloads.download({
    url: url,
    filename: `performance_data_${tabId}_${Date.now()}.csv`,
    saveAs: true,
  });

  // 清理URL
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// 生成当前标签页CSV文件内容
function generateCurrentTabCSV(tabData) {
  const headers = [
    "时间",
    "内存使用(B)",
    "CPU使用率(%)",
    "缓存大小(B)",
    "冗余缓存项数",
    "数据来源",
    "页面标题",
    "URL",
  ];

  const rows = tabData.data.map((data) => [
    new Date(data.timestamp).toLocaleString(),
    data.memory,
    data.cpu.toFixed(2),
    data.cache,
    data.redundantCache || 0,
    data.source || "unknown",
    tabData.title || "",
    tabData.url || "",
  ]);

  return [headers, ...rows].map((row) => row.join(",")).join("\n");
}

// 定期清理过期数据
function cleanupOldData() {
  const now = Date.now();
  const ONE_HOUR = 60 * 60 * 1000; // 1小时

  Object.keys(performanceData).forEach((tabIdStr) => {
    const tabId = parseInt(tabIdStr);
    const tabData = performanceData[tabId];

    if (tabData) {
      // 移除超过1小时的非活跃数据
      if (!tabData.isActive && now - tabData.lastUpdate > ONE_HOUR) {
        delete performanceData[tabId];
      } else {
        // 移除超过2小时的数据点
        tabData.data = tabData.data.filter(
          (data) => now - data.timestamp < 2 * ONE_HOUR
        );
      }
    }
  });
}

// 初始化扩展
async function initializeExtension() {
  console.log("当前标签页性能监控扩展后台服务已启动");

  // 加载存储的数据
  await loadFromStorage();

  // 获取当前活跃标签页
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs[0]) {
      currentActiveTabId = tabs[0].id;
    }
  });

  // 设置定期清理任务（每30分钟清理一次）
  setInterval(cleanupOldData, 30 * 60 * 1000);

  // 设置定期保存任务（每2分钟保存一次）
  setInterval(saveToStorage, 2 * 60 * 1000);
}

// 启动扩展
initializeExtension();

// 监听扩展安装或更新
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === "install") {
    console.log("当前标签页性能监控扩展已安装");

    // 创建右键菜单
    chrome.contextMenus.create({
      id: "analyzeCurrentTabPerformance",
      title: "分析当前页面性能",
      contexts: ["page"],
    });
  } else if (details.reason === "update") {
    console.log("当前标签页性能监控扩展已更新");
  }
});

// 监听右键菜单点击
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "analyzeCurrentTabPerformance" && tab?.id) {
    // 标记为当前活跃标签页并开始分析
    currentActiveTabId = tab.id;
    chrome.tabs.sendMessage(tab.id, {
      type: "START_CURRENT_TAB_ANALYSIS",
      tabId: tab.id,
    });
  }
});
