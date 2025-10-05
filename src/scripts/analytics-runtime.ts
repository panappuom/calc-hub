import { send, type AnalyticsProps } from '../lib/analytics';

const ANALYTICS_SELECTOR = '[data-analytics]';

const parsePayload = (value: string | null): AnalyticsProps | undefined => {
  if (!value) {
    return undefined;
  }
  try {
    return JSON.parse(value) as AnalyticsProps;
  } catch {
    return undefined;
  }
};

const attach = (element: Element | null) => {
  if (!element || !(element instanceof HTMLElement)) {
    return;
  }
  if (element.dataset.analyticsBound === '1') {
    return;
  }
  element.addEventListener('click', () => {
    const eventName = element.dataset.analytics;
    if (!eventName) {
      return;
    }
    const payload = parsePayload(element.getAttribute('data-analytics-payload'));
    send(eventName, payload);
  });
  element.dataset.analyticsBound = '1';
};

const attachAll = (root: ParentNode) => {
  const elements = root.querySelectorAll(ANALYTICS_SELECTOR);
  elements.forEach((element) => attach(element));
};

const handleAddedNode = (node: Node) => {
  if (node instanceof Element) {
    if (node.matches(ANALYTICS_SELECTOR)) {
      attach(node);
    }
    attachAll(node);
    return;
  }
  if (node instanceof DocumentFragment) {
    attachAll(node);
  }
};

const observeMutations = () => {
  if (typeof MutationObserver === 'undefined') {
    return;
  }
  const body = document.body;
  if (!body) {
    return;
  }
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      mutation.addedNodes.forEach((node) => handleAddedNode(node));
    }
  });
  observer.observe(body, { childList: true, subtree: true });
};

const init = () => {
  attachAll(document);
  observeMutations();
};

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
}
