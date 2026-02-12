import { useEffect, useState } from 'react';
import { getAspectRatioCSS, measureImageDimensions } from '../utils/aspectRatio';

const MAX_RATIO_CACHE = 200;
const ratioCache = new Map<string, string>();

function setCachedRatio(key: string, value: string): void {
  if (ratioCache.size >= MAX_RATIO_CACHE) {
    const firstKey = ratioCache.keys().next().value;
    if (firstKey !== undefined) ratioCache.delete(firstKey);
  }
  ratioCache.set(key, value);
}

/** 获取图片的 aspect-ratio CSS 值：优先用 params，auto 时测量并缓存 */
export function useAspectRatio(
  id: string,
  src: string,
  paramsRatio?: string
): string | undefined {
  const known = getAspectRatioCSS(paramsRatio);
  const [measured, setMeasured] = useState<string | undefined>(() => {
    if (known) return known;
    return ratioCache.get(id);
  });

  useEffect(() => {
    if (known) {
      setMeasured(known);
      return;
    }
    const cached = ratioCache.get(id);
    if (cached) {
      setMeasured(cached);
      return;
    }
    let cancelled = false;
    measureImageDimensions(src)
      .then(({ width, height }) => {
        if (cancelled) return;
        const css = `${width} / ${height}`;
        setCachedRatio(id, css);
        setMeasured(css);
      })
      .catch(() => {
        if (!cancelled) setMeasured('1 / 1');
      });
    return () => {
      cancelled = true;
    };
  }, [id, src, known]);

  return measured;
}
