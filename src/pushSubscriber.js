const { onRequest } = require("firebase-functions/v2/https");
const { OAuth2Client } = require("google-auth-library");

/**
 * Cross-project push-subscription helper.
 *
 * Why this exists: Eventarc-managed Pub/Sub triggers (the
 * `createSubscriber` path) are awkward across GCP projects. Push
 * subscriptions are first-class Pub/Sub primitives, configured ONCE
 * via gcloud, and just POST to a URL with an OIDC token.
 *
 * Usage in the subscriber app's Cloud Function module:
 *   exports.onPrescriptionFinalized = createPushSubscriber(
 *     'onPrescriptionFinalized',
 *     EventTypes.PRESCRIPTION_FINALIZED,
 *     async (event) => { ... },
 *   );
 *
 * One-time setup per subscriber (run once when first deploying):
 *   gcloud pubsub subscriptions create to-mediq-onPrescriptionFinalized \\
 *     --topic=hospital-events --topic-project=medqr-uat \\
 *     --push-endpoint=https://asia-south1-<app-project>.cloudfunctions.net/<fn> \\
 *     --push-auth-service-account=<app-runtime-sa> \\
 *     --filter='attributes.eventType="prescription.finalized"' \\
 *     --project=medqr-uat
 *
 * The endpoint verifies the inbound OIDC token (so only Pub/Sub can
 * invoke it), parses the Pub/Sub envelope, filters by event type,
 * and dispatches to the handler.
 */

const oauthClient = new OAuth2Client();

async function verifyOidcToken(authHeader, expectedAudience) {
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return { ok: false, reason: "missing-bearer" };
  }
  const token = authHeader.slice(7);
  try {
    const ticket = await oauthClient.verifyIdToken({
      idToken: token,
      audience: expectedAudience,
    });
    return { ok: true, payload: ticket.getPayload() };
  } catch (err) {
    return { ok: false, reason: "verify-failed: " + err.message };
  }
}

/**
 * @param {string} name - subscriber name (logging only)
 * @param {string|string[]} eventTypes - which event types to handle
 * @param {function} handler - async (event) => void
 * @param {object} [options]
 * @param {string} [options.region] - Cloud Function region (default asia-south1)
 * @param {string} [options.expectedAudience] - OIDC audience to enforce.
 *   Defaults to the function's own URL (auto-detected from request).
 * @returns Cloud Function export
 */
function createPushSubscriber(name, eventTypes, handler, options = {}) {
  const types = Array.isArray(eventTypes) ? eventTypes : [eventTypes];
  const region = options.region || "asia-south1";

  return onRequest({ region }, async (req, res) => {
    if (req.method !== "POST") {
      res.status(405).send("Method not allowed");
      return;
    }

    // Verify OIDC token. Audience defaults to the function's own URL
    // (Pub/Sub signs the token with that as the aud claim when the
    // push subscription was created with --push-auth-service-account).
    const expectedAudience =
      options.expectedAudience ||
      "https://" + req.hostname + req.originalUrl.split("?")[0];
    const verify = await verifyOidcToken(
        req.headers.authorization,
        expectedAudience,
    );
    if (!verify.ok) {
      console.warn("[" + name + "] OIDC verify failed:", verify.reason);
      res.status(401).send("Unauthorized");
      return;
    }

    // Parse Pub/Sub envelope.
    // Shape: { message: { data: <base64>, attributes: {...}, messageId, ... }, subscription }
    const envelope = req.body || {};
    const message = envelope.message;
    if (!message || !message.data) {
      console.warn("[" + name + "] no message.data in envelope");
      res.status(204).send(""); // ack so it's not redelivered
      return;
    }

    let event;
    try {
      const raw = Buffer.from(message.data, "base64").toString("utf8");
      event = JSON.parse(raw);
    } catch (err) {
      console.error("[" + name + "] envelope parse failed:", err.message);
      res.status(204).send(""); // bad data - ack so it's not redelivered forever
      return;
    }

    // Filter by event type. Skipped events are acked (200) so Pub/Sub
    // doesn't redeliver them.
    if (!types.includes(event.eventType)) {
      res.status(204).send("");
      return;
    }

    console.log(
        "[" + name + "] processing " + event.eventType +
        " (" + event.eventId + ")",
    );

    try {
      await handler(event);
      console.log(
          "[" + name + "] completed " + event.eventType +
          " (" + event.eventId + ")",
      );
      res.status(204).send("");
    } catch (err) {
      console.error("[" + name + "] handler error:", err);
      // 5xx -> Pub/Sub retries with backoff
      res.status(500).send("Handler error");
    }
  });
}

module.exports = { createPushSubscriber };
