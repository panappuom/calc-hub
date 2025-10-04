const DEFAULT_PROVIDER = 'none';
const DEFAULT_SCRIPT_SRC = 'https://plausible.io/js/script.js';

const provider = (import.meta.env.PUBLIC_ANALYTICS_PROVIDER ?? DEFAULT_PROVIDER).toLowerCase();
const domain = (import.meta.env.PUBLIC_ANALYTICS_DOMAIN ?? '').trim();
const scriptSrc = (import.meta.env.PUBLIC_ANALYTICS_SRC ?? DEFAULT_SCRIPT_SRC).trim() || DEFAULT_SCRIPT_SRC;

export type AnalyticsProps = Record<string, string | number | boolean>;

export function getAnalyticsScriptConfig() {
  if (provider !== 'plausible') {
    return null;
  }
  if (!domain) {
    return null;
  }
  return {
    src: scriptSrc,
    domain,
  };
}

export function isAnalyticsEnabled() {
  return provider === 'plausible' && Boolean(domain);
}

export function send(eventName: string, props?: AnalyticsProps) {
  if (!eventName || typeof eventName !== 'string') {
    return;
  }
  if (provider !== 'plausible') {
    return;
  }
  if (typeof window === 'undefined') {
    return;
  }
  try {
    const plausible = window.plausible;
    if (typeof plausible !== 'function') {
      return;
    }
    plausible(eventName, props ? { props } : undefined);
  } catch (error) {
    if (import.meta.env.DEV) {
      console.warn('[analytics] failed to send event', error);
    }
  }
}

declare global {
  interface Window {
    plausible?: (eventName: string, options?: { props?: AnalyticsProps }) => void;
  }
}

export default {
  getAnalyticsScriptConfig,
  isAnalyticsEnabled,
  send,
};
