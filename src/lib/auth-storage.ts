export const REMEMBER_GOOGLE_ACCOUNT_KEY = "nikufra:auth:remember-google-account";

interface AuthStorage {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
}

export function shouldRememberGoogleAccount(storage: Pick<AuthStorage, "getItem"> = window.localStorage) {
  return storage.getItem(REMEMBER_GOOGLE_ACCOUNT_KEY) !== "false";
}

export function setRememberGoogleAccount(remember: boolean, storage: Pick<AuthStorage, "setItem"> = window.localStorage) {
  storage.setItem(REMEMBER_GOOGLE_ACCOUNT_KEY, remember ? "true" : "false");
}

export function createRememberedAuthStorage(localStorage: AuthStorage, sessionStorage: AuthStorage): AuthStorage {
  return {
    getItem(key) {
      return localStorage.getItem(key) ?? sessionStorage.getItem(key);
    },
    setItem(key, value) {
      if (shouldRememberGoogleAccount(localStorage)) {
        localStorage.setItem(key, value);
        sessionStorage.removeItem(key);
      } else {
        sessionStorage.setItem(key, value);
        localStorage.removeItem(key);
      }
    },
    removeItem(key) {
      localStorage.removeItem(key);
      sessionStorage.removeItem(key);
    },
  };
}
