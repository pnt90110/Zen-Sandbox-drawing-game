const { MongoClient } = require("mongodb");
const { z } = require("zod");

const activeBallSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
  vx: z.number().finite(),
  vy: z.number().finite(),
  r: z.number().positive(),
});

const statePayloadSchema = z.object({
  version: z.number().int().positive().optional(),
  simWidth: z.number().int().positive(),
  simHeight: z.number().int().positive(),
  cells: z.string().min(1),
  life: z.string().min(1),
  fireState: z.string().min(1),
  waterSideAttempts: z.string().min(1),
  waterSleepVersion: z.string().min(1),
  activeBalls: z.array(activeBallSchema).optional(),
});

function createStateService({ mongoUri, dbName, collectionName }) {
  let mongoClientPromise;

  function getMongoClient() {
    if (!mongoClientPromise) {
      mongoClientPromise = new MongoClient(mongoUri)
        .connect()
        .catch((error) => {
          // Reset cached promise so the next request can retry a fresh connection.
          mongoClientPromise = undefined;
          throw error;
        });
    }
    return mongoClientPromise;
  }

  async function getStatesCollection() {
    const client = await getMongoClient();
    return client.db(dbName).collection(collectionName);
  }

  function validateStatePayload(payload) {
    const result = statePayloadSchema.safeParse(payload);
    if (result.success) {
      return null;
    }

    const details = result.error.issues.map((issue) => {
      const fieldPath = issue.path.length > 0 ? issue.path.join(".") : "payload";
      return `${fieldPath}: ${issue.message}`;
    });

    return {
      message: "Invalid state payload.",
      details,
    };
  }

  async function loadStateByUserSub(userSub) {
    const collection = await getStatesCollection();
    return collection.findOne(
      { userSub },
      { projection: { _id: 0, userSub: 0, updatedAt: 0 } }
    );
  }

  async function saveStateByUserSub(userSub, payload) {
    const collection = await getStatesCollection();

    const now = new Date();
    await collection.updateOne(
      { userSub },
      {
        $set: {
          userSub,
          version: Number(payload.version || 1),
          simWidth: Number(payload.simWidth),
          simHeight: Number(payload.simHeight),
          cells: payload.cells,
          life: payload.life,
          fireState: payload.fireState,
          waterSideAttempts: payload.waterSideAttempts,
          waterSleepVersion: payload.waterSleepVersion,
          activeBalls: Array.isArray(payload.activeBalls) ? payload.activeBalls : [],
          updatedAt: now,
        },
      },
      { upsert: true }
    );

    return now;
  }

  async function ensureIndexes() {
    const collection = await getStatesCollection();
    await collection.createIndex({ userSub: 1 }, { unique: true });
  }

  return {
    validateStatePayload,
    loadStateByUserSub,
    saveStateByUserSub,
    ensureIndexes,
  };
}

module.exports = {
  createStateService,
};