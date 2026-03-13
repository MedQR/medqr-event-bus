const crypto = require("crypto");

const EventTypes = {
  // OPD events
  CASE_CREATED: "case.created",
  CASE_CLOSED: "case.closed",
  PRESCRIPTION_CREATED: "prescription.created",
  PRESCRIPTION_FINALIZED: "prescription.finalized",
  APPOINTMENT_CREATED: "appointment.created",

  // IPD events
  PATIENT_ADMITTED: "patient.admitted",
  PATIENT_DISCHARGED: "patient.discharged",

  // Lab events
  LAB_CASE_REGISTERED: "lab.case.registered",
  LAB_RESULT_READY: "lab.result.ready",

  // Staff/Doctor events
  DOCTOR_REGISTERED: "doctor.registered",
  STAFF_REGISTERED: "staff.registered",

  // Billing events
  RATE_UPDATED: "rate.updated",
  PATIENT_REGISTERED: "patient.registered",

  // AI Agent events
  AI_SUMMARY_GENERATED: "ai.summary.generated",
  AI_DRUG_INTERACTION_DETECTED: "ai.drug_interaction.detected",
  AI_INVESTIGATION_SUGGESTED: "ai.investigation.suggested",
};

/**
 * Creates a standardized event envelope.
 *
 * @param {string} eventType - One of EventTypes constants
 * @param {string} orgID - Hospital/org UID (multi-tenant isolation)
 * @param {object} data - Event-specific payload
 * @param {object} [options]
 * @param {string} [options.source] - e.g., "trigger:patient_meta_v2", "api:OPD"
 * @param {string} [options.correlationId] - For tracing related events
 * @param {string} [options.causedBy] - eventId of the event that triggered this one
 * @returns {object} Event envelope
 */
function createEvent(eventType, orgID, data, options = {}) {
  const eventId = crypto.randomUUID();

  return {
    eventId,
    eventType,
    source: options.source || "unknown",
    orgID,
    timestamp: Date.now(),
    data,
    metadata: {
      version: "1.0",
      correlationId: options.correlationId || eventId,
      causedBy: options.causedBy || null,
    },
  };
}

module.exports = { EventTypes, createEvent };
