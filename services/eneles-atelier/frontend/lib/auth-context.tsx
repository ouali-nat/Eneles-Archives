"use client";

import {
  createContext,
  useContext,
  useState,
  useEffect,
  ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import {
  usersAPI,
  sendOTP,
  API_URL,
  apiFetch,
  setApiSessionToken,
  type VerificationIdentity,
} from "@/lib/api";

interface User {
  id: number;
  email: string;
  name?: string;
  bio?: string;
  affiliation?: string;
  location?: string;
  avatarUrl?: string;
  isEmailVerified: boolean;
  subscriptionType?: "free" | "pro" | "team" | "enterprise";
  twoFactorEnabled?: boolean;
  createdAt: string;
  updatedAt: string;
}

interface AuthContextType {
  user: User | null;
  /**
   * This browser has a sign-in. The credential itself is an HttpOnly cookie
   * the API sets, which no page script can read; this flag is all the page
   * knows. It can be true while `user` is still loading, or while the API is
   * unreachable.
   */
  isAuthenticated: boolean;
  isLoading: boolean;
  isInitialized: boolean; // true once the initial sign-in check is done
  error: string | null;
  pendingLoginVerification: { userId?: number; email: string } | null;
  registerWithEmail: (
    email: string,
    name: string,
  ) => Promise<{
    userId?: number;
    email: string;
    isNewUser: boolean;
    message: string;
  }>;
  loginWithEmail: (
    email: string,
    name?: string,
  ) => Promise<{
    email: string;
    isNewUser: boolean;
    message: string;
  }>;
  verifyLoginCode: (identity: VerificationIdentity, code: string) => Promise<any>; // Changed return type to allow 2FA challenge
  verifyApp2FA: (identity: VerificationIdentity, code: string) => Promise<any>;
  resendLoginCode: (identity: VerificationIdentity) => Promise<void>;
  logout: () => void;
  /** Load the profile again, for example after the API was unreachable. */
  refreshUser: () => Promise<void>;
  clearError: () => void;
  checkEmailExists?: (email: string) => Promise<boolean>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// Older versions kept the token where page scripts could read it.
const LEGACY_TOKEN_KEY = "texer_token";
const LEGACY_TOKEN_COOKIE = "auth-token";
/** Read by proxy.ts. See `setSignedInHint`. */
const SIGNED_IN_COOKIE = "texer_signed_in";
const SESSION_DAYS = 7;

function cookieSuffix() {
  // Browsers drop `Secure` cookies on plain-HTTP origins (local development).
  return `; path=/; samesite=lax${window.location.protocol === "https:" ? "; secure" : ""}`;
}

/**
 * proxy.ts decides redirects before any page script runs, and it cannot see
 * the API's cookie, which belongs to the API's host. This cookie tells it
 * only that this browser signed in. It is not a credential.
 */
function setSignedInHint(on: boolean) {
  document.cookie = on
    ? `${SIGNED_IN_COOKIE}=1; max-age=${SESSION_DAYS * 24 * 60 * 60}${cookieSuffix()}`
    : `${SIGNED_IN_COOKIE}=; max-age=0${cookieSuffix()}`;
}

function hasSignedInHint() {
  return document.cookie.split("; ").some((c) => c === `${SIGNED_IN_COOKIE}=1`);
}

/**
 * Move a sign-in kept by an older version of the site into the API's
 * HttpOnly cookie, then delete the readable copies. Resolves to whether
 * there was one to move. Runs once per page load, however many times the
 * provider mounts (development mounts effects twice).
 */
let legacyAdoption: Promise<boolean> | null = null;
function adoptLegacySignIn(): Promise<boolean> {
  legacyAdoption ??= moveLegacySignIn();
  return legacyAdoption;
}

async function moveLegacySignIn(): Promise<boolean> {
  const legacy = localStorage.getItem(LEGACY_TOKEN_KEY);
  localStorage.removeItem(LEGACY_TOKEN_KEY);
  document.cookie = `${LEGACY_TOKEN_COOKIE}=; max-age=0${cookieSuffix()}`;
  if (!legacy) return false;
  try {
    const res = await apiFetch(`${API_URL}/auth/session`, {
      method: "POST",
      headers: { Authorization: `Bearer ${legacy}` },
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Never keep secrets the API might include in a user object. */
function safeUser(data: any): User {
  const { token: _t, password: _p, twoFactorSecret: _s, ...rest } = data ?? {};
  return rest;
}

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isInitialized, setIsInitialized] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingLoginVerification, setPendingLoginVerification] = useState<{
    userId?: number;
    email: string;
  } | null>(null);
  const router = useRouter();

  const signedOut = () => {
    setUser(null);
    setIsAuthenticated(false);
    setSignedInHint(false);
  };

  const signedIn = (data: any) => {
    setSignedInHint(true);
    setUser(safeUser(data));
    setIsAuthenticated(true);
    setPendingLoginVerification(null);
  };

  const fetchUserProfile = async () => {
    const MAX_ATTEMPTS = 2;
    const RETRY_DELAY_MS = 1000;

    try {
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        try {
          const response = await apiFetch(`${API_URL}/users/profile`);

          if (response.status === 401) {
            // Definitively signed out (expired or revoked): stop retrying.
            setError("Session expired. Please sign in again.");
            signedOut();
            return;
          }

          if (response.ok) {
            signedIn(await response.json());
            return;
          }

          // Transient server error (500, 503, etc.): retry if attempts remain.
          if (attempt < MAX_ATTEMPTS) {
            await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
            continue;
          }
          // Out of attempts: the session is probably still valid, so stay
          // signed in with no profile; the layout offers a retry.
          return;
        } catch {
          // Network error / CORS / HMR race: retry if attempts remain.
          if (attempt < MAX_ATTEMPTS) {
            await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
            continue;
          }
          return;
        }
      }
    } finally {
      // Runs exactly once, only after all attempts have settled.
      setIsInitialized(true);
    }
  };

  useEffect(() => {
    // Embedded in Eneles: receive a short-lived Supabase access token from
    // the parent, exchange it server-side, and keep the editor token in memory.
    if (window.parent !== window) {
      const parentOrigins = (process.env.NEXT_PUBLIC_ENELES_PARENT_ORIGINS ||
        'https://aurore-section-archives.com,https://aurore-section-archivescom.vercel.app,https://eneles-archives-ouali1.vercel.app')
        .split(',').map((value) => value.trim()).filter(Boolean);
      const parentOrigin = (() => {
        try { const referrer = new URL(document.referrer).origin; return parentOrigins.includes(referrer) ? referrer : parentOrigins[0]; }
        catch { return parentOrigins[0]; }
      })();
      let active = true;
      const listener = async (event: MessageEvent) => {
        if (!active || event.source !== window.parent || !parentOrigins.includes(event.origin) ||
            event.data?.type !== 'ENELES_ATELIER_SSO' || typeof event.data.accessToken !== 'string') return;
        try {
          setIsLoading(true); setError(null);
          const response = await fetch(`${API_URL}/auth/eneles-sso`, {
            method: 'POST', credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ accessToken: event.data.accessToken }),
          });
          const result = await response.json().catch(() => ({}));
          if (!response.ok || !result?.user || typeof result?.token !== 'string') {
            throw new Error(result?.message || 'Impossible d’ouvrir votre session Eneles.');
          }
          setApiSessionToken(result.token);
          signedIn(result.user);
          setIsInitialized(true);
        } catch (error: any) {
          setError(error?.message || 'La connexion Eneles n’a pas abouti.');
          setIsInitialized(true);
        } finally { setIsLoading(false); }
      };
      window.addEventListener('message', listener);
      window.parent.postMessage({ type: 'ENELES_ATELIER_READY' }, parentOrigin);
      return () => { active = false; window.removeEventListener('message', listener); };
    }

    (async () => {
      const adopted = await adoptLegacySignIn();
      if (adopted || hasSignedInHint()) {
        setIsAuthenticated(true);
        await fetchUserProfile();
      } else { setIsInitialized(true); }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const registerWithEmail = async (email: string, name: string) => {
    setIsLoading(true);
    setError(null);

    try {
      const result = await usersAPI.signup({ email, name });
      // `userId` is present for a genuinely new signup (the negative pending
      // id). It is absent when the address already had an account, in which
      // case the server sent a login code instead and verification is by
      // email. The modal handles both; the response is deliberately the same
      // shape so a caller cannot tell which happened.
      setPendingLoginVerification({
        userId: result.userId,
        email: result.email,
      });
      return { ...result, isNewUser: true };
    } catch (err: any) {
      setError(err.message || "Registration failed. Please try again.");
      throw err;
    } finally {
      setIsLoading(false);
    }
  };

  const loginWithEmail = async (email: string, name?: string) => {
    setIsLoading(true);
    setError(null);

    try {
      const result = await usersAPI.login({ email, name });
      // No user id here on purpose. The server no longer reveals whether the
      // address has an account; the code in the inbox is the only proof.
      setPendingLoginVerification({ email: result.email });
      return { ...result, isNewUser: false };
    } catch (err: any) {
      setError(err.message || "Login failed. Please try again.");
      throw err;
    } finally {
      setIsLoading(false);
    }
  };

  const verifyLoginCode = async (identity: VerificationIdentity, code: string) => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await usersAPI.verifyLogin(identity, code);

      // Handle 2FA requirement
      if (response?.requires2FA) {
        return response;
      }

      // The API set the session cookie; the body is the user.
      if (!response || typeof response.id !== "number") {
        throw new Error("Invalid response received from server");
      }
      signedIn(response);

      return response;
    } catch (err: any) {
      setError(err.message || "Verification failed. Please try again.");
      throw err;
    } finally {
      setIsLoading(false);
    }
  };

  const verifyApp2FA = async (identity: VerificationIdentity, code: string) => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await usersAPI.verifyApp2FA(identity, code);

      if (!response || typeof response.id !== "number") {
        throw new Error("Invalid response received from server");
      }
      signedIn(response);

      return response;
    } catch (err: any) {
      setError(err.message || "2FA Verification failed. Please try again.");
      throw err;
    } finally {
      setIsLoading(false);
    }
  };

  const resendLoginCode = async (identity: VerificationIdentity) => {
    setIsLoading(true);
    setError(null);

    try {
      await sendOTP(identity);
    } catch (err: any) {
      setError(err.message || "Failed to resend verification code");
      throw err;
    } finally {
      setIsLoading(false);
    }
  };

  const checkIfEmailExists = async (_email: string): Promise<boolean> => {
    // Email existence is determined server-side by /auth/login returning NOT_FOUND.
    // There is no dedicated check-email endpoint.
    return false;
  };

  const logout = async () => {
    // Ends the session server-side and clears the HttpOnly cookie, which the
    // page cannot do itself.
    try {
      await apiFetch(`${API_URL}/auth/logout`, { method: "POST" });
    } catch {
      // Ignore errors: we're signing out anyway
    }
    setApiSessionToken(null);
    signedOut();
    if (window.parent !== window) {
      window.parent.postMessage({ type: 'ENELES_ATELIER_SIGNED_OUT' }, '*');
      return;
    }
    router.push("/login");
  };

  const refreshUser = async () => {
    // With a profile already shown (after editing it), reload it in place; only a sign-in whose profile never loaded goes back through the blank initializing state.
    if (!user) setIsInitialized(false);
    await fetchUserProfile();
  };

  const clearError = () => {
    setError(null);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        isAuthenticated,
        isLoading,
        isInitialized,
        error,
        pendingLoginVerification,
        registerWithEmail,
        loginWithEmail,
        verifyLoginCode,
        verifyApp2FA,
        resendLoginCode,
        logout,
        refreshUser,
        clearError,
        checkEmailExists: checkIfEmailExists,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
};
