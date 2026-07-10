FROM node:20-bookworm-slim AS build

WORKDIR /app

COPY package.json ./
COPY apps/web/package.json ./apps/web/

RUN npm install --workspace=@jobportal/web --include-workspace-root

COPY apps/web ./apps/web

ARG VITE_API_URL=http://localhost:4000
ARG VITE_VNC_URL=http://localhost:6080/vnc.html?autoconnect=true&resize=scale
ENV VITE_API_URL=$VITE_API_URL
ENV VITE_VNC_URL=$VITE_VNC_URL

RUN npm run build -w @jobportal/web

FROM node:20-bookworm-slim

WORKDIR /app
RUN npm install -g serve

COPY --from=build /app/apps/web/dist ./dist

EXPOSE 3000
CMD ["serve", "-s", "dist", "-l", "3000"]
