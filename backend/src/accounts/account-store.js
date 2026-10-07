import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { readFileSync, mkdirSync, writeFileSync, renameSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createInitialAccounts } from "./demo-accounts.js";

import { applyAccountChange } from "./account-changes.js";
import { normalizeCommerce, accountView, authorizePlayback } from "./account-commerce.js";

const derive = promisify(scrypt);
const bad = (message) => {
  throw Object.assign(new Error(message), { status: 400 });
};
export function createAccountStore({
  file = new URL("../../data/accounts.json", import.meta.url),
  clock = () => new Date(),
} = {}) {
  let accounts;
  let newlySeeded = false;
  try {
    accounts = file ? JSON.parse(readFileSync(file, "utf8")) : createInitialAccounts();
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    accounts = createInitialAccounts();
    newlySeeded = true;
  }
  const sessions = new Map();
  const contexts = new Map();
  const contextListeners = new Map();
  const persist = () => {
    if (!file) return;
    const target = file instanceof URL ? fileURLToPath(file) : String(file);
    const temporary = `${target}.tmp`;
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(temporary, JSON.stringify(accounts, null, 2), {
      mode: 0o600,
    });
    renameSync(temporary, target);
  };
  // Upgrade access/billing fields without replacing personal data or historical bills.
  const beforeMigration = JSON.stringify(accounts);
  for (const account of accounts) normalizeCommerce(account.user, clock());
  if (newlySeeded || beforeMigration !== JSON.stringify(accounts)) persist();
  function getUser(id) {
    const account = accounts.find((item) => item.user.id === id);
    if (!account) throw Object.assign(new Error("Account unavailable"), { status: 401 });
    const normalized = normalizeCommerce(structuredClone(account.user), clock());
    if (JSON.stringify(normalized) !== JSON.stringify(account.user)) {
      const previous = account.user;
      account.user = normalized;
      try {
        persist();
      } catch (error) {
        account.user = previous;
        throw error;
      }
    }
    return accountView(structuredClone(account.user), clock());
  }
  return {
    getUser,
    getContext(userId) {
      return contexts.get(userId) || null;
    },
    setContext(userId, context) {
      contexts.set(userId, { ...context, updatedAt: Date.now() });
      for (const listener of contextListeners.get(userId) || []) listener();
    },
    subscribeContext(userId, listener) {
      if (!contextListeners.has(userId)) contextListeners.set(userId, new Set());
      const listeners = contextListeners.get(userId);
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
        if (!listeners.size) contextListeners.delete(userId);
      };
    },
    async login(email, password) {
      if (
        typeof email !== "string" ||
        typeof password !== "string" ||
        email.length > 254 ||
        password.length > 128
      )
        bad("Invalid credentials");
      const account = accounts.find(
        (item) => item.user.profile.email === email.trim().toLowerCase(),
      );
      const hash = await derive(password, account?.salt || "missing-account", 64);
      if (!account || !timingSafeEqual(hash, Buffer.from(account.passwordHash, "hex")))
        throw Object.assign(new Error("Email or password is incorrect"), {
          status: 401,
        });
      const token = randomBytes(32).toString("hex");
      for (const [key, entry] of sessions) if (entry.expires <= Date.now()) sessions.delete(key);
      const existing = [...sessions].filter(([, entry]) => entry.userId === account.user.id);
      if (existing.length >= 10) sessions.delete(existing[0][0]);
      sessions.set(token, {
        userId: account.user.id,
        expires: Date.now() + 12 * 60 * 60 * 1000,
      });
      return { token, user: getUser(account.user.id) };
    },
    authenticate(request) {
      const token = /(?:^|;\s*)nova_session=([a-f0-9]{64})(?:;|$)/.exec(
        request.headers.cookie || "",
      )?.[1];
      const session = sessions.get(token);
      if (!session || session.expires <= Date.now()) {
        sessions.delete(token);
        return null;
      }
      return { ...session, token };
    },
    logout(token) {
      sessions.delete(token);
    },
    update(userId, change) {
      return saveChange(userId, (user) => applyAccountChange(user, change, clock()));
    },
    authorizePlayback(userId, target) {
      let access;
      saveChange(userId, (user) => {
        access = authorizePlayback(user, target, clock());
        return user;
      });
      return access;
    },
  };
  function saveChange(userId, change) {
    const user = change(getUser(userId));
    delete user.access;
    const index = accounts.findIndex((item) => item.user.id === userId);
    const previous = accounts[index];
    accounts[index] = { ...previous, user };
    try {
      persist();
    } catch (error) {
      accounts[index] = previous;
      throw error;
    }
    return accountView(structuredClone(user), clock());
  }
}
