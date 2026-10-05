# GridLens · Comic Typesetting Tools

面向漫画和条漫的本地格框编辑器。用原始像素编辑坐标，将 GridLens JSON 绘成图；也可载入图片，识别格框候选，经人工校正后保存 JSON。

**当前为开发版：两条主要流程已实现并在 Linux Chromium 验证，完整首版验收尚未完成。** 真实漫画样本评估和 Windows Chrome/Edge 下载验收仍待完成，见 [API 核对记录](docs/api-verification.md) 和 [验证记录](docs/validation.md)。

## 开发

需要 Node.js ≥ 22.12，已验证 Node 24.19.0 / npm 11.9.0。依赖使用精确版本与 `package-lock.json` 固定。

```bash
npm ci
npm run dev
```

```bash
npm run typecheck
npm test
npm run build
npm run test:e2e
```

浏览器测试优先使用系统 `/usr/bin/chromium`。其他环境可设置 `CHROMIUM_PATH` 为本机 Chromium/Chrome 路径；没有系统浏览器时先执行 `npx playwright install chromium`。生产产物位于 `dist/`，可用 `npm run preview` 检查。

云环境中可为 npm 命令加 `--cache /tmp/gridlens-npm-cache`，避免默认缓存目录写权限问题。使用现有 checkout；每个云任务已隔离，无需额外 Git worktree。

## 已实现

- JSON Schema 2020-12 与语义校验：唯一 ID、几何、安全资源路径、关联引用和非退化多边形。失败导入保留原文档。
- 画布尺寸、比例预设、底色与透明背景；尺寸变化可保留坐标或同步缩放对象。
- Fabric 7 适配：矩形拖动、八方向缩放、多选、锁定、复制、删除、独立 Z / 阅读顺序；多边形顶点编辑；数值与键盘替代操作。
- 原始像素坐标、格框边界、两点测量、两格间距/交叠、网格与吸附、标尺。
- 文字、箭头、尺寸标注；跟随关联格框、单独移动、数值编辑；删格框可保留标注或一起删除。
- PNG、JPG 和真实矢量 SVG 导出。倍率作用于位图，JPG 可设置铺底；辅助显示与选择手柄不导出。
- JSON 保存、撤销重做（50 个历史快照）、IndexedDB 自动保存与显式恢复。
- 本地 PNG/JPG/WebP 载入和 EXIF 方向归一；嵌入图片资源与相对资源重新关联。
- 本地 OpenCV 4.12 Worker：矩形/斜格候选、近似双边框去重、长图重叠分块、取消、人工确认与修正。重复识别保留已确认/修正的格框。
- 中文三栏工作台；375/768 宽度下通过面板切换访问项目与属性；可见焦点与减少动态效果。

## 操作

V 选择、R 绘制格框、M 两点测量、H 平移；Shift 点击多选。方向键移动 1 px，Shift + 方向键移动 10 px。数值输入在 Enter 或失焦时应用。

Ctrl/⌘ + Z 撤销，Shift + Ctrl/⌘ + Z 重做，Ctrl/⌘ + D 复制，Ctrl/⌘ + S 下载项目 JSON。视图缩放不改变 JSON 坐标；所有业务坐标使用左上原点。

图片处理全部发生在本机浏览器，OpenCV 与 WASM 通过工程打包，首次识别按需加载。自动保存仅保存在当前浏览器中，跨设备请下载 JSON。

## 支持范围与限制

- 画布每边为 1–32767 px，预览会限制实际 backing canvas 大小；超大图无法无限放大。
- 位图导出每边不超过 32767 px，总面积不超过 3200 万像素。超过时降低倍率或导出 SVG。
- 图片输入不超过 40 MB / 4000 万像素。归一后嵌入内容不超过 28 MiB；JSON 文件输入不超过 32 MiB，过大图片会明确拒绝，避免保存出无法重载的项目。
- 相对图片资源需要重新选择本地文件关联；浏览器不能根据 JSON 中的路径任意读取文件系统。
- 识别阈值与评分是启发式，8 px 内的近似边框可能被合并。插画、气泡、遮挡或低对比格框可能误检或漏检，必须人工审核。合成测试通过不代表真实漫画准确率达标。
- SVG 使用系统字体，跨机器字形和文字布局可能不同。
- 尚未实现旧查看器 JSON 的专用迁移器，仅接受当前 GridLens 1.0.0；真实样本 B05/B06/B10 未随仓库提供，尚未评测。

## 代码结构

`src/core` 保存引擎独立的文档、几何和命令；`src/adapters` 将原始坐标映射到 Fabric；`src/services` 负责图片、导出和存储；`src/features` / `src/workers` 负责识别；`src/styles` 定义语义设计变量。

## 开发方案与依据

- [原实施方案](docs/development-plan/坐标编辑器实施方案.html)
- [GridLens Schema](docs/development-plan/gridlens.schema.json)、[示例项目](docs/development-plan/示例项目.json)
- [UI/UX Pro Max 采用记录](docs/design-system.md)
- [API 与版本核对](docs/api-verification.md)
- [测试与待验收事项](docs/validation.md)

React 19.3、TypeScript 7、Vite 8、Fabric 7、Ajv 8；OpenCV 包固定 4.12 系列，匹配当前使用的 4.x API。已通过 Context7 实际查询核对关键 API，并保存库 ID 与原始响应；部分库未提供对应安装版本的精确快照，版本范围见 API 核对记录。发布包源码与已运行测试提供补充证据。
