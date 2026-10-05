# Context7 实际检索：Ajv 与 OpenCV

日期：2026-10-05（Asia/Shanghai）。调用工具：/tmp/gridlens_context7_client.py 的 call()，HTTPS https://mcp.context7.com/mcp，保持 urllib TLS 默认验证。共执行 Ajv 1 次 resolver + 2 次 query，OpenCV 1 次 resolver + 2 次 query；每次均正常返回。

## 与代码匹配的结论

- Ajv 实际检索 ID 为 `/websites/ajv_js`。文档明确 draft-2020-12 应使用 `import Ajv2020 from "ajv/dist/2020"`；`src/core/document.ts` 的该导入和 `new Ajv2020({allErrors:true,strict:true}).compile<GridDocument>(schema)` 匹配。编译函数返回 boolean，错误从 validator.errors 读取；未开启 removeAdditional/useDefaults/coerceTypes，不应把校验作为数据修改器。
- Ajv 版本覆盖：官方网站为动态文档，本次未提供 8.20.0 专属快照；resolver 另列 `/ajv-validator/ajv` 的 `v8.17.1`。项目安装/锁定版本仍是 npm 8.20.0，精确版本依据本地 package/源码和实际测试，不能称 Context7 提供了 8.20.0 版本证明。
- Ajv draft query 的一段标题误称 Ajv2019 支持 2020-12；与同次明确 Ajv2020 示例和不兼容说明矛盾，因此未采纳这段标题。使用明确 Ajv2020 专用导入。
- OpenCV 官方检索 ID 为 `/websites/opencv_4_13_0`：实际返回的是 4.13.0 官方 JavaScript 示例，核对了 cv.cvtColor、cv.threshold、cv.findContours、cv.MatVector、cv.approxPolyDP 和 Mat/MatVector/hierarchy 的 .delete()。项目 Worker 选择 RETR_LIST 保留嵌套，使用 finally 释放 Mat/MatVector 和单个 contours.get(i) 结果。findContours 输出先基于二值灰度图，随后多边形近似，与官方流程一致。
- OpenCV 包装库检索 ID 为 `/techstark/opencv-js`：返回 main 分支初始化示例，先检查 runtime.Mat，未就绪则绑定 onRuntimeInitialized，返回 {cv} 包装；内存文档要求 finally 调用 .delete()。项目 Worker 与这个模式匹配，并根据本地 4.12 产物的自引用 thenable 保留 {cv} 包装，避免 Promise assimilation。
- OpenCV 版本覆盖：resolver 没有返回 4.12.0 专属官方索引；所用官方页面实际 4.13.0，Techstark main 文档自称当前 5.0.0-release.1。因此不能将这些查询称为 4.12 的精确版本文档。项目目标 `@techstark/opencv-js@4.12.0-release.1` 的精确行为另以其本地 dist/opencv.js/src/types 及真实 Chromium Worker 测试确认，尤其仍使用其实际 onRuntimeInitialized 接口，而未照搬 5.0 native Promise 假设。
- Context7 本轮没有返回原生 Worker 生命周期 API 的官方例子；Worker terminate 取消、无过期写入、OffscreenCanvas、ImageBitmap 释放为项目实现与真实浏览器验收证据，不冒称查询已涵盖这些 API。

以下为 helper 返回的完整原始文本，未删节。

## Ajv resolver（完整返回）

Available Libraries:

- Title: Ajv
- Context7-compatible library ID: /websites/ajv_js
- Description: Ajv is a JSON schema validator for JavaScript that compiles JSON Schema and JSON Type Definition schemas to optimized code for fast and secure data validation.
- Code Snippets: 641
- Source Reputation: High
- Benchmark Score: 77

---

- Title: Ajv
- Context7-compatible library ID: /ajv-validator/ajv
- Description: The fastest JSON Schema validator for Node.js and browser, supporting multiple JSON Schema drafts and JSON Type Definition.
- Code Snippets: 547
- Source Reputation: High
- Benchmark Score: 86.3
- Versions: v8.17.1

---

- Title: Ajv Formats
- Context7-compatible library ID: /ajv-validator/ajv-formats
- Description: Ajv Formats is a package that provides JSON Schema formats for use with the Ajv validator, defining various data types like date, time, URI, email, and others for robust validation.
- Code Snippets: 156
- Source Reputation: High
- Benchmark Score: 87.84
- Versions: v3.0.1

