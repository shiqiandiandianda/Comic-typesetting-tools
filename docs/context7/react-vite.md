# React / Vite Context7 实际核验

查询日期：2026-10-05（Asia/Shanghai 用户日期）。查询通过现已可访问的 Context7 官方 MCP `https://mcp.context7.com/mcp`。使用 `/tmp/gridlens_context7_client.py` 中 `call(name, arguments)`；urllib 默认 TLS 验证开启。发送内容只有公共库名和 API 问题，没有私有代码、秘密或敏感数据。

## 请求范围与版本边界

- React：`resolve-library-id` 1 次、`query-docs` 2 次；选中官方文档 ID `/reactjs/react.dev`。
- Vite：`resolve-library-id` 1 次、`query-docs` 1 次；选中官方仓库文档 ID `/vitejs/vite`。
- 已安装版本为 React 19.3.0、Vite 8.3.2，但 resolver 没有列出与这两个安装版本完全一致的版本快照。React 官方文档项列出 `__branch__v18`，React 源码项列 19.2.x；Vite 列 8.0.x 等版本。实际 query 选用无版本后缀 ID，返回出处是官方仓库 `main`。因此这里是**当前官方 API 文档核对**，不能声称取得了 React 19.3 / Vite 8.3 指定版本快照。

## API 结论与当前代码符合性

### React Effect / StrictMode

Context7 返回官方 `useEffect.md`：setup 可返回 cleanup 函数；依赖改变时先用旧值 cleanup 再 setup 新值；卸载时 cleanup。异步请求示例把 async 函数放在 Effect 内，并用 ignore 标记阻止过期结果更新。StrictMode 文档明确开发期额外 setup / cleanup 验证。

当前代码对应：

- `src/main.tsx:7` 根渲染保留 StrictMode，能够暴露遗漏清理。
- `src/adapters/CanvasStage.tsx:228` 的 useLayoutEffect 每次 setup 创建新的 Canvas DOM 节点；cleanup `:530` 起同步移除键盘监听、清理 refs、调用 `void canvas.dispose()` 并移除旧 host 子节点，Effect 没有直接返回 Promise，支持开发期 setup / cleanup / setup。
- `src/adapters/CanvasStage.tsx:579` 起图片加载使用 AbortController；cleanup abort，并在异步完成时检查 aborted/disposed，符合防止过期异步结果污染当前外部系统的做法。
- `src/App.tsx:255` 恢复数据 Effect 使用 active 标记；`:269` 自动保存 cleanup 清除 timer 并阻止已取消任务状态更新；`:292` 卸载取消 recognition worker。这些清理与本次官方示例一致。
- 官方文档明确 setup 返回 cleanup 函数而非 async setup 的 Promise；同步 cleanup 的 void 类型还由当前 `@types/react` 定义佐证。不能将异步 `canvas.dispose()` 直接当 Effect cleanup 返回值。

这里只检查指定 Effect 生命周期关键路径，没有声称已完成所有 Hook 依赖项静态分析。

### Vite 本地 module Worker

Context7 返回官方 `docs/guide/features.md`：推荐 `new Worker(new URL('./worker.js', import.meta.url), { type: 'module' })`；为确保检测，new URL 必须直接放在 new Worker 内，options 必须为静态值。生产构建默认输出独立 worker chunk；worker 格式支持 `es | iife`。

当前代码对应：

- `src/features/recognition.ts:48` 直接嵌套 `new Worker(new URL('../workers/recognition.worker.ts', import.meta.url), { type: 'module' })`，路径为静态字符串，options 为静态字面量，符合检测约束。
- `vite.config.ts:4` 设置 `worker: { format: 'es' }`，与 ES module worker 一致。
- 当前已存在构建产物 `dist/assets/recognition.worker-BwPjfX3G.js`，说明本地 worker 被输出为独立 chunk。这是已有产物观测，本次查询任务没有重新执行构建。
- recognition job 完成或取消时 terminate worker 属于当前实现资源清理；这点不是 Vite 特有 API 文档承诺。

未修改仓库文件。以下完整保留实际工具文字响应。

## 原始响应：React resolve-library-id

请求参数：

```json
{
  "libraryName": "react",
  "query": "React 19.3 useEffect cleanup lifecycle StrictMode extra setup cleanup cycle"
}
```

Available Libraries:

