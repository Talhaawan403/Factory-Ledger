import { useLayoutEffect, type RefObject } from 'react';

const NS = 'http://www.w3.org/2000/svg';

type Options = {
  radius?: number;   // must match the bar's border-radius (px)
  bezel?: number;    // width of the refracting rim (px)
  maxShift?: number; // max pixel displacement at the very edge
  blur?: number;
  saturate?: number;
};

// SVG filters inside backdrop-filter only work in Chromium (Chrome, Edge, Android WebView).
const supportsSvgBackdrop = () =>
  typeof navigator !== 'undefined' &&
  /Chrome\//.test(navigator.userAgent) &&
  !/iPhone|iPad|iPod/.test(navigator.userAgent);

/** Displacement map: R/G encode an inward push that is strongest at the edge and fades to 0 over `bezel`. */
function buildMap(w: number, h: number, r: number, bezel: number): string {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';
  const img = ctx.createImageData(w, h);
  const d = img.data;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const px = x + 0.5 - w / 2;
      const py = y + 0.5 - h / 2;
      const qx = Math.abs(px) - (w / 2 - r);
      const qy = Math.abs(py) - (h / 2 - r);
      const ox = Math.max(qx, 0);
      const oy = Math.max(qy, 0);
      const outside = Math.hypot(ox, oy);
      const depth = -(outside + Math.min(Math.max(qx, qy), 0) - r); // distance inside the edge

      let kx = 0;
      let ky = 0;
      if (depth >= 0 && depth < bezel) {
        let nx: number;
        let ny: number;
        if (outside > 0) {
          nx = (ox / outside) * Math.sign(px);
          ny = (oy / outside) * Math.sign(py);
        } else if (qx > qy) {
          nx = Math.sign(px);
          ny = 0;
        } else {
          nx = 0;
          ny = Math.sign(py);
        }
        const t = 1 - depth / bezel;
        const mag = t * t;
        kx = -nx * mag; // negative = sample from further inside, so we never read outside the bar
        ky = -ny * mag;
      }
      const i = (y * w + x) * 4;
      d[i] = Math.round(255 * (0.5 + 0.5 * kx));
      d[i + 1] = Math.round(255 * (0.5 + 0.5 * ky));
      d[i + 2] = 128;
      d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas.toDataURL();
}

export function useRefraction(
  ref: RefObject<HTMLElement | null> | RefObject<any>,
  enabled: boolean,
  opts: Options = {},
) {
  const { radius = 28, bezel = 18, maxShift = 14, blur = 8, saturate = 1.5 } = opts;

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !enabled || !supportsSvgBackdrop()) return;

    const base = `lg-${Math.random().toString(36).slice(2, 9)}`;
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('width', '0');
    svg.setAttribute('height', '0');
    svg.setAttribute('aria-hidden', 'true');
    svg.style.position = 'absolute';
    svg.style.pointerEvents = 'none';

    const filter = document.createElementNS(NS, 'filter');
    filter.setAttribute('filterUnits', 'userSpaceOnUse');
    filter.setAttribute('color-interpolation-filters', 'sRGB');

    const feImage = document.createElementNS(NS, 'feImage');
    feImage.setAttribute('preserveAspectRatio', 'none');
    feImage.setAttribute('result', 'map');

    const disp = document.createElementNS(NS, 'feDisplacementMap');
    disp.setAttribute('in', 'SourceGraphic');
    disp.setAttribute('in2', 'map');
    disp.setAttribute('scale', String(maxShift * 2));
    disp.setAttribute('xChannelSelector', 'R');
    disp.setAttribute('yChannelSelector', 'G');

    filter.append(feImage, disp);
    svg.append(filter);
    document.body.appendChild(svg);

    const update = () => {
      const w = Math.round(el.offsetWidth);
      const h = Math.round(el.offsetHeight);
      if (!w || !h) return; // hidden (e.g. keyboard open)
      const url = buildMap(w, h, Math.min(radius, h / 2, w / 2), Math.min(bezel, h / 2));
      if (!url) return;
      const id = `${base}-${w}x${h}`; // new id per size forces Chrome to re-resolve the filter
      filter.setAttribute('id', id);
      for (const n of [filter, feImage]) {
        n.setAttribute('x', '0');
        n.setAttribute('y', '0');
        n.setAttribute('width', String(w));
        n.setAttribute('height', String(h));
      }
      feImage.setAttribute('href', url);
      el.style.setProperty(
        'backdrop-filter',
        `blur(${blur}px) url(#${id}) saturate(${saturate})`,
      );
    };

    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);

    return () => {
      ro.disconnect();
      svg.remove();
      el.style.removeProperty('backdrop-filter');
    };
  }, [ref, enabled, radius, bezel, maxShift, blur, saturate]);
}
