const express      = require('express');
const multer       = require('multer');
const path         = require('path');
const fs           = require('fs');
const { DatabaseSync } = require('node:sqlite');
const bcrypt       = require('bcryptjs');
const jwt          = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const { randomBytes } = require('crypto');

const app  = express();
const PORT = process.env.PORT || 3000;

const dataDir    = path.join(__dirname, 'data');
const uploadsDir = path.join(__dirname, 'uploads');
[dataDir, uploadsDir].forEach(d => fs.mkdirSync(d, { recursive: true }));

// ── JWT Secret (persist across restarts) ─────────────────────────────────────
const secretPath = path.join(dataDir, '.jwt_secret');
let JWT_SECRET;
if (fs.existsSync(secretPath)) {
  JWT_SECRET = fs.readFileSync(secretPath, 'utf8').trim();
} else {
  JWT_SECRET = randomBytes(64).toString('hex');
  fs.writeFileSync(secretPath, JWT_SECRET, { mode: 0o600 });
}

// ── Database ─────────────────────────────────────────────────────────────────
const db = new DatabaseSync(path.join(dataDir, 'tracker.db'));
db.exec("PRAGMA journal_mode = WAL");
db.exec("PRAGMA foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT NOT NULL UNIQUE,
    email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    role          TEXT NOT NULL DEFAULT 'user',
    active        INTEGER NOT NULL DEFAULT 1,
    created_at    TEXT DEFAULT (datetime('now')),
    last_login    TEXT
  );

  CREATE TABLE IF NOT EXISTS applications (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id         INTEGER,
    company         TEXT NOT NULL,
    position        TEXT NOT NULL,
    location        TEXT,
    contract_type   TEXT DEFAULT 'CDI',
    remote          TEXT DEFAULT 'hybrid',
    source          TEXT,
    job_url         TEXT,
    job_description TEXT,
    salary_min      INTEGER,
    salary_max      INTEGER,
    status          TEXT DEFAULT 'applied',
    priority        TEXT DEFAULT 'medium',
    notes           TEXT,
    date_applied    TEXT NOT NULL DEFAULT (date('now')),
    created_at      TEXT DEFAULT (datetime('now')),
    updated_at      TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS events (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    application_id  INTEGER NOT NULL,
    type            TEXT NOT NULL,
    title           TEXT NOT NULL,
    description     TEXT,
    date            TEXT NOT NULL,
    created_at      TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (application_id) REFERENCES applications(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS contacts (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    application_id  INTEGER NOT NULL,
    name            TEXT NOT NULL,
    role            TEXT,
    email           TEXT,
    phone           TEXT,
    linkedin        TEXT,
    notes           TEXT,
    created_at      TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (application_id) REFERENCES applications(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS documents (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    application_id  INTEGER NOT NULL,
    name            TEXT NOT NULL,
    type            TEXT DEFAULT 'other',
    filename        TEXT NOT NULL,
    mime_type       TEXT,
    size            INTEGER,
    created_at      TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (application_id) REFERENCES applications(id) ON DELETE CASCADE
  );
`);

// Migration: add user_id column to legacy applications table
try { db.exec("ALTER TABLE applications ADD COLUMN user_id INTEGER"); } catch(_) {}

// ── Middleware ────────────────────────────────────────────────────────────────
app.set('trust proxy', 1);
app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// ── File upload ───────────────────────────────────────────────────────────────
const storage = multer.diskStorage({
  destination: (_, __, cb) => cb(null, uploadsDir),
  filename:    (_, file, cb) => cb(null, Date.now() + '-' + randomBytes(4).toString('hex') + path.extname(file.originalname))
});
const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (_, file, cb) => {
    const ok = ['.pdf','.doc','.docx','.txt','.png','.jpg','.jpeg','.odt'];
    cb(null, ok.includes(path.extname(file.originalname).toLowerCase()));
  }
});

// ── Auth Middleware ───────────────────────────────────────────────────────────
const loginAttempts = new Map();

function checkRateLimit(ip) {
  const now  = Date.now();
  const entry = loginAttempts.get(ip) || { count: 0, resetAt: now + 900000 };
  if (now > entry.resetAt) { entry.count = 0; entry.resetAt = now + 900000; }
  entry.count++;
  loginAttempts.set(ip, entry);
  return entry.count <= 5;
}

function requireAuth(req, res, next) {
  const token = req.cookies?.jt_token;
  if (!token) return res.status(401).json({ error: 'Non authentifié' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    // Verify user still exists and is active
    const u = db.prepare('SELECT id,active FROM users WHERE id=?').get(req.user.id);
    if (!u || !u.active) {
      res.clearCookie('jt_token');
      return res.status(401).json({ error: 'Compte désactivé' });
    }
    next();
  } catch {
    res.clearCookie('jt_token');
    res.status(401).json({ error: 'Session expirée' });
  }
}

function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Accès refusé' });
  next();
}

function setCookie(res, req, token) {
  const secure = req.secure || req.headers['x-forwarded-proto'] === 'https';
  res.cookie('jt_token', token, {
    httpOnly: true,
    sameSite: 'strict',
    maxAge: 7 * 24 * 60 * 60 * 1000,
    secure,
  });
}

function mintToken(user) {
  return jwt.sign(
    { id: user.id, username: user.username, email: user.email, role: user.role },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
}

// ── AUTH ROUTES ───────────────────────────────────────────────────────────────

app.get('/api/auth/me', requireAuth, (req, res) => {
  const u = db.prepare('SELECT id,username,email,role,created_at,last_login FROM users WHERE id=?').get(req.user.id);
  if (!u) return res.status(401).json({ error: 'Introuvable' });
  res.json(u);
});

app.post('/api/auth/register', (req, res) => {
  const { username, email, password } = req.body || {};
  if (!username?.trim() || !email?.trim() || !password) {
    return res.status(400).json({ error: 'Tous les champs sont requis' });
  }
  if (username.trim().length < 2 || username.trim().length > 32) {
    return res.status(400).json({ error: 'Nom d\'utilisateur : 2-32 caractères' });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
    return res.status(400).json({ error: 'Email invalide' });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: 'Mot de passe trop court (min. 8 caractères)' });
  }

  const existing = db.prepare('SELECT id FROM users WHERE email=? OR username=?').get(email.trim(), username.trim());
  if (existing) return res.status(409).json({ error: 'Email ou nom d\'utilisateur déjà utilisé' });

  const userCount = db.prepare('SELECT COUNT(*) c FROM users').get().c;
  const role = userCount === 0 ? 'admin' : 'user';

  const hash   = bcrypt.hashSync(password, 12);
  const result = db.prepare('INSERT INTO users (username,email,password_hash,role) VALUES (?,?,?,?)')
    .run(username.trim(), email.trim().toLowerCase(), hash, role);

  const user = db.prepare('SELECT id,username,email,role,created_at FROM users WHERE id=?').get(Number(result.lastInsertRowid));
  setCookie(res, req, mintToken(user));
  res.status(201).json(user);
});

app.post('/api/auth/login', (req, res) => {
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  if (!checkRateLimit(ip)) {
    return res.status(429).json({ error: 'Trop de tentatives. Réessayez dans 15 minutes.' });
  }
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Email et mot de passe requis' });

  const user = db.prepare('SELECT * FROM users WHERE email=?').get(email.trim().toLowerCase());
  if (!user || !user.active || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'Identifiants incorrects' });
  }

  db.prepare("UPDATE users SET last_login=datetime('now') WHERE id=?").run(user.id);
  setCookie(res, req, mintToken(user));
  res.json({ id: user.id, username: user.username, email: user.email, role: user.role });
});

app.post('/api/auth/logout', (req, res) => {
  res.clearCookie('jt_token');
  res.json({ ok: true });
});

app.post('/api/auth/change-password', requireAuth, (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!currentPassword || !newPassword) return res.status(400).json({ error: 'Champs manquants' });
  if (newPassword.length < 8) return res.status(400).json({ error: 'Nouveau mot de passe trop court (min. 8)' });
  const user = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
  if (!bcrypt.compareSync(currentPassword, user.password_hash)) {
    return res.status(401).json({ error: 'Mot de passe actuel incorrect' });
  }
  db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(bcrypt.hashSync(newPassword, 12), user.id);
  res.json({ ok: true });
});

// ── ADMIN ROUTES ──────────────────────────────────────────────────────────────

app.get('/api/admin/users', requireAuth, requireAdmin, (req, res) => {
  const users = db.prepare(`
    SELECT u.id, u.username, u.email, u.role, u.active, u.created_at, u.last_login,
           COUNT(a.id) app_count
    FROM users u LEFT JOIN applications a ON a.user_id = u.id
    GROUP BY u.id ORDER BY u.created_at DESC
  `).all();
  res.json(users);
});

app.put('/api/admin/users/:id', requireAuth, requireAdmin, (req, res) => {
  const uid = parseInt(req.params.id);
  const target = db.prepare('SELECT * FROM users WHERE id=?').get(uid);
  if (!target) return res.status(404).json({ error: 'Utilisateur introuvable' });
  if (uid === req.user.id && req.body.role && req.body.role !== 'admin') {
    return res.status(400).json({ error: 'Impossible de retirer votre propre rôle admin' });
  }
  const { role, active } = req.body;
  db.prepare('UPDATE users SET role=?, active=? WHERE id=?').run(
    role    !== undefined ? role   : target.role,
    active  !== undefined ? (active ? 1 : 0) : target.active,
    uid
  );
  res.json(db.prepare('SELECT id,username,email,role,active,created_at,last_login FROM users WHERE id=?').get(uid));
});

app.delete('/api/admin/users/:id', requireAuth, requireAdmin, (req, res) => {
  const uid = parseInt(req.params.id);
  if (uid === req.user.id) return res.status(400).json({ error: 'Impossible de supprimer votre propre compte' });
  const docs = db.prepare(`
    SELECT d.filename FROM documents d
    JOIN applications a ON d.application_id = a.id
    WHERE a.user_id = ?
  `).all(uid);
  docs.forEach(d => { try { fs.unlinkSync(path.join(uploadsDir, d.filename)); } catch(_){} });
  db.prepare('DELETE FROM users WHERE id=?').run(uid);
  res.json({ ok: true });
});

app.get('/api/admin/overview', requireAuth, requireAdmin, (req, res) => {
  const totalUsers  = db.prepare('SELECT COUNT(*) c FROM users').get().c;
  const activeUsers = db.prepare('SELECT COUNT(*) c FROM users WHERE active=1').get().c;
  const totalApps   = db.prepare('SELECT COUNT(*) c FROM applications').get().c;
  const byUser      = db.prepare(`
    SELECT u.username, u.email, u.role, COUNT(a.id) app_count, u.last_login
    FROM users u LEFT JOIN applications a ON a.user_id = u.id
    GROUP BY u.id ORDER BY app_count DESC
  `).all();
  res.json({ totalUsers, activeUsers, totalApps, byUser });
});

// ── APPLICATIONS ──────────────────────────────────────────────────────────────

app.get('/api/applications', requireAuth, (req, res) => {
  const { status, search, priority, source } = req.query;
  let q = `SELECT a.*,
    (SELECT d.id FROM documents d WHERE d.application_id=a.id AND d.type='cv' ORDER BY d.created_at DESC LIMIT 1) AS cv_doc_id
    FROM applications a WHERE a.user_id=?`;
  const p = [req.user.id];
  if (status && status !== 'all')   { q += ' AND status=?';   p.push(status); }
  if (priority && priority !== 'all') { q += ' AND priority=?'; p.push(priority); }
  if (source && source !== 'all')   { q += ' AND source=?';   p.push(source); }
  if (search) {
    q += ' AND (company LIKE ? OR position LIKE ? OR location LIKE ?)';
    const s = `%${search}%`; p.push(s, s, s);
  }
  q += ' ORDER BY date_applied DESC, created_at DESC';
  res.json(db.prepare(q).all(...p));
});

app.post('/api/applications', requireAuth, (req, res) => {
  const { company, position, location, contract_type, remote, source,
          job_url, job_description, salary_min, salary_max,
          status, priority, notes, date_applied } = req.body;

  const r = db.prepare(`
    INSERT INTO applications
      (user_id,company,position,location,contract_type,remote,source,job_url,job_description,
       salary_min,salary_max,status,priority,notes,date_applied)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(req.user.id, company, position, location, contract_type||'CDI', remote||'hybrid', source,
         job_url, job_description, salary_min||null, salary_max||null,
         status||'applied', priority||'medium', notes,
         date_applied || new Date().toISOString().split('T')[0]);

  const newId = Number(r.lastInsertRowid);
  db.prepare('INSERT INTO events (application_id,type,title,date) VALUES (?,?,?,?)')
    .run(newId, 'applied', 'Candidature envoyée',
         date_applied || new Date().toISOString().split('T')[0]);

  res.status(201).json(db.prepare('SELECT * FROM applications WHERE id=?').get(newId));
});

function ownApp(req, res) {
  const a = db.prepare('SELECT * FROM applications WHERE id=? AND user_id=?').get(req.params.id, req.user.id);
  if (!a) { res.status(404).json({ error: 'Introuvable' }); return null; }
  return a;
}

app.get('/api/applications/:id', requireAuth, (req, res) => {
  const a = ownApp(req, res); if (!a) return;
  a.events    = db.prepare('SELECT * FROM events WHERE application_id=? ORDER BY date ASC, created_at ASC').all(a.id);
  a.contacts  = db.prepare('SELECT * FROM contacts WHERE application_id=?').all(a.id);
  a.documents = db.prepare('SELECT * FROM documents WHERE application_id=?').all(a.id);
  res.json(a);
});

const STATUS_LABELS = {
  draft:'Brouillon', applied:'Candidature envoyée', seen:'CV consulté',
  screening:'Présélection', hr_interview:'Entretien RH', technical_test:'Test technique',
  interview_1:'1er entretien', interview_2:'2ème entretien', interview_3:'3ème entretien',
  offer:'Offre reçue', accepted:'Acceptée', rejected:'Refusée',
  withdrawn:'Retirée', ghosted:'Sans réponse'
};

app.put('/api/applications/:id', requireAuth, (req, res) => {
  const ex = ownApp(req, res); if (!ex) return;
  const { company, position, location, contract_type, remote, source,
          job_url, job_description, salary_min, salary_max,
          status, priority, notes, date_applied } = req.body;
  if (status && status !== ex.status) {
    db.prepare("INSERT INTO events (application_id,type,title,date) VALUES (?,?,?,date('now'))")
      .run(ex.id, status, STATUS_LABELS[status] || status);
  }
  db.prepare(`UPDATE applications SET
    company=?,position=?,location=?,contract_type=?,remote=?,source=?,
    job_url=?,job_description=?,salary_min=?,salary_max=?,
    status=?,priority=?,notes=?,date_applied=?,updated_at=datetime('now')
    WHERE id=?`).run(
    company??ex.company, position??ex.position, location??ex.location,
    contract_type??ex.contract_type, remote??ex.remote, source??ex.source,
    job_url??ex.job_url, job_description??ex.job_description,
    salary_min??ex.salary_min, salary_max??ex.salary_max,
    status??ex.status, priority??ex.priority, notes??ex.notes,
    date_applied??ex.date_applied, ex.id
  );
  res.json(db.prepare('SELECT * FROM applications WHERE id=?').get(ex.id));
});

app.delete('/api/applications/:id', requireAuth, (req, res) => {
  const ex = ownApp(req, res); if (!ex) return;
  db.prepare('SELECT filename FROM documents WHERE application_id=?').all(ex.id)
    .forEach(d => { try { fs.unlinkSync(path.join(uploadsDir, d.filename)); } catch(_){} });
  db.prepare('DELETE FROM applications WHERE id=?').run(ex.id);
  res.json({ ok: true });
});

// ── EVENTS ────────────────────────────────────────────────────────────────────

app.post('/api/applications/:id/events', requireAuth, (req, res) => {
  const ex = ownApp(req, res); if (!ex) return;
  const { type, title, description, date } = req.body;
  const r = db.prepare('INSERT INTO events (application_id,type,title,description,date) VALUES (?,?,?,?,?)')
    .run(ex.id, type, title, description, date);
  res.status(201).json(db.prepare('SELECT * FROM events WHERE id=?').get(Number(r.lastInsertRowid)));
});

app.delete('/api/events/:id', requireAuth, (req, res) => {
  const ev = db.prepare('SELECT e.*, a.user_id FROM events e JOIN applications a ON e.application_id=a.id WHERE e.id=?').get(req.params.id);
  if (!ev || ev.user_id !== req.user.id) return res.status(404).json({ error: 'Introuvable' });
  db.prepare('DELETE FROM events WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

// ── CONTACTS ──────────────────────────────────────────────────────────────────

app.post('/api/applications/:id/contacts', requireAuth, (req, res) => {
  const ex = ownApp(req, res); if (!ex) return;
  const { name, role, email, phone, linkedin, notes } = req.body;
  const r = db.prepare('INSERT INTO contacts (application_id,name,role,email,phone,linkedin,notes) VALUES (?,?,?,?,?,?,?)')
    .run(ex.id, name, role, email, phone, linkedin, notes);
  res.status(201).json(db.prepare('SELECT * FROM contacts WHERE id=?').get(Number(r.lastInsertRowid)));
});

app.put('/api/contacts/:id', requireAuth, (req, res) => {
  const ct = db.prepare('SELECT c.*, a.user_id FROM contacts c JOIN applications a ON c.application_id=a.id WHERE c.id=?').get(req.params.id);
  if (!ct || ct.user_id !== req.user.id) return res.status(404).json({ error: 'Introuvable' });
  const { name, role, email, phone, linkedin, notes } = req.body;
  db.prepare('UPDATE contacts SET name=?,role=?,email=?,phone=?,linkedin=?,notes=? WHERE id=?')
    .run(name, role, email, phone, linkedin, notes, req.params.id);
  res.json(db.prepare('SELECT * FROM contacts WHERE id=?').get(req.params.id));
});

app.delete('/api/contacts/:id', requireAuth, (req, res) => {
  const ct = db.prepare('SELECT c.*, a.user_id FROM contacts c JOIN applications a ON c.application_id=a.id WHERE c.id=?').get(req.params.id);
  if (!ct || ct.user_id !== req.user.id) return res.status(404).json({ error: 'Introuvable' });
  db.prepare('DELETE FROM contacts WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

// ── DOCUMENTS ─────────────────────────────────────────────────────────────────

app.post('/api/applications/:id/documents', requireAuth, upload.single('file'), (req, res) => {
  const ex = ownApp(req, res); if (!ex) return;
  if (!req.file) return res.status(400).json({ error: 'Aucun fichier' });
  const { name, type } = req.body;
  const r = db.prepare('INSERT INTO documents (application_id,name,type,filename,mime_type,size) VALUES (?,?,?,?,?,?)')
    .run(ex.id, name||req.file.originalname, type||'other', req.file.filename, req.file.mimetype, req.file.size);
  res.status(201).json(db.prepare('SELECT * FROM documents WHERE id=?').get(Number(r.lastInsertRowid)));
});

app.get('/api/documents/:id/view', requireAuth, (req, res) => {
  const doc = db.prepare('SELECT d.*, a.user_id FROM documents d JOIN applications a ON d.application_id=a.id WHERE d.id=?').get(req.params.id);
  if (!doc || doc.user_id !== req.user.id) return res.status(404).json({ error: 'Introuvable' });
  const fp = path.join(uploadsDir, doc.filename);
  if (!fs.existsSync(fp)) return res.status(404).json({ error: 'Fichier manquant' });
  res.setHeader('Content-Type', doc.mime_type || 'application/octet-stream');
  res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(doc.name)}"`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.sendFile(fp);
});

app.get('/api/documents/:id/download', requireAuth, (req, res) => {
  const doc = db.prepare('SELECT d.*, a.user_id FROM documents d JOIN applications a ON d.application_id=a.id WHERE d.id=?').get(req.params.id);
  if (!doc || doc.user_id !== req.user.id) return res.status(404).json({ error: 'Introuvable' });
  const fp = path.join(uploadsDir, doc.filename);
  if (!fs.existsSync(fp)) return res.status(404).json({ error: 'Fichier manquant' });
  res.download(fp, doc.name);
});

app.delete('/api/documents/:id', requireAuth, (req, res) => {
  const doc = db.prepare('SELECT d.*, a.user_id FROM documents d JOIN applications a ON d.application_id=a.id WHERE d.id=?').get(req.params.id);
  if (!doc || doc.user_id !== req.user.id) return res.status(404).json({ error: 'Introuvable' });
  try { fs.unlinkSync(path.join(uploadsDir, doc.filename)); } catch(_){}
  db.prepare('DELETE FROM documents WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

// ── STATS ─────────────────────────────────────────────────────────────────────

app.get('/api/stats', requireAuth, (req, res) => {
  const uid = req.user.id;
  const total      = db.prepare('SELECT COUNT(*) c FROM applications WHERE user_id=?').get(uid).c;
  const byStatus   = db.prepare('SELECT status, COUNT(*) c FROM applications WHERE user_id=? GROUP BY status').all(uid);
  const bySource   = db.prepare('SELECT source, COUNT(*) c FROM applications WHERE user_id=? AND source IS NOT NULL GROUP BY source ORDER BY c DESC LIMIT 8').all(uid);
  const thisWeek   = db.prepare("SELECT COUNT(*) c FROM applications WHERE user_id=? AND date_applied >= date('now','-7 days')").get(uid).c;
  const thisMonth  = db.prepare("SELECT COUNT(*) c FROM applications WHERE user_id=? AND date_applied >= date('now','start of month')").get(uid).c;
  const interviews = db.prepare("SELECT COUNT(*) c FROM applications WHERE user_id=? AND status IN ('hr_interview','technical_test','interview_1','interview_2','interview_3','offer','accepted')").get(uid).c;
  const offers     = db.prepare("SELECT COUNT(*) c FROM applications WHERE user_id=? AND status IN ('offer','accepted')").get(uid).c;
  const accepted   = db.prepare("SELECT COUNT(*) c FROM applications WHERE user_id=? AND status='accepted'").get(uid).c;
  const ghosted    = db.prepare("SELECT COUNT(*) c FROM applications WHERE user_id=? AND status IN ('applied','ghosted','draft')").get(uid).c;
  const recent     = db.prepare('SELECT * FROM applications WHERE user_id=? ORDER BY created_at DESC LIMIT 6').all(uid);
  const upcoming   = db.prepare("SELECT e.*,a.company,a.position FROM events e JOIN applications a ON e.application_id=a.id WHERE a.user_id=? AND e.date >= date('now') ORDER BY e.date ASC LIMIT 8").all(uid);
  const monthly    = db.prepare("SELECT strftime('%Y-%m',date_applied) m, COUNT(*) c FROM applications WHERE user_id=? AND date_applied >= date('now','-6 months') GROUP BY m ORDER BY m ASC").all(uid);
  const responses  = total - ghosted;
  res.json({
    total, byStatus, bySource, thisWeek, thisMonth,
    interviews, offers, accepted,
    responseRate:  total > 0 ? Math.round((responses / total) * 100) : 0,
    interviewRate: total > 0 ? Math.round((interviews / total) * 100) : 0,
    offerRate:     total > 0 ? Math.round((offers / total) * 100) : 0,
    recent, upcoming, monthly
  });
});

app.listen(PORT, '0.0.0.0', () => console.log(`✓ Job Tracker → http://0.0.0.0:${PORT}`));
