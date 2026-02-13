import React from 'react';
import * as styles from './styles';
import { ChatBubbleIcon, CloseIcon } from './Icons';

export interface WidgetButtonProps {
  isOpen: boolean;
  onClick: () => void;
}

/**
 * Floating action button that toggles the chat window.
 */
export function WidgetButton({ isOpen, onClick }: WidgetButtonProps) {
  return (
    <button
      style={styles.widgetButton}
      onClick={onClick}
      type="button"
      aria-label={isOpen ? 'Close chat' : 'Open chat'}
    >
      {isOpen ? <CloseIcon size={24} color="#fff" /> : <ChatBubbleIcon size={24} color="#fff" />}
    </button>
  );
}
