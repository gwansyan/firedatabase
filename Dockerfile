FROM node:22-bookworm-slim
WORKDIR /app
COPY package.json ./
COPY server.js ./
ENV PORT=8090
EXPOSE 8090
CMD ["node","server.js"]
