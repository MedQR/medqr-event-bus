const { onMessagePublished } = require("firebase-functions/v2/pubsub");
const { TOPIC_NAME } = require("./publisher");

/**
 * Build the topic resource string for cross-project subscriptions.
 * Caller passes busProjectId explicitly via createSubscriber options;
 * we do NOT read from process.env here because firebase-functions's
 * topic config is consumed at deploy-time module load, where env
 * propagation through the CLI is unreliable. Explicit > implicit.
 *
 * @param {string|undefined} busProjectId
 * @returns {string} either fully-qualified topic resource or bare name
 */
function buildTopic(busProjectId) {
  if (busProjectId) {
    return "projects/" + busProjectId + "/topics/" + TOPIC_NAME;
  }
  return TOPIC_NAME;
}

/**
 * Creates a Pub/Sub subscriber Cloud Function that filters by event type(s).
 *
 * @param {string} name - Subscriber name (for logging)
 * @param {string|string[]} eventTypes - Event type(s) to subscribe to
 * @param {function} handler - async (event) => void
 * @param {object} [options]
 * @param {string} [options.busProjectId] - GCP project hosting the
 *   shared `hospital-events` topic. Required for cross-project use.
 *   Cross-project IAM must grant the function's runtime SA
 *   `roles/pubsub.subscriber` on that topic.
 * @returns Cloud Function export
 */
function createSubscriber(name, eventTypes, handler, options = {}) {
  const types = Array.isArray(eventTypes) ? eventTypes : [eventTypes];
  const { busProjectId, ...cfOptions } = options;

  return onMessagePublished(
    {
      topic: buildTopic(busProjectId),
      ...cfOptions,
    },
    async (cloudEvent) => {
      const raw = Buffer.from(cloudEvent.data.message.data, "base64").toString();
      const event = JSON.parse(raw);

      // Filter: skip events not meant for this subscriber
      if (!types.includes(event.eventType)) {
        return;
      }

      console.log(`[${name}] Processing ${event.eventType} (${event.eventId})`);

      try {
        await handler(event);
        console.log(`[${name}] Completed ${event.eventType} (${event.eventId})`);
      } catch (error) {
        console.error(`[${name}] Error processing ${event.eventId}:`, error);
        throw error; // Re-throw so Pub/Sub retries the message
      }
    }
  );
}

module.exports = { createSubscriber };
