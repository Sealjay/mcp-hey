import { existsSync } from "node:fs"
import { chmod } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { spawn } from "bun"

const __dirname = dirname(fileURLToPath(import.meta.url))
const DATA_DIR = join(__dirname, "..", "data")
const COOKIES_PATH = join(DATA_DIR, "hey-cookies.json")
const AUTH_SCRIPT = join(__dirname, "..", "auth", "hey-auth.py")

export interface Cookie {
  name: string
  value: string
  domain: string
  path: string
  expiry?: number
}

export interface Session {
  cookies: Cookie[]
  lastValidated: number
}

async function ensureDataDir(): Promise<void> {
  if (!existsSync(DATA_DIR)) {
    await Bun.write(join(DATA_DIR, ".gitkeep"), "")
  }
}

export async function loadSession(): Promise<Session | null> {
  try {
    if (!existsSync(COOKIES_PATH)) {
      return null
    }
    const file = Bun.file(COOKIES_PATH)
    const content = await file.text()
    return JSON.parse(content) as Session
  } catch {
    return null
  }
}

export async function saveSession(session: Session): Promise<void> {
  await ensureDataDir()
  await Bun.write(COOKIES_PATH, JSON.stringify(session, null, 2))
  // Set file permissions to 600 (user read/write only)
  await chmod(COOKIES_PATH, 0o600)
}

export function getCookieHeader(session: Session): string {
  return session.cookies.map((c) => `${c.name}=${c.value}`).join("; ")
}

export async function validateSession(session: Session): Promise<boolean> {
  try {
    const cookieHeader = getCookieHeader(session)
    const response = await fetch("https://app.hey.com/my/entries", {
      method: "HEAD",
      headers: {
        Host: "app.hey.com",
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
        Cookie: cookieHeader,
      },
      redirect: "manual",
    })

    // If we get redirected to sign_in, session is invalid
    const location = response.headers.get("location")
    if (location?.includes("/sign_in")) {
      return false
    }

    // Check if we got a successful response
    return response.status === 200
  } catch {
    return false
  }
}

export async function runAuthHelper(): Promise<boolean> {
  console.error("[hey-mcp] Starting authentication helper...")

  const proc = spawn({
    cmd: ["python3", AUTH_SCRIPT],
    stdout: "inherit",
    stderr: "inherit",
  })

  const exitCode = await proc.exited

  if (exitCode === 0) {
    console.error("[hey-mcp] Authentication successful")
    return true
  }
  console.error(`[hey-mcp] Authentication failed with code ${exitCode}`)
  return false
}

export async function ensureValidSession(): Promise<Session | null> {
  let session = await loadSession()

  if (session) {
    const isValid = await validateSession(session)
    if (isValid) {
      // Update last validated timestamp
      session.lastValidated = Date.now()
      await saveSession(session)
      return session
    }
    console.error("[hey-mcp] Session expired, re-authenticating...")
  } else {
    console.error("[hey-mcp] No session found, starting authentication...")
  }

  // Need to authenticate
  const success = await runAuthHelper()
  if (!success) {
    return null
  }

  // Load the new session
  session = await loadSession()
  return session
}
