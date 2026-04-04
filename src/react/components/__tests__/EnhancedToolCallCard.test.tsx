import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { EnhancedToolCallCard } from '../EnhancedToolCallCard';

describe('EnhancedToolCallCard', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders shadcn-style completion metadata and expands formatted result output', () => {
    render(
      <EnhancedToolCallCard
        toolName="PostApiTodos"
        toolCallId="tool_123456789"
        status="completed"
        startTime={Date.now() - 250}
        duration={250}
        result='{"ok":true,"items":["bath","pajamas"]}'
      />,
    );

    screen.getByText('Tool call');
    screen.getByText('Completed');
    screen.getByText('#tool_123');
    screen.getByText('Completed in 0.3s');

    fireEvent.click(screen.getByRole('button', { name: /show result/i }));

    screen.getByText('Tool output');
    screen.getByText(/"ok": true/);
    screen.getByText(/"bath"/);
  });
});