## Ajv draft-2020-12 query（完整返回）

### Initialize Ajv with draft-2020-12

Source: https://ajv.js.org/json-schema

Draft-2020-12 is not backwards compatible and requires its own specific import.

```javascript
const Ajv2020 = require("ajv/dist/2020");
const ajv = new Ajv2020();
```

```typescript
import Ajv2020 from "ajv/dist/2020";
const ajv = new Ajv2020();
```

---

### Initialize Ajv with draft-07

Source: https://ajv.js.org/json-schema

The default Ajv export uses draft-07, which is recommended for better performance.

```javascript
const Ajv = require("ajv");
const ajv = new Ajv();
```

```typescript
import Ajv from "ajv";
const ajv = new Ajv();
```

---

### Initialize Ajv for Draft 2019-09/2020-12

Source: https://ajv.js.org/guide/schema-language

Use this export to enable Ajv support for all JSON Schema draft-2019-09 and draft-2020-12 features, including advanced capabilities like 'unevaluatedProperties'.

```javascript
import Ajv2019 from "ajv/dist/2019";
const ajv = new Ajv2019();
```

---

### Validate Data with JSON Schema

Source: https://ajv.js.org/

Use this snippet to validate JSON data against a JSON Schema. Ensure the 'ajv' package is installed and imported. The 'validate' method returns a boolean, and errors are logged to the console if validation fails.

```javascript
const Ajv = require("ajv");
const ajv = new Ajv();

const schema = {
  type: "object",
  properties: {
    foo: { type: "integer" },
    bar: { type: "string" },
  },
  required: ["foo"],
  additionalProperties: false,
};

const data = { foo: 1, bar: "abc" };
const valid = ajv.validate(schema, data);
if (!valid) console.log(ajv.errors);
```

### JSON Schema > JSON Schema versions > draft-2020-12 BREAKING

Source: https://ajv.js.org/json-schema

Draft-2020-12 introduces breaking changes and is not backwards compatible with previous versions. It cannot be combined with other JSON Schema versions within the same Ajv instance. It includes updates such as prefixItems and dynamic references.

## Ajv options/compile query（完整返回）

### Enable All Errors Reporting

Source: https://ajv.js.org/options

To report all validation errors instead of stopping at the first one, pass `allErrors: true` to the Ajv constructor.

```javascript
const ajv = new Ajv({ allErrors: true });
```

---

### Removing Additional Properties with Ajv

Source: https://ajv.js.org/guide/modifying-data.html

Demonstrates how to use the `removeAdditional: true` option to filter data during validation. This option modifies the original data, removing properties not defined in the schema. Note that nested `additionalProperties` do not affect the removal of properties at the parent level.

```javascript
const Ajv = require("ajv");
const ajv = new Ajv({ removeAdditional: true });
const schema = {
  additionalProperties: false,
  properties: {
    foo: { type: "number" },
    bar: {
      additionalProperties: { type: "number" },
      properties: {
        baz: { type: "string" },
      },
    },
  },
};

const data = {
  foo: 0,
  additional1: 1, // will be removed; `additionalProperties` == false
  bar: {
    baz: "abc",
    additional2: 2, // will NOT be removed; `additionalProperties` != false
  },
};

const validate = ajv.compile(schema);

console.log(validate(data)); // true
console.log(data); // { "foo": 0, "bar": { "baz": "abc", "additional2": 2 }
```

---

### Validate JSON Schema Security

Source: https://ajv.js.org/security.html

Use this snippet to check if a JSON schema adheres to security recommendations, such as including `maxLength` when using formats like 'email'. This requires `strictTypes: false` option for Ajv.

```javascript
ajv = new Ajv({ strictTypes: false }); // this option is required for this schema
const isSchemaSecure = ajv.compile(
  require("ajv/lib/refs/json-schema-secure.json"),
);

const schema1 = { format: "email" };
isSchemaSecure(schema1); // false

const schema2 = { format: "email", maxLength: MAX_LENGTH };
isSchemaSecure(schema2); // true
```

### Ajv constructor and methods > ajv.compile(schema: object): (data: any) => boolean | Promise < any >

Source: https://ajv.js.org/api.html

