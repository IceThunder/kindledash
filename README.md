# KindleDash — Kindle Paperwhite 管理器

跨平台（macOS / Windows）的越狱 Kindle 管理工具，通过 SSH 与设备通信，提供书库管理、屏幕镜像、性能监控、进程/线程管理、文件管理和远程终端。

在 Kindle Paperwhite（固件 5.6.1.1，内核 2.6.31-rt11-lab126）真机上开发并验证。多机型适配调研见 [docs/机型适配调研.md](docs/机型适配调研.md)。

## 功能

| 页面 | 功能 | 数据来源 |
|------|------|----------|
| 总览 | 设备信息（机型/固件/序列号/硬件）+ 性能监控（CPU 曲线、内存明细环形图、负载、电池、存储分区）+ 重启设备 | `/proc/*`、`/etc/prettyversion.txt`、`yoshi_battery` sysfs |
| 内容管理 | 书库总览：封面网格 + 书名/作者/ASIN/出版社/格式/大小等详情，搜索 / 排序 / 格式筛选，上传新书、下载与删除（自动清理 `.sdr` 伴生目录） | SFTP 递归扫描 `/mnt/us/documents`，解析 MOBI/AZW3 EXTH 元数据并提取内嵌封面（本地缓存，二次扫描秒开） |
| 屏幕镜像 | 实时查看墨水屏画面（0.5–5 秒可调轮询 / 手动刷新 / 保存截图），画面随窗口自适应缩放，断线时保留最后画面 | `dd /dev/fb0 \| gzip`，8bpp 灰度 758×1024（stride 768）解码 |
| 进程 / 线程 | 全部进程列表（CPU% / RSS / 状态 / 线程数），进程详情、线程级 CPU% 、结束进程 | `/proc/[0-9]*/stat`、`/proc/<pid>/task/*`（两次采样求增量） |
| 文件管理 | SFTP 浏览 / 上传 / 下载 / 新建 / 重命名 / 删除（递归）/ 文本预览，带传输进度 | ssh2 SFTP |
| 远程终端 | 设备上的 root shell（xterm.js） | ssh2 shell 通道 |

其他特性：

- **防断连**：连接期间阻止 Kindle 自动休眠（`preventScreenSaver`，可在设置中关闭）；性能轮询串行化避免通道堆积；断线自动重连（最多 30 次 × 5 秒）
- 断线时总览与屏幕镜像均保留最后数据，重连后自动恢复
- 屏幕帧变化检测：画面无变化时不重绘、不占带宽（墨水屏静态时压缩后仅 ~20KB/帧）
- 所有轮询合并为单次 SSH 往返（一次 `exec` 拉取 CPU+内存+电池+进程+磁盘），降低设备开销
- 连接设置持久化，启动自动连接

## 环境要求

- 越狱 Kindle，已开启 SSH（端口 22），root 权限（私钥或密码）
- Node.js ≥ 18（开发）

## 开发

```bash
npm install        # 安装依赖
npm run dev        # 开发模式（热更新）
npm run typecheck  # 类型检查
npm run build      # 生产构建（out/）
```

对真机跑后端集成测试（不启动 UI）：

```bash
KINDLE_HOST=192.168.x.x KINDLE_KEY=~/.ssh/your-key.pem npx tsx src/test-integration.ts
```

## 打包

```bash
npm run dist:mac   # 输出 release/ 下的 dmg（Apple Silicon）
npm run dist:win   # Windows x64（nsis 安装包 + 便携版），在 Windows 上执行
```

## 连接配置

首次启动点击左下角「连接设置」：

- **设备地址**：Kindle 在局域网中的 IP（可在设备 WiFi 设置里查看）
- **认证方式**：SSH 私钥（本机路径）或密码

> 提示：Kindle 屏蔽 ICMP，ping 不通是正常的；应用用 TCP 连接 SSH 端口。

## 开源协议

[MIT](LICENSE) — 可自由使用、修改和分发。本项目仅供管理个人所有的越狱 Kindle 设备使用。

## 致谢

屏幕适配与机型资料参考了 [FBInk](https://github.com/NiLuJe/FBInk)、[KOReader](https://github.com/koreader/koreader) 和 [MobileRead 社区](https://www.mobileread.com/forums/)的工作。

## macOS 注意事项

新版 macOS 的 XProtect 可能会清除 npm 下载的未签名 Electron 二进制
（症状：`node_modules/electron/dist/Electron.app` 消失、`npm run dev` 报 ENOENT 或静默退出）。
解决：

```bash
cd node_modules/electron && node install.js
codesign --force --deep --sign - dist/Electron.app
```

## 项目结构

```
src/
├── main/               # Electron 主进程
│   ├── index.ts        #   窗口 / IPC / 轮询调度 / 终端通道
│   ├── kindle.ts       #   SSH 连接管理（自动重连 / exec / SFTP / shell）
│   ├── stats.ts        #   /proc 解析（CPU / 内存 / 进程 / 线程 / 设备信息）
│   ├── screen.ts       #   屏幕抓帧（gzip 传输 → 解压 → 裁剪 → 变化检测）
│   └── files.ts        #   SFTP 文件操作（上传下载 / 递归删除 / 进度）
├── preload/index.ts    # contextBridge 安全桥接
├── renderer/src/       # React 界面（六个页面）
└── shared/types.ts     # 共享类型
```

## 支持的设备

当前按 Paperwhite 2（758×1024 @ 8bpp）调优；屏幕镜像的分辨率/格式在
`src/main/screen.ts` 顶部常量中可改（PW3/Voyage 为 1072×1448）。
其余功能（进程 / 性能 / 文件 / 终端）读取通用 `/proc` 与 SFTP，对其他 Kindle 型号同样适用。
