const { onMessagePublished } = require("firebase-functions/v2/pubsub");
const { TOPIC_NAME } = require("./publisher");

/**
 * Resolve the topic this subscriber should listen to.
 *
 * If EVENT_BUS_PROJECT_ID is set, returns the fully-qualified topic
 * resource (`projects/<bus-project>/topics/hospital-events`) which
 * lets the subscriber listen to a topic in a DIFFERENT GCP project
 * from where the Cloud Function itself is deployed. Cross-project
 * IAM must grant the function's runtime service account
 * `roles/pubsub.subscriber` on that topic.
 *
 * If unset, falls back to the bare topic name, which Cloud Functions
 * resolves against the function's own project. Useful for local
 * emulator runs only.
 */
function resolveTopic() {
  const busProjectId = process.env.EVENT_BUS_PROJECT_ID;
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
 * @param {function} handler - async (event) => void — receives the parsed event envelope
 * @param {object} [options] - Additional Cloud Function options (memory, timeoutSeconds, secrets, etc.)
 * @returns Cloud Function export
 */
function createSubscriber(name, eventTypes, handler, options = {}) {
  const types = Array.isArray(eventTypes) ? eventTypes : [eventTypes];

  return onMessagePublished(
    {
      topic: resolveTopic(),
      ...options,
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
