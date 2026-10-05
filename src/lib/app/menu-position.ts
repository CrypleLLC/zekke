export interface MenuPlacement {
  left: number;
  top: number;
}

export const MENU_VIEWPORT_MARGIN_PX = 8;

export function placeMenuAt(
  pointer: { x: number; y: number },
  menu: { width: number; height: number },
  viewport: { width: number; height: number },
): MenuPlacement {
  const margin = MENU_VIEWPORT_MARGIN_PX;
  const fitsRight = pointer.x + menu.width + margin <= viewport.width;
  const fitsBelow = pointer.y + menu.height + margin <= viewport.height;
  const left = fitsRight ? pointer.x : pointer.x - menu.width;
  const top = fitsBelow ? pointer.y : pointer.y - menu.height;
  return {
    left: Math.max(margin, Math.min(left, viewport.width - menu.width - margin)),
    top: Math.max(margin, Math.min(top, viewport.height - menu.height - margin)),
  };
}
