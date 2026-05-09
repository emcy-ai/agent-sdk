import React, { useRef, useState } from 'react';
import * as styles from './styles';
import { MicIcon, SendIcon, StopIcon } from './Icons';
import type { AudioInputState } from '../../core/types';

export interface InputAreaProps {
  onSend: (message: string) => void;
  disabled?: boolean;
  placeholder?: string;
  voice?: AudioInputState & {
    onStart: () => void;
    onStop: () => void;
    onCancel: () => void;
  };
}

export function InputArea({ onSend, disabled, placeholder = 'Type a message...', voice }: InputAreaProps) {
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
      textareaRef.current.focus();
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
  const voiceActive = voice?.status === 'listening' || voice?.status === 'transcribing';
  const voiceBusy = Boolean(
    voice
    && ['requesting_permission', 'connecting', 'sending'].includes(voice.status),
  );
  const canUseVoice = Boolean(
    voice
    && voice.isSupported
    && voice.isEnabled
    && !disabled
    && !voiceBusy,
  );
  const transcriptPreview = voice?.partialTranscript || (
    voiceActive ? voice?.transcript : ''
  );

  return (
    <>
      {voice && (transcriptPreview || voice.error) ? (
        <div style={styles.transcriptPreview}>
          {voice.error ? voice.error.message : transcriptPreview}
        </div>
      ) : null}
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
        {voice ? (
          <button
            style={
              voiceActive
                ? styles.micButtonActive
                : canUseVoice
                  ? styles.micButton
                  : styles.micButtonDisabled
            }
            onClick={voiceActive ? voice.onStop : voice.onStart}
            disabled={!canUseVoice && !voiceActive}
            type="button"
            aria-label={voiceActive ? 'Stop voice input' : 'Start voice input'}
            title={voiceActive ? 'Stop voice input' : 'Start voice input'}
          >
            {voiceActive ? (
              <StopIcon size={16} color={styles.colors.errorText} />
            ) : (
              <MicIcon size={16} color={styles.colors.textSecondary} />
            )}
          </button>
        ) : null}
        <button
          style={canSend ? styles.sendButton : styles.sendButtonDisabled}
          onClick={handleSend}
          disabled={!canSend}
          type="button"
          aria-label="Send message"
        >
          <SendIcon size={16} color="#fff" />
        </button>
      </div>
    </>
  );
}
