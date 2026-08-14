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

Notes:
- This repository is docker-free. Run the compiled app directly with `npm run start:prod` after building.
- Set `DATABASE_URL` in your `.env` to a cloud MongoDB connection string (MongoDB Atlas or equivalent).
