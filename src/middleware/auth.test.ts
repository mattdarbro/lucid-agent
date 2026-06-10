import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Request, Response } from 'express';

vi.mock('../config', () => ({
  config: {
    auth: { apiToken: '' },
  },
}));

vi.mock('../logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
  },
}));

import { requireApiToken } from './auth';
import { config } from '../config';

function mockReqRes(authHeader?: string) {
  const req = {
    headers: authHeader ? { authorization: authHeader } : {},
    method: 'GET',
    path: '/v1/test',
    ip: '127.0.0.1',
  } as unknown as Request;

  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as unknown as Response;

  const next = vi.fn();
  return { req, res, next };
}

describe('requireApiToken', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('allows requests through when no token is configured (migration mode)', () => {
    (config.auth as any).apiToken = '';
    const { req, res, next } = mockReqRes();

    requireApiToken(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('accepts a request with the correct Bearer token', () => {
    (config.auth as any).apiToken = 'secret-token';
    const { req, res, next } = mockReqRes('Bearer secret-token');

    requireApiToken(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('rejects a request with a wrong token', () => {
    (config.auth as any).apiToken = 'secret-token';
    const { req, res, next } = mockReqRes('Bearer wrong-token');

    requireApiToken(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('rejects a request with no Authorization header', () => {
    (config.auth as any).apiToken = 'secret-token';
    const { req, res, next } = mockReqRes();

    requireApiToken(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('rejects a token of different length without throwing', () => {
    (config.auth as any).apiToken = 'secret-token';
    const { req, res, next } = mockReqRes('Bearer short');

    requireApiToken(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });
});
