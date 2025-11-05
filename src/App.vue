<template>
  <div class="performance-monitor">
    <!-- 头部控制栏 -->
    <div class="header">
      <h2>网站性能监控</h2>
      <div class="controls">
        <button @click="toggleMonitoring" :class="{ active: isMonitoring }">
          {{ isMonitoring ? "停止监控" : "开始监控" }}
        </button>
        <button @click="exportData" :disabled="!performanceData.length">
          导出数据
        </button>
        <button @click="clearData" :disabled="!performanceData.length">
          清空数据
        </button>
      </div>
    </div>

    <!-- 当前指标显示 -->
    <div class="current-metrics">
      <div class="metric-card">
        <h3>内存使用</h3>
        <div class="metric-value">
          {{ formatMemory(currentMetrics.memory) }}
        </div>
        <div class="metric-trend" :class="getTrendClass('memory')">
          {{ getTrendIcon("memory") }}
        </div>
      </div>
      <div class="metric-card">
        <h3>CPU使用率</h3>
        <div class="metric-value">{{ formatCpu(currentMetrics.cpu) }}%</div>
        <div class="metric-trend" :class="getTrendClass('cpu')">
          {{ getTrendIcon("cpu") }}
        </div>
      </div>
      <div class="metric-card">
        <h3>缓存大小</h3>
        <div class="metric-value">{{ formatMemory(currentMetrics.cache) }}</div>
        <div class="metric-trend" :class="getTrendClass('cache')">
          {{ getTrendIcon("cache") }}
        </div>
      </div>
    </div>

    <!-- 图表展示 -->
    <div class="charts">
      <div class="chart-container">
        <h3>内存使用趋势</h3>
        <canvas ref="memoryChart"></canvas>
      </div>
      <div class="chart-container">
        <h3>CPU使用率趋势</h3>
        <canvas ref="cpuChart"></canvas>
      </div>
      <div class="chart-container">
        <h3>缓存大小趋势</h3>
        <canvas ref="cacheChart"></canvas>
      </div>
    </div>

    <!-- 数据表格 -->
    <div class="data-table" v-if="performanceData.length">
      <h3>详细数据</h3>
      <table>
        <thead>
          <tr>
            <th>时间</th>
            <th>内存</th>
            <th>CPU</th>
            <th>缓存</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(data, index) in reversedData" :key="index">
            <td>{{ formatTime(data.timestamp) }}</td>
            <td>{{ formatMemory(data.memory) }}</td>
            <td>{{ formatCpu(data.cpu) }}%</td>
            <td>{{ formatMemory(data.cache) }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<script lang="ts">
import {
  defineComponent,
  ref,
  onMounted,
  onUnmounted,
  nextTick,
  computed,
} from "vue";
import Chart from "chart.js/auto";

interface PerformanceData {
  timestamp: number;
  memory: number;
  cpu: number;
  cache: number;
}

export default defineComponent({
  name: "App",
  setup() {
    const isMonitoring = ref(false);
    const performanceData = ref<PerformanceData[]>([]);
    const currentMetrics = ref({
      memory: 0,
      cpu: 0,
      cache: 0,
    });

    const memoryChart = ref<HTMLCanvasElement | null>(null);
    const cpuChart = ref<HTMLCanvasElement | null>(null);
    const cacheChart = ref<HTMLCanvasElement | null>(null);

    let memoryChartInstance: Chart | null = null;
    let cpuChartInstance: Chart | null = null;
    let cacheChartInstance: Chart | null = null;
    let monitoringInterval: number | null = null;

    // 格式化内存大小
    const formatMemory = (bytes: number): string => {
      if (bytes === 0) return "0 B";
      const k = 1024;
      const sizes = ["B", "KB", "MB", "GB"];
      const i = Math.floor(Math.log(bytes) / Math.log(k));
      return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
    };

    // 格式化CPU使用率（四舍五入保留两位小数）
    const formatCpu = (cpu: number): string => {
      return cpu.toFixed(2);
    };

    // 格式化时间
    const formatTime = (timestamp: number): string => {
      return new Date(timestamp).toLocaleTimeString();
    };

    // 获取趋势图标
    const getTrendIcon = (
      metric: keyof typeof currentMetrics.value
    ): string => {
      const data = performanceData.value;
      if (data.length < 2) return "➡️";

      const current = data[data.length - 1][metric];
      const previous = data[data.length - 2][metric];

      if (current > previous) return "📈";
      if (current < previous) return "📉";
      return "➡️";
    };

    // 获取趋势样式类
    const getTrendClass = (
      metric: keyof typeof currentMetrics.value
    ): string => {
      const data = performanceData.value;
      if (data.length < 2) return "neutral";

      const current = data[data.length - 1][metric];
      const previous = data[data.length - 2][metric];

      if (current > previous) return "up";
      if (current < previous) return "down";
      return "neutral";
    };

    // 反转数据用于表格显示（最新的在最上面）
    const reversedData = computed(() => {
      return [...performanceData.value].reverse();
    });

    // 初始化图表
    const initCharts = () => {
      if (memoryChart.value && cpuChart.value && cacheChart.value) {
        // 内存图表
        memoryChartInstance = new Chart(memoryChart.value, {
          type: "line",
          data: {
            labels: [],
            datasets: [
              {
                label: "内存使用",
                data: [],
                borderColor: "rgb(75, 192, 192)",
                tension: 0.1,
              },
            ],
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
              y: {
                beginAtZero: true,
                ticks: {
                  callback: function (value) {
                    return formatMemory(Number(value));
                  },
                },
              },
            },
          },
        });

        // CPU图表
        cpuChartInstance = new Chart(cpuChart.value, {
          type: "line",
          data: {
            labels: [],
            datasets: [
              {
                label: "CPU使用率",
                data: [],
                borderColor: "rgb(255, 99, 132)",
                tension: 0.1,
              },
            ],
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
              y: {
                beginAtZero: true,
                max: 100,
                ticks: {
                  callback: function (value) {
                    return formatCpu(Number(value)) + "%";
                  },
                },
              },
            },
          },
        });

        // 缓存图表
        cacheChartInstance = new Chart(cacheChart.value, {
          type: "line",
          data: {
            labels: [],
            datasets: [
              {
                label: "缓存大小",
                data: [],
                borderColor: "rgb(153, 102, 255)",
                tension: 0.1,
              },
            ],
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
              y: {
                beginAtZero: true,
                ticks: {
                  callback: function (value) {
                    return formatMemory(Number(value));
                  },
                },
              },
            },
          },
        });
      }
    };

    // 更新图表数据
    const updateCharts = () => {
      if (!memoryChartInstance || !cpuChartInstance || !cacheChartInstance)
        return;

      const labels = performanceData.value.map((d) => formatTime(d.timestamp));
      const memoryData = performanceData.value.map((d) => d.memory);
      const cpuData = performanceData.value.map((d) => d.cpu);
      const cacheData = performanceData.value.map((d) => d.cache);

      memoryChartInstance.data.labels = labels;
      memoryChartInstance.data.datasets[0].data = memoryData;
      memoryChartInstance.update();

      cpuChartInstance.data.labels = labels;
      cpuChartInstance.data.datasets[0].data = cpuData;
      cpuChartInstance.update();

      cacheChartInstance.data.labels = labels;
      cacheChartInstance.data.datasets[0].data = cacheData;
      cacheChartInstance.update();
    };

    // 获取当前标签页性能数据
    const getPerformanceData = async (): Promise<PerformanceData> => {
      return new Promise((resolve) => {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
          if (tabs[0]?.id) {
            const currentTabId = tabs[0].id;

            // 优先从background获取当前标签页的存储数据
            chrome.runtime.sendMessage(
              { type: "GET_ACTIVE_TAB_DATA" },
              (response) => {
                if (response && response.data && response.data.length > 0) {
                  // 使用存储的最新数据
                  const latestData = response.data[response.data.length - 1];
                  resolve({
                    timestamp: latestData.timestamp || Date.now(),
                    memory: latestData.memory || 0,
                    cpu: latestData.cpu || 0,
                    cache: latestData.cache || 0,
                    source: latestData.source || "stored",
                  });
                } else {
                  // 如果没有存储数据，从content script获取实时数据
                  chrome.tabs.sendMessage(
                    currentTabId,
                    { type: "GET_PERFORMANCE_DATA" },
                    (response) => {
                      if (response) {
                        resolve({
                          timestamp: Date.now(),
                          memory: response.memory || 0,
                          cpu: response.cpu || 0,
                          cache: response.cache || 0,
                          source: response.source || "realtime",
                        });
                      } else {
                        // 如果都没有响应，使用模拟数据
                        resolve({
                          timestamp: Date.now(),
                          memory: Math.random() * 50000000 + 10000000, // 10-60MB
                          cpu: Math.random() * 30 + 10, // 10-40%
                          cache: Math.random() * 20000000 + 5000000, // 5-25MB
                          source: "fallback",
                        });
                      }
                    }
                  );
                }
              }
            );
          } else {
            // 没有活跃标签页，返回默认数据
            resolve({
              timestamp: Date.now(),
              memory: 0,
              cpu: 0,
              cache: 0,
              source: "no_active_tab",
            });
          }
        });
      });
    };

    // 开始/停止监控
    const toggleMonitoring = async () => {
      if (isMonitoring.value) {
        // 停止监控
        if (monitoringInterval) {
          clearInterval(monitoringInterval);
          monitoringInterval = null;
        }
        isMonitoring.value = false;
      } else {
        // 开始监控
        isMonitoring.value = true;

        // 先获取一次当前数据
        const initialData = await getPerformanceData();
        performanceData.value.push(initialData);
        currentMetrics.value = initialData;
        updateCharts();

        // 设置定时监控
        monitoringInterval = window.setInterval(async () => {
          const data = await getPerformanceData();

          // 只添加有意义的数据变化（避免重复的相同数据）
          const lastData =
            performanceData.value[performanceData.value.length - 1];
          if (
            !lastData ||
            Math.abs(data.memory - lastData.memory) > 1000 || // 内存变化超过1KB
            Math.abs(data.cpu - lastData.cpu) > 0.1 || // CPU变化超过0.1%
            Math.abs(data.cache - lastData.cache) > 1000
          ) {
            // 缓存变化超过1KB
            performanceData.value.push(data);
            currentMetrics.value = data;
            updateCharts();
          }

          // 限制数据量，保留最近80条（减少内存占用）
          if (performanceData.value.length > 80) {
            performanceData.value = performanceData.value.slice(-80);
          }
        }, 3000); // 每3秒采集一次（减少采集频率）
      }
    };

    // 导出数据
    const exportData = () => {
      const csvContent =
        "时间,内存使用,CPU使用率,缓存大小\n" +
        performanceData.value
          .map(
            (data) =>
              `${new Date(data.timestamp).toLocaleString()},${data.memory},${
                data.cpu
              },${data.cache}`
          )
          .join("\n");

      const blob = new Blob([csvContent], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `performance_data_${
        new Date().toISOString().split("T")[0]
      }.csv`;
      a.click();
      URL.revokeObjectURL(url);
    };

    // 清空数据
    const clearData = () => {
      performanceData.value = [];
      currentMetrics.value = { memory: 0, cpu: 0, cache: 0 };
      if (memoryChartInstance && cpuChartInstance && cacheChartInstance) {
        memoryChartInstance.data.labels = [];
        memoryChartInstance.data.datasets[0].data = [];
        memoryChartInstance.update();

        cpuChartInstance.data.labels = [];
        cpuChartInstance.data.datasets[0].data = [];
        cpuChartInstance.update();

        cacheChartInstance.data.labels = [];
        cacheChartInstance.data.datasets[0].data = [];
        cacheChartInstance.update();
      }
    };

    onMounted(() => {
      nextTick(() => {
        initCharts();
      });
    });

    onUnmounted(() => {
      if (monitoringInterval) {
        clearInterval(monitoringInterval);
      }
      if (memoryChartInstance) memoryChartInstance.destroy();
      if (cpuChartInstance) cpuChartInstance.destroy();
      if (cacheChartInstance) cacheChartInstance.destroy();
    });

    return {
      isMonitoring,
      performanceData,
      currentMetrics,
      memoryChart,
      cpuChart,
      cacheChart,
      reversedData,
      formatMemory,
      formatCpu,
      formatTime,
      getTrendIcon,
      getTrendClass,
      toggleMonitoring,
      exportData,
      clearData,
    };
  },
});
</script>

