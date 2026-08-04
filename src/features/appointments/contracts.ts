import { z } from "zod";
import { normalizeEmail } from "../../lib/email";
import { APP_ERROR_STATUS, type AppErrorCode } from "./http-errors";
import { COORGANIZER_MAX_COUNT, OPTION_LIMIT_MAX, OPTION_LIMIT_MIN, isValidDescriptionLength, isValidDisplayNameLength, isValidOptionLimit, isValidTitleLength, normalizeParticipantName } from "./validation";

export type OptionInput =
  | { kind: "DATE"; startDate: string }
  | { kind: "DATE_TIME"; startAt: string }
  | { kind: "DATE_RANGE"; startDate: string; endDate: string }
  | { kind: "DATE_TIME_RANGE"; startAt: string; endAt: string };
export interface CreateAppointmentInput { title: string; description: string | null; ownerDisplayName: string; type: OptionInput["kind"]; optionLimit: number; coOrganizerEmails: string[]; timeZone: string; options: OptionInput[]; }
export interface AddOptionRequest { participantId: string; timeZone: string; option: OptionInput; }
export interface DeleteOptionRequest { participantId: string; confirmationToken?: string; }
export type OptionValue =
  | { kind: "DATE"; startDate: string }
  | { kind: "DATE_TIME"; startAt: number }
  | { kind: "DATE_RANGE"; startDate: string; endDate: string }
  | { kind: "DATE_TIME_RANGE"; startAt: number; endAt: number };
export type ActorContext =
  | { kind: "authenticated"; userId: string; managerRole: "OWNER" | "COORGANIZER" | null; participantId: string | null }
  | { kind: "guest"; guestSessionHash: string; participantId: string }
  | { kind: "anonymous" };
export interface AppointmentSnapshot {
  appointment: { publicId: string; title: string; description: string | null; type: OptionInput["kind"]; status: "ACTIVE" | "FINALIZED"; optionLimit: number; finalOptionId: string | null; revision: number; };
  participants: Array<{ id: string; displayName: string }>;
  options: Array<OptionValue & { id: string; creatorParticipantId: string; responses: Array<{ participantId: string; value: "YES" | "NO" }>; yesCount: number; noCount: number; canDelete: boolean; }>;
  viewer: { kind: ActorContext["kind"]; activeParticipantId: string | null; accessibleParticipants: Array<{ id: string; displayName: string }>; needsParticipantName: boolean; participantEnrollmentError: "PARTICIPANT_LIMIT_REACHED" | null; permissions: { canEditAppointment: boolean; canManageCoOrganizers: boolean; canDeleteAppointment: boolean; canFinalize: boolean; canReopen: boolean; canResetGuestLinks: boolean; canRespond: boolean; canSuggest: boolean; }; };
}

