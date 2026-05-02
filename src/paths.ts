import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = dirname(fileURLToPath(import.meta.url))
export const PROJECT_ROOT = join(__dirname, "..")
export const DATA_DIR = join(PROJECT_ROOT, "data")
export const AUTH_DIR = join(PROJECT_ROOT, "auth")
