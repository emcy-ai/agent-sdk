import React from 'react';

export function StreamingCursor() {
  return (
    <span
      className="emcy-blink"
      style={{
        display: 'inline-block',
        width: 2,
        height: 16,
        backgroundColor: '#6366f1',
        marginLeft: 2,
        verticalAlign: 'text-bottom',
        borderRadius: 1,
      }}
    />
  );
}
