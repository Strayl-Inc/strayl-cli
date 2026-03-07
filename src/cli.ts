/**
 * Strayl CLI
 * Main entry point
 */

import { Command } from "commander";
import pc from "picocolors";
import { execSync, spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { homedir, userInfo } from "node:os";
import { join, basename } from "node:path";
import { login } from "./auth.js";
import { getCredentials, deleteCredentials, getConfig, saveConfig, getConfigDir, saveCredentials } from "./config.js";
import {
  ApiError,
  createProject,
  getProjectInfo,
  getRepoStatus,
  proposeChangeFromBranch,
  listChanges,
  getChange,
  mergeChange,
  denyChange,
  restackChange,
  promoteToMain,
  getProjectRole,
} from "./api.js";

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
  .version("0.2.3");

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
  .description("Clone a Strayl repository (auto-checks out dev)")
  .argument("[directory]", "Directory to clone into")
  .action(async (repo: string, directory?: string) => {
    const config = getConfig();

    // Parse repo: can be "username/repo" or full URL
    let repoUrl: string;
    let repoSlug = repo; // e.g. "alice/my-app"

    if (repo.includes("://")) {
      repoUrl = repo;
      // Extract slug from URL for display
      try {
        const u = new URL(repo);
        repoSlug = u.pathname.replace(/^\//, "").replace(/\.git$/, "");
      } catch {}
    } else {
      if (!repo.includes("/")) {
        console.error(pc.red("✗") + " Invalid repository format. Use: username/repo");
        process.exit(1);
      }
      repoUrl = `${config.apiUrl}/${repo}.git`;
    }

    // Determine target directory
    const cloneDir = directory ?? basename(repoUrl.replace(/\.git$/, ""));

    // Setup credentials if logged in (don't require login for public repos)
    setupGitCredentials();

    const { spawn } = await import("node:child_process");
    const args = ["clone", repoUrl];
    if (directory) args.push(directory);

    // Clone with stderr capture for error handling
    let stderrOutput = "";
    await new Promise<void>((resolve, reject) => {
      const child = spawn("git", args, {
        stdio: ["inherit", "inherit", "pipe"],
      });
      child.stderr?.on("data", (data: Buffer) => {
        stderrOutput += data.toString();
      });
      child.on("exit", (code) => {
        if (code === 0) resolve();
        else reject(new Error(`git clone exited with code ${code}`));
      });
    }).catch(() => {
      if (stderrOutput.includes("Authentication failed") || stderrOutput.includes("could not read Username")) {
        console.error(pc.red("✗") + " Authentication failed. Run 'st login' first");
      } else if (stderrOutput.includes("already exists and is not an empty directory")) {
        console.error(pc.red("✗") + ` Directory '${cloneDir}' already exists`);
      } else {
        // Show raw git error
        process.stderr.write(stderrOutput);
      }
      process.exit(1);
    });

    // Auto-checkout dev if it exists
    let currentBranch = "main";
    try {
      const devRef = execSync("git branch -r --list \"origin/dev\"", { cwd: cloneDir, stdio: "pipe" }).toString().trim();
      if (devRef) {
        try {
          execSync("git checkout dev", { cwd: cloneDir, stdio: "pipe" });
        } catch {
          // checkout failed — stay on default branch
        }
      }
    } catch {
      // branch listing failed (e.g. empty repo) — skip
    }

    try {
      currentBranch = execSync("git branch --show-current", { cwd: cloneDir, stdio: "pipe" }).toString().trim() || currentBranch;
    } catch {}

    // Post-clone summary
    console.log("");
    console.log(pc.green("✓") + ` Cloned ${pc.bold(repoSlug)}`);
    console.log("");
    console.log(`  Branch:  ${pc.cyan(currentBranch)}`);
    console.log(`  Path:    ${pc.dim(`./${cloneDir}`)}`);
    console.log("");
    console.log(`  cd ${cloneDir}`);
    console.log("");
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

// ============ Shared Helpers ============

/**
 * Get { username, slug } from the 'strayl' git remote URL.
 * e.g. https://api.strayl.dev/alice/myapp.git → { username: "alice", slug: "myapp" }
 * Falls back to any remote pointing to the configured Strayl API host.
 */
function getProjectFromRemote(): { username: string; slug: string } | null {
  const parseStraylUrl = (url: string) => {
    const apiHost = new URL(getConfig().apiUrl).host;
    if (!url.includes(apiHost)) return null;
    const match = url.match(/\/([^/]+)\/([^/]+?)(?:\.git)?$/);
    if (!match) return null;
    return { username: match[1], slug: match[2] };
  };

  // First, try the canonical 'strayl' remote
  try {
    const url = execSync("git remote get-url strayl", { stdio: "pipe" }).toString().trim();
    const result = parseStraylUrl(url);
    if (result) return result;
  } catch {
    // No 'strayl' remote — fall through to scan all remotes
  }

  // Fallback: find any remote pointing to the Strayl API
  try {
    const remotes = execSync("git remote", { stdio: "pipe" }).toString().trim().split("\n").filter(Boolean);
    for (const remote of remotes) {
      try {
        const url = execSync(`git remote get-url ${remote}`, { stdio: "pipe" }).toString().trim();
        const result = parseStraylUrl(url);
        if (result) return result;
      } catch {
        // skip
      }
    }
  } catch {
    // ignore
  }

  return null;
}

/**
 * Get the name of the git remote pointing to the Strayl API.
 * Prefers the canonical 'strayl' remote; falls back to any matching remote.
 */
function getStraylRemoteName(): string | null {
  const apiHost = new URL(getConfig().apiUrl).host;
  const isStraylUrl = (url: string) => url.includes(apiHost);

  try {
    const url = execSync("git remote get-url strayl", { stdio: "pipe" }).toString().trim();
    if (isStraylUrl(url)) return "strayl";
  } catch {
    // No 'strayl' remote
  }

  try {
    const remotes = execSync("git remote", { stdio: "pipe" }).toString().trim().split("\n").filter(Boolean);
    for (const remote of remotes) {
      try {
        const url = execSync(`git remote get-url ${remote}`, { stdio: "pipe" }).toString().trim();
        if (isStraylUrl(url)) return remote;
      } catch {
        // skip
      }
    }
  } catch {
    // ignore
  }

  return null;
}

/**
 * Ensure user is in a git repo, return true or print error and exit.
 */
function requireGitRepo(): void {
  try {
    execSync("git rev-parse --git-dir", { stdio: "pipe" });
  } catch {
    console.error(pc.red("✗") + " Not inside a git repository");
    process.exit(1);
  }
}

/**
 * Ensure user is NOT already linked to a Strayl remote.
 */
function requireNoStraylRemote(): void {
  const remoteName = getStraylRemoteName();
  if (remoteName) {
    console.error(pc.red("✗") + " Already linked to a Strayl project");
    console.error(pc.dim("  Run 'st status' to see the current project"));
    process.exit(1);
  }
}

/**
 * Convert a string into a URL-safe slug.
 */
function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100);
}

/**
 * Require login — prints error and exits if not authenticated.
 */
function requireLogin() {
  const creds = getCredentials();
  if (!creds) {
    console.error(pc.red("✗") + " Not logged in — run 'st login' first");
    process.exit(1);
  }
  return creds;
}

/**
 * Silently refresh the session token if it expires within 48 hours.
 * Updates expiresAt in ~/.strayl/credentials on success.
 */
async function tryRefreshToken(creds: NonNullable<ReturnType<typeof getCredentials>>): Promise<void> {
  const expiresAt = new Date(creds.expiresAt);
  const msUntilExpiry = expiresAt.getTime() - Date.now();
  const FORTY_EIGHT_HOURS = 48 * 60 * 60 * 1000;

  if (msUntilExpiry > FORTY_EIGHT_HOURS) return;

  const config = getConfig();

  try {
    const res = await fetch(`${config.apiUrl}/auth/refresh`, {
      method: "POST",
      headers: { Authorization: `Bearer ${creds.token}` },
    });

    if (res.ok) {
      const data = await res.json() as { expiresAt: string };
      saveCredentials({ ...creds, expiresAt: data.expiresAt });
    }
    // On 401 or other errors, silently continue — push will fail with auth error
  } catch {
    // Network error, silently continue
  }
}

/**
 * Require the strayl remote to exist and return username/slug.
 */
function requireStraylRemote(): { username: string; slug: string } {
  const remote = getProjectFromRemote();
  if (!remote) {
    console.error(pc.red("✗") + " No Strayl remote found");
    console.error(pc.dim("  Run 'st init' to create a project or 'st link' to link an existing one"));
    process.exit(1);
  }
  return remote;
}

/**
 * Format a date as a human-readable age string.
 */
function formatAge(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  return `${days}d`;
}

// ============ st init ============

program
  .command("init [name]")
  .description("Create a new Strayl project from this repository")
  .option("--name <name>", "Project name (defaults to current directory name)")
  .option("--private", "Create a private project (default: public)")
  .option("--description <d>", "Project description")
  .action(async (nameArg: string | undefined, options) => {
    requireGitRepo();
    requireNoStraylRemote();
    requireLogin();

    const config = getConfig();
    const cwd = process.cwd();
    const dirName = basename(cwd);
    const rawName = options.name || nameArg || dirName;
    const slug = slugify(rawName);

    if (!slug) {
      console.error(pc.red("✗") + ` Cannot derive a valid project slug from "${rawName}"`);
      process.exit(1);
    }

    const visibility: "public" | "private" = options.private ? "private" : "public";

    console.log(pc.bold("Creating Strayl project..."));

    let proj: any;
    try {
      const res = await createProject(rawName, slug, visibility, options.description) as any;
      proj = res.project;
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : String(err);
      console.error(pc.red("✗") + ` Failed to create project: ${msg}`);
      process.exit(1);
    }

    const remoteUrl = `${config.apiUrl}/${proj.ownerUsername}/${proj.slug}.git`;
    execSync(`git remote add strayl ${remoteUrl}`, { stdio: "pipe" });
    setupGitCredentials();

    console.log(pc.green("✓") + ` Project created: ${pc.cyan(`${config.appUrl}/${proj.ownerUsername}/${proj.slug}`)}`);
    console.log();

    // Ask whether to push to dev
    const { createInterface } = await import("node:readline");
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answer = await new Promise<string>((resolve) => {
      rl.question(pc.dim("Push current code to dev? [Y/n] "), resolve);
    });
    rl.close();

    if (!answer.trim() || answer.trim().toLowerCase() === "y") {
      console.log(pc.dim("Pushing to strayl dev..."));
      const push = spawnSync("git", ["push", "strayl", "HEAD:dev"], { stdio: "inherit" });
      if (push.status !== 0) {
        console.error(pc.yellow("⚠") + " Push failed. You can retry with: git push strayl HEAD:dev");
      } else {
        console.log(pc.green("✓") + " Pushed to dev");
      }
    }
  });

// ============ st link ============

program
  .command("link <project>")
  .description("Link this repository to an existing Strayl project")
  .option("--force-push", "Force-push local code to dev (only if dev is empty)")
  .action(async (projectArg: string, options) => {
    requireGitRepo();
    requireNoStraylRemote();
    requireLogin();

    if (!projectArg.includes("/")) {
      console.error(pc.red("✗") + " Use format: st link username/project");
      process.exit(1);
    }

    const [username, slug] = projectArg.split("/");
    const config = getConfig();

    let status: { isEmpty: boolean; branch: string };
    try {
      status = await getRepoStatus(username, slug, "dev");
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : String(err);
      console.error(pc.red("✗") + ` ${msg}`);
      process.exit(1);
    }

    if (!status.isEmpty) {
      console.error(pc.red("✗") + " Dev branch already has code.");
      console.error(pc.dim(`  Use 'st clone ${username}/${slug}' to get the existing repository.`));
      process.exit(1);
    }

    const remoteUrl = `${config.apiUrl}/${username}/${slug}.git`;
    execSync(`git remote add strayl ${remoteUrl}`, { stdio: "pipe" });
    setupGitCredentials();

    console.log(pc.green("✓") + ` Linked: ${pc.cyan(`${config.appUrl}/${username}/${slug}`)}`);
    console.log();

    // Ask whether to push current code
    const { createInterface } = await import("node:readline");
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answer = await new Promise<string>((resolve) => {
      rl.question(pc.dim("Push current code to dev? [Y/n] "), resolve);
    });
    rl.close();

    if (!answer.trim() || answer.trim().toLowerCase() === "y") {
      console.log(pc.dim("Pushing to strayl dev..."));
      const pushArgs = ["push", "strayl", "HEAD:dev"];
      if (options.forcePush) pushArgs.push("--force");
      const push = spawnSync("git", pushArgs, { stdio: "inherit" });
      if (push.status !== 0) {
        console.error(pc.yellow("⚠") + " Push failed. You can retry with: git push strayl HEAD:dev");
      } else {
        console.log(pc.green("✓") + " Pushed to dev");
      }
    }
  });

// ============ st push ============

program
  .command("push [branch]")
  .description("Push a branch and create a change proposal")
  .option("--title <t>", "Change title (defaults to last commit message)")
  .option("--description <d>", "Change description")
  .option("--no-change", "Just push the branch, skip creating a change")
  .action(async (branchArg: string | undefined, options) => {
    requireGitRepo();
    const creds = requireLogin();
    await tryRefreshToken(creds);
    const remote = requireStraylRemote();
    const remoteName = getStraylRemoteName()!;

    // Determine current branch
    let branch: string;
    try {
      branch = branchArg || execSync("git rev-parse --abbrev-ref HEAD", { stdio: "pipe" }).toString().trim();
    } catch {
      console.error(pc.red("✗") + " Cannot determine current branch");
      process.exit(1);
    }

    if (branch === "main" || branch === "dev") {
      console.error(pc.red("✗") + ` Cannot use 'st push' on branch '${branch}'`);
      if (branch === "main") console.error(pc.dim("  Use 'st promote' to promote dev to main"));
      if (branch === "dev") console.error(pc.dim("  Switch to a feature branch to propose changes"));
      process.exit(1);
    }

    // Get title from last commit message if not provided
    let title = options.title;
    if (!title) {
      try {
        title = execSync("git log -1 --pretty=%s", { stdio: "pipe" }).toString().trim();
      } catch {
        title = branch;
      }
    }

    // Ensure git credentials are in sync before pushing
    setupGitCredentials();

    // Push the branch
    console.log(pc.dim(`Pushing ${branch} to strayl...`));
    const { spawn } = await import("node:child_process");
    let stderrOutput = "";
    await new Promise<void>((resolve, reject) => {
      const child = spawn("git", ["push", remoteName, `${branch}:${branch}`], {
        stdio: ["inherit", "inherit", "pipe"],
      });
      child.stderr?.on("data", (data: Buffer) => {
        process.stderr.write(data);
        stderrOutput += data.toString();
      });
      child.on("exit", (code) => {
        if (code === 0) resolve();
        else reject(new Error(`git push exited with code ${code}`));
      });
    }).catch((err) => {
      if (stderrOutput.includes("Authentication failed") || stderrOutput.includes("could not read Username")) {
        console.error(pc.red("✗") + " Authentication failed. Run 'st logout && st login' to refresh credentials");
      } else {
        console.error(pc.red("✗") + ` Push failed: ${err.message}`);
      }
      process.exit(1);
    });

    console.log(pc.green("✓") + ` Pushed ${pc.bold(branch)} → ${remoteName}`);

    if (options.change === false) {
      return;
    }

    // Create change proposal
    console.log(pc.dim("Creating change proposal..."));
    try {
      const res = await proposeChangeFromBranch(
        remote.username,
        remote.slug,
        branch,
        title,
        options.description
      );
      console.log(pc.green("✓") + ` Change created: ${pc.cyan(res.changeUrl)}`);
      console.log(pc.dim(`  Status: ${res.change.status}`));
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : String(err);
      console.error(pc.red("✗") + ` Failed to create change: ${msg}`);
      process.exit(1);
    }
  });

// ============ st changes ============

program
  .command("changes")
  .description("List change proposals for this project")
  .option("--status <s>", "Filter by status (proposed|merged|denied|needs_restack)")
  .option("--mine", "Only show my changes")
  .action(async (options) => {
    requireGitRepo();
    requireLogin();
    const remote = requireStraylRemote();
    const creds = getCredentials()!;

    let res: { changes: any[] };
    try {
      res = await listChanges(remote.username, remote.slug, { status: options.status });
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : String(err);
      console.error(pc.red("✗") + ` ${msg}`);
      process.exit(1);
    }

    let items = res.changes;
    if (options.mine) {
      items = items.filter((ch: any) => ch.proposedBy === creds.username);
    }

    if (items.length === 0) {
      console.log(pc.dim("No changes found"));
      return;
    }

    // Print table
    const idW = 12, titleW = 30, statusW = 16, statsW = 12, authorW = 14, ageW = 5;
    const header = [
      pc.bold("ID".padEnd(idW)),
      pc.bold("TITLE".padEnd(titleW)),
      pc.bold("STATUS".padEnd(statusW)),
      pc.bold("+/-".padEnd(statsW)),
      pc.bold("AUTHOR".padEnd(authorW)),
      pc.bold("AGE"),
    ].join("  ");
    console.log(header);
    console.log(pc.dim("─".repeat(idW + titleW + statusW + statsW + authorW + ageW + 10)));

    for (const ch of items) {
      const stats = ch.additions != null ? `+${ch.additions}/-${ch.deletions ?? 0}` : "-";
      const statusColor = ch.status === "proposed" ? pc.cyan : ch.status === "merged" ? pc.green : ch.status === "denied" ? pc.red : pc.yellow;
      const age = ch.createdAt ? formatAge(ch.createdAt) : "-";
      const title = (ch.title || ch.chatTitle || "").slice(0, titleW);
      const id = (ch.id || "").slice(0, idW);
      console.log(
        [
          id.padEnd(idW),
          title.padEnd(titleW),
          statusColor((ch.status || "").padEnd(statusW)),
          stats.padEnd(statsW),
          (ch.proposedBy || "").slice(0, authorW).padEnd(authorW),
          age,
        ].join("  ")
      );
    }
  });

// ============ st change ============

program
  .command("change <id> [action]")
  .description("View or act on a change (actions: approve, deny, restack)")
  .action(async (changeId: string, action: string | undefined) => {
    requireGitRepo();
    requireLogin();
    const remote = requireStraylRemote();

    if (action === "approve") {
      try {
        await mergeChange(remote.username, remote.slug, changeId);
        console.log(pc.green("✓") + ` Change ${changeId} approved and merged`);
      } catch (err) {
        const msg = err instanceof ApiError ? err.message : String(err);
        console.error(pc.red("✗") + ` ${msg}`);
        process.exit(1);
      }
      return;
    }

    if (action === "deny") {
      try {
        await denyChange(remote.username, remote.slug, changeId);
        console.log(pc.green("✓") + ` Change ${changeId} denied`);
      } catch (err) {
        const msg = err instanceof ApiError ? err.message : String(err);
        console.error(pc.red("✗") + ` ${msg}`);
        process.exit(1);
      }
      return;
    }

    if (action === "restack") {
      try {
        await restackChange(remote.username, remote.slug, changeId);
        console.log(pc.green("✓") + ` Change ${changeId} restacked`);
      } catch (err) {
        const msg = err instanceof ApiError ? err.message : String(err);
        console.error(pc.red("✗") + ` ${msg}`);
        process.exit(1);
      }
      return;
    }

    // No action — show details
    try {
      const res = await getChange(remote.username, remote.slug, changeId);
      const ch = res.change;
      const config = getConfig();
      const statusColor = ch.status === "proposed" ? pc.cyan : ch.status === "merged" ? pc.green : ch.status === "denied" ? pc.red : pc.yellow;

      console.log(pc.bold(ch.title || ch.chatTitle || changeId));
      console.log(`Status:  ${statusColor(ch.status)}`);
      console.log(`Branch:  ${ch.branchName || "-"}`);
      console.log(`Author:  ${ch.proposedBy || "-"}`);
      if (ch.createdAt) console.log(`Age:     ${formatAge(ch.createdAt)}`);
      if (ch.description) {
        console.log();
        console.log(ch.description);
      }
      if (res.files && res.files.length > 0) {
        console.log();
        console.log(pc.bold("Files changed:"));
        for (const f of res.files) {
          const sign = f.status === "added" ? pc.green("+") : f.status === "deleted" ? pc.red("-") : pc.yellow("~");
          console.log(`  ${sign} ${f.path}`);
        }
      }
      console.log();
      console.log(pc.dim(`${config.appUrl}/${remote.username}/${remote.slug}?change=${ch.id}`));
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : String(err);
      console.error(pc.red("✗") + ` ${msg}`);
      process.exit(1);
    }
  });

// ============ st promote ============

program
  .command("promote")
  .description("Promote dev branch to main")
  .action(async () => {
    requireGitRepo();
    requireLogin();
    const remote = requireStraylRemote();

    console.log(pc.dim("Promoting dev → main..."));
    try {
      const res = await promoteToMain(remote.username, remote.slug) as any;
      if (res.success) {
        const sha = res.sha ? ` (sha: ${res.sha.slice(0, 7)})` : "";
        console.log(pc.green("✓") + ` Promoted dev → main${sha}`);
      } else {
        console.error(pc.red("✗") + ` Promote failed: ${res.error || "Unknown error"}`);
        process.exit(1);
      }
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : String(err);
      console.error(pc.red("✗") + ` ${msg}`);
      process.exit(1);
    }
  });

// ============ st pull ============

program
  .command("pull [target]")
  .description("Pull from dev or main (default: dev)")
  .action(async (target: string | undefined) => {
    requireGitRepo();
    requireLogin();
    requireStraylRemote();

    const branch = target === "main" ? "main" : "dev";
    const remoteName = getStraylRemoteName()!;

    const { spawn } = await import("node:child_process");
    // Fetch and merge
    await new Promise<void>((resolve, reject) => {
      const child = spawn("git", ["fetch", remoteName], { stdio: "inherit" });
      child.on("exit", (code) => code === 0 ? resolve() : reject(new Error(`fetch failed`)));
    }).catch((err) => {
      console.error(pc.red("✗") + ` ${err.message}`);
      process.exit(1);
    });

    await new Promise<void>((resolve, reject) => {
      const child = spawn("git", ["merge", `${remoteName}/${branch}`], { stdio: "inherit" });
      child.on("exit", (code) => code === 0 ? resolve() : reject(new Error(`merge failed`)));
    }).catch((err) => {
      console.error(pc.red("✗") + ` ${err.message}`);
      process.exit(1);
    });
  });

// ============ st status ============

program
  .command("status")
  .description("Show project and change status")
  .action(async () => {
    requireGitRepo();
    requireLogin();
    const remote = requireStraylRemote();
    const config = getConfig();

    let currentBranch = "";
    try {
      currentBranch = execSync("git rev-parse --abbrev-ref HEAD", { stdio: "pipe" }).toString().trim();
    } catch {
      currentBranch = "(unknown)";
    }

    let projInfo: any;
    let changesRes: { changes: any[] };

    try {
      [projInfo, changesRes] = await Promise.all([
        getProjectInfo(remote.username, remote.slug) as Promise<any>,
        listChanges(remote.username, remote.slug, { status: "proposed" }),
      ]);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : String(err);
      console.error(pc.red("✗") + ` ${msg}`);
      process.exit(1);
    }

    const proj = projInfo?.project;

    console.log(pc.bold("Project:") + ` ${remote.username}/${remote.slug} → ${pc.cyan(`${config.appUrl}/${remote.username}/${remote.slug}`)}`);
    console.log(pc.bold("Branch: ") + ` ${currentBranch}`);
    if (proj?.visibility) console.log(pc.bold("Visibility:") + ` ${proj.visibility}`);
    console.log();

    const pending = changesRes.changes;
    if (pending.length === 0) {
      console.log(pc.dim("No pending changes"));
    } else {
      console.log(pc.bold(`Pending changes (${pending.length}):`));
      for (const ch of pending) {
        const warning = ch.status === "needs_restack" ? pc.yellow(" ⚠") : "";
        const id = (ch.id || "").slice(0, 10).padEnd(12);
        const title = (ch.title || ch.chatTitle || "").slice(0, 40).padEnd(40);
        console.log(`  ${id}  ${title}  ${pc.cyan(ch.status)}${warning}`);
      }
    }
  });

// ============ st mcp-init ============

program
  .command("mcp-init")
  .description("Install the Strayl MCP server into your coding agents")
  .option("-y, --yes", "Skip all prompts, auto-detect agents")
  .option("-g, --global", "Install globally (user directory) instead of project")
  .option("-a, --agent <agent>", "Target specific agent (repeatable): claude-code, cursor, vscode, zed...", (v, prev: string[]) => [...prev, v], [] as string[])
  .option("--all", "Install to all supported agents")
  .option("--name <name>", "MCP server name", "strayl")
  .option("--transport <type>", "Transport type: http (default) or sse", "http")
  .addHelpText("after", `
Examples:
  $ st mcp-init                        Interactive — auto-detects agents
  $ st mcp-init -y                     Auto-detect, skip prompts
  $ st mcp-init -a claude-code -y      Install to Claude Code only
  $ st mcp-init -a cursor -a vscode    Install to Cursor and VS Code
  $ st mcp-init --all -g -y            Install globally to all agents

Supported agents: claude-code, claude-desktop, cursor, vscode, zed, codex, opencode, gemini-cli, goose, github-copilot-cli`)
  .action((options) => {
    const MCP_URL = "https://api.strayl.dev/mcp";

    const args: string[] = ["add-mcp", MCP_URL, "--name", options.name];

    if (options.transport && options.transport !== "http") {
      args.push("--transport", options.transport);
    }
    if (options.all) args.push("--all");
    if (options.global) args.push("-g");
    if (options.yes) args.push("-y");
    for (const agent of options.agent) {
      args.push("-a", agent);
    }

    console.log(pc.bold("Installing Strayl MCP server..."));
    console.log(pc.dim(`  npx ${args.join(" ")}`));
    console.log();

    const result = spawnSync("npx", args, { stdio: "inherit" });
    process.exit(result.status ?? 0);
  });

// ============ Parse & Run ============

program.parse();
