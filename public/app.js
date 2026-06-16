/* ── Constants ─────────────────────────────────────────────────────────── */
const STATUS = {
  draft:           { label: 'Brouillon',          cls: 'draft',           col: '#71717a' },
  applied:         { label: 'Candidature envoyée', cls: 'applied',         col: '#60a5fa' },
  seen:            { label: 'CV consulté',          cls: 'seen',            col: '#a78bfa' },
  screening:       { label: 'Présélection',         cls: 'screening',       col: '#c084fc' },
  hr_interview:    { label: 'Entretien RH',         cls: 'hr_interview',    col: '#fbbf24' },
  technical_test:  { label: 'Test technique',       cls: 'technical_test',  col: '#f59e0b' },
  interview_1:     { label: '1er entretien',        cls: 'interview_1',     col: '#fb923c' },
  interview_2:     { label: '2ème entretien',       cls: 'interview_2',     col: '#f97316' },
  interview_3:     { label: '3ème entretien',       cls: 'interview_3',     col: '#ea580c' },
  offer:           { label: 'Offre reçue',          cls: 'offer',           col: '#34d399' },
  accepted:        { label: 'Acceptée ✓',           cls: 'accepted',        col: '#10b981' },
  rejected:        { label: 'Refusée',              cls: 'rejected',        col: '#f87171' },
  withdrawn:       { label: 'Retirée',              cls: 'withdrawn',       col: '#9ca3af' },
  ghosted:         { label: 'Sans réponse',         cls: 'ghosted',         col: '#6b7280' },
};

const KANBAN_COLS = [
  { id: 'in_progress', label: 'En cours',   statuses: ['draft','applied','seen','screening'], color: '#60a5fa' },
  { id: 'process',     label: 'Processus',  statuses: ['hr_interview','technical_test'],      color: '#fbbf24' },
  { id: 'interviews',  label: 'Entretiens', statuses: ['interview_1','interview_2','interview_3'], color: '#fb923c' },
  { id: 'offer',       label: 'Offre',      statuses: ['offer','accepted'],                   color: '#34d399' },
  { id: 'closed',      label: 'Archivé',    statuses: ['rejected','withdrawn','ghosted'],     color: '#6b7280' },
];

const CONTRACT_TYPES = ['CDI','CDD','Freelance','Stage','Alternance','Intérim'];
const REMOTE_TYPES   = [['on_site','Présentiel'],['hybrid','Hybride'],['remote','100% Télétravail']];
const SOURCES        = ['LinkedIn','Indeed','Welcome to the Jungle','Glassdoor','Site entreprise','Cooptation','Apec','Autre'];
const PRIORITIES     = [['high','Haute'],['medium','Moyenne'],['low','Basse']];
const DOC_TYPES      = [['cv','CV'],['cover_letter','Lettre de motivation'],['portfolio','Portfolio'],['test','Test technique'],['other','Autre']];
const EVENT_TYPES    = [...Object.entries(STATUS).map(([k,v])=>[k,v.label]), ['note','Note'],['call','Appel'],['email','Email'],['task','Tâche']];

let currentUser   = null;
let pendingCvFile = null;
let cvBlobUrl     = null;

/* ── API Client ────────────────────────────────────────────────────────── */
const api = {
  async req(method, url, body) {
    const opts = { method, headers: { 'Content-Type': 'application/json' } };
    if (body) opts.body = JSON.stringify(body);
    const r = await fetch(url, opts);
    if (r.status === 401 && !url.includes('/api/auth/')) {
      currentUser = null;
      showAuthScreen();
      throw new Error('Session expirée');
    }
    if (!r.ok) {
      let msg;
      try { const j = await r.json(); msg = j.error || JSON.stringify(j); }
      catch(_) { msg = await r.text(); }
      throw new Error(msg);
    }
    return r.json();
  },
  get:    (url)       => api.req('GET',    url),
  post:   (url, data) => api.req('POST',   url, data),
  put:    (url, data) => api.req('PUT',    url, data),
  delete: (url)       => api.req('DELETE', url),
  async upload(url, formData) {
    const r = await fetch(url, { method: 'POST', body: formData });
    if (!r.ok) throw new Error(await r.text());
    return r.json();
  }
};

/* ── Toast ─────────────────────────────────────────────────────────────── */
function toast(msg, type = 'success') {
  const icons = {
    success: '<svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd"/></svg>',
    error:   '<svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clip-rule="evenodd"/></svg>',
    info:    '<svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clip-rule="evenodd"/></svg>',
  };
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `${icons[type] || icons.info} <span>${msg}</span>`;
  document.getElementById('toast-container').appendChild(el);
  setTimeout(() => { el.style.animation = 'fadeOut .3s ease forwards'; setTimeout(() => el.remove(), 300); }, 3000);
}

/* ── Modal ─────────────────────────────────────────────────────────────── */
function openModal(title, html) {
  document.getElementById('modal-title').textContent = title;
  document.getElementById('modal-body').innerHTML = html;
  document.getElementById('modal-overlay').classList.remove('hidden');
}
function closeModal(e) {
  if (e && e.target !== document.getElementById('modal-overlay')) return;
  document.getElementById('modal-overlay').classList.add('hidden');
  document.getElementById('modal-box').classList.remove('wide');
  if (cvBlobUrl) { URL.revokeObjectURL(cvBlobUrl); cvBlobUrl = null; }
}

/* ── Utils ─────────────────────────────────────────────────────────────── */
function fmt(date) {
  if (!date) return '—';
  const d = new Date(date + (date.length === 10 ? 'T00:00:00' : ''));
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
}
function fmtShort(date) {
  if (!date) return '—';
  const d = new Date(date + (date.length === 10 ? 'T00:00:00' : ''));
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' });
}
function initial(str) { return (str||'?').charAt(0).toUpperCase(); }
function statusBadge(s) {
  const cfg = STATUS[s] || { label: s, cls: 'draft' };
  return `<span class="badge badge-${cfg.cls}">${cfg.label}</span>`;
}
function priorityBadge(p) {
  const labels = { high: 'Haute', medium: 'Moyenne', low: 'Basse' };
  return `<span class="badge badge-priority-${p}">${labels[p]||p}</span>`;
}
function formatBytes(b) {
  if (!b) return '';
  if (b < 1024) return b + ' B';
  if (b < 1048576) return (b/1024).toFixed(0) + ' KB';
  return (b/1048576).toFixed(1) + ' MB';
}
function docIconClass(mime) {
  if (!mime) return 'other';
  if (mime.includes('pdf')) return 'pdf';
  if (mime.includes('word') || mime.includes('document')) return 'doc';
  return 'other';
}
function docIconSvg() {
  return `<svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4z" clip-rule="evenodd"/></svg>`;
}
function svgIcon(path) {
  return `<svg viewBox="0 0 20 20" fill="currentColor">${path}</svg>`;
}
const ICONS = {
  edit:     '<path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z"/>',
  trash:    '<path fill-rule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clip-rule="evenodd"/>',
  download: '<path fill-rule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm3.293-7.707a1 1 0 011.414 0L9 10.586V3a1 1 0 112 0v7.586l1.293-1.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z" clip-rule="evenodd"/>',
  plus:     '<path fill-rule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clip-rule="evenodd"/>',
  link:     '<path fill-rule="evenodd" d="M12.586 4.586a2 2 0 112.828 2.828l-3 3a2 2 0 01-2.828 0 1 1 0 00-1.414 1.414 4 4 0 005.656 0l3-3a4 4 0 00-5.656-5.656l-1.5 1.5a1 1 0 101.414 1.414l1.5-1.5zm-5 5a2 2 0 012.828 0 1 1 0 101.414-1.414 4 4 0 00-5.656 0l-3 3a4 4 0 105.656 5.656l1.5-1.5a1 1 0 10-1.414-1.414l-1.5 1.5a2 2 0 11-2.828-2.828l3-3z" clip-rule="evenodd"/>',
  back:     '<path fill-rule="evenodd" d="M9.707 16.707a1 1 0 01-1.414 0l-6-6a1 1 0 010-1.414l6-6a1 1 0 011.414 1.414L5.414 9H17a1 1 0 110 2H5.414l4.293 4.293a1 1 0 010 1.414z" clip-rule="evenodd"/>',
  chevron:  '<path fill-rule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clip-rule="evenodd"/>',
  search:   '<path fill-rule="evenodd" d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z" clip-rule="evenodd"/>',
};

