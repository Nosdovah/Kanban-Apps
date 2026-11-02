import { test, expect } from '@playwright/test';

const NO_SUCH_SPRINT = '00000000-0000-0000-0000-000000000000';

test.describe('REST API /api/sprints', () => {
  test('sprint lifecycle: create → list → detail → assign task → patch → delete', async ({ request }) => {
    // create
    const c = await request.post('/api/sprints', {
      data: { name: 'Sprint 1', goal: 'Rilis fitur X', start: '2026-11-02', due: '2026-11-09' },
    });
    expect(c.status()).toBe(201);
    const sprint = await c.json();
    expect(sprint.name).toBe('Sprint 1');
    expect(sprint.status).toBe('planned');

    // list contains it
    const list = await request.get('/api/sprints');
    const all = await list.json();
    expect(all.some((s: { id: string }) => s.id === sprint.id)).toBe(true);

    // assign a task to the sprint
    const tc = await request.post('/api/tasks', {
      data: { title: 'sprint-task', points: 5, sprintId: sprint.id },
    });
    expect(tc.status()).toBe(201);
    const task = await tc.json();
    expect(task.sprintId).toBe(sprint.id);

    // detail includes the task
    const detail = await request.get(`/api/sprints/${sprint.id}`);
    const det = await detail.json();
    expect(det.tasks.length).toBe(1);
    expect(det.tasks[0].title).toBe('sprint-task');

    // completing the task stamps completedAt (burndown data)
    await request.patch(`/api/tasks/${task.id}`, { data: { status: 'done' } });
    const done = await (await request.get(`/api/tasks/${task.id}`)).json();
    expect(done.completedAt).toBeTruthy();

    // patch sprint status
    const pc = await request.patch(`/api/sprints/${sprint.id}`, { data: { status: 'active' } });
    expect((await pc.json()).status).toBe('active');

    // cleanup
    await request.delete(`/api/tasks/${task.id}`);
    const del = await request.delete(`/api/sprints/${sprint.id}`);
    expect(del.status()).toBe(200);
    expect((await request.get(`/api/sprints/${sprint.id}`)).status()).toBe(404);
  });

  test('validation: empty name → 400', async ({ request }) => {
    const r = await request.post('/api/sprints', { data: { name: '   ' } });
    expect(r.status()).toBe(400);
  });

  test('assigning a task to an unknown sprint → 400', async ({ request }) => {
    const r = await request.post('/api/tasks', { data: { title: 'x', sprintId: NO_SUCH_SPRINT } });
    expect(r.status()).toBe(400);
  });

  test('deleting a sprint keeps its tasks (sprint_id cleared)', async ({ request }) => {
    const s = await (await request.post('/api/sprints', { data: { name: 'Sprint Delete' } })).json();
    const t = await (await request.post('/api/tasks', { data: { title: 'kept-task', sprintId: s.id } })).json();
    await request.delete(`/api/sprints/${s.id}`);
    const kept = await (await request.get(`/api/tasks/${t.id}`)).json();
    expect(kept.sprintId).toBe(null);
    await request.delete(`/api/tasks/${t.id}`);
  });
});