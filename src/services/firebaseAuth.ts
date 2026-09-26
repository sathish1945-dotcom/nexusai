import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  getAuth,
  signInWithPopup,
  GoogleAuthProvider,
  onAuthStateChanged,
  User,
  signOut
} from 'firebase/auth';
import firebaseConfig from '../../firebase-applet-config.json';

// Initialize Firebase App singleton
const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
export const auth = getAuth(app);

// In-memory token cache (never stored in localStorage or sessionStorage)
let cachedAccessToken: string | null = null;
let cachedUser: User | null = null;
let isSigningIn = false;

export const WORKSPACE_SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/calendar.events.readonly',
  'https://www.googleapis.com/auth/drive.readonly'
];

/**
 * Initialize auth state listener.
 */
export const initAuth = (
  onAuthSuccess?: (user: User, token?: string) => void,
  onAuthFailure?: () => void
) => {
  return onAuthStateChanged(auth, async (user: User | null) => {
    if (user) {
      cachedUser = user;
      if (onAuthSuccess) {
        onAuthSuccess(user, cachedAccessToken || undefined);
      }
    } else {
      cachedAccessToken = null;
      cachedUser = null;
      if (onAuthFailure) {
        onAuthFailure();
      }
    }
  });
};

/**
 * Sign in with Google using Firebase Auth popup requesting required scopes.
 */
export const signInWithGoogleWorkspace = async (
  customScopes?: string[]
): Promise<{ user: User; accessToken: string }> => {
  try {
    isSigningIn = true;
    const provider = new GoogleAuthProvider();

    const scopesToRequest = customScopes && customScopes.length > 0
      ? customScopes
      : WORKSPACE_SCOPES;

    for (const scope of scopesToRequest) {
      provider.addScope(scope);
    }

    provider.setCustomParameters({
      prompt: 'consent',
      access_type: 'offline'
    });

    const result = await signInWithPopup(auth, provider);
    const credential = GoogleAuthProvider.credentialFromResult(result);

    if (!credential?.accessToken) {
      throw new Error('Failed to retrieve OAuth access token from Firebase authentication result.');
    }

    cachedAccessToken = credential.accessToken;
    cachedUser = result.user;

    return {
      user: result.user,
      accessToken: cachedAccessToken
    };
  } catch (error) {
    console.error('Firebase Google Workspace Sign-In Error:', error);
    throw error;
  } finally {
    isSigningIn = false;
  }
};

export const getCachedAccessToken = (): string | null => {
  return cachedAccessToken;
};

export const getCachedUser = (): User | null => {
  return cachedUser;
};

export const logoutGoogle = async () => {
  cachedAccessToken = null;
  cachedUser = null;
  await signOut(auth);
};
