#!/usr/bin/env node

/**
 * 当前标签页性能监控扩展构建脚本
 * 用于简化构建和部署过程，专注于当前标签页性能监控
 */

import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { fileURLToPath } from "url";

// 获取当前文件路径
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 构建配置
const config = {
  inputDir: ".",
  outputDir: "dist",
  manifestFile: "public/manifest.json",
  packageFile: "package.json",
  srcDir: "src",
  publicDir: "public",
  requiredFiles: [
    "popup.html",
    "manifest.json",
    "background.js",
    "content.js",
    "inject.js",
  ],
};

// 颜色输出工具
const colors = {
  reset: "\x1b[0m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
};

function log(message, color = colors.reset) {
  console.log(color + message + colors.reset);
}

function error(message) {
  log(`❌ ${message}`, colors.red);
  process.exit(1);
}

function success(message) {
  log(`✅ ${message}`, colors.green);
}

function info(message) {
  log(`ℹ️  ${message}`, colors.blue);
}

function warn(message) {
  log(`⚠️  ${message}`, colors.yellow);
}

// 检查必要文件是否存在
function checkPrerequisites() {
  const requiredFiles = [config.manifestFile, config.packageFile];

  for (const file of requiredFiles) {
    if (!fs.existsSync(file)) {
      error(`必要文件缺失: ${file}`);
    }
  }

  success("必要文件检查通过");
}

// 安装依赖
function installDependencies() {
  info("安装项目依赖...");

  try {
    execSync("npm install", { stdio: "inherit" });
    success("依赖安装完成");
  } catch (err) {
    warn("依赖安装失败，尝试使用pnpm安装...");
    try {
      execSync("pnpm install", { stdio: "inherit" });
      success("依赖安装完成（使用pnpm）");
    } catch (err2) {
      warn("pnpm安装也失败，跳过依赖安装，直接构建...");
    }
  }
}

// 构建项目
function buildProject() {
  info("开始构建项目...");

  try {
    execSync("npm run build", { stdio: "inherit" });
    success("项目构建完成");
  } catch (err) {
    error("项目构建失败");
  }
}

// 复制必要文件到输出目录
function copyRequiredFiles() {
  info("复制必要文件到输出目录...");

  const filesToCopy = [
    { src: config.manifestFile, dest: "dist/manifest.json" },
    { src: "popup.html", dest: "dist/popup.html" },
    { src: "public/background.js", dest: "dist/background.js" },
  ];

  for (const file of filesToCopy) {
    if (fs.existsSync(file.src)) {
      fs.copyFileSync(file.src, file.dest);
      success(`复制文件: ${file.src} -> ${file.dest}`);
    } else {
      warn(`文件不存在: ${file.src}`);
    }
  }
}

// 验证构建输出
function validateBuild() {
  info("验证构建输出...");

  let missingFiles = 0;
  for (const file of config.requiredFiles) {
    const filePath = path.join(config.outputDir, file);
    if (!fs.existsSync(filePath)) {
      warn(`构建输出文件缺失: ${file}`);
      missingFiles++;
    }
  }

  if (missingFiles === 0) {
    success("构建输出验证完成");
  } else {
    warn(`有${missingFiles}个文件缺失，但构建过程继续`);
  }
}

// 创建ZIP包用于发布
function createZipPackage() {
  info("创建发布包...");

  const zipName = `current-tab-performance-monitor-${getVersion()}.zip`;

  try {
    // 使用系统zip命令创建压缩包
    execSync(`cd ${config.outputDir} && zip -r ../${zipName} .`, {
      stdio: "inherit",
    });
    success(`发布包创建完成: ${zipName}`);
  } catch (err) {
    warn("ZIP包创建失败，请手动打包dist目录");
  }
}

// 获取版本号
function getVersion() {
  try {
    const packageJson = JSON.parse(fs.readFileSync(config.packageFile, "utf8"));
    return packageJson.version || "1.0.0";
  } catch (err) {
    return "1.0.0";
  }
}

// 清理构建目录
function cleanBuild() {
  info("清理构建目录...");

  if (fs.existsSync(config.outputDir)) {
    fs.rmSync(config.outputDir, { recursive: true, force: true });
    success("构建目录清理完成");
  }
}

// 显示使用说明
function showUsage() {
  log("\n当前标签页性能监控扩展构建工具");
  log("=".repeat(50));
  log("使用方法: node build.js [命令]");
  log("");
  log("可用命令:");
  log("  build      - 构建项目（默认）");
  log("  clean      - 清理构建目录");
  log("  install    - 仅安装依赖");
  log("  package    - 构建并创建发布包");
  log("  help       - 显示此帮助信息");
  log("");
  log("示例:");
  log("  node build.js          # 构建项目");
  log("  node build.js package  # 构建并打包");
  log("  node build.js clean    # 清理构建目录");
}

// 主函数
async function main() {
  const command = process.argv[2] || "build";

  try {
    switch (command) {
      case "build":
        checkPrerequisites();
        installDependencies();
        buildProject();
        copyRequiredFiles();
        validateBuild();
        break;

      case "clean":
        cleanBuild();
        break;

      case "install":
        checkPrerequisites();
        installDependencies();
        break;

      case "package":
        checkPrerequisites();
        installDependencies();
        buildProject();
        copyRequiredFiles();
        validateBuild();
        createZipPackage();
        break;

      case "help":
      case "--help":
      case "-h":
        showUsage();
        break;

      default:
        error(`未知命令: ${command}`);
    }

    log("\n构建过程完成！");

    if (command === "build" || command === "package") {
      log("");
      log("下一步操作:");
      log("1. 打开Chrome浏览器，进入 chrome://extensions/");
      log('2. 开启"开发者模式"');
      log('3. 点击"加载已解压的扩展程序"');
      log("4. 选择项目根目录下的 dist 文件夹");
      log("5. 扩展安装完成，开始监控当前标签页性能！");
    }
  } catch (err) {
    error(`构建过程出错: ${err.message}`);
  }
}

// 启动构建过程
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error("构建过程出错:", err);
    process.exit(1);
  });
}

export { buildProject, cleanBuild, installDependencies, createZipPackage };
