import { Request, Response, NextFunction } from 'express';

interface RateLimitInfo {
  count: number;
  resetTime: number;
}

const rateLimitMap = new Map<string, RateLimitInfo>();

export const rateLimiter = (limit: number, windowMs: number) => {
  return (req: Request, res: Response, next: NextFunction) => {
    const ip = req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
    const now = Date.now();
    const limitInfo = rateLimitMap.get(ip);

    if (!limitInfo || now > limitInfo.resetTime) {
      rateLimitMap.set(ip, { count: 1, resetTime: now + windowMs });
      return next();
    }

    if (limitInfo.count >= limit) {
      res.status(429).json({ 
        ok: false, 
        message: 'Too many requests. Please try again later.' 
      });
      return;
    }

    limitInfo.count += 1;
    rateLimitMap.set(ip, limitInfo);
    next();
  };
};
