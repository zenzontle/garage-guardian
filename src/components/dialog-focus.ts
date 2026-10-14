'use client';

import { useEffect, type RefObject } from 'react';

const layers: HTMLElement[] = [];
const originalInert = new Map<HTMLElement, boolean>();
let originalOverflow = '';
let observer: MutationObserver | null = null;

function updateLayers() {
  const top = layers[layers.length - 1];
  for (const child of document.body.children) {
    const node = child as HTMLElement;
    if (!originalInert.has(node)) originalInert.set(node, Boolean(node.inert));
    node.inert = top ? node !== top : originalInert.get(node)!;
  }
  if (!top) {
    document.body.style.overflow = originalOverflow;
    originalInert.clear();
    observer?.disconnect();
    observer = null;
  }
}

export function isTopDialog(element: HTMLElement | null) {
  const dialogs = document.querySelectorAll('[role="dialog"], [role="alertdialog"]');
  return dialogs[dialogs.length - 1] === element;
}

export function useDialogFocus(
  ref: RefObject<HTMLDivElement | null>,
  active = true,
  selector = 'button:not(:disabled)',
  fallback?: string,
) {
  useEffect(() => {
    const dialog = ref.current;
    if (!active || !dialog) return;
    const previous = document.activeElement as HTMLElement | null;
    const root = dialog.closest<HTMLElement>('.modal-backdrop')!;
    if (!layers.length) {
      originalOverflow = document.body.style.overflow;
      observer = new MutationObserver(updateLayers);
      observer.observe(document.body, { childList: true });
    }
    layers.push(root);
    document.body.style.overflow = 'hidden';
    updateLayers();
    (dialog.querySelector<HTMLElement>(selector) ?? dialog).focus();
    return () => {
      layers.splice(layers.indexOf(root), 1);
      updateLayers();
      const top = layers[layers.length - 1];
      const target = previous?.isConnected
        ? previous
        : fallback
          ? document.querySelector<HTMLElement>(fallback)
          : null;
      if (target && (!top || top.contains(target))) target.focus();
    };
  }, [ref, active, selector, fallback]);
}