- Title: React
- Context7-compatible library ID: /reactjs/react.dev
- Description: React.dev is the official documentation website for React, a JavaScript library for building user interfaces, providing guides, API references, and tutorials.
- Code Snippets: 4305
- Source Reputation: High
- Benchmark Score: 91.02
- Versions: __branch__v18

---

- Title: React
- Context7-compatible library ID: /react/react
- Description: React is a JavaScript library for building user interfaces.
- Code Snippets: 3937
- Source Reputation: High
- Benchmark Score: 76.93
- Versions: v19.2.7, v18.2.0, v19.2.8

---

- Title: React
- Context7-compatible library ID: /websites/react_dev
- Description: React is a JavaScript library for building user interfaces. It allows developers to create interactive web and native applications using reusable components, enabling efficient and scalable UI development.
- Code Snippets: 4980
- Source Reputation: High
- Benchmark Score: 90.54

---

- Title: React
- Context7-compatible library ID: /websites/react_dev_reference
- Description: React is a JavaScript library for building user interfaces with reusable components, hooks, and APIs for managing state and side effects.
- Code Snippets: 2673
- Source Reputation: High
- Benchmark Score: 90.49

---

- Title: React
- Context7-compatible library ID: /websites/react_dev_reference_react
- Description: React is a JavaScript library for building user interfaces using reusable components with reactive data binding and server-side rendering capabilities.
- Code Snippets: 1039
- Source Reputation: High
- Benchmark Score: 86.78

## 原始响应：React query-docs 1

请求参数：

```json
{
  "libraryId": "/reactjs/react.dev",
  "query": "React useEffect and useLayoutEffect cleanup return synchronous function not Promise; StrictMode development extra setup cleanup setup cycle, cancel async requests or ignore stale results. Give current official API docs and lifecycle guarantees applicable to React 19.3."
}
```

### Clean up external connections in an Effect

Source: https://github.com/reactjs/react.dev/blob/main/src/content/learn/escape-hatches.md

Return a cleanup function from `useEffect` to disconnect from external systems when the component unmounts. In development, React runs setup and cleanup an extra time to verify cleanup logic.

```javascript
import { useState, useEffect } from "react";
import { createConnection } from "./chat.js";

export default function ChatRoom() {
  useEffect(() => {
    const connection = createConnection();
    connection.connect();
    return () => connection.disconnect();
  }, []);
  return <h1>Welcome to the chat!</h1>;
}
```

```javascript
export function createConnection() {
  // A real implementation would actually connect to the server
  return {
    connect() {
      console.log("✅ Connecting...");
    },
    disconnect() {
      console.log("❌ Disconnected.");
    },
  };
}
```

```css
input {
  display: block;
  margin-bottom: 20px;
}
```

---

### Complete example of data fetching with useEffect and cleanup

Source: https://github.com/reactjs/react.dev/blob/main/src/content/reference/react/useEffect.md

Demonstrates fetching data for a selected option in React while handling race conditions using a cleanup flag. Includes the component in src/App.js and mock async function in src/api.js.

```javascript
import { useState, useEffect } from "react";
import { fetchBio } from "./api.js";

export default function Page() {
  const [person, setPerson] = useState("Alice");
  const [bio, setBio] = useState(null);
  useEffect(() => {
    let ignore = false;
    setBio(null);
    fetchBio(person).then((result) => {
      if (!ignore) {
        setBio(result);
      }
    });
    return () => {
      ignore = true;
    };
  }, [person]);

  return (
    <>
      <select
        value={person}
        onChange={(e) => {
          setPerson(e.target.value);
        }}
      >
        <option value="Alice">Alice</option>
        <option value="Bob">Bob</option>
        <option value="Taylor">Taylor</option>
      </select>
      <hr />
      <p>
        <i>{bio ?? "Loading..."}</i>
      </p>
    </>
  );
}
```

```javascript
export async function fetchBio(person) {
  const delay = person === "Bob" ? 2000 : 200;
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve("This is " + person + "’s bio.");
    }, delay);
  });
}
```

---

### Demonstrate Effect lifecycle and cleanup timing with setTimeout

Source: https://github.com/reactjs/react.dev/blob/main/src/content/learn/synchronizing-with-effects.md

Schedules a timeout log inside an Effect and cancels it in the cleanup function whenever text changes or the component unmounts. In development, React remounts once to verify cleanup, and React always cleans up the previous render's Effect before running the next render's Effect.

