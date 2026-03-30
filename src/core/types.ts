// ================================================================
// Client Tools (execute locally in browser, exposed to LLM)
// ================================================================

export interface ClientToolParameter {
  type: string;
  description: string;
  required?: boolean;
  enum?: string[];
}

export interface ClientToolDefinition {
  description: string;
  parameters: Record<string, ClientToolParameter>;
  execute: (params: Record<string, unknown>) => Promise<unknown>;
  requireConfirmation?: boolean;
}

export type ClientToolsMap = Record<string, ClientToolDefinition>;

// ================================================================
// Configuration
// ================================================================

export interface EmcyEmbeddedAuthIdentity {
  subject?: string;
  email?: string;
  organizationId?: string;
  displayName?: string;
}

export interface EmcyEmbeddedAuthConfig {
  hostIdentity?: EmcyEmbeddedAuthIdentity;
  mismatchPolicy: 'block_with_switch';
}

export interface EmcyAgentConfig {
  /** API key for authenticating with the Emcy API */
  apiKey: string;

  /** Agent ID from the Emcy dashboard */
  agentId: string;

  /** Emcy API URL. Defaults to https://api.emcy.ai */
  agentServiceUrl?: string;

  /**
   * Callback URL used by the standalone popup OAuth flow.
   * Defaults to the hosted Emcy callback page so downstream auth servers
   * only need to allow a single redirect URI.
   */
  oauthCallbackUrl?: string;

  /**
   * Public URL for this client's hosted metadata document when using
   * Client ID Metadata Documents (CIMD).
   */
  oauthClientMetadataUrl?: string;

  /**
   * Callback to get the auth token for Emcy API requests.
   * If provided, called before each chat API request.
   * Use this when your session token may expire and needs refresh (e.g., dashboard playground).
   * If not provided, uses the static `apiKey` value.
   */
  getAuthToken?: () => Promise<string | undefined>;

  /**
   * Embedded popup auth settings.
   * Use this to tell Emcy which host-app user is currently signed in so
   * the built-in popup flow can prefer the same downstream account.
   */
  embeddedAuth?: EmcyEmbeddedAuthConfig;

  /**
   * Called when an MCP server requires authentication and the built-in
   * popup flow is not being used. The SDK will invoke this so the
   * integrator can trigger a custom login flow.
   *
   * Return the token response on success, or undefined to cancel.
   * The SDK stores the token and handles refresh automatically.
   */
  onAuthRequired?: (mcpServerUrl: string, authConfig: McpServerAuthConfig) => Promise<OAuthTokenResponse | undefined>;

  /**
   * If true, MCP server calls include cookies (for cookie-based auth).
   * Default: false
   */
  useCookies?: boolean;

  /** Optional: external user ID to associate with conversations */
  externalUserId?: string;

  /** Optional: additional context sent with each message */
  context?: Record<string, unknown>;

  /**
   * Client tools — execute locally in browser, exposed to LLM.
   * The agent can call these to interact with the host app (e.g. fill forms, read page state).
   */
  clientTools?: ClientToolsMap;
}

// ================================================================
// Messages
// ================================================================

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'tool_call' | 'tool_result';
  content: string;
  toolName?: string;
  toolLabel?: string;
  toolCallId?: string;
  timestamp: Date;
  toolCallStatus?: 'calling' | 'completed' | 'error';
  toolCallStartTime?: number;
  toolCallDuration?: number;
  toolResult?: string;
  toolError?: string;
}

// ================================================================
// Agent Config Response (from GET /workspaces/{id}/config)
// ================================================================

export interface McpServerAuthConfig {
  authType: 'none' | 'apiKey' | 'bearer' | 'oauth2';
  issuer?: string;
  authorizationServerUrl?: string;
  authorizationServerMetadataUrl?: string;
  authorizationEndpoint?: string;
  loginUrl?: string;
  tokenEndpoint?: string;
  tokenUrl?: string;
  registrationEndpoint?: string;
  clientId?: string;
  scopes?: string[];
  resource?: string;
  callbackUrl?: string;
  protectedResourceMetadataUrl?: string;
  clientIdMetadataDocumentSupported?: boolean;
  resourceParameterSupported?: boolean;
  registrationPreference?: McpClientRegistrationPreference;
  clientMode?: McpResolvedClientMode;
  authRecipe?: McpAuthRecipe;
  manualOverrides?: string[];
  discovered?: boolean;
}

export type McpAuthRecipe =
  | 'sqlos'
  | 'auth0'
  | 'entra'
  | 'workos'
  | 'manual';

