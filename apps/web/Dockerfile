FROM node:22-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/web/package.json ./apps/web/package.json
RUN npm ci

COPY . .
RUN npm run build -w @gssync/web

FROM nginx:1.27-alpine
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/apps/web/dist /usr/share/nginx/html
EXPOSE 80
