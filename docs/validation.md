# 开发版验证记录

日期：2026-10-05。环境：Linux、Node 24.19.0、npm 11.9.0、系统 Chromium。所有测试使用真实断言，不将未运行的检查计为通过。

## 核心与功能检查

最终运行结果：

- `npm ci --cache /tmp/gridlens-npm-cache --no-audit --no-fund`：冻结锁文件重装成功。
- `npm run typecheck`、`npm run build`：通过。
- `npm test`：7 个测试文件，59 项测试全部通过。
- `npm run test:e2e`：9 项 Chromium 浏览器测试全部通过（28.3 秒）。
- `PLAYWRIGHT_BASE_URL=http://127.0.0.1:4173 npm run test:e2e -- tests/image-pipeline.spec.ts -g '参考图识别' --output=/tmp/gridlens-production-results`：构建后生产预览的图片识别、JSON 重载和实际 PNG 下载通过（1 项）。
- `npm run format:check`、`git diff --check`：通过。

Vitest 只发现 `*.test.ts`，Playwright 只发现 `*.spec.ts`，避免将单元测试误交给浏览器测试运行器。

已覆盖：示例 Schema 与语义校验、非法数据与缺失引用、多边形退化/自交、独立读序/Z、锁定、复制和跟随标注、画布缩放保留字号、两格间距、Fabric stroke/origin/多选矩阵与顶点还原。

浏览器覆盖：数值编辑与撤销、非法导入保留文档、25%/100%/200% 原始像素拖动、手绘格框、测量保存、响应式面板、自动保存恢复、实际文件下载、EXIF 方向、PNG 透明与倍率、JPG 铺底、SVG 实际矢量元素、嵌入图片。

识别覆盖：真实 OpenCV Worker、清晰合成矩形、嵌套、双边框、斜格、6000 px 长图跨块格框、取消；以及图片载入→识别→候选确认→JSON 保存重载→含参考图 PNG 下载。

指针在 25% 预览下只能按实际屏幕事件分辨率移动。测试使用可被屏幕像素精确表达的移动量；模型与归一化仍保留 0.001 px 精度，没有将所有坐标取整。

## Context7 连通与文档复验

重新验证时 MCP initialize 返回 HTTP 200，实际 resolver 与 query-docs 成功；已核对 React、Vite、Fabric、Ajv 和 OpenCV 的关键 API。当前实现与返回资料相符；安装版本精确快照的覆盖限制见 API 核对记录。本次仅更新核对文档，没有修改应用代码，因此没有重复执行无关应用测试。

## 已诊断的限制

OpenCV Worker 产物约 10.8 MB，首次识别需加载，但不依赖远程 CDN。Vite 提示 fs/path/crypto 浏览器 externalized 是该包 Node 分支产生的构建提示；实际生产 Worker 运行已通过，浏览器分支可用。主应用产物约 703 kB，属于性能待优化项。

独立审查后已修复预览尺寸/面积超预算、长宽切换瞬时巨额分配、重复识别生成重叠候选、嵌入图片超过 JSON 重载预算，以及尺寸标签/箭头预览与 SVG 样式差异。画布单边上限补充为 32767 px；真实 DPR 2 浏览器测试检查每次预览 backing 分配，每边≤16384、每层面积≤1600 万像素，PNG 编码有效。

## 未运行 / 待验收

- 真实 B05/B06/B10 漫画样本、准确率/召回率、人工修正时间：输入未提供，未运行。
- Windows Chrome/Edge 字体、真实图片与下载验收：未运行。
- 完整无障碍审计、其他浏览器、移动端触摸手势与低内存设备：未运行。
- 旧查看器数据迁移：尚未实现。

因此当前为可运行的开发版，不将九项需求的完整首版验收标记为全部通过。
