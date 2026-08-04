import { eq } from "drizzle-orm";

import {
  appointmentManagers,
  appointmentOptions,
  appointments,
  participants,
  responses,
} from "../../../db/schema";
import { normalizeEmail } from "../../../lib/email";
import type {
  CreateAppointmentInput,
  OptionInput,
} from "../contracts";
import { AppError } from "../http-errors";
import {
  appointmentDetailFieldErrors,
  COORGANIZER_MAX_COUNT,
  isValidCoOrganizerCount,
  isValidDisplayNameLength,
  normalizeParticipantName,
} from "../validation";
import {
  InvalidTimeZoneError,
  optionCreationTime,
  validateOptionInputForStorage,
  validateOptionStartForCreation,
  type OptionStorageValues,
} from "./option-storage";
import type {
  ServiceContext,
  TransactionContext,
} from "./service-context";
import { publishAppointmentRevision, runImmediate } from "./transactions";

export interface InsertOwnerManagerAndParticipantInput {
  readonly appointmentId: string;
  readonly ownerUserId: string;
  readonly ownerEmail: string;
  readonly ownerDisplayName: string;
  readonly now: number;
}

export function insertOwnerManagerAndParticipant(
  context: TransactionContext,
  input: InsertOwnerManagerAndParticipantInput,
): string {
  const name = normalizeParticipantName(input.ownerDisplayName);
  if (!isValidDisplayNameLength(name.displayName)) {
    throw new AppError("VALIDATION_FAILED", "Enter an owner display name.", {
      fieldErrors: {
        ownerDisplayName: ["Display name must contain 1 to 80 normalized characters."],
      },
    });
  }

  context.db.insert(appointmentManagers).values({
    appointmentId: input.appointmentId,
    emailNormalized: normalizeEmail(input.ownerEmail),
    userId: input.ownerUserId,
    role: "OWNER",
    createdAt: input.now,
  }).run();

  const participant = context.db.insert(participants).values({
    appointmentId: input.appointmentId,
    userId: input.ownerUserId,
    displayName: name.displayName,
    normalizedName: name.normalizedName,
    editTokenHash: null,
    createdAt: input.now,
    updatedAt: input.now,
  }).returning({ id: participants.id }).get();

  return participant.id;
}

const PUBLIC_ID_TOKEN_BYTES = 32;
const PUBLIC_ID_BYTES = 18;
const PUBLIC_ID_ALLOCATION_ATTEMPTS = 8;

export interface CreateAppointmentCommandInput {
  readonly ownerUserId: string;
  readonly ownerEmail: string;
  readonly appointment: CreateAppointmentInput;
}

export interface CreateAppointmentResult {
  readonly publicId: string;
  readonly revision: 1;
}

interface PreparedCreation {
  readonly normalizedOwnerEmail: string;
  readonly normalizedCoOrganizerEmails: readonly string[];
  readonly options: readonly OptionStorageValues[];
}

interface CreatedAppointment extends CreateAppointmentResult {
  readonly appointmentId: string;
}

function validationError(
  message: string,
  fieldErrors?: Record<string, string[]>,
  cause?: unknown,
): AppError {
  return new AppError("VALIDATION_FAILED", message, {
    ...(fieldErrors === undefined ? {} : { fieldErrors }),
    ...(cause === undefined ? {} : { cause }),
  });
}

function internalCreationError(cause: unknown): AppError {
  return new AppError(
    "INTERNAL_ERROR",
    "The appointment could not be created.",
    { cause },
  );
}

function normalizeManagerEmail(email: string, field: string): string {
  try {
    return normalizeEmail(email);
  } catch (cause) {
    throw validationError("Check the submitted fields.", {
      [field]: ["Must be one email address."],
    }, cause);
  }
}

