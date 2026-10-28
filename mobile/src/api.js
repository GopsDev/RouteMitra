// Talks to the RouteMitra app on ERPNext. Every call sends the rep's token from auth.login.

import Constants from 'expo-constants';
import * as SecureStore from 'expo-secure-store';

export const FIELD_API = 'routemitra.routemitra_core.api.v1.field';
export const MAPS_API = 'routemitra.routemitra_core.api.v1.maps';
export const AUTH_API = 'routemitra.routemitra_core.api.v1.auth';

const session = { server: '', token: '' };
let onLoggedOut = null;

// Called when the server says the token is no longer valid (logged in on another phone).
export function setLoggedOutHandler(fn) {
  onLoggedOut = fn;
}

export async function loadSession() {
  session.server = (await SecureStore.getItemAsync('server')) || '';
  session.token = (await SecureStore.getItemAsync('token')) || '';
  return { ...session };
}

export async function login(server, usr, pwd) {
  const address = cleanServer(server);
  const result = await post(address, `${AUTH_API}.login`, { usr: usr.trim(), pwd }, '');
  session.server = address;
  session.token = result.token;
  await SecureStore.setItemAsync('server', address);
  await SecureStore.setItemAsync('token', result.token);
  return result;
}

export async function logout() {
  try {
    await call(`${AUTH_API}.logout`);
  } catch {
    // The token may already be gone; forget it on the phone either way.
  }
  session.token = '';
  await SecureStore.deleteItemAsync('token');
}

// While developing, the bench runs on the same computer as Expo, so guess its address from Expo's.
export function devServer() {
  const host = (Constants.expoConfig && Constants.expoConfig.hostUri) || '';
  const ip = host.split(':')[0];
  return __DEV__ && /^\d+\.\d+\.\d+\.\d+$/.test(ip) ? `http://${ip}:8000` : '';
}

// An <Image> source for a file on the server. Private files (shop photos) need the rep's token.
export function fileSource(url) {
  if (!url) return null;
  if (/^https?:\/\//.test(url)) return { uri: url };
  return { uri: `${session.server}${url}`, headers: { Authorization: `token ${session.token}` } };
}

export function call(method, args = {}) {
  return post(session.server, method, args, session.token);
}

async function post(server, method, args, token) {
  const headers = { Accept: 'application/json', 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `token ${token}`;
  let response;
  try {
    response = await fetch(`${server}/api/method/${method}`, { method: 'POST', headers, body: JSON.stringify(args) });
  } catch (error) {
    throw new Error(`Can't reach ${server} (${error.message}). Check the internet connection and the server address.`);
  }
  const data = await response.json().catch(() => ({}));
  if (response.status === 401 && token) {
    session.token = '';
    await SecureStore.deleteItemAsync('token');
    if (onLoggedOut) onLoggedOut();
    throw new Error('You were logged out. Log in again.');
  }
  if (response.status === 401) throw new Error('Wrong email or password.');
  if (response.status === 429) throw new Error('Too many login attempts. Wait a few minutes and try again.');
  if (!response.ok) throw new Error(serverMessage(data) || `Request failed (${response.status})`);
  return data.message;
}

// Frappe sends errors as a JSON list of JSON-encoded messages that may contain HTML.
function serverMessage(data) {
  try {
    const messages = JSON.parse(data._server_messages || '[]').map((m) => {
      const parsed = typeof m === 'string' ? JSON.parse(m) : m;
      return stripHtml(parsed.message || '');
    });
    if (messages.length) return messages.join(' ');
  } catch {
    // Fall through to the exception text.
  }
  return stripHtml(data.exception || '');
}

export function stripHtml(html) {
  return String(html || '').replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim();
}

function cleanServer(server) {
  // Forgive what phone keyboards and pasting do: spaces, a "Server:" label, "http//", commas in an IP.
  let address = server.replace(/\s+/g, '').replace(/^server:/i, '').replace(/\/+$/, '');
  address = address.replace(/^(https?)\/\//i, '$1://').replace(/^(https?):\/(?!\/)/i, '$1://');
  if (/^(https?:\/\/)?\d+,\d+,\d+,\d+/.test(address)) address = address.replace(/,/g, '.');
  // A number keypad has no ":", so "192.168.1.8.8000" means port 8000.
  address = address.replace(/^((?:https?:\/\/)?\d+\.\d+\.\d+\.\d+)\.(\d{2,5})$/, '$1:$2');
  // A local test server (an IP address or localhost) has no https; a real server should.
  const local = /^(localhost|\d+\.\d+\.\d+\.\d+)(:\d+)?$/.test(address);
  if (!/^https?:\/\//.test(address)) address = `${local ? 'http' : 'https'}://${address}`;
  return address;
}
