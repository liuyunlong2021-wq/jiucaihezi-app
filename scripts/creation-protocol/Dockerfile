# Supply an approved Node >= 22 image pinned by digest; no floating production default.
ARG NODE_IMAGE
FROM ${NODE_IMAGE}
WORKDIR /app
COPY shared/creation-schema.mjs /app/shared/creation-schema.mjs
COPY scripts/creation-protocol /app/scripts/creation-protocol
USER node
ENV JC_CREATION_BIND=0.0.0.0
CMD ["node", "scripts/creation-protocol/server.mjs"]
