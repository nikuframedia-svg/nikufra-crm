FROM node:22.14.0-bookworm-slim AS build
WORKDIR /app
COPY services/outreach/package.json services/outreach/package-lock.json ./
RUN npm ci --ignore-scripts
COPY services/outreach/tsconfig.json ./tsconfig.json
COPY services/outreach/src ./src
RUN npm run build && npm prune --omit=dev

FROM node:22.14.0-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN groupadd --system --gid 10001 outreach && useradd --system --uid 10001 --gid outreach --home-dir /nonexistent --shell /usr/sbin/nologin outreach
COPY --from=build --chown=outreach:outreach /app/package.json ./package.json
COPY --from=build --chown=outreach:outreach /app/node_modules ./node_modules
COPY --from=build --chown=outreach:outreach /app/dist ./dist
USER outreach
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.OUTREACH_HEALTH_PORT||'8787')+'/healthz').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]
CMD ["node", "dist/api.js"]
