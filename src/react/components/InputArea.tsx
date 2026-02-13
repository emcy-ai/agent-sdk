import React, { useRef, useState } from 'react';
import * as styles from './styles';
import { SendIcon } from './Icons';

export interface InputAreaProps {
  onSend: (message: string) => void;
  disabled?: boolean;
  placeholder?: string;
}

export function InputArea({ onSend, disabled, placeholder = 'Type a message...' }: InputAreaProps) {
  const [value, setValue] = useState('');
  const [focused, setFocused] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSend = () => {
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setValue('');
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleInput = () => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = 'auto';
      textarea.style.height = `${Math.min(textarea.scrollHeight, 120)}px`;
    }
  };

  const canSend = !disabled && value.trim().length > 0;

  return (
    <div style={styles.inputArea}>
      <textarea
        ref={textareaRef}
        style={{
          ...styles.textInput,
          borderColor: focused ? styles.colors.primary : styles.colors.border,
          transition: 'border-color 0.2s',
        }}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        onInput={handleInput}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        placeholder={placeholder}
        disabled={disabled}
        rows={1}
      />
      <button
        style={{
          ...(canSend ? styles.sendButton : styles.sendButtonDisabled),
          padding: '10px 12px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
        onClick={handleSend}
        disabled={!canSend}
        type="button"
        aria-label="Send message"
      >
        <SendIcon size={16} color="#fff" />
      </button>
    </div>
  );
}
