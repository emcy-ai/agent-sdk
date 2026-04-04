import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChatWindow } from '../ChatWindow';
import * as styles from '../styles';

describe('ChatWindow', () => {
  afterEach(() => {
    cleanup();
  });

  it('shows a blocking workspace auth error when config loading fails', () => {
    render(
      <ChatWindow
        messages={[]}
        streamingContent=""
        isLoading={false}
        error={{
          code: 'workspace_config_auth_error',
          message: 'Invalid or expired API key',
        }}
        onSend={vi.fn()}
        variant="inline"
      />,
    );

    screen.getByText('Embedded workspace authentication failed');
    screen.getByText('Invalid or expired API key');
    screen.getByText('Update the API key for this embedded workspace and reload the page.');
    expect(screen.queryByText('How can I help you today?')).toBeNull();
    expect(screen.getByRole('textbox')).toHaveProperty('disabled', true);
  });

  it('keeps the inline message list shrinkable so scrolling stays inside the chat body', () => {
    expect(styles.messageList.minHeight).toBe(0);
    expect(styles.messageList.overscrollBehavior).toBe('contain');
  });
});
