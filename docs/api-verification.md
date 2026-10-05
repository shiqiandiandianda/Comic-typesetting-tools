# GridLens 文档与版本核对

查询日期：2026-10-05（用户客户端日期）。所有 curl 命令保留默认 TLS 验证；所有 npm pack 使用 npm 的 registry integrity 校验。未写入凭据，未修改项目代码。

## 最新复验：Context7 已恢复

用户要求重验后，`POST https://mcp.context7.com/mcp` 的 initialize 返回 HTTP 200，serverInfo 为 Context7 4.1.1；`tools/list`、`resolve-library-id` 和 `query-docs` 均实际成功。使用公开 MCP JSON-RPC，默认 TLS 校验保持开启，不需要新增凭据。

已从服务返回的库列表选择 ID，并查询实际文档；没有凭空推断 ID。原始请求参数与返回证据保存于 `docs/context7/`。

| 依赖        | 实际 Context7 Library ID                          | 已核对的关键 API                                                                 | 版本覆盖                                                             |
| ----------- | ------------------------------------------------- | -------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| React 19.3  | `/reactjs/react.dev`                              | Effect cleanup、过期异步结果、StrictMode 额外 setup/cleanup                      | 官方当前文档，无 19.3 精确快照                                       |
| Vite 8.3    | `/vitejs/vite`                                    | `new Worker(new URL(..., import.meta.url), {type:'module'})`、静态选项、独立产物 | 官方当前文档，无 8.3 精确快照                                        |
| Fabric 7.4  | `/websites/fabricjs`                              | 7.x 默认 center、显式 left/top、getScenePoint、异步 dispose                      | 动态官方 API 与 7.0 迁移资料，无 7.4 精确快照                        |
| Ajv 8.20    | `/websites/ajv_js`                                | 2020-12 专用 Ajv2020、compile、strict、allErrors                                 | 动态官方文档，无 8.20 精确快照                                       |
| OpenCV 4.12 | `/websites/opencv_4_13_0`、`/techstark/opencv-js` | contours/approxPolyDP、初始化与 Mat/MatVector delete                             | 官方 4.13 与包装库 main 5.x；4.12 精确行为由安装产物与已运行测试补证 |

当前使用的上述关键 API 与查询结果一致，未发现需要修改应用代码的差异。查询结果偶有不一致片段（如把 Ajv2019 标题写成支持 2020-12），未盲目采纳；采用官方 JSON Schema 分版本说明与实际验证器行为。

完整记录：[Fabric](context7/fabric.md)、[React/Vite](context7/react-vite.md)、[Ajv/OpenCV](context7/ajv-opencv.md)。这些查询补上了先前未完成的 Context7 核对；不代表每个安装版本的全部 API 已获得精确快照。

## 初次 Context7 查询的历史阻塞

初次检查时，暴露工具中没有 Context7 resolver/query 工具。测试了三个官方公共入口：

1. `POST https://mcp.context7.com/mcp`，JSON-RPC `initialize`，协议 `2024-11-05`，Accept `application/json, text/event-stream`。
2. `GET https://context7.com/api/v2/libs/search?libraryName=react&query=useEffect`。
3. `GET https://context7.com/api/v1/search?query=react`。

三次均由网络代理拒绝：`curl: (56) CONNECT tunnel failed, response 403`，HTTP 结果 `000`。这是代理 CONNECT 阶段失败，未抵达 Context7 服务，不代表 API 返回拒绝或缺少 API key。

**初次检查时取得的 library IDs 与文档片段均为零。** 当时需要环境网络 allowlist 新增 `mcp.context7.com` 与 `context7.com`，然后重试。请求头证据在 `/tmp/context7-headers.txt`、`/tmp/context7-v2-headers.txt`、`/tmp/context7-v1-headers.txt`。

## 官方网站访问

初次检查时，以下页面也被同一代理以 CONNECT 403 拒绝；此段是历史结果，本次未重新检查这些网站的直接访问：

- https://react.dev/reference/react/useEffect
- https://vite.dev/guide/
- https://fabricjs.com/docs/upgrading/upgrading-to-fabric-70/
- https://ajv.js.org/json-schema.html
- https://docs.opencv.org/4.x/d4/da1/tutorial_js_setup.html

可选官方文档域名：`react.dev`、`vite.dev`、`fabricjs.com`、`ajv.js.org`、`docs.opencv.org`。

## 可访问的 npm registry 版本信息

`registry.npmjs.org` 可访问。使用 `npm view <package> version engines dist.tarball --json --cache /tmp/gridlens-npm-research` 实际查询：

| 库                   | registry latest 版本 | Node engines          |
| -------------------- | -------------------- | --------------------- |
| react                | 19.3.0               | >=0.10.0              |
| react-dom            | 19.3.0               | 未声明                |
| vite                 | 8.3.2                | ^20.19.0 或 >=22.12.0 |
| @vitejs/plugin-react | 6.1.1                | ^20.19.0 或 >=22.12.0 |
| fabric               | 7.4.0                | >=20.0.0              |
| ajv                  | 8.20.0               | 未声明                |
| typescript           | 7.0.2                | >=16.20.0             |
| @types/react         | 19.3.0               | 未声明                |
| @techstark/opencv-js | 5.0.0-release.1      | 未声明                |

OpenCV 包的 `dist-tags.latest` 为 `5.0.0-release.1`，该版本含 semver prerelease 后缀，不能称为没有 prerelease 后缀的 stable。当前实际 Node `v24.19.0`、npm `11.9.0` 满足上述已声明 engines。

