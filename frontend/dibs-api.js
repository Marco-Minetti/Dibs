/* ============================================================
 *  dibs-api.js — client for the dibs backend
 *  Drop this into the HTML app and replace the in-memory
 *  `listings` / `chats` arrays with live API calls.
 *
 *  Web:    tokens live in localStorage (fine for dev/PWA).
 *  Native: swap `store` for Capacitor Preferences / SecureStorage
 *          so tokens sit in the iOS Keychain / Android Keystore.
 * ============================================================ */

const API_BASE = window.DIBS_API_BASE || 'http://localhost:4000';

// --- token storage (swap this object on native) ---
const store = {
  get: (k) => localStorage.getItem(k),
  set: (k, v) => localStorage.setItem(k, v),
  del: (k) => localStorage.removeItem(k),
};

const TOKENS = {
  get access() { return store.get('dibs_access'); },
  get refresh() { return store.get('dibs_refresh'); },
  save(access, refresh) { store.set('dibs_access', access); if (refresh) store.set('dibs_refresh', refresh); },
  clear() { store.del('dibs_access'); store.del('dibs_refresh'); },
};

class DibsAPI {
  constructor() { this.ws = null; this.onMessage = null; }

  // ---- low-level request with one automatic token refresh ----
  async req(method, path, body, _retried = false) {
    const headers = { 'Content-Type': 'application/json' };
    if (TOKENS.access) headers.Authorization = `Bearer ${TOKENS.access}`;

    const res = await fetch(API_BASE + path, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    if (res.status === 401 && !_retried && TOKENS.refresh && !path.includes('/auth/')) {
      const ok = await this.refresh();
      if (ok) return this.req(method, path, body, true);
    }

    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data.error || 'request_failed'), { status: res.status, data });
    return data;
  }

  // ================= auth =================
  schools(q = '') { return this.req('GET', `/api/schools?q=${encodeURIComponent(q)}`); }

  requestCode(email, schoolId, firstName) {
    return this.req('POST', '/api/auth/request-code', { email, schoolId, firstName });
  }

  async verifyCode(email, code) {
    const out = await this.req('POST', '/api/auth/verify-code', { email, code });
    TOKENS.save(out.accessToken, out.refreshToken);
    return out.user;
  }

  async refresh() {
    try {
      const out = await this.req('POST', '/api/auth/refresh', { refreshToken: TOKENS.refresh }, true);
      TOKENS.save(out.accessToken, out.refreshToken);
      return true;
    } catch { TOKENS.clear(); return false; }
  }

  async logout() {
    try { await this.req('POST', '/api/auth/logout', { refreshToken: TOKENS.refresh }); } catch {}
    TOKENS.clear();
    if (this.ws) this.ws.close();
  }

  me() { return this.req('GET', '/api/me'); }
  isLoggedIn() { return !!TOKENS.access; }

  // ================= listings =================
  feed({ category, q, cursor, limit } = {}) {
    const p = new URLSearchParams();
    if (category) p.set('category', category);
    if (q) p.set('q', q);
    if (cursor) p.set('cursor', cursor);
    if (limit) p.set('limit', limit);
    return this.req('GET', `/api/listings?${p.toString()}`);
  }
  listing(id) { return this.req('GET', `/api/listings/${id}`); }
  createListing(payload) { return this.req('POST', '/api/listings', payload); }
  deleteListing(id) { return this.req('DELETE', `/api/listings/${id}`); }

  favorite(id) { return this.req('PUT', `/api/listings/${id}/favorite`); }
  unfavorite(id) { return this.req('DELETE', `/api/listings/${id}/favorite`); }
  favorites() { return this.req('GET', '/api/favorites'); }

  callDibs(id) { return this.req('POST', `/api/listings/${id}/dibs`); }

  // ================= photos =================
  // 1) ask backend for a presigned URL  2) PUT the file straight to storage
  // 3) return photoId to attach to the listing
  async uploadPhoto(file) {
    const { photoId, uploadUrl } = await this.req('POST', '/api/uploads/sign', { contentType: file.type });
    const put = await fetch(uploadUrl, { method: 'PUT', headers: { 'Content-Type': file.type }, body: file });
    if (!put.ok) throw new Error('upload_failed');
    return photoId;
  }

  // ================= chats =================
  conversations() { return this.req('GET', '/api/conversations'); }
  messages(convId) { return this.req('GET', `/api/conversations/${convId}/messages`); }
  sendMessage(convId, text) { return this.req('POST', `/api/conversations/${convId}/messages`, { body: text }); }

  // ================= safety =================
  report(targetType, targetId, reason, detail) {
    return this.req('POST', '/api/safety/report', { targetType, targetId, reason, detail });
  }
  block(userId) { return this.req('POST', '/api/safety/block', { userId }); }

  // ================= realtime =================
  connectRealtime(onMessage) {
    if (!TOKENS.access) return;
    this.onMessage = onMessage;
    const url = API_BASE.replace(/^http/, 'ws') + '/ws?token=' + encodeURIComponent(TOKENS.access);
    this.ws = new WebSocket(url);
    this.ws.onmessage = (ev) => {
      try {
        const data = JSON.parse(ev.data);
        if (data.type === 'message' && this.onMessage) this.onMessage(data.message);
      } catch {}
    };
    this.ws.onclose = () => { setTimeout(() => this.connectRealtime(onMessage), 3000); }; // auto-reconnect
  }
}

window.dibs = new DibsAPI();
