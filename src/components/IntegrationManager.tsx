import React, { useState, useEffect } from 'react';
import {
  Mail,
  Calendar,
  HardDrive,
  Webhook,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
  Shield,
  RefreshCw,
  LogOut,
  ChevronDown,
  ChevronRight,
  Key,
  ShieldCheck,
  Terminal,
  Activity,
  Lock,
  Plus,
  Trash2,
  UserCheck,
  AlertTriangle
} from 'lucide-react';
import { ConnectorInfo, RegisteredWebhook, UserProfile } from '../types/chat';
import {
  getConnectors,
  getOAuthState,
  connectConnector,
  connectAllGoogle,
  disconnectConnector,
  connectApiKey,
  getWebhooks,
  createWebhook,
  deleteWebhook,
  getCurrentUser,
  registerUser,
  loginUser,
  createGuestSession,
  logoutUser
} from '../services/api';
import { signInWithGoogleWorkspace, WORKSPACE_SCOPES } from '../services/firebaseAuth';

interface IntegrationManagerProps {
  onClose?: () => void;
  onSelectPrompt?: (prompt: string) => void;
}

export const IntegrationManager: React.FC<IntegrationManagerProps> = ({
  onSelectPrompt
}) => {
  const [connectors, setConnectors] = useState<ConnectorInfo[]>([]);
  const [googleClientId, setGoogleClientId] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [actionInProgress, setActionInProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // User auth state
  const [currentUser, setCurrentUser] = useState<UserProfile | null>(null);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authName, setAuthName] = useState('');

  // Manual token & API key drawers
  const [manualTokenConnector, setManualTokenConnector] = useState<string | null>(null);
  const [manualTokenInput, setManualTokenInput] = useState('');
  const [apiKeyConnector, setApiKeyConnector] = useState<string | null>(null);
  const [apiKeyInput, setApiKeyInput] = useState('');

  // Webhooks management
  const [webhooks, setWebhooks] = useState<RegisteredWebhook[]>([]);
  const [isAddingWebhook, setIsAddingWebhook] = useState(false);
  const [newWebhookName, setNewWebhookName] = useState('');
  const [newWebhookUrl, setNewWebhookUrl] = useState('');
  const [newWebhookEnv, setNewWebhookEnv] = useState<'staging' | 'production'>('staging');

  // Expanded details for tool inspection
  const [expandedConnector, setExpandedConnector] = useState<string | null>('gmail');

  const fetchProfileAndIntegrations = async () => {
    try {
      setLoading(true);
      // Ensure session exists
      try {
        const profile = await getCurrentUser();
        setCurrentUser(profile.user);
      } catch {
        // Create guest session if none exists
        const guest = await createGuestSession();
        setCurrentUser(guest.user);
      }

      const data = await getConnectors();
      setConnectors(data.connectors);
      if (data.googleClientId) {
        setGoogleClientId(data.googleClientId);
      }

      // Fetch user's registered webhooks
      try {
        const whData = await getWebhooks();
        setWebhooks(whData.webhooks);
      } catch {
        // Ignore
      }

      setError(null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load integrations');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchProfileAndIntegrations();
  }, []);

  // Connect Google OAuth 2.0 Integration via Firebase Auth popup or Google Identity Services
  const handleConnectOAuth = async (connector: ConnectorInfo) => {
    setError(null);
    setSuccessMsg(null);
    setActionInProgress(connector.id);

    try {
      // 1. Fetch CSRF state from server for this user
      const state = await getOAuthState(connector.id);

      // 2. Primary OAuth provider: Firebase Google Auth popup
      try {
        const { user, accessToken } = await signInWithGoogleWorkspace(connector.requiredScopes);
        const res = await connectConnector({
          connectorId: connector.id,
          accessToken,
          state,
          scopes: connector.requiredScopes
        });

        setSuccessMsg(`Successfully connected ${connector.name} (${res.accountEmail || user.email || 'Authorized'})!`);
        await fetchProfileAndIntegrations();
        return;
      } catch (authErr: any) {
        const errMessage = authErr?.message || '';
        if (errMessage.includes('popup-closed-by-user') || errMessage.includes('cancelled')) {
          setError('Authorization was cancelled.');
          return;
        }
        console.warn('Firebase popup attempt failed, falling back to manual entry:', authErr);
      }

      // Fallback: Open manual token entry drawer
      setManualTokenConnector(connector.id);
      setError('Google authorization popup could not be completed. You can paste an access token below.');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'OAuth connection request failed');
    } finally {
      setActionInProgress(null);
    }
  };

  // Connect all Google Workspace integrations in one shot
  const handleConnectAllGoogleSuite = async () => {
    setError(null);
    setSuccessMsg(null);
    setActionInProgress('google_all');

    try {
      const { user, accessToken } = await signInWithGoogleWorkspace(WORKSPACE_SCOPES);
      const res = await connectAllGoogle({
        accessToken,
        scopes: WORKSPACE_SCOPES
      });

      setSuccessMsg(`Successfully connected Google Workspace (${res.accountEmail || user.email || 'Authorized'})!`);
      await fetchProfileAndIntegrations();
    } catch (err: any) {
      const msg = err?.message || 'Failed to connect Google Workspace';
      if (!msg.includes('popup-closed-by-user')) {
        setError(msg);
      }
    } finally {
      setActionInProgress(null);
    }
  };

  // Disconnect Integration & Revoke Server-side Credentials
  const handleDisconnect = async (connectorId: string) => {
    if (!window.confirm(`Are you sure you want to disconnect ${connectorId}? The server will revoke and purge stored credentials.`)) {
      return;
    }

    setError(null);
    setSuccessMsg(null);
    setActionInProgress(connectorId);

    try {
      await disconnectConnector(connectorId);
      setSuccessMsg(`Integration disconnected and authorization revoked.`);
      await fetchProfileAndIntegrations();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to disconnect integration');
    } finally {
      setActionInProgress(null);
    }
  };

  // Submit manual token
  const handleManualTokenSubmit = async (e: React.FormEvent, connectorId: string) => {
    e.preventDefault();
    if (!manualTokenInput.trim()) return;

    setActionInProgress(connectorId);
    setError(null);
    try {
      const state = await getOAuthState(connectorId);
      const res = await connectConnector({
        connectorId,
        accessToken: manualTokenInput.trim(),
        state
      });

      setSuccessMsg(`Connected ${connectorId} (${res.accountEmail || 'Authorized'})`);
      setManualTokenConnector(null);
      setManualTokenInput('');
      await fetchProfileAndIntegrations();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Invalid access token provided.');
    } finally {
      setActionInProgress(null);
    }
  };

  // Submit API Key for third-party integrations
  const handleApiKeySubmit = async (e: React.FormEvent, connectorId: string) => {
    e.preventDefault();
    if (!apiKeyInput.trim()) return;

    setActionInProgress(connectorId);
    setError(null);
    try {
      const res = await connectApiKey({
        connectorId,
        apiKey: apiKeyInput.trim()
      });

      setSuccessMsg(`Saved API Key for ${connectorId} (${res.maskedKey})`);
      setApiKeyConnector(null);
      setApiKeyInput('');
      await fetchProfileAndIntegrations();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to save API Key.');
    } finally {
      setActionInProgress(null);
    }
  };

  // Create new user webhook
  const handleCreateWebhook = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newWebhookName.trim() || !newWebhookUrl.trim()) return;

    setError(null);
    try {
      await createWebhook({
        name: newWebhookName.trim(),
        targetUrl: newWebhookUrl.trim(),
        environment: newWebhookEnv
      });
      setSuccessMsg(`Registered webhook "${newWebhookName}" successfully.`);
      setNewWebhookName('');
      setNewWebhookUrl('');
      setIsAddingWebhook(false);
      const whData = await getWebhooks();
      setWebhooks(whData.webhooks);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to register webhook.');
    }
  };

  // Delete user webhook
  const handleDeleteWebhook = async (id: string) => {
    try {
      await deleteWebhook(id);
      setWebhooks((prev) => prev.filter((w) => w.id !== id));
      setSuccessMsg('Webhook removed.');
    } catch (err: unknown) {
      setError('Failed to delete webhook.');
    }
  };

  // Handle User Auth Form Submit
  const handleAuthSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      if (authMode === 'register') {
        const res = await registerUser({
          email: authEmail,
          password: authPassword,
          displayName: authName
        });
        setCurrentUser(res.user);
        setSuccessMsg(`Registered and logged in as ${res.user.email}!`);
      } else {
        const res = await loginUser({
          email: authEmail,
          password: authPassword
        });
        setCurrentUser(res.user);
        setSuccessMsg(`Logged in as ${res.user.email}!`);
      }
      setIsAuthModalOpen(false);
      setAuthPassword('');
      await fetchProfileAndIntegrations();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Authentication failed.');
    }
  };

  const getConnectorIcon = (id: string) => {
    switch (id) {
      case 'gmail':
        return <Mail className="w-5 h-5 text-red-400" />;
      case 'google_calendar':
        return <Calendar className="w-5 h-5 text-blue-400" />;
      case 'google_drive':
        return <HardDrive className="w-5 h-5 text-emerald-400" />;
      case 'webhook':
        return <Webhook className="w-5 h-5 text-amber-400" />;
      default:
        return <Activity className="w-5 h-5 text-indigo-400" />;
    }
  };

  const getSuggestedPrompt = (id: string) => {
    switch (id) {
      case 'gmail':
        return 'How many unread emails do I have?';
      case 'google_calendar':
        return 'What events are on my calendar today?';
      case 'google_drive':
        return 'Search Drive for quarterly presentation';
      case 'webhook':
        return 'Trigger staging deployment webhook';
      default:
        return '';
    }
  };

  return (
    <div className="space-y-4">
      {/* User Session Banner (Multi-Tenant Identity) */}
      <div className="p-3.5 rounded-xl bg-slate-900 border border-slate-800 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400 shrink-0">
            <UserCheck className="w-4 h-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-white">
                {currentUser?.email || currentUser?.displayName || 'Active Session'}
              </span>
              {currentUser?.isAnonymous ? (
                <span className="px-1.5 py-0.2 rounded text-[10px] font-mono bg-amber-950 text-amber-400 border border-amber-800/60">
                  Guest Session
                </span>
              ) : (
                <span className="px-1.5 py-0.2 rounded text-[10px] font-mono bg-emerald-950 text-emerald-400 border border-emerald-800/60">
                  Authenticated User
                </span>
              )}
            </div>
            <p className="text-[11px] text-slate-400 mt-0.5">
              Integrations and OAuth tokens are strictly isolated to your user ID ({currentUser?.id?.slice(0, 14)}...).
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
          {currentUser?.isAnonymous ? (
            <button
              onClick={() => {
                setAuthMode('login');
                setIsAuthModalOpen(true);
              }}
              className="px-2.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-sm transition-colors cursor-pointer"
            >
              Sign In / Register
            </button>
          ) : (
            <button
              onClick={() => {
                logoutUser();
                fetchProfileAndIntegrations();
              }}
              className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium transition-colors cursor-pointer"
            >
              Log Out
            </button>
          )}
          <button
            onClick={fetchProfileAndIntegrations}
            disabled={loading}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
            title="Refresh Integrations"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Auth Modal */}
      {isAuthModalOpen && (
        <div className="p-4 rounded-xl bg-slate-900 border border-indigo-700/60 shadow-xl space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-bold text-white uppercase tracking-wider">
              {authMode === 'login' ? 'User Login' : 'Create Free Account'}
            </h4>
            <button
              onClick={() => setIsAuthModalOpen(false)}
              className="text-slate-400 hover:text-white text-xs"
            >
              ✕
            </button>
          </div>

          <form onSubmit={handleAuthSubmit} className="space-y-2.5">
            {authMode === 'register' && (
              <div>
                <label className="text-[11px] text-slate-400 block mb-1">Your Name</label>
                <input
                  type="text"
                  placeholder="Jane Doe"
                  value={authName}
                  onChange={(e) => setAuthName(e.target.value)}
                  className="w-full px-3 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-xs text-white focus:outline-none focus:border-indigo-500"
                />
              </div>
            )}
            <div>
              <label className="text-[11px] text-slate-400 block mb-1">Email Address</label>
              <input
                type="email"
                required
                placeholder="user@example.com"
                value={authEmail}
                onChange={(e) => setAuthEmail(e.target.value)}
                className="w-full px-3 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-xs text-white focus:outline-none focus:border-indigo-500"
              />
            </div>
            <div>
              <label className="text-[11px] text-slate-400 block mb-1">Password</label>
              <input
                type="password"
                required
                placeholder="At least 6 characters"
                value={authPassword}
                onChange={(e) => setAuthPassword(e.target.value)}
                className="w-full px-3 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-xs text-white focus:outline-none focus:border-indigo-500"
              />
            </div>
            <div className="flex items-center justify-between pt-1">
              <button
                type="button"
                onClick={() => setAuthMode(authMode === 'login' ? 'register' : 'login')}
                className="text-[11px] text-indigo-400 hover:underline"
              >
                {authMode === 'login' ? "Don't have an account? Register" : 'Already have an account? Login'}
              </button>
              <button
                type="submit"
                className="px-4 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold cursor-pointer"
              >
                {authMode === 'login' ? 'Sign In' : 'Create Account'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Status Notifications */}
      {error && (
        <div className="p-3 rounded-xl bg-rose-950/50 border border-rose-800/60 text-xs text-rose-200 flex items-start gap-2">
          <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
          <span className="flex-1">{error}</span>
        </div>
      )}

      {successMsg && (
        <div className="p-3 rounded-xl bg-emerald-950/50 border border-emerald-800/60 text-xs text-emerald-200 flex items-start gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
          <span className="flex-1">{successMsg}</span>
        </div>
      )}

      {/* Quick Connect Google Workspace Suite */}
      {connectors.some((c) => ['gmail', 'google_calendar', 'google_drive'].includes(c.id) && !c.connected) && (
        <div className="p-3.5 rounded-xl bg-gradient-to-r from-indigo-950/60 to-purple-950/40 border border-indigo-800/50 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-indigo-500/20 border border-indigo-500/30 flex items-center justify-center text-indigo-300 shrink-0">
              <Key className="w-4 h-4" />
            </div>
            <div>
              <p className="text-xs font-semibold text-white">Google Workspace Suite</p>
              <p className="text-[11px] text-slate-300">Authorize Gmail, Google Calendar, and Drive with minimum read-only permissions.</p>
            </div>
          </div>
          <button
            onClick={handleConnectAllGoogleSuite}
            disabled={actionInProgress === 'google_all'}
            className="px-3.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 text-white text-xs font-semibold shadow-sm transition-all flex items-center justify-center gap-1.5 cursor-pointer shrink-0"
          >
            {actionInProgress === 'google_all' ? (
              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Key className="w-3.5 h-3.5" />
            )}
            Connect All (Gmail, Calendar, Drive)
          </button>
        </div>
      )}

      {/* Connectors List */}
      <div className="space-y-3">
        {connectors.map((c) => {
          const isExpanded = expandedConnector === c.id;
          const isActing = actionInProgress === c.id;
          const isOAuth = c.authType === 'oauth2';
          const isApiKey = c.authType === 'api_key';
          const isWebhook = c.authType === 'webhook';
          const suggestedPrompt = getSuggestedPrompt(c.id);

          // Clear Connection Status Badges
          const renderStatusBadge = () => {
            if (c.status === 'connected') {
              return (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-950/80 text-emerald-300 border border-emerald-700/60">
                  <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                  Connected
                </span>
              );
            }
            if (c.status === 'reconnect_required') {
              return (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-950/80 text-amber-300 border border-amber-700/60">
                  <AlertTriangle className="w-3 h-3 text-amber-400" />
                  Reconnect Required
                </span>
              );
            }
            if (c.status === 'permission_required') {
              return (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-purple-950/80 text-purple-300 border border-purple-700/60">
                  <Shield className="w-3 h-3 text-purple-400" />
                  Permissions Required
                </span>
              );
            }
            if (c.status === 'error') {
              return (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-rose-950/80 text-rose-300 border border-rose-700/60">
                  <AlertCircle className="w-3 h-3 text-rose-400" />
                  Tool Error
                </span>
              );
            }
            if (isWebhook) {
              return (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-indigo-950/80 text-indigo-300 border border-indigo-700/60">
                  <ShieldCheck className="w-3 h-3 text-indigo-400" />
                  {webhooks.length} Webhook{webhooks.length === 1 ? '' : 's'} Active
                </span>
              );
            }
            return (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-800 text-slate-400 border border-slate-700/50">
                Disconnected
              </span>
            );
          };

          return (
            <div
              key={c.id}
              className={`rounded-xl border transition-all ${
                c.connected || isWebhook
                  ? 'bg-slate-900/60 border-slate-800'
                  : 'bg-slate-950/50 border-slate-800/60'
              }`}
            >
              {/* Connector Card Header */}
              <div className="p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                <div className="flex items-start gap-3 min-w-0">
                  <div className="w-10 h-10 rounded-xl bg-black/40 border border-slate-800 flex items-center justify-center shrink-0">
                    {getConnectorIcon(c.id)}
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold text-xs text-white tracking-tight">{c.name}</span>
                      {renderStatusBadge()}
                    </div>
                    <p className="text-xs text-slate-400 mt-0.5 line-clamp-1">{c.description}</p>
                    {c.accountEmail && (
                      <p className="text-[11px] font-mono text-emerald-400/90 mt-1 flex items-center gap-1">
                        <Lock className="w-3 h-3 text-emerald-500" />
                        Connected Account: {c.accountEmail}
                      </p>
                    )}
                    {c.lastError && (
                      <p className="text-[11px] text-rose-400 mt-1 flex items-center gap-1">
                        <AlertCircle className="w-3 h-3 text-rose-400" />
                        {c.lastError}
                      </p>
                    )}
                  </div>
                </div>

                {/* Connection Controls */}
                <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
                  {isOAuth && (
                    c.connected ? (
                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={() => handleConnectOAuth(c)}
                          disabled={isActing}
                          className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium transition-colors cursor-pointer"
                          title="Refresh or update OAuth permissions"
                        >
                          Reconnect
                        </button>
                        <button
                          onClick={() => handleDisconnect(c.id)}
                          disabled={isActing}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800/80 hover:bg-rose-950/80 hover:border-rose-700 hover:text-rose-200 border border-slate-700 text-xs font-medium text-slate-300 transition-colors cursor-pointer"
                        >
                          <LogOut className="w-3.5 h-3.5" />
                          Disconnect
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => handleConnectOAuth(c)}
                        disabled={isActing}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 text-white text-xs font-semibold shadow-sm transition-all cursor-pointer"
                      >
                        {isActing ? (
                          <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Key className="w-3.5 h-3.5" />
                        )}
                        Connect {c.name}
                      </button>
                    )
                  )}

                  {isApiKey && (
                    c.connected ? (
                      <button
                        onClick={() => handleDisconnect(c.id)}
                        disabled={isActing}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800/80 hover:bg-rose-950/80 hover:border-rose-700 hover:text-rose-200 border border-slate-700 text-xs font-medium text-slate-300 transition-colors cursor-pointer"
                      >
                        <LogOut className="w-3.5 h-3.5" />
                        Disconnect
                      </button>
                    ) : (
                      <button
                        onClick={() => setApiKeyConnector(c.id)}
                        disabled={isActing}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-white text-xs font-medium border border-slate-700 transition-all cursor-pointer"
                      >
                        <Key className="w-3.5 h-3.5 text-indigo-400" />
                        Connect with API Key
                      </button>
                    )
                  )}

                  <button
                    onClick={() => setExpandedConnector(isExpanded ? null : c.id)}
                    className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
                    aria-label="Toggle details"
                  >
                    {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {/* API Key Entry Drawer */}
              {isApiKey && apiKeyConnector === c.id && (
                <div className="px-4 pb-4 pt-2 border-t border-slate-800 bg-slate-950/60">
                  <form onSubmit={(e) => handleApiKeySubmit(e, c.id)} className="space-y-2">
                    <div className="flex items-center justify-between text-[11px] text-slate-400">
                      <span>Enter {c.name} API Key / Access Token:</span>
                      <button
                        type="button"
                        onClick={() => setApiKeyConnector(null)}
                        className="text-indigo-400 hover:underline"
                      >
                        Cancel
                      </button>
                    </div>
                    <div className="flex gap-2">
                      <input
                        type="password"
                        placeholder="sk-..."
                        value={apiKeyInput}
                        onChange={(e) => setApiKeyInput(e.target.value)}
                        className="flex-1 px-3 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-xs font-mono text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500"
                      />
                      <button
                        type="submit"
                        disabled={!apiKeyInput.trim() || isActing}
                        className="px-3.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-semibold cursor-pointer"
                      >
                        Save Key
                      </button>
                    </div>
                    <p className="text-[10px] text-slate-400">
                      Credentials are encrypted immediately with AES-256-GCM and stored only on the server against your user ID.
                    </p>
                  </form>
                </div>
              )}

              {/* Webhooks Manager */}
              {isWebhook && isExpanded && (
                <div className="px-4 pb-4 pt-2 border-t border-slate-800/60 bg-black/20 text-xs space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                      Your Registered Webhooks:
                    </span>
                    <button
                      onClick={() => setIsAddingWebhook(!isAddingWebhook)}
                      className="inline-flex items-center gap-1 text-[11px] text-indigo-400 hover:underline"
                    >
                      <Plus className="w-3 h-3" />
                      Add Webhook
                    </button>
                  </div>

                  {isAddingWebhook && (
                    <form onSubmit={handleCreateWebhook} className="p-3 rounded-lg bg-slate-900 border border-slate-800 space-y-2">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <input
                          type="text"
                          required
                          placeholder="Webhook Name (e.g. Deploy Staging)"
                          value={newWebhookName}
                          onChange={(e) => setNewWebhookName(e.target.value)}
                          className="px-3 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-xs text-white focus:outline-none focus:border-indigo-500"
                        />
                        <select
                          value={newWebhookEnv}
                          onChange={(e) => setNewWebhookEnv(e.target.value as any)}
                          className="px-3 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-xs text-white focus:outline-none focus:border-indigo-500"
                        >
                          <option value="staging">Staging</option>
                          <option value="production">Production</option>
                        </select>
                      </div>
                      <input
                        type="url"
                        required
                        placeholder="https://your-api.com/webhook/deploy"
                        value={newWebhookUrl}
                        onChange={(e) => setNewWebhookUrl(e.target.value)}
                        className="w-full px-3 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-xs text-white focus:outline-none focus:border-indigo-500"
                      />
                      <div className="flex items-center justify-between pt-1">
                        <span className="text-[10px] text-slate-400">
                          SSRF Protected: Private network & metadata destinations are blocked.
                        </span>
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => setIsAddingWebhook(false)}
                            className="px-2.5 py-1 text-xs text-slate-400 hover:text-white"
                          >
                            Cancel
                          </button>
                          <button
                            type="submit"
                            className="px-3 py-1 rounded bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold"
                          >
                            Save Webhook
                          </button>
                        </div>
                      </div>
                    </form>
                  )}

                  {webhooks.length === 0 ? (
                    <p className="text-[11px] text-slate-400 italic">No webhooks registered yet.</p>
                  ) : (
                    <div className="space-y-2">
                      {webhooks.map((wh) => (
                        <div key={wh.id} className="p-2.5 rounded-lg bg-slate-900 border border-slate-800 flex items-center justify-between gap-2">
                          <div className="min-w-0">
                            <span className="font-semibold text-white text-xs">{wh.name}</span>
                            <span className="ml-2 px-1.5 py-0.2 rounded text-[9px] font-mono bg-slate-800 text-slate-400">
                              {wh.environment}
                            </span>
                            <code className="text-[10px] text-slate-400 font-mono block truncate">
                              ID: {wh.id} • {wh.targetUrl}
                            </code>
                          </div>
                          <button
                            onClick={() => handleDeleteWebhook(wh.id)}
                            className="p-1 rounded text-slate-400 hover:text-rose-400 transition-colors"
                            title="Delete Webhook"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Expanded Tools & Schema Drawer */}
              {isExpanded && !isWebhook && (
                <div className="px-4 pb-4 pt-1 border-t border-slate-800/60 bg-black/20 text-xs space-y-3">
                  {/* Quick Try Prompt */}
                  {c.connected && suggestedPrompt && onSelectPrompt && (
                    <div className="p-2.5 rounded-lg bg-indigo-950/40 border border-indigo-700/50 flex items-center justify-between gap-2">
                      <div className="text-[11px] text-indigo-200">
                        <span className="font-semibold text-white">Suggested Test:</span> "{suggestedPrompt}"
                      </div>
                      <button
                        onClick={() => onSelectPrompt(suggestedPrompt)}
                        className="px-2.5 py-1 rounded bg-indigo-600 hover:bg-indigo-500 text-white text-[11px] font-semibold transition-colors shrink-0"
                      >
                        Ask Model
                      </button>
                    </div>
                  )}

                  {/* Permissions Granted Badges */}
                  <div>
                    <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider block mb-1.5">
                      Permissions Granted ({(c.scopes || c.requiredScopes || []).length}):
                    </span>
                    <div className="flex flex-wrap gap-1.5">
                      {(c.scopes || c.requiredScopes || []).map((s: string) => (
                        <span
                          key={s}
                          className="px-2 py-0.5 rounded text-[10px] font-mono bg-slate-900 border border-slate-800 text-indigo-300"
                        >
                          {s.replace('https://www.googleapis.com/auth/', '')}
                        </span>
                      ))}
                    </div>
                  </div>

                  {/* Available Tools */}
                  <div>
                    <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider block mb-1.5">
                      Available Tools ({(c.availableTools || []).length}):
                    </span>
                    {(c.availableTools || []).length === 0 ? (
                      <p className="text-[11px] text-slate-400 italic">No tools registered for this plugin yet.</p>
                    ) : (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {(c.availableTools || []).map((t) => (
                          <div
                            key={t.id}
                            className="p-2.5 rounded-lg bg-slate-900 border border-slate-800 space-y-1"
                          >
                            <div className="flex items-center justify-between gap-1.5">
                              <span className="font-mono text-[11px] font-bold text-slate-200 truncate">
                                {t.name}
                              </span>
                              <span
                                className={`px-1.5 py-0.2 rounded text-[9px] font-mono font-semibold ${
                                  t.sensitivity === 'safe'
                                    ? 'bg-emerald-950 text-emerald-400 border border-emerald-800/60'
                                    : 'bg-amber-950 text-amber-300 border border-amber-800/60'
                                }`}
                              >
                                {t.sensitivity === 'safe' ? 'Auto-Execute' : 'Needs Approval'}
                              </span>
                            </div>
                            <p className="text-[11px] text-slate-400 line-clamp-2">{t.description}</p>
                            <code className="text-[10px] text-slate-400 font-mono block truncate">
                              {t.id}
                            </code>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Direct OAuth Token Manual Fallback */}
                  {isOAuth && !c.connected && (
                    <div className="pt-2 border-t border-slate-800/60">
                      {manualTokenConnector === c.id ? (
                        <form onSubmit={(e) => handleManualTokenSubmit(e, c.id)} className="space-y-2">
                          <div className="flex items-center justify-between text-[11px] text-slate-400">
                            <span>Direct Google Access Token (Fallback):</span>
                            <button
                              type="button"
                              onClick={() => setManualTokenConnector(null)}
                              className="text-indigo-400 hover:underline"
                            >
                              Cancel
                            </button>
                          </div>
                          <div className="flex gap-2">
                            <input
                              type="password"
                              placeholder="ya29.a0A..."
                              value={manualTokenInput}
                              onChange={(e) => setManualTokenInput(e.target.value)}
                              className="flex-1 px-3 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-xs font-mono text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500"
                            />
                            <button
                              type="submit"
                              disabled={!manualTokenInput.trim() || isActing}
                              className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-semibold cursor-pointer"
                            >
                              Save Token
                            </button>
                          </div>
                        </form>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setManualTokenConnector(c.id)}
                          className="text-[11px] text-slate-400 hover:text-slate-300 transition-colors flex items-center gap-1"
                        >
                          <Key className="w-3 h-3" />
                          <span>Having trouble with popups? Enter OAuth access token manually</span>
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
