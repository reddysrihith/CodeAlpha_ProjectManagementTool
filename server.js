require('dotenv').config();
const express = require('express');
const session = require('express-session');
const connectPgSimple = require('connect-pg-simple');
const bcrypt = require('bcryptjs');
const cors = require('cors');
const { Pool } = require('pg');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3002;

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const PgSession = connectPgSimple(session);

app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(session({
  store: new PgSession({ pool, createTableIfMissing: true }),
  secret: process.env.SESSION_SECRET || 'pm-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 7 * 24 * 60 * 60 * 1000, httpOnly: true, sameSite: 'lax' },
}));

app.use(express.static(path.join(__dirname, 'public')));

function requireAuth(req, res, next) {
  if (!req.session.userId) { res.status(401).json({ error: 'Not authenticated' }); return; }
  next();
}

async function isMember(projectId, userId) {
  const { rows } = await pool.query(
    'SELECT id FROM project_members WHERE project_id=$1 AND user_id=$2', [projectId, userId]
  );
  return rows.length > 0;
}

// ── Auth ──────────────────────────────────────────────────────────────────────
app.post('/api/auth/register', async (req, res) => {
  const { username, email, password } = req.body;
  if (!username || !email || !password) { res.status(400).json({ error: 'username, email, and password are required' }); return; }
  const existing = await pool.query('SELECT id FROM users WHERE email=$1', [email]);
  if (existing.rows.length) { res.status(409).json({ error: 'Email already registered' }); return; }
  const hash = await bcrypt.hash(password, 10);
  const { rows: [user] } = await pool.query(
    'INSERT INTO users (username, email, password_hash) VALUES ($1,$2,$3) RETURNING id, username, email',
    [username, email, hash]
  );
  req.session.userId = user.id;
  req.session.username = user.username;
  req.session.save((err) => {
    if (err) { res.status(500).json({ error: 'Session error' }); return; }
    res.status(201).json({ id: user.id, username: user.username, email: user.email });
  });
});

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) { res.status(400).json({ error: 'email and password are required' }); return; }
  const { rows: [user] } = await pool.query('SELECT * FROM users WHERE email=$1', [email]);
  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    res.status(401).json({ error: 'Invalid email or password' }); return;
  }
  req.session.userId = user.id;
  req.session.username = user.username;
  req.session.save((err) => {
    if (err) { res.status(500).json({ error: 'Session error' }); return; }
    res.json({ id: user.id, username: user.username, email: user.email });
  });
});

app.post('/api/auth/logout', (req, res) => {
  req.session.destroy(() => res.json({ message: 'Logged out' }));
});

app.get('/api/auth/me', (req, res) => {
  if (!req.session.userId) { res.status(401).json({ error: 'Not authenticated' }); return; }
  res.json({ id: req.session.userId, username: req.session.username });
});

// ── Projects ──────────────────────────────────────────────────────────────────
app.get('/api/projects', requireAuth, async (req, res) => {
  const { rows: memberships } = await pool.query(
    'SELECT project_id FROM project_members WHERE user_id=$1', [req.session.userId]
  );
  if (!memberships.length) { res.json([]); return; }
  const ids = memberships.map(m => m.project_id);
  const placeholders = ids.map((_, i) => `$${i + 1}`).join(',');
  const { rows } = await pool.query(
    `SELECT p.id, p.name, p.description, p.created_at,
       json_build_object('id',u.id,'username',u.username) AS owner
     FROM projects p JOIN users u ON u.id=p.owner_id
     WHERE p.id IN (${placeholders}) ORDER BY p.created_at DESC`,
    ids
  );
  res.json(rows);
});

app.post('/api/projects', requireAuth, async (req, res) => {
  const { name, description } = req.body;
  if (!name) { res.status(400).json({ error: 'name is required' }); return; }
  const { rows: [project] } = await pool.query(
    'INSERT INTO projects (name, description, owner_id) VALUES ($1,$2,$3) RETURNING *',
    [name, description || '', req.session.userId]
  );
  await pool.query(
    'INSERT INTO project_members (project_id, user_id, role) VALUES ($1,$2,$3)',
    [project.id, req.session.userId, 'owner']
  );
  res.status(201).json(project);
});

