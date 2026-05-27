const { rateLimit, ipKeyGenerator } = require("express-rate-limit");

function toPositiveInt(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.floor(parsed);
}

function getAuthenticatedRateLimitKey(req) {
  const userSub = req && req.oidc && req.oidc.user && req.oidc.user.sub;
  if (typeof userSub === "string" && userSub.length > 0) {
    return `user:${userSub}`;
  }

  // Fallback for unexpected unauthenticated calls.
  return `ip:${ipKeyGenerator(req.ip || "")}`;
}

function createStateRateLimiters({
  readWindowMs,
  readMax,
  writeWindowMs,
  writeMax,
}) {
  const stateReadLimiter = rateLimit({
    windowMs: toPositiveInt(readWindowMs, 60_000),
    max: toPositiveInt(readMax, 120),
    keyGenerator: getAuthenticatedRateLimitKey,
    standardHeaders: true,
    legacyHeaders: false,
    message: { message: "Too many state read requests. Please try again soon." },
  });

  const stateWriteLimiter = rateLimit({
    windowMs: toPositiveInt(writeWindowMs, 60_000),
    max: toPositiveInt(writeMax, 30),
    keyGenerator: getAuthenticatedRateLimitKey,
    standardHeaders: true,
    legacyHeaders: false,
    message: { message: "Too many state save requests. Please try again soon." },
  });

  return {
    stateReadLimiter,
    stateWriteLimiter,
  };
}

module.exports = {
  createStateRateLimiters,
};