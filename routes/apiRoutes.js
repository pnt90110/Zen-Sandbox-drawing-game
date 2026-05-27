const express = require("express");

function createApiRouter({ controller, requiresAuth, stateRateLimiters }) {
  const router = express.Router();
  const { stateReadLimiter, stateWriteLimiter } = stateRateLimiters;

  router.get("/me", controller.getMe);
  router.get("/state", requiresAuth(), stateReadLimiter, controller.getState);
  router.put("/state", requiresAuth(), stateWriteLimiter, controller.putState);

  return router;
}

module.exports = {
  createApiRouter,
};