app.get('/api/projects/:id', requireAuth, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: 'Invalid id' }); return; }
  if (!(await isMember(id, req.session.userId))) { res.status(403).json({ error: 'Not a member' }); return; }
  const { rows: [project] } = await pool.query(
    `SELECT p.id, p.name, p.description, p.created_at,
       json_build_object('id',u.id,'username',u.username) AS owner
     FROM projects p JOIN users u ON u.id=p.owner_id WHERE p.id=$1`,
    [id]
  );
  if (!project) { res.status(404).json({ error: 'Project not found' }); return; }
  const { rows: members } = await pool.query(
    `SELECT pm.id, pm.role, json_build_object('id',u.id,'username',u.username) AS user
     FROM project_members pm JOIN users u ON u.id=pm.user_id WHERE pm.project_id=$1`,
    [id]
  );
  res.json({ ...project, members });
});

app.post('/api/projects/:id/members', requireAuth, async (req, res) => {
  const projectId = parseInt(req.params.id, 10);
  if (isNaN(projectId)) { res.status(400).json({ error: 'Invalid id' }); return; }
  const { rows: [project] } = await pool.query('SELECT owner_id FROM projects WHERE id=$1', [projectId]);
  if (!project) { res.status(404).json({ error: 'Project not found' }); return; }
  if (project.owner_id !== req.session.userId) { res.status(403).json({ error: 'Only owner can add members' }); return; }
  const { username } = req.body;
  if (!username) { res.status(400).json({ error: 'username is required' }); return; }
  const { rows: [newUser] } = await pool.query('SELECT id FROM users WHERE username=$1', [username]);
  if (!newUser) { res.status(404).json({ error: 'User not found' }); return; }
  const { rows: [existing] } = await pool.query(
    'SELECT id FROM project_members WHERE project_id=$1 AND user_id=$2', [projectId, newUser.id]
  );
  if (existing) { res.status(409).json({ error: 'User is already a member' }); return; }
  const { rows: [member] } = await pool.query(
    'INSERT INTO project_members (project_id, user_id, role) VALUES ($1,$2,$3) RETURNING *',
    [projectId, newUser.id, 'member']
  );
  res.status(201).json(member);
});

// ── Tasks ─────────────────────────────────────────────────────────────────────
app.get('/api/projects/:id/tasks', requireAuth, async (req, res) => {
  const projectId = parseInt(req.params.id, 10);
  if (isNaN(projectId)) { res.status(400).json({ error: 'Invalid id' }); return; }
  if (!(await isMember(projectId, req.session.userId))) { res.status(403).json({ error: 'Not a member' }); return; }
  const { rows } = await pool.query(
    `SELECT t.id, t.title, t.description, t.status, t.due_date, t.created_at,
       CASE WHEN t.assignee_id IS NOT NULL THEN json_build_object('id',u.id,'username',u.username) ELSE NULL END AS assignee
     FROM tasks t LEFT JOIN users u ON u.id=t.assignee_id
     WHERE t.project_id=$1 ORDER BY t.created_at`,
    [projectId]
  );
  res.json(rows);
});

app.post('/api/projects/:id/tasks', requireAuth, async (req, res) => {
  const projectId = parseInt(req.params.id, 10);
  if (isNaN(projectId)) { res.status(400).json({ error: 'Invalid id' }); return; }
  if (!(await isMember(projectId, req.session.userId))) { res.status(403).json({ error: 'Not a member' }); return; }
  const { title, description, status, assigneeId, dueDate } = req.body;
  if (!title) { res.status(400).json({ error: 'title is required' }); return; }
  const { rows: [task] } = await pool.query(
    'INSERT INTO tasks (project_id, title, description, status, assignee_id, due_date) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
    [projectId, title, description || '', status || 'todo', assigneeId || null, dueDate || null]
  );
  res.status(201).json(task);
});

