FROM node:22-alpine
WORKDIR /agent
COPY package.json ./
RUN npm install --omit=dev
COPY src ./src
USER node
EXPOSE 4001
CMD ["node","src/server.js"]
