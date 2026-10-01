import { randomUUID } from "node:crypto";
import { ZodError } from "zod";

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export function requestId(value: string | string[] | undefined) {
  const candidate = Array.isArray(value) ? value[0] : value;
  return candidate && /^[A-Za-z0-9._:-]{8,128}$/.test(candidate) ? candidate : randomUUID();
}

export function publicError(error: unknown, id: string) {
  if (error instanceof HttpError) {
    return {
      status: error.status,
      body: { error: { code: error.code, message: error.message, requestId: id, ...(error.details === undefined ? {} : { details: error.details }) } },
    };
  }
  if (error instanceof ZodError) {
    return {
      status: 400,
      body: {
        error: {
          code: "validation_error",
          message: "O pedido contém campos inválidos.",
          requestId: id,
          details: error.issues.slice(0, 20).map((issue) => ({ path: issue.path.join("."), message: issue.message })),
        },
      },
    };
  }
  return {
    status: 500,
    body: { error: { code: "internal_error", message: "O serviço Outreach encontrou um erro inesperado.", requestId: id } },
  };
}
