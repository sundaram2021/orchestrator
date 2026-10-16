import { mkdirSync, writeFileSync, symlinkSync, existsSync, rmSync, readlinkSync } from "node:fs";
import http from "node:http";
import path from "node:path";
import os from "node:os";

export const ANTIGRAVITY_AUTH_STDOUT_PREFIX =
  "Open the following link to authenticate the ACP server: ";
export const ANTIGRAVITY_AUTH_BROWSER_MARKER = "__ORCH_ANTIGRAVITY_AUTH_URL__";
export const ANTIGRAVITY_SIGN_IN_REQUIRED_MESSAGE =
  "Sign in to Antigravity before you continue.";

export type AntigravityAuthMethod =
  | "oauth-personal"
  | "oauth-business"
  | "gemini-api-key"
  | "agent-platform";

export interface AntigravityAuthConfig {
  authMethod: AntigravityAuthMethod;
  apiKey: string;
  gcpProject: string;
  gcpLocation: string;
}

export const ANTIGRAVITY_PERSONAL_AUTH: AntigravityAuthConfig = {
  authMethod: "oauth-personal",
  apiKey: "",
  gcpProject: "",
  gcpLocation: "",
};

export interface AntigravityProfile {
  geminiHome: string;
  acpDirectory: string;
  tokenPath: string;
  tempDirectory: string;
  browserCommand: string;
}

export function acpDirectoryFor(profileDirectory: string): string {
  return path.join(path.resolve(profileDirectory), "antigravity-acp");
}

export function tokenPathFor(profileDirectory: string): string {
  return path.join(acpDirectoryFor(profileDirectory), "acp_token.json");
}

export function hasCredentials(profileDirectory: string): boolean {
  return existsSync(tokenPathFor(profileDirectory));
}

const removedEnvironmentKeys = new Set([
  "GEMINI_API_KEY",
  "GOOGLE_API_KEY",
  "GOOGLE_APPLICATION_CREDENTIALS",
  "GOOGLE_CLOUD_PROJECT",
  "GOOGLE_CLOUD_LOCATION",
  "GOOGLE_CLOUD_QUOTA_PROJECT",
  "GOOGLE_GENAI_USE_VERTEXAI",
  "GCLOUD_PROJECT",
  "CLOUDSDK_CORE_PROJECT",
  "AGY_ACP_CCPA_PROJECT",
  "AGY_ACP_ENABLE_OAUTH",
  "GEMINI_HOME",
  "AGY_ACP_FORCE_FILE_STORAGE",
  "ANTIGRAVITY_HARNESS_PATH",
  "BROWSER",
  "PYTHONUNBUFFERED",
  "ELECTRON_RUN_AS_NODE",
]);

const browserHelperSource =
  `process.stderr.on("error",()=>process.exit(0)).write(` +
  `"${ANTIGRAVITY_AUTH_BROWSER_MARKER}"+JSON.stringify(process.argv[1])+"\\n",` +
  `()=>process.exit(0))`;

function quoteBrowserArgument(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

export function browserCommandFor(nodeExecutable: string): string {
  const helper =
    process.platform === "win32" ? nodeExecutable.replaceAll("\\", "/") : nodeExecutable;
  return [helper, "-e", browserHelperSource, "--", "%s"].map(quoteBrowserArgument).join(" ");
}

export interface PreparedProfile {
  profile: AntigravityProfile;
  env: NodeJS.ProcessEnv;
}

export function prepareProfile(input: {
  profileDirectory: string;
  harnessPath: string;
  baseEnv?: NodeJS.ProcessEnv;
  auth?: AntigravityAuthConfig;
  runtimeTempDirectory?: string;
  nodeExecutable?: string;
}): PreparedProfile {
  const auth = input.auth ?? ANTIGRAVITY_PERSONAL_AUTH;
  const geminiHome = path.resolve(input.profileDirectory);
  const acpDirectory = path.join(geminiHome, "antigravity-acp");
  const tempDirectory = input.runtimeTempDirectory ?? path.join(acpDirectory, "tmp");
  const browserCommand = browserCommandFor(input.nodeExecutable ?? process.execPath);

  const profile: AntigravityProfile = {
    geminiHome,
    acpDirectory,
    tokenPath: path.join(acpDirectory, "acp_token.json"),
    tempDirectory,
    browserCommand,
  };

  for (const dir of [geminiHome, acpDirectory, tempDirectory]) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(
    path.join(acpDirectory, "settings.json"),
    `${JSON.stringify({ auth: { type: auth.authMethod } })}\n`,
  );
  linkUserSkills(geminiHome);

  return { profile, env: profileEnvironment(profile, input, auth) };
}

function profileEnvironment(
  profile: AntigravityProfile,
  input: { harnessPath: string; baseEnv?: NodeJS.ProcessEnv },
  auth: AntigravityAuthConfig,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(input.baseEnv ?? process.env)) {
    if (!removedEnvironmentKeys.has(key.toUpperCase())) env[key] = value;
  }
  const credential =
    auth.authMethod === "gemini-api-key" && auth.apiKey
      ? { GEMINI_API_KEY: auth.apiKey }
      : auth.authMethod === "agent-platform" && auth.apiKey
        ? { GOOGLE_API_KEY: auth.apiKey }
        : {};
  return {
    ...env,
    ...credential,
    GEMINI_HOME: profile.geminiHome,
    AGY_ACP_FORCE_FILE_STORAGE: "1",
    BROWSER: profile.browserCommand,
    PYTHONUNBUFFERED: "1",
    ELECTRON_RUN_AS_NODE: "1",
    ANTIGRAVITY_HARNESS_PATH: input.harnessPath,
    ...(process.platform === "win32"
      ? { TEMP: profile.tempDirectory, TMP: profile.tempDirectory }
      : { TMPDIR: profile.tempDirectory }),
  };
}

