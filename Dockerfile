FROM node:22-slim
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --omit=dev --no-audit --no-fund
COPY src ./src
COPY public ./public
COPY tsconfig.json ./
ENV NODE_ENV=production
EXPOSE 3020
CMD ["npm", "start"]
