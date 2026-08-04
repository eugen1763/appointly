import { describe, expect, expectTypeOf, it } from "vitest";

import {
  actorContextSchema,
  addManagerRequestSchema,
  addOptionRequestSchema,
  appointmentRouteContracts,
  appointmentParamsSchema,
  appointmentSnapshotQuerySchema,
  appointmentSnapshotSchema,
  createAppointmentInputSchema,
  deleteAppointmentRequestSchema,
  deleteConfirmationDetailsSchema,
  deleteOptionRequestSchema,
  finalizeRequestSchema,
  guestAccessRequestSchema,
  guestSessionCookieSchema,
  joinParticipantRequestSchema,
  joinParticipantSuccessSchema,
  managerParticipantRequestSchema,
  managerParamsSchema,
  noBodySchema,
  noParamsSchema,
  optionInputSchema,
  optionValueSchema,
  optionParamsSchema,
  participantParamsSchema,
  putResponseRequestSchema,
  routeActorRequirementSchema,
  updateAppointmentRequestSchema,
  type ActorContext,
  type AddOptionRequest,
  type AppointmentSnapshot,
  type CreateAppointmentInput,
  type DeleteOptionRequest,
  type OptionInput,
  type OptionValue,
  type RouteErrorBody,
  type RouteErrorCode,
} from "./contracts";

import { APP_ERROR_STATUS } from "./http-errors";

const participantId = "11111111-1111-4111-8111-111111111111";
const otherParticipantId = "33333333-3333-4333-8333-333333333333";
const optionId = "22222222-2222-4222-8222-222222222222";
const publicId = "ABCDEFGHIJKLMNOPQRSTUVWX";
const guestToken = "A".repeat(43);

const validCreateInput = {
  title: "Planning session",
  description: null,
  ownerDisplayName: "Avery",
  type: "DATE" as const,
  optionLimit: 10,
  coOrganizerEmails: ["coorganizer@example.com"],
  timeZone: "America/New_York",
  options: [{ kind: "DATE" as const, startDate: "2030-04-03" }],
};

const validSnapshot = {
  appointment: {
    publicId,
    title: "Planning session",
    description: null,
    type: "DATE" as const,
    status: "ACTIVE" as const,
    optionLimit: 10,
    finalOptionId: null,
    revision: 3,
  },
  participants: [
    { id: participantId, displayName: "Avery" },
    { id: otherParticipantId, displayName: "Blake" },
  ],
  options: [{
    id: optionId,
    kind: "DATE" as const,
    startDate: "2030-04-03",
    creatorParticipantId: participantId,
    responses: [
      { participantId, value: "YES" as const },
      { participantId: otherParticipantId, value: "NO" as const },
    ],
    yesCount: 1,
    noCount: 1,
    canDelete: true,
  }],
  viewer: {
    kind: "guest" as const,
    activeParticipantId: participantId,
    accessibleParticipants: [{ id: participantId, displayName: "Avery" }],
    needsParticipantName: false,
    participantEnrollmentError: null,
    permissions: {
      canEditAppointment: false,
      canManageCoOrganizers: false,
      canDeleteAppointment: false,
      canFinalize: false,
      canReopen: false,
      canResetGuestLinks: false,
      canRespond: true,
      canSuggest: true,
    },
  },
};

function issuePaths(result: ReturnType<typeof optionInputSchema.safeParse>): string[][] {
  return result.success ? [] : result.error.issues.map((issue) => issue.path.map(String));
}

