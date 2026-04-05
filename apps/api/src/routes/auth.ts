import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AuthService, EmailAlreadyInUseError, InvalidCredentialsError } from '../services/auth-service.js';
import { UserRepository } from '../db/user-repository.js';
import { verifyAccessToken, signAccessToken } from '../auth/jwt.js';
import { GoogleOAuthService } from '../services/google-oauth-service.js';
import { OauthStateRepository } from '../db/oauth-state-repository.js';
import { OauthStateStore } from '../services/oauth-state-store.js';
import { GoogleTokenRepository } from '../db/google-token-repository.js';
import { encryptToken } from '../services/token-crypto.js';
import { toPublicUser } from '../models/user.js';

const authBodySchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(128)
});

const googleCallbackQuerySchema = z.object({
  code: z.string().min(1),
  state: z.string().min(1)
});

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

export async function authRoutes(app: FastifyInstance) {
  const userRepository = new UserRepository(app.sqlite);
  const authService = new AuthService(userRepository);
  const googleOAuthService = new GoogleOAuthService();
  const oauthStateStore = new OauthStateStore(new OauthStateRepository(app.sqlite));
  const googleTokenRepository = new GoogleTokenRepository(app.sqlite);

  app.post('/auth/register', async (request, reply) => {
    const parsedBody = authBodySchema.safeParse(request.body);

    if (!parsedBody.success) {
      return reply.code(400).send({
        error: 'Invalid request body'
      });
    }

    try {
      const result = await authService.register(parsedBody.data.email, parsedBody.data.password);
      return reply.code(201).send(result);
    } catch (error) {
      if (error instanceof EmailAlreadyInUseError) {
        return reply.code(409).send({
          error: 'Email already in use'
        });
      }

      request.log.error(error, 'register failed');
      return reply.code(500).send({
        error: 'Internal server error'
      });
    }
  });

  app.post('/auth/login', async (request, reply) => {
    const parsedBody = authBodySchema.safeParse(request.body);

    if (!parsedBody.success) {
      return reply.code(400).send({
        error: 'Invalid request body'
      });
    }

    try {
      const result = await authService.login(parsedBody.data.email, parsedBody.data.password);
      return reply.code(200).send(result);
    } catch (error) {
      if (error instanceof InvalidCredentialsError) {
        return reply.code(401).send({
          error: 'Invalid email or password'
        });
      }

      request.log.error(error, 'login failed');
      return reply.code(500).send({
        error: 'Internal server error'
      });
    }
  });

  app.get('/auth/google/start', async (_request, reply) => {
    const state = googleOAuthService.createState();
    await oauthStateStore.save(state);

    return reply.send({
      authorizationUrl: googleOAuthService.buildAuthorizationUrl(state),
      state
    });
  });

  app.get('/auth/google/callback', async (request, reply) => {
    const parsedQuery = googleCallbackQuerySchema.safeParse(request.query);

    if (!parsedQuery.success) {
      return reply.code(400).send({
        error: 'Missing code or state query parameters'
      });
    }

    const { code, state } = parsedQuery.data;

    const validState = await oauthStateStore.consume(state);

    if (!validState) {
      return reply.code(401).send({
        error: 'Invalid OAuth state'
      });
    }

    try {
      const token = await googleOAuthService.exchangeCodeForToken(code);
      const userInfo = await googleOAuthService.fetchUserInfo(token.access_token);
      const existingByGoogleSub = userRepository.findByGoogleSub(userInfo.sub);
      const existingByEmail = userRepository.findByEmail(userInfo.email.toLowerCase());

      const user =
        existingByGoogleSub ??
        (existingByEmail
          ? userRepository.linkGoogleAccount(existingByEmail.id, userInfo.sub)
          : userRepository.createGoogle(userInfo.email.toLowerCase(), userInfo.sub));

      const expiresAt = new Date(Date.now() + token.expires_in * 1000).toISOString();

      googleTokenRepository.upsert({
        userId: user.id,
        googleSub: userInfo.sub,
        encryptedAccessToken: encryptToken(token.access_token),
        encryptedRefreshToken: token.refresh_token ? encryptToken(token.refresh_token) : null,
        scope: token.scope,
        expiresAt
      });

      const accessToken = signAccessToken({
        sub: String(user.id),
        email: user.email
      });

      return reply.code(200).send({
        user: toPublicUser(user),
        accessToken,
        googleConnected: true
      });
    } catch (error) {
      request.log.error(error, 'google oauth callback failed');
      return reply.code(500).send({
        error: 'Internal server error'
      });
    }
  });

  app.get('/auth/me', async (request, reply) => {
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

      const user = userRepository.findById(userId);
      if (!user) {
        return reply.code(401).send({
          error: 'Invalid token'
        });
      }

      return reply.send({
        user: toPublicUser(user)
      });
    } catch (error) {
      request.log.warn(error, 'token verification failed');
      return reply.code(401).send({
        error: 'Invalid token'
      });
    }
  });
}
