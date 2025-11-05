// 后台服务脚本 - 处理扩展的后台逻辑

// 存储性能数据
let performanceData = {};
const MAX_DATA_POINTS = 1000; // 每个标签页最多存储1000个数据点

// 监听标签页更新
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === "complete" && tab.url) {
    // 初始化标签页数据存储
    if (!performanceData[tabId]) {
      performanceData[tabId] = {
        url: tab.url,
        data: [],
        maxDataPoints: MAX_DATA_POINTS,
      };
    } else {
      // 更新URL
      performanceData[tabId].url = tab.url;
    }
  }
});

// 监听标签页关闭
chrome.tabs.onRemoved.addListener((tabId) => {
  // 清理标签页数据
  if (performanceData[tabId]) {
    delete performanceData[tabId];
  }
});

// 监听来自content script的消息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  const tabId = sender.tab?.id;

  if (!tabId) return;

  switch (request.type) {
    case "PERFORMANCE_DATA_UPDATE":
      // 存储性能数据更新
      storePerformanceData(tabId, request.data);
      break;

    case "GET_STORED_DATA":
      // 返回存储的性能数据
      sendResponse({
        data: performanceData[tabId]?.data || [],
        url: performanceData[tabId]?.url || "",
      });
      break;

    case "CLEAR_STORED_DATA":
      // 清空存储的数据
      if (performanceData[tabId]) {
        performanceData[tabId].data = [];
      }
      sendResponse({ success: true });
      break;

    case "EXPORT_DATA":
      // 导出数据
      exportPerformanceData(tabId);
      break;
  }

  return true;
});

// 存储性能数据
function storePerformanceData(tabId, data) {
  if (!performanceData[tabId]) {
    performanceData[tabId] = {
      url: "",
      data: [],
      maxDataPoints: MAX_DATA_POINTS,
    };
  }

  // 添加新数据
  performanceData[tabId].data.push({
    timestamp: data.timestamp || Date.now(),
    memory: data.memory || 0,
    cpu: data.cpu || 0,
    cache: data.cache || 0,
    redundantCache: data.redundantCache || 0,
  });

  // 限制数据量
  if (performanceData[tabId].data.length > MAX_DATA_POINTS) {
    performanceData[tabId].data = performanceData[tabId].data.slice(
      -MAX_DATA_POINTS
    );
  }

  // 可选：将数据保存到chrome.storage
  saveToStorage();
}

// 保存数据到chrome.storage
async function saveToStorage() {
  try {
    await chrome.storage.local.set({ performanceData });
  } catch (error) {
    console.error("保存性能数据失败:", error);
  }
}

// 从chrome.storage加载数据
async function loadFromStorage() {
  try {
    const result = await chrome.storage.local.get("performanceData");
    if (result.performanceData) {
      performanceData = result.performanceData;
    }
  } catch (error) {
    console.error("加载性能数据失败:", error);
  }
}

// 导出性能数据
function exportPerformanceData(tabId) {
  const tabData = performanceData[tabId];
  if (!tabData || tabData.data.length === 0) return;

  // 生成CSV内容
  const csvContent = generateCSV(tabData);

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

// 生成CSV文件内容
function generateCSV(tabData) {
  const headers = [
    "时间",
    "内存使用(B)",
    "CPU使用率(%)",
    "缓存大小(B)",
    "冗余缓存项数",
    "URL",
  ];
  const rows = tabData.data.map((data) => [
    new Date(data.timestamp).toLocaleString(),
    data.memory,
    data.cpu,
    data.cache,
    data.redundantCache || 0,
    tabData.url,
  ]);

  return [headers, ...rows].map((row) => row.join(",")).join("\n");
}

// 定期清理过期数据
function cleanupOldData() {
  const now = Date.now();
  const ONE_DAY = 24 * 60 * 60 * 1000;

  Object.keys(performanceData).forEach((tabIdStr) => {
    const tabId = parseInt(tabIdStr);
    const tabData = performanceData[tabId];

    if (tabData) {
      // 移除超过1天的数据
      tabData.data = tabData.data.filter(
        (data) => now - data.timestamp < ONE_DAY
      );
    }
  });
}

// 初始化扩展
async function initializeExtension() {
  console.log("性能监控扩展后台服务已启动");

  // 加载存储的数据
  await loadFromStorage();

  // 设置定期清理任务（每小时清理一次）
  setInterval(cleanupOldData, 60 * 60 * 1000);

  // 设置定期保存任务（每5分钟保存一次）
  setInterval(saveToStorage, 5 * 60 * 1000);
}

// 启动扩展
initializeExtension();

// 监听扩展安装或更新
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === "install") {
    console.log("性能监控扩展已安装");

    // 创建右键菜单
    chrome.contextMenus.create({
      id: "analyzePerformance",
      title: "分析页面性能",
      contexts: ["page"],
    });
  } else if (details.reason === "update") {
    console.log("性能监控扩展已更新");
  }
});

// 监听右键菜单点击
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "analyzePerformance" && tab?.id) {
    // 打开popup或发送分析命令
    chrome.tabs.sendMessage(tab.id, { type: "START_ANALYSIS" });
  }
});
