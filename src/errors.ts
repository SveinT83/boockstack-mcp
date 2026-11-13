export class AppError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 500,
    public upstreamStatus?: number,
  ) {
    super(message);
  }
}
export function publicError(error: unknown): AppError {
  return error instanceof AppError
    ? error
    : new AppError(
        'MCP_INTERNAL',
        'Intern feil i MCP-tjenesten. Kontakt drift med korrelasjons-ID.',
      );
}
export type Log = (record: Record<string, unknown>) => void;
export const logJson: Log = (record) =>
  process.stdout.write(JSON.stringify({ time: new Date().toISOString(), ...record }) + '\n');