const uuidV4Schema = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu, "Must be a UUIDv4");
const publicIdSchema = z.string().regex(/^[A-Za-z0-9_-]{24}$/u, "Must be an 18-byte base64url public ID");
const opaqueTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/u, "Must be a canonical 32-byte base64url token");
const revisionSchema = z.number().int().min(1);
const safeIntegerSchema = z.number().int().min(Number.MIN_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER);
const nonEmptyStringSchema = z.string().min(1);
const titleSchema = z.string().refine(isValidTitleLength, "Title must contain 1 to 120 characters");
const displayNameSchema = z.string().refine(
  (value) => isValidDisplayNameLength(normalizeParticipantName(value).displayName),
  "Display name must contain 1 to 80 normalized characters",
);
const descriptionSchema = z.string().nullable().refine(isValidDescriptionLength, "Description must contain at most 2000 characters");
const optionLimitSchema = z.number().refine(isValidOptionLimit, `Option limit must be an integer from ${OPTION_LIMIT_MIN} to ${OPTION_LIMIT_MAX}`);
const emailSchema = z.string().superRefine((value, context) => { try { normalizeEmail(value); } catch { context.addIssue({ code: "custom", message: "Must be one email address" }); } });
const dateOptionInputSchema = z.object({ kind: z.literal("DATE"), startDate: nonEmptyStringSchema }).strict();
const dateTimeOptionInputSchema = z.object({ kind: z.literal("DATE_TIME"), startAt: nonEmptyStringSchema }).strict();
const dateRangeOptionInputSchema = z.object({ kind: z.literal("DATE_RANGE"), startDate: nonEmptyStringSchema, endDate: nonEmptyStringSchema }).strict();
const dateTimeRangeOptionInputSchema = z.object({ kind: z.literal("DATE_TIME_RANGE"), startAt: nonEmptyStringSchema, endAt: nonEmptyStringSchema }).strict();
export const optionInputSchema = z.discriminatedUnion("kind", [dateOptionInputSchema, dateTimeOptionInputSchema, dateRangeOptionInputSchema, dateTimeRangeOptionInputSchema]) satisfies z.ZodType<OptionInput>;
const dateOptionValueSchema = z.object({ kind: z.literal("DATE"), startDate: nonEmptyStringSchema }).strict();
const dateTimeOptionValueSchema = z.object({ kind: z.literal("DATE_TIME"), startAt: safeIntegerSchema }).strict();
const dateRangeOptionValueSchema = z.object({ kind: z.literal("DATE_RANGE"), startDate: nonEmptyStringSchema, endDate: nonEmptyStringSchema }).strict();
const dateTimeRangeOptionValueSchema = z.object({ kind: z.literal("DATE_TIME_RANGE"), startAt: safeIntegerSchema, endAt: safeIntegerSchema }).strict();
export const optionValueSchema = z.discriminatedUnion("kind", [dateOptionValueSchema, dateTimeOptionValueSchema, dateRangeOptionValueSchema, dateTimeRangeOptionValueSchema]) satisfies z.ZodType<OptionValue>;

export const createAppointmentInputSchema = z.object({ title: titleSchema, description: descriptionSchema, ownerDisplayName: displayNameSchema, type: z.enum(["DATE", "DATE_TIME", "DATE_RANGE", "DATE_TIME_RANGE"]), optionLimit: optionLimitSchema, coOrganizerEmails: z.array(emailSchema).max(COORGANIZER_MAX_COUNT), timeZone: nonEmptyStringSchema, options: z.array(optionInputSchema).min(1).max(OPTION_LIMIT_MAX) }).strict().superRefine((input, context) => {
  const seenEmails = new Set<string>();
  input.coOrganizerEmails.forEach((email, index) => { let normalized: string; try { normalized = normalizeEmail(email); } catch { return; } if (seenEmails.has(normalized)) context.addIssue({ code: "custom", message: "Co-organizer emails must be unique", path: ["coOrganizerEmails", index] }); seenEmails.add(normalized); });
  input.options.forEach((option, index) => { if (option.kind !== input.type) context.addIssue({ code: "custom", message: "Option kind must match appointment type", path: ["options", index, "kind"] }); });
  if (input.options.length > input.optionLimit) context.addIssue({ code: "custom", message: "Initial options must fit within the option limit", path: ["options"] });
}) satisfies z.ZodType<CreateAppointmentInput>;
export const addOptionRequestSchema = z.object({ participantId: uuidV4Schema, timeZone: nonEmptyStringSchema, option: optionInputSchema }).strict() satisfies z.ZodType<AddOptionRequest>;
export const deleteOptionRequestSchema = z.object({ participantId: uuidV4Schema, confirmationToken: opaqueTokenSchema.optional() }).strict() satisfies z.ZodType<DeleteOptionRequest>;
export const actorContextSchema = z.discriminatedUnion("kind", [z.object({ kind: z.literal("authenticated"), userId: nonEmptyStringSchema, managerRole: z.enum(["OWNER", "COORGANIZER"]).nullable(), participantId: uuidV4Schema.nullable() }).strict(), z.object({ kind: z.literal("guest"), guestSessionHash: nonEmptyStringSchema, participantId: uuidV4Schema }).strict(), z.object({ kind: z.literal("anonymous") }).strict()]) satisfies z.ZodType<ActorContext>;