describe("the seven approved plan types", () => {
  it("matches each plan type exactly", () => {
    expectTypeOf<OptionInput>().toEqualTypeOf<
      | { kind: "DATE"; startDate: string }
      | { kind: "DATE_TIME"; startAt: string }
      | { kind: "DATE_RANGE"; startDate: string; endDate: string }
      | { kind: "DATE_TIME_RANGE"; startAt: string; endAt: string }
    >();
    expectTypeOf<CreateAppointmentInput>().toEqualTypeOf<{
      title: string;
      description: string | null;
      ownerDisplayName: string;
      type: OptionInput["kind"];
      optionLimit: number;
      coOrganizerEmails: string[];
      timeZone: string;
      options: OptionInput[];
    }>();
    expectTypeOf<AddOptionRequest>().toEqualTypeOf<{
      participantId: string;
      timeZone: string;
      option: OptionInput;
    }>();
    expectTypeOf<DeleteOptionRequest>().toEqualTypeOf<{
      participantId: string;
      confirmationToken?: string;
    }>();
    expectTypeOf<OptionValue>().toEqualTypeOf<
      | { kind: "DATE"; startDate: string }
      | { kind: "DATE_TIME"; startAt: number }
      | { kind: "DATE_RANGE"; startDate: string; endDate: string }
      | { kind: "DATE_TIME_RANGE"; startAt: number; endAt: number }
    >();
    expectTypeOf<ActorContext>().toEqualTypeOf<
      | { kind: "authenticated"; userId: string; managerRole: "OWNER" | "COORGANIZER" | null; participantId: string | null }
      | { kind: "guest"; guestSessionHash: string; participantId: string }
      | { kind: "anonymous" }
    >();
    expectTypeOf<AppointmentSnapshot>().toEqualTypeOf<{
      appointment: {
        publicId: string;
        title: string;
        description: string | null;
        type: OptionInput["kind"];
        status: "ACTIVE" | "FINALIZED";
        optionLimit: number;
        finalOptionId: string | null;
        revision: number;
      };
      participants: Array<{ id: string; displayName: string }>;
      options: Array<OptionValue & {
        id: string;
        creatorParticipantId: string;
        responses: Array<{ participantId: string; value: "YES" | "NO" }>;
        yesCount: number;
        noCount: number;
        canDelete: boolean;
      }>;
      viewer: {
        kind: ActorContext["kind"];
        activeParticipantId: string | null;
        accessibleParticipants: Array<{ id: string; displayName: string }>;
        needsParticipantName: boolean;
        participantEnrollmentError: "PARTICIPANT_LIMIT_REACHED" | null;
        permissions: {
          canEditAppointment: boolean;
          canManageCoOrganizers: boolean;
          canDeleteAppointment: boolean;
          canFinalize: boolean;
          canReopen: boolean;
          canResetGuestLinks: boolean;
          canRespond: boolean;
          canSuggest: boolean;
        };
      };
    }>();
  });
});

describe("option input schemas", () => {
  it.each([
    { kind: "DATE", startDate: "2030-04-03" },
    { kind: "DATE_TIME", startAt: "2030-04-03T13:30:00.000Z" },
    { kind: "DATE_RANGE", startDate: "2030-04-03", endDate: "2030-04-05" },
    { kind: "DATE_TIME_RANGE", startAt: "2030-04-03T13:30:00.000Z", endAt: "2030-04-03T14:30:00.000Z" },
  ])("accepts the strict $kind shape without doing calendar work", (input) => {
    expect(optionInputSchema.parse(input)).toEqual(input);
  });

  it.each([
    [{ kind: "DATE", startDate: "2030-04-03", startAt: "2030-04-03T00:00:00.000Z" }, []],
    [{ kind: "DATE_TIME", startAt: "x", endAt: "y" }, []],
    [{ kind: "DATE_RANGE", startDate: "x" }, ["endDate"]],
    [{ kind: "DATE_TIME_RANGE", startAt: "x", endAt: "y", startDate: "z" }, []],
    [{ kind: "WEEK", startDate: "x" }, ["kind"]],
  ])("rejects mixed, incomplete, or unknown option input %#", (input, expectedPath) => {
    expect(issuePaths(optionInputSchema.safeParse(input))).toContainEqual(expectedPath);
  });
});

describe("option value schemas", () => {
  it.each([
    { kind: "DATE", startDate: "2030-04-03" },
    { kind: "DATE_TIME", startAt: 1_901_449_800_000 },
    { kind: "DATE_RANGE", startDate: "2030-04-03", endDate: "2030-04-05" },
    { kind: "DATE_TIME_RANGE", startAt: 1_901_449_800_000, endAt: 1_901_453_400_000 },
  ])("accepts the strict $kind shape", (value) => {
    expect(optionValueSchema.parse(value)).toEqual(value);
  });

  it.each([
    { kind: "DATE", startDate: "x", endDate: "y" },
    { kind: "DATE_TIME", startAt: "2030-04-03T13:30:00.000Z" },
    { kind: "DATE_RANGE", startDate: "x", endDate: "y", startAt: 1 },
    { kind: "DATE_TIME_RANGE", startAt: 1, endAt: 2, endDate: "x" },
  ])("rejects mixed fields and string timestamps %#", (value) => {
    expect(optionValueSchema.safeParse(value).success).toBe(false);
  });
});

