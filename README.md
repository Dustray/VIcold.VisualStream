# VisualStream

大模型推理记录的浏览器重放工作台。当前实现 **Megakernel + Perfetto Protobuf**，直接加载 `trace_demo` 中的真实文件；计算模式和文件解析器分别注册。

## 本地启动

需要 Node.js 22.12+；本项目在 Windows、Node.js 26 和 Edge 上验证。

```sh
npm install
npm run setup:assets
npm run dev
```

打开 `http://127.0.0.1:5173`。首次自动载入 TP1，左侧可以切换 TP2 双卡，也可以选择或拖入自己的 trace。

`setup:assets` 首次需要联网下载官方 Perfetto Worker、32 位与 Memory64 WASM 及许可证，默认锁定 `v59.1-79997ada9`，生成文件哈希清单并复制三个样例。之后校验本地缓存，不需要再次下载。`public/vendor/perfetto` 与 `public/samples` 为生成目录，不提交源码。要主动更新引擎，运行 `npm run setup:assets -- --refresh`，更新后重新执行测试。

运行时不上传 trace，也不请求第三方 CDN。部署时一起提供 `dist` 中的 Worker、WASM 和样例资源；使用 HTTP 或 HTTPS，不能直接双击 `index.html`。

## 已实现

- 独立配置计算模式与文件解析器；当前只有 Megakernel 模式和 Perfetto 解析器，支持自动识别。
- 多文件会话、SHA-256 去重、导入进度、取消和文件错误提示。
- 多卡 → CU → Group 资源树；`block_N` 解释为 CU N，不同 CU 的 `group_0` 各自独立。
- Canvas CU 矩阵、当前任务表、事件详情、原始任务名称与额外属性查询。
- 时间轴概览、轨道纵向滚动、光标缩放、平移、播放头定位、轨道展开与事件选择。
- 算子按忽略数字编号后的名称统一着色，时间轴、CU 矩阵、任务表、搜索与详情共用颜色规则；显示与搜索保留原始名称。
- CU 利用率：支持整个时间周期和划选范围，显示总体、每卡与逐 CU 指标；支持计算卡筛选、排序和 CU 联动。按每个 CU 的任务活动时间并集计算，重叠任务不重复计入。
- 播放 / 暂停、可调慢放、精确跳转、前后事件边界、选区循环、播放头跟随。
- 时间区间统计：边界裁剪后的事件数、累计耗时、单来源活动并集。累计耗时包含并发。
- 搜索、时间书签、项目 JSON 保存与恢复；保存内容还缓存到 IndexedDB。
- 多来源时钟偏移配置。来源默认相对起点对齐；卡号与 rank 是文件名提示，界面明确标记同步尚未验证。

项目文件只引用原始 trace 的 SHA-256 指纹，不嵌入原始数据。内置样例可以自动重新载入，其他文件恢复时需要重新选择原文件。恢复验证指纹，不能只按文件名匹配。

## 操作

选择上方 **CU 利用率** 视图即可统计。划选时间轴后自动切换到当前选区，也可以手动选择整个时间周期；清除选区后恢复全程统计。时间轴缩放和平移不改变统计范围。

单 CU 利用率 = 该 CU 在统计区间内的任务活动时间并集 / 区间时长。总体利用率 = 各 CU 活动时间并集之和 /（区间时长 × 已记录 CU 数量）；平均活动 CU = 总活动时间 / 区间时长。跨卡使用相同的全局时间范围；来源时钟偏移参与区间裁剪。所有无记录任务的时段（包括某来源记录范围之外）都按无活动计。仅统计记录中出现的 CU，不能推断未采集 CU 的状态，也不等同于硬件 counter 测得的忙碌率。

| 操作 | 方式 |
| --- | --- |
| 播放 / 暂停 | 全局 Space（文本框编辑时除外）或播放按钮 |
| 缩放时间轴 | W 放大 / S 缩小、Ctrl / ⌘ + 滚轮均在鼠标位置平滑缩放；鼠标离开轨道时 W / S 以视口中心缩放；也可使用加减按钮 |
| 播放中手动缩放 | 暂时关闭播放头跟随，以保持鼠标处的缩放锚点；可在时间轴工具栏重新开启跟随 |
| 平移 | 右键按住拖动；A / D 向左 / 右平移可视范围，每次移动 20%；也支持空格 + 拖动、中键拖动和 Shift + 滚轮 |
| 跳转时间 | 点击事件中的任意位置或拖动标尺播放头，精确定位到鼠标对应时间；也可在会话设置中填写毫秒 |
| 时间选区 | 在轨道区域按住鼠标左键拖动；I / O 设置入点和出点 |
| 全部适配 / 缩放选区 | F / Z |
| 前后事件边界 | ← / → |
| 起点 / 终点 | Home / End |
| 书签 / 搜索 | B / Ctrl + F |
| 轨道展开 | 点击时间轴左侧 CU 标签 |
| 高度调整 | 拖动上方视图与播放栏之间的分隔线 |

