import type { IncomingMessage, ServerResponse } from "node:http";
import type { Actor, Capability } from "./types.js";

export interface RouteContext {
  request: IncomingMessage;
  response: ServerResponse;
  url: URL;
  params: Record<string, string>;
  actor: Actor | null;
  requestId: string;
}

export type RouteHandler = (context: RouteContext) => Promise<void>;

export interface Route {
  method: string;
  path: string;
  pattern: RegExp;
  parameterNames: string[];
  capability: Capability | null;
  public: boolean;
  handler: RouteHandler;
}

function compile(path: string) {
  const parameterNames: string[] = [];
  const escaped = path.split("/").map((part) => {
    if (part.startsWith(":")) {
      parameterNames.push(part.slice(1));
      return "([^/]+)";
    }
    return part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }).join("/");
  return { pattern: new RegExp(`^${escaped}/?$`), parameterNames };
}

export class Router {
  readonly routes: Route[] = [];

  add(method: string, path: string, handler: RouteHandler, options: { capability?: Capability; public?: boolean } = {}) {
    const compiled = compile(path);
    this.routes.push({
      method: method.toUpperCase(),
      path,
      ...compiled,
      capability: options.capability ?? null,
      public: options.public ?? false,
      handler,
    });
    return this;
  }

  match(method: string, pathname: string) {
    for (const route of this.routes) {
      if (route.method !== method.toUpperCase()) continue;
      const match = route.pattern.exec(pathname);
      if (!match) continue;
      const params = Object.fromEntries(route.parameterNames.map((name, index) => [name, decodeURIComponent(match[index + 1] ?? "")]));
      return { route, params };
    }
    return null;
  }
}