/* ── Router ────────────────────────────────────────────────────────────── */
function navigate(hash) { window.location.hash = hash; }
function currentRoute() {
  const h = window.location.hash.replace('#', '') || '/';
  const parts = h.split('/').filter(Boolean);
  return { path: h, parts };
}

window.addEventListener('hashchange', render);
window.addEventListener('DOMContentLoaded', init);

async function render() {
  const { parts } = currentRoute();
  const page = parts[0] || '';

  // Update nav active state
  document.querySelectorAll('.nav-item').forEach(a => {
    const pg = a.dataset.page;
    const active = (pg === 'dashboard' && !page) ||
                   (pg === 'applications' && parts[0] === 'applications') ||
                   (pg === 'kanban' && parts[0] === 'kanban') ||
                   (pg === 'admin' && parts[0] === 'admin');
    a.classList.toggle('active', active);
  });

  const content = document.getElementById('page-content');
  content.innerHTML = '<div class="loading-center"><div class="spinner"></div> Chargement…</div>';

  try {
    if (!page || page === '') return await renderDashboard();
    if (page === 'applications' && !parts[1]) return await renderApplicationsList();
    if (page === 'applications' && parts[1] === 'new') return renderAppForm();
    if (page === 'applications' && parts[1] && parts[2] === 'edit') return await renderAppForm(parts[1]);
    if (page === 'applications' && parts[1]) return await renderApplicationDetail(parts[1]);
    if (page === 'kanban') return await renderKanban();
    if (page === 'admin')  return await renderAdminPanel();
  } catch(e) {
    content.innerHTML = `<div class="empty-state"><p>Erreur : ${e.message}</p></div>`;
  }
}

async function updateNavCount() {
  try {
    const apps = await api.get('/api/applications');
    const badge = document.getElementById('nav-count');
    if (badge) badge.textContent = apps.length;
  } catch(_) {}
}

/* ── Auth ───────────────────────────────────────────────────────────────── */
async function init() {
  try {
    currentUser = await api.get('/api/auth/me');
    document.getElementById('auth-screen').style.display = 'none';
    updateSidebarUser();
    render();
    updateNavCount();
  } catch(_) {
    showAuthScreen('login');
  }
}

function showAuthScreen(mode = 'login') {
  const el = document.getElementById('auth-screen');
  el.style.display = 'flex';
  el.innerHTML = `
    <div class="auth-box">
      <div class="auth-logo">
        <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
          <rect width="28" height="28" rx="8" fill="var(--accent)"/>
          <path d="M7 10h14M7 14h10M7 18h7" stroke="white" stroke-width="2" stroke-linecap="round"/>
        </svg>
        Job Tracker
      </div>
      <div id="auth-view"></div>
    </div>
  `;
  renderAuthView(mode);
}

function renderAuthView(mode) {
  const el = document.getElementById('auth-view');
  if (mode === 'login') {
    el.innerHTML = `
      <h2>Connexion</h2>
      <p class="auth-subtitle">Accédez à votre espace de suivi</p>
      <div class="auth-form">
        <div class="auth-error" id="auth-error"></div>
        <form onsubmit="handleLogin(event)">
          <div class="auth-field">
            <label>Email</label>
            <input type="email" id="auth-email" required placeholder="votre@email.com" autocomplete="email">
          </div>
          <div class="auth-field">
            <label>Mot de passe</label>
            <input type="password" id="auth-password" required placeholder="••••••••" autocomplete="current-password">
          </div>
          <button type="submit" class="auth-btn" id="auth-submit">Se connecter</button>
        </form>
      </div>
      <div class="auth-switch">
        Pas encore de compte ? <a onclick="renderAuthView('register')">Créer un compte</a>
      </div>
    `;
  } else {
    el.innerHTML = `
      <h2>Créer un compte</h2>
      <p class="auth-subtitle">Rejoignez Job Tracker</p>
      <div class="auth-form">
        <div class="auth-error" id="auth-error"></div>
        <form onsubmit="handleRegister(event)">
          <div class="auth-field">
            <label>Nom d'utilisateur</label>
            <input id="auth-username" required placeholder="johndoe" minlength="2" maxlength="32" autocomplete="username">
          </div>
          <div class="auth-field">
            <label>Email</label>
            <input type="email" id="auth-email" required placeholder="votre@email.com" autocomplete="email">
          </div>
          <div class="auth-field">
            <label>Mot de passe</label>
            <input type="password" id="auth-password" required placeholder="Min. 8 caractères" minlength="8" autocomplete="new-password">
          </div>
          <button type="submit" class="auth-btn" id="auth-submit">Créer le compte</button>
        </form>
      </div>
      <div class="auth-switch">
        Déjà un compte ? <a onclick="renderAuthView('login')">Se connecter</a>
      </div>
    `;
  }
}

function showAuthError(msg) {
  const el = document.getElementById('auth-error');
  if (el) { el.textContent = msg; el.classList.add('visible'); }
}

async function handleLogin(e) {
  e.preventDefault();
  const btn = document.getElementById('auth-submit');
  btn.disabled = true; btn.textContent = 'Connexion…';
  try {
    currentUser = await api.post('/api/auth/login', {
      email:    document.getElementById('auth-email').value,
      password: document.getElementById('auth-password').value,
    });
    document.getElementById('auth-screen').style.display = 'none';
    updateSidebarUser();
    render();
    updateNavCount();
    toast('Bienvenue ' + currentUser.username + ' !');
  } catch(err) {
    showAuthError(err.message);
    btn.disabled = false; btn.textContent = 'Se connecter';
  }
}

async function handleRegister(e) {
  e.preventDefault();
  const btn = document.getElementById('auth-submit');
  btn.disabled = true; btn.textContent = 'Création…';
  try {
    currentUser = await api.post('/api/auth/register', {
      username: document.getElementById('auth-username').value,
      email:    document.getElementById('auth-email').value,
      password: document.getElementById('auth-password').value,
    });
    document.getElementById('auth-screen').style.display = 'none';
    updateSidebarUser();
    render();
    updateNavCount();
    toast('Compte créé ! Bienvenue ' + currentUser.username + ' !');
  } catch(err) {
    showAuthError(err.message);
    btn.disabled = false; btn.textContent = 'Créer le compte';
  }
}

async function logout() {
  try { await api.post('/api/auth/logout', {}); } catch(_) {}
  currentUser = null;
  document.getElementById('sidebar-user').innerHTML = '';
  const adminNav = document.querySelector('.nav-admin');
  if (adminNav) adminNav.classList.add('hidden');
  showAuthScreen('login');
  toast('Déconnecté', 'info');
}

function updateSidebarUser() {
  const el = document.getElementById('sidebar-user');
  if (!el || !currentUser) return;
  el.innerHTML = `
    <div class="sidebar-user">
      <div class="sidebar-user-avatar">${currentUser.username.charAt(0).toUpperCase()}</div>
      <div class="sidebar-user-info">
        <div class="sidebar-user-name">${currentUser.username}</div>
        <div class="sidebar-user-role">${currentUser.role === 'admin' ? 'Administrateur' : 'Utilisateur'}</div>
      </div>
      <button class="sidebar-logout" onclick="logout()" title="Déconnexion">
        <svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M3 3a1 1 0 00-1 1v12a1 1 0 102 0V4a1 1 0 00-1-1zm10.293 9.293a1 1 0 001.414 1.414l3-3a1 1 0 000-1.414l-3-3a1 1 0 10-1.414 1.414L14.586 9H7a1 1 0 100 2h7.586l-1.293 1.293z" clip-rule="evenodd"/></svg>
      </button>
    </div>
  `;
  const adminNav = document.querySelector('.nav-admin');
  if (adminNav) adminNav.classList.toggle('hidden', currentUser.role !== 'admin');
}

