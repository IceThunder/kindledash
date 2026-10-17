<div align="center">

# KindleDash

**一个仪表盘管好你的越狱 Kindle —— 全程 Wi‑Fi，无需数据线。**

📚 书库管理 · 🖥️ 屏幕镜像 · 📊 性能监控 · ⚙️ 进程线程 · 📁 文件管理 · ⌨️ Root 终端

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows-lightgrey)
![UI](https://img.shields.io/badge/UI-%E7%AE%80%E4%BD%93%E4%B8%AD%E6%96%87%20%7C%20English%20%7C%20%E6%97%A5%E6%9C%AC%E8%AA%9E%20%7C%20%ED%95%9C%EA%B5%AD%EC%96%B4-informational)
![Transport](https://img.shields.io/badge/transport-SSH%20over%20Wi--Fi-success)

[English](README.md) | **简体中文** | [日本語](README.ja.md) | [한국어](README.ko.md)

<!-- TODO: 在这里加一张截图 / GIF —— 首图对传播帮助很大 -->

</div>

---

KindleDash 是一个跨平台（macOS / Windows）的**越狱 Kindle** 桌面管理器，通过 SSH 与设备通信——不用数据线、不用装驱动——在一个窗口里提供书库浏览、墨水屏实时画面、性能监控、进程管理、完整文件管理和 root 终端。

在 Kindle Paperwhite（固件 5.6.1.1，内核 2.6.31-rt11-lab126）真机上开发并验证。多机型适配调研见 [docs/机型适配调研.md](docs/机型适配调研.md)。

## ✨ 功能

### 📚 书库管理
- 封面网格展示设备上的每一本书 —— 书名 / 作者 / ASIN / 出版社 / 格式 / 大小
- 搜索、排序、按格式筛选
- 上传新书、下载到电脑、删除时自动清理 `.sdr` 伴生目录
- 解析 MOBI/AZW3 EXTH 元数据并提取内嵌封面；封面本地缓存，二次扫描秒开

### 🖥️ 屏幕镜像
- 墨水屏实时画面：轮询间隔 0.5–5 秒可调、手动刷新、保存截图
- 画面变化才传输 —— 墨水屏静止时一帧仅约 20 KB
- 断线时保留最后画面，随窗口自适应缩放

### 📊 总览与性能
- 设备信息：机型 / 固件 / 序列号 / 硬件与主板
- 实时 CPU 曲线、内存明细、负载、电池（容量 / 电压 / 温度 / 电流）、各分区存储
- 电池 / 温度 / 运行时间环形仪表
- 重启设备

### 🧹 垃圾清理
- 扫描孤儿 `.sdr` 标注目录、系统残留和临时文件
- 勾选 → 确认 → 才删除，绝不自动清理

### ⚙️ 进程 / 线程
- 全部进程列表：CPU% / RSS / 状态 / 线程数
- 线程级 CPU 占用（`/proc` 两次采样求增量）、结束进程

### 📁 文件管理
- 完整 SFTP 浏览器：上传 / 下载 / 新建 / 重命名 / 递归删除 / 文本预览，带传输进度

### ⌨️ 远程终端
- 设备上的 root shell（xterm.js），其余一切皆可手工处理

## 🔌 特性

- **连接健壮** —— 断线自动重连（最多 30 次 × 5 秒）、轮询串行化避免通道堆积、连接期间阻止 Kindle 自动休眠（可在设置中关闭）
- **多设备管理** —— 保存多台 Kindle 的配置随时切换，每台设备独立书库缓存
- **对设备轻量** —— 所有轮询合并为单次 SSH 往返；连接配置持久化，启动自动连接
- **四语言界面** —— 简体中文 / English / 日本語 / 한국어，按系统语言自动检测

## 🚀 快速上手

### 环境要求
- 越狱 Kindle，已开启 SSH（端口 22），root 权限（私钥或密码）
- 设备与电脑在同一局域网
- 开发需要：Node.js ≥ 18

### 连接
1. 启动 KindleDash，打开左下角**「连接设置」**。
2. 填入 Kindle 的 IP 地址（可在设备的 Wi-Fi 设置里查看）。
3. 选择私钥或密码认证 —— 完成。配置自动保存，下次启动自动连接。

> 提示：Kindle 屏蔽 ICMP，`ping` 不通是正常的；KindleDash 用 TCP 直连 SSH 端口。

### 安装 / 构建

从 [Releases](https://github.com/IceThunder/kindledash/releases) 下载构建，或自行打包：

```bash
npm install
npm run dev        # 开发模式（热更新）
npm run dist:mac   # macOS dmg（Apple Silicon）
npm run dist:win   # Windows x64 安装包 + 便携版（在 Windows 上执行）
```

<details>
<summary>开发相关</summary>

```bash
npm run typecheck  # 类型检查
npm run build      # 生产构建（out/）
```

对真机跑后端集成测试（不启动 UI）：

```bash
KINDLE_HOST=192.168.x.x KINDLE_KEY=~/.ssh/your-key.pem npx tsx src/test-integration.ts
```

**macOS XProtect 注意**：新版 macOS 可能清除 npm 下载的未签名 Electron 二进制（症状：`node_modules/electron/dist/Electron.app` 消失、`npm run dev` 报 ENOENT 或静默退出）。解决：

```bash
cd node_modules/electron && node install.js
codesign --force --deep --sign - dist/Electron.app
```

项目结构：

```
src/
├── main/               # Electron 主进程
│   ├── index.ts        #   窗口 / IPC / 轮询调度 / 终端通道
│   ├── kindle.ts       #   SSH 连接管理（自动重连 / exec / SFTP / shell）
│   ├── stats.ts        #   /proc 解析（CPU / 内存 / 进程 / 设备信息）
│   ├── screen.ts       #   屏幕抓帧（gzip 传输 → 解压 → 裁剪 → 变化检测）
│   ├── library.ts      #   书库扫描 + 元数据
│   ├── mobi.ts         #   MOBI/AZW3 EXTH 解析 / 封面提取
│   ├── cleanup.ts      #   垃圾扫描
│   ├── files.ts        #   SFTP 文件操作（上传下载 / 进度）
│   ├── settings.ts     #   应用设置
│   └── i18n.ts         #   主进程 i18n
├── preload/index.ts    # contextBridge 安全桥接
├── renderer/src/       # React 界面
└── shared/             # 共享类型 + 四语言字典
```

</details>

## 📱 支持的设备

屏幕镜像按 758×1024 @ 8bpp（Paperwhite 世代）调优；分辨率与像素格式是 `src/main/screen.ts` 顶部的常量（PW3/Voyage 为 1072×1448）。其余功能读取通用 `/proc` 并走 SFTP，对其他 Kindle 型号同样适用。调研记录：[docs/机型适配调研.md](docs/机型适配调研.md)。

## 🙏 致谢

屏幕适配与机型资料参考了 [FBInk](https://github.com/NiLuJe/FBInk)、[KOReader](https://github.com/koreader/koreader) 和 [MobileRead 社区](https://www.mobileread.com/forums/)的工作。

## 📄 开源协议

[MIT](LICENSE) —— 可自由使用、修改和分发。本项目仅供管理个人所有的越狱 Kindle 设备。

---

觉得好用？⭐ 点个 Star 并分享出去，让更多 Kindle 用户看到。