const participantSummarySchema = z.object({ id: uuidV4Schema, displayName: displayNameSchema }).strict();
const responseSummarySchema = z.object({ participantId: uuidV4Schema, value: z.enum(["YES", "NO"]) }).strict();
const optionSnapshotFields = { id: uuidV4Schema, creatorParticipantId: uuidV4Schema, responses: z.array(responseSummarySchema), yesCount: z.number().int().min(0), noCount: z.number().int().min(0), canDelete: z.boolean() } as const;
const appointmentSnapshotOptionSchema = z.discriminatedUnion("kind", [dateOptionValueSchema.extend(optionSnapshotFields).strict(), dateTimeOptionValueSchema.extend(optionSnapshotFields).strict(), dateRangeOptionValueSchema.extend(optionSnapshotFields).strict(), dateTimeRangeOptionValueSchema.extend(optionSnapshotFields).strict()]);
export const appointmentSnapshotSchema = z.object({
  appointment: z.object({ publicId: publicIdSchema, title: titleSchema, description: descriptionSchema, type: z.enum(["DATE", "DATE_TIME", "DATE_RANGE", "DATE_TIME_RANGE"]), status: z.enum(["ACTIVE", "FINALIZED"]), optionLimit: optionLimitSchema, finalOptionId: uuidV4Schema.nullable(), revision: revisionSchema }).strict(),
  participants: z.array(participantSummarySchema), options: z.array(appointmentSnapshotOptionSchema),
  viewer: z.object({ kind: z.enum(["authenticated", "guest", "anonymous"]), activeParticipantId: uuidV4Schema.nullable(), accessibleParticipants: z.array(participantSummarySchema), needsParticipantName: z.boolean(), participantEnrollmentError: z.literal("PARTICIPANT_LIMIT_REACHED").nullable(), permissions: z.object({ canEditAppointment: z.boolean(), canManageCoOrganizers: z.boolean(), canDeleteAppointment: z.boolean(), canFinalize: z.boolean(), canReopen: z.boolean(), canResetGuestLinks: z.boolean(), canRespond: z.boolean(), canSuggest: z.boolean() }).strict() }).strict(),
}).strict() satisfies z.ZodType<AppointmentSnapshot>;

export const noBodySchema = z.undefined(); export type NoBody = z.infer<typeof noBodySchema>;
export const noParamsSchema = z.object({}).strict(); export type NoParams = z.infer<typeof noParamsSchema>;
export const appointmentParamsSchema = z.object({ publicId: publicIdSchema }).strict(); export type AppointmentParams = z.infer<typeof appointmentParamsSchema>;
export const managerParamsSchema = z.object({ publicId: publicIdSchema, managerId: uuidV4Schema }).strict(); export type ManagerParams = z.infer<typeof managerParamsSchema>;
export const participantParamsSchema = z.object({ publicId: publicIdSchema, participantId: uuidV4Schema }).strict(); export type ParticipantParams = z.infer<typeof participantParamsSchema>;
export const optionParamsSchema = z.object({ publicId: publicIdSchema, optionId: uuidV4Schema }).strict(); export type OptionParams = z.infer<typeof optionParamsSchema>;
export const appointmentSnapshotQuerySchema = z.object({ participantId: uuidV4Schema.optional() }).strict(); export type AppointmentSnapshotQuery = z.infer<typeof appointmentSnapshotQuerySchema>;
export const updateAppointmentRequestSchema = z.object({ title: titleSchema.optional(), description: descriptionSchema.optional(), optionLimit: optionLimitSchema.optional() }).strict().refine((value) => Object.keys(value).length > 0, { message: "At least one field is required" }); export type UpdateAppointmentRequest = z.infer<typeof updateAppointmentRequestSchema>;
export const deleteAppointmentRequestSchema = z.object({ title: titleSchema }).strict(); export type DeleteAppointmentRequest = z.infer<typeof deleteAppointmentRequestSchema>;
export const addManagerRequestSchema = z.object({ email: emailSchema }).strict(); export type AddManagerRequest = z.infer<typeof addManagerRequestSchema>;
export const managerParticipantRequestSchema = z.object({ displayName: displayNameSchema }).strict(); export type ManagerParticipantRequest = z.infer<typeof managerParticipantRequestSchema>;
export const joinParticipantRequestSchema = z.object({ displayName: displayNameSchema }).strict(); export type JoinParticipantRequest = z.infer<typeof joinParticipantRequestSchema>;
export const guestAccessRequestSchema = z.object({ participantId: uuidV4Schema, token: opaqueTokenSchema }).strict(); export type GuestAccessRequest = z.infer<typeof guestAccessRequestSchema>;
export const putResponseRequestSchema = z.object({ participantId: uuidV4Schema, value: z.enum(["YES", "NO"]).nullable() }).strict(); export type PutResponseRequest = z.infer<typeof putResponseRequestSchema>;
export const finalizeRequestSchema = z.object({ optionId: uuidV4Schema }).strict(); export type FinalizeRequest = z.infer<typeof finalizeRequestSchema>;
export const guestSessionCookieSchema = z.object({ name: z.literal("appointly_guest_session"), value: opaqueTokenSchema, httpOnly: z.literal(true), sameSite: z.literal("lax"), path: z.literal("/"), maxAge: z.literal(31_536_000), secure: z.boolean() }).strict(); export type GuestSessionCookie = z.infer<typeof guestSessionCookieSchema>;
export const routeActorRequirementSchema = z.enum(["public", "authenticated", "manager", "owner", "bound-manager", "non-manager-visitor-without-participant-access", "participant"]); export type RouteActorRequirement = z.infer<typeof routeActorRequirementSchema>;

