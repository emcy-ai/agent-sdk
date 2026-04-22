import React, { createContext, useContext } from 'react';
import type { AppAgentConfig } from '../app/types';
import {
  useAppAgentBinding,
  type UseAppAgentOptions,
  type UseAppAgentReturn,
} from '../framework/useAppAgentBinding';

const AppAgentContext = createContext<UseAppAgentReturn | null>(null);

export interface AppAgentProviderProps extends AppAgentConfig {
  children: React.ReactNode;
}

export function useAppAgent(
  config: AppAgentConfig,
  options?: UseAppAgentOptions,
): UseAppAgentReturn {
  return useAppAgentBinding(config, options);
}

export function AppAgentProvider({
  children,
  ...config
}: AppAgentProviderProps) {
  const value = useAppAgent(config);
  return (
    <AppAgentContext.Provider value={value}>
      {children}
    </AppAgentContext.Provider>
  );
}

export function useAppAgentContext(): UseAppAgentReturn {
  const context = useContext(AppAgentContext);
  if (!context) {
    throw new Error('useAppAgentContext must be used within an AppAgentProvider.');
  }

  return context;
}

export type {
  UseAppAgentOptions,
  UseAppAgentReturn,
};