The `compile` method generates a validating function for a given schema and caches it. The returned function validates data against the schema and returns a boolean. It also has `errors` and `schema` properties. The schema is validated against a meta-schema by default, and an error is thrown if it's invalid, unless `validateSchema` option is false.

---

### Ajv options > Strict mode options v7 > strictSchema

Source: https://ajv.js.org/options

The `strictSchema` option prevents unknown keywords, formats, etc. When set to `true` (default), it throws an exception if any strict schema restriction is violated. It can also be set to `'log'` to log warnings or `false` to ignore violations.

## OpenCV resolver（完整返回）

Available Libraries:

- Title: Techstark OpenCV JS
- Context7-compatible library ID: /techstark/opencv-js
- Description: Techstark OpenCV JS is a TypeScript NPM package wrapping the pre-built OpenCV.js (WASM) binary with type definitions, supporting Node.js and browser environments for computer vision.
- Code Snippets: 516
- Source Reputation: Medium
- Benchmark Score: 66.8

---

- Title: OpenCV
- Context7-compatible library ID: /websites/opencv_5_0
- Description: OpenCV (Open Source Computer Vision Library) is an open-source library that includes several hundreds of computer vision algorithms, primarily used for image processing, video analysis, and object detection.
- Code Snippets: 24828
- Source Reputation: High
- Benchmark Score: 76.87

---

- Title: OpenCV
- Context7-compatible library ID: /websites/opencv_4_13_0
- Description: OpenCV (Open Source Computer Vision Library) is an open-source library that provides a common infrastructure for computer vision applications and offers a wide range of algorithms for image and video processing, machine learning, and computer vision tasks.
- Code Snippets: 47249
- Source Reputation: High
- Benchmark Score: 72.62

---

- Title: OpenCV
- Context7-compatible library ID: /websites/opencv_4_6_0
- Description: OpenCV is an open-source computer vision library providing tools for image processing, video analysis, object detection, and machine learning applications.
- Code Snippets: 17297
- Source Reputation: High
- Benchmark Score: 74.21

---

- Title: OpenCV
- Context7-compatible library ID: /opencv/opencv
- Description: OpenCV is an open source computer vision library that provides tools and algorithms for image and video analysis, machine learning, and real-time processing across multiple platforms.
- Code Snippets: 8800
- Source Reputation: High
- Benchmark Score: 69.21

## OpenCV 4.13 官方 contours query（完整返回）

### Find and Draw Contours Example

Source: https://docs.opencv.org/4.13.0/d5/daa/tutorial_js_contours_begin.html

This example demonstrates how to find contours in a binary image using cv.findContours() and then draw them on an output image using cv.drawContours(). It requires a binary input image and specifies retrieval and approximation modes.

```javascript
let src = cv.imread("canvasInput");
let dst = cv.Mat.zeros(src.rows, src.cols, cv.CV_8UC3);
cv.cvtColor(src, src, cv.COLOR_RGBA2GRAY);
cv.threshold(src, src, 127, 255, cv.THRESH_BINARY);
let contours = new cv.MatVector();
let hierarchy = new cv.Mat();
// You can try more modes and find the one that suits your need.
cv.findContours(
  src,
  contours,
  hierarchy,
  cv.RETR_EXTERNAL,
  cv.CHAIN_APPROX_SIMPLE,
);
// Draw all the contours
cv.drawContours(dst, contours, -1, new cv.Scalar(255, 0, 0, 255), 2);
// You can draw the contours with maxLevel
// cv.drawContours(dst, contours, -1, new cv.Scalar(255, 0, 0, 255), 2, cv.LINE_8, hierarchy, 1);
cv.imshow("canvasOutput", dst);
src.delete();
dst.delete();
contours.delete();
hierarchy.delete();
```

---

### Approximate Contour Shape

Source: https://docs.opencv.org/4.13.0/dc/dcf/tutorial_js_contour_features.html

Approximate a contour to a simpler shape with fewer vertices using cv.approxPolyDP. The 'epsilon' parameter controls the approximation accuracy, and 'closed' ensures the approximated curve is closed.

```javascript
let approxCurve = new cv.Mat();
cv.approxPolyDP(curve, approxCurve, epsilon, closed);
```

---

### cv::findContours

Source: https://docs.opencv.org/4.13.0/opencv.tag

Finds contours in a binary image.