function linkUserSkills(profileDirectory: string): void {
  const targets = [
    path.join(os.homedir(), ".gemini", "config", "skills"),
    path.join(os.homedir(), ".gemini", "antigravity-cli", "skills"),
  ];
  const links = [
    path.join(profileDirectory, ".gemini", "config", "skills"),
    path.join(profileDirectory, ".gemini", "antigravity-cli", "skills"),
  ];
  for (let i = 0; i < links.length; i += 1) {
    const link = links[i]!;
    const target = targets[i]!;
    try {
      if (existsSync(link)) {
        if (readlinkSync(link) === target) continue;
        rmSync(link, { recursive: true, force: true });
      }
      if (!existsSync(target)) continue;
      mkdirSync(path.dirname(link), { recursive: true });
      symlinkSync(target, link, process.platform === "win32" ? "junction" : "dir");
    } catch {
      /* user skills are best effort */
    }
  }
}

export interface AntigravityAuthorizationUrl {
  authorizationUrl: string;
  redirectUri: string;
  state: string;
}

export function parseAuthorizationUrl(value: string): AntigravityAuthorizationUrl | null {
  const raw = value.trim();
  if (!raw || raw.length > 16_384 || /\s/.test(raw)) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  const state = url.searchParams.get("state");
  const redirectUri = url.searchParams.get("redirect_uri");
  if (
    url.origin !== "https://accounts.google.com" ||
    url.pathname !== "/o/oauth2/v2/auth" ||
    url.username !== "" ||
    url.password !== "" ||
    url.hash !== "" ||
    url.searchParams.getAll("state").length !== 1 ||
    url.searchParams.getAll("redirect_uri").length !== 1 ||
    url.searchParams.get("response_type") !== "code" ||
    !state ||
    state.length > 512 ||
    /\s/.test(state) ||
    !redirectUri ||
    !/^http:\/\/127\.0\.0\.1:[1-9][0-9]{0,4}\/$/.test(redirectUri)
  ) {
    return null;
  }
  const redirect = new URL(redirectUri);
  if (Number(redirect.port) < 1_024) return null;
  return { authorizationUrl: raw, redirectUri, state };
}

export function parseAuthorizationLine(line: string): AntigravityAuthorizationUrl | null {
  const message = line.endsWith("\r") ? line.slice(0, -1) : line;
  if (message.startsWith(ANTIGRAVITY_AUTH_STDOUT_PREFIX)) {
    return parseAuthorizationUrl(message.slice(ANTIGRAVITY_AUTH_STDOUT_PREFIX.length));
  }
  if (message.startsWith(ANTIGRAVITY_AUTH_BROWSER_MARKER)) {
    const rest = message.slice(ANTIGRAVITY_AUTH_BROWSER_MARKER.length);
    try {
      const decoded = JSON.parse(rest) as unknown;
      if (typeof decoded === "string") return parseAuthorizationUrl(decoded);
    } catch {
      return null;
    }
  }
  return null;
}

export function forwardCallback(callbackUrl: string, timeoutMs = 10_000): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const done = (ok: boolean) => {
      if (settled) return;
      settled = true;
      resolve(ok);
    };
    let url: URL;
    try {
      url = new URL(callbackUrl);
    } catch {
      done(false);
      return;
    }
    const request = http.request(
      {
        protocol: "http:",
        hostname: url.hostname,
        port: url.port,
        path: `${url.pathname}${url.search}`,
        method: "GET",
        agent: false,
      },
      (incoming) => {
        incoming.once("end", () => {
          const status = incoming.statusCode ?? 0;
          done(status >= 200 && status < 300);
        });
        incoming.resume();
      },
    );
    request.once("error", () => done(false));
    request.setTimeout(timeoutMs, () => {
      request.destroy();
      done(false);
    });
    request.end();
  });
}
