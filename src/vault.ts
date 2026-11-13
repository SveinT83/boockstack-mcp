import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { z } from 'zod';
import { readPrivateFile } from './config.js';

const schema = z
  .object({
    activeKeyId: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/),
    keys: z.record(z.string(), z.string()),
  })
  .strict();
export class Vault {
  private keys = new Map<string, Buffer>();
  readonly activeKeyId: string;
  constructor(input: unknown) {
    const config = schema.parse(input);
    this.activeKeyId = config.activeKeyId;
    for (const [id, encoded] of Object.entries(config.keys)) {
      const key = Buffer.from(encoded, 'base64');
      if (key.length !== 32 || key.toString('base64') !== encoded)
        throw new Error('Hver AES-nøkkel skal være 32 bytes i kanonisk base64.');
      this.keys.set(id, key);
    }
    if (!this.keys.has(this.activeKeyId)) throw new Error('Aktiv krypteringsnøkkel mangler.');
  }
  static fromFile(path: string): Vault {
    return new Vault(JSON.parse(readPrivateFile(path)));
  }
  seal(value: unknown, context: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.keys.get(this.activeKeyId)!, iv);
    cipher.setAAD(Buffer.from(context));
    const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
    return JSON.stringify({
      v: 1,
      kid: this.activeKeyId,
      iv: iv.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'),
      data: encrypted.toString('base64'),
    });
  }
  open<T>(encoded: string, context: string): T {
    const envelope = JSON.parse(encoded);
    const key = this.keys.get(envelope.kid);
    if (envelope.v !== 1 || !key) throw new Error('Ukjent krypteringsformat eller nøkkel-ID.');
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.iv, 'base64'));
    decipher.setAAD(Buffer.from(context));
    decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
    return JSON.parse(
      Buffer.concat([
        decipher.update(Buffer.from(envelope.data, 'base64')),
        decipher.final(),
      ]).toString('utf8'),
    ) as T;
  }
}
