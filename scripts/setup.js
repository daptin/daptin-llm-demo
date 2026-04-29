#!/usr/bin/env node

/**
 * Setup script: authenticates with Daptin, creates credential + llm_provider records.
 * Idempotent — skips if provider already exists.
 */

const fs = require("fs");
const path = require("path");

const rootDir = path.resolve(__dirname, "..");
const envPath = path.join(rootDir, ".env.local");

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const values = {};
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx === -1) continue;
    values[trimmed.slice(0, idx)] = trimmed.slice(idx + 1);
  }
  return values;
}

const fileEnv = loadEnvFile(envPath);
function env(key, fallback) {
  return process.env[key] || fileEnv[key] || fallback || "";
}

const DAPTIN_API = env("DAPTIN_API_URL", env("DAPTIN_BASE_URL", "http://localhost:6336"));
const ADMIN_EMAIL = env("DAPTIN_ADMIN_EMAIL", "admin@example.com");
const ADMIN_PASSWORD = env("DAPTIN_ADMIN_PASSWORD", "admin");
const PROVIDER_TYPE = env("LLM_PROVIDER_TYPE", "openai");
const PROVIDER_NAME = env("LLM_PROVIDER_NAME", PROVIDER_TYPE);
const MODELS = env("LLM_MODELS", "gpt-4o-mini");
const API_KEY = env("LLM_API_KEY", "");
const BASE_URL = env("LLM_BASE_URL", "");

async function jsonApi(method, path, body, token) {
  const headers = { "Content-Type": "application/vnd.api+json" };
  if (token) headers["Authorization"] = "Bearer " + token;
  const url = DAPTIN_API + path;
  console.log(`[setup] ${method} ${url}`);
  const res = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) {
    console.error(`[setup] HTTP ${res.status}: ${text.slice(0, 300)}`);
    return null;
  }
  try { return JSON.parse(text); } catch { return text; }
}

async function signIn() {
  console.log(`[setup] signing in as ${ADMIN_EMAIL}`);
  const res = await jsonApi("POST", "/action/user_account/signin", {
    data: {
      type: "user_account",
      attributes: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
    },
  });
  if (!res) throw new Error("sign-in failed");
  const responses = res.data || res;
  for (const r of Array.isArray(responses) ? responses : [responses]) {
    const attrs = r.attributes || r;
    if (attrs.key === "token" || attrs.token) {
      return attrs.value || attrs.token;
    }
  }
  throw new Error("sign-in response did not contain token");
}

async function findByName(table, name, token) {
  const res = await jsonApi("GET", `/api/${table}?filter[name]=${encodeURIComponent(name)}`, null, token);
  if (!res || !res.data) return null;
  const items = Array.isArray(res.data) ? res.data : [res.data];
  return items.find((d) => d.attributes && d.attributes.name === name) || null;
}

async function main() {
  if (!API_KEY) {
    console.log("[setup] LLM_API_KEY not set — skipping provider setup. Set it in .env.local or environment.");
    return;
  }

  const token = await signIn();
  console.log("[setup] authenticated");

  // 1. Create credential (if missing)
  const credName = PROVIDER_NAME + "-key";
  let cred = await findByName("credential", credName, token);
  if (!cred) {
    console.log(`[setup] creating credential: ${credName}`);
    const body = {
      data: {
        type: "credential",
        attributes: {
          name: credName,
          content: JSON.stringify({ api_key: API_KEY }),
        },
      },
    };
    const res = await jsonApi("POST", "/api/credential", body, token);
    cred = res && res.data ? (Array.isArray(res.data) ? res.data[0] : res.data) : null;
    if (!cred) throw new Error("failed to create credential");
    console.log(`[setup] credential created: ${cred.id}`);
  } else {
    console.log(`[setup] credential exists: ${cred.id}`);
  }

  // 2. Create llm_provider (if missing)
  let prov = await findByName("llm_provider", PROVIDER_NAME, token);
  if (!prov) {
    console.log(`[setup] creating llm_provider: ${PROVIDER_NAME}`);
    const attrs = {
      name: PROVIDER_NAME,
      provider_type: PROVIDER_TYPE,
      models: MODELS,
      credential_name: credName,
      enable: true,
    };
    if (BASE_URL) attrs.base_url = BASE_URL;
    const res = await jsonApi("POST", "/api/llm_provider", { data: { type: "llm_provider", attributes: attrs } }, token);
    prov = res && res.data ? (Array.isArray(res.data) ? res.data[0] : res.data) : null;
    if (!prov) throw new Error("failed to create llm_provider");
    console.log(`[setup] provider created: ${prov.id}`);
  } else {
    console.log(`[setup] provider exists: ${prov.id}`);
  }

  // 3. Link credential via relationship
  console.log(`[setup] linking credential ${cred.id} to provider ${prov.id}`);
  await jsonApi("PATCH", `/api/llm_provider/${prov.id}`, {
    data: {
      type: "llm_provider",
      id: prov.id,
      relationships: {
        credential_id: { data: { type: "credential", id: cred.id } },
      },
    },
  }, token);

  console.log("[setup] done — provider ready. Restart Daptin if this is the first time.");
}

main().catch((err) => {
  console.error("[setup] FATAL:", err.message);
  process.exit(1);
});
