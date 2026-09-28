# whichlib MCP server over stdio. Used by directories (Glama) that build and
# introspect servers; `npx -y whichlib` remains the normal install.
FROM node:22-alpine
WORKDIR /app
COPY whichlib/package.json whichlib/package-lock.json ./
RUN npm ci --omit=dev
COPY whichlib/mcp ./mcp
COPY whichlib/lib ./lib
COPY whichlib/snapshot/src ./snapshot/src
COPY whichlib/server.json whichlib/LICENSE ./
# Automated directory checks should not count as installs; override with -e.
ENV WHICHLIB_TELEMETRY=off
ENTRYPOINT ["node", "mcp/server.mjs"]
