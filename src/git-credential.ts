/**
 * Git Credential Helper for Strayl
 *
 * This script is called by git when it needs credentials.
 * Usage: git-credential-strayl <get|store|erase>
 *
 * Git sends input via stdin in the format:
 *   protocol=https
 *   host=api.strayl.dev
 *   path=/username/repo.git
 *
 * For "get" operation, we output:
 *   username=<strayl-username>
 *   password=<session-token>
 */

import { createInterface } from "node:readline";
import { getCredentials, getConfig } from "./config.js";

interface GitCredentialInput {
  protocol?: string;
  host?: string;
  path?: string;
  username?: string;
  password?: string;
}

async function main() {
  const operation = process.argv[2];

  if (!operation) {
    console.error("Usage: git-credential-strayl <get|store|erase>");
    process.exit(1);
  }

  // Read input from stdin
  const input = await readStdin();

  switch (operation) {
    case "get":
      handleGet(input);
      break;
    case "store":
      // We don't need to store - credentials are managed by 'st login'
      break;
    case "erase":
      // We don't erase on git's request - use 'st logout'
      break;
    default:
      console.error(`Unknown operation: ${operation}`);
      process.exit(1);
  }
}

async function readStdin(): Promise<GitCredentialInput> {
  return new Promise((resolve) => {
    const input: GitCredentialInput = {};

    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: false,
    });

    rl.on("line", (line) => {
      const [key, value] = line.split("=");
      if (key && value !== undefined) {
        (input as Record<string, string>)[key] = value;
      }
    });

    rl.on("close", () => {
      resolve(input);
    });

    // Handle case where stdin is empty
    setTimeout(() => {
      rl.close();
    }, 100);
  });
}

function handleGet(input: GitCredentialInput): void {
  const config = getConfig();
  const apiHost = new URL(config.apiUrl).host;

  // Check if this is a request for our host
  if (input.host !== apiHost) {
    // Not our host, let git try other helpers
    process.exit(0);
  }

  // Get stored credentials
  const credentials = getCredentials();

  if (!credentials) {
    // No credentials stored
    // Git will prompt user or try other helpers
    process.exit(0);
  }

  // Output credentials in git format
  console.log(`username=${credentials.username}`);
  console.log(`password=${credentials.token}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
