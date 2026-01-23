/**
 * Strayl CLI
 * Main entry point
 */

import { Command } from "commander";
import pc from "picocolors";
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { login } from "./auth.js";
import { getCredentials, deleteCredentials, getConfig, saveConfig, getConfigDir } from "./config.js";

const GIT_CREDENTIALS_FILE = join(homedir(), ".git-credentials");

/**
 * Configure git credential helper for Strayl
 * Writes credentials to ~/.git-credentials and configures git to use store helper
 */
function setupGitCredentials(): void {
  const config = getConfig();
  const credentials = getCredentials();
  if (!credentials) return;

  const apiUrl = new URL(config.apiUrl);
  const credentialLine = `${apiUrl.protocol}//${credentials.username}:${credentials.token}@${apiUrl.host}`;

  // Read existing credentials file
  let existingContent = "";
  if (existsSync(GIT_CREDENTIALS_FILE)) {
    existingContent = readFileSync(GIT_CREDENTIALS_FILE, "utf-8");
  }

  // Remove old Strayl credentials if present
  const lines = existingContent.split("\n").filter(line => !line.includes(apiUrl.host));

  // Add new credentials
  lines.push(credentialLine);

  // Write back
  writeFileSync(GIT_CREDENTIALS_FILE, lines.filter(l => l.trim()).join("\n") + "\n", { mode: 0o600 });

  // Configure git to use store helper for this host
  try {
    execSync(`git config --global credential.helper store`, { stdio: "pipe" });
  } catch {
    // Ignore if fails
  }
}

/**
 * Remove git credentials for Strayl
 */
function removeGitCredentials(): void {
  const config = getConfig();
  const apiUrl = new URL(config.apiUrl);

  if (!existsSync(GIT_CREDENTIALS_FILE)) return;

  // Remove Strayl credentials from file
  const content = readFileSync(GIT_CREDENTIALS_FILE, "utf-8");
  const lines = content.split("\n").filter(line => !line.includes(apiUrl.host));
  writeFileSync(GIT_CREDENTIALS_FILE, lines.filter(l => l.trim()).join("\n") + "\n", { mode: 0o600 });
}

const program = new Command();

program
  .name("st")
  .description("Strayl CLI - Git hosting and deployment platform")
  .version("0.1.0");

// ============ Login ============

program
  .command("login")
  .description("Authenticate with Strayl")
  .action(async () => {
    // Check if already logged in
    const existing = getCredentials();
    if (existing) {
      console.log(pc.yellow(`Already logged in as @${existing.username}`));
      console.log(pc.dim("Run 'st logout' first to switch accounts"));
      return;
    }

    try {
      console.log(pc.bold("Logging in to Strayl..."));
      const credentials = await login();

      // Auto-configure git credentials
      setupGitCredentials();

      const config = getConfig();
      const apiHost = new URL(config.apiUrl).host;

      console.log();
      console.log(pc.green("✓") + ` Logged in as ${pc.bold("@" + credentials.username)}`);
      console.log();
      console.log("You can now:");
      console.log(pc.dim(`  git clone https://${apiHost}/${credentials.username}/repo.git`));
      console.log(pc.dim(`  git push origin main`));
    } catch (error) {
      console.error(pc.red("✗") + ` Login failed: ${error instanceof Error ? error.message : "Unknown error"}`);
      process.exit(1);
    }
  });

// ============ Logout ============

program
  .command("logout")
  .description("Log out from Strayl")
  .action(() => {
    const credentials = getCredentials();

    if (!credentials) {
      console.log(pc.yellow("Not logged in"));
      return;
    }

    // Remove git credentials first
    removeGitCredentials();
    deleteCredentials();
    console.log(pc.green("✓") + ` Logged out from @${credentials.username}`);
  });

// ============ Whoami ============

program
  .command("whoami")
  .description("Show current authenticated user")
  .action(() => {
    const credentials = getCredentials();

    if (!credentials) {
      console.log(pc.yellow("Not logged in"));
      console.log(pc.dim("Run 'st login' to authenticate"));
      process.exit(1);
    }

    console.log(pc.bold("@" + credentials.username));
    console.log(pc.dim(credentials.email));
  });

// ============ Config ============

program
  .command("config")
  .description("Manage CLI configuration")
  .option("--api-url <url>", "Set API URL")
  .option("--app-url <url>", "Set App URL")
  .option("--show", "Show current configuration")
  .action((options) => {
    if (options.show || (!options.apiUrl && !options.appUrl)) {
      const config = getConfig();
      console.log(pc.bold("Current configuration:"));
      console.log(`  API URL: ${pc.cyan(config.apiUrl)}`);
      console.log(`  App URL: ${pc.cyan(config.appUrl)}`);
      return;
    }

    const updates: Record<string, string> = {};
    if (options.apiUrl) updates.apiUrl = options.apiUrl;
    if (options.appUrl) updates.appUrl = options.appUrl;

    saveConfig(updates);
    console.log(pc.green("✓") + " Configuration updated");
  });

// ============ Clone ============

program
  .command("clone <repo>")
  .description("Clone a Strayl repository")
  .argument("[directory]", "Directory to clone into")
  .action(async (repo: string, directory?: string) => {
    const config = getConfig();

    // Parse repo: can be "username/repo" or full URL
    let repoUrl: string;

    if (repo.includes("://")) {
      repoUrl = repo;
    } else {
      // Assume format: username/repo
      if (!repo.includes("/")) {
        console.error(pc.red("✗") + " Invalid repository format. Use: username/repo");
        process.exit(1);
      }
      repoUrl = `${config.apiUrl}/${repo}.git`;
    }

    const { spawn } = await import("node:child_process");
    const args = ["clone", repoUrl];
    if (directory) args.push(directory);

    const child = spawn("git", args, { stdio: "inherit" });

    child.on("exit", (code) => {
      process.exit(code ?? 0);
    });
  });

// ============ Git Credential Setup ============

program
  .command("setup-git")
  .description("Re-configure git credentials (usually not needed)")
  .action(() => {
    const credentials = getCredentials();

    if (!credentials) {
      console.log(pc.yellow("Not logged in"));
      console.log(pc.dim("Run 'st login' first"));
      process.exit(1);
    }

    setupGitCredentials();

    const config = getConfig();
    const apiHost = new URL(config.apiUrl).host;

    console.log(pc.green("✓") + " Git credentials configured");
    console.log();
    console.log(pc.dim("You can now use git commands with Strayl repositories:"));
    console.log(pc.dim(`  git clone https://${apiHost}/${credentials.username}/repo.git`));
  });

// ============ Parse & Run ============

program.parse();
