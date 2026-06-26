/**
 * Admin tests (AU5–AU8)
 *
 * AU5  Super admin auto-seeded on startup
 * AU6  Admin user management API (list/add/change-password/delete)
 * AU7  /admin page exists and is accessible
 * AU8  Super admin can login and use agents normally
 *
 * Runs against a dedicated server (playwright.admin.config.js) with:
 *   AUTH_DISABLED not set (auth ON)
 *   ADMIN_USERNAME=18519038770
 *   ADMIN_PASSWORD=123456abC#
 */

import { test, expect } from '@playwright/test';

const ADMIN_USER = process.env.ADMIN_USERNAME ?? '18519038770';
const ADMIN_PASS = process.env.ADMIN_PASSWORD ?? '123456abC#';

async function adminLogin(baseURL) {
  const res = await fetch(`${baseURL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: ADMIN_USER, password: ADMIN_PASS }),
  });
  expect(res.status, 'admin login must succeed').toBe(200);
  const { token } = await res.json();
  return token;
}

// ── AU5: Super admin auto-seeded ──────────────────────────────────────────────
test('AU5-T1: super admin is auto-created on startup and can login', async ({ baseURL }) => {
  const res = await fetch(`${baseURL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: ADMIN_USER, password: ADMIN_PASS }),
  });
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body).toHaveProperty('token');
});

// ── AU6: Admin API ────────────────────────────────────────────────────────────
test('AU6-T1: GET /api/admin/users returns user list (admin only)', async ({ baseURL }) => {
  const token = await adminLogin(baseURL);
  const res = await fetch(`${baseURL}/api/admin/users`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(res.status).toBe(200);
  const { users } = await res.json();
  expect(Array.isArray(users)).toBe(true);
  // Super admin must be in the list
  expect(users.some(u => u.username === ADMIN_USER)).toBe(true);
});

test('AU6-T2: non-admin cannot access admin API (403)', async ({ baseURL }) => {
  // Register a normal user
  const regRes = await fetch(`${baseURL}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: `normal_${Date.now()}`, password: 'normalpass' }),
  });
  const { token } = await regRes.json();

  const res = await fetch(`${baseURL}/api/admin/users`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(res.status).toBe(403);
});

test('AU6-T3: admin can add user, change password, then delete user', async ({ baseURL }) => {
  const token = await adminLogin(baseURL);
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const newUser = `testuser_${Date.now()}`;

  // Add user
  const addRes = await fetch(`${baseURL}/api/admin/users`, {
    method: 'POST', headers,
    body: JSON.stringify({ username: newUser, password: 'initpass123' }),
  });
  expect(addRes.status).toBe(201);
  const { id } = await addRes.json();

  // Change password
  const pwRes = await fetch(`${baseURL}/api/admin/users/${id}/password`, {
    method: 'PATCH', headers,
    body: JSON.stringify({ password: 'newpass456' }),
  });
  expect(pwRes.status).toBe(200);

  // Verify new password works
  const loginRes = await fetch(`${baseURL}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: newUser, password: 'newpass456' }),
  });
  expect(loginRes.status).toBe(200);

  // Delete user
  const delRes = await fetch(`${baseURL}/api/admin/users/${id}`, {
    method: 'DELETE', headers,
  });
  expect(delRes.status).toBe(200);

  // Verify deleted user cannot login
  const loginAfterDelete = await fetch(`${baseURL}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: newUser, password: 'newpass456' }),
  });
  expect(loginAfterDelete.status).toBe(401);
});

test('AU6-T4: admin cannot delete themselves', async ({ baseURL }) => {
  const token = await adminLogin(baseURL);
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  // Get own user id
  const listRes = await fetch(`${baseURL}/api/admin/users`, { headers });
  const { users } = await listRes.json();
  const self = users.find(u => u.username === ADMIN_USER);

  const res = await fetch(`${baseURL}/api/admin/users/${self.id}`, {
    method: 'DELETE', headers,
  });
  expect(res.status).toBe(400);
});

// ── AU7: /admin page ──────────────────────────────────────────────────────────
test('AU7-smoke: GET /admin returns HTML page', async ({ baseURL }) => {
  const res = await fetch(`${baseURL}/admin`);
  expect(res.status).toBe(200);
  const html = await res.text();
  expect(html.toLowerCase()).toContain('<!doctype html');
  expect(html).toContain('admin');
});

// ── AU8: Super admin normal usage ─────────────────────────────────────────────
test('AU8-T1: super admin can create and list agents', async ({ baseURL }) => {
  const token = await adminLogin(baseURL);
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  const res = await fetch(`${baseURL}/api/agents`, {
    method: 'POST', headers,
    body: JSON.stringify({ name: 'AdminAgent', type: 'worker', adapterType: 'mock' }),
  });
  expect(res.status).toBe(201);

  const listRes = await fetch(`${baseURL}/api/agents`, { headers });
  expect(listRes.status).toBe(200);
  const agents = await listRes.json();
  expect(agents.some(a => a.name === 'AdminAgent')).toBe(true);
});

// ── AU9: Main UI login flow ───────────────────────────────────────────────────
// Verifies the main HTML page contains the login overlay element
test('AU9-T1: main page HTML contains login overlay for unauthenticated users', async ({ baseURL }) => {
  const res = await fetch(`${baseURL}/`);
  expect(res.status).toBe(200);
  const html = await res.text();
  // The page must include a login overlay so users can authenticate
  expect(html).toContain('login-overlay');
  expect(html).toContain('login-username');
  expect(html).toContain('login-password');
});
