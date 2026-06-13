# Task 3 — Project Management Tool

CodeAlpha Full Stack Internship · Task 3

A full-stack project management tool with Kanban board, task tracking, team collaboration, and comments.

## Features
- User registration & login (session-based auth)
- Create and manage projects
- Invite team members to projects
- Kanban board with To Do / In Progress / Done columns
- Create, assign, and update tasks
- Set due dates on tasks
- Task comments for team collaboration
- Member-based access control

## Tech Stack
- **Backend:** Node.js, Express.js
- **Database:** PostgreSQL
- **Auth:** bcryptjs + express-session + connect-pg-simple
- **Frontend:** Vanilla HTML/CSS/JavaScript

## Setup

### 1. Prerequisites
- Node.js 18+
- PostgreSQL database

### 2. Clone & install
```bash
git clone <your-repo-url>
cd task3-pm
npm install
```

### 3. Configure environment
```bash
cp .env.example .env
# Edit .env and set your DATABASE_URL and SESSION_SECRET
```

### 4. Set up database
```bash
psql $DATABASE_URL -f schema.sql
```

### 5. Run
```bash
npm start
# Server runs at http://localhost:3002
```

## API Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | /api/auth/register | — | Register a new user |
| POST | /api/auth/login | — | Login |
| POST | /api/auth/logout | ✓ | Logout |
| GET | /api/auth/me | ✓ | Get current user |
| GET | /api/projects | ✓ | My projects |
| POST | /api/projects | ✓ | Create project |
| GET | /api/projects/:id | ✓ | Project detail + members |
| POST | /api/projects/:id/members | ✓ | Add member |
| GET | /api/projects/:id/tasks | ✓ | List tasks |
| POST | /api/projects/:id/tasks | ✓ | Create task |
| PATCH | /api/tasks/:id | ✓ | Update task |
| DELETE | /api/tasks/:id | ✓ | Delete task |
| GET | /api/tasks/:id/comments | ✓ | Get comments |
| POST | /api/tasks/:id/comments | ✓ | Add comment |