/* ── Admin Panel ─────────────────────────────────────────────────────────── */
async function renderAdminPanel() {
  if (!currentUser || currentUser.role !== 'admin') { navigate('#/'); return; }
  const c = document.getElementById('page-content');
  c.innerHTML = '<div class="loading-center"><div class="spinner"></div></div>';

  const [overview, users] = await Promise.all([
    api.get('/api/admin/overview'),
    api.get('/api/admin/users'),
  ]);

  c.innerHTML = `
    <div class="page-header">
      <div>
        <h1>Administration</h1>
        <div class="subtitle">${overview.totalUsers} utilisateur${overview.totalUsers > 1 ? 's' : ''} · ${overview.totalApps} candidatures au total</div>
      </div>
    </div>
    <div class="stats-grid" style="grid-template-columns:repeat(2,1fr);margin-bottom:24px;">
      <div class="stat-card" style="--card-color:var(--accent)">
        <div class="stat-label">Utilisateurs</div>
        <div class="stat-value">${overview.totalUsers}</div>
        <div class="stat-sub">${overview.activeUsers} actifs</div>
      </div>
      <div class="stat-card" style="--card-color:var(--green)">
        <div class="stat-label">Candidatures totales</div>
        <div class="stat-value">${overview.totalApps}</div>
        <div class="stat-sub">sur toute la plateforme</div>
      </div>
    </div>
    <div class="card">
      <div class="card-header"><h3>Gestion des utilisateurs</h3></div>
      <table class="admin-table">
        <thead>
          <tr>
            <th>Utilisateur</th>
            <th>Rôle</th>
            <th>Statut</th>
            <th>Candidatures</th>
            <th>Dernière connexion</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          ${users.map(u => `
            <tr id="admin-user-${u.id}">
              <td>
                <div class="company-cell">
                  <div class="company-avatar">${initial(u.username)}</div>
                  <div>
                    <div class="company-name">${u.username}</div>
                    <div class="company-location">${u.email}</div>
                  </div>
                </div>
              </td>
              <td>
                <select style="padding:4px 8px;font-size:.78rem;" onchange="adminUpdateUser(${u.id},{role:this.value})" ${u.id === currentUser.id ? 'disabled' : ''}>
                  <option value="user"  ${u.role==='user' ?'selected':''}>Utilisateur</option>
                  <option value="admin" ${u.role==='admin'?'selected':''}>Admin</option>
                </select>
              </td>
              <td>
                <span class="${u.active ? 'status-active' : 'status-inactive'}">
                  ${u.active ? '● Actif' : '○ Inactif'}
                </span>
              </td>
              <td>${u.app_count}</td>
              <td class="td-date">${u.last_login ? fmt(u.last_login) : '—'}</td>
              <td>
                <div style="display:flex;gap:6px;">
                  ${u.id !== currentUser.id ? `
                    <button class="btn btn-ghost" style="font-size:.75rem;padding:4px 10px;" onclick="adminToggleActive(${u.id},${u.active})">
                      ${u.active ? 'Désactiver' : 'Activer'}
                    </button>
                    <button class="btn btn-danger" style="font-size:.75rem;padding:4px 10px;" onclick="adminDeleteUser(${u.id})">Supprimer</button>
                  ` : '<span class="text-muted text-sm" style="padding:4px;">Vous</span>'}
                </div>
              </td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>
  `;
}

async function adminUpdateUser(id, data) {
  try {
    await api.put(`/api/admin/users/${id}`, data);
    toast('Utilisateur mis à jour');
  } catch(err) { toast(err.message, 'error'); renderAdminPanel(); }
}

async function adminToggleActive(id, curActive) {
  try {
    await api.put(`/api/admin/users/${id}`, { active: !curActive });
    toast(curActive ? 'Utilisateur désactivé' : 'Utilisateur activé');
    renderAdminPanel();
  } catch(err) { toast(err.message, 'error'); }
}

async function adminDeleteUser(id) {
  if (!confirm('Supprimer cet utilisateur et toutes ses candidatures ? Cette action est irréversible.')) return;
  try {
    await api.delete(`/api/admin/users/${id}`);
    toast('Utilisateur supprimé');
    renderAdminPanel();
  } catch(err) { toast(err.message, 'error'); }
}

/* ── Dashboard ─────────────────────────────────────────────────────────── */
let monthlyChart = null;

async function renderDashboard() {
  const stats = await api.get('/api/stats');
  const c = document.getElementById('page-content');

  const byStatus = {};
  (stats.byStatus || []).forEach(r => { byStatus[r.status] = r.c; });

  const pipeline = [
    { label: 'Candidatures', count: stats.total, pct: 100 },
    { label: 'Réponses',     count: (stats.total - (byStatus.applied||0) - (byStatus.ghosted||0) - (byStatus.draft||0)), pct: stats.responseRate },
    { label: 'Entretiens',   count: stats.interviews,  pct: stats.interviewRate },
    { label: 'Offres',       count: stats.offers,      pct: stats.offerRate },
  ];

  c.innerHTML = `
    <div class="page-header">
      <div>
        <h1>Dashboard</h1>
        <div class="subtitle">Vue d'ensemble de tes candidatures</div>
      </div>
      <div class="page-header-actions">
        <button class="btn btn-primary" onclick="showAppForm()">
          ${svgIcon(ICONS.plus)} Nouvelle candidature
        </button>
      </div>
    </div>

    <div class="stats-grid">
      <div class="stat-card" style="--card-color:#60a5fa">
        <div class="stat-label">Total</div>
        <div class="stat-value">${stats.total}</div>
        <div class="stat-sub">${stats.thisWeek} cette semaine · ${stats.thisMonth} ce mois</div>
      </div>
      <div class="stat-card" style="--card-color:#fbbf24">
        <div class="stat-label">Taux de réponse</div>
        <div class="stat-value">${stats.responseRate}%</div>
        <div class="stat-sub">${stats.total - (byStatus.applied||0) - (byStatus.ghosted||0) - (byStatus.draft||0)} réponses reçues</div>
      </div>
      <div class="stat-card" style="--card-color:#fb923c">
        <div class="stat-label">Entretiens</div>
        <div class="stat-value">${stats.interviews}</div>
        <div class="stat-sub">${stats.interviewRate}% de conversion</div>
      </div>
      <div class="stat-card" style="--card-color:#34d399">
        <div class="stat-label">Offres reçues</div>
        <div class="stat-value">${stats.offers}</div>
        <div class="stat-sub">${stats.offerRate}% du total</div>
      </div>
    </div>

    <div class="dashboard-grid">
      <div style="display:flex;flex-direction:column;gap:16px;">
        <div class="card">
          <div class="card-header"><h3>Activité (6 derniers mois)</h3></div>
          <div class="card-body"><div class="chart-container"><canvas id="monthly-chart"></canvas></div></div>
        </div>
        <div class="card">
          <div class="card-header">
            <h3>Candidatures récentes</h3>
            <a href="#/applications" class="btn btn-ghost" style="font-size:.75rem;padding:4px 10px;">Tout voir</a>
          </div>
          <div class="card-body">
            ${stats.recent.length === 0
              ? '<p class="text-muted text-sm">Aucune candidature encore.</p>'
              : stats.recent.map(a => `
                <div class="recent-item" onclick="navigate('#/applications/${a.id}')">
                  <div class="company-avatar">${initial(a.company)}</div>
                  <div class="recent-info">
                    <div class="recent-company">${a.company}</div>
                    <div class="recent-pos">${a.position}</div>
                  </div>
                  ${statusBadge(a.status)}
                  <div class="recent-date">${fmtShort(a.date_applied)}</div>
                </div>`).join('')}
          </div>
        </div>
      </div>
      <div style="display:flex;flex-direction:column;gap:16px;">
        <div class="card">
          <div class="card-header"><h3>Entonnoir</h3></div>
          <div class="card-body">
            <div class="funnel">
              ${pipeline.map(r => `
                <div class="funnel-row">
                  <div class="funnel-label">${r.label}</div>
                  <div class="funnel-bar-wrap"><div class="funnel-bar" style="width:${r.pct}%"></div></div>
                  <div class="funnel-count">${r.count}</div>
                </div>`).join('')}
            </div>
          </div>
        </div>
        <div class="card">
          <div class="card-header"><h3>Par statut</h3></div>
          <div class="card-body">
            ${Object.entries(STATUS).map(([k,v]) => {
              const n = byStatus[k] || 0;
              if (n === 0) return '';
              return `
                <div class="funnel-row" style="margin-bottom:6px;">
                  <div class="funnel-label" style="font-size:.78rem;">${v.label}</div>
                  <div class="funnel-bar-wrap"><div class="funnel-bar" style="width:${stats.total>0?Math.round(n/stats.total*100):0}%;background:${v.col}"></div></div>
                  <div class="funnel-count">${n}</div>
                </div>`;
            }).join('')}
          </div>
        </div>
        ${stats.bySource.length > 0 ? `
        <div class="card">
          <div class="card-header"><h3>Sources</h3></div>
          <div class="card-body">
            <div class="source-list">
              ${stats.bySource.map(s => `
                <div class="source-row">
                  <div class="source-name">${s.source||'Inconnu'}</div>
                  <div class="source-bar-wrap"><div class="source-bar" style="width:${stats.total>0?Math.round(s.c/stats.total*100):0}%"></div></div>
                  <div class="source-count">${s.c}</div>
                </div>`).join('')}
            </div>
          </div>
        </div>` : ''}
        ${stats.upcoming.length > 0 ? `
        <div class="card">
          <div class="card-header"><h3>À venir</h3></div>
          <div class="card-body">
            ${stats.upcoming.map(e => `
              <div class="event-item" onclick="navigate('#/applications/${e.application_id}')" style="cursor:pointer;">
                <div class="event-date-box">${fmtShort(e.date)}</div>
                <div>
                  <div class="event-title">${e.title}</div>
                  <div class="event-company">${e.company} · ${e.position}</div>
                </div>
              </div>`).join('')}
          </div>
        </div>` : ''}
      </div>
    </div>
  `;

  // Chart
  const ctx = document.getElementById('monthly-chart');
  if (ctx && stats.monthly.length > 0) {
    if (monthlyChart) monthlyChart.destroy();
    monthlyChart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: stats.monthly.map(r => {
          const [y,m] = r.m.split('-');
          return new Date(y,m-1).toLocaleDateString('fr-FR',{month:'short',year:'2-digit'});
        }),
        datasets: [{
          label: 'Candidatures',
          data: stats.monthly.map(r => r.c),
          backgroundColor: 'rgba(129,140,248,.5)',
          borderColor: '#818cf8',
          borderWidth: 2,
          borderRadius: 6,
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { grid: { color: 'rgba(255,255,255,.05)' }, ticks: { color: '#71717a' } },
          y: { grid: { color: 'rgba(255,255,255,.05)' }, ticks: { color: '#71717a', stepSize: 1 }, beginAtZero: true }
        }
      }
    });
  }
}

/* ── Applications List ─────────────────────────────────────────────────── */
let listFilters = { search: '', status: 'all', priority: 'all', source: 'all' };

async function renderApplicationsList() {
  const c = document.getElementById('page-content');
  c.innerHTML = '<div class="loading-center"><div class="spinner"></div></div>';

  const params = new URLSearchParams();
  if (listFilters.search)   params.set('search',   listFilters.search);
  if (listFilters.status !== 'all')   params.set('status',   listFilters.status);
  if (listFilters.priority !== 'all') params.set('priority', listFilters.priority);
  if (listFilters.source !== 'all')   params.set('source',   listFilters.source);

  const apps = await api.get(`/api/applications?${params}`);

  c.innerHTML = `
    <div class="page-header">
      <div>
        <h1>Candidatures <span style="color:var(--text-3);font-weight:400;font-size:1rem;">(${apps.length})</span></h1>
      </div>
      <div class="page-header-actions">
        <button class="btn btn-primary" onclick="showAppForm()">
          ${svgIcon(ICONS.plus)} Nouvelle
        </button>
      </div>
    </div>
    <div class="filters-bar">
      <div class="search-box">
        ${svgIcon(ICONS.search)}
        <input type="text" id="search-input" placeholder="Rechercher…" value="${listFilters.search}" oninput="debounceSearch(this.value)">
      </div>
      <select class="filter-select" onchange="setFilter('status',this.value)">
        <option value="all">Tous les statuts</option>
        ${Object.entries(STATUS).map(([k,v])=>`<option value="${k}" ${listFilters.status===k?'selected':''}>${v.label}</option>`).join('')}
      </select>
      <select class="filter-select" onchange="setFilter('priority',this.value)">
        <option value="all">Toutes priorités</option>
        ${PRIORITIES.map(([k,v])=>`<option value="${k}" ${listFilters.priority===k?'selected':''}>${v}</option>`).join('')}
      </select>
      <select class="filter-select" onchange="setFilter('source',this.value)">
        <option value="all">Toutes sources</option>
        ${SOURCES.map(s=>`<option value="${s}" ${listFilters.source===s?'selected':''}>${s}</option>`).join('')}
      </select>
    </div>
    <div class="card">
      ${apps.length === 0
        ? `<div class="empty-state">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25z"/></svg>
            <h3>Aucune candidature</h3>
            <p>Commence par ajouter ta première candidature</p>
          </div>`
        : `<table class="app-table">
            <thead>
              <tr>
                <th>Entreprise</th>
                <th>Poste</th>
                <th>Statut</th>
                <th>Priorité</th>
                <th>Source</th>
                <th>Date</th>
                <th style="width:60px;text-align:center;">CV</th>
              </tr>
            </thead>
            <tbody>
              ${apps.map(a => `
                <tr onclick="navigate('#/applications/${a.id}')">
                  <td>
                    <div class="company-cell">
                      <div class="company-avatar">${initial(a.company)}</div>
                      <div>
                        <div class="company-name">${a.company}</div>
                        <div class="company-location">${a.location||'—'}</div>
                      </div>
                    </div>
                  </td>
                  <td class="td-pos">${a.position}</td>
                  <td>${statusBadge(a.status)}</td>
                  <td><span class="priority-dot ${a.priority}" title="${a.priority}"></span></td>
                  <td class="text-muted text-sm">${a.source||'—'}</td>
                  <td class="td-date">${fmt(a.date_applied)}</td>
                  <td style="text-align:center;" onclick="event.stopPropagation()">
                    ${a.cv_doc_id ? `
                      <button class="cv-badge" onclick="previewCV(${a.cv_doc_id},'${a.company} — ${a.position}')" title="Prévisualiser le CV">
                        <svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4zm2 6a1 1 0 011-1h6a1 1 0 110 2H7a1 1 0 01-1-1zm1 3a1 1 0 100 2h6a1 1 0 100-2H7z" clip-rule="evenodd"/></svg>
                        CV
                      </button>` : '<span style="color:var(--text-3);font-size:.72rem;">—</span>'}
                  </td>
                </tr>`).join('')}
            </tbody>
          </table>`}
    </div>
  `;
}

let searchTimer;
function debounceSearch(v) {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => { listFilters.search = v; renderApplicationsList(); }, 300);
}
function setFilter(key, val) {
  listFilters[key] = val;
  renderApplicationsList();
}

/* ── Kanban ────────────────────────────────────────────────────────────── */
async function renderKanban() {
  const apps = await api.get('/api/applications');
  const c = document.getElementById('page-content');

  c.innerHTML = `
    <div class="page-header">
      <div><h1>Kanban</h1></div>
      <div class="page-header-actions">
        <button class="btn btn-primary" onclick="showAppForm()">
          ${svgIcon(ICONS.plus)} Nouvelle
        </button>
      </div>
    </div>
    <div class="kanban-wrapper">
      <div class="kanban-board">
        ${KANBAN_COLS.map(col => {
          const colApps = apps.filter(a => col.statuses.includes(a.status));
          return `
            <div class="kanban-col">
              <div class="kanban-col-header">
                <div class="kanban-col-title">
                  <span style="width:8px;height:8px;border-radius:50%;background:${col.color};display:inline-block;"></span>
                  ${col.label}
                </div>
                <span class="kanban-col-count">${colApps.length}</span>
              </div>
              <div class="kanban-cards">
                ${colApps.length === 0
                  ? '<p style="text-align:center;color:var(--text-3);font-size:.75rem;padding:10px;">Vide</p>'
                  : colApps.map(a => `
                    <div class="kanban-card" onclick="navigate('#/applications/${a.id}')">
                      <div class="kanban-card-company">${a.company}</div>
                      <div class="kanban-card-pos">${a.position}</div>
                      ${a.location ? `<div style="font-size:.7rem;color:var(--text-3);margin-top:2px;">${a.location}</div>` : ''}
                      <div class="kanban-card-footer">
                        ${statusBadge(a.status)}
                        <span class="kanban-card-date">${fmtShort(a.date_applied)}</span>
                      </div>
                    </div>`).join('')}
              </div>
            </div>`;
        }).join('')}
      </div>
    </div>
  `;
}

/* ── Application Detail ────────────────────────────────────────────────── */
async function renderApplicationDetail(id) {
  const a = await api.get(`/api/applications/${id}`);
  const c = document.getElementById('page-content');

  const salary = a.salary_min || a.salary_max
    ? `${a.salary_min ? a.salary_min.toLocaleString('fr-FR') + '€' : '?'} – ${a.salary_max ? a.salary_max.toLocaleString('fr-FR') + '€' : '?'}`
    : '—';
  const remoteMap = { on_site: 'Présentiel', hybrid: 'Hybride', remote: '100% Remote' };

  c.innerHTML = `
    <div class="breadcrumb">
      <a href="#/applications">${svgIcon(ICONS.back)} Candidatures</a>
      ${svgIcon(ICONS.chevron)}
      <span>${a.company}</span>
    </div>

    <div class="detail-header">
      <div class="detail-avatar">${initial(a.company)}</div>
      <div class="detail-meta">
        <div class="detail-company">${a.company}</div>
        <div class="detail-position">${a.position}</div>
        <div class="detail-pills">
          ${statusBadge(a.status)}
          ${priorityBadge(a.priority)}
          <span class="pill"><svg viewBox="0 0 20 20" fill="currentColor" style="width:12px;height:12px"><path fill-rule="evenodd" d="M6 2a1 1 0 00-1 1v1H4a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V6a2 2 0 00-2-2h-1V3a1 1 0 10-2 0v1H7V3a1 1 0 00-1-1zm0 5a1 1 0 000 2h8a1 1 0 100-2H6z" clip-rule="evenodd"/></svg>${fmt(a.date_applied)}</span>
          ${a.location ? `<span class="pill"><svg viewBox="0 0 20 20" fill="currentColor" style="width:12px;height:12px"><path fill-rule="evenodd" d="M5.05 4.05a7 7 0 119.9 9.9L10 18.9l-4.95-4.95a7 7 0 010-9.9zM10 11a2 2 0 100-4 2 2 0 000 4z" clip-rule="evenodd"/></svg>${a.location}</span>` : ''}
          <span class="pill">${a.contract_type||'CDI'}</span>
          <span class="pill">${remoteMap[a.remote]||a.remote||'—'}</span>
          ${a.source ? `<span class="pill">${a.source}</span>` : ''}
        </div>
      </div>
      <div class="detail-header-actions">
        ${(() => { const cv = a.documents.find(d => d.type === 'cv'); return cv ? `
        <button class="btn btn-ghost" style="color:var(--green);border-color:rgba(52,211,153,.3);" onclick="previewCV(${cv.id},'${a.company} — ${a.position}')">
          <svg viewBox="0 0 20 20" fill="currentColor" style="width:15px;height:15px;"><path fill-rule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4zm2 6a1 1 0 011-1h6a1 1 0 110 2H7a1 1 0 01-1-1zm1 3a1 1 0 100 2h6a1 1 0 100-2H7z" clip-rule="evenodd"/></svg>
          Voir le CV
        </button>` : ''; })()}
        <button class="btn btn-ghost" onclick="navigate('#/applications/${id}/edit')">
          ${svgIcon(ICONS.edit)} Modifier
        </button>
        <button class="btn btn-danger" onclick="deleteApplication(${id})">
          ${svgIcon(ICONS.trash)}
        </button>
      </div>
    </div>

    <div class="tabs">
      <button class="tab-btn active" onclick="switchTab(this,'tab-overview')">Aperçu</button>
      <button class="tab-btn" onclick="switchTab(this,'tab-timeline')">Timeline <span class="nav-badge" style="margin-left:4px;">${a.events.length}</span></button>
      <button class="tab-btn" onclick="switchTab(this,'tab-contacts')">Contacts <span class="nav-badge" style="margin-left:4px;">${a.contacts.length}</span></button>
      <button class="tab-btn" onclick="switchTab(this,'tab-docs')">Documents <span class="nav-badge" style="margin-left:4px;">${a.documents.length}</span></button>
    </div>

    <!-- TAB: Overview -->
    <div id="tab-overview" class="tab-panel active">
      <div class="card" style="margin-bottom:16px;">
        <div class="card-body">
          <div class="info-grid">
            <div class="info-item">
              <label>Salaire</label>
              <div class="val">${salary}</div>
            </div>
            <div class="info-item">
              <label>Type de contrat</label>
              <div class="val">${a.contract_type||'—'}</div>
            </div>
            <div class="info-item">
              <label>Télétravail</label>
              <div class="val">${remoteMap[a.remote]||a.remote||'—'}</div>
            </div>
            <div class="info-item">
              <label>Source</label>
              <div class="val">${a.source||'—'}</div>
            </div>
            <div class="info-item">
              <label>Lien offre</label>
              <div class="val">${a.job_url ? `<a href="${a.job_url}" target="_blank" rel="noopener">${svgIcon(ICONS.link)} Voir l'offre</a>` : '—'}</div>
            </div>
            <div class="info-item">
              <label>Date de candidature</label>
              <div class="val">${fmt(a.date_applied)}</div>
            </div>
          </div>
        </div>
      </div>
      ${a.notes ? `
        <div class="section-label">Notes</div>
        <div class="notes-box">${a.notes}</div>` : ''}
      ${(() => {
        const cvDoc = a.documents.find(d => d.type === 'cv');
        if (!cvDoc) return '';
        const mime = cvDoc.mime_type || '';
        const isPdf = mime.includes('pdf');
        const isImg = mime.startsWith('image/');
        let embed;
        if (isPdf) {
          embed = `<embed src="/api/documents/${cvDoc.id}/view" type="application/pdf" class="cv-embed-pdf">`;
        } else if (isImg) {
          embed = `<img src="/api/documents/${cvDoc.id}/view" class="cv-embed-img" alt="CV">`;
        } else {
          embed = `<div class="cv-no-preview">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z"/></svg>
            <span>Aperçu non disponible pour ce format</span>
            <a href="/api/documents/${cvDoc.id}/download" class="btn btn-primary" style="margin-top:4px;">${svgIcon(ICONS.download)} Télécharger le CV</a>
          </div>`;
        }
        return `
          <div class="cv-inline-section">
            <div class="cv-inline-header">
              <div class="cv-inline-title">
                <svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4zm2 6a1 1 0 011-1h6a1 1 0 110 2H7a1 1 0 01-1-1zm1 3a1 1 0 100 2h6a1 1 0 100-2H7z" clip-rule="evenodd"/></svg>
                CV associé
                <span class="cv-inline-name">— ${cvDoc.name}</span>
              </div>
              <a href="/api/documents/${cvDoc.id}/download" class="btn btn-ghost" style="font-size:.75rem;padding:4px 10px;">
                ${svgIcon(ICONS.download)} Télécharger
              </a>
            </div>
            ${embed}
          </div>`;
      })()}
      ${a.job_description ? `
        <div class="section-label">Description du poste</div>
        <div class="notes-box">${a.job_description}</div>` : ''}
    </div>

    <!-- TAB: Timeline -->
    <div id="tab-timeline" class="tab-panel">
      <div style="display:flex;justify-content:flex-end;margin-bottom:14px;">
        <button class="btn btn-ghost" onclick="addEventModal(${id})">
          ${svgIcon(ICONS.plus)} Ajouter un événement
        </button>
      </div>
      <div class="card">
        <div class="card-body">
          ${a.events.length === 0
            ? '<p class="text-muted text-sm">Aucun événement.</p>'
            : `<div class="timeline">${a.events.map(e => `
                <div class="timeline-item">
                  <div class="timeline-dot"></div>
                  <div class="tl-date">${fmt(e.date)}</div>
                  <div class="tl-title">${e.title}</div>
                  ${e.description ? `<div class="tl-desc">${e.description}</div>` : ''}
                  <button class="btn-icon tl-delete" onclick="deleteEvent(${e.id},${id})" title="Supprimer">
                    ${svgIcon(ICONS.trash)}
                  </button>
                </div>`).join('')}
              </div>`}
        </div>
      </div>
    </div>

    <!-- TAB: Contacts -->
    <div id="tab-contacts" class="tab-panel">
      <div style="display:flex;justify-content:flex-end;margin-bottom:14px;">
        <button class="btn btn-ghost" onclick="addContactModal(${id})">
          ${svgIcon(ICONS.plus)} Ajouter un contact
        </button>
      </div>
      <div class="contacts-grid" id="contacts-list">
        ${a.contacts.length === 0
          ? '<p class="text-muted text-sm">Aucun contact.</p>'
          : a.contacts.map(ct => renderContactCard(ct, id)).join('')}
      </div>
    </div>

    <!-- TAB: Documents -->
    <div id="tab-docs" class="tab-panel">
      <div class="upload-zone" id="upload-zone-${id}" onclick="triggerFileUpload(${id})" ondragover="handleDragOver(event)" ondragleave="handleDragLeave(event)" ondrop="handleDrop(event,${id})">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5"/></svg>
        <p>Glisser-déposer un fichier ici</p>
        <span>PDF, DOC, DOCX, Images — max 50 MB</span>
        <input type="file" id="file-input-${id}" style="display:none" onchange="uploadFile(${id},this)" accept=".pdf,.doc,.docx,.txt,.odt,.png,.jpg,.jpeg">
      </div>
      <div class="docs-list" id="docs-list-${id}">
        ${a.documents.map(d => renderDocItem(d)).join('')}
      </div>
    </div>
  `;
}

function switchTab(btn, tabId) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById(tabId).classList.add('active');
}

function renderContactCard(ct, appId) {
  return `
    <div class="contact-card" id="contact-${ct.id}">
      <div class="contact-header">
        <div class="contact-avatar">${initial(ct.name)}</div>
        <div>
          <div class="contact-name">${ct.name}</div>
          <div class="contact-role">${ct.role||'—'}</div>
        </div>
      </div>
      <div class="contact-links">
        ${ct.email ? `<a class="contact-link" href="mailto:${ct.email}">
          <svg viewBox="0 0 20 20" fill="currentColor"><path d="M2.003 5.884L10 9.882l7.997-3.998A2 2 0 0016 4H4a2 2 0 00-1.997 1.884z"/><path d="M18 8.118l-8 4-8-4V14a2 2 0 002 2h12a2 2 0 002-2V8.118z"/></svg>
          ${ct.email}</a>` : ''}
        ${ct.phone ? `<a class="contact-link" href="tel:${ct.phone}">
          <svg viewBox="0 0 20 20" fill="currentColor"><path d="M2 3a1 1 0 011-1h2.153a1 1 0 01.986.836l.74 4.435a1 1 0 01-.54 1.06l-1.548.773a11.037 11.037 0 006.105 6.105l.774-1.548a1 1 0 011.059-.54l4.435.74a1 1 0 01.836.986V17a1 1 0 01-1 1h-2C7.82 18 2 12.18 2 5V3z"/></svg>
          ${ct.phone}</a>` : ''}
        ${ct.linkedin ? `<a class="contact-link" href="${ct.linkedin}" target="_blank">
          <svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M16.338 16.338H13.67V12.16c0-.995-.017-2.277-1.387-2.277-1.39 0-1.601 1.086-1.601 2.207v4.248H8.014v-8.59h2.559v1.174h.037c.356-.675 1.227-1.387 2.526-1.387 2.703 0 3.203 1.778 3.203 4.092v4.711zM5.005 6.575a1.548 1.548 0 11-.003-3.096 1.548 1.548 0 01.003 3.096zm-1.337 9.763H6.34v-8.59H3.667v8.59zM17.668 1H2.328C1.595 1 1 1.581 1 2.298v15.403C1 18.418 1.595 19 2.328 19h15.34c.734 0 1.332-.582 1.332-1.299V2.298C19 1.581 18.402 1 17.668 1z" clip-rule="evenodd"/></svg>
          LinkedIn</a>` : ''}
      </div>
      ${ct.notes ? `<div style="font-size:.75rem;color:var(--text-3);margin-top:8px;">${ct.notes}</div>` : ''}
      <div class="contact-card-actions">
        <button class="btn btn-ghost" style="font-size:.75rem;padding:4px 10px;" onclick="editContactModal(${JSON.stringify(ct).replace(/"/g,'&quot;')},${appId})">Modifier</button>
        <button class="btn btn-danger" style="font-size:.75rem;padding:4px 10px;" onclick="deleteContact(${ct.id},${appId})">Supprimer</button>
      </div>
    </div>`;
}

function renderDocItem(d) {
  const ic = docIconClass(d.mime_type);
  const typeLabels = { cv:'CV', cover_letter:'Lettre de motivation', portfolio:'Portfolio', test:'Test', other:'Autre' };
  return `
    <div class="doc-item" id="doc-${d.id}">
      <div class="doc-icon ${ic}">${docIconSvg()}</div>
      <div class="doc-info">
        <div class="doc-name">${d.name}</div>
        <div class="doc-meta">${typeLabels[d.type]||d.type} · ${formatBytes(d.size)} · ${fmt(d.created_at)}</div>
      </div>
      <div class="doc-actions">
        <a href="/api/documents/${d.id}/download" class="btn-icon" title="Télécharger">${svgIcon(ICONS.download)}</a>
        <button class="btn-icon" onclick="deleteDoc(${d.id})" title="Supprimer">${svgIcon(ICONS.trash)}</button>
      </div>
    </div>`;
}

/* ── Application Form ──────────────────────────────────────────────────── */
async function renderAppForm(id = null) {
  const c = document.getElementById('page-content');
  let a = {};
  if (id) {
    c.innerHTML = '<div class="loading-center"><div class="spinner"></div></div>';
    a = await api.get(`/api/applications/${id}`);
  }
  const isEdit = !!id;

  c.innerHTML = `
    <div class="breadcrumb">
      <a href="#/applications">${svgIcon(ICONS.back)} Candidatures</a>
      ${isEdit ? `${svgIcon(ICONS.chevron)}<a href="#/applications/${id}">${a.company}</a>` : ''}
      ${svgIcon(ICONS.chevron)}
      <span>${isEdit ? 'Modifier' : 'Nouvelle candidature'}</span>
    </div>
    <div class="page-header">
      <h1>${isEdit ? 'Modifier la candidature' : 'Nouvelle candidature'}</h1>
    </div>
    <div class="card">
      <div class="card-body">
        <form id="app-form" onsubmit="submitAppForm(event,${id||'null'})">
          <div class="form-grid">
            <div class="form-group">
              <label>Entreprise *</label>
              <input name="company" required value="${a.company||''}" placeholder="Ex: Google">
            </div>
            <div class="form-group">
              <label>Poste *</label>
              <input name="position" required value="${a.position||''}" placeholder="Ex: Software Engineer">
            </div>
            <div class="form-group">
              <label>Localisation</label>
              <input name="location" value="${a.location||''}" placeholder="Ex: Paris, France">
            </div>
            <div class="form-group">
              <label>Type de contrat</label>
              <select name="contract_type">
                ${CONTRACT_TYPES.map(t=>`<option value="${t}" ${a.contract_type===t?'selected':''}>${t}</option>`).join('')}
              </select>
            </div>
            <div class="form-group">
              <label>Télétravail</label>
              <select name="remote">
                ${REMOTE_TYPES.map(([v,l])=>`<option value="${v}" ${a.remote===v?'selected':''}>${l}</option>`).join('')}
              </select>
            </div>
            <div class="form-group">
              <label>Source</label>
              <select name="source">
                <option value="">— Sélectionner —</option>
                ${SOURCES.map(s=>`<option value="${s}" ${a.source===s?'selected':''}>${s}</option>`).join('')}
              </select>
            </div>
            <div class="form-group">
              <label>Salaire min (€/an)</label>
              <input type="number" name="salary_min" value="${a.salary_min||''}" placeholder="40000">
            </div>
            <div class="form-group">
              <label>Salaire max (€/an)</label>
              <input type="number" name="salary_max" value="${a.salary_max||''}" placeholder="60000">
            </div>
            <div class="form-group">
              <label>Statut</label>
              <select name="status">
                ${Object.entries(STATUS).map(([k,v])=>`<option value="${k}" ${(a.status||'applied')===k?'selected':''}>${v.label}</option>`).join('')}
              </select>
            </div>
            <div class="form-group">
              <label>Priorité</label>
              <select name="priority">
                ${PRIORITIES.map(([k,v])=>`<option value="${k}" ${(a.priority||'medium')===k?'selected':''}>${v}</option>`).join('')}
              </select>
            </div>
            <div class="form-group">
              <label>Date de candidature</label>
              <input type="date" name="date_applied" value="${a.date_applied||new Date().toISOString().split('T')[0]}">
            </div>
            <div class="form-group">
              <label>Lien de l'offre</label>
              <input type="url" name="job_url" value="${a.job_url||''}" placeholder="https://…">
            </div>
            <div class="form-group span-2">
              <label>Notes personnelles</label>
              <textarea name="notes" placeholder="Impressions, infos utiles…">${a.notes||''}</textarea>
            </div>
            <div class="form-group span-2">
              <label>Description du poste</label>
              <textarea name="job_description" rows="6" placeholder="Coller la description du poste ici…">${a.job_description||''}</textarea>
            </div>
            <div class="form-group span-2">
              <label>CV pour cette candidature <span style="color:var(--text-3);font-weight:400;">(optionnel)</span></label>
              <div class="cv-drop-zone" id="cv-drop-zone"
                   onclick="document.getElementById('cv-file-input').click()"
                   ondragover="cvDragOver(event)"
                   ondragleave="cvDragLeave(event)"
                   ondrop="cvDrop(event)">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z"/>
                </svg>
                <div class="cv-drop-zone-text">
                  <div class="cv-drop-label" id="cv-drop-label">Cliquer ou glisser votre CV ici</div>
                  <div class="cv-drop-sub">PDF, DOC, DOCX — max 50 MB</div>
                </div>
                ${pendingCvFile ? `<button type="button" class="btn btn-icon" onclick="clearCvFile(event)" title="Retirer">${svgIcon(ICONS.trash)}</button>` : ''}
                <input type="file" id="cv-file-input" style="display:none" accept=".pdf,.doc,.docx,.odt" onchange="cvFileSelected(this)">
              </div>
            </div>
          </div>
          <div class="form-actions">
            <button type="button" class="btn btn-ghost" onclick="history.back()">Annuler</button>
            <button type="submit" class="btn btn-primary">${isEdit ? 'Enregistrer' : 'Créer la candidature'}</button>
          </div>
        </form>
      </div>
    </div>
  `;
}

async function submitAppForm(e, id) {
  e.preventDefault();
  const form = e.target;
  const btn = form.querySelector('[type=submit]');
  btn.disabled = true; btn.textContent = 'Enregistrement…';
  const data = Object.fromEntries(new FormData(form));
  // Convert empty strings to null for numbers
  ['salary_min','salary_max'].forEach(k => { if (data[k]==='') data[k]=null; });
  try {
    if (id) {
      await api.put(`/api/applications/${id}`, data);
      if (pendingCvFile) {
        const fd = new FormData();
        fd.append('file', pendingCvFile);
        fd.append('name', pendingCvFile.name);
        fd.append('type', 'cv');
        try { await api.upload(`/api/applications/${id}/documents`, fd); }
        catch(err) { toast('CV non uploadé : ' + err.message, 'error'); }
        pendingCvFile = null;
      }
      toast('Candidature mise à jour');
      navigate(`#/applications/${id}`);
    } else {
      const a = await api.post('/api/applications', data);
      if (pendingCvFile) {
        const fd = new FormData();
        fd.append('file', pendingCvFile);
        fd.append('name', pendingCvFile.name);
        fd.append('type', 'cv');
        try { await api.upload(`/api/applications/${a.id}/documents`, fd); }
        catch(err) { toast('CV non uploadé : ' + err.message, 'error'); }
        pendingCvFile = null;
      }
      toast('Candidature créée !');
      updateNavCount();
      navigate(`#/applications/${a.id}`);
    }
  } catch(err) {
    toast(err.message, 'error');
    btn.disabled = false; btn.textContent = id ? 'Enregistrer' : 'Créer la candidature';
  }
}