<style scoped>
.performance-monitor {
  padding: 16px;
  height: 100%;
  overflow-y: auto;
}

.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
  border-bottom: 1px solid #e0e0e0;
  padding-bottom: 16px;
}

.header h2 {
  margin: 0;
  color: #333;
  font-size: 18px;
}

.controls {
  display: flex;
  gap: 8px;
}

.controls button {
  padding: 6px 12px;
  border: 1px solid #ddd;
  background: white;
  border-radius: 4px;
  cursor: pointer;
  font-size: 12px;
}

.controls button:hover {
  background: #f5f5f5;
}

.controls button.active {
  background: #4caf50;
  color: white;
  border-color: #4caf50;
}

.controls button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.current-metrics {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
  margin-bottom: 20px;
}

.metric-card {
  background: white;
  padding: 12px;
  border-radius: 8px;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
  text-align: center;
}

.metric-card h3 {
  margin: 0 0 8px 0;
  font-size: 12px;
  color: #666;
}

.metric-value {
  font-size: 16px;
  font-weight: bold;
  color: #333;
  margin-bottom: 4px;
}

.metric-trend {
  font-size: 14px;
}

.metric-trend.up {
  color: #f44336;
}
.metric-trend.down {
  color: #4caf50;
}
.metric-trend.neutral {
  color: #666;
}

.charts {
  display: grid;
  grid-template-columns: 1fr;
  gap: 16px;
  margin-bottom: 20px;
}

.chart-container {
  background: white;
  padding: 12px;
  border-radius: 8px;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
}

.chart-container h3 {
  margin: 0 0 12px 0;
  font-size: 14px;
  color: #333;
}

.chart-container canvas {
  width: 100% !important;
  height: 150px !important;
}

.data-table {
  background: white;
  padding: 12px;
  border-radius: 8px;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
}

.data-table h3 {
  margin: 0 0 12px 0;
  font-size: 14px;
  color: #333;
}

table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}

th,
td {
  padding: 6px 8px;
  text-align: left;
  border-bottom: 1px solid #e0e0e0;
}

th {
  background: #f5f5f5;
  font-weight: 600;
}

tr:hover {
  background: #f9f9f9;
}
</style>