```javascript
import { useState, useEffect } from "react";

function Playground() {
  const [text, setText] = useState("a");

  useEffect(() => {
    function onTimeout() {
      console.log("⏰ " + text);
    }

    console.log('🔵 Schedule "' + text + '" log');
    const timeoutId = setTimeout(onTimeout, 3000);

    return () => {
      console.log('🟡 Cancel "' + text + '" log');
      clearTimeout(timeoutId);
    };
  }, [text]);

  return (
    <>
      <label>
        What to log:{" "}
        <input value={text} onChange={(e) => setText(e.target.value)} />
      </label>
      <h1>{text}</h1>
    </>
  );
}

export default function App() {
  const [show, setShow] = useState(false);
  return (
    <>
      <button onClick={() => setShow(!show)}>
        {show ? "Unmount" : "Mount"} the component
      </button>
      {show && <hr />}
      {show && <Playground />}
    </>
  );
}
```

---

### Enabling StrictMode in root render

Source: https://github.com/reactjs/react.dev/blob/main/src/content/reference/react/StrictMode.md

Wraps the root App component in StrictMode during rendering to enable development-only checks. This activates extra setup and cleanup cycles for effects and ref callbacks.

```javascript
import { createRoot } from "react-dom/client";
import { StrictMode } from "react";
import "./styles.css";

import App from "./App";

const root = createRoot(document.getElementById("root"));
// ✅ Using StrictMode.
root.render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

---

### useLayoutEffect(setup, dependencies?)

Source: https://github.com/reactjs/react.dev/blob/main/src/content/reference/react/useLayoutEffect.md

Call useLayoutEffect to perform layout measurements and run synchronous side effects before the browser repaints the screen. It blocks visual updates and should be used cautiously.

````APIDOC
## useLayoutEffect(setup, dependencies?)

### Description
`useLayoutEffect` is a version of `useEffect` that fires synchronously before the browser repaints the screen. It is typically used to perform layout measurements.

### Parameters
- **setup** (`Function`) - Required. The function containing the Effect logic. Can optionally return a cleanup function. React runs the setup function after commit and before the browser repaints the screen.
- **dependencies** (`Array`) - Optional. The list of all reactive values referenced inside the `setup` code. If omitted, the Effect re-runs after every commit.

### Returns
- `undefined`

### Usage Example
```js
import { useState, useRef, useLayoutEffect } from 'react';

function Tooltip() {
  const ref = useRef(null);
  const [tooltipHeight, setTooltipHeight] = useState(0);

  useLayoutEffect(() => {
    const { height } = ref.current.getBoundingClientRect();
    setTooltipHeight(height);
  }, []);
  // ...
}
````

### Caveats

- `useLayoutEffect` is a Hook; call it only at the top level of your component or custom Hooks.
- Code inside `useLayoutEffect` and scheduled state updates block the browser from repainting the screen.
- Effects only run on the client, not during server rendering.
- If a state update is triggered inside `useLayoutEffect`, React executes all remaining Effects immediately.

````

## 原始响应：React query-docs 2

请求参数：

```json
{
  "libraryId": "/reactjs/react.dev",
  "query": "Official useEffect API: setup optionally returns a cleanup function; do not use async function as Effect callback. Async function inside Effect with ignore boolean cleanup. StrictMode setup cleanup setup extra development cycle and dependencies list."
}
````

### useEffect(setup, dependencies?)

Source: https://github.com/reactjs/react.dev/blob/main/src/content/reference/react/useEffect.md

Call useEffect at the top level of your component to declare an Effect. It synchronizes a component with an external system and runs after the component commits changes to the DOM.

````APIDOC
## useEffect(setup, dependencies?)

### Description
A React Hook that lets you synchronize a component with an external system.

### Syntax
```js
useEffect(setup, dependencies?)
````

### Parameters

- **setup** (`Function`) - Required. The function containing your Effect's logic. It may optionally return a cleanup function. React runs the setup function when the component commits. After commits with changed dependencies, React runs the cleanup function with old values, then runs setup with new values. React also runs cleanup when the component is unmounted.
- **dependencies** (`Array`) - Optional. The list of all reactive values (props, state, component variables/functions) referenced inside `setup`. React compares each dependency using `Object.is`. If omitted, the Effect re-runs after every commit.

### Returns

- `undefined`

### Usage Example