## npm 包源码核对（不是 Context7 文档）

下载的发布包与解压源码位于 `/tmp/gridlens-library-source`。这些信息可以作为安装工程的官方发布 artifact 证据，不能冒充 Context7 结果。

### Fabric 7.4.0

- `package/src/shapes/Object/defaultValues.ts:67`、`:68`：`originX: CENTER`、`originY: CENTER`。本项目 JSON 坐标使用左上角，因此所有从坐标新建的 Rect 必须显式设置 `originX: 'left', originY: 'top'`，否则坐标解释偏移半个矩形。
- `package/src/canvas/StaticCanvas.ts:1428`：`dispose()` 返回 `Promise<boolean>`，并等待 rendering settled 后销毁。不要把这个 Promise 直接作为 React Effect 的 cleanup 返回值。可以使用同步 cleanup 包装 `void canvas.dispose()` 并处理 rejection/race；StrictMode 重建需保证 DOM cleanup 已启动，且闭包不更新已卸载状态。
- `package/src/canvas/SelectableCanvas.ts:1044`：`getScenePoint(e)` 得到 scene 坐标；`getPointer` 为兼容接口并注释为 deprecated 替代使用 getViewportPoint/getScenePoint。
- `StaticCanvas.ts` 提供 `setDimensions`、`setZoom`、`toSVG`、`toDataURL`；Canvas object 位置改变后应 `setCoords()` 以更新交互区域。
- `loadFromJSON` 返回 Promise，不能依赖旧版本的同步或旧 callback 完成语义。业务 GridLens JSON 不应当直接保存 Fabric 内部序列化模型。

### React 19.3 类型约束

`@types/react@19.3.0` 的 `react/index.d.ts:63`：`type Destructor = () => void | { [UNDEFINED_VOID_ONLY]: never }`。

`:1672`：`type EffectCallback = () => void | Destructor`。`:1792`：`useEffect(effect: EffectCallback, deps?: DependencyList): void`。

因此 `useEffect` callback 和其 cleanup 均不能返回 Promise；异步 initialize/dispose 必须放在 callback 内调用的异步流程中，由同步 cleanup 触发取消、unsubscribe、terminate 与 dispose。上述是 TypeScript 发布类型证据，官方 React 网页此次未能访问。

### Ajv 8.20.0

`package/lib/2020.ts` 明确导出默认 `Ajv2020`，meta-schema ID 是 `https://json-schema.org/draft/2020-12/schema`，载入 `draft2020Vocabularies`、dynamicRef、unevaluated 等支持。

对于仓库 `gridlens.schema.json` 的 draft 2020-12，使用 `import Ajv2020 from 'ajv/dist/2020'`（或 bundler 支持的显式 `.js`），不要使用默认的 draft-07 Ajv。`ajv-formats` 是 format 校验附加包；不应因 strict 未识别 format 而禁用整个 schema 验证。

### Vite 8.3.2 Worker

`package/client.d.ts:211` 声明 `*?worker`，构造器返回 `Worker`；`:218` 声明 `*?worker&inline`；`:225` 声明 `*?worker&url`。

`package/dist/node/chunks/node.js` 含针对 `new URL(..., import.meta.url)` worker 引用的处理。Vite 能打包本地 worker；推荐新 Worker(new URL('./detector.worker.ts', import.meta.url), { type: 'module' })，也可使用 `?worker` import。上述基于发布包类型及实现，不是本次官方网页或 Context7 结果。

### OpenCV npm 包 5.0.0-release.1

`package/README.md:5` 说明该 npm 包内的 `opencv.js` 来源 `https://docs.opencv.org/5.0.0/opencv.js`；这属于第三方 packaging，不是 OpenCV 官方 npm 发布。

README Basic Usage 需要三分支初始化：如果 `cvModule instanceof Promise` 则 await；否则如果 `cvModule.Mat` 已存在可直接使用；否则等待 `cvModule.onRuntimeInitialized`。README 警告 TypeScript 类型可能不完全同步运行时，实际方法可查 `doc/cvKeys.json`。

在 worker 内初始化一次并缓存 Promise；传递 ImageData/typed arrays 而不是 DOM HTMLImageElement；cv.Mat/MatVector/contours 等 Emscripten 对象必须在 finally delete，worker teardown 时 terminate。这些 Worker 架构建议属于待验证实现设计；本次没有获取 Context7 或官方网页来确认完整 worker 部署兼容性。

## 本次实际使用与验证

依赖版本已通过 `package-lock.json` 固定。React、Vite、Fabric、Ajv 与上表一致；OpenCV 选择 `@techstark/opencv-js@4.12.0-release.1`，匹配现有方案的 4.x API，未升级到 5.x。发布包 4.12 的初始化对象是自引用 thenable，因此 Worker 使用 `{cv: runtime}` 包装 Promise 结果，避免将其当普通 Promise resolve 导致循环。

当前实际调用 `matFromImageData`、`cvtColor`、`threshold`、`morphologyEx`、`findContours`、`approxPolyDP`、`boundingRect`、`contourArea`、`isContourConvex`；Mat、MatVector、轮廓与结构元素在 finally 释放，取消任务直接 terminate Worker。开发服务与生产构建中的真实 Worker 均已通过 Chromium 功能验证。以上仍属于发布包与运行证据，不是 Context7 文档核对。