样例只有约 0.12–0.17 秒，初始速度将完整记录展开到约 20 秒。速度为真实时间倍率，1× 表示原始执行速度。
速度菜单包含 0.00001× 与 0.0001×，可用于观察更短的事件。

## 架构与技术

```text
File
  → 解析 Worker：ParserRegistry → PerfettoParser → 官方 Trace Processor WASM
  → ParsedTraceSource：轨道、区间查询、密度、统计、搜索
  → ComputeModelRegistry → MegakernelModel
  → ReplayDataSource：Device / CU / Group 与会话时间
  → PlaybackClock + Pinia
  → Vue 3 工作台 + Canvas 2D 时间轴 / CU 矩阵
```

时间在数据层使用 `bigint` 纳秒。解析和 SQL 在 Worker 中运行；前端只查询可视轨道与活动时间窗口，缩小时显示聚合密度，放大后查询独立区间。播放头覆盖层与轨道背景分开绘制，不把所有事件放进 Vue 响应式状态或 DOM。

| 位置 | 职责 |
| --- | --- |
| `src/core/types.ts` | 源文件接口、计算模式接口、资源与项目模型 |
| `src/core/registry.ts` | 两种独立插件注册表 |
| `src/parsers/perfetto/` | 通用 Perfetto 解码、RPC 与 SQL，不解释 CU |
| `src/models/megakernel.ts` | block → CU 与 Group 归属，不依赖 Perfetto SQL |
| `src/engine/` | 播放时钟、活动区间索引 |
| `src/stores/replay.ts` | 查询缓存、来源、项目与界面联动 |
| `src/components/` | 时间轴、CU 视图与分析面板 |

使用 Vue 3.5、Pinia 4、Vite 8、Tailwind 4、Reka UI 与 TypeScript 7.0.2。通用 TS 代码由官方原生 TS7 检查；Vue 单文件组件使用 `vue-tsc` 加 `typescript-native-bridge`，其底层同样调用 TS7。桥接包通过 npm 别名占据 `typescript`，官方编译器安装在 `typescript-native`。桥接层有独立版本号，不是把编译器降到 TypeScript 6。`.npmrc` 的 `legacy-peer-deps` 用于桥接预发布版本与 `vue-tsc` peer 范围的兼容；完整依赖由 lockfile 固定。

## 验证与构建

```sh
npm test
npm run typecheck
npm run test:e2e
npm run build
npm run preview
```

浏览器测试优先使用 Windows 已安装的 Edge；其他环境先执行 `npx playwright install chromium`。测试覆盖真实 TP1/TP2 的解析与播放交互、搜索选区、统计、项目恢复、来源隔离、去重和无效文件。设置 `PLAYWRIGHT_BASE_URL` 可以对生产预览地址运行相同测试。

真实样例的验收数量：TP1 为 76 CU、128,200 个区间；TP2 两来源各 76 CU、222,664 个区间，总计 152 CU、445,328 个区间。

## 当前边界

- 当前是离线重放。样例没有硬件 counter、warp 记录、任务到算子映射或 flow，相关硬件指标显示未采集。CU 利用率视图提供基于任务记录的活动占比，不推测硬件忙碌率、带宽和通信指标。
- 只支持 Perfetto Protobuf 文件。JSON、Hipprof、自定义 `.prof` 等仅预留接口。
- 单文件首版限制 256 MB；每个来源运行一个 WASM 实例，多个大文件会增加内存占用。尚未做 GB 级记录与长时间运行的容量验收。
- 当前按一份来源文件对应一个设备资源解释，支持样例的双 rank 双文件。单文件内包含多张卡时，需要进一步提供明确的设备字段与映射规则。
- 活动窗口上限 250,000 个事件；时间轴精细窗口上限 35,000 个事件，超出时退回密度显示。
- Perfetto v59 会重组同名轨道。解析器利用 descriptor UUID 元数据恢复父链，CU 与事件归属已验证；界面展开的是 Trace Processor 的规范化轨道，不等同于文件内的所有原始 TrackDescriptor。逐一保留原始 descriptor 的检查器仍待补充。
- 实测硬件性能曲线、真实跨卡时钟同步、warp 视图、拷贝通信专用视图与原生大文件后端属于后续工作。当前没有宣称固定帧率或硬件利用率。

详细设计见 `docs/replay-design.md`。
