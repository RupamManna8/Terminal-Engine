# TerminalEngine Backend

Deployment and local run instructions.

Quick start (local):

```bash
cp .env.example .env
# edit .env as needed
npm install
npm run build
npm run start:prod
```

Docker (build and run):

```bash
docker build -t terminal-backend:latest .
docker run -p 5000:5000 --env-file .env terminal-backend:latest
```

Notes:
- The image sets `NODE_ENV=production` and runs the compiled `dist/index.js`.
- `prisma generate` runs during image build (or on `npm install` via `postinstall`).
- This repository no longer launches a local database in `docker-compose`; set `DATABASE_URL` in your `.env` to a cloud MongoDB connection string (MongoDB Atlas or equivalent).
