// Maps a Supabase sign-in error to a message the user can act on. Only a real credentials
// rejection says the password is wrong; network failures and outages say so plainly.
type SignInError = { name?: string; status?: number; code?: string };

export const LOGIN_MESSAGES = {
  invalid: "Email or password is incorrect.",
  unreachable: "Can't reach the login server. Check your internet connection and try again.",
  rateLimited: "Too many attempts. Wait a minute and try again.",
  unknown: "Could not log in. Please try again.",
} as const;

export function loginErrorMessage(error: SignInError): string {
  if (error.name === "AuthRetryableFetchError" || !error.status || error.status >= 500) {
    return LOGIN_MESSAGES.unreachable;
  }
  if (error.status === 429) return LOGIN_MESSAGES.rateLimited;
  if (error.code === "invalid_credentials" || error.status === 400 || error.status === 401) {
    return LOGIN_MESSAGES.invalid;
  }
  return LOGIN_MESSAGES.unknown;
}
