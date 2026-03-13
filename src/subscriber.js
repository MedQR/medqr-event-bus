const { onMessagePublished } = require("firebase-functions/v2/pubsub");
const { TOPIC_NAME } = require("./publisher");

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
      topic: TOPIC_NAME,
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