```js
import { useState, useEffect } from "react";
import { createConnection } from "./chat.js";

function ChatRoom({ roomId }) {
  const [serverUrl, setServerUrl] = useState("https://localhost:1234");

  useEffect(() => {
    const connection = createConnection(serverUrl, roomId);
    connection.connect();
    return () => {
      connection.disconnect();
    };
  }, [serverUrl, roomId]);
  // ...
}
```

````

--------------------------------

### Fetch data manually inside useEffect with cleanup flag

Source: https://github.com/reactjs/react.dev/blob/main/src/content/reference/react/useEffect.md

Use an ignore boolean flag initialized to false and set to true in the cleanup function to prevent race conditions from out-of-order network responses.

```javascript
import { useState, useEffect } from 'react';
import { fetchBio } from './api.js';

export default function Page() {
  const [person, setPerson] = useState('Alice');
  const [bio, setBio] = useState(null);

  useEffect(() => {
    let ignore = false;
    setBio(null);
    fetchBio(person).then(result => {
      if (!ignore) {
        setBio(result);
      }
    });
    return () => {
      ignore = true;
    };
  }, [person]);

  // ...
````

---

### Fetch data inside useEffect using async/await syntax

Source: https://github.com/reactjs/react.dev/blob/main/src/content/reference/react/useEffect.md

Defines an inner async function within useEffect while retaining the ignore cleanup flag to avoid race conditions. Includes src/App.js and src/api.js.

```javascript
import { useState, useEffect } from "react";
import { fetchBio } from "./api.js";

export default function Page() {
  const [person, setPerson] = useState("Alice");
  const [bio, setBio] = useState(null);
  useEffect(() => {
    async function startFetching() {
      setBio(null);
      const result = await fetchBio(person);
      if (!ignore) {
        setBio(result);
      }
    }

    let ignore = false;
    startFetching();
    return () => {
      ignore = true;
    };
  }, [person]);

  return (
    <>
      <select
        value={person}
        onChange={(e) => {
          setPerson(e.target.value);
        }}
      >
        <option value="Alice">Alice</option>
        <option value="Bob">Bob</option>
        <option value="Taylor">Taylor</option>
      </select>
      <hr />
      <p>
        <i>{bio ?? "Loading..."}</i>
      </p>
    </>
  );
}
```

```javascript
export async function fetchBio(person) {
  const delay = person === "Bob" ? 2000 : 200;
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve("This is " + person + "’s bio.");
    }, delay);
  });
}
```

---

### Clean up external connections in an Effect

Source: https://github.com/reactjs/react.dev/blob/main/src/content/learn/escape-hatches.md

Return a cleanup function from `useEffect` to disconnect from external systems when the component unmounts. In development, React runs setup and cleanup an extra time to verify cleanup logic.

```javascript
import { useState, useEffect } from "react";
import { createConnection } from "./chat.js";

export default function ChatRoom() {
  useEffect(() => {
    const connection = createConnection();
    connection.connect();
    return () => connection.disconnect();
  }, []);
  return <h1>Welcome to the chat!</h1>;
}
```

```javascript
export function createConnection() {
  // A real implementation would actually connect to the server
  return {
    connect() {
      console.log("✅ Connecting...");
    },
    disconnect() {
      console.log("❌ Disconnected.");
    },
  };
}
```

```css
input {
  display: block;
  margin-bottom: 20px;
}
```

---

### Connecting ChatRoom Effect without cleanup

Source: https://github.com/reactjs/react.dev/blob/main/src/content/reference/react/StrictMode.md

Sets up an Effect to connect to a chat room on mount without returning a cleanup function. Strict Mode's extra setup and cleanup cycle in development exposes the missing disconnect cleanup.

```javascript
import { createRoot } from "react-dom/client";
import "./styles.css";

import App from "./App";

const root = createRoot(document.getElementById("root"));
root.render(<App />);
```

```javascript
import { useState, useEffect } from "react";
import { createConnection } from "./chat.js";

const serverUrl = "https://localhost:1234";
const roomId = "general";

