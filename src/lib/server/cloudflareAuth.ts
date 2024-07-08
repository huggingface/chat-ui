import { env } from "$env/dynamic/private";
import jsonwebtoken from 'jsonwebtoken';
import type { JwtPayload } from 'jsonwebtoken';

interface JWTPayload extends JwtPayload {
  sub: string;
  name?: string;
  email: string;
  picture?: string;
  aud: string | string[];
  iss: string;
  exp: number;
  iat: number;
  nbf: number;
  [key: string]: unknown;
}

export async function verifyCloudflareAccessJWT(token: string): Promise<JWTPayload> {
  return new Promise((resolve, reject) => {
    try {
      console.log('Starting JWT verification');
      
      const decoded = jsonwebtoken.decode(token) as JWTPayload | null;
      console.log('Decoded JWT:', JSON.stringify(decoded, null, 2));
      
      if (!decoded || typeof decoded !== 'object' || Array.isArray(decoded)) {
        console.log('Invalid token payload');
        throw new Error('Invalid token payload');
      }

      if (!decoded.sub || !decoded.email || !decoded.aud || !decoded.iss || !decoded.exp || !decoded.iat || !decoded.nbf) {
        console.log('Missing required fields:', decoded);
        throw new Error('Token missing required fields');
      }

      console.log('CF_ACCESS_AUD:', env.CF_ACCESS_AUD);
      console.log('CF_ACCESS_TEAM_DOMAIN:', env.CF_ACCESS_TEAM_DOMAIN);
      if (!env.CF_ACCESS_AUD || !env.CF_ACCESS_TEAM_DOMAIN) {
        console.log('Missing required environment variables');
        throw new Error('Missing required environment variables');
      }

      const audMatch = Array.isArray(decoded.aud) 
        ? decoded.aud.includes(env.CF_ACCESS_AUD)
        : decoded.aud === env.CF_ACCESS_AUD;
      if (!audMatch) {
        console.log('Invalid audience - received: ' + decoded.aud);
        throw new Error('Invalid audience');
      }

      if (decoded.iss !== env.CF_ACCESS_TEAM_DOMAIN) {
        console.log('Invalid issuer');
        throw new Error('Invalid issuer - received ' + decoded.iss);
      }

      const currentTime = Math.floor(Date.now() / 1000);
      if (decoded.exp <= currentTime) {
        console.log('Token has expired');
        throw new Error('Token has expired');
      }

      if (decoded.nbf > currentTime) {
        console.log('Token is not yet valid');
        throw new Error('Token is not yet valid');
      }

      // Use email as name if name is not provided
      const payload: JWTPayload = {
        ...decoded,
        name: decoded.name || decoded.email
      };

      console.log('JWT verification successful');
 
      resolve(payload);
    } catch (error) {
      console.error('JWT verification failed:', error);
      reject(error);
    }
  });
}