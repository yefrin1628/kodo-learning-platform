# Ephemeral sandbox for student-submitted RUN exercise code. Built once,
# reused per-execution via `docker run --rm` (see execution.service.ts) —
# this image never talks to the network and carries nothing beyond the
# runner script itself.
FROM node:20-alpine

# Alpine already ships a non-root "node" user (uid 1000) — reuse it instead
# of adding a new one, one less thing to get wrong.
WORKDIR /app
COPY runner.js .
RUN chown -R node:node /app
USER node

ENTRYPOINT ["node", "runner.js"]