/* ── Modals ────────────────────────────────────────────────────────────── */
function showAppForm() { navigate('#/applications/new'); }

function addEventModal(appId) {
  openModal('Ajouter un événement', `
    <form onsubmit="submitEvent(event,${appId})">
      <div class="form-group">
        <label>Type</label>
        <select name="type" id="ev-type" onchange="updateEventTitle(this)">
          ${EVENT_TYPES.map(([k,v])=>`<option value="${k}">${v}</option>`).join('')}
        </select>
      </div>
      <div class="form-group mt-2">
        <label>Titre</label>
        <input name="title" id="ev-title" required value="${STATUS['applied'].label}">
      </div>
      <div class="form-group mt-2">
        <label>Date</label>
        <input type="date" name="date" required value="${new Date().toISOString().split('T')[0]}">
      </div>
      <div class="form-group mt-2">
        <label>Description (optionnel)</label>
        <textarea name="description" placeholder="Notes sur cet événement…"></textarea>
      </div>
      <div class="form-actions">
        <button type="button" class="btn btn-ghost" onclick="closeModal()">Annuler</button>
        <button type="submit" class="btn btn-primary">Ajouter</button>
      </div>
    </form>
  `);
}

function updateEventTitle(sel) {
  const map = Object.fromEntries(EVENT_TYPES);
  const titleEl = document.getElementById('ev-title');
  if (titleEl) titleEl.value = map[sel.value] || '';
}

