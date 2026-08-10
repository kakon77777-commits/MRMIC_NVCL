# Pixel Gesture IR

Version: `mrmic-pixel-agent-v1`

## Coordinate spaces

- `normalized_frame`: each coordinate is within `[0,1]` relative to the supplied raster.
- `frame_pixel`: coordinates are raster pixels.

When a raster is cropped, the Runtime projects raster coordinates back to the immutable full frame before execution:

```text
fullX = crop.x + rasterX
fullY = crop.y + rasterY

fullNormalizedX = (crop.x + normalizedX * crop.width) / fullFrame.width
fullNormalizedY = (crop.y + normalizedY * crop.height) / fullFrame.height
```

## Gestures

```ts
drag      { from, to }
resize    { from, to }
delete    { at }
restyle   { at, style }
type_text { at, text }
draw_path { points, style? }
pan       { from, to }
zoom      { at, factor }
```

The IR contains no target identity. Drag/delete/restyle resolve the topmost visible object at runtime. Resize must start in the bottom-right handle region. Text edits an existing text-like object or creates text when no editable target is hit. Drawing, pan and zoom do not require an object hit.

## Evidence

Backend evidence records:

- coordinate space;
- provider frame points;
- resolved world points;
- whether hit-testing was verified;
- number of resolved targets;
- before/after frame IDs, revisions and hashes;
- freshness and transition-guard result.

Resolved object IDs remain backend audit data and are not returned as Provider feedback.