app.patch('/api/tasks/:id', requireAuth, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: 'Invalid id' }); return; }
  const { rows: [task] } = await pool.query('SELECT * FROM tasks WHERE id=$1', [id]);
  if (!task) { res.status(404).json({ error: 'Task not found' }); return; }
  if (!(await isMember(task.project_id, req.session.userId))) { res.status(403).json({ error: 'Not a member' }); return; }
  const { title, description, status, assigneeId, dueDate } = req.body;
  const updates = [];
  const values = [];
  let idx = 1;
  if (title !== undefined) { updates.push(`title=$${idx++}`); values.push(title); }
  if (description !== undefined) { updates.push(`description=$${idx++}`); values.push(description); }
  if (status !== undefined) { updates.push(`status=$${idx++}`); values.push(status); }
  if (assigneeId !== undefined) { updates.push(`assignee_id=$${idx++}`); values.push(assigneeId); }
  if (dueDate !== undefined) { updates.push(`due_date=$${idx++}`); values.push(dueDate); }
  if (!updates.length) { res.json(task); return; }
  values.push(id);
  const { rows: [updated] } = await pool.query(
    `UPDATE tasks SET ${updates.join(',')} WHERE id=$${idx} RETURNING *`, values
  );
  res.json(updated);
});

app.delete('/api/tasks/:id', requireAuth, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: 'Invalid id' }); return; }
  const { rows: [task] } = await pool.query('SELECT project_id FROM tasks WHERE id=$1', [id]);
  if (!task) { res.status(404).json({ error: 'Task not found' }); return; }
  if (!(await isMember(task.project_id, req.session.userId))) { res.status(403).json({ error: 'Not a member' }); return; }
  await pool.query('DELETE FROM tasks WHERE id=$1', [id]);
  res.sendStatus(204);
});

// ── Task Comments ─────────────────────────────────────────────────────────────
app.get('/api/tasks/:id/comments', requireAuth, async (req, res) => {
  const taskId = parseInt(req.params.id, 10);
  if (isNaN(taskId)) { res.status(400).json({ error: 'Invalid id' }); return; }
  const { rows: [task] } = await pool.query('SELECT project_id FROM tasks WHERE id=$1', [taskId]);
  if (!task) { res.status(404).json({ error: 'Task not found' }); return; }
  if (!(await isMember(task.project_id, req.session.userId))) { res.status(403).json({ error: 'Not a member' }); return; }
  const { rows } = await pool.query(
    `SELECT tc.id, tc.content, tc.created_at,
       json_build_object('id',u.id,'username',u.username) AS author
     FROM task_comments tc JOIN users u ON u.id=tc.user_id
     WHERE tc.task_id=$1 ORDER BY tc.created_at`,
    [taskId]
  );
  res.json(rows);
});

app.post('/api/tasks/:id/comments', requireAuth, async (req, res) => {
  const taskId = parseInt(req.params.id, 10);
  if (isNaN(taskId)) { res.status(400).json({ error: 'Invalid id' }); return; }
  const { rows: [task] } = await pool.query('SELECT project_id FROM tasks WHERE id=$1', [taskId]);
  if (!task) { res.status(404).json({ error: 'Task not found' }); return; }
  if (!(await isMember(task.project_id, req.session.userId))) { res.status(403).json({ error: 'Not a member' }); return; }
  const { content } = req.body;
  if (!content) { res.status(400).json({ error: 'content is required' }); return; }
  const { rows: [comment] } = await pool.query(
    'INSERT INTO task_comments (task_id, user_id, content) VALUES ($1,$2,$3) RETURNING *',
    [taskId, req.session.userId, content]
  );
  res.status(201).json(comment);
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => console.log(`Project management server running on http://localhost:${PORT}`));
