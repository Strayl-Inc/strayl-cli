/**
 * Configuration and credentials management
 * Stores credentials in ~/.strayl/credentials
 */

import { homedir } from "node:os";
import { join } from "node:path";
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";

export interface Credentials {
  token: string;
  username: string;
  email: string;
  expiresAt: string;
}

export interface Config {
  apiUrl: string;
  appUrl: string;
}

const CONFIG_DIR = join(homedir(), ".strayl");
const CREDENTIALS_FILE = join(CONFIG_DIR, "credentials");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");

const DEFAULT_CONFIG: Config = {
  apiUrl: "https://api.strayl.dev",
  appUrl: "https://app.strayl.dev",
};

/**
 * Ensure config directory exists
 */
function ensureConfigDir(): void {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  }
}

/**
 * Get configuration
 */
export function getConfig(): Config {
  ensureConfigDir();

  if (existsSync(CONFIG_FILE)) {
    try {
      const content = readFileSync(CONFIG_FILE, "utf-8");
      return { ...DEFAULT_CONFIG, ...JSON.parse(content) };
    } catch {
      return DEFAULT_CONFIG;
    }
  }

  return DEFAULT_CONFIG;
}

/**
 * Save configuration
 */
export function saveConfig(config: Partial<Config>): void {
  ensureConfigDir();
  const current = getConfig();
  const merged = { ...current, ...config };
  writeFileSync(CONFIG_FILE, JSON.stringify(merged, null, 2), { mode: 0o600 });
}

/**
 * Get stored credentials
 */
export function getCredentials(): Credentials | null {
  ensureConfigDir();

  if (!existsSync(CREDENTIALS_FILE)) {
    return null;
  }

  try {
    const content = readFileSync(CREDENTIALS_FILE, "utf-8");
    const creds = JSON.parse(content) as Credentials;

    // Check if expired
    if (new Date(creds.expiresAt) < new Date()) {
      // Token expired, remove it
      deleteCredentials();
      return null;
    }

    return creds;
  } catch {
    return null;
  }
}

/**
 * Save credentials
 */
export function saveCredentials(credentials: Credentials): void {
  ensureConfigDir();
  writeFileSync(CREDENTIALS_FILE, JSON.stringify(credentials, null, 2), { mode: 0o600 });
}

/**
 * Delete credentials (logout)
 */
export function deleteCredentials(): void {
  if (existsSync(CREDENTIALS_FILE)) {
    unlinkSync(CREDENTIALS_FILE);
  }
}

/**
 * Get the config directory path
 */
export function getConfigDir(): string {
  return CONFIG_DIR;
}
