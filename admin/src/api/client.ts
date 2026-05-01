import axios from 'axios';

const TOKEN_KEY = 'steamgame_admin_token';
const LOGIN_PATH = '/admin/login';

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null): void {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

export const api = axios.create({
  baseURL: '',
  timeout: 120000,
});

api.interceptors.request.use((config) => {
  const t = getToken();
  if (t) {
    config.headers.Authorization = `Bearer ${t}`;
  }
  return config;
});

api.interceptors.response.use(
  (r) => r,
  (err) => {
    if (axios.isAxiosError(err) && err.response?.status === 401) {
      setToken(null);
      if (!window.location.pathname.endsWith('/login')) {
        window.location.assign(LOGIN_PATH);
      }
    }
    return Promise.reject(err);
  },
);

export type ApiEnvelope<T> = { ok: boolean; data: T; message: string | null };