async function submitEvent(e, appId) {
  e.preventDefault();
  const data = Object.fromEntries(new FormData(e.target));
  try {
    const ev = await api.post(`/api/applications/${appId}/events`, data);
    closeModal();
    toast('Événement ajouté');
    await renderApplicationDetail(appId);
    switchTab(document.querySelectorAll('.tab-btn')[1], 'tab-timeline');
  } catch(err) { toast(err.message,'error'); }
}

async function deleteEvent(evId, appId) {
  if (!confirm('Supprimer cet événement ?')) return;
  await api.delete(`/api/events/${evId}`);
  toast('Événement supprimé');
  renderApplicationDetail(appId);
}

function addContactModal(appId, ct = null) {
  const t = ct ? 'Modifier le contact' : 'Ajouter un contact';
  openModal(t, `
    <form onsubmit="submitContact(event,${appId},${ct?ct.id:'null'})">
      <div class="form-grid">
        <div class="form-group">
          <label>Nom *</label>
          <input name="name" required value="${ct?.name||''}">
        </div>
        <div class="form-group">
          <label>Rôle</label>
          <input name="role" value="${ct?.role||''}" placeholder="Ex: DRH, Tech Lead">
        </div>
        <div class="form-group">
          <label>Email</label>
          <input type="email" name="email" value="${ct?.email||''}">
        </div>
        <div class="form-group">
          <label>Téléphone</label>
          <input type="tel" name="phone" value="${ct?.phone||''}">
        </div>
        <div class="form-group span-2">
          <label>LinkedIn</label>
          <input type="url" name="linkedin" value="${ct?.linkedin||''}" placeholder="https://linkedin.com/in/…">
        </div>
        <div class="form-group span-2">
          <label>Notes</label>
          <textarea name="notes">${ct?.notes||''}</textarea>
        </div>
      </div>
      <div class="form-actions">
        <button type="button" class="btn btn-ghost" onclick="closeModal()">Annuler</button>
        <button type="submit" class="btn btn-primary">${ct?'Enregistrer':'Ajouter'}</button>
      </div>
    </form>
  `);
}

