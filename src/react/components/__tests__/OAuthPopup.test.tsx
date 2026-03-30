import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OAuthPopup } from '../OAuthPopup';

describe('OAuthPopup', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('renders the host-account prompt with a primary action', () => {
    render(
      <OAuthPopup
        serverName="Todo MCP"
        serverUrl="https://todo.example.com"
        phase="prompt"
        hostIdentityLabel="alex@todo.local"
        onPrimaryAction={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText('Sign in to Todo MCP')).toBeDefined();
    expect(screen.getByText('Current account: alex@todo.local')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Start AI with your account' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDefined();
  });

  it('renders waiting status without a retry button', () => {
    render(
      <OAuthPopup
        serverName="Todo MCP"
        serverUrl="https://todo.example.com"
        phase="waiting"
        statusMessage="Finish sign in in the popup window to connect your account."
        onPrimaryAction={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Sign In' })).toBeNull();
    expect(screen.getByText('Finish sign in in the popup window to connect your account.')).toBeDefined();
  });

  it('renders retry affordances for blocked popups and shows the error message', () => {
    render(
      <OAuthPopup
        serverName="Todo MCP"
        serverUrl="https://todo.example.com"
        phase="blocked"
        errorMessage="Your browser blocked the sign-in popup. Allow popups and try again."
        onPrimaryAction={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: 'Retry' })).toBeDefined();
    expect(screen.getByText('Your browser blocked the sign-in popup. Allow popups and try again.')).toBeDefined();
  });

  it('invokes the close handler when cancel is clicked', () => {
    const onClose = vi.fn();

    render(
      <OAuthPopup
        serverName="Todo MCP"
        serverUrl="https://todo.example.com"
        phase="error"
        errorMessage="Token exchange failed."
        onPrimaryAction={vi.fn()}
        onClose={onClose}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
