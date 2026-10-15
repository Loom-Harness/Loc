# syntax=docker/dockerfile:1
# Auto-generated.

FROM node:24-alpine AS build
WORKDIR /app
# Optional proxy CAs — drop *.crt files into ./certs/ to make npm
# trust them.  The directory always exists (with a .gitkeep), so
# this COPY is a no-op when no CAs are configured.
COPY certs/ /usr/local/share/ca-certificates/
RUN cat /usr/local/share/ca-certificates/*.crt 2>/dev/null >> /etc/ssl/cert.pem || true
ENV NODE_EXTRA_CA_CERTS=/etc/ssl/cert.pem NPM_CONFIG_CAFILE=/etc/ssl/cert.pem
COPY package.json ./
# Use plain "npm install" rather than "npm ci": the generator emits no
# package-lock.json so npm ci exits with EUSAGE.  --no-audit --no-fund
# keeps the build log clean and skips two registry round-trips.
RUN npm install --no-audit --no-fund
COPY . .
RUN npm run build

FROM node:24-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production PORT=3000
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/package.json ./package.json
# Drizzle's runtime migrator reads migration SQL + meta/_journal.json
# from disk; without these the process crashes on boot with
# "Can't find meta/_journal.json file".
COPY --from=build /app/db/migrations ./db/migrations
EXPOSE 3000
# --enable-source-maps: the runtime entry is the BUNDLE (dist/index.js), so
# without it every stack-trace frame names dist/index.js and `ddd trace`
# resolves none of them ("no frame matched the sourcemap").  With it, V8 reads
# the emitted dist/index.js.map and frames come back as the real `api/domain/
# <agg>.ts:<line>`, which is what the .loom/sourcemap.json keys are cut
# against.  The flag costs a one-off map parse on first throw.
CMD ["node", "--enable-source-maps", "dist/index.js"]