function editContactModal(ct, appId) { addContactModal(appId, ct); }

async function submitContact(e, appId, ctId) {
  e.preventDefault();
  const data = Object.fromEntries(new FormData(e.target));
  try {
    if (ctId) {
      await api.put(`/api/contacts/${ctId}`, data);
      toast('Contact mis à jour');
    } else {
      await api.post(`/api/applications/${appId}/contacts`, data);
      toast('Contact ajouté');
    }
    closeModal();
    await renderApplicationDetail(appId);
    switchTab(document.querySelectorAll('.tab-btn')[2], 'tab-contacts');
  } catch(err) { toast(err.message,'error'); }
}

async function deleteContact(ctId, appId) {
  if (!confirm('Supprimer ce contact ?')) return;
  await api.delete(`/api/contacts/${ctId}`);
  toast('Contact supprimé');
  renderApplicationDetail(appId);
}

async function deleteApplication(id) {
  if (!confirm('Supprimer définitivement cette candidature et tous ses fichiers ?')) return;
  await api.delete(`/api/applications/${id}`);
  toast('Candidature supprimée');
  updateNavCount();
  navigate('#/applications');
}

/* ── File Upload ───────────────────────────────────────────────────────── */
function triggerFileUpload(appId) {
  document.getElementById(`file-input-${appId}`).click();
}
function handleDragOver(e) {
  e.preventDefault();
  e.currentTarget.classList.add('drag-over');
}
function handleDragLeave(e) {
  e.currentTarget.classList.remove('drag-over');
}
async function handleDrop(e, appId) {
  e.preventDefault();
  e.currentTarget.classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (file) await doUpload(appId, file);
}
async function uploadFile(appId, input) {
  const file = input.files[0];
  if (!file) return;
  await doUpload(appId, file);
  input.value = '';
}