describe("create and update request constraints", () => {
  it("accepts the exact create request", () => {
    expect(createAppointmentInputSchema.parse(validCreateInput)).toEqual(validCreateInput);
  });

  it("validates display-name length after normalization without transforming the request", () => {
    const paddedName = `A${" ".repeat(100)}`;
    expect(joinParticipantRequestSchema.parse({ displayName: paddedName })).toEqual({
      displayName: paddedName,
    });
    expect(managerParticipantRequestSchema.safeParse({ displayName: " \t\n " }).success).toBe(false);
    expect(createAppointmentInputSchema.safeParse({
      ...validCreateInput,
      ownerDisplayName: " \t\n ",
    }).success).toBe(false);
  });

  it.each([
    ["title", { title: "x".repeat(121) }, ["title"]],
    ["whitespace-only title", { title: " \t\n\u00a0\u2003 " }, ["title"]],
    ["owner name", { ownerDisplayName: "x".repeat(81) }, ["ownerDisplayName"]],
    ["description", { description: "x".repeat(2_001) }, ["description"]],
    ["low option limit", { optionLimit: 0 }, ["optionLimit"]],
    ["high option limit", { optionLimit: 101 }, ["optionLimit"]],
    ["fractional option limit", { optionLimit: 1.5 }, ["optionLimit"]],
    ["empty options", { options: [] }, ["options"]],
    ["too many co-organizers", { coOrganizerEmails: Array.from({ length: 21 }, (_, index) => `person${index}@example.com`) }, ["coOrganizerEmails"]],
    ["invalid email", { coOrganizerEmails: ["not-an-email"] }, ["coOrganizerEmails", "0"]],
  ])("rejects a create request with invalid %s", (_label, patch, path) => {
    const result = createAppointmentInputSchema.safeParse({ ...validCreateInput, ...patch });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues.map((issue) => issue.path.map(String))).toContainEqual(path);
  });

  it("rejects duplicate normalized co-organizer emails at the duplicate field", () => {
    const result = createAppointmentInputSchema.safeParse({
      ...validCreateInput,
      coOrganizerEmails: ["Person@Example.com", "person@example.com"],
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues.map((issue) => issue.path.map(String))).toContainEqual(["coOrganizerEmails", "1"]);
  });

  it("requires all initial option kinds to match the immutable appointment type", () => {
    const result = createAppointmentInputSchema.safeParse({
      ...validCreateInput,
      options: [{ kind: "DATE_TIME", startAt: "2030-04-03T13:30:00.000Z" }],
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues.map((issue) => issue.path.map(String))).toContainEqual(["options", "0", "kind"]);
  });

  it("keeps the initial option count within the chosen limit", () => {
    const result = createAppointmentInputSchema.safeParse({
      ...validCreateInput,
      optionLimit: 1,
      options: [
        { kind: "DATE", startDate: "2030-04-03" },
        { kind: "DATE", startDate: "2030-04-04" },
      ],
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues.map((issue) => issue.path.map(String))).toContainEqual(["options"]);
  });

  it("accepts only a nonempty strict patch of mutable detail fields", () => {
    expect(updateAppointmentRequestSchema.safeParse({}).success).toBe(false);
    expect(updateAppointmentRequestSchema.safeParse({ type: "DATE" }).success).toBe(false);
    expect(updateAppointmentRequestSchema.safeParse({ options: [] }).success).toBe(false);
    expect(updateAppointmentRequestSchema.safeParse({
      title: "New title",
      extra: true,
    }).success).toBe(false);
    expect(updateAppointmentRequestSchema.safeParse({ title: "New title" }).success).toBe(true);
    expect(updateAppointmentRequestSchema.safeParse({
      description: null,
      optionLimit: 100,
    }).success).toBe(true);
  });
});

describe("remaining request schemas", () => {
  it("enforces request fields, enum values, and UUID paths", () => {
    expect(appointmentSnapshotQuerySchema.parse({})).toEqual({});
    expect(appointmentSnapshotQuerySchema.safeParse({ participantId: "bad" }).success).toBe(false);
    expect(deleteAppointmentRequestSchema.safeParse({ title: "" }).success).toBe(false);
    expect(addManagerRequestSchema.safeParse({ email: "bad" }).success).toBe(false);
    expect(managerParticipantRequestSchema.safeParse({ displayName: "x".repeat(81) }).success).toBe(false);
    expect(joinParticipantRequestSchema.safeParse({ displayName: "Avery" }).success).toBe(true);
    expect(guestAccessRequestSchema.safeParse({ participantId, token: guestToken }).success).toBe(true);
    expect(guestAccessRequestSchema.safeParse({ participantId, token: "short" }).success).toBe(false);
    expect(guestAccessRequestSchema.safeParse({
      participantId,
      token: `${"A".repeat(42)}B`,
    }).success).toBe(false);
    expect(putResponseRequestSchema.safeParse({ participantId, value: null }).success).toBe(true);
    expect(putResponseRequestSchema.safeParse({ participantId, value: "MAYBE" }).success).toBe(false);
    expect(addOptionRequestSchema.safeParse({ participantId, timeZone: "UTC", option: { kind: "DATE", startDate: "2030-04-03" } }).success).toBe(true);
    expect(deleteOptionRequestSchema.safeParse({ participantId }).success).toBe(true);
    expect(deleteOptionRequestSchema.safeParse({ participantId, confirmationToken: "" }).success).toBe(false);
    expect(finalizeRequestSchema.safeParse({ optionId }).success).toBe(true);
  });

  it.each([
    [appointmentSnapshotQuerySchema, { extra: true }],
    [deleteAppointmentRequestSchema, { title: "Planning session", extra: true }],
    [addManagerRequestSchema, { email: "person@example.com", extra: true }],
    [managerParticipantRequestSchema, { displayName: "Avery", extra: true }],
    [joinParticipantRequestSchema, { displayName: "Avery", extra: true }],
    [guestAccessRequestSchema, { participantId, token: guestToken, extra: true }],
    [putResponseRequestSchema, { participantId, value: "YES", extra: true }],
    [addOptionRequestSchema, { participantId, timeZone: "UTC", option: { kind: "DATE", startDate: "x" }, extra: true }],
    [deleteOptionRequestSchema, { participantId, extra: true }],
    [finalizeRequestSchema, { optionId, extra: true }],
  ])("rejects unknown request fields %#", (schema, value) => {
    expect(schema.safeParse(value).success).toBe(false);
  });
});

describe("actor and guest cookie contracts", () => {
  it.each([
    { kind: "authenticated", userId: "better-auth-user", managerRole: "OWNER", participantId },
    { kind: "authenticated", userId: "better-auth-user", managerRole: null, participantId: null },
    { kind: "guest", guestSessionHash: "digest", participantId },
    { kind: "anonymous" },
  ])("accepts exact $kind actor contexts", (actor) => {
    expect(actorContextSchema.safeParse(actor).success).toBe(true);
  });

  it("rejects actor field mixing and unknown roles", () => {
    expect(actorContextSchema.safeParse({ kind: "anonymous", participantId }).success).toBe(false);
    expect(actorContextSchema.safeParse({ kind: "authenticated", userId: "u", managerRole: "ADMIN", participantId: null }).success).toBe(false);
  });

  it("closes the route actor requirement enum", () => {
    const allowed = ["public", "authenticated", "manager", "owner", "bound-manager", "non-manager-visitor-without-participant-access", "participant"];
    for (const actor of allowed) expect(routeActorRequirementSchema.safeParse(actor).success).toBe(true);
    expect(routeActorRequirementSchema.safeParse("any-user").success).toBe(false);
  });

  it("requires the exact fixed-lifetime guest cookie and a 32-byte base64url value", () => {
    const cookie = {
      name: "appointly_guest_session",
      value: guestToken,
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 31_536_000,
      secure: true,
    };
    expect(guestSessionCookieSchema.parse(cookie)).toEqual(cookie);
    expect(guestSessionCookieSchema.safeParse({ ...cookie, value: `${guestToken}=` }).success).toBe(false);
    expect(guestSessionCookieSchema.safeParse({ ...cookie, httpOnly: false }).success).toBe(false);
    expect(guestSessionCookieSchema.safeParse({ ...cookie, sameSite: "strict" }).success).toBe(false);
    expect(guestSessionCookieSchema.safeParse({ ...cookie, maxAge: 1 }).success).toBe(false);
    expect(guestSessionCookieSchema.safeParse({ ...cookie, extra: true }).success).toBe(false);
  });
});

describe("public appointment snapshot", () => {
  it("accepts the exact nested snapshot", () => {
    expect(appointmentSnapshotSchema.parse(validSnapshot)).toEqual(validSnapshot);
  });

  it.each([
    ["appointment", { ...validSnapshot, appointment: { ...validSnapshot.appointment, ownerUserId: "secret" } }],
    ["manager email", { ...validSnapshot, appointment: { ...validSnapshot.appointment, emailNormalized: "secret@example.com" } }],
    ["participant edit hash", { ...validSnapshot, participants: [{ ...validSnapshot.participants[0], editTokenHash: "secret" }] }],
    ["guest hash", { ...validSnapshot, viewer: { ...validSnapshot.viewer, guestSessionHash: "secret" } }],
    ["rate key", { ...validSnapshot, appointment: { ...validSnapshot.appointment, rateLimitKey: "secret" } }],
    ["Better Auth account", { ...validSnapshot, viewer: { ...validSnapshot.viewer, account: { accessToken: "secret" } } }],
  ])("rejects forbidden public %s fields", (_label, snapshot) => {
    expect(appointmentSnapshotSchema.safeParse(snapshot).success).toBe(false);
  });

  it("rejects wrong snapshot enums, missing permissions, and inconsistent option shapes", () => {
    expect(appointmentSnapshotSchema.safeParse({ ...validSnapshot, appointment: { ...validSnapshot.appointment, status: "DRAFT" } }).success).toBe(false);
    const { canSuggest: _removed, ...permissions } = validSnapshot.viewer.permissions;
    expect(appointmentSnapshotSchema.safeParse({ ...validSnapshot, viewer: { ...validSnapshot.viewer, permissions } }).success).toBe(false);
    expect(appointmentSnapshotSchema.safeParse({ ...validSnapshot, options: [{ ...validSnapshot.options[0], startAt: 1 }] }).success).toBe(false);
  });
});

describe("typed route contract matrix", () => {
  const expected = {
    createAppointment: ["POST", "/api/appointments", "authenticated", [201], "body", "json"],
    getSnapshot: ["GET", "/api/appointments/[publicId]/snapshot", "public", [200], "query", "json"],
    getEvents: ["GET", "/api/appointments/[publicId]/events", "public", [200], "none", "event-stream"],
    updateAppointment: ["PATCH", "/api/appointments/[publicId]", "bound-manager", [200], "body", "json"],
    deleteAppointment: ["DELETE", "/api/appointments/[publicId]", "owner", [204], "body", "none"],
    listManagers: ["GET", "/api/appointments/[publicId]/managers", "owner", [200], "none", "json"],
    addManager: ["POST", "/api/appointments/[publicId]/managers", "owner", [201], "body", "json"],
    deleteManager: ["DELETE", "/api/appointments/[publicId]/managers/[managerId]", "owner", [200], "none", "json"],
    createManagerParticipant: ["POST", "/api/appointments/[publicId]/manager-participant", "bound-manager", [200, 201], "body", "json"],
    joinParticipant: ["POST", "/api/appointments/[publicId]/participants", "non-manager-visitor-without-participant-access", [201], "body", "json"],
    exchangeGuestAccess: ["POST", "/api/appointments/[publicId]/guest-access", "public", [200], "body", "json"],
    resetParticipantLink: ["POST", "/api/appointments/[publicId]/participants/[participantId]/reset-link", "manager", [200], "none", "json"],
    putResponse: ["PUT", "/api/appointments/[publicId]/responses/[optionId]", "participant", [200], "body", "json"],
    addOption: ["POST", "/api/appointments/[publicId]/options", "participant", [201], "body", "json"],
    deleteOption: ["DELETE", "/api/appointments/[publicId]/options/[optionId]", "participant", [200], "body", "json"],
    finalizeAppointment: ["POST", "/api/appointments/[publicId]/finalize", "manager", [200], "body", "json"],
    reopenAppointment: ["POST", "/api/appointments/[publicId]/reopen", "manager", [200], "none", "json"],
  } as const;

  it("has exactly one correctly addressed entry for every planned route", () => {
    expect(Object.keys(appointmentRouteContracts)).toEqual(Object.keys(expected));
    for (const name of Object.keys(expected) as Array<keyof typeof expected>) {
      const contract = appointmentRouteContracts[name];
      const [method, path, actor, statuses, requestLocation, responseBody] = expected[name];
      expect([contract.method, contract.path, contract.actor, contract.success.statuses, contract.request.location, contract.success.body]).toEqual([
        method,
        path,
        actor,
        statuses,
        requestLocation,
        responseBody,
      ]);
    }
  });

  it("represents no-body requests, deletion, and the SSE non-JSON response explicitly", () => {
    for (const name of ["getEvents", "listManagers", "deleteManager", "resetParticipantLink", "reopenAppointment"] as const) {
      const request = appointmentRouteContracts[name].request;
      expect(request.location).toBe("none");
      expect(request.schema).toBe(noBodySchema);
      expect(request.schema.safeParse(undefined).success).toBe(true);
      expect(request.schema.safeParse({}).success).toBe(false);
    }
    expect(appointmentRouteContracts.deleteAppointment.success.schema).toBe(noBodySchema);
    expect(appointmentRouteContracts.deleteAppointment.success.body).toBe("none");
    expect(appointmentRouteContracts.getEvents.success.schema).toBeNull();
    expect(appointmentRouteContracts.getEvents.success.body).toBe("event-stream");
  });

  it("records guest cookie behavior only on join and token exchange", () => {
    expect(appointmentRouteContracts.joinParticipant.guestCookie).toEqual({ mode: "set", schema: guestSessionCookieSchema });
    expect(appointmentRouteContracts.exchangeGuestAccess.guestCookie).toEqual({ mode: "set-if-missing-valid-session", schema: guestSessionCookieSchema });
    for (const [name, contract] of Object.entries(appointmentRouteContracts)) {
      if (name !== "joinParticipant" && name !== "exchangeGuestAccess") expect("guestCookie" in contract).toBe(false);
    }
  });

  it("attaches one strict reusable path-param schema to every route", () => {
    const expectedParamSchemas = {
      createAppointment: noParamsSchema,
      getSnapshot: appointmentParamsSchema,
      getEvents: appointmentParamsSchema,
      updateAppointment: appointmentParamsSchema,
      deleteAppointment: appointmentParamsSchema,
      listManagers: appointmentParamsSchema,
      addManager: appointmentParamsSchema,
      deleteManager: managerParamsSchema,
      createManagerParticipant: appointmentParamsSchema,
      joinParticipant: appointmentParamsSchema,
      exchangeGuestAccess: appointmentParamsSchema,
      resetParticipantLink: participantParamsSchema,
      putResponse: optionParamsSchema,
      addOption: appointmentParamsSchema,
      deleteOption: optionParamsSchema,
      finalizeAppointment: appointmentParamsSchema,
      reopenAppointment: appointmentParamsSchema,
    } as const;

    for (const name of Object.keys(expectedParamSchemas) as Array<keyof typeof expectedParamSchemas>) {
      expect(appointmentRouteContracts[name].params).toBe(expectedParamSchemas[name]);
    }

    expect(noParamsSchema.safeParse({}).success).toBe(true);
    expect(noParamsSchema.safeParse({ publicId }).success).toBe(false);
    expect(appointmentParamsSchema.safeParse({ publicId }).success).toBe(true);
    expect(appointmentParamsSchema.safeParse({ publicId: "short" }).success).toBe(false);
    expect(managerParamsSchema.safeParse({
      publicId,
      managerId: "44444444-4444-4444-8444-444444444444",
    }).success).toBe(true);
    expect(participantParamsSchema.safeParse({ publicId, participantId }).success).toBe(true);
    expect(optionParamsSchema.safeParse({ publicId, optionId }).success).toBe(true);
    expect(optionParamsSchema.safeParse({ publicId, optionId, extra: true }).success).toBe(false);
  });

  it("gives each route a closed exact error-code schema", () => {
    const expectedErrors = {
      createAppointment: ["VALIDATION_FAILED", "UNAUTHENTICATED", "ORIGIN_MISMATCH", "NAME_TAKEN", "DUPLICATE_OPTION", "OPTION_LIMIT_REACHED", "COORGANIZER_LIMIT_REACHED", "MANAGER_ALREADY_EXISTS", "INTERNAL_ERROR"],
      getSnapshot: ["VALIDATION_FAILED", "NOT_FOUND"],
      getEvents: ["VALIDATION_FAILED", "NOT_FOUND"],
      updateAppointment: ["VALIDATION_FAILED", "UNAUTHENTICATED", "FORBIDDEN", "ORIGIN_MISMATCH", "NOT_FOUND", "APPOINTMENT_FINALIZED", "LIMIT_BELOW_CURRENT_COUNT"],
      deleteAppointment: ["VALIDATION_FAILED", "UNAUTHENTICATED", "FORBIDDEN", "ORIGIN_MISMATCH", "NOT_FOUND", "TITLE_CONFIRMATION_MISMATCH"],
      listManagers: ["VALIDATION_FAILED", "UNAUTHENTICATED", "FORBIDDEN", "NOT_FOUND"],
      addManager: ["VALIDATION_FAILED", "UNAUTHENTICATED", "FORBIDDEN", "ORIGIN_MISMATCH", "NOT_FOUND", "APPOINTMENT_FINALIZED", "COORGANIZER_LIMIT_REACHED", "MANAGER_ALREADY_EXISTS"],
      deleteManager: ["VALIDATION_FAILED", "UNAUTHENTICATED", "FORBIDDEN", "ORIGIN_MISMATCH", "NOT_FOUND", "APPOINTMENT_FINALIZED"],
      createManagerParticipant: ["VALIDATION_FAILED", "UNAUTHENTICATED", "FORBIDDEN", "ORIGIN_MISMATCH", "NOT_FOUND", "NAME_TAKEN", "PARTICIPANT_LIMIT_REACHED", "APPOINTMENT_FINALIZED"],
      joinParticipant: ["VALIDATION_FAILED", "FORBIDDEN", "ORIGIN_MISMATCH", "NOT_FOUND", "NAME_TAKEN", "PARTICIPANT_LIMIT_REACHED", "APPOINTMENT_FINALIZED", "RATE_LIMITED", "INTERNAL_ERROR"],
      exchangeGuestAccess: ["ORIGIN_MISMATCH", "INVALID_EDIT_LINK", "INTERNAL_ERROR"],
      resetParticipantLink: ["VALIDATION_FAILED", "UNAUTHENTICATED", "FORBIDDEN", "ORIGIN_MISMATCH", "NOT_FOUND", "APPOINTMENT_FINALIZED"],
      putResponse: ["VALIDATION_FAILED", "FORBIDDEN", "ORIGIN_MISMATCH", "NOT_FOUND", "APPOINTMENT_FINALIZED", "RATE_LIMITED"],
      addOption: ["VALIDATION_FAILED", "FORBIDDEN", "ORIGIN_MISMATCH", "NOT_FOUND", "APPOINTMENT_FINALIZED", "OPTION_LIMIT_REACHED", "DUPLICATE_OPTION", "RATE_LIMITED"],
      deleteOption: ["VALIDATION_FAILED", "FORBIDDEN", "ORIGIN_MISMATCH", "NOT_FOUND", "APPOINTMENT_FINALIZED", "DELETE_CONFIRMATION_REQUIRED", "STALE_DELETE_CONFIRMATION", "RATE_LIMITED"],
      finalizeAppointment: ["VALIDATION_FAILED", "UNAUTHENTICATED", "FORBIDDEN", "ORIGIN_MISMATCH", "NOT_FOUND", "APPOINTMENT_FINALIZED", "INVALID_FINAL_OPTION"],
      reopenAppointment: ["VALIDATION_FAILED", "UNAUTHENTICATED", "FORBIDDEN", "ORIGIN_MISMATCH", "NOT_FOUND"],
    } as const;

    for (const name of Object.keys(expectedErrors) as Array<keyof typeof expectedErrors>) {
      const errors = appointmentRouteContracts[name].errors;
      expect(errors.codes).toEqual(expectedErrors[name]);
      for (const code of expectedErrors[name]) expect(errors.codeSchema.safeParse(code).success).toBe(true);
      expect(errors.codeSchema.safeParse("SOME_NEW_ERROR").success).toBe(false);
    }

    expectTypeOf<RouteErrorCode<"deleteOption">>().toEqualTypeOf<
      | "VALIDATION_FAILED"
      | "FORBIDDEN"
      | "ORIGIN_MISMATCH"
      | "NOT_FOUND"
      | "APPOINTMENT_FINALIZED"
      | "DELETE_CONFIRMATION_REQUIRED"
      | "STALE_DELETE_CONFIRMATION"
      | "RATE_LIMITED"
    >();
  });

  it("validates strict route error bodies and reuses Task 15 statuses", () => {
    for (const contract of Object.values(appointmentRouteContracts)) {
      for (const code of contract.errors.codes) {
        const error = code === "DELETE_CONFIRMATION_REQUIRED" || code === "STALE_DELETE_CONFIRMATION"
          ? {
              error: {
                code,
                message: "Confirmation changed",
                details: { count: 2, names: ["Avery", "Blake"], token: guestToken },
              },
            }
          : { error: { code, message: "Request failed" } };
        expect(contract.errors.bodySchema.safeParse(error).success).toBe(true);
      }
      expect(Object.entries(contract.errors.statusByCode)).toEqual(
        contract.errors.codes.map((code) => [code, APP_ERROR_STATUS[code]]),
      );
      expect(contract.errors.bodySchema.safeParse({
        error: { code: "SOME_NEW_ERROR", message: "No" },
      }).success).toBe(false);
    }

    const updateErrors = appointmentRouteContracts.updateAppointment.errors.bodySchema;
    expect(updateErrors.safeParse({
      error: {
        code: "VALIDATION_FAILED",
        message: "Invalid",
        fieldErrors: { title: ["Required"] },
      },
    }).success).toBe(true);
    expect(updateErrors.safeParse({
      error: { code: "NOT_FOUND", message: "Missing", details: { count: 1, names: ["Avery"], token: guestToken } },
    }).success).toBe(false);
    expect(updateErrors.safeParse({
      error: { code: "NOT_FOUND", message: "Missing", extra: true },
    }).success).toBe(false);
    expect(updateErrors.safeParse({
      error: { code: "NOT_FOUND", message: "Missing" },
      extra: true,
    }).success).toBe(false);
  });

  it("requires exact self-consistent option-delete confirmation details", () => {
    const validDetails = { count: 2, names: ["Avery", "Blake"], token: guestToken };
    expect(deleteConfirmationDetailsSchema.parse(validDetails)).toEqual(validDetails);
    expect(deleteConfirmationDetailsSchema.safeParse({ ...validDetails, count: 0 }).success).toBe(false);
    expect(deleteConfirmationDetailsSchema.safeParse({ ...validDetails, count: 1 }).success).toBe(false);
    expect(deleteConfirmationDetailsSchema.safeParse({ ...validDetails, token: "short" }).success).toBe(false);
    expect(deleteConfirmationDetailsSchema.safeParse({ ...validDetails, extra: true }).success).toBe(false);

    const deleteErrors = appointmentRouteContracts.deleteOption.errors.bodySchema;
    for (const code of ["DELETE_CONFIRMATION_REQUIRED", "STALE_DELETE_CONFIRMATION"] as const) {
      expect(deleteErrors.safeParse({
        error: { code, message: "Confirm", details: validDetails },
      }).success).toBe(true);
      expect(deleteErrors.safeParse({
        error: { code, message: "Confirm" },
      }).success).toBe(false);
    }

    expectTypeOf<RouteErrorBody<"deleteOption">>().toMatchTypeOf<{
      error: {
        code: RouteErrorCode<"deleteOption">;
        message: string;
        fieldErrors?: Record<string, string[]>;
      };
    }>();
  });
  it("accepts only the exact guest or pending-manager join response", () => {
    const guest = {
      participantId,
      editUrl: `/a/${publicId}/edit#participant=${participantId}&token=${guestToken}`,
      revision: 4,
    };
    const pendingManager = { participantId, revision: 4 };

    expect(joinParticipantSuccessSchema.parse(guest)).toEqual(guest);
    expect(joinParticipantSuccessSchema.parse(pendingManager)).toEqual(pendingManager);
    expect(joinParticipantSuccessSchema.safeParse({ ...guest, kind: "guest" }).success).toBe(false);
    expect(joinParticipantSuccessSchema.safeParse({ ...guest, sessionToken: guestToken }).success).toBe(false);
    expect(joinParticipantSuccessSchema.safeParse({ ...pendingManager, editUrl: undefined }).success).toBe(false);
    expect(joinParticipantSuccessSchema.safeParse({ ...pendingManager, kind: "manager" }).success).toBe(false);
  });


  it("requires revision on every surviving mutation except guest access", () => {
    const successSamples = {
      createAppointment: { publicId, publicUrl: `https://example.test/a/${publicId}`, revision: 1 },
      updateAppointment: { revision: 4 },
      addManager: { manager: { id: "44444444-4444-4444-8444-444444444444", email: "person@example.com", role: "COORGANIZER", status: "PENDING", canRemove: true }, revision: 4 },
      deleteManager: { revision: 4 },
      createManagerParticipant: { participantId, revision: 4 },
      joinParticipant: { participantId, editUrl: `/a/${publicId}/edit#participant=${participantId}&token=${guestToken}`, revision: 4 },
      resetParticipantLink: { participantId, editUrl: `/a/${publicId}/edit#participant=${participantId}&token=${guestToken}`, revision: 4 },
      putResponse: { value: "YES", revision: 4 },
      addOption: { optionId, revision: 4 },
      deleteOption: { revision: 4 },
      finalizeAppointment: { revision: 4 },
      reopenAppointment: { revision: 4 },
    } as const;

    for (const name of Object.keys(successSamples) as Array<keyof typeof successSamples>) {
      const schema = appointmentRouteContracts[name].success.schema;
      const sample = successSamples[name];
      expect(schema.safeParse(sample).success).toBe(true);
      const { revision: _revision, ...withoutRevision } = sample;
      expect(schema.safeParse(withoutRevision).success).toBe(false);
    }

    expect(appointmentRouteContracts.exchangeGuestAccess.success.schema.safeParse({ participantId }).success).toBe(true);
    expect(appointmentRouteContracts.exchangeGuestAccess.success.schema.safeParse({ participantId, revision: 4 }).success).toBe(false);
    expect(appointmentRouteContracts.deleteAppointment.success.statuses).toEqual([204]);
  });

  it("validates each non-mutation JSON success shape strictly", () => {
    expect(appointmentRouteContracts.getSnapshot.success.schema.safeParse(validSnapshot).success).toBe(true);
    expect(appointmentRouteContracts.listManagers.success.schema.safeParse({
      managers: [{ id: "44444444-4444-4444-8444-444444444444", email: "owner@example.com", role: "OWNER", status: "BOUND", canRemove: false }],
    }).success).toBe(true);
    expect(appointmentRouteContracts.listManagers.success.schema.safeParse({ managers: [], extra: true }).success).toBe(false);
  });
});
