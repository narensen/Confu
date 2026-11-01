// Where the capture / selection card sits. Coordinates coming in are viewport
// pixels (from getBoundingClientRect). The card is then placed inside the
// reader, not the window: the reader ends above the phone tab bar, and the
// session page clips anything past it. A figure grabbed near the bottom used
// to open below the drag, then grow once the preview loaded, so the type
// field landed past the fold.

export type Edges = { left: number; top: number; right: number; bottom: number };

export type PopoverPlace = { left: number; top: number; maxHeight: number; maxWidth: number };

const MIN_HEIGHT = 88;
const MIN_WIDTH = 140;

export function placePopover(opts: {
  x: number;
  y: number;
  top: number;
  width: number;
  height: number;
  host: Edges;
  view: Edges;
  margin?: number;
}): PopoverPlace {
  const margin = opts.margin ?? 8;
  const boundTop = Math.max(opts.host.top, opts.view.top) + margin;
  const boundBottom = Math.min(opts.host.bottom, opts.view.bottom) - margin;
  const boundLeft = Math.max(opts.host.left, opts.view.left) + margin;
  const boundRight = Math.min(opts.host.right, opts.view.right) - margin;
  const maxHeight = Math.max(MIN_HEIGHT, boundBottom - boundTop);
  const maxWidth = Math.max(MIN_WIDTH, boundRight - boundLeft);
  const height = Math.min(Math.max(opts.height, 1), maxHeight);
  const width = Math.min(Math.max(opts.width, 1), maxWidth);

  let left = opts.x - width / 2;
  if (left + width > boundRight) left = boundRight - width;
  if (left < boundLeft) left = boundLeft;

  // Prefer just under the selection. If that would push the card (and the
  // field at its bottom) past the reader, sit it above the selection instead.
  const below = opts.y + margin;
  const above = opts.top - margin - height;
  let top = below + height <= boundBottom ? below : above;
  if (top < boundTop) top = boundTop;
  if (top + height > boundBottom) top = Math.max(boundTop, boundBottom - height);

  return {
    left: left - opts.host.left,
    top: top - opts.host.top,
    maxHeight,
    maxWidth,
  };
}
