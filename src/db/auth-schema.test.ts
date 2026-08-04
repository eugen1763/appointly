import {
  createTableRelationsHelpers,
  extractTablesRelationalConfig,
  getTableColumns,
  getTableName,
  normalizeRelation,
} from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/sqlite-core";
import { expect, it } from "vitest";

import * as authSchema from "./auth-schema";

const authTables = {
  user: authSchema.user,
  session: authSchema.session,
  account: authSchema.account,
  verification: authSchema.verification,
};

it("preserves the v1.6.25 auth table and column names", () => {
  expect(Object.fromEntries(
    Object.entries(authTables).map(([key, table]) => [
      getTableName(table),
      Object.fromEntries(Object.entries(getTableColumns(table)).map(([property, column]) => [property, column.name])),
    ]),
  )).toEqual({
    user: {
      id: "id",
      name: "name",
      email: "email",
      emailVerified: "email_verified",
      image: "image",
      createdAt: "created_at",
      updatedAt: "updated_at",
    },
    session: {
      id: "id",
      expiresAt: "expires_at",
      token: "token",
      createdAt: "created_at",
      updatedAt: "updated_at",
      ipAddress: "ip_address",
      userAgent: "user_agent",
      userId: "user_id",
    },
    account: {
      id: "id",
      accountId: "account_id",
      providerId: "provider_id",
      userId: "user_id",
      accessToken: "access_token",
      refreshToken: "refresh_token",
      idToken: "id_token",
      accessTokenExpiresAt: "access_token_expires_at",
      refreshTokenExpiresAt: "refresh_token_expires_at",
      scope: "scope",
      password: "password",
      createdAt: "created_at",
      updatedAt: "updated_at",
    },
    verification: {
      id: "id",
      identifier: "identifier",
      value: "value",
      expiresAt: "expires_at",
      createdAt: "created_at",
      updatedAt: "updated_at",
    },
  });
});

it("preserves v1.6.25 auth nullability, defaults, and update hooks", () => {
  const user = getTableColumns(authSchema.user);
  const session = getTableColumns(authSchema.session);
  const account = getTableColumns(authSchema.account);
  const verification = getTableColumns(authSchema.verification);
  const nullability = (columns: Record<string, { notNull: boolean }>) =>
    Object.fromEntries(Object.entries(columns).map(([name, column]) => [name, column.notNull]));

  expect([user.id, session.id, account.id, verification.id].map((column) => column.primary)).toEqual([
    true,
    true,
    true,
    true,
  ]);
  expect([user.email.isUnique, session.token.isUnique]).toEqual([true, true]);

  expect(nullability(user)).toEqual({
    id: true,
    name: true,
    email: true,
    emailVerified: true,
    image: false,
    createdAt: true,
    updatedAt: true,
  });
  expect(nullability(session)).toEqual({
    id: true,
    expiresAt: true,
    token: true,
    createdAt: true,
    updatedAt: true,
    ipAddress: false,
    userAgent: false,
    userId: true,
  });
  expect(nullability(account)).toEqual({
    id: true,
    accountId: true,
    providerId: true,
    userId: true,
    accessToken: false,
    refreshToken: false,
    idToken: false,
    accessTokenExpiresAt: false,
    refreshTokenExpiresAt: false,
    scope: false,
    password: false,
    createdAt: true,
    updatedAt: true,
  });
  expect(nullability(verification)).toEqual({
    id: true,
    identifier: true,
    value: true,
    expiresAt: true,
    createdAt: true,
    updatedAt: true,
  });

  expect([user.emailVerified, user.createdAt, user.updatedAt, session.createdAt, account.createdAt, verification.createdAt, verification.updatedAt].map((column) => column.hasDefault)).toEqual(Array(7).fill(true));
  expect([session.updatedAt, account.updatedAt].map((column) => column.hasDefault)).toEqual([true, true]);
  expect([session.updatedAt.default, account.updatedAt.default]).toEqual([undefined, undefined]);
  expect([user.updatedAt, session.updatedAt, account.updatedAt, verification.updatedAt].every((column) => typeof column.onUpdateFn === "function")).toBe(true);
});

it("preserves v1.6.25 auth foreign keys and indexes", () => {
  for (const table of [authSchema.session, authSchema.account]) {
    const config = getTableConfig(table);
    const reference = config.foreignKeys[0].reference();

    expect(config.foreignKeys).toHaveLength(1);
    expect(reference.columns.map((column) => column.name)).toEqual(["user_id"]);
    expect(getTableName(reference.foreignTable)).toBe("user");
    expect(reference.foreignColumns.map((column) => column.name)).toEqual(["id"]);
    expect(config.foreignKeys[0].onDelete).toBe("cascade");
  }

  expect(getTableConfig(authSchema.session).indexes.map((entry) => [entry.config.name, entry.config.columns])).toEqual([
    ["session_userId_idx", [getTableColumns(authSchema.session).userId]],
  ]);
  expect(getTableConfig(authSchema.account).indexes.map((entry) => [entry.config.name, entry.config.columns])).toEqual([
    ["account_userId_idx", [getTableColumns(authSchema.account).userId]],
  ]);
  expect(getTableConfig(authSchema.verification).indexes.map((entry) => [entry.config.name, entry.config.columns])).toEqual([
    ["verification_identifier_idx", [getTableColumns(authSchema.verification).identifier]],
  ]);
});

it("preserves v1.6.25 user, session, and account relations", () => {
  const relational = extractTablesRelationalConfig(authSchema, createTableRelationsHelpers);

  expect(Object.keys(relational.tables.user.relations)).toEqual(["sessions", "accounts"]);
  expect(Object.keys(relational.tables.session.relations)).toEqual(["user"]);
  expect(Object.keys(relational.tables.account.relations)).toEqual(["user"]);

  for (const tableName of ["session", "account"] as const) {
    const relation = normalizeRelation(
      relational.tables,
      relational.tableNamesMap,
      relational.tables[tableName].relations.user,
    );
    expect(relation.fields.map((column) => column.name)).toEqual(["user_id"]);
    expect(relation.references.map((column) => column.name)).toEqual(["id"]);
  }
});
