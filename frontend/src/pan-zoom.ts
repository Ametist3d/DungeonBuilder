// pan-zoom.ts
export interface PanZoomController {
  reset: () => void;
}

export function setupPanZoom(container: HTMLElement, target: SVGElement): PanZoomController {
  const MIN_SCALE = 1;
  const MAX_SCALE = 6;
  const ZOOM_STEP = 1.1;

  let scale = 1;
  let tx = 0, ty = 0;
  let isPanning = false;
  let startX = 0, startY = 0;
  let startTx = 0, startTy = 0;

  const apply = () => {
    target.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`;
    target.style.transformOrigin = '0 0';
    container.style.cursor = isPanning ? 'grabbing' : 'default';
  };

  container.addEventListener('wheel', (e) => {
    e.preventDefault();
    const rect = container.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    const zoomFactor = e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
    const newScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale * zoomFactor));
    if (newScale === scale) return;

    // keep the point under the cursor fixed while scaling
    tx = mx - ((mx - tx) / scale) * newScale;
    ty = my - ((my - ty) / scale) * newScale;
    scale = newScale;

    if (scale === MIN_SCALE) { tx = 0; ty = 0; }
    apply();
  }, { passive: false });

  container.addEventListener('contextmenu', (e) => e.preventDefault());

  container.addEventListener('mousedown', (e) => {
    if (e.button !== 2) return;
    isPanning = true;
    startX = e.clientX;
    startY = e.clientY;
    startTx = tx;
    startTy = ty;
    apply();
    e.preventDefault();
  });

  window.addEventListener('mousemove', (e) => {
    if (!isPanning) return;
    tx = startTx + (e.clientX - startX);
    ty = startTy + (e.clientY - startY);
    apply();
  });

  window.addEventListener('mouseup', () => {
    if (!isPanning) return;
    isPanning = false;
    apply();
  });

  // container.addEventListener('dblclick', () => reset());

  const reset = () => {
    scale = 1;
    tx = 0;
    ty = 0;
    apply();
  };

  apply();
  return { reset };
}
