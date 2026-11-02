# Kanban Apps — Agile Progress Tracker

Aplikasi kanban full-stack untuk tracking progres agile. Frontend vanilla JS + backend REST API (Node.js/Express) + database PostgreSQL.

## Fitur

- **Form to-do list** — judul, deskripsi, assignee, prioritas, estimasi story point, tanggal mulai & tenggat, kolom status.
- **Board kanban** — drag & drop antar kolom (Backlog / To Do / In Progress / Review / Done).
- **Timeline tracking** — view Gantt-style per tanggal mulai → tenggat, garis "hari ini", highlight tugas overdue.
- **Statistik** — total, selesai, on progress, overdue, total & % poin selesai.
- Persistensi penuh di PostgreSQL melalui REST API (bukan localStorage).
- Export/import JSON, data contoh, filter (cari / assignee / prioritas).

## Arsitektur

```
frontend (public/index.html)
   │  fetch /api/*  (REST)
   ▼
Express API (server/index.js)
   │  pg (connection pool)
   ▼
PostgreSQL (table: tasks)
```

## Struktur proyek

```
Kanban-Apps/
├── server/
│   ├── index.js        # REST API + static serving
│   ├── db.js           # koneksi pool PostgreSQL
│   ├── schema.sql      # schema tabel (idempotent)
│   └── init-db.js      # jalankan schema
├── public/
│   └── index.html      # frontend (board + timeline)
├── docker-compose.yml  # postgres + api (sekali jalan)
├── Dockerfile
├── .env.example
└── package.json
```

## API Endpoint

| Method | Endpoint            | Deskripsi                          |
|--------|---------------------|------------------------------------|
| GET    | `/api/health`       | Cek koneksi API + DB               |
| GET    | `/api/tasks`        | List semua tugas (terbaru dulu)    |
| POST   | `/api/tasks`        | Buat satu tugas                    |
| POST   | `/api/tasks/bulk`   | Buat banyak tugas (array)          |
| GET    | `/api/tasks/:id`    | Ambil satu tugas                   |
| PUT    | `/api/tasks/:id`    | Update penuh                       |
| PATCH  | `/api/tasks/:id`    | Update parsial (mis. status saja)  |
| DELETE | `/api/tasks/:id`    | Hapus tugas                        |

### Bentuk data tugas

```json
{
  "id": "uuid",
  "title": "Halaman checkout baru",
  "description": "Integrasi payment gateway",
  "assignee": "Budi",
  "priority": "urgent",
  "status": "inprogress",
  "points": 8,
  "start": "2026-11-01",
  "due": "2026-11-04",
  "createdAt": "2026-11-01T10:00:00.000Z",
  "updatedAt": "2026-11-02T10:00:00.000Z"
}
```

- `priority`: `low | medium | high | urgent`
- `status`: `backlog | todo | inprogress | review | done`

## Menjalankan

### Cara 1 — Docker (paling mudah)

```bash
docker compose up --build
```

Buka http://localhost:3000 . API + database jalan otomatis (schema di-apply saat start).

### Cara 2 — Lokal (Node + PostgreSQL)

1. Siapkan database PostgreSQL, lalu buat user & database:

```sql
CREATE USER kanban WITH PASSWORD 'kanban';
CREATE DATABASE kanban OWNER kanban;
```

2. Install & jalankan:

```bash
cp .env.example .env      # sesuaikan DATABASE_URL
npm install
npm run db:init           # apply schema
npm start                 # http://localhost:3000
```

## Environment variables

| Variabel        | Default                                            | Keterangan                  |
|-----------------|----------------------------------------------------|-----------------------------|
| `DATABASE_URL`  | `postgres://kanban:kanban@localhost:5432/kanban`   | Koneksi PostgreSQL          |
| `PORT`          | `3000`                                             | Port API + frontend         |