async function doUpload(appId, file) {
  // Guess doc type
  let type = 'other';
  const low = file.name.toLowerCase();
  if (low.includes('cv') || low.includes('resume')) type = 'cv';
  else if (low.includes('lettre') || low.includes('cover') || low.includes('motivation')) type = 'cover_letter';
  else if (low.includes('portfolio')) type = 'portfolio';

  const form = new FormData();
  form.append('file', file);
  form.append('name', file.name);
  form.append('type', type);
  try {
    const doc = await api.upload(`/api/applications/${appId}/documents`, form);
    const list = document.getElementById(`docs-list-${appId}`);
    if (list) list.insertAdjacentHTML('afterbegin', renderDocItem(doc));
    toast('Document ajouté');
  } catch(err) { toast(err.message,'error'); }
}

async function deleteDoc(docId) {
  if (!confirm('Supprimer ce document ?')) return;
  await api.delete(`/api/documents/${docId}`);
  const el = document.getElementById(`doc-${docId}`);
  if (el) el.remove();
  toast('Document supprimé');
}

/* ── CV Preview ────────────────────────────────────────────────────────── */
async function previewCV(docId, title) {
  if (cvBlobUrl) { URL.revokeObjectURL(cvBlobUrl); cvBlobUrl = null; }
  document.getElementById('modal-box').classList.add('wide');
  openModal(title || 'Aperçu CV', '<div class="loading-center"><div class="spinner"></div> Chargement…</div>');
  try {
    const r = await fetch(`/api/documents/${docId}/download`);
    if (!r.ok) throw new Error('Document inaccessible');
    const blob = await r.blob();
    cvBlobUrl = URL.createObjectURL(blob);

    let preview;
    if (blob.type.includes('pdf')) {
      preview = `<embed src="${cvBlobUrl}" type="application/pdf" class="preview-pdf">`;
    } else if (blob.type.startsWith('image/')) {
      preview = `<img src="${cvBlobUrl}" class="preview-img">`;
    } else {
      preview = `<p class="text-muted" style="text-align:center;padding:48px;">Aperçu non disponible — téléchargez le fichier pour le consulter.</p>`;
    }

    document.getElementById('modal-body').innerHTML = `
      <div class="preview-toolbar">
        <span class="text-muted text-sm">${title || 'CV'}</span>
        <button class="btn btn-ghost" onclick="downloadCvBlob()">
          ${svgIcon(ICONS.download)} Télécharger
        </button>
      </div>
      ${preview}
    `;
  } catch(err) {
    document.getElementById('modal-body').innerHTML =
      `<div class="empty-state"><p>Erreur : ${err.message}</p></div>`;
  }
}

