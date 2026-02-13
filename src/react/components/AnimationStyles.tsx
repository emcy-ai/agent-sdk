import React, { useEffect } from 'react';

const STYLE_ID = 'emcy-agent-styles';

const keyframes = `
@keyframes emcy-fadeInUp {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: translateY(0); }
}
@keyframes emcy-fadeInScale {
  from { opacity: 0; transform: scale(0.95) translateY(12px); }
  to { opacity: 1; transform: scale(1) translateY(0); }
}
@keyframes emcy-fadeOut {
  from { opacity: 1; transform: scale(1); }
  to { opacity: 0; transform: scale(0.95) translateY(12px); }
}
@keyframes emcy-pulse {
  0%, 80%, 100% { opacity: 0.3; transform: scale(0.8); }
  40% { opacity: 1; transform: scale(1); }
}
@keyframes emcy-spin {
  to { transform: rotate(360deg); }
}
@keyframes emcy-progressIndeterminate {
  0% { left: -30%; }
  100% { left: 100%; }
}
@keyframes emcy-blink {
  0%, 100% { opacity: 1; }
  50% { opacity: 0; }
}
@keyframes emcy-checkmark {
  0% { stroke-dashoffset: 24; }
  100% { stroke-dashoffset: 0; }
}
@keyframes emcy-slideDown {
  from { max-height: 0; opacity: 0; padding-top: 0; padding-bottom: 0; }
  to { max-height: 300px; opacity: 1; }
}

.emcy-fadeInUp {
  animation: emcy-fadeInUp 0.25s ease-out both;
}
.emcy-fadeInScale {
  animation: emcy-fadeInScale 0.3s ease-out both;
}
.emcy-fadeOut {
  animation: emcy-fadeOut 0.2s ease-in both;
}
.emcy-spin {
  animation: emcy-spin 1s linear infinite;
}
.emcy-blink {
  animation: emcy-blink 1s step-end infinite;
}
`;

/**
 * Injects a <style> tag with all Emcy animation keyframes into <head>.
 * Idempotent — safe to render multiple times. SSR-safe.
 */
export function StyleInjector() {
  useEffect(() => {
    if (typeof document === 'undefined') return;
    if (document.getElementById(STYLE_ID)) return;

    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = keyframes;
    document.head.appendChild(style);

    return () => {
      const existing = document.getElementById(STYLE_ID);
      if (existing) existing.remove();
    };
  }, []);

  return null;
}