export default function ChatRoom() {
  useEffect(() => {
    const connection = createConnection(serverUrl, roomId);
    connection.connect();
  }, []);
  return <h1>Welcome to the {roomId} room!</h1>;
}
```

## 原始响应：Vite resolve-library-id

请求参数：

```json
{
  "libraryName": "vite",
  "query": "Vite 8.3 module Worker new URL import.meta.url TypeScript local worker build"
}
```

Available Libraries:

- Title: Vite
- Context7-compatible library ID: /vitejs/vite
- Description: Vite is a next-generation frontend tooling that provides instant server start, lightning-fast HMR, and optimized builds for web development.
- Code Snippets: 1869
- Source Reputation: High
- Benchmark Score: 87.38
- Versions: v7.0.0, v5.4.21, v8.0.0, v7.3.1, v8.0.7, v8.0.10

---

- Title: Vite
- Context7-compatible library ID: /websites/v6_vite_dev
- Description: Vite is a blazing fast frontend build tool that leverages native ES modules and provides instant server start, lightning-fast HMR, and optimized production builds.
- Code Snippets: 823
- Source Reputation: High
- Benchmark Score: 87.46

---

- Title: Vite
- Context7-compatible library ID: /websites/vite_dev
- Description: Vite is a blazing fast frontend build tool that redefines developer experience with instant server start, lightning-fast HMR, and an optimized build process for modern web applications.
- Code Snippets: 697
- Source Reputation: High
- Benchmark Score: 79.07

---

- Title: Vite
- Context7-compatible library ID: /websites/v7_vite_dev
- Description: Vite is a blazing fast frontend build tool that provides instant server start, lightning fast HMR, and optimized production builds for modern web applications.
- Code Snippets: 981
- Source Reputation: High
- Benchmark Score: 79.81

---

- Title: Vite
- Context7-compatible library ID: /llmstxt/vite_dev_llms-full_txt
- Description: Vite is a fast and opinionated frontend build tool that significantly improves the web development experience by providing rapid development server start-up, instant Hot Module Replacement (HMR), and optimized production builds.
- Code Snippets: 1928
- Source Reputation: High
- Benchmark Score: 76.48

## 原始响应：Vite query-docs

请求参数：

```json
{
  "libraryId": "/vitejs/vite",
  "query": "Vite Web Workers with new Worker(new URL(\"./worker.ts\", import.meta.url), { type: \"module\" }): URL constructor must be directly inside new Worker and options static; build local worker as separate chunk; worker.format es. Current API applicable to Vite 8.3."
}
```

### Create module Web Worker using constructor options

Source: https://github.com/vitejs/vite/blob/main/docs/guide/features.md

Pass static option parameters such as type: 'module' to create a module worker.

```ts
const worker = new Worker(new URL("./worker.js", import.meta.url), {
  type: "module",
});
```

---

### Instantiate Worker with import.meta.url

Source: https://github.com/vitejs/vite/blob/main/playground/worker/index.html

Demonstrates instantiating a Web Worker using a relative script path resolved against import.meta.url.

```javascript
const worker = new Worker(new URL("./worker.js", import.meta.url));
```

---

### Worker format for MV3 vs classic

Source: https://github.com/vitejs/vite/blob/main/packages/vite/src/node/config.ts

Worker format option supporting 'es' (MV3 ES module service worker with static imports) and 'iife' (classic content script)

```typescript
  worker?: {
    /**
     * Output format for worker bundle
     * @default 'iife'
     */
    format?: 'es' | 'iife'
```

### Web Workers > Import with Constructors

Source: https://github.com/vitejs/vite/blob/main/docs/guide/features.md

A web worker script can be imported using [`new Worker()`](https://developer.mozilla.org/en-US/docs/Web/API/Worker/Worker) and [`new SharedWorker()`](https://developer.mozilla.org/en-US/docs/Web/API/SharedWorker/SharedWorker). Compared to the worker suffixes, this syntax leans closer to the standards and is the **recommended** way to create workers.

The worker constructor also accepts options, which can be used to create "module" workers:

The worker detection will only work if the `new URL()` constructor is used directly inside the `new Worker()` declaration. Otherwise it is handled as a [static asset URL](./assets#new-url-url-import-meta-url) instead. Additionally, all options parameters must be static values (i.e. string literals).

---

### Web Workers > Import with Query Suffixes

Source: https://github.com/vitejs/vite/blob/main/docs/guide/features.md

A web worker script can be directly imported by appending `?worker` or `?sharedworker` to the import request. The default export will be a custom worker constructor:

The worker script can also use ESM `import` statements instead of `importScripts()`. **Note**: During development this relies on [browser native support](https://caniuse.com/?search=module%20worker), but for the production build it is compiled away.

By default, the worker script will be emitted as a separate chunk in the production build. If you wish to inline the worker as base64 strings, add the `inline` query:

If you wish to retrieve the worker as a URL, add the `url` query:

See [Worker Options](/config/worker-options.md) for details on configuring the bundling of all workers.
