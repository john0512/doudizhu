FROM node:22-alpine
WORKDIR /app
COPY package.json ./
COPY client ./client
COPY server ./server
ENV NODE_ENV=production
EXPOSE 8000
CMD ["node", "server/index.mjs"]
