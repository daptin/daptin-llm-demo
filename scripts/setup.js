#!/usr/bin/env node

/** Idempotently creates a complete Daptin v0.13+ LLM gateway catalog. */

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
    const index = trimmed.indexOf("=");
    if (index !== -1) values[trimmed.slice(0, index)] = trimmed.slice(index + 1);
  }
  return values;
}

const fileEnv = loadEnvFile(envPath);
const env = (key, fallback = "") => process.env[key] || fileEnv[key] || fallback;
const api = env("DAPTIN_API_URL", env("DAPTIN_BASE_URL", "http://localhost:6336")).replace(/\/$/, "");
const adminEmail = env("DAPTIN_ADMIN_EMAIL", "admin@example.com");
const adminPassword = env("DAPTIN_ADMIN_PASSWORD", "admin");
const providerType = env("LLM_PROVIDER_TYPE", "openai");
const providerName = env("LLM_PROVIDER_NAME", providerType + "-primary");
const publicModel = env("LLM_PUBLIC_MODEL", "assistant");
const upstreamModel = env("LLM_UPSTREAM_MODEL", "gpt-4o-mini");
const apiKey = env("LLM_API_KEY");
const baseURL = env("LLM_BASE_URL");
const operations = parseJSON("LLM_OPERATIONS", '["chat"]', Array.isArray);
const capabilities = parseJSON("LLM_CAPABILITIES", '{"tools":true}', isObject);

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseJSON(name, fallback, validate) {
  let value;
  try { value = JSON.parse(env(name, fallback)); } catch { throw new Error(`${name} must be valid JSON`); }
  if (!validate(value)) throw new Error(`${name} has the wrong JSON shape`);
  return value;
}

async function jsonApi(method, requestPath, body, token, tolerateFailure = false) {
  const response = await fetch(api + requestPath, {
    method,
    headers: {
      "Content-Type": "application/vnd.api+json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let payload = null;
  try { payload = text ? JSON.parse(text) : null; } catch { payload = null; }
  if (!response.ok && !tolerateFailure) throw new Error(`${method} ${requestPath} failed with HTTP ${response.status}`);
  return { ok: response.ok, payload };
}

function tokenFrom(response) {
  const raw = response && response.payload;
  const values = raw && (raw.data || raw);
  for (const item of Array.isArray(values) ? values : [values]) {
    const attributes = item && (item.Attributes || item.attributes || item);
    if (attributes && (attributes.key === "token" || attributes.token)) return attributes.value || attributes.token;
  }
  return "";
}

async function signIn() {
  const signinBody = { attributes: { email: adminEmail, password: adminPassword } };
  let response = await jsonApi("POST", "/action/user_account/signin", signinBody, "", true);
  let token = tokenFrom(response);
  if (token) return token;
  await jsonApi("POST", "/action/user_account/signup", {
    attributes: {
      email: adminEmail,
      name: "Daptin Administrator",
      password: adminPassword,
      passwordConfirm: adminPassword,
    },
  });
  response = await jsonApi("POST", "/action/user_account/signin", signinBody);
  token = tokenFrom(response);
  if (!token) throw new Error("sign-in response did not contain a token");
  await jsonApi("POST", "/action/world/become_an_administrator", {}, token);
  return token;
}

async function findByName(type, name, token) {
  const response = await jsonApi("GET", `/api/${type}?filter[name]=${encodeURIComponent(name)}`, undefined, token);
  const data = response.payload && response.payload.data;
  return (Array.isArray(data) ? data : [data]).find((item) => item && item.attributes && item.attributes.name === name) || null;
}

async function upsert(type, name, attributes, relationships, token) {
  const existing = await findByName(type, name, token);
  const data = {
    type,
    ...(existing ? { id: existing.id } : {}),
    attributes: { ...attributes, name },
    ...(relationships ? { relationships } : {}),
  };
  const response = await jsonApi(existing ? "PATCH" : "POST", existing ? `/api/${type}/${existing.id}` : `/api/${type}`, { data }, token);
  const result = response.payload && response.payload.data;
  return (Array.isArray(result) ? result[0] : result) || existing;
}

async function main() {
  if (!apiKey) {
    console.log("[setup] LLM_API_KEY is not set; catalog setup skipped");
    return;
  }
  const token = await signIn();
  console.log("[setup] authenticated");

  const credential = await upsert("credential", providerName + "-key", {
    content: JSON.stringify({ api_key: apiKey }),
  }, null, token);
  const provider = await upsert("llm_provider", providerName, {
    provider_type: providerType,
    base_url: baseURL,
    provider_parameters: "{}",
    allow_insecure: baseURL.startsWith("http://"),
    allow_private_network: /^(https?:\/\/)?(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(baseURL),
    enable: true,
  }, { credential_id: { data: { type: "credential", id: credential.id } } }, token);
  const model = await upsert("llm_model", publicModel, {
    operations: JSON.stringify(operations),
    capabilities: JSON.stringify(capabilities),
    routing_strategy: "priority_weighted",
    fallback_models: "[]",
    default_parameters: "{}",
    unsupported_parameter_policy: "reject",
    enable: true,
  }, null, token);
  await upsert("llm_deployment", `${publicModel}-${providerName}`, {
    upstream_model: upstreamModel,
    operations: JSON.stringify(operations),
    priority: 0,
    weight: 1,
    request_timeout_ms: 90000,
    connect_timeout_ms: 10000,
    max_concurrency: 20,
    rpm: -1,
    tpm: -1,
    pricing: "{}",
    parameters: "{}",
    health_check: "{}",
    enable: true,
  }, {
    llm_model_id: { data: { type: "llm_model", id: model.id } },
    llm_provider_id: { data: { type: "llm_provider", id: provider.id } },
  }, token);

  for (let attempt = 0; attempt < 30; attempt++) {
    const response = await jsonApi("GET", "/v1/models", undefined, token, true);
    const models = response.payload && response.payload.data;
    if (response.ok && Array.isArray(models) && models.some((entry) => entry.id === publicModel)) {
      console.log(`[setup] gateway ready with public model ${publicModel}`);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`public model ${publicModel} did not become ready`);
}

main().catch((error) => {
  console.error(`[setup] ${error.message}`);
  process.exitCode = 1;
});
