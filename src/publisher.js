const { PubSub } = require("@google-cloud/pubsub");
const { createEvent } = require("./schema");

const TOPIC_NAME = "hospital-events";

let pubsubClient = null;

function getPubSubClient() {
  if (!pubsubClient) {
    pubsubClient = new PubSub();
  }
  return pubsubClient;
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
 * @returns {Promise<string>} The eventId
 */
async function publishEvent(db, eventType, orgID, data, options = {}) {
  const event = createEvent(eventType, orgID, data, options);

  // 1. Write to Firestore event log (durable, queryable, replayable)
  await db.collection("event_log").doc(event.eventId).set(event);

  // 2. Publish to Pub/Sub for async subscriber consumption
  const pubsub = getPubSubClient();
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
