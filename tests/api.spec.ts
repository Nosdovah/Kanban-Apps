import { test, expect } from '@playwright/test';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const NO_UUID = '00000000-0000-0000-0000-000000000000';

test.describe('REST API /api/tasks', () => {
  test('health check', async ({ request }) => {
    const r = await request.get('/api/health');
    expect(r.status()).toBe(200);
    expect((await r.json()).ok).toBe(true);
  });

  test('full lifecycle: create → list → get → patch → put → delete', async ({ request }) => {
    // create
    const c = await request.post('/api/tasks', {
      data: {
        title: 'LC-task',
        description: 'deskripsi',
        assignee: 'QA',
        priority: 'high',
        status: 'todo',
        points: 5,
        start: '2026-11-03',
        due: '2026-11-09',
      },
    });
    expect(c.status()).toBe(201);
    const created = await c.json();
    expect(created.id).toBeTruthy();
    expect(created.title).toBe('LC-task');
    expect(created.priority).toBe('high');
    expect(created.status).toBe('todo');
    // regression: DATE must stay YYYY-MM-DD (no timezone drift)
    expect(created.start).toMatch(DATE_RE);
    expect(created.due).toMatch(DATE_RE);

    // list contains it
    const list = await request.get('/api/tasks');
    const all = await list.json();
    expect(all.some((t: { id: string }) => t.id === created.id)).toBe(true);

    // get one
    const one = await request.get(`/api/tasks/${created.id}`);
    expect(one.status()).toBe(200);
    expect((await one.json()).title).toBe('LC-task');

    // patch status only (drag & drop path)
    const p = await request.patch(`/api/tasks/${created.id}`, { data: { status: 'done' } });
    expect((await p.json()).status).toBe('done');

    // put full replace
    const put = await request.put(`/api/tasks/${created.id}`, {
      data: { title: 'LC-task-updated', priority: 'low', status: 'inprogress' },
    });
    const putBody = await put.json();
    expect(putBody.title).toBe('LC-task-updated');
    expect(putBody.priority).toBe('low');
    expect(putBody.status).toBe('inprogress');

    // delete
    const del = await request.delete(`/api/tasks/${created.id}`);
    expect(del.status()).toBe(200);
    const gone = await request.get(`/api/tasks/${created.id}`);
    expect(gone.status()).toBe(404);
  });

  test('validation: empty/whitespace title → 400', async ({ request }) => {
    const r = await request.post('/api/tasks', { data: { title: '   ' } });
    expect(r.status()).toBe(400);
    expect((await r.json()).error).toContain('wajib');
  });

  test('invalid priority/status are normalized to defaults', async ({ request }) => {
    const r = await request.post('/api/tasks', { data: { title: 'norm-task', priority: 'gila', status: 'nope' } });
    expect(r.status()).toBe(201);
    const b = await r.json();
    expect(b.priority).toBe('medium');
    expect(b.status).toBe('todo');
    await request.delete(`/api/tasks/${b.id}`);
  });

  test('bulk create returns all created tasks', async ({ request }) => {
    const r = await request.post('/api/tasks/bulk', {
      data: [{ title: 'bulk-1' }, { title: 'bulk-2', priority: 'urgent' }],
    });
    expect(r.status()).toBe(201);
    const arr = await r.json();
    expect(arr.length).toBe(2);
    for (const t of arr as { id: string }[]) await request.delete(`/api/tasks/${t.id}`);
  });

  test('unknown id → 404', async ({ request }) => {
    const r = await request.get(`/api/tasks/${NO_UUID}`);
    expect(r.status()).toBe(404);
  });

  test('malformed uuid → 400', async ({ request }) => {
    const r = await request.get('/api/tasks/not-a-uuid');
    expect(r.status()).toBe(400);
  });
});