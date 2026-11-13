import { constants, closeSync, fstatSync, openSync, readFileSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { z } from 'zod';

export const READ_SCOPE = 'bookstack:read';
export const WRITE_SCOPE = 'bookstack:write';
export const configSchema = z
  .object({
    publicOrigin: z.string().url(),
    bookstackUrl: z.string().url().default('https://doc.tronderdata.no'),
    expectedBookstackVersion: z
      .string()
      .regex(/^v?\d+\.\d+\.\d+$/)
      .default('v26.09.2'),
    issuer: z.string().url(),
    webClientId: z.string().min(1),
    webClientSecretFile: z.string().min(1),
    keyringFile: z.string().min(1),
    databasePath: z.string().min(1),
    host: z.string().default('127.0.0.1'),
    port: z.number().int().min(1).max(65535).default(8110),
    allowInsecureLocalhost: z.boolean().default(false),
    allowedMcpOrigins: z.array(z.string().url()).default([]),
    trustedProxies: z.array(z.string().min(1)).default([]),
    upstreamTimeoutMs: z.number().int().min(100).max(60000).default(15000),
    maxResponseBytes: z
      .number()
      .int()
      .min(1024)
      .max(16 * 1024 * 1024)
      .default(4 * 1024 * 1024),
  })
  .strict();
export type Config = z.infer<typeof configSchema>;
export function assertSafeUrl(value: string, local: boolean): URL {
  const url = new URL(value);
  const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
  if (
    url.username ||
    url.password ||
    url.hash ||
    url.search ||
    (url.protocol !== 'https:' && !(local && loopback && url.protocol === 'http:'))
  ) {
    throw new Error(
      'Konfigurerte adresser krever HTTPS uten credentials, query eller fragment; HTTP tillates bare eksplisitt på loopback.',
    );
  }
  return url;
}
export function parseConfig(input: unknown): Config {
  const config = configSchema.parse(input);
  for (const name of ['publicOrigin', 'bookstackUrl', 'issuer'] as const) {
    const url = assertSafeUrl(config[name], config.allowInsecureLocalhost);
    if (name === 'publicOrigin' && url.pathname !== '/')
      throw new Error('publicOrigin skal være en origin uten understi.');
    if (url.pathname.endsWith('/') && url.pathname !== '/')
      throw new Error(`${name} skal ikke ha avsluttende skråstrek.`);
    config[name] = config[name].replace(/\/$/, '');
  }
  for (const origin of config.allowedMcpOrigins) {
    if (assertSafeUrl(origin, config.allowInsecureLocalhost).origin !== origin)
      throw new Error('MCP Origin skal være en eksakt origin.');
  }
  for (const name of ['keyringFile', 'webClientSecretFile', 'databasePath'] as const) {
    if (!isAbsolute(config[name])) throw new Error(`${name} må være en absolutt filsti.`);
  }
  if (new Set([config.keyringFile, config.webClientSecretFile, config.databasePath]).size !== 3)
    throw new Error('Database, keyring og klienthemmelighet skal være separate filer.');
  return config;
}
export function readPrivateFile(path: string): string {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const st = fstatSync(fd);
    if (!st.isFile() || (st.mode & 0o077) !== 0)
      throw new Error('Hemmelighetsfil må være en vanlig fil med modus 0600 eller 0400.');
    return readFileSync(fd, 'utf8').trim();
  } finally {
    closeSync(fd);
  }
}
export function loadConfig(): Config {
  const path = process.env.BOOKSTACK_MCP_CONFIG;
  if (!path) throw new Error('BOOKSTACK_MCP_CONFIG må peke til en JSON-konfigurasjon.');
  return parseConfig(JSON.parse(readFileSync(path, 'utf8')));
}
export const resource = (config: Config): string => `${config.publicOrigin}/mcp`;