export type McpClientRegistrationPreference =
  | 'auto'
  | 'preregistered'
  | 'cimd'
  | 'dcr'
  | 'manual';

export type McpResolvedClientMode =
  | 'preregistered'
  | 'cimd'
  | 'dcr'
  | 'manual';

export interface ProtectedResourceMetadata {
  resource?: string;
  authorization_servers?: string[];
  authorization_server?: string;
  scopes_supported?: string[];
  bearer_methods_supported?: string[];
  resource_documentation?: string;
}

export interface AuthorizationServerMetadata {
  issuer?: string;
  authorization_endpoint?: string;
  token_endpoint?: string;
  registration_endpoint?: string;
  scopes_supported?: string[];
  code_challenge_methods_supported?: string[];
  response_types_supported?: string[];
  token_endpoint_auth_methods_supported?: string[];
  grant_types_supported?: string[];
  client_id_metadata_document_supported?: boolean;
  resource_parameter_supported?: boolean;
}

export interface OAuthDynamicClientRegistrationRequest {
  client_name: string;
  application_type: 'web';
  redirect_uris: string[];
  grant_types: string[];
  response_types: string[];
  token_endpoint_auth_method: 'none';
  scope?: string;
  client_uri?: string;
  logo_uri?: string;
  policy_uri?: string;
  tos_uri?: string;
}

export interface OAuthDynamicClientRegistrationResponse {
  client_id: string;
  client_name?: string;
  redirect_uris?: string[];
  grant_types?: string[];
  response_types?: string[];
  token_endpoint_auth_method?: string;
  client_id_issued_at?: number;
  [key: string]: unknown;
}

export interface StoredOAuthRegistration {
  key: string;
  mode: McpResolvedClientMode;
  authorizationServerUrl: string;
  authorizationServerMetadataUrl?: string;
  registrationEndpoint?: string;
  clientId: string;
  callbackUrl: string;
  resource?: string;
  clientMetadataUrl?: string;
  createdAt: number;
  updatedAt: number;
}

export interface ResolvedOAuthRegistration {
  cacheKey: string;
  mode: McpResolvedClientMode;
  clientId?: string;
  callbackUrl: string;
  resource?: string;
  authorizationServerUrl?: string;
  authorizationServerMetadataUrl?: string;
  registrationEndpoint?: string;
  clientMetadataUrl?: string;
}

/** OAuth token response from token endpoint */
export interface OAuthTokenResponse {
  accessToken: string;
  refreshToken?: string;
  expiresIn?: number;
  tokenType?: string;
  resolvedAuthConfig?: McpServerAuthConfig;
}

export interface McpServerInfo {
  id: string;
  name: string;
  url: string;
  authStatus: 'connected' | 'needs_auth';
  authConfig?: McpServerAuthConfig | null;
}

export interface AgentConfigResponse {
  workspaceId: string;
  name: string;
  /** @deprecated Use mcpServers instead */
  mcpServerUrl?: string;
  mcpServers: McpServerInfo[];
  widgetConfig?: WidgetConfig | null;
}

export interface WidgetConfig {
  theme?: string;
  position?: string;
  title?: string;
  placeholder?: string;
  welcomeMessage?: string;
}

// ================================================================
// SSE Events (from the chat API)
// ================================================================

export interface SseMessageStart {
  conversationId: string;
}

export interface SseContentDelta {
  text: string;
}

export interface SseToolCall {
  toolCallId: string;
  toolName: string;
  toolLabel?: string;
  arguments: Record<string, unknown>;
  mcpServerUrl?: string;
  mcpServerName?: string;
  /** When 'client', execute locally via clientTools; when 'mcp' or absent with mcpServerUrl, use MCP */
  source?: 'client' | 'mcp';
}

export interface SseMessageEnd {
  inputTokens: number;
  outputTokens: number;
  toolCalls: number;
}

export interface SseError {
  code: string;
  message: string;
}

// ================================================================
// Events emitted by EmcyAgent
// ================================================================

export interface McpAuthStatusEvent {
  mcpServerUrl: string;
  mcpServerName: string;
  authStatus: 'connected' | 'needs_auth';
}

export type EmcyAgentEventMap = {
  message: ChatMessage;
  content_delta: SseContentDelta;
  tool_call: SseToolCall;
  tool_result: { toolCallId: string; result: unknown; duration: number };
  tool_error: { toolCallId: string; error: string; duration: number };
  message_end: SseMessageEnd;
  error: SseError;
  loading: boolean;
  thinking: boolean;
  mcp_auth_status: McpAuthStatusEvent;
};

export type EmcyAgentEvent = keyof EmcyAgentEventMap;
