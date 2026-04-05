import type { FastifyReply, FastifyRequest } from 'fastify';
import { verifyAccessToken } from './jwt.js';

export type AuthenticatedUser = {
  id: number;
  email: string;
};

function extractBearerToken(authHeader: string | undefined): string | null {
  if (!authHeader) {
    return null;
  }

  const [scheme, token] = authHeader.split(' ');
  if (scheme !== 'Bearer' || !token) {
    return null;
  }

  return token;
}

export async function requireAuth(request: FastifyRequest, reply: FastifyReply) {
  const token = extractBearerToken(request.headers.authorization);

  if (!token) {
    return reply.code(401).send({
      error: 'Missing or invalid authorization header'
    });
  }

  try {
    const payload = verifyAccessToken(token);
    const userId = Number(payload.sub);

    if (!Number.isInteger(userId)) {
      return reply.code(401).send({
        error: 'Invalid token'
      });
    }

    request.authUser = {
      id: userId,
      email: payload.email
    };
  } catch (error) {
    request.log.warn(error, 'token verification failed');
    return reply.code(401).send({
      error: 'Invalid token'
    });
  }
}
