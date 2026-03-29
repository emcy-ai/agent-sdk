import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { McpServerStatusBar } from '../McpServerStatusBar';

describe('McpServerStatusBar', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders a sign-out action for connected authenticated servers', () => {
    const onSignOutClick = vi.fn();

    render(
      <McpServerStatusBar
        servers={[{
          url: 'https://todo.example.com',
          name: 'Todo MCP',
          authStatus: 'connected',
          canSignOut: true,
        }]}
        onSignOutClick={onSignOutClick}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Sign Out' }));

    expect(onSignOutClick).toHaveBeenCalledWith(
      'https://todo.example.com',
      'Todo MCP',
    );
  });

  it('keeps connected public servers read-only', () => {
    render(
      <McpServerStatusBar
        servers={[{
          url: 'https://public.example.com',
          name: 'Public MCP',
          authStatus: 'connected',
          canSignOut: false,
        }]}
      />,
    );

    screen.getByText('Connected');
    expect(screen.queryByRole('button', { name: 'Sign Out' })).toBeNull();
  });
});