function downloadCvBlob() {
  if (!cvBlobUrl) return;
  const a = document.createElement('a');
  a.href = cvBlobUrl;
  a.download = 'cv';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

/* ── CV form helpers ───────────────────────────────────────────────────── */
function cvDragOver(e)  { e.preventDefault(); e.currentTarget.classList.add('drag-over'); }
function cvDragLeave(e) { e.currentTarget.classList.remove('drag-over'); }
function cvDrop(e) {
  e.preventDefault();
  e.currentTarget.classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (file) setCvFile(file);
}
function cvFileSelected(input) { if (input.files[0]) setCvFile(input.files[0]); }
function setCvFile(file) {
  pendingCvFile = file;
  const zone  = document.getElementById('cv-drop-zone');
  const label = document.getElementById('cv-drop-label');
  if (zone)  zone.classList.add('has-file');
  if (label) label.textContent = file.name;
}
function clearCvFile(e) {
  e.stopPropagation();
  pendingCvFile = null;
  const zone  = document.getElementById('cv-drop-zone');
  const label = document.getElementById('cv-drop-label');
  const input = document.getElementById('cv-file-input');
  if (zone)  zone.classList.remove('has-file');
  if (label) label.textContent = 'Cliquer ou glisser votre CV ici';
  if (input) input.value = '';
}
