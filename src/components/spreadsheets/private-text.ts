import { PRIVATE_TEXT_ATTRIBUTES } from '@/lib/app';

export const EDITABLE_SELECTOR = 'input, textarea, [contenteditable]';

export function applyPrivateText(element: Element): void {
  for (const [name, value] of Object.entries(PRIVATE_TEXT_ATTRIBUTES)) {
    if (element.getAttribute(name) !== value) {
      element.setAttribute(name, value);
    }
  }
}

function applyWithin(node: Node): void {
  if (!(node instanceof Element)) {
    return;
  }
  if (node.matches(EDITABLE_SELECTOR)) {
    applyPrivateText(node);
  }
  node.querySelectorAll(EDITABLE_SELECTOR).forEach(applyPrivateText);
}

export function guardPrivateText(root: Element): () => void {
  applyWithin(root);
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      if (record.type === 'attributes') {
        applyWithin(record.target);
        continue;
      }
      record.addedNodes.forEach(applyWithin);
    }
  });
  observer.observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ['contenteditable'] });
  return () => observer.disconnect();
}
