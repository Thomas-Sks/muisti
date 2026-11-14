import { useCallback, useRef, useState } from "react";

/** Width of an element, tracked with a ResizeObserver. A callback ref, so it also works when the
 *  element is rendered later than the component that owns the hook (e.g. after data loads). */
export function useWidth<T extends HTMLElement>(initial = 640) {
  const [width, setWidth] = useState(initial);
  const observer = useRef<ResizeObserver | null>(null);
  const ref = useCallback((el: T | null) => {
    observer.current?.disconnect();
    observer.current = null;
    if (!el) return;
    setWidth(Math.max(280, Math.floor(el.getBoundingClientRect().width)));
    observer.current = new ResizeObserver(([e]) => setWidth(Math.max(280, Math.floor(e.contentRect.width))));
    observer.current.observe(el);
  }, []);
  return [ref, width] as const;
}
