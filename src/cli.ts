/**
 * Strayl CLI
 * Main entry point
 */

import { Command } from "commander";
import pc from "picocolors";
import { login } from "./auth.js";
import { getCredentials, deleteCredentials, getConfig, saveConfig } from "./config.js";

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
      console.log();
      console.log(pc.green("✓") + ` Logged in as ${pc.bold("@" + credentials.username)}`);
      console.log();
      console.log(pc.dim("Git credentials configured. You can now:"));
      console.log(pc.dim("  git clone https://api.strayl.dev/username/repo.git"));
      console.log(pc.dim("  git push origin main"));
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
  .description("Configure git to use Strayl credentials")
  .action(async () => {
    const credentials = getCredentials();

    if (!credentials) {
      console.log(pc.yellow("Not logged in"));
      console.log(pc.dim("Run 'st login' first"));
      process.exit(1);
    }

    const config = getConfig();
    const apiHost = new URL(config.apiUrl).host;

    const { execSync } = await import("node:child_process");

    try {
      // Configure git credential helper for strayl
      execSync(`git config --global credential.https://${apiHost}.helper strayl`, { stdio: "pipe" });
      console.log(pc.green("✓") + ` Git configured to use Strayl credentials for ${apiHost}`);
      console.log();
      console.log(pc.dim("You can now use git commands with Strayl repositories:"));
      console.log(pc.dim(`  git clone https://${apiHost}/username/repo.git`));
    } catch (error) {
      console.error(pc.red("✗") + " Failed to configure git");
      console.error(pc.dim("Make sure git is installed and accessible"));
      process.exit(1);
    }
  });

// ============ Parse & Run ============

program.parse();
