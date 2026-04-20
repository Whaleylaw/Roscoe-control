# Minimal reference agent image for Mission Control Phase 14.
# Exercises the full container contract without calling any external model provider.
FROM node:22-alpine

WORKDIR /app

# Install git (for step 5 commit inside /workspace)
RUN apk add --no-cache git

COPY agent.mjs /app/agent.mjs

# Default git identity for commits; can be overridden at runtime via env
ENV GIT_AUTHOR_NAME="mc-hello-world-agent"
ENV GIT_AUTHOR_EMAIL="runner@mission-control.local"
ENV GIT_COMMITTER_NAME="mc-hello-world-agent"
ENV GIT_COMMITTER_EMAIL="runner@mission-control.local"

ENTRYPOINT ["node","/app/agent.mjs"]
