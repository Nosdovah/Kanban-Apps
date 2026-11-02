import { test, expect } from '@playwright/test';

test.describe('Kanban board E2E', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#conn')).toHaveText('Terhubung ke API', { timeout: 10_000 });
  });

  test('lima kolom ditampilkan', async ({ page }) => {
    const cols = page.locator('.col-head strong');
    await expect(cols).toHaveCount(5);
    await expect(cols.nth(0)).toHaveText('Backlog');
    await expect(cols.nth(1)).toHaveText('To Do');
    await expect(cols.nth(2)).toHaveText('In Progress');
    await expect(cols.nth(3)).toHaveText('Review');
    await expect(cols.nth(4)).toHaveText('Done');
  });

  test('tambah tugas via form → masuk board & tersimpan di server', async ({ page, request }) => {
    await page.click('#btnAdd');
    await page.fill('#mTitle', 'E2E-tambah-tugas');
    await page.fill('#mAssignee', 'Tester');
    await page.selectOption('#mPriority', 'urgent');
    await page.fill('#mPoints', '8');
    await page.fill('#mStart', '2026-11-05');
    await page.fill('#mDue', '2026-11-12');
    await page.click('#btnSave');

    const card = page.locator('.card', { hasText: 'E2E-tambah-tugas' });
    await expect(card).toBeVisible();

    // persisted server-side (bukan localStorage)
    const list = await request.get('/api/tasks');
    const all = await list.json();
    const saved = all.find((t: { title: string }) => t.title === 'E2E-tambah-tugas');
    expect(saved).toBeTruthy();
    expect(saved.priority).toBe('urgent');
    expect(saved.points).toBe(8);
    expect(saved.start).toBe('2026-11-05');
    await request.delete(`/api/tasks/${saved.id}`);
  });

  test('edit tugas mengubah data di server', async ({ page, request }) => {
    const c = await request.post('/api/tasks', { data: { title: 'E2E-edit-sebelum', priority: 'low' } });
    const created = await c.json();

    await page.goto('/');
    await page.click(`.card[data-id="${created.id}"]`);
    await page.fill('#mTitle', 'E2E-edit-sesudah');
    await page.click('#btnSave');

    await expect(page.locator('.card', { hasText: 'E2E-edit-sesudah' })).toBeVisible();
    const after = await request.get(`/api/tasks/${created.id}`);
    expect((await after.json()).title).toBe('E2E-edit-sesudah');
    await request.delete(`/api/tasks/${created.id}`);
  });

  test('drag kartu ke kolom Done mengubah status (PATCH + render)', async ({ page, request }) => {
    const c = await request.post('/api/tasks', { data: { title: 'E2E-drag', status: 'todo' } });
    const created = await c.json();

    await page.goto('/');
    const card = page.locator('.card', { hasText: 'E2E-drag' });
    const doneCol = page.locator('.col-body[data-col="done"]');

    await card.dragTo(doneCol);
    await expect(doneCol.locator('.card', { hasText: 'E2E-drag' })).toBeVisible();

    const after = await request.get(`/api/tasks/${created.id}`);
    expect((await after.json()).status).toBe('done');
    await request.delete(`/api/tasks/${created.id}`);
  });

  test('timeline menampilkan bar untuk setiap tugas', async ({ page, request }) => {
    const c = await request.post('/api/tasks', {
      data: { title: 'E2E-timeline', start: '2026-11-01', due: '2026-11-06' },
    });
    const created = await c.json();

    await page.goto('/');
    await page.click('#viewTimeline');
    await expect(page.locator('.bar', { hasText: 'E2E-timeline' })).toBeVisible();
    await request.delete(`/api/tasks/${created.id}`);
  });
});