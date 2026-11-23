FROM node:22-slim
WORKDIR /app
COPY . .
ENV NODE_ENV=production PORT=3000 DATA_DIR=/data TRUST_PROXY=1
RUN mkdir -p /data && chown -R node:node /data /app
USER node
VOLUME /data
EXPOSE 3000
CMD ["node", "--disable-warning=ExperimentalWarning", "server.js"]
