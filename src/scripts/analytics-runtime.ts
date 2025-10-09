type AnalyticsProps = import('../lib/analytics').AnalyticsProps;

const setupAnalyticsDelegation = () => {
  document.addEventListener(
    'click',
    (e) => {
      const el = (e.target as HTMLElement | null)?.closest('[data-analytics]') as
        | HTMLElement
        | null;
      if (!el) {
        return;
      }
      const name = el.getAttribute('data-analytics');
      if (!name) {
        return;
      }
      const raw = el.getAttribute('data-analytics-payload');
      let props: AnalyticsProps | undefined;
      try {
        props = raw ? (JSON.parse(raw) as AnalyticsProps) : undefined;
      } catch {
        props = undefined;
      }
      void import('../lib/analytics').then((module) => {
        module.send(name, props);
      });
    },
    { capture: true },
  );
};

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setupAnalyticsDelegation, {
      once: true,
    });
  } else {
    setupAnalyticsDelegation();
  }
}