```APIDOC
## cv::findContours

### Description
Finds contours in a binary image.

### Signature
`void cv::findContours(InputArray image, OutputArrayOfArrays contours, int mode, int method, Point offset=Point())`
`void cv::findContours(InputArray image, OutputArrayOfArrays contours, OutputArray hierarchy, int mode, int method, Point offset=Point())`
```

### Find Contours Demo

Source: https://docs.opencv.org/4.13.0/df/d0d/tutorial_find_contours.html

The `findContours` function in OpenCV is used to detect contours in a binary image. It takes a binary source image, a list to store the detected contours, and an optional hierarchy. The function supports different retrieval modes (`RETR_TREE`, `RETR_LIST`, etc.) and approximation methods (`CHAIN_APPROX_SIMPLE`, `CHAIN_APPROX_NONE`). The output `contours` is a list of `MatOfPoint`, where each `MatOfPoint` represents a single contour. The `hierarchy` output provides information about the relationship between contours (e.g., parent-child relationships).

---

### OpenCV 4.13.0 > OpenCV.js Tutorials > Image Processing

Source: https://docs.opencv.org/4.13.0/d0/d43/tutorial_js_table_of_contents_contours.html

The documentation includes several tutorials related to contours in OpenCV. These cover finding and drawing contours, understanding contour features such as area and perimeter, examining contour properties like solidity and mean intensity, and exploring more advanced functions like convexity defects and shape matching. Additionally, there is a section dedicated to understanding contour hierarchy.

## Techstark OpenCV runtime/cleanup query（完整返回）

### Initialize OpenCV.js

Source: https://github.com/techstark/opencv-js/blob/main/README.md

Asynchronously load and initialize the OpenCV module to ensure the runtime is ready before executing OpenCV functions.

```javascript
import cvModule from "@techstark/opencv-js";

async function getOpenCv() {
  let cv;
  if (cvModule instanceof Promise) {
    cv = await cvModule;
  } else {
    if (cvModule.Mat) {
      cv = cvModule;
    } else {
      await new Promise((resolve) => {
        cvModule.onRuntimeInitialized = () => resolve();
      });
      cv = cvModule;
    }
  }
  return { cv };
}

async function main() {
  const { cv } = await getOpenCv();
  console.log("OpenCV.js is ready!");
  // You can now use OpenCV functions here
  console.log(cv.getBuildInformation());
}

main();
```

---

### OpenCV Object Memory Management

Source: https://github.com/techstark/opencv-js/blob/main/CLAUDE.md

Crucial for preventing memory leaks in WASM environments. Always call `.delete()` on OpenCV objects after use, preferably within a `finally` block.

```typescript
const mat = new cv.Mat(3, 3, cv.CV_8UC1);
try {
  // use mat
} finally {
  mat.delete();
}
```

---

### Clean Up MatVector Containers

Source: https://github.com/techstark/opencv-js/blob/main/_autodocs/patterns.md

Explicitly delete vector containers like MatVector to avoid memory leaks during contour detection or similar operations.

```typescript
const contours = new cv.MatVector();
const hierarchy = new cv.Mat();

try {
  cv.findContours(
    img,
    contours,
    hierarchy,
    cv.RETR_EXTERNAL,
    cv.CHAIN_APPROX_SIMPLE,
  );

  for (let i = 0; i < contours.size(); i++) {
    const contour = contours.get(i);
    const area = cv.contourArea(contour);
    console.log(`Contour ${i}: area = ${area}`);
  }
} finally {
  contours.delete();
  hierarchy.delete();
}
```

### Common Patterns and Best Practices > Module Initialization

Source: https://github.com/techstark/opencv-js/blob/main/_autodocs/patterns.md

OpenCV.js provides two primary initialization methods depending on the version. Version 5.0.0 and later support a promise-based approach, while legacy versions (4.10 and earlier) rely on the onRuntimeInitialized callback to ensure the library is ready for use.

---

### Project Overview

Source: https://github.com/techstark/opencv-js/blob/main/CLAUDE.md

The opencv-js package is a TypeScript NPM package that wraps the pre-built OpenCV.js (WASM) binary and provides type definitions. It supports both Node.js and browser environments. The current version is 5.0.0-release.1, utilizing OpenCV version 5.0.0 with the WASM binary located in dist/opencv.js. The binary is built via GitHub Actions using the build-opencv-js.yml workflow.