export const createAppointmentSuccessSchema = z.object({ publicId: publicIdSchema, publicUrl: z.url(), revision: z.literal(1) }).strict(); export type CreateAppointmentSuccess = z.infer<typeof createAppointmentSuccessSchema>;
export const revisionSuccessSchema = z.object({ revision: revisionSchema }).strict(); export type RevisionSuccess = z.infer<typeof revisionSuccessSchema>;
const managerStatusSchema = z.enum(["PENDING", "BOUND"]);
const managerSummarySchema = z.object({ id: uuidV4Schema, email: emailSchema, role: z.enum(["OWNER", "COORGANIZER"]), status: managerStatusSchema, canRemove: z.boolean() }).strict();
export const managerListSuccessSchema = z.object({ managers: z.array(managerSummarySchema) }).strict(); export type ManagerListSuccess = z.infer<typeof managerListSuccessSchema>;
export const addManagerSuccessSchema = z.object({ manager: z.object({ id: uuidV4Schema, email: emailSchema, role: z.literal("COORGANIZER"), status: managerStatusSchema, canRemove: z.literal(true) }).strict(), revision: revisionSchema }).strict(); export type AddManagerSuccess = z.infer<typeof addManagerSuccessSchema>;
export const managerParticipantSuccessSchema = z.object({ participantId: uuidV4Schema, revision: revisionSchema }).strict(); export type ManagerParticipantSuccess = z.infer<typeof managerParticipantSuccessSchema>;
const guestJoinParticipantSuccessSchema = z.object({ participantId: uuidV4Schema, editUrl: nonEmptyStringSchema, revision: revisionSchema }).strict();
const pendingManagerJoinParticipantSuccessSchema = z.object({ participantId: uuidV4Schema, revision: revisionSchema }).strict();
export const joinParticipantSuccessSchema = z.union([guestJoinParticipantSuccessSchema, pendingManagerJoinParticipantSuccessSchema]); export type JoinParticipantSuccess = z.infer<typeof joinParticipantSuccessSchema>;
export const guestAccessSuccessSchema = z.object({ participantId: uuidV4Schema }).strict(); export type GuestAccessSuccess = z.infer<typeof guestAccessSuccessSchema>;
export const resetParticipantLinkSuccessSchema = z.object({ participantId: uuidV4Schema, editUrl: nonEmptyStringSchema, revision: revisionSchema }).strict(); export type ResetParticipantLinkSuccess = z.infer<typeof resetParticipantLinkSuccessSchema>;
export const putResponseSuccessSchema = z.object({ value: z.enum(["YES", "NO"]).nullable(), revision: revisionSchema }).strict(); export type PutResponseSuccess = z.infer<typeof putResponseSuccessSchema>;
export const addOptionSuccessSchema = z.object({ optionId: uuidV4Schema, revision: revisionSchema }).strict(); export type AddOptionSuccess = z.infer<typeof addOptionSuccessSchema>;

