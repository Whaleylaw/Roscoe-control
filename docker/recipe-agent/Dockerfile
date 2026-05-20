FROM node:22-alpine

WORKDIR /app

RUN apk add --no-cache bash coreutils git ripgrep

COPY agent.mjs /app/agent.mjs

ENV GIT_AUTHOR_NAME="mc-recipe-agent"
ENV GIT_AUTHOR_EMAIL="runner@mission-control.local"
ENV GIT_COMMITTER_NAME="mc-recipe-agent"
ENV GIT_COMMITTER_EMAIL="runner@mission-control.local"

ENTRYPOINT ["node","/app/agent.mjs"]
