import dotenv from 'dotenv';
dotenv.config();

export const config = {
  PORT: parseInt(process.env.PORT || '5000', 10),
  HOST: process.env.HOST || '0.0.0.0',
  DATABASE_URL: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/terminal_db?schema=public',
  ENCRYPTION_KEY: process.env.ENCRYPTION_KEY || 'default-super-secret-encryption-key-32b-length-must-be-longer',
  SESSION_SECRET: process.env.SESSION_SECRET || 'a-very-long-and-secure-secret-phrase-for-fastify-session-auth',
  GITHUB_CLIENT_ID: process.env.GITHUB_CLIENT_ID || '',
  GITHUB_CLIENT_SECRET: process.env.GITHUB_CLIENT_SECRET || '',
  GITHUB_CALLBACK_URL: process.env.GITHUB_CALLBACK_URL || 'http://localhost:5000/github/callback',
};
