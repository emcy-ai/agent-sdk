import React from 'react';
import { colors } from './styles';

export function ThinkingIndicator() {
  return (
    <div
      className="emcy-fadeInUp"
      style={{
        maxWidth: '80%',
        padding: '12px 16px',
        borderRadius: '16px 16px 16px 4px',
        backgroundColor: colors.assistantBubble,
        alignSelf: 'flex-start',
        display: 'flex',
        alignItems: 'center',
        gap: 4,
      }}
    >
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          style={{
            display: 'inline-block',
            width: 7,
            height: 7,
            borderRadius: '50%',
            backgroundColor: colors.textSecondary,
            animation: 'emcy-pulse 1.4s infinite',
            animationDelay: `${i * 0.2}s`,
          }}
        />
      ))}
    </div>
  );
}