export const deleteConfirmationDetailsSchema = z.object({
  count: z.number().int().positive(),
  names: z.array(z.string()),
  token: opaqueTokenSchema,
}).strict().superRefine((details, context) => {
  if (details.names.length !== details.count) {
    context.addIssue({
      code: "custom",
      message: "Names length must equal count",
      path: ["names"],
    });
  }
});
export type DeleteConfirmationDetails = z.infer<typeof deleteConfirmationDetailsSchema>;

type ConfirmationErrorCode = "DELETE_CONFIRMATION_REQUIRED" | "STALE_DELETE_CONFIRMATION";
type RouteErrorBodyForCode<Code extends AppErrorCode> = Code extends ConfirmationErrorCode
  ? {
      error: {
        code: Code;
        message: string;
        fieldErrors?: Record<string, string[]>;
        details: DeleteConfirmationDetails;
      };
    }
  : {
      error: {
        code: Code;
        message: string;
        fieldErrors?: Record<string, string[]>;
      };
    };

function routeErrors<const Codes extends readonly [AppErrorCode, ...AppErrorCode[]]>(...codes: Codes) {
  const codeSchema = z.enum(codes);
  const bodySchema = z.object({
    error: z.object({
      code: codeSchema,
      message: z.string(),
      fieldErrors: z.record(z.string(), z.array(z.string())).optional(),
      details: z.unknown().optional(),
    }).strict(),
  }).strict().superRefine((body, context) => {
    const needsConfirmationDetails = body.error.code === "DELETE_CONFIRMATION_REQUIRED"
      || body.error.code === "STALE_DELETE_CONFIRMATION";

    if (needsConfirmationDetails) {
      const parsedDetails = deleteConfirmationDetailsSchema.safeParse(body.error.details);
      if (!parsedDetails.success) {
        for (const issue of parsedDetails.error.issues) {
          context.addIssue({
            code: "custom",
            message: issue.message,
            path: ["error", "details", ...issue.path],
          });
        }
      }
    } else if (Object.hasOwn(body.error, "details")) {
      context.addIssue({
        code: "custom",
        message: "Details are not allowed for this error code",
        path: ["error", "details"],
      });
    }
  }) as unknown as z.ZodType<RouteErrorBodyForCode<Codes[number]>>;
  const statusByCode = Object.fromEntries(
    codes.map((code) => [code, APP_ERROR_STATUS[code]]),
  ) as { readonly [Code in Codes[number]]: (typeof APP_ERROR_STATUS)[Code] };

  return { codes, codeSchema, bodySchema, statusByCode } as const;
}
export const appointmentRouteContracts = {
  createAppointment: { method: "POST", path: "/api/appointments", params: noParamsSchema, actor: "authenticated", request: { location: "body", schema: createAppointmentInputSchema }, success: { statuses: [201], body: "json", schema: createAppointmentSuccessSchema }, errors: routeErrors("VALIDATION_FAILED", "UNAUTHENTICATED", "ORIGIN_MISMATCH", "NAME_TAKEN", "DUPLICATE_OPTION", "OPTION_LIMIT_REACHED", "COORGANIZER_LIMIT_REACHED", "MANAGER_ALREADY_EXISTS", "INTERNAL_ERROR") },
  getSnapshot: { method: "GET", path: "/api/appointments/[publicId]/snapshot", params: appointmentParamsSchema, actor: "public", request: { location: "query", schema: appointmentSnapshotQuerySchema }, success: { statuses: [200], body: "json", schema: appointmentSnapshotSchema }, errors: routeErrors("VALIDATION_FAILED", "NOT_FOUND") },
  getEvents: { method: "GET", path: "/api/appointments/[publicId]/events", params: appointmentParamsSchema, actor: "public", request: { location: "none", schema: noBodySchema }, success: { statuses: [200], body: "event-stream", schema: null }, errors: routeErrors("VALIDATION_FAILED", "NOT_FOUND") },
  updateAppointment: { method: "PATCH", path: "/api/appointments/[publicId]", params: appointmentParamsSchema, actor: "bound-manager", request: { location: "body", schema: updateAppointmentRequestSchema }, success: { statuses: [200], body: "json", schema: revisionSuccessSchema }, errors: routeErrors("VALIDATION_FAILED", "UNAUTHENTICATED", "FORBIDDEN", "ORIGIN_MISMATCH", "NOT_FOUND", "APPOINTMENT_FINALIZED", "LIMIT_BELOW_CURRENT_COUNT") },
  deleteAppointment: { method: "DELETE", path: "/api/appointments/[publicId]", params: appointmentParamsSchema, actor: "owner", request: { location: "body", schema: deleteAppointmentRequestSchema }, success: { statuses: [204], body: "none", schema: noBodySchema }, errors: routeErrors("VALIDATION_FAILED", "UNAUTHENTICATED", "FORBIDDEN", "ORIGIN_MISMATCH", "NOT_FOUND", "TITLE_CONFIRMATION_MISMATCH") },
  listManagers: { method: "GET", path: "/api/appointments/[publicId]/managers", params: appointmentParamsSchema, actor: "owner", request: { location: "none", schema: noBodySchema }, success: { statuses: [200], body: "json", schema: managerListSuccessSchema }, errors: routeErrors("VALIDATION_FAILED", "UNAUTHENTICATED", "FORBIDDEN", "NOT_FOUND") },
  addManager: { method: "POST", path: "/api/appointments/[publicId]/managers", params: appointmentParamsSchema, actor: "owner", request: { location: "body", schema: addManagerRequestSchema }, success: { statuses: [201], body: "json", schema: addManagerSuccessSchema }, errors: routeErrors("VALIDATION_FAILED", "UNAUTHENTICATED", "FORBIDDEN", "ORIGIN_MISMATCH", "NOT_FOUND", "APPOINTMENT_FINALIZED", "COORGANIZER_LIMIT_REACHED", "MANAGER_ALREADY_EXISTS") },
  deleteManager: { method: "DELETE", path: "/api/appointments/[publicId]/managers/[managerId]", params: managerParamsSchema, actor: "owner", request: { location: "none", schema: noBodySchema }, success: { statuses: [200], body: "json", schema: revisionSuccessSchema }, errors: routeErrors("VALIDATION_FAILED", "UNAUTHENTICATED", "FORBIDDEN", "ORIGIN_MISMATCH", "NOT_FOUND", "APPOINTMENT_FINALIZED") },
  createManagerParticipant: { method: "POST", path: "/api/appointments/[publicId]/manager-participant", params: appointmentParamsSchema, actor: "bound-manager", request: { location: "body", schema: managerParticipantRequestSchema }, success: { statuses: [200, 201], body: "json", schema: managerParticipantSuccessSchema }, errors: routeErrors("VALIDATION_FAILED", "UNAUTHENTICATED", "FORBIDDEN", "ORIGIN_MISMATCH", "NOT_FOUND", "NAME_TAKEN", "PARTICIPANT_LIMIT_REACHED", "APPOINTMENT_FINALIZED") },
  joinParticipant: { method: "POST", path: "/api/appointments/[publicId]/participants", params: appointmentParamsSchema, actor: "non-manager-visitor-without-participant-access", request: { location: "body", schema: joinParticipantRequestSchema }, success: { statuses: [201], body: "json", schema: joinParticipantSuccessSchema }, guestCookie: { mode: "set", schema: guestSessionCookieSchema }, errors: routeErrors("VALIDATION_FAILED", "FORBIDDEN", "ORIGIN_MISMATCH", "NOT_FOUND", "NAME_TAKEN", "PARTICIPANT_LIMIT_REACHED", "APPOINTMENT_FINALIZED", "RATE_LIMITED", "INTERNAL_ERROR") },
  exchangeGuestAccess: { method: "POST", path: "/api/appointments/[publicId]/guest-access", params: appointmentParamsSchema, actor: "public", request: { location: "body", schema: guestAccessRequestSchema }, success: { statuses: [200], body: "json", schema: guestAccessSuccessSchema }, guestCookie: { mode: "set-if-missing-valid-session", schema: guestSessionCookieSchema }, errors: routeErrors("ORIGIN_MISMATCH", "INVALID_EDIT_LINK", "INTERNAL_ERROR") },
  resetParticipantLink: { method: "POST", path: "/api/appointments/[publicId]/participants/[participantId]/reset-link", params: participantParamsSchema, actor: "manager", request: { location: "none", schema: noBodySchema }, success: { statuses: [200], body: "json", schema: resetParticipantLinkSuccessSchema }, errors: routeErrors("VALIDATION_FAILED", "UNAUTHENTICATED", "FORBIDDEN", "ORIGIN_MISMATCH", "NOT_FOUND", "APPOINTMENT_FINALIZED") },
  putResponse: { method: "PUT", path: "/api/appointments/[publicId]/responses/[optionId]", params: optionParamsSchema, actor: "participant", request: { location: "body", schema: putResponseRequestSchema }, success: { statuses: [200], body: "json", schema: putResponseSuccessSchema }, errors: routeErrors("VALIDATION_FAILED", "FORBIDDEN", "ORIGIN_MISMATCH", "NOT_FOUND", "APPOINTMENT_FINALIZED", "RATE_LIMITED") },
  addOption: { method: "POST", path: "/api/appointments/[publicId]/options", params: appointmentParamsSchema, actor: "participant", request: { location: "body", schema: addOptionRequestSchema }, success: { statuses: [201], body: "json", schema: addOptionSuccessSchema }, errors: routeErrors("VALIDATION_FAILED", "FORBIDDEN", "ORIGIN_MISMATCH", "NOT_FOUND", "APPOINTMENT_FINALIZED", "OPTION_LIMIT_REACHED", "DUPLICATE_OPTION", "RATE_LIMITED") },
  deleteOption: { method: "DELETE", path: "/api/appointments/[publicId]/options/[optionId]", params: optionParamsSchema, actor: "participant", request: { location: "body", schema: deleteOptionRequestSchema }, success: { statuses: [200], body: "json", schema: revisionSuccessSchema }, errors: routeErrors("VALIDATION_FAILED", "FORBIDDEN", "ORIGIN_MISMATCH", "NOT_FOUND", "APPOINTMENT_FINALIZED", "DELETE_CONFIRMATION_REQUIRED", "STALE_DELETE_CONFIRMATION", "RATE_LIMITED") },
  finalizeAppointment: { method: "POST", path: "/api/appointments/[publicId]/finalize", params: appointmentParamsSchema, actor: "manager", request: { location: "body", schema: finalizeRequestSchema }, success: { statuses: [200], body: "json", schema: revisionSuccessSchema }, errors: routeErrors("VALIDATION_FAILED", "UNAUTHENTICATED", "FORBIDDEN", "ORIGIN_MISMATCH", "NOT_FOUND", "APPOINTMENT_FINALIZED", "INVALID_FINAL_OPTION") },
  reopenAppointment: { method: "POST", path: "/api/appointments/[publicId]/reopen", params: appointmentParamsSchema, actor: "manager", request: { location: "none", schema: noBodySchema }, success: { statuses: [200], body: "json", schema: revisionSuccessSchema }, errors: routeErrors("VALIDATION_FAILED", "UNAUTHENTICATED", "FORBIDDEN", "ORIGIN_MISMATCH", "NOT_FOUND") },
} as const satisfies Record<string, {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  params: z.ZodType;
  actor: RouteActorRequirement;
  request: { location: "body" | "query" | "none"; schema: z.ZodType };
  success: { statuses: readonly number[]; body: "json" | "none" | "event-stream"; schema: z.ZodType | null };
  guestCookie?: { mode: "set" | "set-if-missing-valid-session"; schema: typeof guestSessionCookieSchema };
  errors: {
    codes: readonly AppErrorCode[];
    codeSchema: z.ZodType;
    bodySchema: z.ZodType;
    statusByCode: Partial<Record<AppErrorCode, 400 | 401 | 403 | 404 | 409 | 429 | 500>>;
  };
}>;
export type AppointmentRouteName = keyof typeof appointmentRouteContracts;
export type RouteErrorCode<Name extends AppointmentRouteName> = z.infer<(typeof appointmentRouteContracts)[Name]["errors"]["codeSchema"]>;
export type RouteErrorBody<Name extends AppointmentRouteName> = z.infer<(typeof appointmentRouteContracts)[Name]["errors"]["bodySchema"]>;