function prepareCreation(
  input: CreateAppointmentCommandInput,
): PreparedCreation {
  const appointment = input.appointment;
  const ownerName = normalizeParticipantName(appointment.ownerDisplayName);

  if (input.ownerUserId.length === 0) {
    throw validationError("Check the submitted fields.", {
      ownerUserId: ["Owner user ID is required."],
    });
  }
  const detailErrors = appointmentDetailFieldErrors(appointment);
  if (Object.keys(detailErrors).length > 0) {
    throw validationError("Check the submitted fields.", detailErrors);
  }
  if (!isValidDisplayNameLength(ownerName.displayName)) {
    throw validationError("Check the submitted fields.", {
      ownerDisplayName: [
        "Display name must contain 1 to 80 normalized characters.",
      ],
    });
  }
  if (appointment.options.length === 0) {
    throw validationError("Check the submitted fields.", {
      options: ["Add at least one option."],
    });
  }
  if (appointment.options.length > appointment.optionLimit) {
    throw new AppError(
      "OPTION_LIMIT_REACHED",
      "Initial options exceed this appointment's option limit.",
    );
  }
  if (!isValidCoOrganizerCount(appointment.coOrganizerEmails.length)) {
    throw new AppError(
      "COORGANIZER_LIMIT_REACHED",
      `An appointment can have at most ${COORGANIZER_MAX_COUNT} co-organizers.`,
    );
  }

  const normalizedOwnerEmail = normalizeManagerEmail(
    input.ownerEmail,
    "ownerEmail",
  );
  const normalizedCoOrganizerEmails: string[] = [];
  const managerEmails = new Set([normalizedOwnerEmail]);

  for (let index = 0; index < appointment.coOrganizerEmails.length; index += 1) {
    const email = normalizeManagerEmail(
      appointment.coOrganizerEmails[index]!,
      `coOrganizerEmails.${index}`,
    );
    if (managerEmails.has(email)) {
      throw new AppError(
        "MANAGER_ALREADY_EXISTS",
        "That email already belongs to an appointment manager.",
      );
    }
    managerEmails.add(email);
    normalizedCoOrganizerEmails.push(email);
  }

  const options: OptionStorageValues[] = [];
  const canonicalKeys = new Set<string>();
  for (let index = 0; index < appointment.options.length; index += 1) {
    const option = appointment.options[index]!;
    if (option.kind !== appointment.type) {
      throw validationError("Check the submitted fields.", {
        [`options.${index}.kind`]: [
          "Option kind must match appointment type.",
        ],
      });
    }

    const validation = validateOptionInputForStorage(option);
    if (!validation.success) {
      const fieldErrors = Object.fromEntries(
        Object.entries(validation.fieldErrors).map(([field, messages]) => [
          `options.${index}.${field}`,
          messages,
        ]),
      );
      throw validationError("Check the submitted fields.", fieldErrors);
    }
    const values = validation.values;
    if (canonicalKeys.has(values.canonicalKey)) {
      throw new AppError(
        "DUPLICATE_OPTION",
        "Each option must be unique within the appointment.",
      );
    }
    canonicalKeys.add(values.canonicalKey);
    options.push(values);
  }

  return {
    normalizedOwnerEmail,
    normalizedCoOrganizerEmails,
    options,
  };
}

function validateCreationTimes(
  input: CreateAppointmentCommandInput,
  prepared: PreparedCreation,
  now: number,
): void {
  let creationTime;
  try {
    creationTime = optionCreationTime(input.appointment.timeZone, now);
  } catch (cause) {
    if (cause instanceof InvalidTimeZoneError) {
      throw validationError("Check the submitted fields.", {
        timeZone: ["Use a valid IANA time zone."],
      }, cause);
    }
    throw internalCreationError(cause);
  }

  for (let index = 0; index < prepared.options.length; index += 1) {
    let validation;
    try {
      validation = validateOptionStartForCreation(
        prepared.options[index]!,
        creationTime,
      );
    } catch (cause) {
      throw internalCreationError(cause);
    }
    if (!validation.success) {
      const fieldErrors = Object.fromEntries(
        Object.entries(validation.fieldErrors).map(([field, messages]) => [
          `options.${index}.${field}`,
          messages,
        ]),
      );
      throw validationError("Check the submitted fields.", fieldErrors);
    }
  }
}

