# Fabric Context7 实际查询

日期：2026-10-05。MCP HTTPS 调用保持默认 TLS 验证。先 resolver，再 query-docs。

## Resolver

参数：libraryName=Fabric.js；query=Fabric 7.4.0 Canvas getScenePoint default origin left top asynchronous dispose StrictMode and polygon controls。

Available Libraries:

- Title: Fabric.js
- Context7-compatible library ID: /websites/fabricjs
- Description: Fabric.js is a powerful JavaScript HTML5 canvas library that provides an interactive object model with support for text editing, complex paths, image filtering, animation, and SVG parsing.
- Code Snippets: 4565
- Source Reputation: High
- Benchmark Score: 64.64

---

- Title: Fabric.js
- Context7-compatible library ID: /fabricjs/fabricjs.com
- Description: http://fabricjs.com
- Code Snippets: 8727
- Source Reputation: Medium
- Benchmark Score: 66.03

---

- Title: Fabric.js
- Context7-compatible library ID: /fabricjs/fabric.js
- Description: Javascript Canvas Library, SVG-to-Canvas (& canvas-to-SVG) Parser
- Code Snippets: 905
- Source Reputation: Medium
- Benchmark Score: 59.53

## 坐标与原点

Library ID：`/websites/fabricjs`。查询：Fabric.js 7 Canvas getScenePoint event scene coordinates, explicit originX left originY top since default center and asynchronous dispose in React StrictMode cleanup。

### getScenePoint(e)

Source: https://fabricjs.com/api/classes/canvas

Returns a point in the scene plane from a pointer event.

```APIDOC
## getScenePoint(e)

### Description
Returns a point in the scene plane (same plane as FabricObject#getCenterPoint). Changes to viewportTransform do not change the point's values, but from the viewer's perspective the point changes.

### Method
N/A (method call)

### Endpoint
N/A (method call)

### Parameters
#### e (TPointerEvent) - Required - The pointer event.

### Returns
Point - point existing in the scene plane.

### Example
```

const viewportPoint = sendPointToPlane(
this.getScenePoint(e),
canvas.viewportTransform
);

```

### Inherited from
SelectableCanvas.getScenePoint
```

---

### Set object position with setXY()

Source: https://fabricjs.com/api/classes/basefabricobject

Sets the object's position to the given point in absolute canvas coordinates, with optional originX and originY parameters. The example uses 'left' and 'bottom' origins.

```javascript
object.setXY(new Point(5, 5), 'left', 'bottom').
```

### Upgrading to Fabric.js 7.0 > Breaking changes > Changed default values > WARNING: Object.originX and object.originY now default to ‘center’

Source: https://fabricjs.com/docs/upgrading/upgrading-to-fabric-70

**This is the only real annoying breaking change.**

In fabric 8.0 or later we would like to remove those entirely. Unless you set them back to ‘left’ and ‘top’, it means that the object is positioned by its center. When you position an object at `0,0` it will be a quarter on screen and three quarter off screen.

In order to make things easy, since many developers are more comfortable with the left top corner, utility methods have been added:

getPositionByOrigin is the mirror of setPositionByOrigin:

```

  getPositionByOrigin(originX, originY) {
    return this.translateToOriginPoint(this.getRelativeCenterPoint(), originX, originY);
  }

```

It is used to determine where is for example the left,top corner of an object by calling

```

const point = rect.getPositionByOrigin('left', 'top');

```

`positionByLeftTop(point)` is a shortcut for `setPositionByOrigin(point, ‘left’, ‘top’); We understand that may be a very common use case and we provided a shortcut.

In the extension folders updaters for data and loadFromJSON have been added. They currently work well under browser only and a node version will also be made available.

---

### Canvas > getScenePoint

Source: https://fabricjs.com/api/classes/canvas

### getScenePoint()

> **getScenePoint**(`e`): `Point`

Defined in: src/canvas/SelectableCanvas.ts:1044

#### Parameters

##### e

`TPointerEvent`

#### Returns

`Point`

point existing in the scene (the same plane as the plane FabricObject#getCenterPoint exists in). This means that changes to the viewportTransform do not change the values of the point, however, from the viewer’s perspective, the point is changed.

#### Example

```

const viewportPoint = sendPointToPlane(
 this.getScenePoint(e),
 canvas.viewportTransform
);

```

#### Inherited from

`SelectableCanvas.getScenePoint`

---

### setXY()

Source: https://fabricjs.com/api/classes/fabricimage

> **setXY**(`point`, `originX?`, `originY?`): `void`
> Defined in: src/shapes/Object/ObjectGeometry.ts:165
> Set an object position to a particular point, the point is intended in absolute ( canvas ) coordinate. You can specify originX and originY values, that otherwise are the object’s current values.

#### Parameters

##### point

`Point`
position in scene coordinate plane

##### originX?

`TOriginX`
Horizontal origin: ‘left’, ‘center’ or ‘right’

##### originY?

`TOriginY`
Vertical origin: ‘top’, ‘center’ or ‘bottom’

#### Returns

`void`

#### Example

```

object.setXY(new Point(5, 5), 'left', 'bottom').

```

#### Inherited from

`FabricObject`.`setXY`

## 清理生命周期

Library ID：`/websites/fabricjs`。查询：Canvas dispose asynchronous Promise boolean cleanup DOM remove references and destroy after pending rendering Fabric.js 7。

### dispose()

Source: https://fabricjs.com/api/classes/canvas

Waits until rendering has settled to destroy the canvas, returning a promise that resolves to true if destroyed or false if already destroyed.

```APIDOC
## dispose()

### Description
Waits until rendering has settled to destroy the canvas.

### Method
N/A (method call)

### Signature
`dispose(): Promise<boolean>`

### Parameters
None

### Returns
`Promise<boolean>` - a promise resolving to `true` once the canvas has been destroyed or to `false` if the canvas has was already destroyed

### Throws
if aborted by a consequent call

### Inherited from
`SelectableCanvas.dispose`

```

---

### dispose

Source: https://fabricjs.com/api/classes/webglfilterbackend

Detach event listeners, remove references, and clean up caches.

```APIDOC
dispose()
```

### dispose() > Returns

Source: https://fabricjs.com/api/classes/staticcanvas

`Promise`<`boolean`>
a promise resolving to `true` once the canvas has been destroyed or to `false` if the canvas has was already destroyed

---

### dispose()

Source: https://fabricjs.com/api/classes/staticcanvas

Waits until rendering has settled to destroy the canvas

---

### dispose()

Source: https://fabricjs.com/api/classes/path

> **dispose**(): `void`
> Defined in: src/shapes/Object/Object.ts:1493
> cancel instance’s running animations override if necessary to dispose artifacts such as `clipPath`

#### Returns

`void`

#### Inherited from

`FabricObject`.`dispose`

## 匹配结论与版本边界

当前代码显式使用 left/top，使用 getScenePoint 得到 scene 坐标，同步 React cleanup 内调用异步 dispose；与返回资料一致。源码与已有测试补充验证 stroke 与多选几何。Context7 使用动态官方文档 ID，没有提供 Fabric 7.4.0 的精确版本快照，不能将查询范围夸大为该版本全部 API。
