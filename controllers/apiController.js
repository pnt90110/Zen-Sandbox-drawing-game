function createApiController({ stateService }) {
  function getMe(req, res) {
    if (!req.oidc.isAuthenticated()) {
      return res.status(401).json({ authenticated: false });
    }

    const claims = req.oidc.user || {};
    return res.json({
      authenticated: true,
      user: {
        sub: claims.sub,
        name: claims.name || claims.preferred_username || claims.email || "User",
        email: claims.email || null,
      },
    });
  }

  async function getState(req, res) {
    try {
      const userSub = req.oidc.user.sub;
      const doc = await stateService.loadStateByUserSub(userSub);

      if (!doc) {
        return res.status(404).json({ message: "No saved state found yet." });
      }

      return res.json(doc);
    } catch (error) {
      console.error("Failed to load state:", error);
      return res.status(500).json({ message: "Failed to load state." });
    }
  }

  async function putState(req, res) {
    try {
      const validationError = stateService.validateStatePayload(req.body);
      if (validationError) {
        if (typeof validationError === "string") {
          return res.status(400).json({ message: validationError });
        }

        return res.status(400).json({
          message: validationError.message || "Invalid state payload.",
          details: Array.isArray(validationError.details) ? validationError.details : [],
        });
      }

      const userSub = req.oidc.user.sub;
      const savedAt = await stateService.saveStateByUserSub(userSub, req.body);

      return res.json({ ok: true, savedAt: savedAt.toISOString() });
    } catch (error) {
      console.error("Failed to save state:", error);
      return res.status(500).json({ message: "Failed to save state." });
    }
  }

  return {
    getMe,
    getState,
    putState,
  };
}

module.exports = {
  createApiController,
};