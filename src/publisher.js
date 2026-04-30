const { PubSub } = require("@google-cloud/pubsub");
const { createEvent } = require("./schema");

const TOPIC_NAME = "hospital-events";

// Every publisher writes to ONE central topic in ONE shared GCP
// project. The project is passed explicitly to publishEvent via
// options.busProjectId. Reading env at module load time is unreliable
// across runtime/deploy contexts (firebase-functions topic config
// resolution timing) - so the contract is "caller passes it".
//
// For convenience, EVENT_BUS_PROJECT_ID env var is honored as a
// fallback at publish time (publishing IS a runtime operation, not
// deploy-time wiring, so env is reliable here).
function resolveBusProjectId(explicit) {
  if (explicit) return explicit;
  return process.env.EVENT_BUS_PROJECT_ID || undefined;
}

let pubsubClientByProject = new Map();

function getPubSubClient(projectId) {
  const key = projectId || "__default__";
  if (!pubsubClientByProject.has(key)) {
    const client = projectId ? new PubSub({ projectId }) : new PubSub();
    pubsubClientByProject.set(key, client);
  }
  return pubsubClientByProject.get(key);
}

/**
 * Publishes an event to both the Firestore event log and Pub/Sub.
 *
 * @param {object} db - Firestore database instance (from firebase-admin)
 * @param {string} eventType - One of EventTypes constants
 * @param {string} orgID - Hospital/org UID
 * @param {object} data - Event-specific payload
 * @param {object} [options]
 * @param {string} [options.source] - Source identifier
 * @param {string} [options.correlationId] - Correlation ID for tracing
 * @param {string} [options.causedBy] - Parent event ID
 * @param {string} [options.busProjectId] - Cross-project bus project.
 *   Falls back to EVENT_BUS_PROJECT_ID env var, else current project.
 * @returns {Promise<string>} The eventId
 */
async function publishEvent(db, eventType, orgID, data, options = {}) {
  const event = createEvent(eventType, orgID, data, options);

  // 1. Write to Firestore event log (durable, queryable, replayable)
  await db.collection("event_log").doc(event.eventId).set(event);

  // 2. Publish to Pub/Sub for async subscriber consumption
  const busProjectId = resolveBusProjectId(options.busProjectId);
  const pubsub = getPubSubClient(busProjectId);
  const topic = pubsub.topic(TOPIC_NAME);
  const messageBuffer = Buffer.from(JSON.stringify(event));

  await topic.publishMessage({
    data: messageBuffer,
    attributes: {
      eventType: event.eventType,
      orgID: event.orgID,
    },
  });

  console.log(`[event-bus] Published ${eventType} (${event.eventId}) for org ${orgID}`);

  return event.eventId;
}

module.exports = { publishEvent, TOPIC_NAME };
