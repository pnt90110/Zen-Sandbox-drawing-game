require("dotenv").config();

const path = require("path");
const express = require("express");
const helmet = require("helmet");
const { auth, requiresAuth } = require("express-openid-connect");
const { createStateService } = require("./services/stateService");
const { createApiController } = require("./controllers/apiController");
const { createApiRouter } = require("./routes/apiRoutes");
const { createStateRateLimiters } = require("./middleware/rateLimiters");

const PORT = Number(process.env.PORT || 8000);
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;
const OIDC_SCOPE = process.env.OIDC_SCOPE || "openid profile email";
const OIDC_REDIRECT_URI = process.env.OIDC_REDIRECT_URI || `${BASE_URL}/callback`;
const OIDC_CORS_ORIGIN = process.env.OIDC_CORS_ORIGIN || "";
const USE_SECURE_COOKIES = BASE_URL.startsWith("https://");

function parseTrustProxy(value) {
  if (value == null || value === "") {
    return false;
  }

  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }

  const asNumber = Number(normalized);
  if (Number.isFinite(asNumber) && asNumber >= 0) {
    return Math.floor(asNumber);
  }

  // Support subnet/IP CSV values accepted by Express.
  if (normalized.includes(",")) {
    return normalized
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean);
  }

  return normalized;
}

const requiredEnv = [
  "SESSION_SECRET",
  "OIDC_ISSUER_BASE_URL",
  "OIDC_CLIENT_ID",
  "OIDC_CLIENT_SECRET",
  "MONGODB_URI",
];

const missing = requiredEnv.filter((name) => !process.env[name]);
if (missing.length > 0) {
  console.error(`Missing required environment variables: ${missing.join(", ")}`);
  process.exit(1);
}

const dbName = process.env.MONGODB_DB || "zen_sandbox";
const collectionName = process.env.MONGODB_COLLECTION || "sandbox_states";

const stateService = createStateService({
  mongoUri: process.env.MONGODB_URI,
  dbName,
  collectionName,
});
const apiController = createApiController({ stateService });
const stateRateLimiters = createStateRateLimiters({
  readWindowMs: process.env.STATE_READ_RATE_LIMIT_WINDOW_MS,
  readMax: process.env.STATE_READ_RATE_LIMIT_MAX,
  writeWindowMs: process.env.STATE_WRITE_RATE_LIMIT_WINDOW_MS,
  writeMax: process.env.STATE_WRITE_RATE_LIMIT_MAX,
});

const app = express();
const trustProxy = parseTrustProxy(process.env.EXPRESS_TRUST_PROXY);

app.set("trust proxy", trustProxy);

app.use(
  helmet({
    contentSecurityPolicy: false,
  })
);
app.use(express.json({ limit: "2mb" }));

// Dev workaround: some IdPs invoke redirect_uri via fetch, which requires CORS.
app.use((req, res, next) => {
  if (OIDC_CORS_ORIGIN && req.path === "/callback") {
    res.setHeader("Access-Control-Allow-Origin", OIDC_CORS_ORIGIN);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    if (req.method === "OPTIONS") {
      return res.sendStatus(204);
    }
  }
  next();
});

app.use(
  auth({
    authRequired: false,
    idpLogout: true,
    auth0Logout: false,
    issuerBaseURL: process.env.OIDC_ISSUER_BASE_URL,
    baseURL: BASE_URL,
    clientID: process.env.OIDC_CLIENT_ID,
    clientSecret: process.env.OIDC_CLIENT_SECRET,
    secret: process.env.SESSION_SECRET,
    session: {
      cookie: {
        path: "/",
        sameSite: USE_SECURE_COOKIES ? "None" : "Lax",
        secure: USE_SECURE_COOKIES,
      },
    },
    transactionCookie: {
      name: "zen_sandbox_auth_verification",
      sameSite: USE_SECURE_COOKIES ? "None" : "Lax",
    },
    authorizationParams: {
      response_type: "code",
      scope: OIDC_SCOPE,
      redirect_uri: OIDC_REDIRECT_URI,
      audience: process.env.OIDC_AUDIENCE || undefined,
    },
    clientAuthMethod: "client_secret_post",
    routes: {
      login: "/login",
      logout: "/logout",
      callback: "/callback",
    },
  })
);

app.use(
  "/api",
  createApiRouter({
    controller: apiController,
    requiresAuth,
    stateRateLimiters,
  })
);

app.use(express.static(path.join(__dirname)));

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

const mongoRetryMs = Number(process.env.MONGODB_RETRY_MS || 30000);

async function initializeMongoIndexesWithRetry() {
  try {
    await stateService.ensureIndexes();
    console.log("MongoDB connected and indexes are ready.");
  } catch (error) {
    console.error("MongoDB initialization failed; retrying:", error);
    setTimeout(initializeMongoIndexesWithRetry, mongoRetryMs);
  }
}

app.listen(PORT, () => {
  console.log(`Zen Sandbox server running at ${BASE_URL}`);
  initializeMongoIndexesWithRetry();
});
