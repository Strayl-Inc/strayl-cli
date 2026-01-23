/**
 * Authentication module
 * Handles OAuth flow with browser redirect
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { URL } from "node:url";
import open from "open";
import pc from "picocolors";
import { getConfig, saveCredentials, type Credentials } from "./config.js";

const CALLBACK_PORT = 9876;
const CALLBACK_PATH = "/callback";

interface AuthCallbackData {
  token: string;
  username: string;
  email: string;
  expiresAt: string;
  error?: string;
}

/**
 * Start OAuth login flow
 * Opens browser and waits for callback
 */
export async function login(): Promise<Credentials> {
  const config = getConfig();

  return new Promise((resolve, reject) => {
    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
      const url = new URL(req.url || "/", `http://localhost:${CALLBACK_PORT}`);

      if (url.pathname === CALLBACK_PATH) {
        // Parse callback data
        const token = url.searchParams.get("token");
        const username = url.searchParams.get("username");
        const email = url.searchParams.get("email");
        const expiresAt = url.searchParams.get("expires_at");
        const error = url.searchParams.get("error");

        if (error) {
          // Send error response
          res.writeHead(200, { "Content-Type": "text/html" });
          res.end(getErrorHtml(error));

          server.close();
          reject(new Error(error));
          return;
        }

        if (!token || !username || !email || !expiresAt) {
          res.writeHead(200, { "Content-Type": "text/html" });
          res.end(getErrorHtml("Missing required fields in callback"));

          server.close();
          reject(new Error("Invalid callback data"));
          return;
        }

        const credentials: Credentials = {
          token,
          username,
          email,
          expiresAt,
        };

        // Save credentials
        saveCredentials(credentials);

        // Send success response
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(getSuccessHtml(username));

        server.close();
        resolve(credentials);
      } else {
        res.writeHead(404);
        res.end("Not Found");
      }
    });

    server.listen(CALLBACK_PORT, "127.0.0.1", () => {
      const callbackUrl = `http://localhost:${CALLBACK_PORT}${CALLBACK_PATH}`;
      const loginUrl = `${config.appUrl}/cli-login?callback=${encodeURIComponent(callbackUrl)}`;

      console.log(pc.dim("Opening browser for authentication..."));
      console.log(pc.dim(`If browser doesn't open, visit: ${loginUrl}`));

      open(loginUrl).catch(() => {
        console.log(pc.yellow(`Please open this URL in your browser:`));
        console.log(pc.cyan(loginUrl));
      });
    });

    // Timeout after 5 minutes
    setTimeout(() => {
      server.close();
      reject(new Error("Login timeout - please try again"));
    }, 5 * 60 * 1000);
  });
}

/**
 * Verify token is still valid
 */
export async function verifyToken(token: string): Promise<{ valid: boolean; user?: { username: string; email: string } }> {
  const config = getConfig();

  try {
    const response = await fetch(`${config.apiUrl}/auth/verify`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (!response.ok) {
      return { valid: false };
    }

    const data = await response.json() as { user: { username: string; email: string } };
    return { valid: true, user: data.user };
  } catch {
    return { valid: false };
  }
}

function getSuccessHtml(username: string): string {
  return `
<!DOCTYPE html>
<html>
<head>
  <title>Strayl - Login Successful</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 100vh;
      margin: 0;
      background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
      color: white;
    }
    .container {
      text-align: center;
      padding: 2rem;
    }
    .icon {
      font-size: 4rem;
      margin-bottom: 1rem;
    }
    h1 {
      margin: 0 0 0.5rem 0;
      font-size: 1.5rem;
    }
    p {
      margin: 0;
      opacity: 0.8;
    }
    .username {
      color: #4ade80;
      font-weight: 600;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="icon">✓</div>
    <h1>Login Successful!</h1>
    <p>Logged in as <span class="username">@${username}</span></p>
    <p style="margin-top: 1rem; font-size: 0.875rem;">You can close this window and return to the terminal.</p>
  </div>
</body>
</html>
`;
}

function getErrorHtml(error: string): string {
  return `
<!DOCTYPE html>
<html>
<head>
  <title>Strayl - Login Failed</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 100vh;
      margin: 0;
      background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
      color: white;
    }
    .container {
      text-align: center;
      padding: 2rem;
    }
    .icon {
      font-size: 4rem;
      margin-bottom: 1rem;
    }
    h1 {
      margin: 0 0 0.5rem 0;
      font-size: 1.5rem;
    }
    p {
      margin: 0;
      opacity: 0.8;
      color: #f87171;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="icon">✗</div>
    <h1>Login Failed</h1>
    <p>${error}</p>
    <p style="margin-top: 1rem; font-size: 0.875rem;">Please try again in the terminal.</p>
  </div>
</body>
</html>
`;
}