function allocatePublicId(context: TransactionContext): string {
  for (
    let attempt = 0;
    attempt < PUBLIC_ID_ALLOCATION_ATTEMPTS;
    attempt += 1
  ) {
    let token: Buffer;
    try {
      token = context.tokenFactory();
    } catch (cause) {
      throw internalCreationError(cause);
    }
    if (!Buffer.isBuffer(token) || token.length !== PUBLIC_ID_TOKEN_BYTES) {
      throw internalCreationError(
        new RangeError("The token factory must return exactly 32 bytes."),
      );
    }
    const publicId = token.subarray(0, PUBLIC_ID_BYTES).toString("base64url");
    const collision = context.db
      .select({ id: appointments.id })
      .from(appointments)
      .where(eq(appointments.publicId, publicId))
      .get();
    if (!collision) return publicId;
  }

  throw internalCreationError(
    new Error("Could not allocate a unique appointment link."),
  );
}

function insertAppointmentGraph(
  context: TransactionContext,
  input: CreateAppointmentCommandInput,
  prepared: PreparedCreation,
  now: number,
): CreatedAppointment {
  const publicId = allocatePublicId(context);
  const appointment = context.db.insert(appointments).values({
    publicId,
    ownerUserId: input.ownerUserId,
    title: input.appointment.title,
    description: input.appointment.description,
    type: input.appointment.type,
    status: "ACTIVE",
    optionLimit: input.appointment.optionLimit,
    finalOptionId: null,
    revision: 1,
    createdAt: now,
    updatedAt: now,
  }).returning({ id: appointments.id }).get();

  const ownerParticipantId = insertOwnerManagerAndParticipant(context, {
    appointmentId: appointment.id,
    ownerUserId: input.ownerUserId,
    ownerEmail: prepared.normalizedOwnerEmail,
    ownerDisplayName: input.appointment.ownerDisplayName,
    now,
  });

  if (prepared.normalizedCoOrganizerEmails.length > 0) {
    context.db.insert(appointmentManagers).values(
      prepared.normalizedCoOrganizerEmails.map((emailNormalized) => ({
        appointmentId: appointment.id,
        emailNormalized,
        userId: null,
        role: "COORGANIZER" as const,
        createdAt: now,
      })),
    ).run();
  }

  for (const optionValues of prepared.options) {
    const option = context.db.insert(appointmentOptions).values({
      appointmentId: appointment.id,
      creatorParticipantId: ownerParticipantId,
      ...optionValues,
      createdAt: now,
    }).returning({ id: appointmentOptions.id }).get();

    context.db.insert(responses).values({
      appointmentId: appointment.id,
      participantId: ownerParticipantId,
      optionId: option.id,
      value: "YES",
      updatedAt: now,
    }).run();
  }

  return {
    appointmentId: appointment.id,
    publicId,
    revision: 1,
  };
}

export function createAppointment(
  context: ServiceContext,
  input: CreateAppointmentCommandInput,
): CreateAppointmentResult {
  const prepared = prepareCreation(input);
  let now: number;
  try {
    now = context.clock.now();
  } catch (cause) {
    throw internalCreationError(cause);
  }
  validateCreationTimes(input, prepared, now);

  let created: CreatedAppointment;
  try {
    created = runImmediate(
      context,
      (transaction) =>
        insertAppointmentGraph(transaction, input, prepared, now),
    );
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw internalCreationError(error);
  }

  publishAppointmentRevision(context, created.appointmentId, created.revision);
  return {
    publicId: created.publicId,
    revision: created.revision,
  };
}
